# MVP acceptance

Last updated: 2026-07-16

## What “MVP complete” means in this repository

The repository is a locally runnable acceptance build for the product boundaries. Voice uses OpenAI Realtime and therefore requires a configured OpenAI API project. Enterprise identity, AutomationEdge, ServiceNow, and human-queue dependencies still have narrow deterministic local implementations. Runtime knowledge intentionally starts empty until an approved connector is configured.

This is not a production deployment. OpenAI voice still requires live browser qualification, data-region and retention approval, secrets management, resilience, and cost controls. Production identity, knowledge connectors, AutomationEdge, ServiceNow, durable storage, and live human screen transport still require tenant-approved credentials, contracts, infrastructure, and security review.

## End-to-end journey available now

1. An employee starts a browser-extension support session using local mock identity.
2. The employee separately chooses whether to enable OpenAI Realtime voice and microphone access, AI tab viewing, AI browser control, or human tab viewing.
3. The employee selects the Salesforce fixture tab in the browser-controlled sharing prompt.
4. The extension creates a structured DOM observation while excluding passwords, hidden values, one-time-code fields, tokens, payment fields, and browser storage. While sharing remains active, changed DOM state is debounced, re-sanitized, audited, and forwarded to Realtime; display pixels are not sent.
5. The API searches only current, approved knowledge permitted for the employee’s tenant and role.
6. With no configured connector, the extension reports no approved source and disables knowledge-derived and backend operations. OpenAI Realtime may separately propose an eligible click, focus, or scroll action over one unambiguous current control; the card appears only after validation and still needs exact allow-once approval and full command-policy checks.
7. After an approved packaged action, the extension records the new sanitized page state and asks Realtime to review the result. Any next action appears as a new proposal and needs a new allow-once decision.
8. The employee may separately enable OpenAI Realtime voice; browser microphone permission must succeed before server consent is recorded.
9. Session, consent, observation, retrieval, and voice lifecycle events are recorded in a verifiable hash chain.
10. Pause, revoke, end, browser sharing stop, and emergency stop remove access immediately within the tested process boundary.

Injected automated fixtures separately verify the governed browser-command, workflow, ticket, and human-handoff contracts. Those fixtures are not presented as runtime enterprise knowledge.

## Automated evidence

The repository’s `npm run check` command verifies formatting, linting, TypeScript, unit and integration tests, and production builds. The tests include:

- session state and cross-tenant access;
- origin-scoped observation consent and immediate revocation;
- sensitive DOM sanitation;
- hostile or stale browser-command rejection;
- exact allow-once command approval and replay prevention;
- role and lifecycle filtering before knowledge retrieval;
- OpenAI Realtime SDP call creation, server-only key handling, fixed safety instructions, proposal-only function calls, call identifier validation, and provider hangup without a live billable request;
- workflow approval and idempotency;
- sanitized ticket creation;
- separate human-view consent, support-role queue access, and atomic join;
- audit-chain integrity.

The exact current test count belongs in `docs/ITERATION_LOG.md` after the final validation run.

## Manual browser acceptance still required

An interactive Chrome or Edge surface was not available in the build environment. A developer must therefore complete the browser procedure in `docs/RUNBOOK.md` before presenting this build as browser-qualified.

## Deliberate production gaps

- OpenAI Realtime microphone, response audio, and transcription are implemented, but live Chrome/Edge acceptance, reconnect, device selection, push-to-talk, fallback, regional approval, secrets-manager storage, quotas, and provider observability remain open.
- The visual adapter uses changed, sanitized live DOM structure. Production screenshot sampling, pixel-motion analysis, OCR fallback, and vision-model validation are not active.
- The runtime has no knowledge connector. Injected test fixtures prove ACL and lifecycle behavior but do not authenticate to ServiceNow or SharePoint or persist an index.
- The AutomationEdge and ServiceNow adapters return deterministic local results. No customer endpoint is called.
- The support console transfers sanitized context and ownership. It does not yet receive a WebRTC screen/audio stream, annotations, or browser-control capability.
- Local state is in memory and disappears when the API restarts.
- `AUTH_MODE=production` fails closed until Entra ID verification is configured.

These gaps are production-readiness work, not hidden mock behavior. The UI and provider configuration document identify them explicitly.
