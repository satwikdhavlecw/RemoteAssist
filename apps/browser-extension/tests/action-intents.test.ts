import { describe, expect, it } from "vitest";
import type { SafeControl } from "@remoteassist/shared-types";
import { deterministicActionProposal } from "../src/sidepanel/action-intents.js";

const controls: SafeControl[] = [
  {
    elementId: "invoice-tile",
    role: "link",
    name: "Create Supplier Invoice",
    disabled: false,
    rectangle: { x: 0, y: 0, width: 220, height: 48 },
  },
  {
    elementId: "tax-tab",
    role: "tab",
    name: "Tax",
    disabled: false,
    rectangle: { x: 0, y: 60, width: 100, height: 40 },
  },
];

describe("deterministic action intents", () => {
  it("creates a click proposal for a take-me-to request", () => {
    expect(
      deterministicActionProposal("Take me to invoice page", controls),
    ).toMatchObject({
      controlName: "Create Supplier Invoice",
      controlRole: "link",
      actionType: "CLICK_ELEMENT",
    });
  });

  it("creates a scroll proposal for an explicitly named section", () => {
    expect(
      deterministicActionProposal("scroll down to tax section", controls),
    ).toMatchObject({
      controlName: "Tax",
      controlRole: "tab",
      actionType: "SCROLL_TO_ELEMENT",
    });
  });

  it("does not propose an ambiguous or non-action request", () => {
    expect(deterministicActionProposal("explain the dashboard", controls)).toBe(
      null,
    );
    expect(
      deterministicActionProposal("click on invoice", [
        ...controls,
        { ...controls[0]!, elementId: "invoice-tile-duplicate" },
      ]),
    ).toBe(null);
  });

  it("never proposes click action on container regions even if mentioned", () => {
    const controlsWithRegion: SafeControl[] = [
      {
        elementId: "page-sections-region",
        role: "region",
        name: "Page Sections",
        disabled: false,
        rectangle: { x: 0, y: 0, width: 800, height: 600 },
      },
      {
        elementId: "procurement-tab",
        role: "tab",
        name: "Procurement",
        disabled: false,
        rectangle: { x: 10, y: 10, width: 100, height: 40 },
      },
    ];

    expect(
      deterministicActionProposal(
        "Take me to procurement",
        controlsWithRegion,
      ),
    ).toMatchObject({
      controlName: "Procurement",
      controlRole: "tab",
      actionType: "CLICK_ELEMENT",
    });

    // Asking to click a region must never propose CLICK_ELEMENT
    const regionProposal = deterministicActionProposal(
      "click on Page Sections",
      controlsWithRegion,
    );
    expect(regionProposal?.actionType).not.toBe("CLICK_ELEMENT");
  });

  it("creates a click proposal for an unlock purchase order request", () => {
    const sapControls: SafeControl[] = [
      {
        elementId: "btn-unlock-4500068938",
        role: "button",
        name: "Unlock",
        disabled: false,
        rectangle: { x: 500, y: 300, width: 60, height: 28 },
      },
      {
        elementId: "search-po",
        role: "textbox",
        name: "Search Purchase Orders",
        disabled: false,
        rectangle: { x: 50, y: 100, width: 300, height: 36 },
      },
    ];

    expect(
      deterministicActionProposal(
        "Can you unlock the parchase order for me",
        sapControls,
      ),
    ).toMatchObject({
      controlName: "Unlock",
      controlRole: "button",
      actionType: "CLICK_ELEMENT",
    });
  });

  it("refuses to propose an action and avoids random fallbacks when the target is higher-risk", () => {
    const controls: SafeControl[] = [
      {
        elementId: "inv-amount",
        role: "textbox",
        name: "Invoice Total Amount",
        disabled: false,
        rectangle: { x: 10, y: 50, width: 200, height: 32 },
      },
      {
        elementId: "btn-reset",
        role: "button",
        name: "Reset",
        disabled: false,
        rectangle: { x: 10, y: 100, width: 80, height: 32 },
      },
    ];

    expect(deterministicActionProposal("click on reset", controls)).toBeNull();
    expect(deterministicActionProposal("reset the amount", controls)).toBeNull();
  });
});
