// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../src/sidepanel/ControlPanel.js";
import {
  approveCommand,
  approvePlan,
  authorizeCommand,
  proposeBrowserAction,
  recordCommandResult,
  recordPlanResult,
} from "../src/sidepanel/api.js";
import type {
  ResolutionPlan,
  SanitizedObservation,
} from "@remoteassist/shared-types";

vi.mock("../src/sidepanel/api.js", () => ({
  proposeBrowserAction: vi.fn(
    async (
      _sid,
      actionType,
      name,
      purpose,
      role,
      _text,
      planId,
      stepIndex,
    ) => ({
      command_id: `cmd_${stepIndex ?? 0}`,
      plan_id: planId,
      step_index: stepIndex,
      type: actionType,
      target: { name, role },
    }),
  ),
  approveCommand: vi.fn(async () => undefined),
  authorizeCommand: vi.fn(async (_sid, commandId) => ({
    command_id: commandId,
    type: "CLICK_ELEMENT",
  })),
  grantBrowserControlConsent: vi.fn(async () => ({ id: "consent_123" })),
  recordCommandResult: vi.fn(async () => ({
    command: { execution_status: "executed" },
    session: { status: "RESOLVED" },
  })),
  submitObservation: vi.fn(async (_sid, obs) => ({
    origin: obs.origin,
    pageTitle: obs.page_title,
    pageFingerprint: obs.page_fingerprint,
    application: obs.application,
    controls: obs.controls,
    visibleText: obs.visible_text,
    sensitiveContent: obs.sensitive_content,
    confidence: obs.confidence,
  })),
  approvePlan: vi.fn(async () => undefined),
  recordPlanResult: vi.fn(async () => undefined),
}));

describe("ControlPanel UI - Multi-Step Resolution Plans", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onActionCompleted: ReturnType<typeof vi.fn>;
  let onPlanCompleted: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  let onExecutingChange: ReturnType<typeof vi.fn>;

  const observation: SanitizedObservation = {
    origin: "https://login.salesforce.com",
    pageTitle: "Salesforce login",
    pageFingerprint: "sha256:current-page",
    application: "Salesforce",
    controls: [
      {
        elementId: "ra-retry",
        role: "button",
        name: "Try Again",
        disabled: false,
        rectangle: { x: 10, y: 20, width: 120, height: 32 },
      },
    ],
    visibleText: ["Try Again"],
    sensitiveContent: false,
    confidence: 0.95,
  };

  const proposal = {
    callId: "call_123",
    controlName: "Try Again",
    controlRole: "button",
    actionType: "CLICK_ELEMENT" as const,
    purpose: "Click try again",
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    onActionCompleted = vi.fn();
    onPlanCompleted = vi.fn();
    onDismiss = vi.fn();
    onExecutingChange = vi.fn();

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
          if (msg.type === "REMOTEASSIST_OBSERVE_ACTIVE_TAB") {
            return {
              ok: true,
              observation: {
                origin: observation.origin,
                page_title: observation.pageTitle,
                page_fingerprint: observation.pageFingerprint,
                application: observation.application,
                controls: observation.controls,
                visible_text: observation.visibleText,
                sensitive_content: observation.sensitiveContent,
                confidence: observation.confidence,
              },
            };
          }
          if (msg.type === "REMOTEASSIST_EXECUTE_ACTIVE_TAB") {
            return {
              ok: true,
              result: {
                status: "executed",
                result: {
                  element_found: true,
                  action_dispatched: true,
                  page_changed: true,
                  verification_result: "passed",
                  failure_code: null,
                },
              },
            };
          }
          return { ok: true, result: { success: true } };
        }),
      },
    });

    vi.mocked(proposeBrowserAction).mockClear();
    vi.mocked(approveCommand).mockClear();
    vi.mocked(authorizeCommand).mockClear();
    vi.mocked(recordCommandResult).mockClear();
    vi.mocked(approvePlan).mockClear();
    vi.mocked(recordPlanResult).mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders approval card and transitions to verified state on single action proposal", async () => {
    await act(async () => {
      root.render(
        <ControlPanel
          sessionId="session_123"
          tabId={1}
          observation={observation}
          proposal={proposal}
          onActionCompleted={onActionCompleted}
          onDismiss={onDismiss}
          onExecutingChange={onExecutingChange}
        />,
      );
    });

    const approveButton = container.querySelector(".control-button");
    expect(approveButton).not.toBeNull();
    expect(approveButton?.textContent).toMatch(/Allow once|Approve/);

    await act(async () => {
      (approveButton as HTMLElement).click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onExecutingChange).toHaveBeenCalledWith(true);
    expect(onExecutingChange).toHaveBeenLastCalledWith(false);

    const dismissButton = container.querySelector(".text-button");
    expect(dismissButton).not.toBeNull();
    expect(dismissButton?.textContent).toContain("Dismiss");

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  // TEST 1: Step 2 target disappears between plan and execution (chain stops at step 2, step 1 logged, error surfaced)
  it("Test 1: Step 2 target disappears between plan and execution (chain stops at step 2, step 1 logged, error surfaced)", async () => {
    const twoStepPlan: ResolutionPlan = {
      planId: "plan_disappearing_target",
      steps: [
        {
          id: "step_1",
          actionType: "CLICK_ELEMENT",
          controlName: "Step One",
          controlRole: "button",
          purpose: "Click step one",
        },
        {
          id: "step_2",
          actionType: "CLICK_ELEMENT",
          controlName: "Step Two",
          controlRole: "button",
          purpose: "Click step two",
        },
      ],
      explanation: "Two step plan where step 2 disappears",
    };

    let observeCallCount = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
          if (msg.type === "REMOTEASSIST_OBSERVE_ACTIVE_TAB") {
            observeCallCount++;
            // On second observation, "Step Two" disappeared
            const controls =
              observeCallCount === 1
                ? [
                    {
                      elementId: "step-1-el",
                      role: "button",
                      name: "Step One",
                      disabled: false,
                      rectangle: { x: 0, y: 0, width: 50, height: 20 },
                    },
                  ]
                : []; // disappeared!

            return {
              ok: true,
              observation: {
                origin: "https://login.salesforce.com",
                page_title: "Salesforce",
                page_fingerprint: `sha256:fp_${observeCallCount}`,
                application: "Salesforce",
                controls,
                visibleText: [],
                sensitiveContent: false,
                confidence: 0.9,
              },
            };
          }
          return {
            ok: true,
            result: {
              status: "executed",
              result: {
                element_found: true,
                action_dispatched: true,
                page_changed: true,
                verification_result: "passed",
                failure_code: null,
              },
            },
          };
        }),
      },
    });

    await act(async () => {
      root.render(
        <ControlPanel
          sessionId="session_123"
          tabId={1}
          observation={{
            ...observation,
            controls: [
              {
                elementId: "step-1-el",
                role: "button",
                name: "Step One",
                disabled: false,
                rectangle: { x: 0, y: 0, width: 50, height: 20 },
              },
              {
                elementId: "step-2-el",
                role: "button",
                name: "Step Two",
                disabled: false,
                rectangle: { x: 0, y: 30, width: 50, height: 20 },
              },
            ],
          }}
          plan={twoStepPlan}
          onPlanCompleted={onPlanCompleted}
          onDismiss={onDismiss}
          onExecutingChange={onExecutingChange}
        />,
      );
    });

    const approveButton = container.querySelector(".control-button");
    await act(async () => {
      (approveButton as HTMLElement).click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    // Step 1 was proposed and approved
    expect(proposeBrowserAction).toHaveBeenCalledTimes(1);
    expect(approveCommand).toHaveBeenCalledTimes(1);

    // Plan was recorded as failed at step 2
    expect(recordPlanResult).toHaveBeenCalledWith(
      "session_123",
      "plan_disappearing_target",
      "failed",
      2,
      1,
      expect.stringContaining("Target control was not found on the live page"),
      1,
    );

    // Error message surfaced in UI
    expect(container.textContent).toContain("Stopped safely");
    expect(container.textContent).toContain(
      "Target control was not found on the live page",
    );
  });

  // TEST 2: Step 2 resolves to risky keyword or cross-origin (rejected at execution time)
  it("Test 2: Step 2 resolves to risky keyword or cross-origin (rejected at execution time)", async () => {
    // 2A: Risky keyword on live page
    const riskyPlan: ResolutionPlan = {
      planId: "plan_risky_step",
      steps: [
        {
          id: "step_1",
          actionType: "CLICK_ELEMENT",
          controlName: "Step One",
          controlRole: "button",
          purpose: "Click step one",
        },
        {
          id: "step_2",
          actionType: "CLICK_ELEMENT",
          controlName: "Delete All Accounts", // High risk keyword
          controlRole: "button",
          purpose: "Dangerous deletion",
        },
      ],
      explanation: "Plan with risky second step",
    };

    let observeCount = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
          if (msg.type === "REMOTEASSIST_OBSERVE_ACTIVE_TAB") {
            observeCount++;
            return {
              ok: true,
              observation: {
                origin: "https://login.salesforce.com",
                page_title: "Salesforce",
                page_fingerprint: `sha256:fp_${observeCount}`,
                application: "Salesforce",
                controls: [
                  {
                    elementId: "step-1-el",
                    role: "button",
                    name: "Step One",
                    disabled: false,
                    rectangle: { x: 0, y: 0, width: 50, height: 20 },
                  },
                  {
                    elementId: "step-2-el",
                    role: "button",
                    name: "Delete All Accounts",
                    disabled: false,
                    rectangle: { x: 0, y: 30, width: 50, height: 20 },
                  },
                ],
                visibleText: [],
                sensitiveContent: false,
                confidence: 0.9,
              },
            };
          }
          return {
            ok: true,
            result: {
              status: "executed",
              result: {
                element_found: true,
                action_dispatched: true,
                page_changed: true,
                verification_result: "passed",
                failure_code: null,
              },
            },
          };
        }),
      },
    });

    await act(async () => {
      root.render(
        <ControlPanel
          sessionId="session_123"
          tabId={1}
          observation={{
            ...observation,
            controls: [
              {
                elementId: "step-1-el",
                role: "button",
                name: "Step One",
                disabled: false,
                rectangle: { x: 0, y: 0, width: 50, height: 20 },
              },
            ],
          }}
          plan={riskyPlan}
          onPlanCompleted={onPlanCompleted}
          onDismiss={onDismiss}
          onExecutingChange={onExecutingChange}
        />,
      );
    });

    const approveButton = container.querySelector(".control-button");
    await act(async () => {
      (approveButton as HTMLElement).click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    // Risky second step was rejected before proposeBrowserAction could execute it
    expect(proposeBrowserAction).toHaveBeenCalledTimes(1);
    expect(recordPlanResult).toHaveBeenCalledWith(
      "session_123",
      "plan_risky_step",
      "failed",
      2,
      1,
      expect.stringContaining("Target control was not found on the live page"), // or failed safety policy
      1,
    );
    expect(container.textContent).toContain("Stopped safely");
  });

  // TEST 3: Abort mid-chain after step 1 prevents step 2 from executing
  it("Test 3: Abort mid-chain after step 1 prevents step 2 from executing", async () => {
    const plan: ResolutionPlan = {
      planId: "plan_abort_test",
      steps: [
        {
          id: "step_1",
          actionType: "CLICK_ELEMENT",
          controlName: "Step One",
          controlRole: "button",
          purpose: "Click step one",
        },
        {
          id: "step_2",
          actionType: "CLICK_ELEMENT",
          controlName: "Step Two",
          controlRole: "button",
          purpose: "Click step two",
        },
      ],
      explanation: "Abort mid-chain test",
    };

    let stepExecutionCount = 0;
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
          if (msg.type === "REMOTEASSIST_OBSERVE_ACTIVE_TAB") {
            return {
              ok: true,
              observation: {
                origin: "https://login.salesforce.com",
                page_title: "Salesforce",
                page_fingerprint: "sha256:fp",
                application: "Salesforce",
                controls: [
                  {
                    elementId: "s1",
                    role: "button",
                    name: "Step One",
                    disabled: false,
                    rectangle: { x: 0, y: 0, width: 10, height: 10 },
                  },
                  {
                    elementId: "s2",
                    role: "button",
                    name: "Step Two",
                    disabled: false,
                    rectangle: { x: 0, y: 20, width: 10, height: 10 },
                  },
                ],
                visibleText: [],
                sensitiveContent: false,
                confidence: 0.9,
              },
            };
          }
          if (msg.type === "REMOTEASSIST_EXECUTE_ACTIVE_TAB") {
            stepExecutionCount++;
            return {
              ok: true,
              result: {
                status: "executed",
                result: {
                  element_found: true,
                  action_dispatched: true,
                  page_changed: true,
                  verification_result: "passed",
                  failure_code: null,
                },
              },
            };
          }
          return { ok: true, result: { success: true } };
        }),
      },
    });

    await act(async () => {
      root.render(
        <ControlPanel
          sessionId="session_123"
          tabId={1}
          observation={observation}
          plan={plan}
          onPlanCompleted={onPlanCompleted}
          onDismiss={onDismiss}
          onExecutingChange={onExecutingChange}
        />,
      );
    });

    const approveButton = container.querySelector(".control-button");
    await act(async () => {
      (approveButton as HTMLElement).click();
    });

    // While executing, find the stop/abort button and click it
    await act(async () => {
      const abortButton = container.querySelector(".abort-button");
      if (abortButton) {
        (abortButton as HTMLElement).click();
      }
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    // Check that abort was recorded and step 2 never ran
    expect(recordPlanResult).toHaveBeenCalledWith(
      "session_123",
      "plan_abort_test",
      "aborted",
      2,
      expect.any(Number),
      expect.stringContaining("Plan stopped by user"),
      expect.any(Number),
    );
    expect(container.textContent).toContain("Plan Stopped");
  });

  // TEST 4: Plan exceeding step cap is truncated/warned
  it("Test 4: Plan exceeding step cap is truncated/warned", async () => {
    const overSizedPlan: ResolutionPlan = {
      planId: "plan_oversized",
      steps: [
        {
          id: "s1",
          actionType: "CLICK_ELEMENT",
          controlName: "1",
          controlRole: "button",
          purpose: "1",
        },
        {
          id: "s2",
          actionType: "CLICK_ELEMENT",
          controlName: "2",
          controlRole: "button",
          purpose: "2",
        },
        {
          id: "s3",
          actionType: "CLICK_ELEMENT",
          controlName: "3",
          controlRole: "button",
          purpose: "3",
        },
        {
          id: "s4",
          actionType: "CLICK_ELEMENT",
          controlName: "4",
          controlRole: "button",
          purpose: "4",
        },
        {
          id: "s5",
          actionType: "CLICK_ELEMENT",
          controlName: "5",
          controlRole: "button",
          purpose: "5",
        },
      ],
      truncated: true,
      warning: "Plan capped at maximum 5 steps for safety.",
      explanation: "Oversized plan demonstration",
    };

    await act(async () => {
      root.render(
        <ControlPanel
          sessionId="session_123"
          tabId={1}
          observation={observation}
          plan={overSizedPlan}
          onPlanCompleted={onPlanCompleted}
          onDismiss={onDismiss}
          onExecutingChange={onExecutingChange}
        />,
      );
    });

    const banner = container.querySelector(".plan-warning-banner");
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(
      "Plan capped at maximum 5 steps for safety.",
    );

    const stepItems = container.querySelectorAll(".plan-step-item");
    expect(stepItems.length).toBe(5);
  });

  // TEST 5: Full 3-step happy path executes in order, individually audited and linked
  it("Test 5: Full 3-step happy path executes in order, individually audited and linked", async () => {
    const threeStepPlan: ResolutionPlan = {
      planId: "plan_happy_path_123",
      steps: [
        {
          id: "step_1",
          actionType: "CLICK_ELEMENT",
          controlName: "Step Alpha",
          controlRole: "button",
          purpose: "Alpha step",
        },
        {
          id: "step_2",
          actionType: "FOCUS_ELEMENT",
          controlName: "Step Beta",
          controlRole: "textbox",
          purpose: "Beta step",
        },
        {
          id: "step_3",
          actionType: "SCROLL_TO_ELEMENT",
          controlName: "Step Gamma",
          controlRole: "heading",
          purpose: "Gamma step",
        },
      ],
      explanation: "Complete 3-step sequence",
    };

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (msg: Record<string, unknown>) => {
          if (msg.type === "REMOTEASSIST_OBSERVE_ACTIVE_TAB") {
            return {
              ok: true,
              observation: {
                origin: "https://login.salesforce.com",
                page_title: "Salesforce",
                page_fingerprint: "sha256:fp",
                application: "Salesforce",
                controls: [
                  {
                    elementId: "a1",
                    role: "button",
                    name: "Step Alpha",
                    disabled: false,
                    rectangle: { x: 0, y: 0, width: 10, height: 10 },
                  },
                  {
                    elementId: "b1",
                    role: "textbox",
                    name: "Step Beta",
                    disabled: false,
                    rectangle: { x: 0, y: 20, width: 10, height: 10 },
                  },
                  {
                    elementId: "g1",
                    role: "heading",
                    name: "Step Gamma",
                    disabled: false,
                    rectangle: { x: 0, y: 40, width: 10, height: 10 },
                  },
                ],
                visibleText: [],
                sensitiveContent: false,
                confidence: 0.9,
              },
            };
          }
          if (msg.type === "REMOTEASSIST_EXECUTE_ACTIVE_TAB") {
            return {
              ok: true,
              result: {
                status: "executed",
                result: {
                  element_found: true,
                  action_dispatched: true,
                  page_changed: true,
                  verification_result: "passed",
                  failure_code: null,
                },
              },
            };
          }
          return { ok: true, result: { success: true } };
        }),
      },
    });

    await act(async () => {
      root.render(
        <ControlPanel
          sessionId="session_123"
          tabId={1}
          observation={observation}
          plan={threeStepPlan}
          onPlanCompleted={onPlanCompleted}
          onDismiss={onDismiss}
          onExecutingChange={onExecutingChange}
        />,
      );
    });

    const approveButton = container.querySelector(".control-button");
    await act(async () => {
      (approveButton as HTMLElement).click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });

    // 1. approvePlan called for user approval
    expect(approvePlan).toHaveBeenCalledWith(
      "session_123",
      "plan_happy_path_123",
      3,
      "https://login.salesforce.com",
    );

    // 2. Each step was proposed in order with planId and stepIndex
    expect(proposeBrowserAction).toHaveBeenNthCalledWith(
      1,
      "session_123",
      "CLICK_ELEMENT",
      "Step Alpha",
      "Alpha step",
      "button",
      null,
      "plan_happy_path_123",
      0,
    );
    expect(proposeBrowserAction).toHaveBeenNthCalledWith(
      2,
      "session_123",
      "FOCUS_ELEMENT",
      "Step Beta",
      "Beta step",
      "textbox",
      null,
      "plan_happy_path_123",
      1,
    );
    expect(proposeBrowserAction).toHaveBeenNthCalledWith(
      3,
      "session_123",
      "SCROLL_TO_ELEMENT",
      "Step Gamma",
      "Gamma step",
      "heading",
      null,
      "plan_happy_path_123",
      2,
    );

    // 3. Step 0 approved with stepIndex: 0, Steps 1 & 2 with stepIndex: 1 & 2
    expect(approveCommand).toHaveBeenNthCalledWith(
      1,
      "session_123",
      "cmd_0",
      "plan_happy_path_123",
      0,
    );
    expect(approveCommand).toHaveBeenNthCalledWith(
      2,
      "session_123",
      "cmd_1",
      "plan_happy_path_123",
      1,
    );
    expect(approveCommand).toHaveBeenNthCalledWith(
      3,
      "session_123",
      "cmd_2",
      "plan_happy_path_123",
      2,
    );

    // 4. recordPlanResult called with completed
    expect(recordPlanResult).toHaveBeenCalledWith(
      "session_123",
      "plan_happy_path_123",
      "completed",
      3,
      3,
    );

    // 5. Verification message rendered
    expect(container.textContent).toContain("Resolution plan completed");
    expect(container.textContent).toContain(
      "Plan completed successfully: all 3 steps executed and verified.",
    );
  });
});
