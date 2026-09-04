import { randomUUID } from "node:crypto"; // trigger reload 10
import cors from "@fastify/cors";
import Fastify, { type FastifyRequest } from "fastify";
import {
  evaluateOrigin,
  mayObserve,
  normalizeOrigin,
} from "@remoteassist/policy-model";
import {
  consentRequestSchema,
  createSessionRequestSchema,
  knowledgeSearchRequestSchema,
  observationRequestSchema,
} from "@remoteassist/shared-types";
import { ZodError } from "zod";
import { AuditLog } from "./domain/audit-log.js";
import { DomainError } from "./domain/errors.js";
import { GovernedKnowledgeService } from "./domain/governed-knowledge-service.js";
import {
  UnconfiguredOpenAIRealtimeProvider,
  type RealtimeVoiceProvider,
} from "./providers/realtime.js";
import { registerControlRoutes } from "./routes/control-routes.js";
import { type Identity, SessionStore } from "./domain/session-store.js";
import { registerMvpRoutes } from "./routes/mvp-routes.js";
import type { LlmProvider } from "./domain/llm-service.js";

export interface AppOptions {
  authMode?: "mock" | "production";
  voiceProvider?: RealtimeVoiceProvider;
  knowledgeService?: GovernedKnowledgeService;
  actionLlmProvider?: LlmProvider;
}

function identityFromRequest(
  request: FastifyRequest,
  authMode: "mock" | "production",
): Identity {
  if (authMode === "production") {
    throw new DomainError(
      "authentication_not_configured",
      "Production identity verification has not been configured.",
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

function sessionIdFrom(request: FastifyRequest): string {
  return (request.params as { sessionId: string }).sessionId;
}

export function buildApp(options: AppOptions = {}) {
  const authMode = options.authMode ?? "mock";
  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: process.env.NODE_ENV !== "test",
  });
  const sessions = new SessionStore();
  const audit = new AuditLog();
  const knowledge = options.knowledgeService ?? new GovernedKnowledgeService();
  const voice =
    options.voiceProvider ?? new UnconfiguredOpenAIRealtimeProvider();

  app.register(cors, {
    origin(origin, callback) {
      const allowed =
        !origin ||
        origin.startsWith("chrome-extension://") ||
        /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
      callback(allowed ? null : new Error("Origin is not allowed"), allowed);
    },
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id || `req_${randomUUID()}`;
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "invalid_request",
          message: error.issues.map((issue) => issue.message).join("; "),
          request_id: requestId,
        },
      });
    }
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
        },
      });
    }
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
    ) {
      return reply.status(413).send({
        error: {
          code: "request_body_too_large",
          message:
            "The voice audio chunk is too large. Speak in a shorter turn and try again.",
          request_id: requestId,
        },
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "The server could not complete the request.",
        request_id: requestId,
      },
    });
  });

  registerControlRoutes(app, {
    sessions,
    audit,
    authMode,
    actionLlmProvider: options.actionLlmProvider,
  });
  registerMvpRoutes(app, { sessions, audit, knowledge, voice, authMode });

  app.get("/health", async () => ({
    status: "ok",
    service: "remoteassist-api",
  }));

  app.post("/v1/support-sessions", async (request, reply) => {
    const identity = identityFromRequest(request, authMode);
    const input = createSessionRequestSchema.parse(request.body);
    const session = sessions.create(identity, input);
    audit.append({
      tenantId: session.tenantId,
      sessionId: session.id,
      actorType: "user",
      actorId: identity.userId,
      eventType: "SESSION_CREATED",
      eventPayload: {
        channel: session.channel,
        voiceEnabled: session.voiceEnabled,
        entryOrigin: session.entryOrigin,
      },
    });
    return reply.status(201).send({
      session,
      featureFlags: {
        screenAnalysis: true,
        aiControl: false,
        humanControl: false,
        debuggerApi: false,
        nativeCompanion: false,
      },
    });
  });

  app.get("/v1/support-sessions/:sessionId", async (request) => {
    const identity = identityFromRequest(request, authMode);
    return {
      session: sessions.getAuthorized(sessionIdFrom(request), identity),
    };
  });

  app.post(
    "/v1/support-sessions/:sessionId/consents",
    async (request, reply) => {
      const identity = identityFromRequest(request, authMode);
      const session = sessions.getAuthorized(sessionIdFrom(request), identity);
      const input = consentRequestSchema.parse(request.body);
      if (
        input.grant_type.includes("screen_view") ||
        input.grant_type.includes("browser_control")
      ) {
        if (input.allowed_origins.length === 0) {
          throw new DomainError(
            "origin_scope_required",
            "Viewing and control consent must name at least one allowed origin.",
          );
        }
        for (const origin of input.allowed_origins) {
          const decision = evaluateOrigin(origin, input.allowed_origins);
          if (!decision.allowed) {
            throw new DomainError(
              decision.reason,
              "Consent cannot be granted for this origin.",
              403,
            );
          }
        }
      }
      const consent = sessions.addConsent(session, identity, input);
      if (
        input.grant_type === "microphone" &&
        session.status === "AUTHENTICATED"
      ) {
        sessions.transition(session, "VOICE_CONNECTED");
      }
      if (input.grant_type === "screen_view_ai") {
        if (
          session.status === "AUTHENTICATED" ||
          session.status === "VOICE_CONNECTED"
        ) {
          sessions.transition(session, "OBSERVING");
        }
      }
      audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "user",
        actorId: identity.userId,
        eventType: "CONSENT_GRANTED",
        eventPayload: {
          consentId: consent.id,
          grantType: consent.grantType,
          scope: consent.scope,
          allowedOrigins: consent.allowedOrigins,
          expiresAt: consent.expiresAt,
        },
      });
      return reply
        .status(201)
        .send({ consent, sessionRevision: session.revision });
    },
  );

  app.delete(
    "/v1/support-sessions/:sessionId/consents/:consentId",
    async (request, reply) => {
      const identity = identityFromRequest(request, authMode);
      const session = sessions.getAuthorized(sessionIdFrom(request), identity);
      const { consentId } = request.params as {
        sessionId: string;
        consentId: string;
      };
      const consent = sessions.revokeConsent(session, consentId);
      await voice.endSession(session.id);
      audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "user",
        actorId: identity.userId,
        eventType: "CONSENT_REVOKED",
        eventPayload: { consentId: consent.id, grantType: consent.grantType },
      });
      return reply.status(200).send({ consent, session });
    },
  );

  app.post("/v1/support-sessions/:sessionId/pause", async (request) => {
    const identity = identityFromRequest(request, authMode);
    const session = sessions.getAuthorized(sessionIdFrom(request), identity);
    sessions.pause(session);
    await voice.endSession(session.id);
    audit.append({
      tenantId: session.tenantId,
      sessionId: session.id,
      actorType: "user",
      actorId: identity.userId,
      eventType: "SESSION_PAUSED",
      eventPayload: { revision: session.revision },
    });
    return { session };
  });

  app.post("/v1/support-sessions/:sessionId/resume", async (request) => {
    const identity = identityFromRequest(request, authMode);
    const session = sessions.getAuthorized(sessionIdFrom(request), identity);
    sessions.resume(session);
    audit.append({
      tenantId: session.tenantId,
      sessionId: session.id,
      actorType: "user",
      actorId: identity.userId,
      eventType: "SESSION_RESUMED",
      eventPayload: { revision: session.revision },
    });
    return { session };
  });

  app.post("/v1/support-sessions/:sessionId/end", async (request) => {
    const identity = identityFromRequest(request, authMode);
    const session = sessions.getAuthorized(sessionIdFrom(request), identity);
    if (session.status !== "COMPLETED" && session.status !== "USER_CANCELLED") {
      if (session.status === "RESOLVED" || session.status === "ESCALATED") {
        sessions.transition(session, "COMPLETED");
      } else if (!session.endedAt) {
        sessions.transition(session, "USER_CANCELLED");
      }
    }
    session.paused = true;
    session.controller = "none";
    for (const consent of session.consents) {
      if (!consent.revokedAt) consent.revokedAt = new Date().toISOString();
    }
    await voice.endSession(session.id);
    audit.append({
      tenantId: session.tenantId,
      sessionId: session.id,
      actorType: "user",
      actorId: identity.userId,
      eventType: "SESSION_ENDED",
      eventPayload: { status: session.status },
    });
    return { session };
  });

  app.post(
    "/v1/support-sessions/:sessionId/observations",
    async (request, reply) => {
      const identity = identityFromRequest(request, authMode);
      const session = sessions.getAuthorized(sessionIdFrom(request), identity);
      const input = observationRequestSchema.parse(request.body);
      const tenantAllowedOrigins = session.entryOrigin
        ? [session.entryOrigin]
        : [input.origin];
      const decision = mayObserve(session, input.origin, tenantAllowedOrigins);
      if (!decision.allowed) {
        if (
          decision.reason === "restricted_origin" ||
          decision.reason === "not_allowlisted"
        ) {
          sessions.transition(session, "SECURITY_BLOCKED");
          audit.append({
            tenantId: session.tenantId,
            sessionId: session.id,
            actorType: "system",
            actorId: "policy-gateway",
            eventType: "OBSERVATION_BLOCKED",
            eventPayload: {
              reason: decision.reason,
              origin: normalizeOrigin(input.origin),
            },
          });
        }
        throw new DomainError(
          decision.reason,
          "Page observation is not permitted.",
          403,
        );
      }
      const observation = sessions.addObservation(session, input);
      if (session.status === "OBSERVING")
        sessions.transition(session, "TROUBLESHOOTING");
      audit.append({
        tenantId: session.tenantId,
        sessionId: session.id,
        actorType: "extension",
        actorId: "browser-extension",
        eventType: "OBSERVATION_RECORDED",
        eventPayload: {
          observationId: observation.id,
          origin: observation.origin,
          pageFingerprint: observation.pageFingerprint,
          visibleTextCount: observation.visibleText.length,
          controlCount: observation.controls.length,
          sensitiveContent: observation.sensitiveContent,
        },
      });
      return reply
        .status(201)
        .send({ observation, sessionRevision: session.revision });
    },
  );

  app.post("/v1/knowledge/search", async (request) => {
    const identity = identityFromRequest(request, authMode);
    const input = knowledgeSearchRequestSchema.parse(request.body);
    const session = sessions.getAuthorized(input.session_id, identity);
    const response = await knowledge.search(
      input,
      sessions.latestObservation(session.id),
      identity,
    );
    audit.append({
      tenantId: session.tenantId,
      sessionId: session.id,
      actorType: "system",
      actorId: "knowledge-specialist",
      eventType: "KNOWLEDGE_RETRIEVED",
      eventPayload: {
        queryId: response.queryId,
        documentIds: response.results.map((result) => result.documentId),
        confidence: response.confidence,
        requiresHumanReview: response.requiresHumanReview,
      },
    });
    return response;
  });

  app.get("/v1/support-sessions/:sessionId/audit-events", async (request) => {
    const identity = identityFromRequest(request, authMode);
    const session = sessions.getAuthorized(sessionIdFrom(request), identity);
    return {
      events: audit.list(session.id),
      integrityValid: audit.verify(session.id),
    };
  });

  app.get("/v1/support-sessions/:sessionId/events", async (request, reply) => {
    const identity = identityFromRequest(request, authMode);
    const session = sessions.getAuthorized(sessionIdFrom(request), identity);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    const send = (event: unknown) =>
      reply.raw.write(`event: audit\ndata: ${JSON.stringify(event)}\n\n`);
    for (const event of audit.list(session.id)) send(event);
    const unsubscribe = audit.subscribe(session.id, send);
    request.raw.on("close", unsubscribe);
  });

  return app;
}
