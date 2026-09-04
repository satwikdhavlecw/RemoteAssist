import {
  terminalSessionStatuses,
  type ConsentGrant,
  type ConsentGrantType,
  type SessionStatus,
  type SupportSession,
} from "@remoteassist/shared-types";

export const defaultRestrictedHostPatterns = [
  /(^|\.)paypal\.com$/i,
  /(^|\.)stripe\.com$/i,
  /(^|\.)1password\.com$/i,
  /(^|\.)lastpass\.com$/i,
  /(^|\.)bitwarden\.com$/i,
  /(^|\.)gmail\.com$/i,
  /(^|\.)outlook\.live\.com$/i,
] as const;

const transitions: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  CREATED: ["AUTHENTICATED", "USER_CANCELLED", "CONNECTION_FAILED"],
  AUTHENTICATED: [
    "VOICE_CONNECTED",
    "AWAITING_SCREEN_CONSENT",
    "OBSERVING",
    "USER_CANCELLED",
    "CONNECTION_FAILED",
  ],
  VOICE_CONNECTED: [
    "AWAITING_SCREEN_CONSENT",
    "OBSERVING",
    "USER_CANCELLED",
    "CONNECTION_FAILED",
  ],
  AWAITING_SCREEN_CONSENT: [
    "OBSERVING",
    "USER_CANCELLED",
    "CONSENT_REVOKED",
    "CONNECTION_FAILED",
  ],
  OBSERVING: [
    "TROUBLESHOOTING",
    "VERIFYING",
    "AWAITING_HUMAN",
    "RESOLVED",
    "CONSENT_REVOKED",
    "SECURITY_BLOCKED",
    "USER_CANCELLED",
    "CONNECTION_FAILED",
  ],
  TROUBLESHOOTING: [
    "AWAITING_ACTION_APPROVAL",
    "EXECUTING_BACKEND_ACTION",
    "AWAITING_USER_ACTION",
    "AWAITING_HUMAN",
    "VERIFYING",
    "RESOLVED",
    "ESCALATED",
    "CONSENT_REVOKED",
    "SECURITY_BLOCKED",
    "USER_CANCELLED",
    "CONNECTION_FAILED",
  ],
  AWAITING_ACTION_APPROVAL: [
    "EXECUTING_BROWSER_ACTION",
    "TROUBLESHOOTING",
    "CONSENT_REVOKED",
    "SECURITY_BLOCKED",
    "USER_CANCELLED",
  ],
  EXECUTING_BROWSER_ACTION: [
    "VERIFYING",
    "TROUBLESHOOTING",
    "CONSENT_REVOKED",
    "SECURITY_BLOCKED",
    "CONNECTION_FAILED",
  ],
  EXECUTING_BACKEND_ACTION: [
    "VERIFYING",
    "TROUBLESHOOTING",
    "AWAITING_HUMAN",
    "CONNECTION_FAILED",
  ],
  AWAITING_USER_ACTION: [
    "OBSERVING",
    "TROUBLESHOOTING",
    "VERIFYING",
    "CONSENT_REVOKED",
    "USER_CANCELLED",
  ],
  AWAITING_HUMAN: [
    "HUMAN_CONNECTED",
    "TROUBLESHOOTING",
    "ESCALATED_OFF_PLATFORM",
    "USER_CANCELLED",
  ],
  HUMAN_CONNECTED: [
    "TROUBLESHOOTING",
    "VERIFYING",
    "RESOLVED",
    "ESCALATED",
    "CONSENT_REVOKED",
    "USER_CANCELLED",
    "CONNECTION_FAILED",
  ],
  VERIFYING: [
    "TROUBLESHOOTING",
    "RESOLVED",
    "ESCALATED",
    "CONSENT_REVOKED",
    "SECURITY_BLOCKED",
    "CONNECTION_FAILED",
  ],
  RESOLVED: ["COMPLETED", "TROUBLESHOOTING"],
  ESCALATED: ["COMPLETED", "ESCALATED_OFF_PLATFORM"],
  COMPLETED: [],
  USER_CANCELLED: [],
  CONSENT_REVOKED: [],
  SECURITY_BLOCKED: [],
  CONNECTION_FAILED: [],
  ESCALATED_OFF_PLATFORM: [],
};

export function isTerminalStatus(status: SessionStatus): boolean {
  return (terminalSessionStatuses as readonly SessionStatus[]).includes(status);
}

export function canTransitionSession(
  from: SessionStatus,
  to: SessionStatus,
): boolean {
  return transitions[from].includes(to);
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export interface OriginDecision {
  allowed: boolean;
  reason:
    "allowed" | "invalid_origin" | "restricted_origin" | "not_allowlisted";
  origin: string | null;
}

export function evaluateOrigin(
  value: string,
  allowedOrigins: readonly string[],
  restrictedPatterns: readonly RegExp[] = defaultRestrictedHostPatterns,
): OriginDecision {
  const origin = normalizeOrigin(value);
  if (!origin) {
    return { allowed: false, reason: "invalid_origin", origin: null };
  }

  const hostname = new URL(origin).hostname;
  if (restrictedPatterns.some((pattern) => pattern.test(hostname))) {
    return { allowed: false, reason: "restricted_origin", origin };
  }

  const normalizedAllowlist = allowedOrigins
    .map(normalizeOrigin)
    .filter((candidate): candidate is string => candidate !== null);
  if (!normalizedAllowlist.includes(origin)) {
    return { allowed: false, reason: "not_allowlisted", origin };
  }

  return { allowed: true, reason: "allowed", origin };
}

export function isConsentActive(grant: ConsentGrant, at = new Date()): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= at.getTime())
    return false;
  return true;
}

export function findActiveConsent(
  session: SupportSession,
  grantType: ConsentGrantType,
  origin?: string,
  at = new Date(),
): ConsentGrant | null {
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  return (
    session.consents.find((grant) => {
      if (grant.grantType !== grantType || !isConsentActive(grant, at))
        return false;
      if (!normalizedOrigin) return true;
      return grant.allowedOrigins
        .map(normalizeOrigin)
        .includes(normalizedOrigin);
    }) ?? null
  );
}

export interface ObservationDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "session_terminal"
    | "session_paused"
    | "consent_required"
    | OriginDecision["reason"];
}

export function mayObserve(
  session: SupportSession,
  origin: string,
  tenantAllowedOrigins: readonly string[],
): ObservationDecision {
  if (isTerminalStatus(session.status))
    return { allowed: false, reason: "session_terminal" };
  if (session.paused) return { allowed: false, reason: "session_paused" };

  const originDecision = evaluateOrigin(origin, tenantAllowedOrigins);
  if (!originDecision.allowed)
    return { allowed: false, reason: originDecision.reason };

  if (!findActiveConsent(session, "screen_view_ai", origin)) {
    return { allowed: false, reason: "consent_required" };
  }

  return { allowed: true, reason: "allowed" };
}

const higherRiskControlIntent =
  /\b(delete|remove|erase|buy|pay|transfer|send|submit|approve|confirm|accept|continue|sign[ -]?in|log[ -]?in|reset|change|save|install|download|upload|share|grant|allow|revoke|disable|enable)\b|\bpurchase(?!\s+(?:orders?|requisitions?|items?|documents?))\b/i;

export function isHigherRiskControlName(name: string): boolean {
  return higherRiskControlIntent.test(name.trim());
}

export function isHigherRiskActionIntent(queryOrText: string): boolean {
  return higherRiskControlIntent.test(queryOrText);
}

export interface ObservedControlCandidate {
  role: string;
  name: string;
  disabled: boolean;
}

export const governedBrowserActions = [
  "CLICK_ELEMENT",
  "FOCUS_ELEMENT",
  "SCROLL_TO_ELEMENT",
] as const;

export type GovernedBrowserAction = (typeof governedBrowserActions)[number];

export function observedIncidentNumber(name: string): string | null {
  return name.match(/\bINC\d{3,}\b/i)?.[0]?.toUpperCase() ?? null;
}

export function observedSafeNavigationName(name: string): string | null {
  const normalized = name.trim().replace(/\s+/g, " ");
  return /\b(settings|preferences|history|home|dashboard|documentation|help|workspace|workspaces|incidents?)\b/i.test(
    normalized,
  )
    ? normalized
    : null;
}

const interactiveClickableRoles = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "option",
  "radio",
]);

export function isPotentiallyLowRiskControl(
  control: ObservedControlCandidate,
): boolean {
  const name = control.name.trim();
  const role = control.role.toLowerCase();
  return (
    !control.disabled &&
    interactiveClickableRoles.has(role) &&
    name.length > 0 &&
    name.length <= 300 &&
    !higherRiskControlIntent.test(name)
  );
}

export function isPotentiallyLowRiskAction(
  action: GovernedBrowserAction,
  control: ObservedControlCandidate,
): boolean {
  const role = control.role.toLowerCase();
  const hasSafeIdentity =
    control.name.trim().length > 0 && control.name.trim().length <= 300;
  if (!hasSafeIdentity) return false;
  if (action === "CLICK_ELEMENT") return isPotentiallyLowRiskControl(control);
  if (action === "FOCUS_ELEMENT") {
    return (
      !control.disabled &&
      [
        "textbox",
        "combobox",
        "button",
        "link",
        "checkbox",
        "radio",
        "tab",
      ].includes(role)
    );
  }
  if (action === "SCROLL_TO_ELEMENT") {
    return !control.disabled;
  }
  return false;
}

export function governedActionsForControl(
  control: ObservedControlCandidate,
): GovernedBrowserAction[] {
  return governedBrowserActions.filter((action) =>
    isPotentiallyLowRiskAction(action, control),
  );
}
