import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  commandResultSchema,
  proposeObservedCommandSchema,
} from "@remoteassist/command-schema";
import {
  governedActionsForControl,
  governedBrowserActions,
  isHigherRiskActionIntent,
  isHigherRiskControlName,
  isPotentiallyLowRiskAction,
  observedIncidentNumber,
  observedSafeNavigationName,
  type GovernedBrowserAction,
} from "@remoteassist/policy-model";
import type { AuditLog } from "../domain/audit-log.js";
import { ControlService } from "../domain/control-service.js";
import {
  ENTERPRISE_DOMAIN_NAVIGATION_FALLBACKS,
  findGroundedPlausibleControl,
  findGroundedSearchInput,
  isInvestigativeQuery,
} from "../domain/domain-navigation-map.js";
import { DomainError } from "../domain/errors.js";
import { LlmService, type LlmProvider } from "../domain/llm-service.js";
import type { Identity, SessionStore } from "../domain/session-store.js";
import {
  MAX_RESOLUTION_PLAN_STEPS,
  type GovernedActionType,
  type ResolutionPlan,
  type ResolutionPlanStep,
  type SafeControl,
  type SanitizedObservation,
  type SupportSession,
} from "@remoteassist/shared-types";

interface ControlRouteDependencies {
  sessions: SessionStore;
  audit: AuditLog;
  authMode: "mock" | "production";
  actionLlmProvider?: LlmProvider;
}

const realtimeActionProposalSchema = z
  .object({
    call_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .max(200),
    control_name: z.string().min(1).max(300),
    control_role: z.string().min(1).max(80),
    action_type: z.enum(governedBrowserActions),
    purpose: z.string().min(3).max(500),
  })
  .strict();

const actionSuggestionSchema = z
  .object({
    query: z.string().max(1000).optional().default(""),
    conversation_history: z
      .array(
        z
          .object({
            sender: z.enum(["user", "system"]),
            text: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .max(20)
      .optional()
      .default([]),
    trigger: z
      .enum([
        "initial_observation",
        "chat",
        "voice",
        "page_changed",
        "manual",
        "discovery",
      ])
      .optional()
      .default("manual"),
    discoveryPlanId: z.string().min(1).max(120).optional(),
  })
  .strict();

function identity(
  request: FastifyRequest,
  authMode: "mock" | "production",
): Identity {
  if (authMode === "production")
    throw new Error("Production authentication is not configured.");
  const value = (name: string, fallback: string) => {
    const header = request.headers[name];
    return typeof header === "string" && header.trim()
      ? header.trim()
      : fallback;
  };
  return {
    tenantId: value("x-remoteassist-tenant-id", "local-tenant"),
    userId: value("x-remoteassist-user-id", "local-user"),
    roles: value("x-remoteassist-roles", "employee")
      .split(",")
      .map((role) => role.trim()),
  };
}

function isFirstIncidentRequest(query: string): boolean {
  return (
    /\b(first|top|initial)\b[\s\S]{0,40}\bincident\b/i.test(query) &&
    /\b(open|click|view|show|select)\b/i.test(query)
  );
}

function requestedIncidentNumber(query: string): string | null {
  const match = query.match(/\bINC\d{3,}\b/i);
  return match?.[0]?.toUpperCase() ?? null;
}

function isIncidentNavigationRequest(query: string): boolean {
  if (isFirstIncidentRequest(query)) return true;
  const incidentNumber = requestedIncidentNumber(query);
  if (!incidentNumber) return false;
  return (
    /\b(open|click|view|show|select)\b/i.test(query) ||
    /\b(this|that|the)\s+incident\b/i.test(query)
  );
}

function isSettingsNavigationRequest(query: string): boolean {
  return /\b(open|go\s+to|navigate\s+to|view|show|click)\b[\s\S]{0,40}\b(settings|preferences)\b/i.test(
    query,
  );
}

function isSafeNavigationRequest(query: string): boolean {
  return /\b(open|go\s+to|navigate(?:\s+to)?|take\s+me\s+to|bring\s+me\s+to|view|show|click(?:\s+on)?|select|access|check|inspect|review|unlock|release|clear|reset|request|override|focus|enter|fill)\b/i.test(
    query,
  );
}

function isScrollRequest(query: string): boolean {
  if (
    /^\s*(?:go\s+to|open|navigate\s+to|switch\s+to|click\s+on|click)\b/i.test(
      query,
    )
  ) {
    return false;
  }
  return (
    /\bscroll(?:\s+(?:down|up))?(?:\s+to)?\b/i.test(query) ||
    /\b(?:move|go)\s+(?:down|up)\b/i.test(query)
  );
}

function getEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: a.length + 1 }, (_, i) => i);

  for (let j = 1; j <= b.length; j++) {
    const currentRow: number[] = [j];
    for (let i = 1; i <= a.length; i++) {
      const prev = previousRow[i - 1] ?? 0;
      const up = previousRow[i] ?? 0;
      const left = currentRow[i - 1] ?? 0;
      const cost = b.charCodeAt(j - 1) === a.charCodeAt(i - 1) ? 0 : 1;
      currentRow.push(Math.min(prev + cost, up + 1, left + 1));
    }
    previousRow = currentRow;
  }

  return previousRow[a.length] ?? b.length;
}

function queryMentionsControl(query: string, controlName: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const normalizedName = controlName.toLowerCase().trim();
  const navigationWords = new Set([
    "open",
    "go",
    "to",
    "navigate",
    "view",
    "show",
    "click",
    "select",
    "page",
    "tab",
    "for",
    "me",
    "the",
    "a",
    "an",
    "and",
    "then",
    "or",
    "with",
    "in",
    "on",
    "at",
    "by",
    "from",
    "out",
    "off",
    "over",
    "under",
    "it",
  ]);
  const requestedWords = normalizedQuery
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !navigationWords.has(word));
  const controlWords = normalizedName
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !navigationWords.has(word));

  if (normalizedQuery.includes(normalizedName)) return true;

  for (const reqWord of requestedWords) {
    for (const ctrlWord of controlWords) {
      const dist = getEditDistance(reqWord, ctrlWord);
      const maxLen = Math.max(reqWord.length, ctrlWord.length);
      const maxAllowedDist = maxLen >= 6 ? 2 : maxLen >= 4 ? 1 : 0;
      if (dist <= maxAllowedDist) {
        return true;
      }
    }
  }
  return false;
}

export function registerControlRoutes(
  app: FastifyInstance,
  dependencies: ControlRouteDependencies,
) {
  const control = new ControlService(dependencies.sessions);
  const actionAssistant = new LlmService(dependencies.actionLlmProvider);

  function observationSummary(
    observation: NonNullable<ReturnType<SessionStore["latestObservation"]>>,
  ): string {
    return [
      observation.application
        ? `Application: ${observation.application}`
        : null,
      observation.pageTitle ? `Page title: ${observation.pageTitle}` : null,
      observation.screenState ? `State: ${observation.screenState}` : null,
      ...observation.visibleText
        .slice(0, 30)
        .map((text) => `Visible text: ${text.slice(0, 400)}`),
    ]
      .filter(Boolean)
      .join(". ");
  }

function extractPlanStepsFromQuery(
  query: string,
  observation: SanitizedObservation,
): Array<{
  actionType: GovernedBrowserAction;
  controlName: string;
  controlRole: string;
  purpose: string;
}> {
  const parts = query
    .split(/\s+(?:and(?:\s+then)?|then)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length <= 1) return [];

  const steps: Array<{
    actionType: GovernedBrowserAction;
    controlName: string;
    controlRole: string;
    purpose: string;
  }> = [];

  for (const part of parts) {
    const matches = observation.controls.filter((candidate) => {
      const normPart = part.toLowerCase();
      const normName = candidate.name.toLowerCase().trim();
      return (
        (normPart.includes(normName) || queryMentionsControl(part, candidate.name)) &&
        (isPotentiallyLowRiskAction("CLICK_ELEMENT", candidate) ||
          isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", candidate))
      );
    });

    if (matches.length > 0) {
      const sorted = [...matches].sort((a, b) => b.name.length - a.name.length);
      const chosen = sorted[0]!;
      const isScroll =
        chosen.role.toLowerCase() === "heading" ||
        chosen.role.toLowerCase() === "region" ||
        /\b(?:scroll|view|show)\b/i.test(part);
      const actionType = isScroll ? ("SCROLL_TO_ELEMENT" as const) : ("CLICK_ELEMENT" as const);
      steps.push({
        actionType,
        controlName: chosen.name,
        controlRole: chosen.role,
        purpose: `${isScroll ? "Scroll to" : "Click"} ${chosen.name} from the current page after your approval.`,
      });
    }
  }

  return steps;
}

  app.post(
    "/v1/support-sessions/:sessionId/action-suggestions",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      dependencies.sessions.assertActive(session);
      const input = actionSuggestionSchema.parse(request.body);
      const observation = dependencies.sessions.latestObservation(session.id);
      if (!observation) {
        throw new DomainError(
          "observation_required",
          "A current sanitized observation is required before AI can suggest an action.",
          409,
        );
      }

      const sendPlan = (
        rawSteps: Array<{
          id?: string;
          actionType: GovernedBrowserAction;
          controlName: string;
          controlRole: string;
          purpose: string;
          expectedText?: string | null;
          grounded?: boolean;
        }>,
        explanation: string,
        reason: string,
        actorId = "deterministic-action-proposer",
        investigativeQuery?: string | null,
        destinationDescription?: string | null,
      ) => {
        let truncated = false;
        let warning: string | null = null;
        let stepsToUse = rawSteps;

        if (stepsToUse.length > MAX_RESOLUTION_PLAN_STEPS) {
          stepsToUse = stepsToUse.slice(0, MAX_RESOLUTION_PLAN_STEPS);
          truncated = true;
          warning = `Plan capped at maximum ${MAX_RESOLUTION_PLAN_STEPS} steps for safety.`;
        }

        const isDiscovery = Boolean(input.discoveryPlanId);
        const planId = input.discoveryPlanId ?? `plan_${randomUUID()}`;
        const steps: ResolutionPlanStep[] = stepsToUse.map((s, idx) => ({
          id: s.id ?? `step_${idx + 1}_${randomUUID()}`,
          actionType: s.actionType,
          controlName: s.controlName,
          controlRole: s.controlRole,
          purpose: s.purpose,
          expectedText: s.expectedText ?? null,
          grounded: s.grounded ?? true,
        }));

        const plan: ResolutionPlan = {
          planId,
          steps,
          explanation,
          truncated,
          warning,
          investigativeQuery: investigativeQuery ?? null,
          destinationDescription: destinationDescription ?? null,
        };

        const firstStep = steps[0];
        const proposal = firstStep
          ? {
              callId: firstStep.id,
              controlName: firstStep.controlName,
              controlRole: firstStep.controlRole,
              actionType: firstStep.actionType,
              purpose: firstStep.purpose,
            }
          : null;

        if (isDiscovery) {
          dependencies.audit.append({
            tenantId: session.tenantId,
            sessionId: session.id,
            actorType: "ai",
            actorId,
            eventType: "PLAN_STEP_DISCOVERED",
            eventPayload: {
              planId: plan.planId,
              stepCount: plan.steps.length,
              steps: plan.steps,
              explanation: plan.explanation,
              truncated: plan.truncated,
              trigger: input.trigger,
              observationId: observation.id,
              pageFingerprint: observation.pageFingerprint,
            },
          });
        } else {
          dependencies.audit.append({
            tenantId: session.tenantId,
            sessionId: session.id,
            actorType: "ai",
            actorId,
            eventType: "PLAN_PROPOSED",
            eventPayload: {
              planId: plan.planId,
              stepCount: plan.steps.length,
              steps: plan.steps,
              explanation: plan.explanation,
              truncated: plan.truncated,
              trigger: input.trigger,
              observationId: observation.id,
              pageFingerprint: observation.pageFingerprint,
            },
          });

          if (proposal) {
            dependencies.audit.append({
              tenantId: session.tenantId,
              sessionId: session.id,
              actorType: "ai",
              actorId,
              eventType: "MODEL_ACTION_PROPOSED",
              eventPayload: {
                ...proposal,
                planId: plan.planId,
                approvedViaPlanId: plan.planId,
                trigger: input.trigger,
                observationId: observation.id,
                pageFingerprint: observation.pageFingerprint,
              },
            });
          }
        }

        return reply.status(201).send({
          plan,
          proposal,
          reason,
        });
      };

      // Check if user specifically requested an action or targeted a control on the page
      // that is blocked by security policy (e.g. Reset, Delete, Submit, Pay, etc.)
      const cleanedTarget = input.query
        .replace(
          /^\s*(?:how\s+do\s+i\s+)?(?:can\s+you\s+)?(?:open|go\s+to|navigate(?:\s+to)?|take\s+me\s+to|bring\s+me\s+to|view|show|click(?:\s+on)?|select|access|check|inspect|unlock|release|clear|reset|request|override|focus|enter|fill)\s+(?:an?\s+)?(?:the\s+)?/i,
          "",
        )
        .trim()
        .toLowerCase();

      const blockedControlCandidate = observation.controls.find((candidate) => {
        const normName = candidate.name.toLowerCase().trim();
        const matchesTarget =
          (cleanedTarget.length >= 3 && (normName === cleanedTarget || normName.includes(cleanedTarget) || cleanedTarget.includes(normName))) ||
          (queryMentionsControl(input.query, candidate.name) && isHigherRiskActionIntent(input.query)) ||
          (normName === "reset" && /\breset\b/i.test(input.query));
        if (!matchesTarget) return false;
        return isHigherRiskControlName(candidate.name);
      });

      if (blockedControlCandidate) {
        const explanation = `The "${blockedControlCandidate.name}" action is classified as a higher-risk control by security policy and cannot be executed automatically by RemoteAssist. Please perform this action manually on the page.`;
        dependencies.audit.append({
          tenantId: session.tenantId,
          sessionId: session.id,
          actorType: "ai",
          actorId: "security-policy-guard",
          eventType: "MODEL_ACTION_BLOCKED_BY_POLICY",
          eventPayload: {
            controlName: blockedControlCandidate.name,
            controlRole: blockedControlCandidate.role,
            reason: "higher_risk_policy_restriction",
            query: input.query,
            observationId: observation.id,
            pageFingerprint: observation.pageFingerprint,
          },
        });

        return reply.status(200).send({
          plan: {
            planId: `policy_block_${randomUUID()}`,
            steps: [],
            explanation,
            truncated: false,
            warning: `High-risk action blocked: RemoteAssist security policy restricts automated execution of "${blockedControlCandidate.name}".`,
            blockedByPolicy: true,
            blockedReason: "higher_risk_policy_restriction",
            blockedControlName: blockedControlCandidate.name,
            blockedControlRole: blockedControlCandidate.role,
          },
          proposal: null,
          reason: "action_risk_not_low",
        });
      }

      if (isInvestigativeQuery(input.query)) {
        // If the query asks to unlock, release, or clear the lock on a record:
        // and an unlock/lock clearance control is present on the current screen:
        // Prioritize clicking the unlock control to fulfill the user's resolution request!
        if (/\b(?:unlock|release\s+lock|clear\s+lock)\b/i.test(input.query)) {
          const unlockControls = observation.controls.filter(
            (c) =>
              isPotentiallyLowRiskAction("CLICK_ELEMENT", c) &&
              /\b(?:unlock|simulate\s+lock\s+clearance|release\s+lock)\b/i.test(
                c.name,
              ),
          );
          const preferredUnlock =
            unlockControls.find(
              (c) => c.name.toLowerCase().trim() === "unlock",
            ) ??
            unlockControls[0] ??
            null;

          if (preferredUnlock) {
            const isExactUnlock =
              preferredUnlock.name.toLowerCase().trim() === "unlock";
            const purpose = isExactUnlock
              ? `Click Unlock to clear the record edit lock after your approval.`
              : `Click ${preferredUnlock.name} to release the record lock after your approval.`;
            const explanation = isExactUnlock
              ? `Click Unlock on the record row to release the edit lock.`
              : `Click ${preferredUnlock.name} to release the edit lock on the active record.`;
            return sendPlan(
              [
                {
                  id: `investigative_unlock_${randomUUID()}`,
                  controlName: preferredUnlock.name,
                  controlRole: preferredUnlock.role,
                  actionType: "CLICK_ELEMENT",
                  purpose,
                  grounded: true,
                },
              ],
              explanation,
              "investigative_navigation",
              "deterministic-action-proposer",
              input.query,
              preferredUnlock.name,
            );
          }
        }

        const alertControl = observation.controls.find(
          (c) =>
            (c.role === "alert" || c.role === "status") &&
            isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", c),
        );
        const asksForSpecificRecord =
          /\b(?:\w+\s+)?(?:#|\b)\d{4,}\b/i.test(input.query) ||
          /\b(?:search|filter|find)\b/i.test(input.query);
        if (alertControl && !asksForSpecificRecord) {
          const purpose = `Scroll to ${alertControl.name} to inspect the active notification after your approval.`;
          const explanation = `Scroll to ${alertControl.name} so you can review the active message details on this page.`;
          return sendPlan(
            [
              {
                id: `investigative_alert_${randomUUID()}`,
                controlName: alertControl.name,
                controlRole: alertControl.role,
                actionType: "SCROLL_TO_ELEMENT",
                purpose,
                grounded: true,
              },
            ],
            explanation,
            "investigative_alert",
            "deterministic-action-proposer",
            input.query,
            alertControl.name,
          );
        }

        const relevantFallback = ENTERPRISE_DOMAIN_NAVIGATION_FALLBACKS.find((fb) =>
          fb.keywords.some((kw) => input.query.toLowerCase().includes(kw)),
        );
        const domainSearchKeywords = relevantFallback
          ? [
              ...relevantFallback.destinationSearchKeywords,
              relevantFallback.domainName.toLowerCase(),
            ]
          : ["search", "filter", "find"];

        const searchInput = findGroundedSearchInput(
          observation.controls,
          domainSearchKeywords,
        );

        const groundedMatch = findGroundedPlausibleControl(
          input.query,
          observation.controls,
        );

        const searchMatchesDomain =
          searchInput &&
          domainSearchKeywords.some((kw) =>
            searchInput.name.toLowerCase().includes(kw),
          );

        // If the current screen already has a domain-relevant search input (e.g. "Search Purchase Orders"),
        // or if a search input exists and the only navigation candidate is a top-level tab we are already under:
        // Prioritize directly focusing the search input!
        if (
          searchInput &&
          (searchMatchesDomain ||
            !groundedMatch ||
            groundedMatch.control.role.toLowerCase() === "tab")
        ) {
          const purpose = `Focus ${searchInput.name} on the current page to inspect the record after your approval.`;
          const explanation = `Focus ${searchInput.name} so you can locate and inspect the requested record on this page.`;
          return sendPlan(
            [
              {
                id: `investigative_focus_${randomUUID()}`,
                controlName: searchInput.name,
                controlRole: searchInput.role,
                actionType: "FOCUS_ELEMENT",
                purpose,
                grounded: true,
              },
            ],
            explanation,
            "investigative_navigation",
            "deterministic-action-proposer",
            input.query,
            searchInput.name,
          );
        }

        if (groundedMatch) {
          const { control, destination } = groundedMatch;
          const purpose = `Navigate to ${control.name} from the current page after your approval.`;
          const explanation = `Navigate to ${control.name} to reach ${destination} — once there, you can inspect the requested record.`;
          return sendPlan(
            [
              {
                id: `investigative_step_1_${randomUUID()}`,
                controlName: control.name,
                controlRole: control.role,
                actionType: "CLICK_ELEMENT",
                purpose,
                grounded: true,
              },
            ],
            explanation,
            "investigative_navigation",
            "deterministic-action-proposer",
            input.query,
            destination,
          );
        }

        if (searchInput) {
          const purpose = `Focus ${searchInput.name} so you can search for the requested record.`;
          const explanation = `Focus the search input so you can search for the requested record.`;
          return sendPlan(
            [
              {
                id: `investigative_focus_${randomUUID()}`,
                controlName: searchInput.name,
                controlRole: searchInput.role,
                actionType: "FOCUS_ELEMENT",
                purpose,
                grounded: true,
              },
            ],
            explanation,
            "investigative_navigation",
            "deterministic-action-proposer",
            input.query,
            searchInput.name,
          );
        }

        return reply.status(200).send({
          plan: null,
          proposal: null,
          reason: "no_plausible_navigation",
        });
      }

      const compoundSteps = extractPlanStepsFromQuery(input.query, observation);
      if (compoundSteps.length >= 2) {
        return sendPlan(
          compoundSteps,
          `Multi-step plan to execute ${compoundSteps.length} actions requested by user`,
          "compound_query",
        );
      }

      const eligibleControls = observation.controls
        .map((controlCandidate) => ({
          name: controlCandidate.name,
          role: controlCandidate.role,
          actions: governedActionsForControl(controlCandidate),
        }))
        .filter((controlCandidate) => controlCandidate.actions.length > 0)
        .slice(0, 50);

      if (isIncidentNavigationRequest(input.query)) {
        const incidentNumber = requestedIncidentNumber(input.query);
        const incidentControl = observation.controls.find((candidate) => {
          const observedNumber = observedIncidentNumber(candidate.name);
          return (
            candidate.role.toLowerCase() === "link" &&
            observedNumber !== null &&
            (!incidentNumber || observedNumber === incidentNumber) &&
            isPotentiallyLowRiskAction("CLICK_ELEMENT", candidate)
          );
        });
        if (incidentControl) {
          const purpose = incidentNumber
            ? `Open incident ${incidentControl.name} in the current list.`
            : "Open the first visible incident in the current list.";
          return sendPlan(
            [
              {
                id: `incident_navigation_${randomUUID()}`,
                controlName: incidentControl.name,
                controlRole: incidentControl.role,
                actionType: "CLICK_ELEMENT",
                purpose,
              },
            ],
            purpose,
            incidentNumber ? "incident_link" : "first_incident_link",
          );
        }
      }

      if (isScrollRequest(input.query)) {
        const exactMatches = observation.controls.filter((candidate) => {
          const normalizedQuery = input.query.toLowerCase();
          const normalizedName = candidate.name.toLowerCase().trim();
          return (
            (normalizedQuery.includes(normalizedName) ||
              normalizedName.includes(normalizedQuery)) &&
            isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", candidate)
          );
        });

        let scrollControl = exactMatches.length === 1 ? exactMatches[0] : null;
        if (!scrollControl) {
          const matches = observation.controls.filter(
            (candidate) =>
              queryMentionsControl(input.query, candidate.name) &&
              isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", candidate),
          );
          if (matches.length === 1) {
            scrollControl = matches[0]!;
          }
        }

        if (!scrollControl && observation.controls.length > 0) {
          const scrollableControls = observation.controls.filter((c) =>
            isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", c),
          );
          if (scrollableControls.length > 0) {
            const sorted = [...scrollableControls].sort(
              (a, b) => b.rectangle.y - a.rectangle.y,
            );
            scrollControl = sorted[0]!;
          }
        }

        if (scrollControl) {
          const purpose = `Scroll to ${scrollControl.name} in the current page after your approval.`;
          return sendPlan(
            [
              {
                id: `scroll_navigation_${randomUUID()}`,
                controlName: scrollControl.name,
                controlRole: scrollControl.role,
                actionType: "SCROLL_TO_ELEMENT",
                purpose,
              },
            ],
            purpose,
            "scroll_target",
          );
        }
      }

      if (isSettingsNavigationRequest(input.query)) {
        const exactMatches = observation.controls.filter((candidate) => {
          const normalizedQuery = input.query.toLowerCase();
          const normalizedName = candidate.name.toLowerCase().trim();
          return (
            ["link", "button"].includes(candidate.role.toLowerCase()) &&
            (normalizedQuery.includes(normalizedName) ||
              normalizedName.includes(normalizedQuery)) &&
            observedSafeNavigationName(candidate.name) !== null &&
            isPotentiallyLowRiskAction("CLICK_ELEMENT", candidate)
          );
        });

        let settingsControl =
          exactMatches.length === 1 ? exactMatches[0] : null;
        if (!settingsControl) {
          const matches = observation.controls.filter(
            (candidate) =>
              ["link", "button"].includes(candidate.role.toLowerCase()) &&
              queryMentionsControl(input.query, candidate.name) &&
              observedSafeNavigationName(candidate.name) !== null &&
              isPotentiallyLowRiskAction("CLICK_ELEMENT", candidate),
          );
          if (matches.length === 1) {
            settingsControl = matches[0]!;
          }
        }

        if (settingsControl) {
          const purpose = `Open ${settingsControl.name} in the current page.`;
          return sendPlan(
            [
              {
                id: `settings_navigation_${randomUUID()}`,
                controlName: settingsControl.name,
                controlRole: settingsControl.role,
                actionType: "CLICK_ELEMENT",
                purpose,
              },
            ],
            purpose,
            "settings_navigation",
          );
        }
      }

      if (isSafeNavigationRequest(input.query)) {
        const cleanedTarget = input.query
          .replace(
            /^\s*(?:how\s+do\s+i\s+)?(?:can\s+you\s+)?(?:open|go\s+to|navigate(?:\s+to)?|take\s+me\s+to|bring\s+me\s+to|view|show|click(?:\s+on)?|select|access|check|inspect|review|unlock|release|clear|reset|request|override|focus|enter|fill)\s+(?:an?\s+)?(?:the\s+)?/i,
            "",
          )
          .trim()
          .toLowerCase();

        const isFocusQuery =
          /\b(?:focus|enter|type|fill|input|provide)\b/i.test(input.query) &&
          !/\b(?:reset|clear)\b/i.test(input.query);
        const isScrollQuery = /\b(?:scroll|view|show)\b/i.test(input.query);

        const scored = observation.controls
          .map((candidate) => {
            const role = candidate.role.toLowerCase();
            const isTextbox = ["textbox", "combobox", "searchbox"].includes(role);
            const isAlert = ["alert", "status", "region", "heading"].includes(role);

            let actionType: GovernedBrowserAction;
            if (isFocusQuery && isTextbox) {
              actionType = "FOCUS_ELEMENT";
            } else if (isAlert || (isScrollQuery && !["button", "link", "tab"].includes(role))) {
              actionType = "SCROLL_TO_ELEMENT";
            } else if (isTextbox && !isPotentiallyLowRiskAction("CLICK_ELEMENT", candidate)) {
              actionType = "FOCUS_ELEMENT";
            } else {
              actionType = "CLICK_ELEMENT";
            }

            if (!isPotentiallyLowRiskAction(actionType, candidate)) {
              return null;
            }

            const name = candidate.name.toLowerCase().trim();
            let score = 0;
            if (/\b(?:unlock|release\s+lock|clear\s+lock)\b/i.test(input.query)) {
              if (name === "unlock") {
                score = 150;
              } else if (/\b(?:unlock|simulate\s+lock\s+clearance|release\s+lock)\b/i.test(name)) {
                score = 120;
              }
            }
            if (/\b(?:reset|clear\s+form|reset\s+form)\b/i.test(input.query)) {
              if (name === "reset" || name === "reset form") {
                score = 150;
              } else if (/\b(?:reset|clear\s+form)\b/i.test(name)) {
                score = 120;
              }
            }
            if (score === 0) {
              if (name === cleanedTarget) {
                score = 100;
              } else if (name.startsWith(cleanedTarget) || cleanedTarget.startsWith(name)) {
                score = 80;
              } else if (name.includes(cleanedTarget)) {
                score = 60;
              } else if (cleanedTarget.includes(name)) {
                score = 50;
              } else if (queryMentionsControl(input.query, candidate.name)) {
                const stopWords = new Set(["how", "can", "you", "the", "for", "this", "that", "and", "with", "please", "help"]);
                const queryWords = input.query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
                const ctrlWords = name.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
                const overlap = queryWords.filter((w) => ctrlWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
                score = overlap * 10;
                if (actionType === "CLICK_ELEMENT" && ["button", "link"].includes(role)) {
                  score += 5;
                }
              }
            }
            return score > 0 ? { candidate, actionType, score } : null;
          })
          .filter((item): item is { candidate: SafeControl; actionType: GovernedBrowserAction; score: number } => item !== null)
          .sort((a, b) => b.score - a.score);

        let navigationTarget: { candidate: SafeControl; actionType: GovernedBrowserAction } | null = null;
        if (scored.length > 0) {
          const top = scored[0]!;
          if (scored.length === 1 || top.score > (scored[1]?.score ?? 0)) {
            navigationTarget = top;
          }
        }

        if (navigationTarget) {
          const navigationControl = navigationTarget.candidate;
          const actionType = navigationTarget.actionType;
          const isUnlockAction = /\b(?:unlock|release\s+lock|clear\s+lock)\b/i.test(input.query);
          const isResetAction = /\b(?:reset|clear\s+form|reset\s+form)\b/i.test(input.query);
          const actionVerb =
            actionType === "SCROLL_TO_ELEMENT"
              ? "Scroll to"
              : actionType === "FOCUS_ELEMENT"
                ? "Focus"
                : "Click";
          const purpose = isUnlockAction
            ? `Click ${navigationControl.name} to release the lock on the record after your approval.`
            : isResetAction
              ? `Click ${navigationControl.name} to reset the form after your approval.`
              : `${actionVerb} ${navigationControl.name} from the current page after your approval.`;
          const explanation = isUnlockAction
            ? `Click ${navigationControl.name} to release the lock so the record can be viewed, edited, or approved.`
            : isResetAction
              ? `Click ${navigationControl.name} to reset form fields and clear active validation messages.`
              : purpose;
          return sendPlan(
            [
              {
                id: `safe_navigation_${randomUUID()}`,
                controlName: navigationControl.name,
                controlRole: navigationControl.role,
                actionType,
                purpose,
              },
            ],
            explanation,
            isUnlockAction ? "unlock_action" : "explicit_navigation",
          );
        }

        const requestedName = input.query
          .replace(
            /^\s*(?:go\s+to|open|navigate\s+to|view|show|click\s+on|click)\s+/i,
            "",
          )
          .trim();

        if (
          !navigationTarget &&
          scored.length === 0 &&
          requestedName.length > 0 &&
          !/^(?:it|that|this|there|here)$/i.test(requestedName) &&
          !isHigherRiskActionIntent(input.query) &&
          observation.controls.length > 0
        ) {
          const inNextViewport = observation.controls
            .filter((c) => c.rectangle.y >= 350 && c.rectangle.y <= 950)
            .sort((a, b) => b.rectangle.y - a.rectangle.y);
          const sortedByYAsc = [...observation.controls].sort(
            (a, b) => a.rectangle.y - b.rectangle.y,
          );
          const scrollTarget =
            inNextViewport[0] ??
            sortedByYAsc[Math.min(sortedByYAsc.length - 1, 5)] ??
            sortedByYAsc[0] ??
            null;
          if (scrollTarget) {
            const purpose = `Scroll down to reveal ${requestedName} after your approval.`;
            return sendPlan(
              [
                {
                  id: `scroll_to_reveal_${randomUUID()}`,
                  controlName: scrollTarget.name,
                  controlRole: scrollTarget.role,
                  actionType: "SCROLL_TO_ELEMENT",
                  purpose,
                },
              ],
              purpose,
              "scroll_to_reveal",
            );
          }
        }
      }

      if (isHigherRiskActionIntent(input.query) || eligibleControls.length === 0) {
        return {
          plan: null,
          proposal: null,
          reason: isHigherRiskActionIntent(input.query)
            ? "action_risk_not_low"
            : "no_eligible_controls",
        };
      }

      const conversationContext = input.conversation_history
        .map((turn) => `${turn.sender}: ${turn.text}`)
        .join("\n");
      const queryWithMemory = [
        conversationContext
          ? `Recent conversation:\n${conversationContext}`
          : "",
        input.query ? `Current request: ${input.query}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const suggestion = await actionAssistant.generateActionProposal(
        queryWithMemory,
        observationSummary(observation),
        eligibleControls,
      );
      if (!suggestion) {
        return { plan: null, proposal: null, reason: "no_clear_action" };
      }

      if (suggestion.steps && suggestion.steps.length > 0) {
        const validSteps: Array<{
          id?: string;
          actionType: GovernedBrowserAction;
          controlName: string;
          controlRole: string;
          purpose: string;
        }> = [];

        for (const s of suggestion.steps) {
          const matching = observation.controls.find(
            (c) =>
              c.name.toLowerCase() === s.controlName.toLowerCase() &&
              isPotentiallyLowRiskAction(s.actionType, c),
          );
          validSteps.push({
            id: `vertex_${randomUUID()}`,
            controlName: matching ? matching.name : s.controlName,
            controlRole: matching ? matching.role : (s.controlRole ?? "button"),
            actionType: s.actionType,
            purpose: s.purpose,
          });
        }

        if (validSteps.length > 0) {
          return sendPlan(
            validSteps,
            suggestion.explanation ?? suggestion.purpose,
            "suggested",
            "vertex-action-proposer",
          );
        }
      }

      const matchingControls = observation.controls.filter(
        (candidate) =>
          candidate.name === suggestion.controlName &&
          isPotentiallyLowRiskAction(suggestion.actionType, candidate),
      );
      const controlCandidate =
        matchingControls.length === 1 ? matchingControls[0] : null;
      if (!controlCandidate) {
        return { plan: null, proposal: null, reason: "model_choice_not_current_safe" };
      }

      return sendPlan(
        [
          {
            id: `vertex_${randomUUID()}`,
            controlName: controlCandidate.name,
            controlRole: controlCandidate.role,
            actionType: suggestion.actionType,
            purpose: suggestion.purpose,
          },
        ],
        suggestion.explanation ?? suggestion.purpose,
        "suggested",
        "vertex-action-proposer",
      );
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/realtime-action-proposals",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      dependencies.sessions.assertActive(session);
      const input = realtimeActionProposalSchema.parse(request.body);
      const observation = dependencies.sessions.latestObservation(session.id);
      const matchingControls =
        observation?.controls.filter(
          (candidate) =>
            candidate.name === input.control_name &&
            candidate.role === input.control_role,
        ) ?? [];
      const controlCandidate =
        matchingControls.length === 1 ? matchingControls[0] : null;
      if (
        !observation ||
        !controlCandidate ||
        !isPotentiallyLowRiskAction(input.action_type, controlCandidate)
      ) {
        throw new DomainError(
          "model_action_proposal_rejected",
          "The model proposal did not match a current observed low-risk control.",
          403,
        );
      }

      const proposal = {
        callId: input.call_id,
        controlName: controlCandidate.name,
        controlRole: controlCandidate.role,
        actionType: input.action_type,
        purpose: input.purpose.trim(),
      };
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "ai",
        actorId: "openai-realtime",
        eventType: "MODEL_ACTION_PROPOSED",
        eventPayload: {
          ...proposal,
          observationId: observation.id,
          pageFingerprint: observation.pageFingerprint,
        },
      });
      return reply.status(201).send({ proposal });
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/plans/:planId/approve",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId, planId } = request.params as {
        sessionId: string;
        planId: string;
      };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      dependencies.sessions.assertActive(session);
      const body = (request.body ?? {}) as {
        stepCount?: number;
        origin?: string;
      };
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "user",
        actorId: actor.userId,
        eventType: "PLAN_APPROVED_BY_USER",
        eventPayload: {
          planId,
          stepCount: body.stepCount ?? 1,
          origin: body.origin ?? session.entryOrigin,
          sessionRevision: session.revision,
        },
      });
      return reply.status(200).send({ ok: true });
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/plans/:planId/result",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId, planId } = request.params as {
        sessionId: string;
        planId: string;
      };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const body = (request.body ?? {}) as {
        status: "completed" | "aborted" | "failed";
        totalSteps: number;
        completedSteps: number;
        reason?: string;
        failedStepIndex?: number;
      };
      const eventType =
        body.status === "completed" ? "PLAN_COMPLETED" : "PLAN_ABORTED";
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "extension",
        actorId: "deterministic-browser-executor",
        eventType,
        eventPayload: {
          planId,
          totalSteps: body.totalSteps,
          completedSteps: body.completedSteps,
          status: body.status,
          reason: body.reason,
          failedStepIndex: body.failedStepIndex,
        },
      });
      return reply.status(200).send({ ok: true });
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/commands/propose",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const input = proposeObservedCommandSchema.parse(request.body);
      const command = control.propose(
        session,
        dependencies.sessions.latestObservation(session.id),
        input,
      );
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: command.controller,
        actorId:
          command.controller === "ai"
            ? "browser-action-proposer"
            : actor.userId,
        eventType: "COMMAND_PROPOSED",
        eventPayload: {
          commandId: command.command_id,
          type: command.type,
          targetRole: command.target.role,
          targetName: command.target.name,
          origin: command.expected_page.origin,
          risk: command.risk,
          expiresAt: command.expires_at,
          planId: command.plan_id ?? undefined,
          approvedViaPlanId: command.plan_id ?? undefined,
          stepIndex: command.step_index ?? undefined,
        },
      });
      return reply.status(201).send({ command });
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/commands/:commandId/approve",
    async (request) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId, commandId } = request.params as {
        sessionId: string;
        commandId: string;
      };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const body = (request.body ?? {}) as {
        planId?: string;
        stepIndex?: number;
      };
      const command = control.approve(session, commandId);
      const planId = body.planId ?? command.plan_id;
      const stepIndex = body.stepIndex ?? command.step_index ?? 0;
      const eventType = planId
        ? (stepIndex === 0
            ? "COMMAND_APPROVED_UNDER_PLAN"
            : "COMMAND_AUTO_APPROVED_UNDER_PLAN")
        : "COMMAND_APPROVED_ALLOW_ONCE";

      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: planId && stepIndex > 0 ? "system" : "user",
        actorId: actor.userId,
        eventType,
        eventPayload: {
          commandId,
          sessionRevision: command.session_revision,
          planId: planId ?? undefined,
          approvedViaPlanId: planId ?? undefined,
          stepIndex: planId ? stepIndex : undefined,
        },
      });
      return { command };
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/commands/:commandId/authorize",
    async (request) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId, commandId } = request.params as {
        sessionId: string;
        commandId: string;
      };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const command = control.authorize(session, commandId);
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "system",
        actorId: "policy-gateway",
        eventType: "COMMAND_AUTHORIZED",
        eventPayload: {
          commandId,
          sessionRevision: command.session_revision,
          planId: command.plan_id ?? undefined,
          approvedViaPlanId: command.plan_id ?? undefined,
          stepIndex: command.step_index ?? undefined,
        },
      });
      return { command };
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/commands/:commandId/result",
    async (request) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId, commandId } = request.params as {
        sessionId: string;
        commandId: string;
      };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const result = commandResultSchema.parse(request.body);
      const command = control.recordResult(session, commandId, result);
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "extension",
        actorId: "deterministic-browser-executor",
        eventType: "COMMAND_RESULT_RECORDED",
        eventPayload: {
          commandId,
          status: result.status,
          pageChanged: result.result.page_changed,
          verificationResult: result.result.verification_result,
          failureCode: result.result.failure_code,
          planId: command.plan_id ?? undefined,
          approvedViaPlanId: command.plan_id ?? undefined,
          stepIndex: command.step_index ?? undefined,
        },
      });
      return { command, session, result };
    },
  );

  app.get("/v1/support-sessions/:sessionId/commands", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { sessionId } = request.params as { sessionId: string };
    const session = dependencies.sessions.getAuthorized(sessionId, actor);
    return { commands: control.list(session) };
  });
}
