# Threat model

## Security objective

RemoteAssist must help with the active support issue while preserving user control, tenant isolation, source authorization, sensitive data, and an auditable record. It must fail closed when identity, consent, state, origin, target, or policy is uncertain.

## Protected assets

- Employee identity, device context, transcript, and support history.
- Screen and microphone data.
- Authentication tokens, passwords, one-time codes, cookies, browser storage, payment details, and other secrets.
- Enterprise knowledge and its source-system permissions.
- Browser-control capability and AutomationEdge workflows.
- Human support identities and permissions.
- Audit history and ticket records.

## Main threats and controls

### A hostile page attempts prompt injection

Threat: visible text or DOM attributes tell the support agent to reveal data, grant permission, expand scope, or run a command.

Controls: page content is labeled untrusted; it cannot alter system policy or authorize tools; retrieval and model output use strict schemas; capabilities come from fixed packaged allowlists; policy is evaluated outside the model; arbitrary JavaScript and raw debugger commands are prohibited.

### A command targets sensitive or hidden data

Threat: an apparently safe click, focus, or scroll action resolves ambiguously or targets a password, OTP, payment, hidden, disabled, obscured, or tenant-sensitive element.

Controls: sanitizer removes sensitive values; duplicate accessible names fail closed; the executor resolves the element immediately before action; semantic field classification uses type, autocomplete, accessible labels, nearby text, policy markers, visibility, enablement, and geometry; sensitive targets fail closed; click proposals require an explicitly named current button, link, tab, or menu item and block risky labels; an external destination is eligible only when its observed control is explicitly named by the user and approved once; unnamed, unobserved, and model-only links remain blocked; focus and scroll never type or submit; `TYPE_TEXT` remains disabled until these tests pass.

### Stale-plan drift in multi-step resolution plans

Threat: a user approves an ordered multi-step resolution plan based on the initial page observation, but dynamic DOM mutations, client-side routing, asynchronous content loading, or redirects between steps alter the page state, causing subsequent steps to execute against unexpected, sensitive, disabled, or cross-origin elements.

Controls:
- A multi-step plan is an advisory proposal, not an execution bypass.
- Plans are strictly capped at `MAX_RESOLUTION_PLAN_STEPS = 5`; oversized plans are truncated with a prominent safety warning banner.
- Non-blind live execution loop: immediately before **each individual step** executes, the extension captures a fresh live observation of the active tab.
- Origin invariance: the fresh observation's origin must strictly match the session's initial consented origin (`fresh.origin === initial.origin`); cross-origin navigation halts execution immediately.
- Dynamic target re-resolution: the target element is re-resolved from the fresh live DOM observation, not from a stale snapshot or cached node reference.
- Live risk gating: the server and client safety gates (`isPotentiallyLowRiskAction` and policy allowlists) are re-evaluated against the live target element immediately before dispatching the command.
- Fail-closed behavior: if a target disappears, becomes disabled, changes role, or fails the risk policy, execution stops immediately, later steps remain unexecuted, and the exact failure reason is surfaced in the UI.
- Always-visible abort control: an emergency Stop button remains accessible throughout plan execution. Pre-step and post-observation abort checks ensure immediate halts without executing the next step.
- Distinct audit attribution: standing plan approvals never masquerade as repeated human clicks. Step 1 logs `COMMAND_APPROVED_UNDER_PLAN` (actor: `user`), while steps 2..N log `COMMAND_AUTO_APPROVED_UNDER_PLAN` (actor: `system`). All steps carry `planId` and `approvedViaPlanId: planId`, terminating in an explicit `PLAN_COMPLETED` or `PLAN_ABORTED` event.

### A model attempts to chain actions after one approval

Threat: the model treats an approved action as permission to continue controlling the page outside of an approved plan.

Controls: the action result is a bounded conversation item, not a capability grant. A post-action review may create at most a new pending proposal or resolution plan. Every proposal passes client and server validation, exact current observation and ambiguity checks, a new command ID and expiry, policy authorization, audit, and an explicit allow-once employee decision.

### Consent is inferred, stale, or raced

Threat: a pending command executes after pause, revocation, navigation, or session end.

Controls: consent grants are separate, scoped, expiring records; the exact affected tab ID is pinned before the sharing chooser and never replaced merely because browser focus changes; commands include session revision, origin, fingerprint, controller, approval, and short expiry; executor rechecks current state immediately before dispatch; a shared domain guard blocks command, voice, workflow, ticket, and handoff capabilities whenever a session is paused or terminal; pause, revoke, and end close the voice-provider session; race tests require revocation to win.

For globally opened side panels, selecting an external application uses two explicit capability steps. A temporary optional `tabs` grant identifies and displays the active origin; a second prompt grants only the selected HTTP or HTTPS host. The metadata grant is removed after selection, and origin policy is still repeated by the service worker and API.

### Command replay or modification

Threat: a valid command is captured, changed, or executed twice.

Controls: unique command IDs, authenticated transport, strict schema with unknown fields and contradictory results rejected, server-side approval binding, one-time execution record, short expiry, idempotency, session revision, target preconditions, and complete audit events. A result can pass verification only when the command executed and dispatched its action.

### Cross-tenant or over-privileged access

Threat: a user, model request, connector, or human agent reads another tenant's session or knowledge.

Controls: tenant identity is derived from authenticated claims rather than request bodies; every query is tenant-scoped; knowledge ACL filtering happens before content retrieval; runtime contains no canned fallback documents; a no-match response disables knowledge-derived and backend operations; a Realtime function call can create only a proposal card for a locally allowed click, focus, or scroll pair and still passes client schema, ambiguity, target, and full server allow-once command policy; human roles are validated server-side; storage policies and tests cover cross-tenant identifiers; connector credentials are tenant-scoped in a secrets manager.

### Restricted-site observation

Threat: the user navigates to banking, personal email, password management, payment, healthcare, government identity, or tenant-blocked content.

Controls: origin changes are checked in the extension and backend; observation and control stop immediately; existing overlays clear; voice/text help may continue without visual context; the audit record stores only the restriction category and origin hash or approved minimal identifier, never page content.

### Sensitive data leaks through models, logs, tickets, or recordings

Threat: secrets or raw screen contents leave their intended boundary.

Controls: minimize capture; sanitize DOM observations before providers; debounce DOM mutations and transmit only changed sanitized fingerprints; send only consented microphone audio, bounded visible text, and bounded sanitized support context to OpenAI Realtime; action context contains at most 25 locally filtered control names and roles, never selectors, identifiers, field values, hidden content, or display pixels; keep the standard API key on the backend; use a privacy-preserving safety identifier; raw recording off; sensitive snapshots never retained; structured redacted logs; ticket fields use sanitized summaries and references; no customer-data training authorization is inferred from using the provider. Enterprise activation still requires an approved data region, retention posture, and provider agreement.

Sanitized page fingerprints use packaged SHA-256 with published-vector regression tests. This avoids insecure-page Web Crypto availability differences without replacing the fingerprint with a collision-prone non-cryptographic hash.

Unknown applications are identified from bounded metadata, document title, or a primary heading instead of arbitrary page-wide text. Sensitive and secret-like candidates are rejected, and input values are never used for application naming or Realtime page context.

### Human operator abuse or impersonation

Threat: an unauthorized person views or controls a session, or bypasses the policy gateway.

Controls: enterprise authentication, server-side roles, queue authorization, named operator display, separate user grants for viewing and control, same command policy as AI, no raw remote-control channel, participant audit, inactivity timeout, immediate revoke, and competing-join protection.

### Compromised provider or connector

Threat: a voice, vision, model, knowledge, workflow, or ITSM provider returns malicious output or exposes credentials.

Controls: narrow adapter contracts, backend-only secrets, a fixed OpenAI API origin, a 15-second provider timeout, bounded SDP and context schemas, prompt-injection-resistant session instructions, privacy-preserving safety identifiers, redaction, least-privilege provider projects, and audit references without credentials. OpenAI output receives no browser tools; all actions still require RemoteAssist schema, policy, consent, deterministic execution, and audit checks. Rate limiting, circuit breaking, regional routing, and secrets-manager integration remain production gates.

### Extension supply-chain compromise

Threat: remotely loaded executable code or excessive browser permissions create hidden access.

Controls: Manifest V3 packaged executable code only, locked dependencies, reviewed build output, Content Security Policy, minimal permissions, optional host access, enterprise deployment controls, reproducible CI, dependency and artifact scanning, and no `eval` or remote script injection.

## Always-prohibited operations

- Read or enter passwords or one-time codes.
- Circumvent authentication or disable security controls.
- Submit payments, approve financial transactions, or approve contracts.
- Access clipboard secrets, cookies, tokens, local files, private keys, or hidden form values.
- Execute arbitrary JavaScript, shell commands, or raw Chrome DevTools commands.
- Navigate to unapproved origins or operate outside the active support issue.
- Continue after consent withdrawal or session termination.

## Security validation gates

Browser control cannot ship until schema, consent, origin, expiry, replay, fingerprint, sensitive-field, prompt-injection, and revocation-race tests pass. Human control cannot ship until audit integrity and human-role tests pass. Production cannot ship until threat-model review, dependency scanning, penetration testing, privacy review, and extension permission review are complete.
