import { useEffect, useRef, useState } from "react";
import "./control.css";
import type { ControlCommand } from "@remoteassist/command-schema";
import type {
  ResolutionPlan,
  SanitizedObservation,
} from "@remoteassist/shared-types";
import { MAX_RESOLUTION_PLAN_STEPS } from "@remoteassist/shared-types";
import type { BrowserExecutionResponse } from "../control-executor/execute.js";
import type { BrowserObservationPayload } from "../security/sanitize.js";
import {
  approveCommand,
  approvePlan,
  authorizeCommand,
  grantBrowserControlConsent,
  proposeBrowserAction,
  recordCommandResult,
  recordPlanResult,
  submitObservation,
  suggestBrowserAction,
} from "./api.js";
import { isPotentiallyLowRiskAction } from "@remoteassist/policy-model";
import type { RealtimeActionProposal } from "./realtime-actions.js";

interface ControlPanelProps {
  sessionId: string;
  tabId: number;
  observation: SanitizedObservation;
  plan?: ResolutionPlan;
  proposal?: RealtimeActionProposal;
  onActionCompleted?: (
    observation: SanitizedObservation,
    summary: string,
  ) => void;
  onPlanCompleted?: (
    observation: SanitizedObservation,
    summary: string,
  ) => void;
  onDismiss: () => void;
  onExecutingChange?: (executing: boolean) => void;
}

type ControlState =
  | "offered"
  | "executing"
  | "verified"
  | "blocked"
  | "aborted";

async function extensionMessage<T>(
  message: Record<string, unknown>,
): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T & {
    ok?: boolean;
    error?: string;
  };
  if (response?.ok === false)
    throw new Error(response.error ?? "The extension request failed.");
  return response;
}

export function ControlPanel({
  sessionId,
  tabId,
  observation,
  plan,
  proposal,
  onActionCompleted,
  onPlanCompleted,
  onDismiss,
  onExecutingChange,
}: ControlPanelProps) {
  const activePlan: ResolutionPlan = plan ?? {
    planId: `plan_${proposal?.callId ?? "single"}`,
    steps: proposal
      ? [
          {
            id: proposal.callId,
            actionType: proposal.actionType,
            controlName: proposal.controlName,
            controlRole: proposal.controlRole,
            purpose: proposal.purpose,
          },
        ]
      : [],
    explanation: proposal?.purpose ?? "Proposed browser action",
  };

  const firstStep = activePlan.steps[0];
  const firstStepCandidates = firstStep
    ? observation.controls.filter(
        (control) =>
          control.name.localeCompare(firstStep.controlName, undefined, {
            sensitivity: "accent",
          }) === 0 &&
          isPotentiallyLowRiskAction(firstStep.actionType, control),
      )
    : [];
  const firstStepRoleMatches = firstStep
    ? firstStepCandidates.filter(
        (control) =>
          control.role.toLowerCase() === firstStep.controlRole.toLowerCase(),
      )
    : [];
  const firstStepTarget =
    firstStepRoleMatches.length === 1
      ? firstStepRoleMatches[0]
      : firstStepCandidates.length === 1
        ? firstStepCandidates[0]
        : null;

  const [state, setState] = useState<ControlState>("offered");
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [command, setCommand] = useState<ControlCommand | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRequestedRef = useRef<boolean>(false);

  useEffect(() => {
    onExecutingChange?.(state === "executing");
  }, [state, onExecutingChange]);

  useEffect(() => {
    if (!firstStepTarget) return;

    if (state === "offered") {
      void extensionMessage({
        type: "REMOTEASSIST_HIGHLIGHT_ACTIVE_TAB",
        tabId,
        elementId: firstStepTarget.elementId,
        message:
          "AI proposed this resolution plan. RemoteAssist requires your approval before execution.",
      }).catch(() => undefined);
    } else {
      void extensionMessage({
        type: "REMOTEASSIST_CLEAR_ACTIVE_TAB",
        tabId,
      }).catch(() => undefined);
    }
  }, [state, tabId, firstStepTarget?.elementId]);

  useEffect(() => {
    return () => {
      void extensionMessage({
        type: "REMOTEASSIST_CLEAR_ACTIVE_TAB",
        tabId,
      }).catch(() => undefined);
    };
  }, [tabId]);

  function handleAbort() {
    abortRequestedRef.current = true;
  }

  async function executePlan(): Promise<void> {
    setState("executing");
    abortRequestedRef.current = false;
    setMessage(null);

    await approvePlan(
      sessionId,
      activePlan.planId,
      activePlan.steps.length,
      observation.origin,
    ).catch(() => undefined);
    await grantBrowserControlConsent(sessionId, observation.origin).catch(
      () => undefined,
    );

    let latestObservation = observation;
    let completedCount = 0;

    for (let i = 0; i < activePlan.steps.length; i++) {
      const step = activePlan.steps[i]!;
      setCurrentStepIndex(i);

      // ABORT CHECK 1: Before initiating step
      if (abortRequestedRef.current) {
        setState("aborted");
        const msg = `Plan stopped by user before step ${i + 1} (${step.controlName}). Steps completed: ${completedCount} of ${activePlan.steps.length}.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "aborted",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      // 1. Take a fresh observation of the current page state immediately before this step
      let currentPayload: BrowserObservationPayload;
      try {
        const current = await extensionMessage<{
          ok: boolean;
          observation: BrowserObservationPayload;
        }>({
          type: "REMOTEASSIST_OBSERVE_ACTIVE_TAB",
          tabId,
        });
        if (!current.observation) {
          throw new Error("The current page could not be observed safely.");
        }
        currentPayload = current.observation;
      } catch (err) {
        setState("blocked");
        const msg = `Step ${i + 1} (${step.controlName}) stopped: Current page could not be observed safely.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "failed",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      // 2. Check origin invariance
      if (currentPayload.origin !== observation.origin) {
        setState("blocked");
        const msg = `Step ${i + 1} (${step.controlName}) stopped: Page origin changed from ${observation.origin} to ${currentPayload.origin}.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "failed",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      // 3. Submit fresh observation to server
      const freshObs = await submitObservation(sessionId, currentPayload);
      latestObservation = freshObs;

      // ABORT CHECK 2: After fresh observation, immediately before resolving target and dispatching
      if (abortRequestedRef.current) {
        setState("aborted");
        const msg = `Plan stopped by user before step ${i + 1} (${step.controlName}). Steps completed: ${completedCount} of ${activePlan.steps.length}.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "aborted",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      // 4. Re-resolve target against the FRESH observation
      let candidates = freshObs.controls.filter(
        (c) =>
          c.name.localeCompare(step.controlName, undefined, {
            sensitivity: "accent",
          }) === 0 && isPotentiallyLowRiskAction(step.actionType, c),
      );

      // Fallback matching for enterprise controls (e.g. Fiori tiles with suffix descriptions)
      if (candidates.length === 0) {
        const normTarget = step.controlName.toLowerCase().trim();
        candidates = freshObs.controls
          .filter((c) => {
            if (!isPotentiallyLowRiskAction(step.actionType, c)) return false;
            const normName = c.name.toLowerCase().trim();
            return (
              normName.startsWith(normTarget) ||
              normTarget.startsWith(normName) ||
              normName.includes(normTarget) ||
              normTarget.includes(normName)
            );
          })
          .sort((a, b) => {
            const aName = a.name.toLowerCase().trim();
            const bName = b.name.toLowerCase().trim();
            const aStarts = aName.startsWith(normTarget) ? 1 : 0;
            const bStarts = bName.startsWith(normTarget) ? 1 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;
            return (
              Math.abs(aName.length - normTarget.length) -
              Math.abs(bName.length - normTarget.length)
            );
          });
      }

      const roleMatches = candidates.filter(
        (c) => c.role.toLowerCase() === step.controlRole.toLowerCase(),
      );
      const resolved =
        roleMatches.length === 1
          ? roleMatches[0]
          : candidates.length > 0
            ? candidates[0]
            : null;

      if (!resolved) {
        setState("blocked");
        const msg = `Step ${i + 1} (${step.controlName}) stopped: Target control was not found on the live page.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "failed",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      if (resolved.disabled) {
        setState("blocked");
        const msg = `Step ${i + 1} (${step.controlName}) stopped: Control is currently disabled on the live page.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "failed",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      // 5. Re-run risk gate against live control
      if (!isPotentiallyLowRiskAction(step.actionType, resolved)) {
        setState("blocked");
        const msg = `Step ${i + 1} (${step.controlName}) stopped: Control failed safety policy on the live page.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "failed",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }

      // 6. Propose, approve, authorize, execute, and record result
      try {
        const stepCmd = await proposeBrowserAction(
          sessionId,
          step.actionType,
          resolved.name,
          step.purpose,
          resolved.role,
          step.expectedText ?? null,
          activePlan.planId,
          i,
        );
        setCommand(stepCmd);

        // Step 0 logs COMMAND_APPROVED_UNDER_PLAN; Steps 1..N log COMMAND_AUTO_APPROVED_UNDER_PLAN
        await approveCommand(sessionId, stepCmd.command_id, activePlan.planId, i);
        const authorized = await authorizeCommand(
          sessionId,
          stepCmd.command_id,
        );

        const execution = await extensionMessage<BrowserExecutionResponse>({
          type: "REMOTEASSIST_EXECUTE_ACTIVE_TAB",
          command: authorized,
        });

        await recordCommandResult(
          sessionId,
          authorized.command_id,
          execution.result,
        );

        if (execution.result.status !== "executed") {
          setState("blocked");
          const msg = `Step ${i + 1} (${step.controlName}) failed: ${execution.result.result.failure_code ?? "The action did not complete."}`;
          setMessage(msg);
          await recordPlanResult(
            sessionId,
            activePlan.planId,
            "failed",
            activePlan.steps.length,
            completedCount,
            msg,
            i,
          ).catch(() => undefined);
          return;
        }

        completedCount++;

        // DYNAMIC EXTENSION FOR INVESTIGATIVE NAVIGATION
        if (
          i === activePlan.steps.length - 1 &&
          activePlan.investigativeQuery &&
          step.actionType !== "FOCUS_ELEMENT" &&
          activePlan.steps.length < MAX_RESOLUTION_PLAN_STEPS
        ) {
          // ABORT CHECK: Before discovery
          if (abortRequestedRef.current) {
            setState("aborted");
            const msg = `Plan stopped by user before discovering next step. Steps completed: ${completedCount} of ${activePlan.steps.length}.`;
            setMessage(msg);
            await recordPlanResult(
              sessionId,
              activePlan.planId,
              "aborted",
              activePlan.steps.length,
              completedCount,
              msg,
              i,
            ).catch(() => undefined);
            return;
          }

          // Allow DOM to settle after navigation
          await new Promise((resolve) => setTimeout(resolve, 500));

          // ABORT CHECK: After delay
          if (abortRequestedRef.current) {
            setState("aborted");
            const msg = `Plan stopped by user before discovering next step. Steps completed: ${completedCount} of ${activePlan.steps.length}.`;
            setMessage(msg);
            await recordPlanResult(
              sessionId,
              activePlan.planId,
              "aborted",
              activePlan.steps.length,
              completedCount,
              msg,
              i,
            ).catch(() => undefined);
            return;
          }

          // Observe landing page
          try {
            const landingObs = await extensionMessage<{
              ok: boolean;
              observation: BrowserObservationPayload;
            }>({
              type: "REMOTEASSIST_OBSERVE_ACTIVE_TAB",
              tabId,
            });

            if (landingObs?.observation) {
              // Origin invariance check on landing page
              if (landingObs.observation.origin !== observation.origin) {
                setState("blocked");
                const msg = `Plan stopped: Page origin changed from ${observation.origin} to ${landingObs.observation.origin}.`;
                setMessage(msg);
                await recordPlanResult(
                  sessionId,
                  activePlan.planId,
                  "failed",
                  activePlan.steps.length,
                  completedCount,
                  msg,
                  i,
                ).catch(() => undefined);
                return;
              }

              // Submit landing observation
              const recordedLanding = await submitObservation(
                sessionId,
                landingObs.observation,
              );
              latestObservation = recordedLanding;

              // ABORT CHECK: Before proposing discovered next step
              if (abortRequestedRef.current) {
                setState("aborted");
                const msg = `Plan stopped by user before proposing next step. Steps completed: ${completedCount} of ${activePlan.steps.length}.`;
                setMessage(msg);
                await recordPlanResult(
                  sessionId,
                  activePlan.planId,
                  "aborted",
                  activePlan.steps.length,
                  completedCount,
                  msg,
                  i,
                ).catch(() => undefined);
                return;
              }

              // Discover next grounded step against fresh landing observation
              const nextSuggestion = await suggestBrowserAction(
                sessionId,
                activePlan.investigativeQuery,
                "discovery",
                [],
                activePlan.planId,
              ).catch(() => null);

              if (
                nextSuggestion?.plan?.steps &&
                nextSuggestion.plan.steps.length > 0
              ) {
                const nextStep = nextSuggestion.plan.steps[0]!;
                if (
                  !activePlan.steps.some(
                    (s) =>
                      s.controlName.toLowerCase() ===
                      nextStep.controlName.toLowerCase(),
                  )
                ) {
                  activePlan.steps.push({
                    ...nextStep,
                    id: `step_${activePlan.steps.length + 1}_${Math.random().toString(36).slice(2, 9)}`,
                  });
                }
              }
            }
          } catch {
            // If observation failed, complete safely without guessing
          }
        }

        if (i < activePlan.steps.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      } catch (err) {
        setState("blocked");
        const msg =
          err instanceof Error
            ? err.message
            : `Step ${i + 1} (${step.controlName}) failed execution.`;
        setMessage(msg);
        await recordPlanResult(
          sessionId,
          activePlan.planId,
          "failed",
          activePlan.steps.length,
          completedCount,
          msg,
          i,
        ).catch(() => undefined);
        return;
      }
    }

    setState("verified");
    const summaryMsg = activePlan.investigativeQuery
      ? `I've navigated you to ${activePlan.destinationDescription ?? "the destination area"} — search for your record there and I can help interpret what you see.`
      : `Plan completed successfully: all ${activePlan.steps.length} steps executed and verified.`;
    setMessage(summaryMsg);
    await recordPlanResult(
      sessionId,
      activePlan.planId,
      "completed",
      activePlan.steps.length,
      completedCount,
    ).catch(() => undefined);
    (onPlanCompleted ?? onActionCompleted)?.(latestObservation, summaryMsg);
  }

  if (activePlan.steps.length === 0 && !activePlan.blockedByPolicy) return null;

  if (activePlan.blockedByPolicy) {
    return (
      <section className="card control-card policy-blocked-card" aria-live="polite" style={{ borderLeft: "4px solid #ef4444" }}>
        <div className="control-heading">
          <div>
            <p className="section-label" style={{ color: "#dc2626", fontWeight: 700 }}>
              Security policy restriction
            </p>
            <h2>Action blocked by policy</h2>
          </div>
          <div className="control-chips">
            <span className="risk-chip" style={{ background: "#fee2e2", color: "#b91c1c", fontWeight: 600 }}>
              High risk
            </span>
            <span className="steps-chip" style={{ background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>
              Manual action
            </span>
          </div>
        </div>

        <div
          className="plan-warning-banner"
          role="alert"
          style={{
            background: "#fff1f2",
            color: "#9f1239",
            border: "1px solid #fecdd3",
            borderRadius: "6px",
            padding: "10px 12px",
            marginTop: "12px",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {activePlan.warning ??
            `Automated execution of "${activePlan.blockedControlName || "this control"}" is restricted by security policy.`}
        </div>

        <p className="plan-explanation" style={{ marginTop: "12px", color: "#334155", fontSize: "13px", lineHeight: 1.5 }}>
          {activePlan.explanation}
        </p>

        <p
          className="plan-origin-note"
          style={{
            background: "#f8fafc",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px dashed #cbd5e1",
            marginTop: "10px",
            fontSize: "12px",
            color: "#64748b",
          }}
        >
          To safeguard enterprise records, operations matching higher-risk words (such as reset, delete, or submit) cannot be triggered automatically by RemoteAssist. Please perform this action directly on <strong>{observation.origin}</strong>.
        </p>

        <div className="card-actions-row" style={{ marginTop: "16px" }}>
          <button
            className="secondary-dismiss-btn"
            onClick={onDismiss}
            style={{
              width: "100%",
              padding: "10px",
              background: "#f1f5f9",
              color: "#334155",
              border: "1px solid #cbd5e1",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dismiss (Perform manually on page)
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card control-card" aria-live="polite">
      <div className="control-heading">
        <div>
          <p className="section-label">AI resolution plan</p>
          <h2>
            {state === "verified"
              ? "Resolution plan completed"
              : state === "aborted"
                ? "Plan stopped by user"
                : state === "blocked"
                  ? "Plan stopped safely"
                  : activePlan.steps.length > 1
                    ? "Review multi-step resolution plan"
                    : "Review AI action proposal"}
          </h2>
        </div>
        <div className="control-chips">
          <span className="risk-chip">Low risk</span>
          <span className="steps-chip">
            {activePlan.steps.length}{" "}
            {activePlan.steps.length > 1 ? "steps" : "step"}
          </span>
        </div>
      </div>

      {state === "offered" && (
        <>
          {activePlan.truncated && (
            <div className="plan-warning-banner" role="alert">
              {activePlan.warning ??
                "Plan capped at maximum 5 steps for safety."}
            </div>
          )}
          <p className="plan-explanation">{activePlan.explanation}</p>
          <p className="plan-origin-note">
            RemoteAssist will execute on <strong>{observation.origin}</strong>.
            Every step will be independently re-verified against live page state
            immediately before execution.
          </p>

          <ol className="plan-steps-list">
            {activePlan.steps.map((step, idx) => (
              <li key={step.id || idx} className="plan-step-item">
                <div className="plan-step-header">
                  <span className="plan-step-badge">Step {idx + 1}</span>
                  <span className="action-type-badge">{step.actionType}</span>
                  <strong className="control-target-name">{step.controlName}</strong>
                  <span className="control-role-tag">({step.controlRole})</span>
                </div>
                <p className="step-purpose">{step.purpose}</p>
              </li>
            ))}
          </ol>

          <div className="card-actions-row">
            <button
              className="control-button primary-approval-btn"
              onClick={() => void executePlan()}
            >
              {activePlan.steps.length > 1
                ? `Approve all ${activePlan.steps.length} steps`
                : "Allow once"}
            </button>
            <button
              className="secondary-dismiss-btn"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
          <p className="approval-note">
            {activePlan.steps.length > 1
              ? `Choosing "Approve all ${activePlan.steps.length} steps" grants allow-once control consent for this plan. Every individual step will still be re-verified against live page state immediately before execution.`
              : `Choosing "Allow once" grants one-time control consent for this single action, verified against the live page before execution.`}
          </p>
        </>
      )}

      {state === "executing" && (
        <>
          <div className="execution-status" role="status">
            <span className="spinner" aria-hidden="true" />
            <div>
              <strong>
                Executing step {currentStepIndex + 1} of{" "}
                {activePlan.steps.length}:{" "}
                {activePlan.steps[currentStepIndex]?.controlName}
              </strong>
              <small>
                Re-observing live page, checking policy, and dispatching
                action...
              </small>
            </div>
          </div>

          <ol className="plan-steps-list">
            {activePlan.steps.map((step, idx) => (
              <li
                key={step.id || idx}
                className={`plan-step-item ${idx === currentStepIndex ? "step-active" : idx < currentStepIndex ? "step-done" : "step-pending"}`}
              >
                <div className="plan-step-header">
                  <span className="plan-step-badge">Step {idx + 1}</span>
                  <span className="action-type-badge">{step.actionType}</span>
                  <strong className="control-target-name">{step.controlName}</strong>
                  <span className="control-role-tag">({step.controlRole})</span>
                  <span
                    className={`step-status-tag ${idx === currentStepIndex ? "active" : idx < currentStepIndex ? "done" : "pending"}`}
                  >
                    {idx === currentStepIndex
                      ? "Executing..."
                      : idx < currentStepIndex
                        ? "Done"
                        : "Pending"}
                  </span>
                </div>
                <p className="step-purpose">{step.purpose}</p>
              </li>
            ))}
          </ol>

          <button className="abort-button" onClick={handleAbort}>
            Stop plan execution
          </button>
        </>
      )}

      {state === "verified" && (
        <div className="result-success">
          <strong>Completed</strong>
          <p>{message}</p>
          {command && <small>Last audit command: {command.command_id}</small>}
          <button className="text-button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}

      {state === "aborted" && (
        <div className="result-aborted">
          <strong>Plan Stopped</strong>
          <p>{message}</p>
          <button className="text-button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}

      {state === "blocked" && (
        <div className="result-blocked">
          <strong>Stopped safely</strong>
          <p>{message}</p>
          {command && <small>Last audit command: {command.command_id}</small>}
          <button className="text-button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
