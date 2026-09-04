# Architecture

## Summary

RemoteAssist is a browser extension connected to a governed backend. The extension owns user-visible consent, browser observation, overlays, and deterministic browser commands. The backend owns identity, session state, orchestration, knowledge retrieval, risk policy, provider adapters, audit, backend automation, ticketing, and human handoff.

Neither an AI model nor a human console receives a raw unrestricted command channel.

## System shape

```text
Employee
  |
  v
Chrome/Edge extension
  - side panel and emergency stop
  - explicit media/control consent
  - sanitized DOM observer
  - packaged overlay and command executor
  |
  | HTTPS and server events
  v
Session API and orchestrator
  - identity, tenant, state and presence
  - one-step troubleshooting planner
  - command proposal and policy decision
  - verification and escalation
  |
  +--> Voice and visual provider adapters
  +--> ACL-aware knowledge retrieval
  +--> AutomationEdge workflow adapter
  +--> ServiceNow/SupportFlo adapter
  +--> Append-only audit service
  +--> Governed human support console

Browser microphone -- WebRTC --> OpenAI Realtime
        SDP offer -- API --> OpenAI Realtime call creation
```

## Repository architecture

The project uses npm workspaces and TypeScript across the browser surfaces and backend. Shared schemas and policy functions are ordinary packages, which prevents backend and extension interpretations from drifting.

- `apps/browser-extension` contains the Manifest V3 side panel, service worker, content script, media lifecycle, overlays, sanitizer, and executor.
- `apps/support-console` contains the role-scoped human escalation queue and sanitized context handoff.
- `services/api` starts as a modular service for fast vertical-slice delivery. Its modules have explicit boundaries so high-scale realtime, visual, knowledge, and audit workloads can be separated later without changing external contracts.
- `packages/shared-types` owns versioned data shapes and session states.
- `packages/command-schema` accepts or rejects proposed commands. It performs no browser work.
- `packages/policy-model` makes deterministic policy decisions from explicit inputs. It performs no model calls and no side effects.

## Required orchestration sequence

Every troubleshooting turn follows this order:

```text
input -> observe -> classify -> retrieve permitted knowledge -> update hypothesis
      -> choose one next step -> classify risk -> explain -> approve if required
      -> validate policy -> execute deterministically -> observe -> verify
      -> continue, resolve, or escalate
```

Specialist modules return structured results to one stateful orchestrator. They do not form an unrestricted agent swarm and they do not call each other's tools autonomously.

## Trust boundaries

1. Browser page: always hostile. Text, attributes, iframes, and visual content are data only.
2. Extension: trusted packaged code, but inputs from the page, backend, storage, and runtime messages are validated.
3. Network edge: authenticates the user and tenant, limits rate, and binds requests to an active session.
4. Model/provider boundary: receives the least data necessary after redaction; output is untrusted until schema validation.
5. Connector boundary: source credentials stay in a backend secrets manager; source ACLs are preserved.
6. Human console: authenticated and role-checked, with user consent and the same policy gateway as AI proposals.

## Session state and consistency

The API is the authority for session state and consent. The extension keeps only minimal, expiring local state for the active session. A monotonically increasing session revision is included in commands and events. Pause, revoke, end, and restricted-origin events invalidate outstanding command capability before any later executor step.

The local development milestone uses an in-memory store. Production readiness replaces it with PostgreSQL for durable records and Redis for expiring presence, event fan-out, locks, and idempotency while preserving module interfaces.

## Media

Media starts only after a direct user gesture. The user may select the complete Chrome window through the browser chooser; entire-monitor sharing and system audio remain disabled. The RemoteAssist surface may be included when Chrome exposes it for the selected window. The display track is used for browser-visible sharing state and immediate revocation, not as model input. Sanitized observation and commands remain bound to the separately selected HTTP/HTTPS tab.

The service worker resolves the affected HTTP/HTTPS tab before the display chooser opens, and the side panel retains that tab ID for the session. Later injection, observation, overlay, deterministic-command, and stop messages address that exact tab rather than whichever tab happens to be active. The service worker repeats origin validation whenever it resolves the pinned ID, even when the display track represents the complete browser window. A navigation click may target an observed button, link, tab, or menu item only when the user explicitly names it and approves the proposal; the sanitizer also traverses open shadow roots and known application header labels, while arbitrary selectors and model-only navigation remain unavailable.

After separate microphone consent, the extension creates a WebRTC peer connection and sends its SDP offer to the RemoteAssist API. The API adds a bounded session configuration, a filtered list of current control names and roles, and one proposal-only function tool; it authenticates to OpenAI Realtime with the server-only API key, retains the returned provider call identifier for hangup, and returns the SDP answer. The extension attaches only its microphone track, plays the remote audio track, and uses the data channel for transcripts, function-call proposals, cancellation, and interruption events. The API key never crosses into the extension.

Pause, revoke, end, emergency stop, and side-panel unmount close the local peer and microphone tracks. The API also requests provider hangup. RemoteAssist creates no local audio recording. Reconnect, device selection, tenant-region routing, secrets-manager integration, and production provider observability remain open. Visual analysis uses sanitized DOM structure: a mutation observer debounces page changes, re-sanitizes them, and publishes only changed fingerprints. The active Realtime session receives bounded changed context and an updated eligible-control tool schema. Screenshot sampling, pixel-motion analysis, and OCR are not active.

The sanitizer computes fingerprints with packaged deterministic SHA-256 code. It does not depend on `crypto.subtle`, which is unavailable to content running beside some approved plain-HTTP applications. The fingerprint input remains bounded to 200,000 normalized characters.

Application recognition is metadata-driven. The sanitizer considers the standard application-name and Open Graph site-name metadata, document title, primary accessible heading, and finally the hostname. It rejects sensitive or secret-like candidates, removes generic login suffixes, and sends both the derived application and bounded page title to the active Realtime conversation. This identifies previously unknown applications without adding product-specific code.

## Knowledge flow

Connectors synchronize document identity, content, metadata, versions, approval state, and source ACLs. Retrieval resolves the user and tenant first, filters candidate identifiers by authorization, fetches only permitted chunks, performs hybrid retrieval and reranking, and returns citations with confidence and conflict signals.

Local runtime starts with an empty knowledge store. Test suites inject synthetic documents directly into the governed service to prove authorization and lifecycle behavior. The side panel fails closed for knowledge-derived and backend operations when retrieval has no approved source. OpenAI or the backend LLM may select an eligible click, focus, or scroll action over one unambiguous current control through a function call or action-suggestion request. Deterministic proposals handle explicit requests to open the first visible ServiceNow incident, an exact incident number, or a clearly named navigation control such as `History`, `Home`, `Dashboard`, `Settings`, `Preferences`, `Help`, `Documentation`, `Workspace`, or `Incidents`. Arbitrary links are not eligible for click actions. The client validates the action/control pair, then the server validates and audits the proposal against the authoritative latest observation before the card appears. The server repeats risk and observation checks when creating the command, and the user must grant allow-once consent. The model never receives an executor or approval capability.

After deterministic execution, the extension records the new observation before reporting the command result. It updates the visible page identity, keeps the proposal card mounted long enough to show the success or safe-block result, sends a bounded execution summary to the active Realtime conversation, and requests one text-only next-step review. Proposal creation and execution-status updates are silent system context, not spoken guidance. This loop is sequential: every proposed follow-up receives a new card, consent check, command, expiry, fingerprint, audit record, and allow-once decision.

The model never receives forbidden content and is not asked to hide content after generation.

## Audit integrity

Audit events are append-only and include tenant, session, actor, event type, redacted payload, timestamp, prior-event hash, and integrity hash. Production storage uses restricted append permissions and retention controls. Logs and traces reference audit event IDs but never contain raw secrets or sensitive captures.

## Deployment evolution

Local development runs the extension and one modular API with OpenAI Realtime voice, mock identity and operations adapters, and no runtime knowledge records. Pilot deployment introduces an authenticated knowledge connector, PostgreSQL, Redis, a secrets manager, object storage only for explicitly retained artifacts, OpenTelemetry, container images, and Kubernetes-compatible configuration. Services may be extracted only when load or isolation requires it; the public API and event contracts remain stable.

## Credential-free provider slice

The modular API composes OpenAI Realtime voice with deterministic in-memory adapters for governed knowledge, registered workflows, tickets, and human handoff. Production identity and other connector/provider implementations cannot bypass RemoteAssist consent, authorization, sanitation, idempotency, policy, verification, or audit checks. See `docs/decisions/0002-credential-free-provider-boundaries.md` and `docs/decisions/0004-openai-realtime-webrtc.md`.
