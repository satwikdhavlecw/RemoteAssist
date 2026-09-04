import type { FastifyInstance, FastifyRequest } from "fastify";
import { findActiveConsent } from "@remoteassist/policy-model";
import { governedBrowserActions } from "@remoteassist/policy-model";
import { z } from "zod";
import type { AuditLog } from "../domain/audit-log.js";
import { DomainError } from "../domain/errors.js";
import type { GovernedKnowledgeService } from "../domain/governed-knowledge-service.js";
import { LlmService } from "../domain/llm-service.js";
import { OperationsService } from "../domain/operations-service.js";
import type { Identity, SessionStore } from "../domain/session-store.js";
import type { RealtimeVoiceProvider } from "../providers/realtime.js";

interface MvpRouteDependencies {
  sessions: SessionStore;
  audit: AuditLog;
  knowledge: GovernedKnowledgeService;
  voice: RealtimeVoiceProvider;
  authMode: "mock" | "production";
}

const issueSchema = z.object({ issue: z.string().min(2).max(2000) }).strict();
const workflowSchema = z
  .object({
    user_approved: z.literal(true),
    inputs: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const realtimeCallSchema = z
  .object({
    offer_sdp: z.string().min(1).max(200_000),
    reported_issue: z.string().min(1).max(2000),
    application: z.string().max(120).nullable().default(null),
    visible_error: z.string().max(1000).nullable().default(null),
    available_controls: z
      .array(
        z
          .object({
            name: z.string().min(1).max(300),
            role: z.string().min(1).max(80),
            actions: z.array(z.enum(governedBrowserActions)).min(1).max(3),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();

const voiceSynthesisSchema = z
  .object({
    text: z.string().min(1).max(700),
  })
  .strict();

function voiceProviderType(): string {
  return process.env.VOICE_PROVIDER?.trim().toLowerCase() || "openai_realtime";
}

function elapsedMs(startedAt: number): number {
  return Math.round((Date.now() - startedAt) * 10) / 10;
}

function isFillerVoiceTurn(query: string): boolean {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  const filler = new Set([
    "hi",
    "hello",
    "hey",
    "test",
    "testing",
    "mic",
    "microphone",
    "yes",
    "okay",
    "ok",
  ]);
  return words.every((word) => filler.has(word));
}

function isTicketCreationRequest(query: string): boolean {
  return (
    /\b(create|new|raise|log|make|submit)\b.{0,40}\b(ticket|incident)\b/i.test(
      query,
    ) ||
    /\b(ticket|incident)\b.{0,40}\b(create|new|raise|log|make|submit)\b/i.test(
      query,
    ) ||
    /\bopen\b.{0,40}\bticket\b/i.test(query)
  );
}

function isUnclearVoiceTurn(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (
    /\b(indistinct|inaudible|unintelligible|chatter|background noise)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  const withoutBracketedEvents = normalized
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^)]+\)/g, "")
    .trim();
  return withoutBracketedEvents.length === 0;
}

async function synthesizeVoiceReply(
  text: string,
  providerType: string,
): Promise<string> {
  if (providerType === "google_voice") {
    const { GoogleTtsClient } = await import("../providers/google-voice.js");
    const client = new GoogleTtsClient();
    return client.synthesize(text);
  }
  if (providerType === "elevenlabs") {
    const { ElevenLabsClient } = await import("../providers/elevenlabs.js");
    const client = new ElevenLabsClient();
    return client.synthesize(text);
  }
  return "";
}

function identity(
  request: FastifyRequest,
  authMode: "mock" | "production",
): Identity {
  if (authMode === "production") {
    throw new DomainError(
      "authentication_not_configured",
      "Entra ID verification requires tenant configuration.",
      503,
    );
  }
  const header = (name: string, fallback: string): string => {
    const value = request.headers[name];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  };
  return {
    tenantId: header("x-remoteassist-tenant-id", "local-tenant"),
    userId: header("x-remoteassist-user-id", "local-user"),
    roles: header("x-remoteassist-roles", "employee")
      .split(",")
      .map((role) => role.trim()),
  };
}

export function registerMvpRoutes(
  app: FastifyInstance,
  dependencies: MvpRouteDependencies,
) {
  const voice = dependencies.voice;
  const operations = new OperationsService(dependencies.sessions);
  const voiceAssistant = new LlmService();

  app.get("/v1/auth/config", async () => ({
    mode: dependencies.authMode,
    provider:
      dependencies.authMode === "mock" ? "local_mock" : "microsoft_entra_id",
    pkceRequired: true,
    productionConfigured: false,
    voiceProvider: process.env.VOICE_PROVIDER || "openai_realtime",
    llmProvider: process.env.LLM_PROVIDER || "openai",
  }));

  app.post("/v1/support-sessions/:sessionId/realtime-call", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { sessionId } = request.params as { sessionId: string };
    const session = dependencies.sessions.getAuthorized(sessionId, actor);
    dependencies.sessions.assertActive(session);
    if (!findActiveConsent(session, "microphone")) {
      throw new DomainError(
        "microphone_consent_required",
        "A separate active microphone grant is required.",
        403,
      );
    }
    const input = realtimeCallSchema.parse(request.body);
    let connection;
    try {
      connection = await voice.createSession({
        sessionId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        language: "en-IN",
        offerSdp: input.offer_sdp,
        context: {
          reportedIssue: input.reported_issue,
          application: input.application,
          visibleError: input.visible_error,
          availableControls: input.available_controls,
        },
      });
    } catch {
      throw new DomainError(
        "voice_provider_unavailable",
        "OpenAI Realtime could not start the voice session.",
        503,
      );
    }
    dependencies.audit.append({
      tenantId: session.tenantId,
      sessionId,
      actorType: "system",
      actorId: "openai-realtime-provider",
      eventType: "VOICE_SESSION_CREATED",
      eventPayload: {
        provider: connection.provider,
        model: connection.model,
        transport: connection.transport,
      },
    });
    return connection;
  });

  app.post("/v1/support-sessions/:sessionId/voice-query", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { sessionId } = request.params as { sessionId: string };
    const session = dependencies.sessions.getAuthorized(sessionId, actor);
    dependencies.sessions.assertActive(session);

    const body = request.body as {
      query?: string;
      audio?: string;
      application?: string;
      visible_error?: string;
    };

    let queryText = body.query || "";
    if (body.audio) {
      const startedAt = Date.now();
      const providerType = voiceProviderType();
      request.log.info(
        {
          sessionId,
          provider: providerType,
          audioChars: body.audio.length,
        },
        "voice_query_transcription_started",
      );
      if (providerType === "elevenlabs") {
        const { ElevenLabsClient } = await import("../providers/elevenlabs.js");
        const client = new ElevenLabsClient();
        queryText = await client.transcribe(body.audio);
      } else {
        const { GoogleSttClient } =
          await import("../providers/google-voice.js");
        const stt = new GoogleSttClient();
        queryText = await stt.transcribe(body.audio);
      }
      request.log.info(
        {
          sessionId,
          provider: providerType,
          transcriptChars: queryText.length,
          elapsedMs: elapsedMs(startedAt),
        },
        "voice_query_transcription_completed",
      );
    }

    if (!queryText.trim()) {
      return {
        searchResponse: null,
        audioContent: "",
        transcript: "",
      };
    }

    if (isUnclearVoiceTurn(queryText)) {
      const providerType = voiceProviderType();
      const replyText =
        "I could not hear that clearly. Please say the issue again in one short sentence.";
      const startedAt = Date.now();
      const audioContent = await synthesizeVoiceReply(replyText, providerType);
      request.log.info(
        {
          sessionId,
          provider: providerType,
          transcript: queryText,
          audioChars: audioContent.length,
          elapsedMs: elapsedMs(startedAt),
        },
        "voice_query_unclear_turn_handled",
      );
      return {
        searchResponse: null,
        audioContent,
        transcript: queryText,
        assistantText: replyText,
      };
    }

    const providerType = voiceProviderType();
    if (isFillerVoiceTurn(queryText)) {
      const replyText =
        "I can hear you. Tell me the page issue to troubleshoot.";
      const startedAt = Date.now();
      const audioContent = await synthesizeVoiceReply(replyText, providerType);
      request.log.info(
        {
          sessionId,
          provider: providerType,
          transcript: queryText,
          audioChars: audioContent.length,
          elapsedMs: elapsedMs(startedAt),
        },
        "voice_query_filler_turn_handled",
      );
      return {
        searchResponse: null,
        audioContent,
        transcript: queryText,
        assistantText: replyText,
      };
    }

    const guidanceStartedAt = Date.now();
    request.log.info(
      {
        sessionId,
        provider: providerType,
        queryChars: queryText.length,
      },
      "voice_query_guidance_started",
    );
    const searchResponse = await dependencies.knowledge.search(
      {
        session_id: session.id,
        query: queryText,
        context: {
          application: body.application || undefined,
          visible_error: body.visible_error || undefined,
        },
        top_k: 10,
      },
      dependencies.sessions.latestObservation(session.id),
      actor,
    );
    request.log.info(
      {
        sessionId,
        provider: providerType,
        resultCount: searchResponse.results.length,
        requiresHumanReview: searchResponse.requiresHumanReview,
        elapsedMs: elapsedMs(guidanceStartedAt),
      },
      "voice_query_guidance_completed",
    );

    let textToSynthesize = searchResponse.groundedGuidance.proposedNextStep;
    if (
      searchResponse.results.length === 0 &&
      !isTicketCreationRequest(queryText)
    ) {
      const assistantStartedAt = Date.now();
      const latestObservation = dependencies.sessions.latestObservation(
        session.id,
      );
      const observationSummary = latestObservation
        ? [
            latestObservation.application
              ? `Application: ${latestObservation.application}`
              : null,
            latestObservation.screenState
              ? `State: ${latestObservation.screenState}`
              : null,
            ...latestObservation.visibleText
              .slice(0, 30)
              .map((text) => `Visible text: ${text.slice(0, 400)}`),
          ]
            .filter(Boolean)
            .join(". ")
        : "No current page observation.";
      const assistantReply = await voiceAssistant.generateGuidance(
        queryText,
        observationSummary,
        "No approved enterprise article matched. Provide a short informational voice reply only. Do not claim approved enterprise guidance, do not propose browser execution, and do not ask for passwords or one-time codes. Avoid repeating generic contact-admin advice unless there is no visible safe next step and the user explicitly asks for escalation.",
      );
      textToSynthesize = assistantReply.proposedNextStep;
      request.log.info(
        {
          sessionId,
          provider: providerType,
          textChars: textToSynthesize.length,
          elapsedMs: elapsedMs(assistantStartedAt),
        },
        "voice_query_vertex_assistant_completed",
      );
    } else if (searchResponse.results.length === 0) {
      textToSynthesize = [
        searchResponse.groundedGuidance.inferred,
        searchResponse.groundedGuidance.proposedNextStep,
      ]
        .filter(Boolean)
        .join(" ");
    }
    const synthesisStartedAt = Date.now();
    const audioContent = await synthesizeVoiceReply(
      textToSynthesize,
      providerType,
    );
    request.log.info(
      {
        sessionId,
        provider: providerType,
        textChars: textToSynthesize.length,
        audioChars: audioContent.length,
        elapsedMs: elapsedMs(synthesisStartedAt),
      },
      "voice_query_synthesis_completed",
    );

    return {
      searchResponse,
      audioContent,
      transcript: queryText,
      assistantText: textToSynthesize,
    };
  });

  app.post(
    "/v1/support-sessions/:sessionId/voice/synthesize",
    async (request) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      dependencies.sessions.assertActive(session);
      const input = voiceSynthesisSchema.parse(request.body);
      const providerType = voiceProviderType();
      const startedAt = Date.now();
      const audioContent = await synthesizeVoiceReply(input.text, providerType);
      request.log.info(
        {
          sessionId,
          provider: providerType,
          textChars: input.text.length,
          audioChars: audioContent.length,
          elapsedMs: elapsedMs(startedAt),
        },
        "voice_synthesis_completed",
      );
      return { audioContent };
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/voice/interrupt",
    async (request) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      dependencies.sessions.assertActive(session);
      await voice.interrupt(sessionId);
      return { interrupted: true };
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/voice/disconnect",
    async (request) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      dependencies.sessions.getAuthorized(sessionId, actor);
      await voice.endSession(sessionId);
      return { disconnected: true };
    },
  );

  app.get("/v1/knowledge/documents", async (request) => {
    const actor = identity(request, dependencies.authMode);
    return { documents: dependencies.knowledge.listPermittedDocuments(actor) };
  });

  app.get("/v1/knowledge/documents/:documentId", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { documentId } = request.params as { documentId: string };
    const document = dependencies.knowledge.getPermittedDocument(
      actor,
      documentId,
    );
    if (!document)
      throw new DomainError(
        "document_not_found",
        "The document was not found.",
        404,
      );
    return { document };
  });

  app.get("/v1/knowledge/procedures/:procedureId", async (request) => {
    identity(request, dependencies.authMode);
    const { procedureId } = request.params as { procedureId: string };
    const procedure = dependencies.knowledge.getProcedure(procedureId);
    if (!procedure)
      throw new DomainError(
        "procedure_not_found",
        "The procedure was not found.",
        404,
      );
    return { procedure };
  });

  app.get("/v1/knowledge/connectors", async (request) => {
    const actor = identity(request, dependencies.authMode);
    if (!actor.roles.includes("knowledge_admin")) {
      throw new DomainError(
        "knowledge_admin_required",
        "A knowledge-administrator role is required.",
        403,
      );
    }
    return { connectors: dependencies.knowledge.listConnectors(actor) };
  });

  app.post("/v1/knowledge/connectors/:connectorId/sync", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { connectorId } = request.params as { connectorId: string };
    const connector = dependencies.knowledge.syncConnector(actor, connectorId);
    if (!connector) {
      throw new DomainError(
        actor.roles.includes("knowledge_admin")
          ? "connector_not_found"
          : "knowledge_admin_required",
        actor.roles.includes("knowledge_admin")
          ? "The connector was not found."
          : "A knowledge-administrator role is required.",
        actor.roles.includes("knowledge_admin") ? 404 : 403,
      );
    }
    return { connector };
  });

  app.get("/v1/workflows", async (request) => {
    identity(request, dependencies.authMode);
    return { workflows: operations.workflows() };
  });

  app.post(
    "/v1/support-sessions/:sessionId/workflows/:workflowId/executions",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId, workflowId } = request.params as {
        sessionId: string;
        workflowId: string;
      };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const input = workflowSchema.parse(request.body);
      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
        throw new DomainError(
          "idempotency_key_required",
          "An idempotency key is required.",
        );
      }
      const execution = operations.executeWorkflow(
        session,
        workflowId,
        idempotencyKey,
        input.user_approved,
      );
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId,
        actorType: "system",
        actorId: "automationedge-adapter",
        eventType: "WORKFLOW_COMPLETED",
        eventPayload: {
          executionId: execution.id,
          workflowId,
          status: execution.status,
          verification: execution.verification,
        },
      });
      return reply.status(201).send({ execution, session });
    },
  );

  app.post(
    "/v1/support-sessions/:sessionId/tickets",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const { issue } = issueSchema.parse(request.body);
      const ticket = operations.createTicket(
        session,
        issue,
        dependencies.sessions.latestObservation(sessionId),
        [],
      );
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId,
        actorType: "system",
        actorId: "mock-servicenow-adapter",
        eventType: "TICKET_CREATED_OR_UPDATED",
        eventPayload: {
          ticketId: ticket.id,
          provider: ticket.provider,
          state: ticket.state,
        },
      });
      return reply.status(201).send({ ticket });
    },
  );

  app.get("/v1/tickets/:ticketId", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { ticketId } = request.params as { ticketId: string };
    const ticket = operations.getTicket(actor, ticketId);
    if (!ticket)
      throw new DomainError(
        "ticket_not_found",
        "The ticket was not found.",
        404,
      );
    return { ticket };
  });

  app.post(
    "/v1/support-sessions/:sessionId/human-handoff",
    async (request, reply) => {
      const actor = identity(request, dependencies.authMode);
      const { sessionId } = request.params as { sessionId: string };
      const session = dependencies.sessions.getAuthorized(sessionId, actor);
      const { issue } = issueSchema.parse(request.body);
      const handoff = operations.requestHandoff(
        session,
        actor,
        issue,
        dependencies.sessions.latestObservation(sessionId),
      );
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId,
        actorType: "system",
        actorId: "mock-servicenow-adapter",
        eventType: "TICKET_CREATED_OR_UPDATED",
        eventPayload: {
          ticketId: handoff.ticketId,
          provider: "mock_servicenow",
          reason: "human_handoff",
        },
      });
      dependencies.audit.append({
        tenantId: session.tenantId,
        sessionId,
        actorType: "user",
        actorId: actor.userId,
        eventType: "HUMAN_HANDOFF_REQUESTED",
        eventPayload: { handoffId: handoff.id, ticketId: handoff.ticketId },
      });
      return reply.status(201).send({ handoff, session });
    },
  );

  app.get("/v1/human-handoffs", async (request) => {
    const actor = identity(request, dependencies.authMode);
    if (!actor.roles.includes("support_agent")) {
      throw new DomainError(
        "support_role_required",
        "A support-agent role is required.",
        403,
      );
    }
    return { handoffs: operations.queue(actor) };
  });

  app.post("/v1/human-handoffs/:handoffId/join", async (request) => {
    const actor = identity(request, dependencies.authMode);
    const { handoffId } = request.params as { handoffId: string };
    const handoff = operations.join(actor, handoffId);
    dependencies.audit.append({
      tenantId: handoff.tenantId,
      sessionId: handoff.sessionId,
      actorType: "human",
      actorId: actor.userId,
      eventType: "HUMAN_CONNECTED",
      eventPayload: {
        handoffId,
        agentDisplayName: handoff.agentDisplayName,
        consentStatus: handoff.consentStatus,
      },
    });
    return { handoff };
  });
}
