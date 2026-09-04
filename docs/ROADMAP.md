# RemoteAssist delivery roadmap

Last updated: 2026-09-04 (dynamic client-side SAP Purchase Order to Invoice validation workflow, semantic alert SafeControl capture, and governed focus/scroll/click resolution)

## How to read this roadmap

This is the delivery contract for the repository. A milestone is complete only when its code, tests, security checks, and plain-English documentation agree. A checked item is implemented and verified in the repository; an unchecked item is planned work.

Latest SAP validation status: The test fixture suite includes a dynamic, client-side Purchase Order (PO) to Invoice Validation Workflow integrated directly into the unified SAP S/4HANA launchpad (`tests/fixtures/sap-s4hana.html`) as well as the dedicated test page (`tests/fixtures/sap-po-invoice.html`), served by `npm run fixture` on port 4320:
1. **Dynamic Purchase Order Validation:** Saving with an empty Supplier ID renders a semantic Fiori red message strip (`role="alert"`, `aria-label="Supplier Required Alert"`) and error borders. RemoteAssist sanitizes the DOM, captures `Supplier ID` as a focusable `SafeControl`, and proposes a governed `FOCUS_ELEMENT` action so the user can enter the vendor ID.
2. **Dynamic Price Variance Validation:** When invoice amounts exceed PO amounts (e.g. $12,500 vs $10,000), client-side JavaScript dynamically evaluates the 25% tolerance breach, renders a semantic warning strip (`role="alert"`, `aria-label="Price Variance Alert"`), and reveals resolution action buttons (`Request Variance Manager Approval` and `View PO Line Item Details`).
3. **Dynamic Account Determination Error (OBYC):** When posting or validating an invoice with missing account assignment, client-side JavaScript renders an authentic SAP semantic error message strip (`role="alert"`, `aria-label="Account Determination Error Alert"`) indicating `[ERROR]: Account determination cannot be carried out for Company Code 1000, Chart of Accounts INT, Transaction Key WRX, Valuation Class 3000.` The view dynamically offers semantic resolution action buttons (`Check Material Valuation`, `Check Valuation Class`, and `Review OBYC Configuration`). The AI agent identifies the root cause (missing/incorrect account determination configuration) and proposes the corresponding resolution action, allowing users to inspect valuation data or assign the clearing account in OBYC.
4. **Governed Proposer Capabilities:** Without any hardcoded PO numbers, amounts, or alert text in agent/server code, queries like *"Why is this invoice blocked?"* propose `SCROLL_TO_ELEMENT` to the `Price Variance Alert`, while queries like *"Review OBYC Configuration"* propose `CLICK_ELEMENT` on `Review OBYC Configuration`.
5. **DOM Observation Sanitation:** `apps/browser-extension/src/security/sanitize.ts` indexes `[role='alert']` and `[role='status']` into `SafeControl[]`.
6. **Direct View & Scenario Routing:** In `tests/fixtures/sap-s4hana.html` and `tests/fixtures/sap-po-invoice.html`, URL parameters (`?scenario=missing-supplier`, `?scenario=price-variance`, `?scenario=account-determination`, `?view=create-po`, `?view=create-invoice`) allow direct access to views and test scenarios.
7. **Live Verification:** All scenarios pass automated and browser tests, validating preflight re-observation, non-blind execution, and audit trail integrity.

Latest voice status: the runtime voice mock has been removed. Browser speech mode now uses Chrome/Edge Web Speech recognition and speech synthesis with the existing consent, sanitized-context, Vertex/Gemini, and action-review paths, so local voice testing does not require an STT/TTS provider key. OpenAI Realtime uses a backend-created WebRTC call, server-only API key, microphone and response audio tracks, input/output transcripts, server voice activity detection, interruption events, and provider hangup on pause, revoke, or end. Backend voice providers such as ElevenLabs and Google Voice use live turn mode with bounded `/voice-query` utterances, Vertex/Gemini informational replies, visible provider labeling, current ElevenLabs STT/TTS defaults, clearer no-audio playback errors, backend action suggestions, and timing logs for transcription, guidance, action review, and synthesis. The side panel now keeps conversation and microphone controls on one scrollable support page instead of separate Chat and Voice tabs. Automated contract coverage does not make a billable provider call. Page-context messages, proposal-card acknowledgements, and post-action execution reviews are treated as silent context; follow-up review is text-only and may create a new function-call proposal without extra spoken narration. Live Chrome/Edge qualification remains the next concrete voice step.

Browser-permission recovery now uses a packaged full-tab extension page because Chrome side panels cannot display the microphone prompt. Its one-time probe track is stopped immediately and never reaches OpenAI; server consent and WebRTC still require a second explicit enable action in the side panel. Missing or busy devices receive distinct errors. Background startup also fails with an actionable context message instead of an uncaught `onInstalled` TypeError when a bundle is accidentally evaluated outside its Manifest V3 service worker.

Latest knowledge status: canned Salesforce guidance and `KB-DEMO-001` have been removed from runtime. The default store is empty and disables knowledge-derived and backend operations when no approved source matches. The configured LLM may provide a clearly labeled informational explanation from sanitized page context in that no-source case; the full parsed provider response is now preserved in chat, while only the provider's explicit output-token budget remains bounded. This path requests complete plain text, accepts valid JSON or prose for compatibility, preserves all Gemini text parts, rejects incomplete JSON wrappers, and falls back only when the provider is unavailable or returns a damaged/truncated response. Sanitized observation transport now allows up to 300 visible text entries of 1,500 characters each, while each LLM summary remains bounded to 60 entries of 600 characters. Ticket-creation questions use a request-aware safe fallback that explains the visible New/Create path without claiming submission. The model cannot claim enterprise approval or authorize an action. Provider failures now produce bounded diagnostic logs without exposing keys, while the UI keeps a safe deterministic fallback. Long chat responses use the side panel scroll container, wrap at long words, and are not clipped by an inner message viewport. Action-review requests retain up to 20 recent chat turns with a 4,000-character bound per turn. A narrow OpenAI Realtime function tool can dynamically select an eligible click, focus, or scroll action over one unambiguous observed control, but it creates only a review card; schema, current-target, risk, consent, policy, and deterministic execution remain outside the model. Navigation result cards remain visible after execution and tab clicks are marked verified only when the page or tab state changes. Synthetic knowledge records are injected only by automated tests. The next concrete knowledge step is an authenticated ServiceNow Knowledge or SharePoint connector.

The roadmap follows the order required by the source PRD: observe and guide before enabling browser control, build consent revocation before command execution, and build audit logging before human control.

Knowledge display update: when no approved database article matches, the
extension displays only the direct LLM explanation and next step. The internal
"Informational only" database-status prefix is no longer shown.

Action-control update: Multi-step resolution plans (ADR 0020) are now supported,
allowing users to review and approve ordered action chains up front with a single
"Approve all steps" button while preserving RemoteAssist's zero-trust live
execution invariant:
1. Steps are capped at `MAX_RESOLUTION_PLAN_STEPS = 5` with a visible warning on truncation.
2. A non-blind execution loop captures a fresh live observation before each step.
3. Targets are dynamically re-resolved from the fresh observation rather than stale snapshots.
4. Policy gates (`isPotentiallyLowRiskAction` and origin invariance) are re-evaluated live.
5. Missing targets, disabled controls, or policy violations stop the chain immediately and report the failure reason.
6. An always-visible Stop/Abort button enables immediate human intervention.
7. Audit distinction is strictly enforced: step 0 logs `COMMAND_APPROVED_UNDER_PLAN`,
steps 1..N log `COMMAND_AUTO_APPROVED_UNDER_PLAN`, and all command events carry `planId`
and `approvedViaPlanId`, ending with `PLAN_COMPLETED` or `PLAN_ABORTED`.
Clear named scroll requests such as `scroll down to the
Tax section` receive a deterministic proposal when the target is present
in the current sanitized observation. Allowlisted navigation labels are
prioritized before the observation control bound so large enterprise pages do
not hide their visible section targets. Enterprise tab activation sends the
normal pointer and mouse events before the keyboard fallback, while approval,
origin checks, target checks, audit logging, and post-action verification stay
required. Action suggestions are bound to the observation fingerprint that
was current when the request started. Highlighting also resolves controls inside open shadow roots.

Navigation intent and card control update: Interactive card/tile controls containing
headings, counter badges, and descriptive paragraphs (such as SAP Fiori tiles) now
extract their primary accessible name from child headings (`h1..h6`, `[role='heading']`)
before falling back to full text concatenation. Navigation queries now normalize
leading action verbs (`open`, `go to`, `click`, `navigate to`, `view`, `show`) and score
candidate controls by match precision (exact > prefix > substring > word overlap),
resolving commands like `Open Manage Purchase Orders` directly to the correct tile and
rendering the approval card immediately. Model proposal validation in the extension
sidepanel tolerates case-insensitive prefix/substring containment so safe proposals
bind reliably to live observation controls.

High-risk control policy enforcement and context mapping update:
1. **Zero-Trust Policy Block for Higher-Risk Controls:** In accordance with security policy, controls with higher-risk action verbs (such as `reset`, `delete`, `terminate`, `reboot`, `format`) cannot be executed by the automated agent.
2. **Valid Policy Reasoning in Chat Guidance:** When a user requests an action targeting a high-risk control (e.g. "click on reset"), both the grounded knowledge engine and LLM guidance explicitly explain that the control is classified as higher-risk by security policy and must be performed manually by the user directly on the page.
3. **Dedicated Policy Restriction Card:** The side panel renders a prominent Security Policy Restriction Card indicating the blocked control name, role, and policy rationale (`action_risk_not_low`), with a clear dismiss button rather than a misleading execution approval card.
4. **Context Mapping Fix Against Unrelated Fallbacks:** When a user query specifically targets a higher-risk control that is blocked by policy, both the backend control route and the client deterministic intent proposer immediately abort fallback scoring. They will never propose unrelated textboxes (such as focusing an amount field) or arbitrary buttons/scroll targets.


## Product outcome

The MVP is complete when a managed enterprise user can authenticate, start voice or text support, share a browser tab, receive grounded troubleshooting guidance, approve one safe browser action, revoke access instantly, run an approved AutomationEdge workflow, update an ITSM ticket, and hand the session to an authenticated human. Every access and action must appear in an integrity-protected audit trail.

## Delivery principles

- Ship vertical slices that are runnable by a developer and understandable by a reviewer.
- Keep enterprise dependencies behind narrow interfaces; automated tests use injected fakes and never require production credentials.
- Keep provider integrations behind narrow interfaces.
- Refuse unsupported actions instead of approximating them.
- Keep raw video and audio recording off by default.
- Update documentation and the roadmap in every implementation commit.
- Push a reviewed progress commit after each green milestone.

## Milestone 0 - Product foundation and security design

Status: complete

Purpose: establish a buildable architecture and make the security boundary explicit before executable control code exists.

Delivered:

- [x] Source PRD and knowledge specification retained in the repository.
- [x] Plain-English requirements traceability.
- [x] Browser-first architecture and trust-boundary design.
- [x] Consent model separated by microphone, screen viewing, AI control, human viewing, human control, and recording.
- [x] Risk tiers and always-prohibited operations.
- [x] Initial API contract and session lifecycle.
- [x] Minimal extension permission design.
- [x] Threat model covering hostile pages, prompt injection, stale commands, cross-tenant access, sensitive data, and human-role abuse.
- [x] Contributor rule requiring documentation in every coding iteration.
- [x] Decision to use a TypeScript npm-workspace monorepo with shared schemas and policy code.

Exit evidence:

- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/API.md`
- `docs/EXTENSION_PERMISSIONS.md`
- `docs/decisions/0001-typescript-monorepo.md`

## Milestone 1 - Runnable guided-support vertical slice

Status: implementation complete; interactive Chrome/Edge acceptance pending

Purpose: prove the complete observe-before-act path locally without browser control or external credentials.

Scope:

- [x] npm workspace, shared TypeScript configuration, linting, formatting, type checks, and unit test runner.
- [x] Manifest V3 extension with a persistent side panel, service worker, runtime-injected content script, and packaged assets only.
- [ ] Side-panel states are implemented for ready, connecting, permission required, observing, guiding, paused, error, and completed. A distinct reconnecting/connection-lost flow remains for the realtime milestone.
- [x] Text-first issue entry, visible text guidance, browser Web Speech voice testing, and optional provider-backed voice after separate microphone consent.
- [x] User-initiated tab sharing with a persistent indicator and emergency stop.
- [x] Exact support-tab binding across the display chooser and later focus changes; the extension never silently falls back to a different active tab.
- [x] Explicit external-site selection for globally opened side panels: temporary optional tab metadata, visible origin confirmation, exact HTTP/HTTPS host approval, and removal of the temporary metadata grant.
- [x] Pause immediately releases local display and microphone streams, closes the provider session, and requires explicit microphone re-enable after Resume.
- [x] Sanitized DOM observation that excludes passwords, hidden fields, tokens, browser storage, payment fields, one-time-code fields, and tenant-marked sensitive fields.
- [x] Consent-scoped DOM change observation that debounces mutations, records only changed sanitized fingerprints, updates Realtime context and eligible controls, and stops immediately on pause or revoke. Pixel-motion and OCR remain out of scope.
- [x] Environment-independent packaged SHA-256 fingerprints for approved HTTPS, localhost, and remote HTTP page contexts, covered by published hash vectors.
- [x] Metadata-driven recognition and visible page-title context for previously unknown browser applications without reading login field values.
- [x] Overlay renderer for highlight, tooltip, step number, scroll, and clear.
- [x] Session API for creation, consent, sanitized observations, server-sent events, pause, resume, revocation, and end.
- [x] Empty-by-default governed knowledge retrieval that fails closed; synthetic test fixtures verify citations, confidence, role, approval, and expiry behavior.
- [x] Append-only, hash-chained audit events for session, consent, observation, and retrieval operations.
- [x] Automated tests for state transitions, restricted origins, tenant isolation, DOM sanitation, consent revocation, pause, and audit integrity.

Validation on 2026-07-15: formatting, lint, type checks, 13 automated tests, production builds, zero known npm audit vulnerabilities, and a built-API smoke test passed. The in-app browser was unavailable, so the seven-step interactive acceptance scenario below must be completed locally before this milestone is marked fully complete.

Local runtime follow-up: the development manifest now grants only the fixed loopback fixture origins in addition to the API origins, preventing a pinned side panel from losing the demo tab URL when Chrome has not granted `activeTab` for that tab. External pages still require the toolbar user gesture. The tab-sharing picker now excludes the RemoteAssist extension surface, presents browser tabs, and excludes monitor/system-audio capture. The chat panel renders grounded guidance and an explicit no-approved-source response after each submitted message instead of showing only the user bubbles.

Acceptance scenario:

1. Load the unpacked extension in Chrome or Edge.
2. Start a local support session without cloud credentials.
3. Open the included Salesforce error fixture.
4. Grant tab observation after an explicit user gesture.
5. See a sanitized observation and an explicit no-approved-source result.
6. Ask OpenAI what to do. If it selects an eligible click, focus, or scroll action through its function tool, confirm the dynamically worded proposal card and highlight appear, and that execution still requires exact allow-once approval; confirm backend operations remain absent.
7. Pause or stop and confirm that observation and overlays cease immediately.

## Milestone 2 - Governed low-risk browser control

Status: MVP acceptance slice complete; expanded command allowlist and interactive browser QA pending

Purpose: enable a small command allowlist without giving either the AI or a human direct browser access.

Scope:

- [x] Versioned strict command schema shared by backend and extension with unknown fields and arbitrary command types rejected.
- [x] Policy gateway for session state, controller identity, consent scope, origin allowlist, low-risk classification, expiry, revision, and replay.
- [x] Explicit per-action `Allow once` consent and approval interface for the MVP click scenario; active proposals are shown directly below the watched-page context.
- [x] Clearly identified incident-number links (for example, `INC0011556`) and explicitly named observed navigation controls can be proposed for first-incident, explicit-incident, settings, history, or external-link navigation; plain-text navigation labels in common navigation containers are observed as stable links; each requires a fresh allow-once approval. Interactive browser validation remains pending.
- [x] Deterministic executors support highlight, clear, scroll, focus, and safe neutral click. Safe text, select, checkbox, approved navigation, back, refresh, wait, state read, and snapshot remain disabled until their command-specific tests exist.
- [x] Post-action recapture updates the visible observation and asks Realtime for one next-step review; every follow-up command requires a fresh proposal and allow-once decision.
- [x] Proposal-card creation and post-action review are silent model context, so approval execution is not interrupted by unnecessary voice narration.
- [x] Page fingerprint, target identity, visible/enabled state, accessible role/name, and sensitive-target checks immediately before dispatch. W3C AccName precedence prevents container sections from absorbing child button text, and `CLICK_ELEMENT` is strictly restricted to interactive controls (`button`, `link`, `tab`, etc.) to prevent `target_precondition_failed` errors on container landmarks.
- [x] Sensitive-target protection exists and `TYPE_TEXT` remains disabled.
- [x] Command proposal, approval, authorization, execution result, verification, and failure data are represented in the hash-chained audit trail.
- [x] Command-result validation rejects failed, blocked, or undispatched actions that claim successful verification.
- [x] Multi-step resolution plan approval redesign (ADR 0020) supporting up to 5-step plans, upfront approval review cards, live per-step re-observation, dynamic live target re-resolution, policy re-evaluation, immediate abort control, and distinct audit attribution (`COMMAND_APPROVED_UNDER_PLAN`, `COMMAND_AUTO_APPROVED_UNDER_PLAN`, `approvedViaPlanId`, `PLAN_COMPLETED`, and `PLAN_ABORTED`).
- [x] Grounded investigative intent classification and dynamic navigation discovery (ADR 0021): diagnostic queries ("can you check X and tell me what's wrong", "why is Y happening", "what's going on with Z") are classified as navigation requests toward destination records without claiming diagnosis or adding form-filling actions. Plans propose only verified current observation controls upfront (`grounded: true`), dynamically discovering destination controls (such as `FOCUS_ELEMENT` on search inputs) on fresh landing observations, with isolated domain fallback tables and strict truthfulness guarantees. Dynamic discovery emits `PLAN_STEP_DISCOVERED` carrying the approved plan ID without creating redundant top-level `PLAN_PROPOSED` entries, maintaining a zero-orphan audit trail.
- [x] Enterprise ERP navigation control policy precision: refined `higherRiskControlIntent` in the policy model to distinguish between enterprise business document navigation (`Manage Purchase Orders`, `Process Purchase Requisitions`, `Purchasing Document`) and e-commerce financial checkout actions (`Purchase`, `Buy Now`, `Complete Purchase`, `Pay`). Enhanced `findGroundedPlausibleControl` with candidate scoring to prioritize destination buttons and query-mentioned controls over top-level domain tabs when the user is already on the domain overview screen.
- [x] Destination search input precedence and plan step deduplication: when an investigative query is issued on a destination screen that already presents a domain-relevant search input (e.g., `Search Purchase Orders` in `Manage Purchase Orders`), the routing engine prioritizes directly proposing `FOCUS_ELEMENT` on the search input over navigating back to top-level domain tabs. In the dynamic execution loop (`ControlPanel.tsx`), discovery verifies candidate steps against all previously proposed/executed steps (`!activePlan.steps.some(...)`), preventing infinite loops and ensuring full 3-step navigation chains (`Home -> Procurement -> Manage Purchase Orders -> Focus Search`) execute and complete cleanly.
- [x] Unified resolution plan execution & single-flow approval guarantees: eliminated duplicate approval popups caused by passive background page changes interrupting active executions. Synchronized execution state tracking (`actionExecutingRef`) and retired legacy client-side prompt splitting (`splitFlowSteps`), ensuring multi-step plans and dynamic discoveries execute seamlessly to completion under a single user approval card ("Allow once" for 1-step actions, "Approve all N steps" for multi-step plans) without re-prompting on each navigation.
- [x] Document and record edit-lock clearance action support: refined `higherRiskControlIntent` in the policy model to allow enterprise record lock release actions (`Unlock`, `Simulate Lock Clearance (SM12 Release)`). Expanded action-intent recognition and routing to accurately prioritize explicit `CLICK_ELEMENT` action proposals for unlocking locked documents without dropping approval cards or erroneously falling through to scrolling. Enhanced `updateIssueAndSearch` in the browser extension to synchronously sample the live active tab via `REMOTEASSIST_OBSERVE_ACTIVE_TAB` before querying guidance and proposing actions, eliminating stale page state discrepancies. Updated `isInvestigativeQuery` in the control engine to prioritize grounded `Unlock` buttons over search box focusing when the user asks to unlock the purchase order.
- [ ] Tests cover schema tampering, stale fingerprints, hidden/sensitive targets, replay, revoked consent, restricted origins, password fields, OTP fields, and tenant isolation. Dedicated malicious-attribute, financial-control, and browser-based prompt-injection cases remain.

Validation on 2026-07-15: 25 automated tests passed. The fixture path performs one user-approved `Try Again` click and verifies the resulting Salesforce home state without reading the fixture password, username value, or hidden token.

Session-recovery fix on 2026-07-16: when `authorize()` rejects a command (expired, revision mismatch, consent revoked, or other policy failures), the session now resets the controller to `none` and transitions back to `TROUBLESHOOTING`. Previously the session became permanently stuck in `EXECUTING_BROWSER_ACTION` after any authorization failure, preventing all subsequent action proposals. Follow-up work on 2026-07-17 made proposal acknowledgement silent and changed post-action review to text-only so approval execution is not covered by extra voice output.

Repository-wide validation after the local Chrome runtime fixes on 2026-07-15: formatting, lint, TypeScript checks, 10 test files with 31 passing tests, and production builds for the API, extension, and support console passed.

Live browser verification on 2026-09-03: Real-world verification in Google Chrome connected to the live Fastify backend (`http://127.0.0.1:4310`) and live Salesforce & SAP fixtures (`http://127.0.0.1:4320/verify.html`) verified all six operational scenarios:
1. Happy path: Upfront approval card rendered all 3 steps (`Try Again`, `Open dashboard`, `Support Portal`), single user approval triggered non-blind live re-observation before each dispatch, and successfully recorded `PLAN_APPROVED_BY_USER`, step 1 `COMMAND_APPROVED_UNDER_PLAN` (user), steps 2-3 `COMMAND_AUTO_APPROVED_UNDER_PLAN` (system), and `PLAN_COMPLETED` under a shared `planId`.
2. Deliberate failure: Step 1 re-rendered page removing `Try Again`; step 2 live re-observation detected target absence, immediately halted without executing, surfaced `Step 2 stopped: Target control was not found on the live page`, and recorded `PLAN_ABORTED` with `failedStepIndex: 1`.
3. Mid-chain abort: Real 2-step plan approved; step 1 executed; user clicked "Stop plan execution" before step 2 ran; step 2 genuinely never fired, and `PLAN_ABORTED` was recorded with `status: "aborted"`.
4. Cross-origin abort: Real 2-step plan approved; step 1 executed and navigated tab across origins (`http://localhost:4320/external-partner`); step 2 live re-observation detected origin mismatch against initial session origin (`http://127.0.0.1:4320`), halted immediately, surfaced `Page origin changed`, and recorded `PLAN_ABORTED` with the origin mismatch reason.
5. Multi-discovery SAP investigative navigation: Real SAP S/4HANA Home fixture with user query *"Purchase order 4500068938 is locked by user in manage purchase orders can you check and tell me whats wrong"*. Initial plan proposed strictly grounded Step 1 (`CLICK_ELEMENT` on `Procurement` tab, `grounded: true`). On approval, Step 1 executed; landing observation discovered Step 2 (`Manage Purchase Orders` tile, `PLAN_STEP_DISCOVERED` carrying original planId); Step 2 executed; landing observation discovered Step 3 (`Search Purchase Orders` searchbox, `PLAN_STEP_DISCOVERED` carrying original planId); Step 3 focused the search box; plan completed with 2 discoveries, 3 real executed steps, and 0 orphaned `PLAN_PROPOSED` entries.
6. Direct 1-step focus on destination screen: When user asks *"can you check purchase order 4500068938"* while already on the Manage Purchase Orders screen, the destination search input precedence directly proposes a 1-step `FOCUS_ELEMENT` on `Search Purchase Orders` without typing. Approved and executed under a single `PLAN_PROPOSED` and `PLAN_COMPLETED`, with zero orphaned proposals.

Exit criteria:

- At least 95 percent of fixture-based low-risk commands execute successfully.
- Every command has an audit event.
- No command executes after revocation.
- Password and OTP interaction tests remain at zero executions.

## Milestone 3 - Voice and visual provider adapters

Status: browser speech test path and OpenAI Realtime implementation complete; live browser/provider qualification and visual adapters pending

Purpose: keep voice and visual work provider neutral while retaining deterministic local behavior.

Delivered:

- [x] OpenAI Realtime provider behind an application-owned interface, with injected non-network fakes used only by automated tests.
- [x] Backend-created WebRTC calls using a server-only API key after separate microphone consent; no long-lived key is returned to the extension.
- [x] Browser microphone gesture, WebRTC input/output tracks, input and output transcripts, server voice activity detection, mute, interruption, and confirmed transcript fallback.
- [x] Pause, consent revocation, and session end close local media, request OpenAI call hangup, and block new provider calls while paused or terminal.
- [x] Structured sanitized live-DOM observation and output validation.
- [x] Raw audio/video recording remains disabled. Microphone audio is transmitted only after explicit enablement and the UI names OpenAI as the recipient.
- [x] Optional Vertex/Gemini knowledge guidance sends explicit Gemini roles and has regression coverage for the `user` role required by Vertex AI.
- [x] Browser Speech API mode transcribes one short question in Chrome/Edge and speaks the returned guidance without an ElevenLabs STT/TTS key.

Still required for production qualification:

- [ ] Live Chrome/Edge OpenAI acceptance, push-to-talk, device selection, reconnect, provider outage fallback, secrets-manager integration, regional/retention approval, quotas, cost controls, and redacted provider telemetry.
- [ ] Screenshot sampling, OCR fallback, vision-model validation, sensitive visual-region handling, and one-frame-per-second enforcement.

The OpenAI integration uses the unified Realtime call flow documented in ADR 0004. The next step is to run the manual browser procedure with a non-production OpenAI project and record latency, transcript, interrupt, revoke, and hangup results.

## Milestone 4 - Governed enterprise knowledge

Status: governed service and injected-fixture tests complete; runtime connector and persistent search work pending

Purpose: prove that authorization and lifecycle filters run before enterprise content can enter retrieval or guidance.

Delivered and tested:

- [x] Empty runtime store plus explicitly injected ServiceNow and SharePoint test records behind a governed knowledge service.
- [x] Tenant, role, approval, and expiry filters applied before scoring or content return.
- [x] Test-only approved and restricted documents, an expired document, source metadata, version, authority, freshness, and citations.
- [x] Natural-language and exact-symptom keyword ranking with confidence and low-confidence human escalation.
- [x] Test-only structured Salesforce troubleshooting procedure and workflow association.
- [x] Knowledge-administrator-only connector listing and sync operation.

Still required for production:

- [ ] Authenticated ServiceNow Knowledge or SharePoint adapter with encrypted credentials.
- [ ] Full/incremental sync, deletion, supersession, ACL synchronization, persistent index, duplicate detection, and source links.
- [ ] Semantic/hybrid retrieval, conflict detection, retrieval feedback, admin evaluation, and governed draft candidates.

Automated tests prove the runtime starts empty, employees cannot retrieve restricted or expired test content, and connector operations require an administrator. No test record is loaded by the running API.

## Milestone 5 - AutomationEdge and ITSM integrations

Status: deterministic local acceptance slice complete; production adapters and asynchronous execution pending

Purpose: prove approvals, idempotency, verification, and support-record context without customer credentials.

Delivered locally:

- [x] AutomationEdge adapter boundary with a deterministic local implementation.
- [x] Workflow registry carrying risk, approval, timeout, idempotency, and verification metadata.
- [x] Explicit user approval and required idempotency key for the low-risk session diagnostic.
- [x] Session transitions through backend action and verification before returning to troubleshooting.
- [x] Workflow execution is limited to active, unpaused sessions in the troubleshooting state.
- [x] Mock ServiceNow incident creation/update with sanitized observation, knowledge references, and workflow execution identifiers.
- [x] Audit events for workflow and ticket operations.

Still required for production:

- [ ] AutomationEdge authentication, real request/response schemas, technical approvals, asynchronous status, timeout, cancellation, callbacks/polling, and production verification.
- [ ] ServiceNow and SupportFlo authenticated adapters, durable ticket updates, transcript/audit references, retry policy, and failure testing.

The Salesforce fixture can run the expired-session diagnostic and preserve its result in the mock ticket.

## Milestone 6 - Governed human takeover

Status: consented context-handoff slice complete; live human media and governed human commands pending

Purpose: transfer support context and ownership without creating an unrestricted remote-control side channel.

Delivered locally:

- [x] Role-scoped local support console and tenant-scoped escalation queue.
- [x] Separate employee grant for human viewing before a context bundle enters the queue.
- [x] Sanitized issue, application, visible error, ticket, session, consent, and participant context.
- [x] Atomic join so a second engineer cannot claim an assigned request.
- [x] Paused or terminal sessions disappear from the queue and cannot be requested or joined until the session is active.
- [x] Session transitions from troubleshooting to awaiting human to human connected.
- [x] Handoff, ticket, and human-join audit events.
- [x] No direct browser or desktop control channel in the console.

Still required for production:

- [ ] Entra-authenticated engineer identity, durable queue/presence, reconnect, disconnect, return-to-AI, and competing-agent load tests.
- [ ] Approved live screen/audio/transcript transport, AI summary, annotations, and pointer tools.
- [ ] Separate human-control grant and human commands routed through the existing schema, policy, deterministic executor, verification, revoke, and audit path.

The current console transfers sanitized context and ownership only; it clearly labels that live media and human control are not active.

## Milestone 7 - Production readiness and pilot

Status: planned

Purpose: make the validated MVP deployable and measurable in a controlled enterprise pilot.

Scope:

- [ ] PostgreSQL persistence, Redis transient state, migrations, tenant isolation, and backup/restore tests.
- [ ] Entra ID authorization code with PKCE, role mapping, managed-device context, and token lifecycle.
- [ ] OpenTelemetry metrics and traces without sensitive payloads.
- [ ] Rate limits, tenant quotas, inactivity timeouts, regional configuration, retention jobs, and secrets-manager integration.
- [ ] Container images, local compose environment, Kubernetes manifests, health probes, deployment runbook, and rollback exercise.
- [ ] Accessibility audit, load tests, extension packaging, enterprise deployment policy, and security review.
- [ ] Pilot dashboards for resolution, classification, element identification, command success, consent, escalation, duration, satisfaction, reopening, and cost.

## Explicitly deferred: native desktop companion

Arbitrary Windows application control is not part of the browser MVP. A signed native companion requires a separate product decision, threat model, code-signing review, endpoint-security compatibility testing, privilege analysis, penetration test, secure installer/update design, and enterprise approval.

## Current risks and decisions needed later

- Decide whether Azure Speech fallback is required after OpenAI Realtime latency, data-region, resilience, and procurement review.
- Select ServiceNow Knowledge or SharePoint as the first production knowledge connector based on pilot access.
- Confirm AutomationEdge API/MCP authentication and callback contracts with the target environment.
- Confirm whether customer-hosted deployments require a separate artifact and update channel.
- Define restricted-domain defaults with enterprise security and legal teams before pilot.
