import type {
  CommandResult,
  ControlCommand,
} from "@remoteassist/command-schema";
import type {
  ConsentGrant,
  KnowledgeSearchResponse,
  ResolutionPlan,
  SanitizedObservation,
  SupportSession,
} from "@remoteassist/shared-types";
import type { BrowserObservationPayload } from "../security/sanitize.js";
import type { RealtimeActionProposal } from "./realtime-actions.js";

const API_BASE = "http://127.0.0.1:4310";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-remoteassist-tenant-id": "local-tenant",
      "x-remoteassist-user-id": "local-user",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(
      body.error?.message ?? `RemoteAssist API returned ${response.status}`,
    );
  return body;
}

export async function createSession(
  entryOrigin: string,
  voiceEnabled: boolean,
): Promise<SupportSession> {
  const response = await apiRequest<{ session: SupportSession }>(
    "/v1/support-sessions",
    {
      method: "POST",
      body: JSON.stringify({
        channel: "browser_extension",
        voice_enabled: voiceEnabled,
        entry_context: { tab_origin: entryOrigin },
      }),
    },
  );
  return response.session;
}

export async function grantScreenConsent(
  sessionId: string,
  origin: string,
): Promise<ConsentGrant> {
  const response = await apiRequest<{ consent: ConsentGrant }>(
    `/v1/support-sessions/${sessionId}/consents`,
    {
      method: "POST",
      body: JSON.stringify({
        grant_type: "screen_view_ai",
        scope: "selected_tab",
        allowed_origins: [origin],
        expires_when: "session_ends",
      }),
    },
  );
  return response.consent;
}

export async function submitObservation(
  sessionId: string,
  observation: BrowserObservationPayload,
): Promise<SanitizedObservation> {
  const response = await apiRequest<{ observation: SanitizedObservation }>(
    `/v1/support-sessions/${sessionId}/observations`,
    { method: "POST", body: JSON.stringify(observation) },
  );
  return response.observation;
}

export async function searchKnowledge(
  sessionId: string,
  issue: string,
  observation: BrowserObservationPayload,
): Promise<KnowledgeSearchResponse> {
  return apiRequest<KnowledgeSearchResponse>("/v1/knowledge/search", {
    method: "POST",
    body: JSON.stringify({
      session_id: sessionId,
      query: issue,
      context: {
        application: observation.application ?? undefined,
        visible_error: observation.visible_text.find((text) =>
          /error|failed/i.test(text),
        ),
      },
      top_k: 10,
    }),
  });
}

export async function pauseSession(sessionId: string): Promise<SupportSession> {
  const response = await apiRequest<{ session: SupportSession }>(
    `/v1/support-sessions/${sessionId}/pause`,
    { method: "POST", body: "{}" },
  );
  return response.session;
}

export async function resumeSession(
  sessionId: string,
): Promise<SupportSession> {
  const response = await apiRequest<{ session: SupportSession }>(
    `/v1/support-sessions/${sessionId}/resume`,
    { method: "POST", body: "{}" },
  );
  return response.session;
}

export async function revokeConsent(
  sessionId: string,
  consentId: string,
): Promise<SupportSession> {
  const response = await apiRequest<{ session: SupportSession }>(
    `/v1/support-sessions/${sessionId}/consents/${consentId}`,
    { method: "DELETE" },
  );
  return response.session;
}

export async function endSession(sessionId: string): Promise<SupportSession> {
  const response = await apiRequest<{ session: SupportSession }>(
    `/v1/support-sessions/${sessionId}/end`,
    { method: "POST", body: "{}" },
  );
  return response.session;
}

export async function grantBrowserControlConsent(
  sessionId: string,
  origin: string,
): Promise<ConsentGrant> {
  const response = await apiRequest<{ consent: ConsentGrant }>(
    `/v1/support-sessions/${sessionId}/consents`,
    {
      method: "POST",
      body: JSON.stringify({
        grant_type: "browser_control_ai",
        scope: "allow_once",
        allowed_origins: [origin],
        expires_when: "session_ends",
      }),
    },
  );
  return response.consent;
}

export async function proposeBrowserAction(
  sessionId: string,
  actionType: RealtimeActionProposal["actionType"],
  controlName: string,
  purpose: string,
  controlRole: string,
  expectedText: string | null = null,
  planId?: string,
  stepIndex?: number,
): Promise<ControlCommand> {
  const response = await apiRequest<{ command: ControlCommand }>(
    `/v1/support-sessions/${sessionId}/commands/propose`,
    {
      method: "POST",
      body: JSON.stringify({
        type: actionType,
        control_name: controlName,
        control_role: controlRole,
        purpose,
        expected_text: expectedText,
        controller: "ai",
        plan_id: planId,
        step_index: stepIndex,
      }),
    },
  );
  return response.command;
}

export async function approveCommand(
  sessionId: string,
  commandId: string,
  planId?: string,
  stepIndex?: number,
): Promise<ControlCommand> {
  const response = await apiRequest<{ command: ControlCommand }>(
    `/v1/support-sessions/${sessionId}/commands/${commandId}/approve`,
    {
      method: "POST",
      body: JSON.stringify({
        planId,
        stepIndex,
      }),
    },
  );
  return response.command;
}

export async function approvePlan(
  sessionId: string,
  planId: string,
  stepCount: number,
  origin: string,
): Promise<void> {
  await apiRequest(`/v1/support-sessions/${sessionId}/plans/${planId}/approve`, {
    method: "POST",
    body: JSON.stringify({ stepCount, origin }),
  });
}

export async function recordPlanResult(
  sessionId: string,
  planId: string,
  status: "completed" | "aborted" | "failed",
  totalSteps: number,
  completedSteps: number,
  reason?: string,
  failedStepIndex?: number,
): Promise<void> {
  await apiRequest(`/v1/support-sessions/${sessionId}/plans/${planId}/result`, {
    method: "POST",
    body: JSON.stringify({
      status,
      totalSteps,
      completedSteps,
      reason,
      failedStepIndex,
    }),
  });
}

export async function authorizeCommand(
  sessionId: string,
  commandId: string,
): Promise<ControlCommand> {
  const response = await apiRequest<{ command: ControlCommand }>(
    `/v1/support-sessions/${sessionId}/commands/${commandId}/authorize`,
    { method: "POST", body: "{}" },
  );
  return response.command;
}

export async function recordCommandResult(
  sessionId: string,
  commandId: string,
  result: CommandResult,
): Promise<{
  command: ControlCommand;
  session: SupportSession;
  result: CommandResult;
}> {
  return apiRequest(
    `/v1/support-sessions/${sessionId}/commands/${commandId}/result`,
    { method: "POST", body: JSON.stringify(result) },
  );
}

export interface RealtimeConnection {
  provider:
    "openai_realtime" | "google_voice" | "elevenlabs" | "browser_speech";
  sessionId: string;
  model: string;
  answerSdp: string;
  transport: "webrtc" | "websocket_stream" | "browser_speech";
}

export interface WorkflowExecutionResult {
  id: string;
  status: "completed";
  output: Record<string, unknown>;
  verification: "passed";
}

export interface TicketSummary {
  id: string;
  state: "open" | "resolved";
}

export interface HandoffSummary {
  id: string;
  status: "queued" | "connected" | "completed";
  ticketId: string;
}

export async function grantMicrophoneConsent(
  sessionId: string,
): Promise<ConsentGrant> {
  const response = await apiRequest<{ consent: ConsentGrant }>(
    `/v1/support-sessions/${sessionId}/consents`,
    {
      method: "POST",
      body: JSON.stringify({
        grant_type: "microphone",
        scope: "voice_session",
        allowed_origins: [],
        expires_when: "session_ends",
      }),
    },
  );
  return response.consent;
}

export async function connectRealtime(
  sessionId: string,
  offerSdp: string,
  issue: string,
  application: string | null,
  visibleError: string | null,
  availableControls: Array<{
    name: string;
    role: string;
    actions: RealtimeActionProposal["actionType"][];
  }>,
): Promise<RealtimeConnection> {
  return apiRequest<RealtimeConnection>(
    `/v1/support-sessions/${sessionId}/realtime-call`,
    {
      method: "POST",
      body: JSON.stringify({
        offer_sdp: offerSdp,
        reported_issue: issue,
        application,
        visible_error: visibleError,
        available_controls: availableControls,
      }),
    },
  );
}

export async function submitVoiceQuery(
  sessionId: string,
  query: string | null,
  application: string | null,
  visibleError: string | null,
  audio?: string,
): Promise<{
  searchResponse: KnowledgeSearchResponse | null;
  audioContent: string;
  transcript?: string;
  assistantText?: string;
}> {
  return apiRequest<{
    searchResponse: KnowledgeSearchResponse | null;
    audioContent: string;
    transcript?: string;
    assistantText?: string;
  }>(`/v1/support-sessions/${sessionId}/voice-query`, {
    method: "POST",
    body: JSON.stringify({
      query: query ?? undefined,
      audio,
      application,
      visible_error: visibleError,
    }),
  });
}

export async function synthesizeVoiceText(
  sessionId: string,
  text: string,
): Promise<{ audioContent: string }> {
  return apiRequest<{ audioContent: string }>(
    `/v1/support-sessions/${sessionId}/voice/synthesize`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
  );
}

export async function recordRealtimeActionProposal(
  sessionId: string,
  proposal: RealtimeActionProposal,
): Promise<RealtimeActionProposal> {
  const response = await apiRequest<{ proposal: RealtimeActionProposal }>(
    `/v1/support-sessions/${sessionId}/realtime-action-proposals`,
    {
      method: "POST",
      body: JSON.stringify({
        call_id: proposal.callId,
        control_name: proposal.controlName,
        control_role: proposal.controlRole,
        action_type: proposal.actionType,
        purpose: proposal.purpose,
      }),
    },
  );
  return response.proposal;
}

export async function suggestBrowserAction(
  sessionId: string,
  query: string,
  trigger:
    | "initial_observation"
    | "chat"
    | "voice"
    | "page_changed"
    | "manual"
    | "discovery",
  conversationHistory: Array<{ sender: "user" | "system"; text: string }> = [],
  discoveryPlanId?: string,
): Promise<{
  plan: ResolutionPlan | null;
  proposal: RealtimeActionProposal | null;
  reason: string;
}> {
  return apiRequest<{
    plan: ResolutionPlan | null;
    proposal: RealtimeActionProposal | null;
    reason: string;
  }>(`/v1/support-sessions/${sessionId}/action-suggestions`, {
    method: "POST",
    body: JSON.stringify({
      query,
      trigger,
      conversation_history: conversationHistory.slice(-20),
      ...(discoveryPlanId ? { discoveryPlanId } : {}),
    }),
  });
}

export async function interruptVoice(sessionId: string): Promise<void> {
  await apiRequest(`/v1/support-sessions/${sessionId}/voice/interrupt`, {
    method: "POST",
    body: "{}",
  });
}

export async function disconnectVoice(sessionId: string): Promise<void> {
  await apiRequest(`/v1/support-sessions/${sessionId}/voice/disconnect`, {
    method: "POST",
    body: "{}",
  });
}

export async function executeDiagnosticWorkflow(
  sessionId: string,
  idempotencyKey: string,
): Promise<{ execution: WorkflowExecutionResult; session: SupportSession }> {
  return apiRequest(
    `/v1/support-sessions/${sessionId}/workflows/AE-SUPPORT-DEMO-SESSION-STATUS/executions`,
    {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ user_approved: true, inputs: {} }),
    },
  );
}

export async function createTicket(
  sessionId: string,
  issue: string,
): Promise<{ ticket: TicketSummary }> {
  return apiRequest(`/v1/support-sessions/${sessionId}/tickets`, {
    method: "POST",
    body: JSON.stringify({ issue }),
  });
}

export async function grantHumanScreenConsent(
  sessionId: string,
  origin: string,
): Promise<ConsentGrant> {
  const response = await apiRequest<{ consent: ConsentGrant }>(
    `/v1/support-sessions/${sessionId}/consents`,
    {
      method: "POST",
      body: JSON.stringify({
        grant_type: "screen_view_human",
        scope: "selected_tab",
        allowed_origins: [origin],
        expires_when: "session_ends",
      }),
    },
  );
  return response.consent;
}

export async function requestHumanHandoff(
  sessionId: string,
  issue: string,
): Promise<{ handoff: HandoffSummary; session: SupportSession }> {
  return apiRequest(`/v1/support-sessions/${sessionId}/human-handoff`, {
    method: "POST",
    body: JSON.stringify({ issue }),
  });
}
