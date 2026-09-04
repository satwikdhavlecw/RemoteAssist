import { randomUUID } from "node:crypto";
import type {
  CommandResult,
  ControlCommand,
  ProposeObservedCommand,
} from "@remoteassist/command-schema";
import { evaluateControlCommand } from "@remoteassist/control-policy";
import { isPotentiallyLowRiskAction } from "@remoteassist/policy-model";
import type {
  SanitizedObservation,
  SupportSession,
} from "@remoteassist/shared-types";
import { DomainError } from "./errors.js";
import { SessionStore } from "./session-store.js";

export class ControlService {
  readonly #commands = new Map<string, ControlCommand>();

  constructor(private readonly sessions: SessionStore) {}

  propose(
    session: SupportSession,
    observation: SanitizedObservation | null,
    input: ProposeObservedCommand,
  ): ControlCommand {
    this.sessions.assertActive(session);
    if (!observation) {
      throw new DomainError(
        "observation_required",
        "A current sanitized observation is required.",
        409,
      );
    }
    if (session.status === "RESOLVED") {
      this.sessions.transition(session, "TROUBLESHOOTING");
    }
    if (session.status !== "TROUBLESHOOTING") {
      throw new DomainError(
        "wrong_session_state",
        "A browser command can be proposed only while troubleshooting.",
        409,
      );
    }
    const matchingTargets = observation.controls.filter(
      (control) =>
        control.name.localeCompare(input.control_name, undefined, {
          sensitivity: "accent",
        }) === 0 &&
        control.role.localeCompare(input.control_role, undefined, {
          sensitivity: "accent",
        }) === 0,
    );
    const target = matchingTargets.length === 1 ? matchingTargets[0] : null;
    if (!target || target.disabled) {
      throw new DomainError(
        "safe_target_not_found",
        "The requested control was not present as one unambiguous enabled safe observed element.",
        409,
      );
    }
    if (!isPotentiallyLowRiskAction(input.type, target)) {
      throw new DomainError(
        "action_risk_not_low",
        "The model-proposed control is not eligible for low-risk browser execution.",
        403,
      );
    }

    this.sessions.transition(session, "AWAITING_ACTION_APPROVAL");
    const createdAt = new Date();
    const command: ControlCommand = {
      command_id: `cmd_${randomUUID()}`,
      session_id: session.id,
      session_revision: session.revision,
      controller: input.controller,
      type: input.type,
      target: {
        strategy: "observed_element",
        element_id: target.elementId,
        role: target.role,
        name: target.name,
      },
      expected_page: {
        origin: observation.origin,
        page_fingerprint: observation.pageFingerprint,
      },
      purpose: input.purpose,
      risk: "low",
      approval: "required",
      approval_status: "pending",
      expected_text: input.expected_text,
      plan_id: input.plan_id,
      step_index: input.step_index,
      expires_at: new Date(createdAt.getTime() + 60_000).toISOString(),
      created_at: createdAt.toISOString(),
      approved_at: null,
      executed_at: null,
      execution_status: "not_started",
    };
    this.#commands.set(command.command_id, command);
    return command;
  }

  get(session: SupportSession, commandId: string): ControlCommand {
    const command = this.#commands.get(commandId);
    if (!command || command.session_id !== session.id) {
      throw new DomainError(
        "command_not_found",
        "The browser command was not found.",
        404,
      );
    }
    return command;
  }

  approve(session: SupportSession, commandId: string): ControlCommand {
    this.sessions.assertActive(session);
    const command = this.get(session, commandId);
    if (
      command.approval_status !== "pending" ||
      command.execution_status !== "not_started"
    ) {
      throw new DomainError(
        "command_not_pending",
        "The command is no longer awaiting approval.",
        409,
      );
    }
    if (new Date(command.expires_at).getTime() <= Date.now()) {
      command.approval_status = "expired";
      throw new DomainError(
        "command_expired",
        "The command expired before approval.",
        409,
      );
    }
    command.approval_status = "approved";
    command.approval = "allow_once";
    command.approved_at = new Date().toISOString();
    session.controller = command.controller;
    this.sessions.transition(session, "EXECUTING_BROWSER_ACTION");
    command.session_revision = session.revision;
    return command;
  }

  authorize(session: SupportSession, commandId: string): ControlCommand {
    const command = this.get(session, commandId);
    const allowedOrigins = session.entryOrigin ? [session.entryOrigin] : [];
    const decision = evaluateControlCommand(session, command, allowedOrigins);
    if (!decision.allowed) {
      command.execution_status = "blocked";
      if (decision.reason === "command_expired")
        command.approval_status = "expired";
      if (this.sessions.isActive(session)) {
        session.controller = "none";
        this.sessions.transition(session, "TROUBLESHOOTING");
      }
      throw new DomainError(
        decision.reason,
        "The browser command is no longer authorized.",
        403,
      );
    }
    command.execution_status = "authorized";
    return command;
  }

  recordResult(
    session: SupportSession,
    commandId: string,
    result: CommandResult,
  ): ControlCommand {
    this.sessions.assertActive(session);
    const command = this.get(session, commandId);
    if (result.command_id !== command.command_id) {
      throw new DomainError(
        "command_result_mismatch",
        "The result does not match the command.",
      );
    }
    if (command.execution_status !== "authorized") {
      throw new DomainError(
        "command_not_authorized",
        "The command was not authorized for execution.",
        409,
      );
    }
    command.executed_at = result.completed_at;
    command.execution_status =
      result.status === "executed" ? "executed" : result.status;
    session.controller = "none";
    this.sessions.transition(session, "VERIFYING");
    if (
      result.status === "executed" &&
      result.result.action_dispatched &&
      result.result.verification_result === "passed"
    ) {
      this.sessions.transition(session, "RESOLVED");
    } else {
      this.sessions.transition(session, "TROUBLESHOOTING");
    }
    return command;
  }

  list(session: SupportSession): ControlCommand[] {
    return [...this.#commands.values()].filter(
      (command) => command.session_id === session.id,
    );
  }
}
