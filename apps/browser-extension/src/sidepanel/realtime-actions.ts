import {
  governedBrowserActions,
  isPotentiallyLowRiskAction,
  type GovernedBrowserAction,
} from "@remoteassist/policy-model";
import type { SafeControl } from "@remoteassist/shared-types";

export interface RealtimeActionProposal {
  callId: string;
  controlName: string;
  controlRole: string;
  actionType: GovernedBrowserAction;
  purpose: string;
}

export interface RealtimeFunctionCall {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
}

export function parseRealtimeActionProposal(
  call: RealtimeFunctionCall,
  controls: SafeControl[],
): RealtimeActionProposal | null {
  if (
    call.type !== "function_call" ||
    call.name !== "propose_browser_action" ||
    typeof call.call_id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(call.call_id) ||
    typeof call.arguments !== "string" ||
    call.arguments.length > 2000
  ) {
    return null;
  }

  let input: unknown;
  try {
    input = JSON.parse(call.arguments);
  } catch {
    return null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.control_name !== "string" ||
    typeof candidate.action_type !== "string" ||
    typeof candidate.purpose !== "string" ||
    candidate.control_name.length > 300 ||
    candidate.purpose.trim().length < 3 ||
    candidate.purpose.length > 500
  ) {
    return null;
  }

  const actionType = governedBrowserActions.find(
    (action) => action === candidate.action_type,
  );
  if (!actionType) return null;

  const matchingControls = controls.filter(
    (control) =>
      control.name === candidate.control_name &&
      isPotentiallyLowRiskAction(actionType, control),
  );
  const observed = matchingControls.length === 1 ? matchingControls[0] : null;
  if (!observed) return null;

  return {
    callId: call.call_id,
    controlName: observed.name,
    controlRole: observed.role,
    actionType,
    purpose: candidate.purpose.trim(),
  };
}
