// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlCommand } from "@remoteassist/command-schema";
import { executeBrowserCommand } from "../src/control-executor/execute.js";
import { sanitizeDocument } from "../src/security/sanitize.js";

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ x: 10, y: 10, width: 120, height: 32 }],
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ x: 10, y: 10, width: 120, height: 32 }),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  document.title = "Salesforce";
  document.body.innerHTML = `<p role="alert">SAML authentication failed</p><button>Try Again</button><input type="password" value="secret" />`;
});

async function commandForCurrentPage(
  type:
    "CLICK_ELEMENT" | "FOCUS_ELEMENT" | "SCROLL_TO_ELEMENT" = "CLICK_ELEMENT",
): Promise<ControlCommand> {
  const observation = await sanitizeDocument();
  const target = observation.controls.find(
    (control) => control.name === "Try Again",
  )!;
  return {
    command_id: "cmd_test",
    session_id: "rs_test",
    session_revision: 7,
    controller: "ai",
    type,
    target: {
      strategy: "observed_element",
      element_id: target.elementId,
      role: target.role,
      name: target.name,
    },
    expected_page: {
      origin: observation.origin,
      page_fingerprint: observation.page_fingerprint,
    },
    purpose: "Retry once",
    risk: "low",
    approval: "allow_once",
    approval_status: "approved",
    expected_text: null,
    expires_at: new Date(Date.now() + 30_000).toISOString(),
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    executed_at: null,
    execution_status: "authorized",
  };
}

describe("deterministic browser executor", () => {
  it("clicks the exact observed safe target", async () => {
    const click = vi.spyOn(HTMLButtonElement.prototype, "click");
    const result = await executeBrowserCommand(await commandForCurrentPage());
    expect(click).toHaveBeenCalledOnce();
    expect(result.result).toMatchObject({
      status: "executed",
      result: { action_dispatched: true },
    });
  });

  it("focuses and scrolls to the exact observed safe target", async () => {
    const focus = vi.spyOn(HTMLButtonElement.prototype, "focus");
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView);

    const focused = await executeBrowserCommand(
      await commandForCurrentPage("FOCUS_ELEMENT"),
    );
    const scrolled = await executeBrowserCommand(
      await commandForCurrentPage("SCROLL_TO_ELEMENT"),
    );

    expect(focus).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledOnce();
    expect(focused.result.result.action_dispatched).toBe(true);
    expect(scrolled.result.result.action_dispatched).toBe(true);
  });

  it("blocks stale page fingerprints before dispatch", async () => {
    const command = await commandForCurrentPage();
    command.expected_page.page_fingerprint = "sha256:stale";
    const click = vi.spyOn(HTMLButtonElement.prototype, "click");
    const result = await executeBrowserCommand(command);
    expect(click).not.toHaveBeenCalled();
    expect(result.result.result.failure_code).toBe("page_fingerprint_changed");
  });

  it("blocks a target that becomes sensitive before dispatch", async () => {
    const command = await commandForCurrentPage();
    document
      .querySelector("button")!
      .setAttribute("data-remoteassist-sensitive", "true");
    const result = await executeBrowserCommand(command);
    expect(result.result.result.failure_code).toBe("page_fingerprint_changed");
    expect(result.result.result.action_dispatched).toBe(false);
  });
});
