import { afterEach, describe, expect, it, vi } from "vitest";

describe("background startup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("reports the wrong context instead of throwing when runtime APIs are absent", async () => {
    vi.stubGlobal("chrome", {});
    const report = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("../src/background/index.js")).resolves.toBeTruthy();

    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("must run as the extension service worker"),
    );
  });

  it("keeps using the approved support tab after browser focus changes", async () => {
    let runtimeListener: (
      message: { type: string; tabId?: number },
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean = () => false;
    const supportTab = {
      id: 42,
      url: "http://127.0.0.1:4320/salesforce-saml",
      title: "Affected page",
    };
    const executeScript = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener) => {
            runtimeListener = listener;
          }),
        },
      },
      sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
      tabs: {
        query: vi.fn(async () => [supportTab]),
        get: vi.fn(async (tabId: number) => ({ ...supportTab, id: tabId })),
        sendMessage,
      },
      scripting: { executeScript },
    });

    await import("../src/background/index.js");

    const dispatch = (message: { type: string; tabId?: number }) =>
      new Promise<unknown>((resolve) => {
        expect(runtimeListener(message, {}, resolve)).toBe(true);
      });
    await expect(
      dispatch({ type: "REMOTEASSIST_PREPARE_ACTIVE_TAB", tabId: 42 }),
    ).resolves.toMatchObject({ ok: true, tab: { tabId: 42 } });
    await expect(
      dispatch({ type: "REMOTEASSIST_OBSERVE_ACTIVE_TAB", tabId: 42 }),
    ).resolves.toMatchObject({ ok: true });

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 42 } }),
    );
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: "REMOTEASSIST_OBSERVE",
    });
  });
});
