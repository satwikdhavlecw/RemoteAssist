import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { LlmProvider } from "../src/domain/llm-service.js";
import type { RealtimeVoiceProvider } from "../src/providers/realtime.js";
import { createTestKnowledgeService } from "./knowledge-fixture.js";

const employeeHeaders = {
  "x-remoteassist-tenant-id": "mvp-tenant",
  "x-remoteassist-user-id": "mvp-employee",
  "x-remoteassist-roles": "employee",
};

const supportHeaders = {
  "x-remoteassist-tenant-id": "mvp-tenant",
  "x-remoteassist-user-id": "mvp-support",
  "x-remoteassist-roles": "support_agent",
};

describe("provider-backed MVP contracts", () => {
  let app: FastifyInstance;
  let endedVoiceSessions: string[];

  beforeEach(() => {
    endedVoiceSessions = [];
    const voiceProvider: RealtimeVoiceProvider = {
      async createSession(input) {
        return {
          provider: "openai_realtime",
          sessionId: input.sessionId,
          model: "gpt-realtime-test",
          answerSdp: "v=0\r\nt=test-answer",
          transport: "webrtc",
        };
      },
      async interrupt() {},
      async endSession(sessionId) {
        endedVoiceSessions.push(sessionId);
      },
    };
    const actionLlmProvider: LlmProvider = {
      async generateGuidance() {
        return {
          inferred: "A browser issue is being reviewed.",
          proposedNextStep: "Review the current page.",
        };
      },
      async generateActionProposal() {
        return {
          controlName: "Try Again",
          actionType: "CLICK_ELEMENT",
          purpose: "Retrying once is the clear low-risk next step.",
        };
      },
    };
    app = buildApp({
      authMode: "mock",
      voiceProvider,
      knowledgeService: createTestKnowledgeService(),
      actionLlmProvider,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createSession(voiceEnabled = true): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/v1/support-sessions",
      headers: employeeHeaders,
      payload: {
        channel: "browser_extension",
        voice_enabled: voiceEnabled,
        entry_context: { tab_origin: "https://login.salesforce.com" },
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().session.id as string;
  }

  async function grant(
    sessionId: string,
    grantType: "microphone" | "screen_view_ai" | "screen_view_human",
  ) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/consents`,
      headers: employeeHeaders,
      payload: {
        grant_type: grantType,
        scope: grantType === "microphone" ? "voice_session" : "selected_tab",
        allowed_origins:
          grantType === "microphone" ? [] : ["https://login.salesforce.com"],
        expires_when: "session_ends",
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().consent;
  }

  async function prepareObservedSession(): Promise<string> {
    const sessionId = await createSession(false);
    await grant(sessionId, "screen_view_ai");
    const observation = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers: employeeHeaders,
      payload: observationPayload(),
    });
    expect(observation.statusCode).toBe(201);
    return sessionId;
  }

  it("requires separate microphone consent before creating an OpenAI WebRTC call", async () => {
    const sessionId = await createSession();
    const blocked = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/realtime-call`,
      headers: employeeHeaders,
      payload: realtimeCallPayload(),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("microphone_consent_required");

    await grant(sessionId, "microphone");
    const connection = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/realtime-call`,
      headers: employeeHeaders,
      payload: realtimeCallPayload(),
    });
    expect(connection.statusCode).toBe(200);
    expect(connection.json()).toMatchObject({
      provider: "openai_realtime",
      sessionId,
      model: "gpt-realtime-test",
      answerSdp: "v=0\r\nt=test-answer",
      transport: "webrtc",
    });
    expect(connection.json()).not.toHaveProperty("credential");
  });

  it("handles filler voice turns without running troubleshooting guidance", async () => {
    const sessionId = await createSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/voice-query`,
      headers: employeeHeaders,
      payload: {
        query: "Hello hello",
        application: "Salesforce",
        visible_error: "SAML authentication failed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      searchResponse: null,
      transcript: "Hello hello",
      assistantText: "I can hear you. Tell me the page issue to troubleshoot.",
    });
  });

  it("handles unclear backend voice transcripts without using them as the reported problem", async () => {
    const previousVoiceProvider = process.env.VOICE_PROVIDER;
    const previousElevenLabsKey = process.env.ELEVENLABS_API_KEY;
    process.env.VOICE_PROVIDER = "elevenlabs";
    process.env.ELEVENLABS_API_KEY = "";
    try {
      const sessionId = await createSession();
      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/voice-query`,
        headers: employeeHeaders,
        payload: {
          query: "[indistinct chatter]",
          application: "ConversationFlo",
          visible_error: "Login page",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        searchResponse: null,
        transcript: "[indistinct chatter]",
        assistantText:
          "I could not hear that clearly. Please say the issue again in one short sentence.",
      });
      expect(response.json().audioContent.length).toBeGreaterThan(0);
    } finally {
      if (previousVoiceProvider === undefined) {
        delete process.env.VOICE_PROVIDER;
      } else {
        process.env.VOICE_PROVIDER = previousVoiceProvider;
      }
      if (previousElevenLabsKey === undefined) {
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        process.env.ELEVENLABS_API_KEY = previousElevenLabsKey;
      }
    }
  });

  it("uses the backend LLM to suggest one current safe browser action", async () => {
    const sessionId = await prepareObservedSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers: employeeHeaders,
      payload: {
        query: "Salesforce SAML authentication failed",
        trigger: "chat",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().proposal).toMatchObject({
      controlName: "Try Again",
      controlRole: "button",
      actionType: "CLICK_ELEMENT",
      purpose: "Retrying once is the clear low-risk next step.",
    });

    const audit = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${sessionId}/audit-events`,
      headers: employeeHeaders,
    });
    expect(
      audit
        .json()
        .events.map((event: { eventType: string }) => event.eventType),
    ).toContain("MODEL_ACTION_PROPOSED");
  });

  it("makes pause and end block voice, workflow, and handoff capabilities", async () => {
    const pausedVoiceSession = await createSession();
    await grant(pausedVoiceSession, "microphone");
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${pausedVoiceSession}/pause`,
      headers: employeeHeaders,
      payload: {},
    });
    expect(endedVoiceSessions).toContain(pausedVoiceSession);

    const blockedCall = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${pausedVoiceSession}/realtime-call`,
      headers: employeeHeaders,
      payload: realtimeCallPayload(),
    });
    expect(blockedCall.statusCode).toBe(409);
    expect(blockedCall.json().error.code).toBe("session_paused");

    const wrongStateSession = await createSession(false);
    const wrongStateWorkflow = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${wrongStateSession}/workflows/AE-SUPPORT-DEMO-ACCOUNT-UNLOCK/executions`,
      headers: {
        ...employeeHeaders,
        "idempotency-key": "wrong-state-workflow",
      },
      payload: { user_approved: true, inputs: {} },
    });
    expect(wrongStateWorkflow.statusCode).toBe(409);
    expect(wrongStateWorkflow.json().error.code).toBe("wrong_session_state");

    const endedWorkflowSession = await prepareObservedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${endedWorkflowSession}/end`,
      headers: employeeHeaders,
      payload: {},
    });
    expect(endedVoiceSessions).toContain(endedWorkflowSession);

    const blockedWorkflow = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${endedWorkflowSession}/workflows/AE-SUPPORT-DEMO-ACCOUNT-UNLOCK/executions`,
      headers: {
        ...employeeHeaders,
        "idempotency-key": "ended-session-workflow",
      },
      payload: { user_approved: true, inputs: {} },
    });
    expect(blockedWorkflow.statusCode).toBe(409);
    expect(blockedWorkflow.json().error.code).toBe("session_terminal");

    const pausedHandoffSession = await prepareObservedSession();
    await grant(pausedHandoffSession, "screen_view_human");
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${pausedHandoffSession}/pause`,
      headers: employeeHeaders,
      payload: {},
    });
    const blockedHandoff = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${pausedHandoffSession}/human-handoff`,
      headers: employeeHeaders,
      payload: { issue: "Salesforce SAML authentication failed" },
    });
    expect(blockedHandoff.statusCode).toBe(409);
    expect(blockedHandoff.json().error.code).toBe("session_paused");
  });

  it("filters knowledge by role and exposes connector operations only to administrators", async () => {
    const documents = await app.inject({
      method: "GET",
      url: "/v1/knowledge/documents",
      headers: employeeHeaders,
    });
    expect(documents.statusCode).toBe(200);
    const ids = documents
      .json()
      .documents.map((document: { id: string }) => document.id);
    expect(ids).toContain("kb_test_salesforce_saml");
    expect(ids).not.toContain("kb_test_admin_secret");
    expect(ids).not.toContain("kb_test_expired_saml");

    const blockedDocument = await app.inject({
      method: "GET",
      url: "/v1/knowledge/documents/kb_test_admin_secret",
      headers: employeeHeaders,
    });
    expect(blockedDocument.statusCode).toBe(404);

    const blockedConnectors = await app.inject({
      method: "GET",
      url: "/v1/knowledge/connectors",
      headers: employeeHeaders,
    });
    expect(blockedConnectors.statusCode).toBe(403);

    const knowledgeAdmin = {
      ...employeeHeaders,
      "x-remoteassist-user-id": "mvp-knowledge-admin",
      "x-remoteassist-roles": "knowledge_admin",
    };
    const connectors = await app.inject({
      method: "GET",
      url: "/v1/knowledge/connectors",
      headers: knowledgeAdmin,
    });
    expect(connectors.statusCode).toBe(200);
    expect(connectors.json().connectors).toHaveLength(2);
    const connectorId = connectors.json().connectors[0].id as string;
    const synced = await app.inject({
      method: "POST",
      url: `/v1/knowledge/connectors/${connectorId}/sync`,
      headers: knowledgeAdmin,
      payload: {},
    });
    expect(synced.json().connector).toMatchObject({ status: "healthy" });
    expect(synced.json().connector.lastSyncAt).toBeTruthy();
  });

  it("runs an explicitly approved idempotent diagnostic and writes a ticket", async () => {
    const sessionId = await prepareObservedSession();
    const url = `/v1/support-sessions/${sessionId}/workflows/AE-SUPPORT-DEMO-SESSION-STATUS/executions`;
    const withoutKey = await app.inject({
      method: "POST",
      url,
      headers: employeeHeaders,
      payload: { user_approved: true, inputs: {} },
    });
    expect(withoutKey.statusCode).toBe(400);
    expect(withoutKey.json().error.code).toBe("idempotency_key_required");

    const workflowHeaders = {
      ...employeeHeaders,
      "idempotency-key": "same-user-approved-action",
    };
    const first = await app.inject({
      method: "POST",
      url,
      headers: workflowHeaders,
      payload: { user_approved: true, inputs: {} },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().execution).toMatchObject({
      status: "completed",
      verification: "passed",
      output: { serviceStatus: "operational", enterpriseSession: "expired" },
    });
    const repeated = await app.inject({
      method: "POST",
      url,
      headers: workflowHeaders,
      payload: { user_approved: true, inputs: {} },
    });
    expect(repeated.json().execution.id).toBe(first.json().execution.id);

    const ticket = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/tickets`,
      headers: employeeHeaders,
      payload: { issue: "Salesforce SAML authentication failed" },
    });
    expect(ticket.statusCode).toBe(201);
    expect(ticket.json().ticket).toMatchObject({
      provider: "mock_servicenow",
      state: "open",
      application: "Salesforce",
      workflowExecutionIds: [first.json().execution.id],
    });
  });

  it("queues and atomically assigns a separately consented human handoff", async () => {
    const sessionId = await prepareObservedSession();
    const requestUrl = `/v1/support-sessions/${sessionId}/human-handoff`;
    const blocked = await app.inject({
      method: "POST",
      url: requestUrl,
      headers: employeeHeaders,
      payload: { issue: "Salesforce SAML authentication failed" },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("human_view_consent_required");

    await grant(sessionId, "screen_view_human");
    const requested = await app.inject({
      method: "POST",
      url: requestUrl,
      headers: employeeHeaders,
      payload: { issue: "Salesforce SAML authentication failed" },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().handoff).toMatchObject({
      consentStatus: "human_view_granted",
      status: "queued",
      application: "Salesforce",
    });
    const handoffId = requested.json().handoff.id as string;

    const employeeQueue = await app.inject({
      method: "GET",
      url: "/v1/human-handoffs",
      headers: employeeHeaders,
    });
    expect(employeeQueue.statusCode).toBe(403);

    const queue = await app.inject({
      method: "GET",
      url: "/v1/human-handoffs",
      headers: supportHeaders,
    });
    expect(
      queue.json().handoffs.map((item: { id: string }) => item.id),
    ).toContain(handoffId);

    const joined = await app.inject({
      method: "POST",
      url: `/v1/human-handoffs/${handoffId}/join`,
      headers: supportHeaders,
      payload: {},
    });
    expect(joined.json().handoff).toMatchObject({
      status: "connected",
      agentId: "mvp-support",
      agentDisplayName: "Local Support Engineer",
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/human-handoffs/${handoffId}/join`,
      headers: supportHeaders,
      payload: {},
    });
    expect(duplicate.statusCode).toBe(409);

    const audit = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${sessionId}/audit-events`,
      headers: employeeHeaders,
    });
    const eventTypes = audit
      .json()
      .events.map((event: { eventType: string }) => event.eventType);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "HUMAN_HANDOFF_REQUESTED",
        "HUMAN_CONNECTED",
        "TICKET_CREATED_OR_UPDATED",
      ]),
    );
    expect(audit.json().integrityValid).toBe(true);
  });
});

function observationPayload() {
  return {
    origin: "https://login.salesforce.com",
    page_title: "Salesforce sign in",
    page_fingerprint: "sha256:mvp-salesforce-saml",
    application: "Salesforce",
    screen_state: "saml_login_error",
    visible_text: ["SAML authentication failed", "Try Again"],
    controls: [
      {
        elementId: "mvp-retry",
        role: "button",
        name: "Try Again",
        disabled: false,
        rectangle: { x: 100, y: 200, width: 120, height: 40 },
      },
    ],
    sensitive_content: true,
    confidence: 0.94,
  };
}

function realtimeCallPayload() {
  return {
    offer_sdp: "v=0\r\nt=test-offer",
    reported_issue: "Salesforce sign-in failed",
    application: "Salesforce",
    visible_error: "SAML authentication failed",
    available_controls: [
      {
        name: "Try Again",
        role: "button",
        actions: ["CLICK_ELEMENT", "FOCUS_ELEMENT", "SCROLL_TO_ELEMENT"],
      },
    ],
  };
}
