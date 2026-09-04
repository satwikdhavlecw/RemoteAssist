import { describe, expect, it } from "vitest";
import { commandResultSchema, controlCommandSchema } from "../src/index.js";

const command = {
  command_id: "cmd_test",
  session_id: "rs_test",
  session_revision: 4,
  controller: "ai",
  type: "CLICK_ELEMENT",
  target: {
    strategy: "observed_element",
    element_id: "ra-4",
    role: "button",
    name: "Try Again",
  },
  expected_page: {
    origin: "https://login.salesforce.com",
    page_fingerprint: "sha256:fixture",
  },
  purpose: "Retry the failed SSO request once",
  risk: "low",
  approval: "required",
  approval_status: "pending",
  expected_text: "Salesforce home",
  expires_at: "2026-07-15T10:01:00.000Z",
  created_at: "2026-07-15T10:00:00.000Z",
  approved_at: null,
  executed_at: null,
  execution_status: "not_started",
};

describe("control command schema", () => {
  it("accepts a bounded observed-element command", () => {
    expect(controlCommandSchema.parse(command).target.name).toBe("Try Again");
  });

  it("rejects arbitrary selectors and unknown fields", () => {
    expect(() =>
      controlCommandSchema.parse({
        ...command,
        target: { ...command.target, fallback_selector: "script" },
      }),
    ).toThrow();
  });

  it("rejects arbitrary JavaScript as a command type", () => {
    expect(() =>
      controlCommandSchema.parse({ ...command, type: "EXECUTE_JAVASCRIPT" }),
    ).toThrow();
  });

  it("rejects a failed command that claims verification passed", () => {
    expect(() =>
      commandResultSchema.parse({
        command_id: "cmd_test",
        status: "failed",
        started_at: "2026-07-15T10:00:00.000Z",
        completed_at: "2026-07-15T10:00:01.000Z",
        result: {
          element_found: true,
          action_dispatched: false,
          page_changed: false,
          verification_result: "passed",
          failure_code: "dispatch_failed",
        },
      }),
    ).toThrow(/executed and dispatched/);
  });
});
