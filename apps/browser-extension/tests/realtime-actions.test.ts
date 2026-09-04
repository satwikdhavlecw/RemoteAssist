import { describe, expect, it } from "vitest";
import type { SafeControl } from "@remoteassist/shared-types";
import { parseRealtimeActionProposal } from "../src/sidepanel/realtime-actions.js";

const controls: SafeControl[] = [
  {
    elementId: "retry-button",
    role: "button",
    name: "Try Again",
    disabled: false,
    rectangle: { x: 0, y: 0, width: 100, height: 40 },
  },
  {
    elementId: "username-field",
    role: "textbox",
    name: "Username or Email",
    disabled: false,
    rectangle: { x: 0, y: 100, width: 100, height: 40 },
  },
  {
    elementId: "delete-button",
    role: "button",
    name: "Delete account",
    disabled: false,
    rectangle: { x: 0, y: 50, width: 100, height: 40 },
  },
];

describe("Realtime action proposals", () => {
  it("accepts a structured model proposal for an observed low-risk control", () => {
    expect(
      parseRealtimeActionProposal(
        {
          type: "function_call",
          name: "propose_browser_action",
          call_id: "call_safe_1",
          arguments: JSON.stringify({
            control_name: "Try Again",
            action_type: "CLICK_ELEMENT",
            purpose: "Retry the failed request once",
          }),
        },
        controls,
      ),
    ).toEqual({
      callId: "call_safe_1",
      controlName: "Try Again",
      controlRole: "button",
      actionType: "CLICK_ELEMENT",
      purpose: "Retry the failed request once",
    });
  });

  it("accepts focus for an observed non-sensitive textbox", () => {
    expect(
      parseRealtimeActionProposal(
        {
          type: "function_call",
          name: "propose_browser_action",
          call_id: "call_focus_1",
          arguments: JSON.stringify({
            control_name: "Username or Email",
            action_type: "FOCUS_ELEMENT",
            purpose: "Put the cursor in the username field for the user",
          }),
        },
        controls,
      ),
    ).toMatchObject({
      controlName: "Username or Email",
      actionType: "FOCUS_ELEMENT",
    });
  });

  it("rejects an ambiguous accessible name", () => {
    const call = {
      type: "function_call",
      name: "propose_browser_action",
      call_id: "call_duplicate",
      arguments: JSON.stringify({
        control_name: "Try Again",
        action_type: "CLICK_ELEMENT",
        purpose: "Retry once",
      }),
    };
    const duplicateControls = [
      ...controls,
      { ...controls[0]!, elementId: "retry-button-duplicate" },
    ];

    expect(parseRealtimeActionProposal(call, duplicateControls)).toBeNull();
  });

  it("rejects unobserved, malformed, and higher-risk model proposals", () => {
    for (const call of [
      {
        type: "function_call",
        name: "propose_browser_action",
        call_id: "call_missing",
        arguments: JSON.stringify({
          control_name: "Not on page",
          action_type: "CLICK_ELEMENT",
          purpose: "Click it",
        }),
      },
      {
        type: "function_call",
        name: "propose_browser_action",
        call_id: "call_delete",
        arguments: JSON.stringify({
          control_name: "Delete account",
          action_type: "CLICK_ELEMENT",
          purpose: "Remove the account",
        }),
      },
      {
        type: "function_call",
        name: "propose_browser_action",
        call_id: "call_bad_json",
        arguments: "not-json",
      },
    ]) {
      expect(parseRealtimeActionProposal(call, controls)).toBeNull();
    }
  });
});
