import { describe, expect, it } from "vitest";
import type { ControlCommand } from "@remoteassist/command-schema";
import type { SupportSession } from "@remoteassist/shared-types";
import { evaluateControlCommand } from "../src/index.js";

const origin = "https://login.salesforce.com";
const session: SupportSession = {
  id: "rs_test",
  tenantId: "tenant",
  userId: "user",
  status: "EXECUTING_BROWSER_ACTION",
  revision: 7,
  channel: "browser_extension",
  voiceEnabled: false,
  paused: false,
  entryOrigin: origin,
  controller: "ai",
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
  endedAt: null,
  consents: [
    {
      id: "cns_control",
      sessionId: "rs_test",
      grantType: "browser_control_ai",
      scope: "allow_once",
      allowedOrigins: [origin],
      grantedBy: "user",
      grantedAt: "2026-07-15T10:00:00.000Z",
      revokedAt: null,
      expiresAt: null,
      expiresWhen: "session_ends",
    },
  ],
};
const command: ControlCommand = {
  command_id: "cmd_test",
  session_id: session.id,
  session_revision: session.revision,
  controller: "ai",
  type: "CLICK_ELEMENT",
  target: {
    strategy: "observed_element",
    element_id: "ra-4",
    role: "button",
    name: "Try Again",
  },
  expected_page: { origin, page_fingerprint: "sha256:fixture" },
  purpose: "Retry once",
  risk: "low",
  approval: "allow_once",
  approval_status: "approved",
  expected_text: "Salesforce home",
  expires_at: "2026-07-15T10:02:00.000Z",
  created_at: "2026-07-15T10:00:00.000Z",
  approved_at: "2026-07-15T10:00:30.000Z",
  executed_at: null,
  execution_status: "authorized",
};
const evaluationTime = new Date("2026-07-15T10:01:00Z");

describe("control policy", () => {
  it("allows an approved low-risk command with separate active consent", () => {
    expect(
      evaluateControlCommand(session, command, [origin], evaluationTime),
    ).toEqual({
      allowed: true,
      reason: "allowed",
    });
  });

  it("blocks after pause, revocation, revision change, expiry, or replay", () => {
    expect(
      evaluateControlCommand({ ...session, paused: true }, command, [origin])
        .reason,
    ).toBe("session_paused");
    expect(
      evaluateControlCommand(
        {
          ...session,
          consents: [
            { ...session.consents[0]!, revokedAt: "2026-07-15T10:00:40Z" },
          ],
        },
        command,
        [origin],
        evaluationTime,
      ).reason,
    ).toBe("consent_required");
    expect(
      evaluateControlCommand(
        { ...session, revision: 8 },
        command,
        [origin],
        evaluationTime,
      ).reason,
    ).toBe("revision_mismatch");
    expect(
      evaluateControlCommand(
        session,
        command,
        [origin],
        new Date("2026-07-15T10:03:00Z"),
      ).reason,
    ).toBe("command_expired");
    expect(
      evaluateControlCommand(
        session,
        { ...command, execution_status: "executed" },
        [origin],
        evaluationTime,
      ).reason,
    ).toBe("command_already_used");
  });

  it("blocks medium risk even when consent and approval exist", () => {
    expect(
      evaluateControlCommand(
        session,
        { ...command, risk: "medium" },
        [origin],
        evaluationTime,
      ).reason,
    ).toBe("risk_not_permitted");
  });
});
