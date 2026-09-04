import type { ControlCommand } from "@remoteassist/command-schema";
import { executeBrowserCommand } from "../control-executor/execute.js";
import { clearOverlay, highlightElement } from "../overlays/render.js";
import { sanitizeDocument } from "../security/sanitize.js";

interface ContentMessage {
  type:
    | "REMOTEASSIST_OBSERVE"
    | "REMOTEASSIST_HIGHLIGHT"
    | "REMOTEASSIST_EXECUTE_COMMAND"
    | "REMOTEASSIST_CLEAR"
    | "REMOTEASSIST_STOP";
  elementId?: string;
  message?: string;
  command?: ControlCommand;
}

const globalState = globalThis as typeof globalThis & {
  __remoteAssistInjected?: boolean;
};

if (!globalState.__remoteAssistInjected) {
  globalState.__remoteAssistInjected = true;
  let observationEnabled = false;
  let lastFingerprint: string | null = null;
  let observationTimer: ReturnType<typeof setTimeout> | null = null;
  let pageObserver: MutationObserver | null = null;

  function stopObservationMonitor(): void {
    pageObserver?.disconnect();
    pageObserver = null;
    if (observationTimer) clearTimeout(observationTimer);
    observationTimer = null;
    lastFingerprint = null;
  }

  function isInvalidatedExtensionError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /extension context invalidated|receiving end does not exist/i.test(
        error.message,
      )
    );
  }

  async function publishChangedObservation(): Promise<void> {
    observationTimer = null;
    if (!observationEnabled) return;
    const observation = await sanitizeDocument();
    if (observation.page_fingerprint === lastFingerprint) return;
    lastFingerprint = observation.page_fingerprint;
    try {
      await chrome.runtime.sendMessage({
        type: "REMOTEASSIST_OBSERVATION_CHANGED",
        observation,
      });
    } catch (error) {
      // A developer reload can invalidate this content script while its page
      // observer is still alive. Stop it without creating an uncaught promise.
      if (isInvalidatedExtensionError(error)) {
        observationEnabled = false;
        stopObservationMonitor();
      }
    }
  }

  function startObservationMonitor(fingerprint: string): void {
    stopObservationMonitor();
    lastFingerprint = fingerprint;
    pageObserver = new MutationObserver(() => {
      if (observationTimer) clearTimeout(observationTimer);
      observationTimer = setTimeout(() => {
        void publishChangedObservation();
      }, 750);
    });
    pageObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender, sendResponse) => {
      if (message.type === "REMOTEASSIST_OBSERVE") {
        observationEnabled = true;
        void sanitizeDocument()
          .then((observation) => {
            startObservationMonitor(observation.page_fingerprint);
            sendResponse({ ok: true, observation });
          })
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error ? error.message : "Observation failed",
            }),
          );
        return true;
      }
      if (message.type === "REMOTEASSIST_HIGHLIGHT") {
        const highlighted =
          observationEnabled &&
          Boolean(message.elementId) &&
          highlightElement(
            message.elementId!,
            message.message ?? "Continue here",
          );
        sendResponse({ ok: highlighted });
        return false;
      }
      if (message.type === "REMOTEASSIST_EXECUTE_COMMAND") {
        if (!observationEnabled || !message.command) {
          sendResponse({
            ok: false,
            error: "Observation or command authorization is missing.",
          });
          return false;
        }
        void executeBrowserCommand(message.command)
          .then((execution) => sendResponse({ ok: true, ...execution }))
          .catch((error: unknown) =>
            sendResponse({
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Command execution failed",
            }),
          );
        return true;
      }
      if (message.type === "REMOTEASSIST_CLEAR") {
        clearOverlay();
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "REMOTEASSIST_STOP") {
        observationEnabled = false;
        stopObservationMonitor();
        clearOverlay();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    },
  );
}
