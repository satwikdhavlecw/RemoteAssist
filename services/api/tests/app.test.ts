import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createTestKnowledgeService } from "./knowledge-fixture.js";

const identityHeaders = {
  "x-remoteassist-tenant-id": "tenant-test",
  "x-remoteassist-user-id": "user-test",
};

describe("RemoteAssist API vertical slice", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({
      authMode: "mock",
      knowledgeService: createTestKnowledgeService(),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createSession() {
    const response = await app.inject({
      method: "POST",
      url: "/v1/support-sessions",
      headers: identityHeaders,
      payload: {
        channel: "browser_extension",
        voice_enabled: false,
        entry_context: { tab_origin: "https://login.salesforce.com" },
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().session as { id: string; revision: number };
  }

  async function grantScreenConsent(sessionId: string) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/consents`,
      headers: identityHeaders,
      payload: {
        grant_type: "screen_view_ai",
        scope: "selected_tab",
        allowed_origins: ["https://login.salesforce.com"],
        expires_when: "session_ends",
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().consent as { id: string };
  }

  it("creates a session without inferring consent", async () => {
    const session = await createSession();
    const response = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${session.id}`,
      headers: identityHeaders,
    });
    expect(response.json().session).toMatchObject({
      status: "AUTHENTICATED",
      consents: [],
      paused: false,
      controller: "none",
    });
  });

  it("rejects an observation until origin-scoped viewing consent exists", async () => {
    const session = await createSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${session.id}/observations`,
      headers: identityHeaders,
      payload: observationPayload(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("consent_required");
  });

  it("records a sanitized observation and returns cited grounded guidance", async () => {
    const session = await createSession();
    await grantScreenConsent(session.id);
    const observation = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${session.id}/observations`,
      headers: identityHeaders,
      payload: observationPayload(),
    });
    expect(observation.statusCode).toBe(201);
    expect(observation.json().observation.visibleText).toContain(
      "SAML authentication failed",
    );

    const search = await app.inject({
      method: "POST",
      url: "/v1/knowledge/search",
      headers: identityHeaders,
      payload: {
        session_id: session.id,
        query: "Salesforce is not opening",
        context: {
          application: "Salesforce",
          visible_error: "SAML authentication failed",
        },
        top_k: 10,
      },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({
      recommendedProcedure: "proc_test_salesforce_saml",
      requiresHumanReview: false,
    });
    expect(search.json().results[0].sourceReference).toBe("KB-TEST-001");
    expect(search.json().groundedGuidance.proposedNextStep).toContain("Retry");
  });

  it("blocks observation immediately after pause", async () => {
    const session = await createSession();
    await grantScreenConsent(session.id);
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${session.id}/pause`,
      headers: identityHeaders,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${session.id}/observations`,
      headers: identityHeaders,
      payload: observationPayload(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("session_paused");
  });

  it("makes screen-consent revocation terminal and preserves a valid audit chain", async () => {
    const session = await createSession();
    const consent = await grantScreenConsent(session.id);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/v1/support-sessions/${session.id}/consents/${consent.id}`,
      headers: identityHeaders,
    });
    expect(revoke.json().session).toMatchObject({
      status: "CONSENT_REVOKED",
      paused: true,
      controller: "none",
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${session.id}/audit-events`,
      headers: identityHeaders,
    });
    const audit = auditResponse.json();
    expect(audit.integrityValid).toBe(true);
    expect(audit.events.at(-1).eventType).toBe("CONSENT_REVOKED");

    let previousHash = "GENESIS";
    for (const event of audit.events) {
      const { integrityHash, ...unsigned } = event;
      expect(event.previousHash).toBe(previousHash);
      expect(
        createHash("sha256")
          .update(previousHash)
          .update(JSON.stringify(unsigned))
          .digest("hex"),
      ).toBe(integrityHash);
      previousHash = integrityHash;
    }
  });

  it("does not disclose whether another tenant owns a session", async () => {
    const session = await createSession();
    const response = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${session.id}`,
      headers: {
        ...identityHeaders,
        "x-remoteassist-tenant-id": "tenant-attacker",
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("session_not_found");
  });

  it("allows the documented 127.0.0.1 support-console preflight", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/human-handoffs",
      headers: {
        origin: "http://127.0.0.1:4330",
        "access-control-request-method": "GET",
        "access-control-request-headers":
          "x-remoteassist-tenant-id,x-remoteassist-user-id,x-remoteassist-roles",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:4330",
    );
  });

  it("starts runtime knowledge empty without injected fixtures", async () => {
    const emptyApp = buildApp({ authMode: "mock" });
    try {
      const sessionResponse = await emptyApp.inject({
        method: "POST",
        url: "/v1/support-sessions",
        headers: identityHeaders,
        payload: {
          channel: "browser_extension",
          voice_enabled: false,
          entry_context: { tab_origin: "https://login.salesforce.com" },
        },
      });
      const sessionId = sessionResponse.json().session.id as string;
      const search = await emptyApp.inject({
        method: "POST",
        url: "/v1/knowledge/search",
        headers: identityHeaders,
        payload: {
          session_id: sessionId,
          query: "Salesforce SAML authentication failed",
          context: {
            application: "Salesforce",
            visible_error: "SAML authentication failed",
          },
          top_k: 10,
        },
      });

      expect(search.statusCode).toBe(200);
      expect(search.json()).toMatchObject({
        results: [],
        recommendedProcedure: null,
        requiresHumanReview: true,
      });
    } finally {
      await emptyApp.close();
    }
  });
});

function observationPayload() {
  return {
    origin: "https://login.salesforce.com",
    page_title: "Salesforce sign in",
    page_fingerprint: "sha256:fixture-salesforce-saml",
    application: "Salesforce",
    screen_state: "saml_login_error",
    visible_text: ["SAML authentication failed", "Try Again"],
    controls: [
      {
        elementId: "retry-button",
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
