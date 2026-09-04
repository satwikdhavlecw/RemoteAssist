import type { ControlCommand } from "@remoteassist/command-schema";
import {
  evaluateOrigin,
  findActiveConsent,
  isTerminalStatus,
} from "@remoteassist/policy-model";
import type { SupportSession } from "@remoteassist/shared-types";

export interface ControlDecision {
  allowed: boolean;
  reason:
    | "allowed"
    | "session_terminal"
    | "session_paused"
    | "wrong_session_state"
    | "wrong_controller"
    | "command_expired"
    | "command_already_used"
    | "command_not_approved"
    | "revision_mismatch"
    | "consent_required"
    | "risk_not_permitted"
    | "invalid_origin"
    | "restricted_origin"
    | "not_allowlisted";
}

export function evaluateControlCommand(
  session: SupportSession,
  command: ControlCommand,
  allowedOrigins: readonly string[],
  now = new Date(),
): ControlDecision {
  if (isTerminalStatus(session.status))
    return { allowed: false, reason: "session_terminal" };
  if (session.paused) return { allowed: false, reason: "session_paused" };
  if (session.status !== "EXECUTING_BROWSER_ACTION") {
    return { allowed: false, reason: "wrong_session_state" };
  }
  if (session.controller !== command.controller)
    return { allowed: false, reason: "wrong_controller" };
  if (new Date(command.expires_at).getTime() <= now.getTime()) {
    return { allowed: false, reason: "command_expired" };
  }
  if (command.execution_status === "executed") {
    return { allowed: false, reason: "command_already_used" };
  }
  if (command.approval_status !== "approved") {
    return { allowed: false, reason: "command_not_approved" };
  }
  if (command.session_revision !== session.revision) {
    return { allowed: false, reason: "revision_mismatch" };
  }
  if (command.risk !== "low")
    return { allowed: false, reason: "risk_not_permitted" };

  const origin = evaluateOrigin(command.expected_page.origin, allowedOrigins);
  if (!origin.allowed) return { allowed: false, reason: origin.reason };

  const consentType =
    command.controller === "human"
      ? "browser_control_human"
      : "browser_control_ai";
  if (
    !findActiveConsent(session, consentType, command.expected_page.origin, now)
  ) {
    return { allowed: false, reason: "consent_required" };
  }
  return { allowed: true, reason: "allowed" };
}
