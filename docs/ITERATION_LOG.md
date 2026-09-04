# Implementation log

This log records what changed in each coding iteration, how it was verified, and what remains. It supplements the roadmap; it does not turn incomplete work into completed work.

## 2026-07-15 - Foundation and guided-support vertical slice

### Delivered

- Added the repository roadmap, requirements traceability, architecture, threat model, API contract, extension permission design, runbook, and contributor documentation rule.
- Added an npm-workspace TypeScript foundation with shared runtime schemas and deterministic policy checks.
- Added a Fastify API for session creation, scoped consent, pause/resume, revocation, sanitized observation, grounded mock knowledge search, server-sent audit events, and session end.
- Added tenant-scoped access checks and an append-only SHA-256 hash chain for audit events.
- Added a Manifest V3 Chrome/Edge side panel, service worker, runtime content-script injection, current-tab sharing, emergency stop, DOM sanitation, and visual-only highlighting.
- Added a controlled Salesforce SAML fixture that deliberately contains username, password, and hidden-token values to exercise sensitive-field exclusion.
- Pinned production dependencies and removed a vulnerable transitive build wrapper in favor of direct patched esbuild usage.

### Verification

- Prettier formatting check: passed.
- ESLint: passed.
- TypeScript checks across all workspaces: passed.
- Vitest: 13 tests passed across policy, API, tenant isolation, consent, audit integrity, and DOM sanitation.
- API and extension production builds: passed on Windows.
- Built API health and session-creation smoke test: passed.
- npm audit: zero known vulnerabilities after removing the affected build wrapper.

### Still open

- Interactive Chrome/Edge acceptance was not run because the in-app browser was unavailable in the build session. The exact procedure is in `docs/RUNBOOK.md`.
- A distinct realtime reconnection/connection-lost UI remains part of the voice and visual provider milestone.
- General-purpose browser control remains disabled. Only the tested allow-once click, focus, and scroll proposal types are enabled.

## 2026-07-15 - Governed allow-once browser control

### Delivered

- Added strict versioned command and result schemas that reject unknown fields and unsupported command types.
- Added a side-effect-free policy gateway for state, controller, consent, origin, risk, expiry, revision, and replay checks.
- Added separate AI-control consent, an exact-action approval card, and last-moment backend authorization.
- Added a packaged deterministic executor that rechecks the current page fingerprint and safe observed target immediately before click, focus, or scroll.
- Added before/after observation and expected-text verification for the Salesforce fixture.
- Added command proposal, approval, authorization, result, and verification audit events.

### Verification

- Seven test files and 25 tests passed across schemas, policy, API, DOM sanitation, deterministic execution, tenant isolation, consent revocation, replay prevention, and audit integrity.

## 2026-07-15 - Credential-free enterprise MVP completion

### Delivered

- Added backend voice-provider boundaries, separate microphone consent, short-lived local credentials, sanitized context, mute/interruption UI, and explicit text-caption fallback.
- Replaced the single mock article with a governed local knowledge service that filters tenant, role, approval, and expiry before ranking and content return.
- Added knowledge-administrator connector operations and a structured Salesforce troubleshooting procedure.
- Added an explicit, idempotent mock AutomationEdge diagnostic and a sanitized mock ServiceNow ticket adapter.
- Added separate human-view consent, tenant/role-scoped handoff queue, atomic engineer assignment, and a standalone support console.
- Added audit coverage for voice sessions, workflows, tickets, handoff requests, and human connection.
- Added provider activation, acceptance, architecture, API, runbook, and roadmap documentation in plain English.

### Verification

- Prettier formatting check: passed.
- ESLint: passed.
- TypeScript checks across all seven workspaces: passed.
- Vitest: 8 test files and 29 tests passed.
- API, extension, and support-console production builds: passed.
- npm audit at low severity: zero known vulnerabilities.
- Built API health and session-creation smoke test: passed.
- Packaged support-console HTTP smoke test: passed.

### Still open

- Manual Chrome/Edge acceptance remains a release gate because the build environment has no interactive browser surface.
- Production Entra ID, realtime media, visual/OCR, enterprise connectors, AutomationEdge, ServiceNow, durable storage, and live human media/control require tenant configuration and production adapters.

## 2026-07-15 - Local active-tab recovery

### Delivered

- Added the fixed loopback Salesforce fixture origins to the development manifest without adding broad tab or all-site access.
  +- Made policy assertions use the fixture's explicit evaluation time so expiry checks do not change with the wall clock.
- Replaced the generic active-tab error with an instruction to activate the affected page and click the RemoteAssist toolbar icon again.
  +- Replaced contradictory Chrome sharing hints with a current-tab-compatible picker that excludes entire-monitor and system-audio capture.
- Documented why Chrome can hide tab metadata from a side panel opened on another tab.

### Verification

- A manifest regression test verifies both loopback fixture forms are present and broad `tabs` or `<all_urls>` permissions remain absent.
  +- A media-options regression test verifies current-tab preference is compatible with self-tab inclusion and monitor/audio exclusions.
- Prettier, ESLint, and all workspace TypeScript checks passed.
- Vitest: 10 test files and 31 tests passed.
- API, extension, and support-console production builds passed.

## 2026-07-15 - Capability-barrier regression hardening

### Delivered

- Allowed the documented `http://127.0.0.1:4330` support-console origin through the loopback-only development CORS policy.
- Made Pause immediately stop the extension-owned microphone track, close the voice-provider session, and require explicit microphone re-enable after Resume.
- Added a shared domain guard that blocks voice, command, workflow, ticket, and human-handoff side effects while a session is paused or terminal.
- Limited workflows to active troubleshooting sessions and removed paused or terminal handoffs from the support queue.
- Made pause, consent revocation, and session end close the current voice-provider session.
- Rejected command results that claim verification passed when execution failed, was blocked, or did not dispatch an action.
- Updated the API, threat model, runbook, roadmap, README, and architecture decision record in plain English.

### Verification

- A rendered React regression proves the microphone media track is stopped and its enable control is disabled on Pause.
- API regressions prove the documented support-console preflight succeeds, paused voice and handoff calls fail, ended workflows fail, and provider cleanup runs.
- Schema and API regressions prove contradictory command results are rejected before session resolution.
- Focused regression run: 5 test files and 21 tests passed.
- Repository-wide validation: formatting, lint, TypeScript checks, 11 test files with 36 passing tests, and all production builds passed.

### Still open

- Interactive Chrome/Edge acceptance remains the next release gate because no controllable browser target was attached during this iteration.

## 2026-07-16 - OpenAI Realtime WebRTC voice

### Delivered

- Removed the runtime mock voice provider and made OpenAI Realtime the configured voice path.
- Added backend-created OpenAI WebRTC calls using a server-only API key, fixed safety instructions, bounded sanitized context, a privacy-preserving safety identifier, a fixed provider origin, and a 15-second timeout.
- Added browser WebRTC microphone input, remote audio playback, completed input/output transcripts, server voice activity detection, mute, interruption, connection-failure cleanup, and provider disconnect handling.
- Added provider call-ID retention and hangup requests on pause, consent revocation, session end, failed browser negotiation, and connection failure.
- Made the API development/start scripts load the repository-root `.env` and documented the OpenAI model, voice, and transcription settings.
- Made Prettier preserve the checked-out line-ending style so the documented check remains stable on Windows worktrees.
- Updated the README, runbook, provider configuration, API contract, architecture, extension permissions, requirements, threat model, acceptance status, roadmap, and ADRs to state when audio leaves the device and what production work remains.

### Verification

- Prettier formatting check: passed.
- ESLint: passed.
- TypeScript checks across all seven workspaces: passed.
- Vitest: 12 test files with 38 passing tests.
- API, extension, and support-console production builds: passed.
- API startup through the repository-root `.env` command and the `/health` smoke test: passed with a non-secret test key; no OpenAI request was made.
- OpenAI provider contract tests use injected HTTP responses, make no billable provider call, and verify that the server API key is not returned in the WebRTC response.

### Still open

- A real OpenAI API key was not supplied to the automated environment, so live WebRTC audio, transcript quality, latency, interruption, and provider hangup must be qualified manually in Chrome or Edge.
- Reconnect, device selection, push-to-talk, provider fallback, secrets-manager storage, regional/retention approval, quotas, cost controls, and redacted provider telemetry remain production gates.

## 2026-07-16 - Empty-by-default runtime knowledge

### Delivered

- Removed the canned Salesforce article, procedure, connector records, `KB-DEMO-001` citations, and default issue text from runtime.
- Moved synthetic governed-knowledge records into explicitly injected test fixtures and added a regression proving the default service starts empty and fails closed.
- Added a distinct no-approved-source side-panel state and withheld knowledge-derived diagnostics, workflows, and ticket controls when retrieval returns no governed result.
- Replaced the fixed retry-card selection with a narrow OpenAI Realtime `propose_browser_action` function tool over locally filtered current controls.
- Added client and server validation plus a `MODEL_ACTION_PROPOSED` audit event before a model proposal becomes a review card; higher-risk, malformed, stale, disabled, or unobserved targets fail closed, and execution still requires allow-once consent and deterministic policy.
- Added consent-scoped, change-driven DOM observation. Changed sanitized fingerprints are recorded, stale proposal cards are cleared, and an active Realtime conversation receives bounded refreshed context and eligible controls without receiving display pixels.
- Bound the session to the exact affected tab before opening the sharing chooser, preventing chooser, settings, or ordinary focus changes from producing an unavailable-tab error or redirecting observation.
- Replaced reliance on an inconsistent side-panel `activeTab` grant with explicit **Use this page** and exact-site approval stages. External HTTP and HTTPS hosts remain optional, the chosen origin is shown before consent, and temporary tab metadata access is removed after selection.
- Replaced page-context Web Crypto fingerprinting with packaged SHA-256 so approved remote HTTP applications work without insecure Chrome flags; published empty, ASCII, and Unicode vectors cover the implementation.
- Replaced the small hardcoded application detector with safe metadata, title, heading, and hostname derivation. Unknown login applications now expose a verifiable page identity to the panel and Realtime while field values remain excluded.
- Expanded Realtime proposals from neutral click only to locally allowed click, focus, and scroll action/control pairs. Duplicate accessible names, disallowed pairs, malformed actions, and higher-risk clicks fail closed in both client and server checks.
- Added a guided post-action loop: RemoteAssist immediately adopts the refreshed sanitized observation, clears the stale card, sends a bounded deterministic result to Realtime, and requests one next-step review. Any follow-up requires a new allow-once decision.
- Removed synthetic knowledge references from locally created tickets and handoff records.
- Requested browser microphone permission before recording server consent, preventing denied microphone attempts from creating repeated consent and disconnect API traffic.
- Added a packaged full-tab microphone permission page because Chrome suppresses media prompts in extension side panels; the permission probe stops immediately and sends no audio to OpenAI.
- Guarded service-worker listener registration so a background bundle loaded in the wrong context reports the correct `dist` loading instruction rather than throwing on `chrome.runtime.onInstalled`.
- Updated the README, provider configuration, API contract, architecture, acceptance guide, runbook, roadmap, and architecture decision record.

### Verification

- Prettier formatting check: passed.
- ESLint: passed.
- TypeScript checks across all seven workspaces: passed.
- Vitest: 18 test files with 61 passing tests.
- API, extension, and support-console production builds: passed.

### Still open

- Runtime enterprise guidance requires an authenticated ServiceNow Knowledge or SharePoint connector and durable index.
- Live Chrome or Edge qualification is still required for both the empty-knowledge UI and OpenAI Realtime microphone flow.

## 2026-07-17 - Silent action review and Vertex role fix

### Delivered

- Matched the optional Node Vertex/Gemini guidance provider to the working Python shape by sending Gemini contents with an explicit `user` role.
- Updated the local `.env`, sample env, and backend fallback to use `gemini-3.5-flash` for Vertex/Gemini guidance.
- Cached service-account Google access tokens so repeated Vertex guidance calls do not exchange a JWT with `oauth2.googleapis.com` on every voice or knowledge turn.
- Restored empty-by-default runtime knowledge so local sessions do not receive canned retry guidance unless tests explicitly inject fixtures.
- Added backend voice timing logs, filler-turn handling, bounded in-memory audio chunks, and a clear oversized-audio error for backend voice providers.
- Added live turn mode for ElevenLabs/Google backend voice: short VAD turns, Vertex/Gemini informational replies when no approved KB matches, TTS playback without microphone feedback, and automatic resume.
- Updated ElevenLabs live voice defaults to current STT/TTS models, mirrored the working ConversationFlo low-latency Flash TTS model and streaming endpoint, disabled STT audio-event tags for live turns, treated noise-only transcripts such as `[indistinct chatter]` as unclear audio, and surfaced missing/playback-failed TTS audio in the side panel instead of silently returning to ready state.
- Added Vertex/Gemini-backed action suggestions for backend voice and chat sessions. Initial observations, chat messages, voice transcript confirmations, and changed sanitized page fingerprints can now produce one policy-validated review card without requiring OpenAI Realtime.
- Connected backend voice playback to action review: recent chat/voice history is sent to the action proposer, and if a voice turn creates an action card, the ElevenLabs reply names that exact action and says allow-once review is required.
- Tightened action prompts and voice composition so safe UI actions are prioritized over repeated generic contact-admin advice. When an action card exists, the spoken reply now leads with the allow-once approval step for that exact control.
- Made the side panel label the active voice provider instead of always showing OpenAI Realtime.
- Added a regression test for the Gemini request body so the `Please use a valid role: user, model.` error does not return unnoticed.
- Stopped OpenAI Realtime from speaking simply because it created an action proposal card.
- Changed post-action Realtime review to text-only, silent context that may create one fresh proposal card but should not narrate internal execution status.
- Clarified `.env.example` provider options and updated the README, provider configuration, runbook, architecture, roadmap, and ADR documentation.

### Verification

- `npm.cmd run check` passed: formatting check, ESLint, TypeScript checks across all workspaces, 19 test files with 62 passing tests, and production builds.

### Still open

- Live Chrome or Edge qualification is still required to verify the user-approved action click/focus/scroll path against a real target page and an approved OpenAI project.
