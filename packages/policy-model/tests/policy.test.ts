import { describe, expect, it } from "vitest";
import type { ConsentGrant, SupportSession } from "@remoteassist/shared-types";
import {
  canTransitionSession,
  evaluateOrigin,
  governedActionsForControl,
  isConsentActive,
  isHigherRiskActionIntent,
  isHigherRiskControlName,
  isPotentiallyLowRiskAction,
  isPotentiallyLowRiskControl,
  mayObserve,
} from "../src/index.js";

const activeConsent: ConsentGrant = {
  id: "consent-1",
  sessionId: "session-1",
  grantType: "screen_view_ai",
  scope: "selected_tab",
  allowedOrigins: ["https://login.salesforce.com"],
  grantedBy: "user-1",
  grantedAt: "2026-07-15T10:00:00.000Z",
  revokedAt: null,
  expiresAt: null,
  expiresWhen: "session_ends",
};

const session: SupportSession = {
  id: "session-1",
  tenantId: "tenant-1",
  userId: "user-1",
  status: "OBSERVING",
  revision: 2,
  channel: "browser_extension",
  voiceEnabled: false,
  paused: false,
  entryOrigin: "https://login.salesforce.com",
  controller: "none",
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
  endedAt: null,
  consents: [activeConsent],
};

describe("session policy", () => {
  it("allows only documented state transitions", () => {
    expect(canTransitionSession("OBSERVING", "TROUBLESHOOTING")).toBe(true);
    expect(canTransitionSession("OBSERVING", "EXECUTING_BROWSER_ACTION")).toBe(
      false,
    );
    expect(canTransitionSession("COMPLETED", "OBSERVING")).toBe(false);
  });

  it("blocks a restricted origin even when it is allowlisted", () => {
    expect(
      evaluateOrigin("https://paypal.com/pay", ["https://paypal.com"]),
    ).toEqual({
      allowed: false,
      reason: "restricted_origin",
      origin: "https://paypal.com",
    });
  });

  it("requires an exact normalized allowlist origin", () => {
    expect(
      evaluateOrigin("https://login.salesforce.com/error", [
        "https://login.salesforce.com",
      ]),
    ).toMatchObject({ allowed: true, reason: "allowed" });
    expect(
      evaluateOrigin("https://attacker.example", [
        "https://login.salesforce.com",
      ]),
    ).toMatchObject({ allowed: false, reason: "not_allowlisted" });
  });

  it("treats revoked and expired consent as inactive", () => {
    expect(
      isConsentActive(activeConsent, new Date("2026-07-15T10:05:00.000Z")),
    ).toBe(true);
    expect(
      isConsentActive({
        ...activeConsent,
        revokedAt: "2026-07-15T10:01:00.000Z",
      }),
    ).toBe(false);
    expect(
      isConsentActive(
        { ...activeConsent, expiresAt: "2026-07-15T10:02:00.000Z" },
        new Date("2026-07-15T10:03:00.000Z"),
      ),
    ).toBe(false);
  });

  it("stops observation immediately when paused or consent is revoked", () => {
    expect(
      mayObserve(
        session,
        "https://login.salesforce.com",
        activeConsent.allowedOrigins,
      ),
    ).toEqual({
      allowed: true,
      reason: "allowed",
    });
    expect(
      mayObserve(
        { ...session, paused: true },
        "https://login.salesforce.com",
        activeConsent.allowedOrigins,
      ),
    ).toEqual({ allowed: false, reason: "session_paused" });
    expect(
      mayObserve(
        {
          ...session,
          consents: [{ ...activeConsent, revokedAt: new Date().toISOString() }],
        },
        "https://login.salesforce.com",
        activeConsent.allowedOrigins,
      ),
    ).toEqual({ allowed: false, reason: "consent_required" });
  });

  it("allows neutral observed buttons but rejects higher-risk action intent", () => {
    expect(
      isPotentiallyLowRiskControl({
        role: "button",
        name: "Try Again",
        disabled: false,
      }),
    ).toBe(true);
    expect(
      isPotentiallyLowRiskControl({
        role: "button",
        name: "Delete account",
        disabled: false,
      }),
    ).toBe(false);
    expect(
      isPotentiallyLowRiskControl({
        role: "link",
        name: "Continue",
        disabled: false,
      }),
    ).toBe(false);
  });

  it("allows focus and scroll without turning sensitive clicks into clicks", () => {
    const signIn = { role: "button", name: "Sign in", disabled: false };
    const username = {
      role: "textbox",
      name: "Username or Email",
      disabled: false,
    };

    expect(isPotentiallyLowRiskAction("CLICK_ELEMENT", signIn)).toBe(false);
    expect(governedActionsForControl(signIn)).toEqual([
      "FOCUS_ELEMENT",
      "SCROLL_TO_ELEMENT",
    ]);
    expect(governedActionsForControl(username)).toEqual([
      "FOCUS_ELEMENT",
      "SCROLL_TO_ELEMENT",
    ]);
  });

  it("rejects click action on container regions and headings while allowing scroll", () => {
    const pageSection = {
      role: "region",
      name: "Page Sections",
      disabled: false,
    };
    const heading = {
      role: "heading",
      name: "Procurement Overview",
      disabled: false,
    };

    expect(isPotentiallyLowRiskAction("CLICK_ELEMENT", pageSection)).toBe(false);
    expect(isPotentiallyLowRiskAction("CLICK_ELEMENT", heading)).toBe(false);
    expect(isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", pageSection)).toBe(true);
    expect(isPotentiallyLowRiskAction("SCROLL_TO_ELEMENT", heading)).toBe(true);
    expect(governedActionsForControl(pageSection)).toEqual(["SCROLL_TO_ELEMENT"]);
  });

  it("correctly identifies higher-risk control names and action intents", () => {
    expect(isHigherRiskControlName("Reset")).toBe(true);
    expect(isHigherRiskControlName("Delete Account")).toBe(true);
    expect(isHigherRiskControlName("Submit Invoice")).toBe(true);
    expect(isHigherRiskControlName("Validate Invoice")).toBe(false);
    expect(isHigherRiskControlName("Try Again")).toBe(false);
    expect(isHigherRiskActionIntent("click on reset")).toBe(true);
    expect(isHigherRiskActionIntent("delete record")).toBe(true);
    expect(isHigherRiskActionIntent("open manage purchase orders")).toBe(false);
  });
});
