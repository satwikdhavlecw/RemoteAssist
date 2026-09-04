import type { ControlCommand } from "@remoteassist/command-schema";
import { evaluateOrigin, normalizeOrigin } from "@remoteassist/policy-model";

interface BackgroundMessage {
  type:
    | "REMOTEASSIST_ACTIVE_TAB"
    | "REMOTEASSIST_PREPARE_ACTIVE_TAB"
    | "REMOTEASSIST_OBSERVE_ACTIVE_TAB"
    | "REMOTEASSIST_HIGHLIGHT_ACTIVE_TAB"
    | "REMOTEASSIST_EXECUTE_ACTIVE_TAB"
    | "REMOTEASSIST_CLEAR_ACTIVE_TAB"
    | "REMOTEASSIST_STOP_ACTIVE_TAB"
    | "REMOTEASSIST_OBSERVATION_CHANGED";
  elementId?: string;
  message?: string;
  command?: ControlCommand;
  tabId?: number;
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id || !(tab.url ?? tab.pendingUrl))
    throw new Error(
      "Activate the affected web page, then click the RemoteAssist toolbar icon again.",
    );
  return tab;
}

async function targetTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (!tabId) return activeTab();
  const tab = await chrome.tabs.get(tabId);
  if (!tab.id || !(tab.url ?? tab.pendingUrl)) {
    throw new Error(
      "The selected support tab is no longer available. Activate it and start a new support session.",
    );
  }
  return tab;
}

function safeTabContext(tab: chrome.tabs.Tab) {
  const origin = normalizeOrigin(tab.url ?? tab.pendingUrl ?? "");
  if (!origin)
    throw new Error("RemoteAssist can observe only HTTP or HTTPS pages.");
  const decision = evaluateOrigin(origin, [origin]);
  if (!decision.allowed) {
    throw new Error(
      decision.reason === "restricted_origin"
        ? "This application is restricted. Visual observation is disabled."
        : "This page is not approved for observation.",
    );
  }
  return { tabId: tab.id!, origin, title: tab.title ?? "Current tab" };
}

async function sendToTargetTab(
  tabId: number | undefined,
  message: unknown,
): Promise<unknown> {
  const tab = await targetTab(tabId);
  safeTabContext(tab);
  return chrome.tabs.sendMessage(tab.id!, message);
}

const extensionRuntime = globalThis.chrome?.runtime;

if (!extensionRuntime?.onInstalled || !extensionRuntime.onMessage) {
  console.error(
    "RemoteAssist background.js must run as the extension service worker. Load apps/browser-extension/dist from chrome://extensions.",
  );
} else {
  extensionRuntime.onInstalled.addListener(() => {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  extensionRuntime.onMessage.addListener(
    (
      message: BackgroundMessage,
      _sender,
      sendResponse: (response: unknown) => void,
    ) => {
      if (message.type === "REMOTEASSIST_OBSERVATION_CHANGED") return false;
      void (async () => {
        if (message.type === "REMOTEASSIST_ACTIVE_TAB") {
          return { ok: true, tab: safeTabContext(await activeTab()) };
        }
        if (message.type === "REMOTEASSIST_PREPARE_ACTIVE_TAB") {
          const tab = await targetTab(message.tabId);
          const context = safeTabContext(tab);
          await chrome.scripting.executeScript({
            target: { tabId: context.tabId },
            files: ["content.js"],
          });
          return { ok: true, tab: context };
        }
        if (message.type === "REMOTEASSIST_OBSERVE_ACTIVE_TAB") {
          return sendToTargetTab(message.tabId, {
            type: "REMOTEASSIST_OBSERVE",
          });
        }
        if (message.type === "REMOTEASSIST_HIGHLIGHT_ACTIVE_TAB") {
          return sendToTargetTab(message.tabId, {
            type: "REMOTEASSIST_HIGHLIGHT",
            elementId: message.elementId,
            message: message.message,
          });
        }
        if (message.type === "REMOTEASSIST_EXECUTE_ACTIVE_TAB") {
          if (!message.command)
            throw new Error("The authorized command is missing.");
          return sendToTargetTab(message.tabId, {
            type: "REMOTEASSIST_EXECUTE_COMMAND",
            command: message.command,
          });
        }
        if (message.type === "REMOTEASSIST_CLEAR_ACTIVE_TAB") {
          return sendToTargetTab(message.tabId, {
            type: "REMOTEASSIST_CLEAR",
          });
        }
        if (message.type === "REMOTEASSIST_STOP_ACTIVE_TAB") {
          return sendToTargetTab(message.tabId, {
            type: "REMOTEASSIST_STOP",
          });
        }
        throw new Error("Unsupported extension message.");
      })()
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Extension request failed",
          }),
        );
      return true;
    },
  );
}
