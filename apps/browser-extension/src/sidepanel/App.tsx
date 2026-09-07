import { useEffect, useRef, useState } from "react";
import type {
  ConsentGrant,
  KnowledgeSearchResponse,
  ResolutionPlan,
  SanitizedObservation,
  SupportSession,
} from "@remoteassist/shared-types";
import type { BrowserObservationPayload } from "../security/sanitize.js";
import {
  createSession,
  endSession,
  grantScreenConsent,
  pauseSession,
  resumeSession,
  revokeConsent,
  searchKnowledge,
  suggestBrowserAction,
  submitObservation,
} from "./api.js";
import { ControlPanel } from "./ControlPanel.js";
import { OperationsPanel } from "./OperationsPanel.js";
import { VoiceControls } from "./VoiceControls.js";
import { tabDisplayMediaOptions } from "./media-options.js";
import type { RealtimeActionProposal } from "./realtime-actions.js";
import { isPotentiallyLowRiskAction } from "@remoteassist/policy-model";
import { deterministicActionProposal } from "./action-intents.js";

type PanelState =
  | "ready"
  | "connecting"
  | "awaiting_screen"
  | "observing"
  | "guiding"
  | "paused"
  | "completed"
  | "error";

interface RuntimeResponse<T = unknown> {
  ok: boolean;
  error?: string;
  tab?: { tabId: number; origin: string; title: string };
  observation?: T;
}

interface SelectedTab {
  tabId: number;
  origin: string;
  title: string;
}

interface ObservationChangedMessage {
  type: "REMOTEASSIST_OBSERVATION_CHANGED";
  observation: BrowserObservationPayload;
}

interface ActionFollowUp {
  id: number;
  summary: string;
}

type ConversationTurn = { sender: "user" | "system"; text: string };

function guidanceReply(result: KnowledgeSearchResponse): string {
  const guidance = result.groundedGuidance;
  const parts = [guidance.inferred];
  if (guidance.proposedNextStep) parts.push(guidance.proposedNextStep);
  return parts.filter(Boolean).join(" ");
}

const stateLabels: Record<PanelState, string> = {
  ready: "Ready",
  connecting: "Connecting",
  awaiting_screen: "Screen permission required",
  observing: "AI is observing",
  guiding: "Guiding",
  paused: "Paused",
  completed: "Session complete",
  error: "Needs attention",
};

const legacyTabsEnabled = false;

const WELCOME_MESSAGE: ConversationTurn = {
  sender: "system",
  text: "👋 Hi there! RemoteAssist is here to help you out. Tell me what issue you are facing or what you need to achieve, and I will guide you through it.",
};

async function extensionMessage<T>(
  message: Record<string, unknown>,
): Promise<RuntimeResponse<T>> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as RuntimeResponse<T>;
  if (!response?.ok)
    throw new Error(
      response?.error ?? "The extension could not complete the request.",
    );
  return response;
}

export function App() {
  const [panelState, setPanelState] = useState<PanelState>("ready");
  const [session, setSession] = useState<SupportSession | null>(null);
  const [screenConsent, setScreenConsent] = useState<ConsentGrant | null>(null);
  const [issue, setIssue] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [chatHistory, setChatHistory] = useState<ConversationTurn[]>([
    WELCOME_MESSAGE,
  ]);
  const [chatInput, setChatInput] = useState("");
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [observation, setObservation] = useState<SanitizedObservation | null>(
    null,
  );
  const [guidance, setGuidance] = useState<KnowledgeSearchResponse | null>(
    null,
  );
  const [actionProposal, setActionProposal] =
    useState<RealtimeActionProposal | null>(null);
  const [actionPlan, setActionPlan] = useState<ResolutionPlan | null>(null);
  const [actionExecuting, setActionExecuting] = useState(false);
  const [actionFollowUp, setActionFollowUp] = useState<ActionFollowUp | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<SelectedTab | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const stopping = useRef(false);
  const observedTabId = useRef<number | null>(null);
  const latestObservationFingerprint = useRef<string | null>(null);
  const observationQueue = useRef<Promise<void>>(Promise.resolve());
  const actionFollowUpSequence = useRef(0);
  const actionExecutingRef = useRef(false);

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [chatHistory]);

  function stopLocalAccess(): void {
    mediaStream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    mediaStream.current = null;
    void chrome.runtime
      .sendMessage({
        type: "REMOTEASSIST_STOP_ACTIVE_TAB",
        tabId: observedTabId.current,
      })
      .catch(() => undefined);
  }

  async function selectAffectedTab(): Promise<void> {
    setError(null);
    setPanelState("connecting");
    let temporaryTabsGranted = false;
    try {
      const granted = await chrome.permissions.request({
        permissions: ["tabs"],
      });
      if (!granted) {
        throw new Error(
          "Chrome did not allow RemoteAssist to identify the affected tab.",
        );
      }
      temporaryTabsGranted = true;
      const response = await extensionMessage({
        type: "REMOTEASSIST_ACTIVE_TAB",
      });
      setSelectedTab(response.tab!);
      setPanelState("ready");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not select the affected tab.",
      );
      setPanelState("error");
    } finally {
      if (temporaryTabsGranted) {
        await chrome.permissions
          .remove({ permissions: ["tabs"] })
          .catch(() => false);
      }
    }
  }

  async function beginSession(): Promise<void> {
    if (!selectedTab) return;
    setError(null);
    setPanelState("connecting");
    try {
      const url = new URL(selectedTab.origin);
      const originPattern = `${url.protocol}//${url.hostname}/*`;
      const granted = await chrome.permissions.request({
        origins: [originPattern],
      });
      if (!granted) {
        throw new Error(
          `Chrome did not allow RemoteAssist to observe ${selectedTab.origin}.`,
        );
      }
      observedTabId.current = selectedTab.tabId;
      const created = await createSession(selectedTab.origin, voiceEnabled);
      setSession(created);
      setChatHistory([
        WELCOME_MESSAGE,
        ...(issue.trim() ? [{ sender: "user" as const, text: issue.trim() }] : []),
      ]);
      setPanelState("awaiting_screen");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not start support.",
      );
      setPanelState("error");
    }
  }

  function toRawPayload(obs: SanitizedObservation): BrowserObservationPayload {
    return {
      origin: obs.origin,
      page_title: obs.pageTitle,
      page_fingerprint: obs.pageFingerprint,
      application: obs.application,
      screen_state: obs.screenState,
      visible_text: obs.visibleText,
      controls: obs.controls,
      sensitive_content: obs.sensitiveContent,
      confidence: obs.confidence,
    };
  }

  async function updateIssueAndSearch(
    newIssue: string,
    trigger: "chat" | "voice" = "chat",
    history: ConversationTurn[] = chatHistory,
  ): Promise<RealtimeActionProposal | null> {
    setIssue(newIssue);
    if (actionExecuting) {
      if (!session || !observation) return null;
      try {
        const result = await searchKnowledge(
          session.id,
          newIssue,
          toRawPayload(observation),
        );
        setGuidance(result);
        setChatHistory((current) => [
          ...current,
          { sender: "system" as const, text: guidanceReply(result) },
        ]);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Error retrieving guidance.",
        );
      }
      return null;
    }

    setActionProposal(null);
    if (!session) return null;

    let activeObs = observation;
    if (observedTabId.current) {
      try {
        const fresh = await extensionMessage<BrowserObservationPayload>({
          type: "REMOTEASSIST_OBSERVE_ACTIVE_TAB",
          tabId: observedTabId.current,
        });
        if (fresh.observation) {
          const recorded = await submitObservation(
            session.id,
            fresh.observation,
          );
          latestObservationFingerprint.current = recorded.pageFingerprint;
          setObservation(recorded);
          activeObs = recorded;
        }
      } catch {
        // Fallback to active state observation if tab message momentarily times out
      }
    }

    if (!activeObs) return null;
    try {
      const result = await searchKnowledge(
        session.id,
        newIssue,
        toRawPayload(activeObs),
      );
      setGuidance(result);
      const systemText = guidanceReply(result);
      const historyWithSystem = [
        ...history,
        { sender: "system" as const, text: systemText },
      ];
      setChatHistory(historyWithSystem);
      const proposedStep = result.groundedGuidance?.proposedNextStep ?? "";
      const actionQuery =
        proposedStep &&
        /\b(?:navigate|open|click|go|select|access|check|inspect|unlock|release|clear)\b/i.test(proposedStep)
          ? `${newIssue}. ${proposedStep}`
          : newIssue;
      return await requestActionSuggestion(
        actionQuery,
        trigger,
        historyWithSystem,
        activeObs,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not retrieve guidance for the new message.",
      );
      return null;
    }
  }

  async function requestActionSuggestion(
    query: string,
    trigger:
      "initial_observation" | "chat" | "voice" | "page_changed" | "manual",
    history: ConversationTurn[] = chatHistory,
    currentObservation: SanitizedObservation | null = observation,
  ): Promise<RealtimeActionProposal | null> {
    if (!session || panelState === "paused") return null;
    const requestObservationFingerprint =
      currentObservation?.pageFingerprint ??
      latestObservationFingerprint.current;
    const localProposal = currentObservation
      ? deterministicActionProposal(
          query.trim() || issue.trim(),
          currentObservation.controls,
        )
      : null;
    try {
      const result = await suggestBrowserAction(
        session.id,
        query.trim() || issue.trim(),
        trigger,
        history,
      );
      // The API/LLM is advisory. Resolve explicit, low-risk requests locally
      // from the same observation shown in the panel when it returns no
      // proposal, so a slow or conservative model cannot hide a safe action.
      const modelProposal = result.proposal;
      const modelCandidates =
        modelProposal && currentObservation
          ? currentObservation.controls.filter(
              (control) =>
                (control.name.toLowerCase() ===
                  modelProposal.controlName.toLowerCase() ||
                  control.name
                    .toLowerCase()
                    .startsWith(modelProposal.controlName.toLowerCase()) ||
                  control.name
                    .toLowerCase()
                    .includes(modelProposal.controlName.toLowerCase()) ||
                  modelProposal.controlName
                    .toLowerCase()
                    .includes(control.name.toLowerCase())) &&
                isPotentiallyLowRiskAction(modelProposal.actionType, control),
            )
          : [];
      const modelRoleMatches = modelCandidates.filter(
        (control) =>
          control.role.toLowerCase() ===
          modelProposal?.controlRole.toLowerCase(),
      );
      const modelMatchesCurrentObservation =
        modelRoleMatches.length >= 1 || modelCandidates.length >= 1;
      const proposal = modelMatchesCurrentObservation
        ? modelProposal
        : localProposal;
      const matchesLatest =
        requestObservationFingerprint ===
          latestObservationFingerprint.current ||
        (proposal &&
          (observation?.controls.some(
            (c) =>
              c.name.toLowerCase() === proposal.controlName.toLowerCase() ||
              c.name.toLowerCase().includes(proposal.controlName.toLowerCase()) ||
              proposal.controlName.toLowerCase().includes(c.name.toLowerCase()),
          ) ??
            false));
      if (result.plan?.blockedByPolicy) {
        setActionPlan(result.plan);
        setActionProposal(null);
        return null;
      }
      if (proposal && matchesLatest) {
        setActionProposal(proposal);
        if (result.plan) setActionPlan(result.plan);
        return proposal;
      }
      return null;
    } catch (caught) {
      // Keep deterministic navigation usable during a transient LLM/API
      // failure. The command still goes through the server policy engine.
      const matchesLatest =
        requestObservationFingerprint ===
          latestObservationFingerprint.current ||
        (localProposal &&
          (observation?.controls.some(
            (c) =>
              c.name.toLowerCase() ===
                localProposal.controlName.toLowerCase() ||
              c.name
                .toLowerCase()
                .includes(localProposal.controlName.toLowerCase()) ||
              localProposal.controlName
                .toLowerCase()
                .includes(c.name.toLowerCase()),
          ) ??
            false));
      if (localProposal && matchesLatest) {
        setActionProposal(localProposal);
        setActionPlan(null);
        return localProposal;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "AI could not review the current page actions.",
      );
      return null;
    }
  }

  async function handleSendChat(): Promise<void> {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    const nextHistory = [...chatHistory, { sender: "user" as const, text }];
    setChatHistory(nextHistory);
    await updateIssueAndSearch(text, "chat", nextHistory);
  }

  async function handleTranscriptConfirmed(
    transcript: string,
  ): Promise<RealtimeActionProposal | null> {
    const nextHistory = [
      ...chatHistory,
      { sender: "user" as const, text: transcript },
    ];
    setChatHistory(nextHistory);
    return await updateIssueAndSearch(transcript, "voice", nextHistory);
  }

  async function beginObservation(existingSession = session): Promise<void> {
    if (!existingSession) return;
    setError(null);
    setActionProposal(null);
    setPanelState("awaiting_screen");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(
        tabDisplayMediaOptions as DisplayMediaStreamOptions,
      );
      mediaStream.current = stream;
      stream.getVideoTracks()[0]!.onended = () =>
        void emergencyStop("Screen sharing ended.");

      const prepared = await extensionMessage({
        type: "REMOTEASSIST_PREPARE_ACTIVE_TAB",
        tabId: observedTabId.current,
      });
      observedTabId.current = prepared.tab!.tabId;
      const consent = await grantScreenConsent(
        existingSession.id,
        prepared.tab!.origin,
      );
      setScreenConsent(consent);
      setPanelState("observing");

      const observed = await extensionMessage<BrowserObservationPayload>({
        type: "REMOTEASSIST_OBSERVE_ACTIVE_TAB",
        tabId: observedTabId.current,
      });
      const recorded = await submitObservation(
        existingSession.id,
        observed.observation!,
      );
      latestObservationFingerprint.current = recorded.pageFingerprint;
      setObservation(recorded);

      const result = await searchKnowledge(
        existingSession.id,
        issue,
        observed.observation!,
      );
      setGuidance(result);
      const systemText = guidanceReply(result);
      const historyWithSystem = [
        ...chatHistory,
        { sender: "system" as const, text: systemText },
      ];
      setChatHistory(historyWithSystem);
      await requestActionSuggestion(
        issue,
        "initial_observation",
        historyWithSystem,
        recorded,
      );
      setPanelState("guiding");
    } catch (caught) {
      stopLocalAccess();
      setError(
        caught instanceof Error
          ? caught.message
          : "Observation could not start.",
      );
      setPanelState("error");
    }
  }

  async function pause(): Promise<void> {
    if (!session) return;
    stopLocalAccess();
    setPanelState("paused");
    try {
      const updated = await pauseSession(session.id);
      setSession(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not pause the session.",
      );
      setPanelState("error");
    }
  }

  async function resume(): Promise<void> {
    if (!session) return;
    try {
      const updated = await resumeSession(session.id);
      setSession(updated);
      await beginObservation(updated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not resume the session.",
      );
      setPanelState("error");
    }
  }

  async function emergencyStop(
    reason = "You stopped all access.",
  ): Promise<void> {
    if (stopping.current) return;
    stopping.current = true;
    stopLocalAccess();
    setError(null);
    try {
      let updated = session;
      if (session && screenConsent) {
        updated = await revokeConsent(session.id, screenConsent.id);
      }
      if (session) updated = await endSession(session.id);
      if (updated) setSession(updated);
      setPanelState("completed");
      setActionProposal(null);
      setGuidance((current) =>
        current
          ? {
              ...current,
              groundedGuidance: {
                ...current.groundedGuidance,
                proposedNextStep: reason,
              },
            }
          : current,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Local access stopped; server cleanup failed.",
      );
      setPanelState("error");
    } finally {
      stopping.current = false;
    }
  }

  const active = ["observing", "guiding", "paused"].includes(panelState);

  function handleActionCompleted(
    refreshedObservation: SanitizedObservation,
    summary: string,
  ): void {
    latestObservationFingerprint.current = refreshedObservation.pageFingerprint;
    setObservation(refreshedObservation);
    actionExecutingRef.current = false;
    setActionExecuting(false);
    actionFollowUpSequence.current += 1;
    setActionFollowUp({ id: actionFollowUpSequence.current, summary });
  }

  function handleDismissAction(): void {
    setActionProposal(null);
    setActionPlan(null);
    actionExecutingRef.current = false;
    setActionExecuting(false);
  }


  useEffect(() => {
    if (!session || !["observing", "guiding"].includes(panelState)) return;
    const listener = (
      message: ObservationChangedMessage,
      sender: chrome.runtime.MessageSender,
    ) => {
      if (
        message.type !== "REMOTEASSIST_OBSERVATION_CHANGED" ||
        !message.observation ||
        sender.tab?.id !== observedTabId.current ||
        message.observation.page_fingerprint ===
          latestObservationFingerprint.current
      ) {
        return false;
      }

      observationQueue.current = observationQueue.current
        .then(async () => {
          if (
            message.observation.page_fingerprint ===
            latestObservationFingerprint.current
          ) {
            return;
          }
          const recorded = await submitObservation(
            session.id,
            message.observation,
          );
          latestObservationFingerprint.current = recorded.pageFingerprint;
          setObservation(recorded);
          if (actionExecutingRef.current) {
            return;
          }
          if (issue.trim()) {
            const refreshedGuidance = await searchKnowledge(
              session.id,
              issue,
              message.observation,
            );
            setGuidance(refreshedGuidance);
          }
          setError(null);
        })
        .catch(() => {
          setError(
            "The page changed, but RemoteAssist could not refresh its sanitized view.",
          );
        });
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [panelState, session, issue, chatHistory]);

  return (
    <main className="panel-shell">
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true">
          RA
        </div>
        <div>
          <h1>RemoteAssist</h1>
        </div>
        <div className="header-state">
          <span
            className={`status-dot status-${panelState}`}
            aria-hidden="true"
          />
          <span>{stateLabels[panelState]}</span>
        </div>
      </header>

      {error && (
        <div className="error-card" role="alert">
          <strong>RemoteAssist paused safely</strong>
          <p>{error}</p>
        </div>
      )}

      {!session && (
        <section className="card intro-card">
          <div className="welcome-banner">
            <span className="welcome-banner-icon" aria-hidden="true">
              👋
            </span>
            <div className="welcome-banner-content">
              <strong>Hi there! RemoteAssist is here to help you out.</strong>
              <p>
                Tell me what issue you are facing or what you need to achieve,
                and I will guide you step by step.
              </p>
            </div>
          </div>
          <p className="section-label">Start support</p>
          <label htmlFor="issue">What do you need help with?</label>
          <textarea
            id="issue"
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
            rows={4}
            placeholder="For example: Salesforce shows an authentication error"
          />
          <label className="switch-row">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(event) => setVoiceEnabled(event.target.checked)}
            />
            <span>
              <strong>Voice guidance</strong>
              <small>Optional microphone guidance</small>
            </span>
          </label>
          {selectedTab ? (
            <>
              <div className="mode-notice" role="status">
                Selected page: <strong>{selectedTab.origin}</strong>
              </div>
              <button
                className="primary-button"
                onClick={() => void beginSession()}
                disabled={!issue.trim() || panelState === "connecting"}
              >
                Allow this site and start support
              </button>
              <button
                className="text-button"
                onClick={() => void selectAffectedTab()}
                disabled={panelState === "connecting"}
              >
                Select a different active page
              </button>
            </>
          ) : (
            <button
              className="primary-button"
              onClick={() => void selectAffectedTab()}
              disabled={panelState === "connecting"}
            >
              {panelState === "connecting"
                ? "Selecting current page…"
                : "Use this page"}
            </button>
          )}
          <p className="privacy-note">
            You choose the browser tab before anything is observed.
          </p>
        </section>
      )}

      {session && panelState === "awaiting_screen" && (
        <section className="card consent-card">
          <div className="consent-icon" aria-hidden="true">
            ◉
          </div>
          <p className="section-label">Your permission</p>
          <h2>Share the affected browser tab</h2>
          <p>
            RemoteAssist will refresh a sanitized page summary when the shared
            tab changes. Display pixels are not sent to the AI provider.
            Passwords, one-time codes, hidden fields, tokens, and payment fields
            are excluded.
          </p>
          <ul>
            <li>You choose the tab in Chrome or Edge.</li>
            <li>
              Actions stay off unless AI proposes an eligible current control
              and you grant separate allow-once consent.
            </li>
            <li>You can stop immediately at any time.</li>
          </ul>
          <button
            className="primary-button"
            onClick={() => void beginObservation()}
          >
            Choose a tab
          </button>
          <button
            className="text-button"
            onClick={() => void emergencyStop("Session ended before sharing.")}
          >
            End without sharing
          </button>
        </section>
      )}

      {session && active && (
        <>
          {legacyTabsEnabled && (
            <div className="tab-switcher">
              <button className="tab-btn" onClick={() => undefined}>
                💬 Chat
              </button>
              <button className="tab-btn" onClick={() => undefined}>
                🎙️ Voice
              </button>
            </div>
          )}

          {observation && (
            <div className="context-strip">
              <span>Watching</span>
              <strong>
                {observation.application ?? "Supported browser page"}
              </strong>
              <small>
                {observation.screenState?.replaceAll("_", " ") ??
                  (observation.pageTitle || "Page state captured")}
              </small>
            </div>
          )}

          {observation && (actionPlan || actionProposal) && (
            <ControlPanel
              sessionId={session.id}
              tabId={observedTabId.current!}
              observation={observation}
              plan={actionPlan ?? undefined}
              proposal={actionProposal ?? undefined}
              onActionCompleted={handleActionCompleted}
              onPlanCompleted={handleActionCompleted}
              onDismiss={handleDismissAction}
              onExecutingChange={(executing) => {
                actionExecutingRef.current = executing;
                setActionExecuting(executing);
              }}
            />
          )}

          <section className="card conversation-card chat-card">
            <p className="section-label">Conversation</p>
            <div className="chat-messages" ref={chatMessagesRef}>
              {chatHistory.map((msg, index) => (
                <div
                  key={index}
                  className={`message-bubble ${msg.sender}-bubble`}
                >
                  <p
                    className={
                      msg.sender === "user"
                        ? "user-message"
                        : "assistant-message"
                    }
                  >
                    {msg.text}
                  </p>
                </div>
              ))}
            </div>
            <div className="chat-input-container">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask a question or type a message..."
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendChat();
                  }
                }}
              />
              <button
                className="primary-button send-btn"
                onClick={() => void handleSendChat()}
                disabled={!chatInput.trim()}
              >
                Send
              </button>
            </div>
          </section>

          {voiceEnabled && (
            <VoiceControls
              sessionId={session.id}
              paused={panelState === "paused"}
              issue={issue}
              application={observation?.application ?? null}
              pageTitle={observation?.pageTitle ?? null}
              visibleError={
                observation?.visibleText.find((text) =>
                  /error|failed/i.test(text),
                ) ?? null
              }
              visibleText={observation?.visibleText ?? []}
              pageFingerprint={observation?.pageFingerprint ?? null}
              controls={observation?.controls ?? []}
              actionFollowUp={actionFollowUp}
              onTranscript={handleTranscriptConfirmed}
              onActionProposal={setActionProposal}
            />
          )}

          {guidance && guidance.results.length > 0 && observation && (
            <>
              <OperationsPanel
                sessionId={session.id}
                issue={issue}
                observation={observation}
              />
            </>
          )}

          <div className="action-grid">
            {panelState === "paused" ? (
              <button
                className="secondary-button"
                onClick={() => void resume()}
              >
                Resume and share again
              </button>
            ) : (
              <button className="secondary-button" onClick={() => void pause()}>
                Pause observation
              </button>
            )}
            <button
              className="danger-button"
              onClick={() => void emergencyStop()}
            >
              Stop all access
            </button>
          </div>
        </>
      )}

      {session && panelState === "completed" && (
        <section className="card completed-card">
          <div className="complete-mark" aria-hidden="true">
            ✓
          </div>
          <h2>Access stopped</h2>
          <p>
            Screen sharing, visual observation, overlays, and voice guidance are
            off.
          </p>
          <button
            className="primary-button"
            onClick={() => {
              setSession(null);
              setScreenConsent(null);
              setObservation(null);
              setGuidance(null);
              setActionProposal(null);
              setChatHistory([WELCOME_MESSAGE]);
              setChatInput("");
              observedTabId.current = null;
              setPanelState("ready");
            }}
          >
            Start a new session
          </button>
        </section>
      )}

      <footer>
        <span>
          {session && observation && actionProposal
            ? "Guided actions available"
            : "Guidance only"}
        </span>
        <span className="footer-separator">•</span>
        <span>Recording off</span>
      </footer>
    </main>
  );
}
