# Backend API

## Conventions

Current observation limits are 300 visible non-sensitive text entries of up to 1,500 characters and 300 observed controls. Realtime context sends at most 50 eligible control names. These limits do not permit passwords, hidden values, tokens, payment data, or other sensitive fields.

The API prefix is `/v1`. JSON request bodies reject unknown fields. Authenticated claims determine the user and tenant; clients cannot select a tenant by sending a body field. Identifiers are opaque. Timestamps use UTC ISO 8601. Mutating requests accept an idempotency key where retry could duplicate work.

During local development, a documented mock identity header is available only when `AUTH_MODE=mock`. Production modes reject it.

Error responses use:

```json
{
  "error": {
    "code": "consent_required",
    "message": "AI browser control requires an active user grant.",
    "request_id": "req_example"
  }
}
```

## Local authentication status

`GET /v1/auth/config`

Reports whether the service is using the local mock boundary or the production Entra ID boundary. Production mode currently reports unconfigured and rejects header identity.

## Sessions

### Create a support session

`POST /v1/support-sessions`

```json
{
  "channel": "browser_extension",
  "voice_enabled": true,
  "entry_context": { "tab_origin": "https://login.salesforce.com" }
}
```

Returns the session, its revision, current state, effective feature flags, and restricted/allowed origin policy. Creation does not grant microphone, viewing, control, or recording consent.

### Read a session

`GET /v1/support-sessions/{session_id}`

Returns only a session belonging to the authenticated tenant and authorized participant.

### Pause or resume

`POST /v1/support-sessions/{session_id}/pause`

`POST /v1/support-sessions/{session_id}/resume`

Pause increments the session revision, closes the current voice-provider session, releases local microphone access, and blocks provider, workflow, command, ticket, and handoff side effects. Resume never restores an expired or revoked consent grant and never restarts the microphone automatically.

### End a session

`POST /v1/support-sessions/{session_id}/end`

Ending stops media/control capability, revokes session-scoped grants, closes provider sessions, records the terminal state, and is idempotent.

## Consent

### Record consent

`POST /v1/support-sessions/{session_id}/consents`

```json
{
  "grant_type": "screen_view_ai",
  "scope": "selected_tab",
  "allowed_origins": ["https://login.salesforce.com"],
  "expires_when": "session_ends"
}
```

Valid grant types are microphone, AI screen view, AI browser control, human screen view, human browser control, and optional recording. Browser-control consent never follows from any other grant.

### Revoke consent

`DELETE /v1/support-sessions/{session_id}/consents/{consent_id}`

Revocation increments the session revision and invalidates dependent pending commands before returning success.

## Observation and events

### Submit a sanitized observation

`POST /v1/support-sessions/{session_id}/observations`

The request contains origin, page fingerprint, application, visible non-sensitive text, safe accessible controls, screen state, confidence, and a sensitive-content flag. Raw cookies, storage, tokens, password values, hidden values, and payment values are never valid fields.

The extension submits the first observation after explicit tab-sharing consent. While sharing remains active, meaningful DOM mutations are debounced and re-sanitized; a new request is made only when the sanitized fingerprint changes. Every accepted refresh becomes the authoritative latest observation and receives its own `OBSERVATION_RECORDED` audit event.

### Session event stream

`GET /v1/support-sessions/{session_id}/events`

The local implementation streams existing and newly appended audit events. Typed state, caption, guidance, command, workflow, and handoff events remain production transport work. OpenAI Realtime media travels over the browser WebRTC peer connection, not this event stream.

### Create an OpenAI Realtime WebRTC call

`POST /v1/support-sessions/{session_id}/realtime-call`

```json
{
  "offer_sdp": "v=0...",
  "reported_issue": "Salesforce sign-in failed",
  "application": "Salesforce",
  "visible_error": "SAML authentication failed",
  "available_controls": [
    {
      "name": "Try Again",
      "role": "button",
      "actions": ["CLICK_ELEMENT", "FOCUS_ELEMENT", "SCROLL_TO_ELEMENT"]
    }
  ]
}
```

Requires an active, unpaused session and a separate active microphone grant. The API sends the SDP offer and sanitized context to OpenAI using its server-only API key. Context may include up to 50 control names, roles, and locally allowed action types. The Realtime session exposes one function tool, `propose_browser_action`, which can return an exact control name, `CLICK_ELEMENT`, `FOCUS_ELEMENT`, or `SCROLL_TO_ELEMENT`, and a purpose for review but cannot approve or execute anything. The endpoint returns `provider`, `sessionId`, `model`, `answerSdp`, and `transport: "webrtc"`. It never returns the OpenAI API key. The extension sets the SDP answer on its peer connection and exchanges audio and Realtime events directly with OpenAI.

The API stores the provider call identifier only for hangup. It is not returned to the extension. If OpenAI fails, times out, omits the call identifier, or returns an empty SDP answer, the endpoint fails closed with `voice_provider_unavailable`.

During an established call, the extension may use Realtime `session.update` and conversation-item events to replace the proposal tool's eligible-control enum and add a bounded sanitized page-change summary. It does not send display pixels. A changed fingerprint invalidates any proposal card derived from the prior observation.

`POST /v1/support-sessions/{session_id}/voice/interrupt`

Authorizes interruption for an active session. The extension then sends `response.cancel` followed by `output_audio_buffer.clear` through the OpenAI Realtime data channel.

`POST /v1/support-sessions/{session_id}/voice/disconnect`

Requests provider hangup when browser negotiation or the established peer connection fails. Pause, consent revocation, and session end also request hangup through their lifecycle handlers.

## Commands

### Validate and audit a Realtime proposal

`POST /v1/support-sessions/{session_id}/realtime-action-proposals`

The request contains the Realtime call identifier, control name, control role, action type, and purpose. The API requires an active session, requires one unambiguous exact control in its latest observation, validates the action/control pair, and records `MODEL_ACTION_PROPOSED`. Only the validated response may be rendered as an approval card.

### Propose a command from a safe observation

`POST /v1/support-sessions/{session_id}/commands/propose`

The caller names an enabled control from the latest sanitized observation. For voice sessions this may originate from a schema-validated OpenAI Realtime function call shown to the employee as a proposal. The server independently resolves its element identifier, role, name, origin, and page fingerprint from the authoritative observation, rejects higher-risk control intent, and never accepts an arbitrary selector. The MVP proposal endpoint enables only click, focus, and scroll commands.

### Approve a command

`POST /v1/support-sessions/{session_id}/commands/{command_id}/approve`

Approval is bound to the exact command digest, session revision, controller, origin, risk, and expiry.

### Authorize immediately before dispatch

`POST /v1/support-sessions/{session_id}/commands/{command_id}/authorize`

The policy gateway rechecks active session state, pause, controller, command expiry, replay, revision, low-risk tier, origin policy, and the separate AI or human control grant. Revocation or pause before this call blocks dispatch.

### Record a command result

`POST /v1/support-sessions/{session_id}/commands/{command_id}/result`

The extension reports timestamps, element/precondition checks, dispatch status, page-change result, verification observation reference, and a safe failure code. The backend rejects results for commands that were not issued to that session. Successful verification is accepted only when the command status is `executed` and the action was dispatched; blocked or failed results cannot resolve the session.

After recording a result, the side panel immediately adopts the returned sanitized observation. If Realtime voice is active, it sends a bounded deterministic execution summary and requests one review of the latest page. The model may propose one further eligible action, ask a clarifying question, or recommend human support; every further action starts a new allow-once cycle.

The packaged extension independently re-sanitizes the current page and validates origin, fingerprint, observed element identifier, role, accessible name, visibility, enabled state, and sensitive-field classification immediately before executing its fixed command implementation.

## Knowledge

### Search permitted knowledge

`POST /v1/knowledge/search`

```json
{
  "session_id": "rs_example",
  "query": "Salesforce SAML authentication failed",
  "context": {
    "application": "Salesforce",
    "browser": "Microsoft Edge",
    "operating_system": "Windows 11"
  },
  "top_k": 10
}
```

Authorization filters run before permitted chunks are retrieved. Results contain citations, authority, freshness, relevance, applicable procedures/workflows, confidence, conflict status, and human-review status.

The default runtime store is empty. Without a configured enterprise connector, search returns an empty `results` array, `recommendedProcedure: null`, and `requiresHumanReview: true`; it never substitutes canned guidance.

### List or retrieve permitted documents and procedures

`GET /v1/knowledge/documents`

`GET /v1/knowledge/documents/{document_id}`

`GET /v1/knowledge/procedures/{procedure_id}`

Access is revalidated on every request. A forbidden document is returned as not found so the API does not reveal its existence.

### Retrieval feedback

`POST /v1/knowledge/queries/{query_id}/feedback`

Feedback can improve evaluation and draft candidates but cannot automatically approve or publish knowledge.

### List and synchronize connectors

`GET /v1/knowledge/connectors`

`POST /v1/knowledge/connectors/{connector_id}/sync`

Both routes require a knowledge-administrator role. The default runtime returns no connectors. Deterministic in-memory connector health is exercised only with injected test records; production synchronization is not active.

## Backend automation and handoff

### List and execute approved workflows

`GET /v1/workflows`

`POST /v1/support-sessions/{session_id}/workflows/{workflow_id}/executions`

The registry, not the caller, supplies risk, approvals, timeout, and verification method. Execution requires an active, unpaused session in the troubleshooting state, `user_approved: true`, and a non-empty `idempotency-key` header. Repeating the same key returns the original execution only while the session remains active.

### Create or read a ticket

`POST /v1/support-sessions/{session_id}/tickets`

`GET /v1/tickets/{ticket_id}`

The local adapter creates one tenant-scoped mock ServiceNow incident per session and includes sanitized diagnosis, knowledge, and workflow context.

### Request, list, and join human handoff

`POST /v1/support-sessions/{session_id}/human-handoff`

Requires an active, unpaused troubleshooting session and active `screen_view_human` consent for the observed origin, ensures a support record exists, and queues a sanitized context bundle.

`GET /v1/human-handoffs`

`POST /v1/human-handoffs/{handoff_id}/join`

Both queue routes require a support-agent role. Join atomically assigns the queued request; a second join receives a conflict. Human browser control remains disabled.

## Audit

`GET /v1/support-sessions/{session_id}/audit-events`

The local implementation is available to the employee who owns the session. Production support, security, and audit role access remains an authorization milestone. Payloads are redacted, and integrity hashes allow verification that the event sequence was not silently changed.
