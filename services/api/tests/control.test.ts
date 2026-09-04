import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const headers = {
  "x-remoteassist-tenant-id": "control-tenant",
  "x-remoteassist-user-id": "control-user",
};

describe("governed browser control API", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp({ authMode: "mock" });
  });

  afterEach(async () => {
    await app.close();
  });

  async function preparedSession(origin = "https://login.salesforce.com") {
    const created = await app.inject({
      method: "POST",
      url: "/v1/support-sessions",
      headers,
      payload: {
        channel: "browser_extension",
        voice_enabled: false,
        entry_context: { tab_origin: origin },
      },
    });
    const sessionId = created.json().session.id as string;
    await grant(sessionId, "screen_view_ai", "selected_tab", origin);
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin,
        page_title: "Salesforce SAML error",
        page_fingerprint: "sha256:current-page",
        application: "Salesforce",
        screen_state: "saml_login_error",
        visible_text: ["SAML authentication failed", "Try Again"],
        controls: [
          {
            elementId: "ra-retry",
            role: "button",
            name: "Try Again",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 120, height: 32 },
          },
          {
            elementId: "ra-delete",
            role: "button",
            name: "Delete account",
            disabled: false,
            rectangle: { x: 10, y: 60, width: 120, height: 32 },
          },
          {
            elementId: "ra-username",
            role: "textbox",
            name: "Username or Email",
            disabled: false,
            rectangle: { x: 10, y: 100, width: 180, height: 32 },
          },
        ],
        sensitive_content: true,
        confidence: 0.95,
      },
    });
    const controlConsent = await grant(
      sessionId,
      "browser_control_ai",
      "allow_once",
      origin,
    );
    return { sessionId, controlConsentId: controlConsent.id as string };
  }

  async function grant(
    sessionId: string,
    grantType: string,
    scope: string,
    origin = "https://login.salesforce.com",
  ) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/consents`,
      headers,
      payload: {
        grant_type: grantType,
        scope,
        allowed_origins: [origin],
        expires_when: "session_ends",
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().consent;
  }

  async function propose(
    sessionId: string,
    controlName = "Try Again",
    type:
      "CLICK_ELEMENT" | "FOCUS_ELEMENT" | "SCROLL_TO_ELEMENT" = "CLICK_ELEMENT",
  ) {
    return app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/propose`,
      headers,
      payload: {
        type,
        control_name: controlName,
        control_role: type === "FOCUS_ELEMENT" ? "textbox" : "button",
        purpose: "Retry the failed SSO request once",
        expected_text: "Salesforce home",
        controller: "ai",
      },
    });
  }

  it("executes the propose, approve, authorize, result, and verification state path", async () => {
    const { sessionId } = await preparedSession();
    const proposed = await propose(sessionId);
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json().command).toMatchObject({
      type: "CLICK_ELEMENT",
      risk: "low",
      approval_status: "pending",
      target: { strategy: "observed_element", name: "Try Again" },
    });
    const commandId = proposed.json().command.command_id as string;

    const approved = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/approve`,
      headers,
      payload: {},
    });
    expect(approved.json().command).toMatchObject({
      approval: "allow_once",
      approval_status: "approved",
    });

    const authorized = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/authorize`,
      headers,
      payload: {},
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().command.execution_status).toBe("authorized");

    const now = new Date();
    const result = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/result`,
      headers,
      payload: {
        command_id: commandId,
        status: "executed",
        started_at: now.toISOString(),
        completed_at: new Date(now.getTime() + 100).toISOString(),
        result: {
          element_found: true,
          action_dispatched: true,
          page_changed: true,
          verification_result: "passed",
          failure_code: null,
        },
      },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      command: { execution_status: "executed" },
      session: { status: "RESOLVED", controller: "none" },
    });

    const audit = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${sessionId}/audit-events`,
      headers,
    });
    const eventTypes = audit
      .json()
      .events.map((event: { eventType: string }) => event.eventType);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "COMMAND_PROPOSED",
        "COMMAND_APPROVED_ALLOW_ONCE",
        "COMMAND_AUTHORIZED",
        "COMMAND_RESULT_RECORDED",
      ]),
    );
    expect(audit.json().integrityValid).toBe(true);
  });

  it("requires the approved control role to match the observed target", async () => {
    const { sessionId } = await preparedSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/propose`,
      headers,
      payload: {
        type: "CLICK_ELEMENT",
        control_name: "Try Again",
        control_role: "link",
        purpose: "Retry the failed request once",
        controller: "ai",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("safe_target_not_found");
  });

  it("proposes opening the first incident link without treating navigation as ticket creation", async () => {
    const { sessionId } = await preparedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin: "https://login.salesforce.com",
        page_title: "Incidents View: Self Service | ServiceNow",
        page_fingerprint: "sha256:service-now-first-incident",
        application: "ServiceNow",
        screen_state: "incident_list",
        visible_text: ["Incidents", "INC0011556"],
        controls: [
          {
            elementId: "incident-1",
            role: "link",
            name: "INC0011556 INC0011556",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 120, height: 32 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      },
    });

    const guidance = await app.inject({
      method: "POST",
      url: "/v1/knowledge/search",
      headers,
      payload: {
        session_id: sessionId,
        query: "open first incident",
        context: { application: "ServiceNow" },
      },
    });
    expect(guidance.statusCode).toBe(200);
    expect(guidance.json().groundedGuidance.inferred).not.toContain(
      "create a support ticket",
    );

    const suggestion = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "open first incident",
        trigger: "chat",
        conversation_history: [],
      },
    });
    expect(suggestion.statusCode).toBe(201);
    expect(suggestion.json()).toMatchObject({
      reason: "first_incident_link",
      proposal: {
        controlName: "INC0011556 INC0011556",
        controlRole: "link",
        actionType: "CLICK_ELEMENT",
      },
    });

    const explicitSuggestion = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "open INC0011556 incident for me",
        trigger: "chat",
        conversation_history: [],
      },
    });
    expect(explicitSuggestion.statusCode).toBe(201);
    expect(explicitSuggestion.json()).toMatchObject({
      reason: "incident_link",
      proposal: {
        controlName: "INC0011556 INC0011556",
        actionType: "CLICK_ELEMENT",
      },
    });
  });

  it("rejects a higher-risk observed control proposed by a model", async () => {
    const { sessionId } = await preparedSession();
    const response = await propose(sessionId, "Delete account");

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("action_risk_not_low");
  });

  it("proposes opening a clearly named settings link", async () => {
    const { sessionId } = await preparedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin: "https://login.salesforce.com",
        page_title: "ServiceNow",
        page_fingerprint: "sha256:settings-navigation",
        application: "ServiceNow",
        screen_state: null,
        visible_text: ["Settings"],
        controls: [
          {
            elementId: "settings-link",
            role: "link",
            name: "Settings",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 120, height: 32 },
          },
          {
            elementId: "history-link",
            role: "tab",
            name: "History",
            disabled: false,
            rectangle: { x: 10, y: 60, width: 120, height: 32 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "open settings page",
        trigger: "chat",
        conversation_history: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      reason: "settings_navigation",
      proposal: {
        controlName: "Settings",
        controlRole: "link",
        actionType: "CLICK_ELEMENT",
      },
    });

    const historyResponse = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "open history tab",
        trigger: "chat",
        conversation_history: [],
      },
    });

    expect(historyResponse.statusCode).toBe(201);
    expect(historyResponse.json()).toMatchObject({
      reason: "explicit_navigation",
      proposal: {
        controlName: "History",
        controlRole: "tab",
        actionType: "CLICK_ELEMENT",
      },
    });
  });

  it("does not map the common word open to an unrelated navigation control", async () => {
    const { sessionId } = await preparedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin: "https://login.salesforce.com",
        page_title: "ServiceNow",
        page_fingerprint: "sha256:navigation-match",
        application: "ServiceNow",
        screen_state: null,
        visible_text: ["History", "Open accessibility preferences"],
        controls: [
          {
            elementId: "preferences-link",
            role: "link",
            name: "Open accessibility preferences Open accessibility preferences",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 220, height: 32 },
          },
          {
            elementId: "history-link",
            role: "link",
            name: "History",
            disabled: false,
            rectangle: { x: 10, y: 60, width: 120, height: 32 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "open history",
        trigger: "chat",
        conversation_history: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      reason: "explicit_navigation",
      proposal: { controlName: "History" },
    });
  });

  it("proposes scrolling to an explicitly named observed section", async () => {
    const { sessionId } = await preparedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin: "https://login.salesforce.com",
        page_title: "Supplier Invoice",
        page_fingerprint: "sha256:supplier-invoice",
        application: "SAP",
        screen_state: null,
        visible_text: ["General Information", "Tax"],
        controls: [
          {
            elementId: "tax-tab",
            role: "tab",
            name: "Tax",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 120, height: 32 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "scroll down to tax section",
        trigger: "chat",
        conversation_history: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      reason: "scroll_target",
      proposal: {
        controlName: "Tax",
        controlRole: "tab",
        actionType: "SCROLL_TO_ELEMENT",
      },
    });

    const clickResponse = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "click on tax",
        trigger: "chat",
        conversation_history: [],
      },
    });

    expect(clickResponse.statusCode).toBe(201);
    expect(clickResponse.json()).toMatchObject({
      reason: "explicit_navigation",
      proposal: {
        controlName: "Tax",
        controlRole: "tab",
        actionType: "CLICK_ELEMENT",
      },
    });
  });

  it("treats take-me-to requests as explicit navigation", async () => {
    const { sessionId } = await preparedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin: "https://login.salesforce.com",
        page_title: "SAP Home",
        page_fingerprint: "sha256:sap-home",
        application: "SAP",
        screen_state: null,
        visible_text: ["Create Supplier Invoice"],
        controls: [
          {
            elementId: "create-invoice",
            role: "link",
            name: "Create Supplier Invoice",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 220, height: 48 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/action-suggestions`,
      headers,
      payload: {
        query: "Take me to invoice page",
        trigger: "chat",
        conversation_history: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      reason: "explicit_navigation",
      proposal: {
        controlName: "Create Supplier Invoice",
        actionType: "CLICK_ELEMENT",
      },
    });
  });

  it("allows a governed focus proposal for a non-sensitive observed field", async () => {
    const { sessionId } = await preparedSession();
    const response = await propose(
      sessionId,
      "Username or Email",
      "FOCUS_ELEMENT",
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().command).toMatchObject({
      type: "FOCUS_ELEMENT",
      risk: "low",
      target: { role: "textbox", name: "Username or Email" },
    });
  });

  it("validates and audits a Realtime action proposal before display", async () => {
    const { sessionId } = await preparedSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/realtime-action-proposals`,
      headers,
      payload: {
        call_id: "call_retry",
        control_name: "Try Again",
        control_role: "button",
        action_type: "CLICK_ELEMENT",
        purpose: "Retry the failed request once",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().proposal).toMatchObject({
      callId: "call_retry",
      controlName: "Try Again",
      controlRole: "button",
      actionType: "CLICK_ELEMENT",
    });

    const audit = await app.inject({
      method: "GET",
      url: `/v1/support-sessions/${sessionId}/audit-events`,
      headers,
    });
    expect(
      audit
        .json()
        .events.some(
          (event: { eventType: string }) =>
            event.eventType === "MODEL_ACTION_PROPOSED",
        ),
    ).toBe(true);
  });

  it("validates a Realtime focus proposal for a safe observed field", async () => {
    const { sessionId } = await preparedSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/realtime-action-proposals`,
      headers,
      payload: {
        call_id: "call_focus",
        control_name: "Username or Email",
        control_role: "textbox",
        action_type: "FOCUS_ELEMENT",
        purpose: "Let the employee type their username manually",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().proposal).toMatchObject({
      controlName: "Username or Email",
      actionType: "FOCUS_ELEMENT",
    });
  });

  it("rejects a higher-risk Realtime proposal before display", async () => {
    const { sessionId } = await preparedSession();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/realtime-action-proposals`,
      headers,
      payload: {
        call_id: "call_delete",
        control_name: "Delete account",
        control_role: "button",
        action_type: "CLICK_ELEMENT",
        purpose: "Delete the account",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("model_action_proposal_rejected");
  });

  it("rejects a failed command result that claims verification passed", async () => {
    const { sessionId } = await preparedSession();
    const commandId = (await propose(sessionId)).json().command
      .command_id as string;
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/approve`,
      headers,
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/authorize`,
      headers,
      payload: {},
    });

    const now = new Date();
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/result`,
      headers,
      payload: {
        command_id: commandId,
        status: "failed",
        started_at: now.toISOString(),
        completed_at: new Date(now.getTime() + 100).toISOString(),
        result: {
          element_found: true,
          action_dispatched: false,
          page_changed: false,
          verification_result: "passed",
          failure_code: "dispatch_failed",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("refuses a control name that was not in the sanitized observation", async () => {
    const { sessionId } = await preparedSession();
    const response = await propose(sessionId, "Export all passwords");
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("safe_target_not_found");
  });

  it("refuses an ambiguous control name instead of choosing the first match", async () => {
    const { sessionId } = await preparedSession();
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/observations`,
      headers,
      payload: {
        origin: "https://login.salesforce.com",
        page_title: "Duplicate controls",
        page_fingerprint: "sha256:duplicate-page",
        application: "Salesforce",
        screen_state: null,
        visible_text: ["Choose a section"],
        controls: [
          {
            elementId: "ra-continue-1",
            role: "button",
            name: "Continue",
            disabled: false,
            rectangle: { x: 10, y: 20, width: 120, height: 32 },
          },
          {
            elementId: "ra-continue-2",
            role: "button",
            name: "Continue",
            disabled: false,
            rectangle: { x: 10, y: 60, width: 120, height: 32 },
          },
        ],
        sensitive_content: false,
        confidence: 0.8,
      },
    });

    const response = await propose(sessionId, "Continue");
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("safe_target_not_found");
  });

  it("blocks authorization after the user revokes control consent", async () => {
    const { sessionId, controlConsentId } = await preparedSession();
    const commandId = (await propose(sessionId)).json().command
      .command_id as string;
    await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/approve`,
      headers,
      payload: {},
    });
    await app.inject({
      method: "DELETE",
      url: `/v1/support-sessions/${sessionId}/consents/${controlConsentId}`,
      headers,
    });
    const response = await app.inject({
      method: "POST",
      url: `/v1/support-sessions/${sessionId}/commands/${commandId}/authorize`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("session_terminal");
  });

  describe("pronoun resolution and session reactivation", () => {
    let subApp: FastifyInstance;

    async function preparedSessionForApp(appInstance: FastifyInstance) {
      const created = await appInstance.inject({
        method: "POST",
        url: "/v1/support-sessions",
        headers,
        payload: {
          channel: "browser_extension",
          voice_enabled: false,
          entry_context: { tab_origin: "https://login.salesforce.com" },
        },
      });
      const sessionId = created.json().session.id as string;

      await appInstance.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/consents`,
        headers,
        payload: {
          grant_type: "screen_view_ai",
          scope: "selected_tab",
          allowed_origins: ["https://login.salesforce.com"],
          expires_when: "session_ends",
        },
      });

      await appInstance.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          origin: "https://login.salesforce.com",
          page_title: "Salesforce SAML error",
          page_fingerprint: "sha256:current-page",
          application: "Salesforce",
          screen_state: "saml_login_error",
          visible_text: ["SAML authentication failed", "Try Again"],
          controls: [
            {
              elementId: "ra-retry",
              role: "button",
              name: "Try Again",
              disabled: false,
              rectangle: { x: 10, y: 20, width: 120, height: 32 },
            },
            {
              elementId: "ra-delete",
              role: "button",
              name: "Delete account",
              disabled: false,
              rectangle: { x: 10, y: 60, width: 120, height: 32 },
            },
            {
              elementId: "ra-username",
              role: "textbox",
              name: "Username or Email",
              disabled: false,
              rectangle: { x: 10, y: 100, width: 180, height: 32 },
            },
          ],
          sensitive_content: true,
          confidence: 0.95,
        },
      });

      const controlConsentResponse = await appInstance.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/consents`,
        headers,
        payload: {
          grant_type: "browser_control_ai",
          scope: "allow_once",
          allowed_origins: ["https://login.salesforce.com"],
          expires_when: "session_ends",
        },
      });

      return {
        sessionId,
        controlConsentId: controlConsentResponse.json().consent.id as string,
      };
    }

    async function proposeForApp(
      appInstance: FastifyInstance,
      sessionId: string,
      controlName = "Try Again",
      type:
        | "CLICK_ELEMENT"
        | "FOCUS_ELEMENT"
        | "SCROLL_TO_ELEMENT" = "CLICK_ELEMENT",
    ) {
      return appInstance.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/propose`,
        headers,
        payload: {
          type,
          control_name: controlName,
          control_role: type === "FOCUS_ELEMENT" ? "textbox" : "button",
          purpose: "Retry the failed SSO request once",
          expected_text: "Salesforce home",
          controller: "ai",
        },
      });
    }

    beforeEach(() => {
      vi.stubEnv("LLM_PROVIDER", "vertex");
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      subApp = buildApp({ authMode: "mock" });
    });

    afterEach(async () => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await subApp.close();
    });

    it("pronoun resolution (unambiguous case)", async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        shouldPropose: true,
                        controlName: "Try Again",
                        actionType: "CLICK_ELEMENT",
                        purpose: "User asked to open it referring to Try Again",
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", mockFetch);

      const { sessionId } = await preparedSessionForApp(subApp);
      const response = await subApp.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "open it",
          trigger: "chat",
          conversation_history: [
            { sender: "user", text: "how to retry?" },
            {
              sender: "system",
              text: "You can click on the Try Again button.",
            },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        reason: "suggested",
        proposal: {
          controlName: "Try Again",
          actionType: "CLICK_ELEMENT",
        },
      });
    });

    it("pronoun resolution (ambiguous case -> no_clear_action)", async () => {
      const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        shouldPropose: false,
                        controlName: null,
                        actionType: null,
                        purpose: null,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", mockFetch);

      const { sessionId } = await preparedSessionForApp(subApp);
      const response = await subApp.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "open it",
          trigger: "chat",
          conversation_history: [
            { sender: "user", text: "what are my choices?" },
            {
              sender: "system",
              text: "You can click Try Again or click Delete account.",
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        proposal: null,
        reason: "no_clear_action",
      });
    });

    it("matches controls deterministically despite spelling typos/errors", async () => {
      const { sessionId } = await preparedSessionForApp(subApp);
      const response = await subApp.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "Open Try Agin for me",
          trigger: "chat",
          conversation_history: [],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        reason: "explicit_navigation",
        proposal: {
          controlName: "Try Again",
          actionType: "CLICK_ELEMENT",
        },
      });
    });

    it("reactivates a RESOLVED session when proposing a new browser command", async () => {
      const { sessionId } = await preparedSessionForApp(subApp);

      // Propose first command
      const proposed = await proposeForApp(subApp, sessionId, "Try Again");
      const commandId = proposed.json().command.command_id;

      // Approve, authorize, execute
      await subApp.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${commandId}/approve`,
        headers,
      });
      await subApp.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${commandId}/authorize`,
        headers,
      });
      const now = new Date();
      const resultResponse = await subApp.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${commandId}/result`,
        headers,
        payload: {
          command_id: commandId,
          status: "executed",
          started_at: now.toISOString(),
          completed_at: new Date(now.getTime() + 100).toISOString(),
          result: {
            element_found: true,
            action_dispatched: true,
            page_changed: true,
            verification_result: "passed",
            failure_code: null,
          },
        },
      });

      // Verify session is RESOLVED
      expect(resultResponse.json().session.status).toBe("RESOLVED");

      // Propose a second command
      const secondProposed = await proposeForApp(
        subApp,
        sessionId,
        "Username or Email",
        "FOCUS_ELEMENT",
      );
      expect(secondProposed.statusCode).toBe(201);

      // Verify session has transitioned back to TROUBLESHOOTING
      const sessionResponse = await subApp.inject({
        method: "GET",
        url: `/v1/support-sessions/${sessionId}`,
        headers,
      });
      expect(sessionResponse.json().session.status).toBe(
        "AWAITING_ACTION_APPROVAL",
      );
    });
  });

  describe("Multi-Step Resolution Plan lifecycle and audit trail", () => {
    it("proposes a multi-step resolution plan and audits PLAN_PROPOSED", async () => {
      const { sessionId } = await preparedSession();
      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "click Try Again",
          trigger: "chat",
          conversation_history: [],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan).toBeDefined();
      expect(body.plan.planId).toMatch(/^plan_/);

      const audit = await app.inject({
        method: "GET",
        url: `/v1/support-sessions/${sessionId}/audit-events`,
        headers,
      });
      const events = audit.json().events;
      const planProposed = events.find(
        (e: { eventType: string }) => e.eventType === "PLAN_PROPOSED",
      );
      expect(planProposed).toBeDefined();
      expect(planProposed.eventPayload.planId).toBe(body.plan.planId);
    });

    it("approves plan and records commands with stepIndex, logging COMMAND_APPROVED_UNDER_PLAN and COMMAND_AUTO_APPROVED_UNDER_PLAN", async () => {
      const { sessionId } = await preparedSession();
      const planId = "plan_test_audit_123";

      // 1. User approves plan
      const planApproveRes = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/plans/${planId}/approve`,
        headers,
        payload: { stepCount: 2, origin: "https://login.salesforce.com" },
      });
      expect(planApproveRes.statusCode).toBe(200);

      // 2. Propose step 0
      const propStep0 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/propose`,
        headers,
        payload: {
          type: "CLICK_ELEMENT",
          control_name: "Try Again",
          control_role: "button",
          purpose: "Step 0 purpose",
          controller: "ai",
          plan_id: planId,
          step_index: 0,
        },
      });
      expect(propStep0.statusCode).toBe(201);
      const cmd0 = propStep0.json().command;

      // 3. Approve step 0
      const appStep0 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${cmd0.command_id}/approve`,
        headers,
        payload: { planId, stepIndex: 0 },
      });
      expect(appStep0.statusCode).toBe(200);

      // 4. Authorize & record result for step 0
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${cmd0.command_id}/authorize`,
        headers,
      });
      const now = new Date();
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${cmd0.command_id}/result`,
        headers,
        payload: {
          command_id: cmd0.command_id,
          status: "executed",
          started_at: now.toISOString(),
          completed_at: new Date(now.getTime() + 50).toISOString(),
          result: {
            element_found: true,
            action_dispatched: true,
            page_changed: true,
            verification_result: "passed",
            failure_code: null,
          },
        },
      });

      // 5. Propose step 1
      const propStep1 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/propose`,
        headers,
        payload: {
          type: "CLICK_ELEMENT",
          control_name: "Try Again",
          control_role: "button",
          purpose: "Step 1 purpose",
          controller: "ai",
          plan_id: planId,
          step_index: 1,
        },
      });
      expect(propStep1.statusCode).toBe(201);
      const cmd1 = propStep1.json().command;

      // 6. Approve step 1 (auto-approved under plan)
      const appStep1 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/commands/${cmd1.command_id}/approve`,
        headers,
        payload: { planId, stepIndex: 1 },
      });
      expect(appStep1.statusCode).toBe(200);

      // 7. Complete plan
      const planResultRes = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/plans/${planId}/result`,
        headers,
        payload: {
          status: "completed",
          totalSteps: 2,
          completedSteps: 2,
        },
      });
      expect(planResultRes.statusCode).toBe(200);

      // Verify Audit Events
      const audit = await app.inject({
        method: "GET",
        url: `/v1/support-sessions/${sessionId}/audit-events`,
        headers,
      });
      const events = audit.json().events;

      // Check PLAN_APPROVED_BY_USER
      const planApproved = events.find(
        (e: { eventType: string }) => e.eventType === "PLAN_APPROVED_BY_USER",
      );
      expect(planApproved).toBeDefined();
      expect(planApproved.eventPayload.planId).toBe(planId);

      // Check step 0 logged COMMAND_APPROVED_UNDER_PLAN
      const cmd0Approved = events.find(
        (e: { eventType: string; eventPayload: { commandId?: string } }) =>
          e.eventPayload.commandId === cmd0.command_id &&
          e.eventType === "COMMAND_APPROVED_UNDER_PLAN",
      );
      expect(cmd0Approved).toBeDefined();
      expect(cmd0Approved.actorType).toBe("user");
      expect(cmd0Approved.eventPayload.approvedViaPlanId).toBe(planId);

      // Check step 1 logged COMMAND_AUTO_APPROVED_UNDER_PLAN
      const cmd1Approved = events.find(
        (e: { eventType: string; eventPayload: { commandId?: string } }) =>
          e.eventPayload.commandId === cmd1.command_id &&
          e.eventType === "COMMAND_AUTO_APPROVED_UNDER_PLAN",
      );
      expect(cmd1Approved).toBeDefined();
      expect(cmd1Approved.actorType).toBe("system");
      expect(cmd1Approved.eventPayload.approvedViaPlanId).toBe(planId);

      // Check PLAN_COMPLETED
      const planCompleted = events.find(
        (e: { eventType: string }) => e.eventType === "PLAN_COMPLETED",
      );
      expect(planCompleted).toBeDefined();
      expect(planCompleted.eventPayload.planId).toBe(planId);
      expect(planCompleted.eventPayload.completedSteps).toBe(2);
    });
  });

  describe("Grounded Investigative Intent Classification & Navigation Plans", () => {
    const sapHomeObservation = {
      origin: "https://my426318.s4hana.cloud.sap",
      page_title: "SAP S/4HANA Home",
      page_fingerprint: "sha256:sap-home-test",
      application: "SAP",
      screen_state: null,
      visible_text: ["Home", "Procurement", "Sales", "Finance"],
      controls: [
        {
          elementId: "tab-home",
          role: "tab",
          name: "My Home",
          disabled: false,
          rectangle: { x: 10, y: 20, width: 100, height: 32 },
        },
        {
          elementId: "tab-procurement",
          role: "tab",
          name: "Procurement",
          disabled: false,
          rectangle: { x: 120, y: 20, width: 120, height: 32 },
        },
        {
          elementId: "tab-finance",
          role: "tab",
          name: "Finance",
          disabled: false,
          rectangle: { x: 250, y: 20, width: 100, height: 32 },
        },
      ],
      sensitive_content: false,
      confidence: 0.95,
    };

    const sapProcurementObservation = {
      origin: "https://my426318.s4hana.cloud.sap",
      page_title: "Manage Purchase Orders",
      page_fingerprint: "sha256:sap-procurement-test",
      application: "SAP",
      screen_state: null,
      visible_text: ["Manage Purchase Orders", "Search", "Standard PO 4500068938"],
      controls: [
        {
          elementId: "input-search-po",
          role: "textbox",
          name: "Search Purchase Orders",
          disabled: false,
          rectangle: { x: 50, y: 80, width: 250, height: 36 },
        },
      ],
      sensitive_content: false,
      confidence: 0.95,
    };

    it("Test 1: proposes initially only Step 1 (grounded) for casual investigative queries, and discovers next step on landing observation", async () => {
      const casualQueries = [
        "can you check purchase order 4500068938 and tell me what's wrong",
        "why is purchase order 4500068938 locked",
        "what's going on with PO 4500068938",
        "look into purchase order 4500068938 for me",
      ];

      for (const query of casualQueries) {
        const { sessionId } = await preparedSession(
          "https://my426318.s4hana.cloud.sap",
        );
        await app.inject({
          method: "POST",
          url: `/v1/support-sessions/${sessionId}/observations`,
          headers,
          payload: sapHomeObservation,
        });

        // 1. Initial proposal on SAP Home page
        const response1 = await app.inject({
          method: "POST",
          url: `/v1/support-sessions/${sessionId}/action-suggestions`,
          headers,
          payload: {
            query,
            trigger: "chat",
            conversation_history: [],
          },
        });

        expect(response1.statusCode).toBe(201);
        const body1 = response1.json();
        expect(body1.plan).toBeDefined();
        // Assert: initially proposes ONLY Step 1 (grounded in current observation)
        expect(body1.plan.steps.length).toBe(1);
        expect(body1.plan.steps[0].controlName).toBe("Procurement");
        expect(body1.plan.steps[0].actionType).toBe("CLICK_ELEMENT");
        expect(body1.plan.steps[0].grounded).toBe(true);

        // Check PLAN_PROPOSED audit event records grounded: true
        const audit1 = await app.inject({
          method: "GET",
          url: `/v1/support-sessions/${sessionId}/audit-events`,
          headers,
        });
        const planProposedEvent = audit1.json().events.find(
          (e: { eventType: string }) => e.eventType === "PLAN_PROPOSED",
        );
        expect(planProposedEvent.eventPayload.steps[0].grounded).toBe(true);

        // 2. Landing observation arrives after Step 1 execution
        await app.inject({
          method: "POST",
          url: `/v1/support-sessions/${sessionId}/observations`,
          headers,
          payload: sapProcurementObservation,
        });

        // Discovery for next step against the real landing observation using discoveryPlanId
        const approvedPlanId = body1.plan.planId;
        const response2 = await app.inject({
          method: "POST",
          url: `/v1/support-sessions/${sessionId}/action-suggestions`,
          headers,
          payload: {
            query,
            trigger: "discovery",
            conversation_history: [],
            discoveryPlanId: approvedPlanId,
          },
        });

        expect(response2.statusCode).toBe(201);
        const body2 = response2.json();
        expect(body2.plan).toBeDefined();
        expect(body2.plan.planId).toBe(approvedPlanId);
        expect(body2.plan.steps.length).toBe(1);
        expect(body2.plan.steps[0].controlName).toBe("Search Purchase Orders");
        expect(body2.plan.steps[0].actionType).toBe("FOCUS_ELEMENT");
        expect(body2.plan.steps[0].grounded).toBe(true);

        // Verify audit trail: exactly 1 PLAN_PROPOSED, 1 PLAN_STEP_DISCOVERED under approvedPlanId
        const audit2 = await app.inject({
          method: "GET",
          url: `/v1/support-sessions/${sessionId}/audit-events`,
          headers,
        });
        const events2 = audit2.json().events;
        const proposedEvents = events2.filter(
          (e: { eventType: string }) => e.eventType === "PLAN_PROPOSED",
        );
        expect(proposedEvents.length).toBe(1);

        const discoveredEvents = events2.filter(
          (e: { eventType: string }) => e.eventType === "PLAN_STEP_DISCOVERED",
        );
        expect(discoveredEvents.length).toBe(1);
        expect(discoveredEvents[0].eventPayload.planId).toBe(approvedPlanId);
      }
    });

    it("Test 2: falls back to text-only guidance when no plausible navigation control exists on the page", async () => {
      const { sessionId } = await preparedSession(
        "https://my426318.s4hana.cloud.sap",
      );
      // Observation with NO plausible procurement/order controls
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          origin: "https://my426318.s4hana.cloud.sap",
          page_title: "Error Dialog",
          page_fingerprint: "sha256:error-dialog",
          application: "SAP",
          screen_state: null,
          visible_text: ["Session Timed Out", "Close"],
          controls: [
            {
              elementId: "btn-close",
              role: "button",
              name: "Close",
              disabled: false,
              rectangle: { x: 10, y: 20, width: 80, height: 32 },
            },
          ],
          sensitive_content: false,
          confidence: 0.95,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "can you check purchase order 4500068938 and tell me what's wrong",
          trigger: "chat",
          conversation_history: [],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.plan).toBeNull();
      expect(body.proposal).toBeNull();
      expect(body.reason).toBe("no_plausible_navigation");
    });

    it("Test 3: confirms the plan's explanation never claims to have checked or diagnosed an unobserved record", async () => {
      const { sessionId } = await preparedSession(
        "https://my426318.s4hana.cloud.sap",
      );
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: sapHomeObservation,
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "Purchase order 4500068938 is locked by user in manage purchase orders can you check and tell me whats wrong",
          trigger: "chat",
          conversation_history: [],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      const explanation = body.plan.explanation;

      // Must NOT claim diagnosis or inspection of the record itself
      expect(explanation).not.toMatch(/\b(?:I\s+checked|diagnosed|inspected\s+PO|here\s+is\s+what(?:'s|\s+is)\s+wrong)\b/i);
      // Must honestly describe navigation
      expect(explanation).toContain("Procurement");
    });

    it("Test 4: confirms FOCUS_ELEMENT is only proposed on destination search/filter inputs and satisfies policy rules", async () => {
      const { sessionId } = await preparedSession(
        "https://my426318.s4hana.cloud.sap",
      );
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: sapProcurementObservation,
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "can you check purchase order 4500068938",
          trigger: "chat",
          conversation_history: [],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan.steps.length).toBe(1);
      const focusStep = body.plan.steps[0];
      expect(focusStep.actionType).toBe("FOCUS_ELEMENT");
      expect(focusStep.controlRole).toBe("textbox");
      expect(focusStep.controlName).toBe("Search Purchase Orders");
      // Must not be a form-filling action
      expect(focusStep.actionType).not.toBe("TYPE_TEXT" as any);
    });

    it("Test 5: multi-discovery chain with 3 steps emits exactly 1 PLAN_PROPOSED and multiple PLAN_STEP_DISCOVERED all carrying original planId", async () => {
      const { sessionId } = await preparedSession(
        "https://my426318.s4hana.cloud.sap",
      );
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: sapHomeObservation,
      });

      // Step 1: Initial proposal
      const res1 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query:
            "Purchase order 4500068938 is locked by user in manage purchase orders can you check and tell me whats wrong",
          trigger: "chat",
        },
      });
      const originalPlanId = res1.json().plan.planId;

      // User approves plan
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/plans/${originalPlanId}/approve`,
        headers,
        payload: { stepCount: 1, origin: "https://my426318.s4hana.cloud.sap" },
      });

      // Landing observation 1
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          ...sapProcurementObservation,
          page_fingerprint: "sha256:landing-1",
        },
      });

      // Discovery 1
      const res2 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "can you check purchase order 4500068938",
          trigger: "discovery",
          discoveryPlanId: originalPlanId,
        },
      });
      expect(res2.json().plan.planId).toBe(originalPlanId);

      // Landing observation 2
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          ...sapProcurementObservation,
          page_fingerprint: "sha256:landing-2",
        },
      });

      // Discovery 2
      const res3 = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "can you check purchase order 4500068938",
          trigger: "discovery",
          discoveryPlanId: originalPlanId,
        },
      });
      expect(res3.json().plan.planId).toBe(originalPlanId);

      // Complete plan
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/plans/${originalPlanId}/result`,
        headers,
        payload: { status: "completed", totalSteps: 3, completedSteps: 3 },
      });

      // Verify audit trail: exactly 1 PLAN_PROPOSED, 2 PLAN_STEP_DISCOVERED, 1 PLAN_COMPLETED all sharing originalPlanId
      const audit = await app.inject({
        method: "GET",
        url: `/v1/support-sessions/${sessionId}/audit-events`,
        headers,
      });
      const events = audit.json().events;

      const proposed = events.filter(
        (e: { eventType: string }) => e.eventType === "PLAN_PROPOSED",
      );
      expect(proposed.length).toBe(1);
      expect(proposed[0].eventPayload.planId).toBe(originalPlanId);

      const discovered = events.filter(
        (e: { eventType: string }) => e.eventType === "PLAN_STEP_DISCOVERED",
      );
      expect(discovered.length).toBe(2);
      expect(discovered[0].eventPayload.planId).toBe(originalPlanId);
      expect(discovered[1].eventPayload.planId).toBe(originalPlanId);

      const completed = events.filter(
        (e: { eventType: string }) => e.eventType === "PLAN_COMPLETED",
      );
      expect(completed.length).toBe(1);
      expect(completed[0].eventPayload.planId).toBe(originalPlanId);
    });

    it("proposes click action on Unlock button when user requests to unlock the purchase order", async () => {
      const { sessionId } = await preparedSession(
        "https://my426318.s4hana.cloud.sap",
      );

      const sapLockedObservation = {
        origin: "https://my426318.s4hana.cloud.sap",
        page_title: "Manage Purchase Orders",
        page_fingerprint: "sha256:sap-locked",
        application: "SAP",
        screen_state: null,
        visible_text: [
          "SAP Lock Conflict: Document 4500068938 is currently locked by user B.SMITH",
        ],
        controls: [
          {
            elementId: "search-po",
            role: "textbox",
            name: "Search Purchase Orders",
            disabled: false,
            rectangle: { x: 100, y: 120, width: 300, height: 36 },
          },
          {
            elementId: "btn-sm12",
            role: "button",
            name: "Simulate Lock Clearance (SM12 Release)",
            disabled: false,
            rectangle: { x: 100, y: 200, width: 220, height: 32 },
          },
          {
            elementId: "btn-unlock",
            role: "button",
            name: "Unlock",
            disabled: false,
            rectangle: { x: 500, y: 300, width: 70, height: 28 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      };

      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: sapLockedObservation,
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "Can you unlock the parchase order for me",
          trigger: "chat",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan).not.toBeNull();
      expect(body.plan.steps.length).toBe(1);
      expect(body.plan.steps[0].actionType).toBe("CLICK_ELEMENT");
      expect(body.plan.steps[0].controlName).toBe("Unlock");
    });

    it("proposes click action on Unlock button for compound investigative check-and-unlock query", async () => {
      const { sessionId } = await preparedSession(
        "https://my426318.s4hana.cloud.sap",
      );

      const sapLockedObservation = {
        origin: "https://my426318.s4hana.cloud.sap",
        page_title: "Manage Purchase Orders",
        page_fingerprint: "sha256:sap-locked-compound",
        application: "SAP",
        screen_state: null,
        visible_text: [
          "SAP Lock Conflict: Document 4500068938 is currently locked by user B.SMITH",
        ],
        controls: [
          {
            elementId: "search-po",
            role: "textbox",
            name: "Search Purchase Orders",
            disabled: false,
            rectangle: { x: 100, y: 120, width: 300, height: 36 },
          },
          {
            elementId: "btn-sm12",
            role: "button",
            name: "Simulate Lock Clearance (SM12 Release)",
            disabled: false,
            rectangle: { x: 100, y: 200, width: 220, height: 32 },
          },
          {
            elementId: "btn-unlock",
            role: "button",
            name: "Unlock",
            disabled: false,
            rectangle: { x: 500, y: 300, width: 70, height: 28 },
          },
        ],
        sensitive_content: false,
        confidence: 0.95,
      };

      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: sapLockedObservation,
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query:
            "Purchase order 4500068938 is locked by user in manage purchase orders can you check and tell me whats wrong and unlock the purchase order",
          trigger: "chat",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan).not.toBeNull();
      expect(body.plan.steps.length).toBe(1);
      expect(body.plan.steps[0].actionType).toBe("CLICK_ELEMENT");
      expect(body.plan.steps[0].controlName).toBe("Unlock");
    });

    it("proposes FOCUS_ELEMENT on Supplier ID when supplier field is missing", async () => {
      const { sessionId } = await preparedSession();
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          origin: "https://login.salesforce.com",
          page_title: "Manage Purchase Orders | SAP Fiori",
          page_fingerprint: "sha256:sap-po-missing-supplier",
          application: "SAP",
          screen_state: "po_error",
          visible_text: ["Mandatory field Supplier ID is missing."],
          controls: [
            {
              elementId: "alert-supplier",
              role: "alert",
              name: "Supplier Required Alert",
              disabled: false,
              rectangle: { x: 10, y: 10, width: 300, height: 40 },
            },
            {
              elementId: "po-supplier",
              role: "textbox",
              name: "Supplier ID",
              disabled: false,
              rectangle: { x: 10, y: 60, width: 200, height: 32 },
            },
            {
              elementId: "btn-save-po",
              role: "button",
              name: "Save Purchase Order",
              disabled: false,
              rectangle: { x: 10, y: 100, width: 140, height: 32 },
            },
          ],
          sensitive_content: false,
          confidence: 0.95,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "Mandatory field Supplier ID is missing, please help me enter it",
          trigger: "chat",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan).not.toBeNull();
      expect(body.plan.steps[0].actionType).toBe("FOCUS_ELEMENT");
      expect(body.plan.steps[0].controlName).toBe("Supplier ID");
    });

    it("proposes SCROLL_TO_ELEMENT on Price Variance Alert when user asks why invoice is blocked", async () => {
      const { sessionId } = await preparedSession();
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          origin: "https://login.salesforce.com",
          page_title: "Invoice Verification (MIRO) | SAP Fiori",
          page_fingerprint: "sha256:sap-invoice-variance",
          application: "SAP",
          screen_state: "invoice_variance",
          visible_text: ["Price variance tolerance exceeded."],
          controls: [
            {
              elementId: "alert-variance",
              role: "alert",
              name: "Price Variance Alert",
              disabled: false,
              rectangle: { x: 10, y: 10, width: 300, height: 40 },
            },
            {
              elementId: "inv-amount",
              role: "textbox",
              name: "Invoice Total Amount",
              disabled: false,
              rectangle: { x: 10, y: 60, width: 200, height: 32 },
            },
            {
              elementId: "btn-variance-appr",
              role: "button",
              name: "Request Variance Manager Approval",
              disabled: false,
              rectangle: { x: 10, y: 120, width: 220, height: 32 },
            },
          ],
          sensitive_content: false,
          confidence: 0.95,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "Why is this invoice blocked?",
          trigger: "chat",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan).not.toBeNull();
      expect(body.plan.steps[0].actionType).toBe("SCROLL_TO_ELEMENT");
      expect(body.plan.steps[0].controlName).toBe("Price Variance Alert");
    });

    it("proposes CLICK_ELEMENT on Request Variance Manager Approval when user requests override", async () => {
      const { sessionId } = await preparedSession();
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          origin: "https://login.salesforce.com",
          page_title: "Invoice Verification (MIRO) | SAP Fiori",
          page_fingerprint: "sha256:sap-invoice-variance",
          application: "SAP",
          screen_state: "invoice_variance",
          visible_text: ["Price variance tolerance exceeded."],
          controls: [
            {
              elementId: "alert-variance",
              role: "alert",
              name: "Price Variance Alert",
              disabled: false,
              rectangle: { x: 10, y: 10, width: 300, height: 40 },
            },
            {
              elementId: "btn-variance-appr",
              role: "button",
              name: "Request Variance Manager Approval",
              disabled: false,
              rectangle: { x: 10, y: 120, width: 220, height: 32 },
            },
          ],
          sensitive_content: false,
          confidence: 0.95,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "How do I request an override for this variance?",
          trigger: "chat",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.plan).not.toBeNull();
      expect(body.plan.steps[0].actionType).toBe("CLICK_ELEMENT");
      expect(body.plan.steps[0].controlName).toBe("Request Variance Manager Approval");
    });

    it("returns blockedByPolicy plan when user requests a higher-risk control like Reset without falling back to random controls", async () => {
      const { sessionId } = await preparedSession();
      await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/observations`,
        headers,
        payload: {
          origin: "https://login.salesforce.com",
          page_title: "Invoice Verification (MIRO) | SAP Fiori",
          page_fingerprint: "sha256:sap-invoice-variance",
          application: "SAP",
          screen_state: "invoice_variance",
          visible_text: ["Price variance tolerance exceeded."],
          controls: [
            {
              elementId: "inv-amount",
              role: "textbox",
              name: "Invoice Total Amount",
              disabled: false,
              rectangle: { x: 10, y: 60, width: 200, height: 32 },
            },
            {
              elementId: "btn-reset",
              role: "button",
              name: "Reset",
              disabled: false,
              rectangle: { x: 10, y: 120, width: 80, height: 32 },
            },
            {
              elementId: "btn-other",
              role: "button",
              name: "Validate Invoice",
              disabled: false,
              rectangle: { x: 100, y: 120, width: 120, height: 32 },
            },
          ],
          sensitive_content: false,
          confidence: 0.95,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/v1/support-sessions/${sessionId}/action-suggestions`,
        headers,
        payload: {
          query: "click on reset",
          trigger: "chat",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.plan).not.toBeNull();
      expect(body.plan.blockedByPolicy).toBe(true);
      expect(body.plan.blockedControlName).toBe("Reset");
      expect(body.plan.explanation).toContain("higher-risk control by security policy");
      expect(body.plan.explanation).toContain("manually");
      expect(body.plan.steps).toHaveLength(0);
      expect(body.proposal).toBeNull();
      expect(body.reason).toBe("action_risk_not_low");
    });
  });
});
