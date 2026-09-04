// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("microphone permission tab", () => {
  let stopTrack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <p id="permission-status"></p>
      <button id="grant-microphone"></button>
      <button id="close-permission-tab" hidden></button>
    `;
    stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: stopTrack }],
        })),
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("grants permission from a full extension page and immediately stops the probe track", async () => {
    await import("../src/microphone-permission/index.js");
    document.querySelector<HTMLButtonElement>("#grant-microphone")!.click();
    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());

    expect(
      document.querySelector<HTMLElement>("#permission-status")!.textContent,
    ).toContain("Microphone permission granted");
    expect(
      document.querySelector<HTMLButtonElement>("#grant-microphone")!.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("#close-permission-tab")!
        .hidden,
    ).toBe(false);
  });
});
