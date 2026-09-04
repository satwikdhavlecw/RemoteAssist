import { z } from "zod";

export const browserCommandTypes = [
  "HIGHLIGHT_ELEMENT",
  "CLEAR_HIGHLIGHT",
  "SCROLL_TO_ELEMENT",
  "CLICK_ELEMENT",
  "FOCUS_ELEMENT",
  "TYPE_TEXT",
  "CLEAR_FIELD",
  "SELECT_OPTION",
  "CHECK_BOX",
  "UNCHECK_BOX",
  "NAVIGATE_TO_APPROVED_URL",
  "GO_BACK",
  "REFRESH_PAGE",
  "WAIT_FOR_ELEMENT",
  "READ_PAGE_STATE",
  "CAPTURE_SNAPSHOT",
] as const;

export const commandRiskTiers = [
  "low",
  "medium",
  "high",
  "prohibited",
] as const;

export const commandTargetSchema = z
  .object({
    strategy: z.literal("observed_element"),
    element_id: z.string().min(1).max(120),
    role: z.string().min(1).max(80),
    name: z.string().min(1).max(300),
  })
  .strict();

export const controlCommandSchema = z
  .object({
    command_id: z.string().min(1).max(100),
    session_id: z.string().min(1).max(100),
    session_revision: z.number().int().positive(),
    controller: z.enum(["ai", "human"]),
    type: z.enum(browserCommandTypes),
    target: commandTargetSchema,
    expected_page: z
      .object({
        origin: z.string().url(),
        page_fingerprint: z.string().min(8).max(200),
      })
      .strict(),
    purpose: z.string().min(3).max(500),
    risk: z.enum(commandRiskTiers),
    approval: z.enum(["required", "allow_once", "session_grant"]),
    approval_status: z.enum([
      "pending",
      "approved",
      "rejected",
      "expired",
      "revoked",
    ]),
    expected_text: z.string().max(500).nullable(),
    plan_id: z.string().min(1).max(100).optional(),
    step_index: z.number().int().nonnegative().optional(),
    expires_at: z.string().datetime(),
    created_at: z.string().datetime(),
    approved_at: z.string().datetime().nullable(),
    executed_at: z.string().datetime().nullable(),
    execution_status: z.enum([
      "not_started",
      "authorized",
      "executed",
      "blocked",
      "failed",
    ]),
  })
  .strict();

export const commandResultSchema = z
  .object({
    command_id: z.string().min(1).max(100),
    status: z.enum(["executed", "blocked", "failed"]),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime(),
    result: z
      .object({
        element_found: z.boolean(),
        action_dispatched: z.boolean(),
        page_changed: z.boolean(),
        verification_result: z.enum(["passed", "failed", "not_requested"]),
        failure_code: z.string().max(120).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.result.verification_result === "passed" &&
      (value.status !== "executed" || !value.result.action_dispatched)
    ) {
      context.addIssue({
        code: "custom",
        path: ["result", "verification_result"],
        message:
          "Verification can pass only after the command executed and dispatched its action.",
      });
    }
  });

export const proposeObservedCommandSchema = z
  .object({
    type: z.enum(["CLICK_ELEMENT", "FOCUS_ELEMENT", "SCROLL_TO_ELEMENT"]),
    control_name: z.string().min(1).max(300),
    control_role: z.string().min(1).max(80),
    purpose: z.string().min(3).max(500),
    expected_text: z.string().max(500).nullable().default(null),
    controller: z.enum(["ai", "human"]).default("ai"),
    plan_id: z.string().min(1).max(100).optional(),
    step_index: z.number().int().nonnegative().optional(),
  })
  .strict();

export type BrowserCommandType = (typeof browserCommandTypes)[number];
export type CommandRiskTier = (typeof commandRiskTiers)[number];
export type ControlCommand = z.infer<typeof controlCommandSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type ProposeObservedCommand = z.infer<
  typeof proposeObservedCommandSchema
>;

export function digestableCommand(
  command: ControlCommand,
): Record<string, unknown> {
  return {
    command_id: command.command_id,
    session_id: command.session_id,
    session_revision: command.session_revision,
    controller: command.controller,
    type: command.type,
    target: command.target,
    expected_page: command.expected_page,
    purpose: command.purpose,
    risk: command.risk,
    expected_text: command.expected_text,
    expires_at: command.expires_at,
  };
}
