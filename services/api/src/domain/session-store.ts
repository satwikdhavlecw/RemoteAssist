import { randomUUID } from "node:crypto";
import type {
  ConsentGrant,
  ConsentRequest,
  CreateSessionRequest,
  ObservationRequest,
  SanitizedObservation,
  SessionStatus,
  SupportSession,
} from "@remoteassist/shared-types";
import {
  canTransitionSession,
  isTerminalStatus,
} from "@remoteassist/policy-model";
import { DomainError } from "./errors.js";

export interface Identity {
  tenantId: string;
  userId: string;
  roles: string[];
}

export class SessionStore {
  readonly #sessions = new Map<string, SupportSession>();
  readonly #observations = new Map<string, SanitizedObservation[]>();

  create(identity: Identity, input: CreateSessionRequest): SupportSession {
    const now = new Date().toISOString();
    const session: SupportSession = {
      id: `rs_${randomUUID()}`,
      tenantId: identity.tenantId,
      userId: identity.userId,
      status: "AUTHENTICATED",
      revision: 1,
      channel: input.channel,
      voiceEnabled: input.voice_enabled,
      paused: false,
      entryOrigin: input.entry_context.tab_origin ?? null,
      controller: "none",
      createdAt: now,
      updatedAt: now,
      endedAt: null,
      consents: [],
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  getAuthorized(sessionId: string, identity: Identity): SupportSession {
    const session = this.#sessions.get(sessionId);
    if (
      !session ||
      session.tenantId !== identity.tenantId ||
      session.userId !== identity.userId
    ) {
      throw new DomainError(
        "session_not_found",
        "The support session was not found.",
        404,
      );
    }
    return session;
  }

  isActive(session: SupportSession): boolean {
    return !session.paused && !isTerminalStatus(session.status);
  }

  assertActive(session: SupportSession): void {
    if (isTerminalStatus(session.status)) {
      throw new DomainError(
        "session_terminal",
        "A finished session cannot use support capabilities.",
        409,
      );
    }
    if (session.paused) {
      throw new DomainError(
        "session_paused",
        "Resume the session before using support capabilities.",
        409,
      );
    }
  }

  addConsent(
    session: SupportSession,
    identity: Identity,
    input: ConsentRequest,
  ): ConsentGrant {
    this.assertActive(session);
    const consent: ConsentGrant = {
      id: `cns_${randomUUID()}`,
      sessionId: session.id,
      grantType: input.grant_type,
      scope: input.scope,
      allowedOrigins: input.allowed_origins,
      grantedBy: identity.userId,
      grantedAt: new Date().toISOString(),
      revokedAt: null,
      expiresAt: input.expires_at,
      expiresWhen: input.expires_when,
    };
    session.consents.push(consent);
    this.touch(session);
    return consent;
  }

  revokeConsent(session: SupportSession, consentId: string): ConsentGrant {
    const consent = session.consents.find(
      (candidate) => candidate.id === consentId,
    );
    if (!consent)
      throw new DomainError(
        "consent_not_found",
        "The consent grant was not found.",
        404,
      );
    if (!consent.revokedAt) {
      consent.revokedAt = new Date().toISOString();
      session.paused = true;
      session.controller = "none";
      this.touch(session);
      if (
        (consent.grantType === "screen_view_ai" ||
          consent.grantType === "browser_control_ai" ||
          consent.grantType === "screen_view_human" ||
          consent.grantType === "browser_control_human") &&
        session.status !== "RESOLVED"
      ) {
        this.transition(session, "CONSENT_REVOKED");
      }
    }
    return consent;
  }

  transition(session: SupportSession, status: SessionStatus): void {
    if (session.status === status) return;
    if (!canTransitionSession(session.status, status)) {
      throw new DomainError(
        "invalid_session_transition",
        `The session cannot transition from ${session.status} to ${status}.`,
        409,
      );
    }
    session.status = status;
    if (isTerminalStatus(status)) session.endedAt = new Date().toISOString();
    this.touch(session);
  }

  pause(session: SupportSession): void {
    if (isTerminalStatus(session.status)) {
      throw new DomainError(
        "session_terminal",
        "A finished session cannot be paused.",
        409,
      );
    }
    if (!session.paused) {
      session.paused = true;
      session.controller = "none";
      this.touch(session);
    }
  }

  resume(session: SupportSession): void {
    if (isTerminalStatus(session.status)) {
      throw new DomainError(
        "session_terminal",
        "A finished session cannot be resumed.",
        409,
      );
    }
    if (session.paused) {
      session.paused = false;
      this.touch(session);
    }
  }

  addObservation(
    session: SupportSession,
    input: ObservationRequest,
  ): SanitizedObservation {
    const observation: SanitizedObservation = {
      id: `obs_${randomUUID()}`,
      sessionId: session.id,
      origin: input.origin,
      pageTitle: input.page_title,
      pageFingerprint: input.page_fingerprint,
      application: input.application,
      screenState: input.screen_state,
      visibleText: input.visible_text,
      controls: input.controls,
      sensitiveContent: input.sensitive_content,
      confidence: input.confidence,
      createdAt: new Date().toISOString(),
    };
    const observations = this.#observations.get(session.id) ?? [];
    observations.push(observation);
    this.#observations.set(session.id, observations);
    this.touch(session);
    return observation;
  }

  latestObservation(sessionId: string): SanitizedObservation | null {
    return this.#observations.get(sessionId)?.at(-1) ?? null;
  }

  private touch(session: SupportSession): void {
    session.revision += 1;
    session.updatedAt = new Date().toISOString();
  }
}
