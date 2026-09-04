// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sanitizer = vi.hoisted(() => vi.fn());

vi.mock("../src/security/sanitize.js", () => ({
  sanitizeDocument: sanitizer,
  isSensitiveElement: () => false,
  isVisibleElement: () => true,
}));

describe("consented page-change observation", () => {
  let listener: (
    message: { type: string },
    sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => boolean;
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    sanitizer.mockReset();
    sendMessage = vi.fn(async () => undefined);
    delete (
      globalThis as typeof globalThis & { __remoteAssistInjected?: boolean }
    ).__remoteAssistInjected;
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: {
          addListener: (
            registered: (
              message: { type: string },
              sender: unknown,
              sendResponse: (response: unknown) => void,
            ) => boolean,
          ) => {
            listener = registered;
          },
        },
        sendMessage,
      },
    });
    await import("../src/content/index.js");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("publishes only a changed sanitized fingerprint and stops immediately", async () => {
    sanitizer
      .mockResolvedValueOnce({ page_fingerprint: "sha256:first" })
      .mockResolvedValueOnce({ page_fingerprint: "sha256:second" });

    const initial = new Promise<unknown>((resolve) => {
      expect(listener({ type: "REMOTEASSIST_OBSERVE" }, {}, resolve)).toBe(
        true,
      );
    });
    await expect(initial).resolves.toMatchObject({ ok: true });

    document.body.append(document.createElement("p"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(750);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "REMOTEASSIST_OBSERVATION_CHANGED",
        observation: expect.objectContaining({
          page_fingerprint: "sha256:second",
        }),
      }),
    );

    listener({ type: "REMOTEASSIST_STOP" }, {}, vi.fn());
    document.body.append(document.createElement("p"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(750);
    expect(sanitizer).toHaveBeenCalledTimes(2);
  });
});
