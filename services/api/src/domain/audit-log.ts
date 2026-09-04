import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent } from "@remoteassist/shared-types";

interface AppendAuditEvent {
  tenantId: string;
  sessionId: string;
  actorType: AuditEvent["actorType"];
  actorId: string;
  eventType: string;
  eventPayload?: Record<string, unknown>;
}

export class AuditLog {
  readonly #eventsBySession = new Map<string, AuditEvent[]>();
  readonly #subscribers = new Map<string, Set<(event: AuditEvent) => void>>();

  append(input: AppendAuditEvent): AuditEvent {
    const sessionEvents = this.#eventsBySession.get(input.sessionId) ?? [];
    const previousHash = sessionEvents.at(-1)?.integrityHash ?? "GENESIS";
    const unsigned = {
      id: `evt_${randomUUID()}`,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: input.eventType,
      eventPayload: input.eventPayload ?? {},
      timestamp: new Date().toISOString(),
      previousHash,
    };
    const integrityHash = createHash("sha256")
      .update(previousHash)
      .update(JSON.stringify(unsigned))
      .digest("hex");
    const event: AuditEvent = { ...unsigned, integrityHash };
    sessionEvents.push(event);
    this.#eventsBySession.set(input.sessionId, sessionEvents);
    for (const subscriber of this.#subscribers.get(input.sessionId) ?? [])
      subscriber(event);
    return event;
  }

  list(sessionId: string): AuditEvent[] {
    return [...(this.#eventsBySession.get(sessionId) ?? [])];
  }

  subscribe(
    sessionId: string,
    subscriber: (event: AuditEvent) => void,
  ): () => void {
    const subscribers = this.#subscribers.get(sessionId) ?? new Set();
    subscribers.add(subscriber);
    this.#subscribers.set(sessionId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(sessionId);
    };
  }

  verify(sessionId: string): boolean {
    const events = this.list(sessionId);
    let previousHash = "GENESIS";
    for (const event of events) {
      if (event.previousHash !== previousHash) return false;
      const { integrityHash, ...unsigned } = event;
      const expected = createHash("sha256")
        .update(previousHash)
        .update(JSON.stringify(unsigned))
        .digest("hex");
      if (expected !== integrityHash) return false;
      previousHash = integrityHash;
    }
    return true;
  }
}
