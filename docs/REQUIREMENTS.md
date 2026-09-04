# Requirements traceability

This document translates the two source PDFs into buildable work and points to the roadmap milestone that owns each requirement. It is a guide, not a replacement for the source specifications.

## Core user journey

| Requirement                                     | Planned evidence                              | Owner milestone |
| ----------------------------------------------- | --------------------------------------------- | --------------- |
| Employee starts voice or text support           | Side panel, WebRTC provider, and API tests    | 1 and 3         |
| Employee explicitly shares a tab or window      | Media UI and consent audit                    | 1               |
| Agent observes visible state without secrets    | DOM sanitizer, visual adapter, security tests | 1 and 3         |
| Agent retrieves approved enterprise knowledge   | Cited retrieval response and ACL tests        | 1 and 4         |
| Agent gives one grounded step at a time         | Orchestrator state tests                      | 1               |
| Employee approves a low-risk browser action     | Approval UI and policy decision               | 2               |
| Packaged deterministic code executes the action | Command executor integration tests            | 2               |
| Backend remediation runs through AutomationEdge | Workflow registry and adapter tests           | 5               |
| Ticket is created or updated                    | ITSM adapter contract tests                   | 5               |
| Authenticated human receives context            | Support console handoff tests                 | 6               |
| Employee can stop or revoke at any time         | Revocation race and emergency-stop tests      | 1, 2 and 6      |

## Security invariants

These statements must remain true in every milestone:

- Installation, previous sessions, employment terms, voice consent, and screen consent never imply browser-control consent.
- Passwords, one-time codes, payment details, secrets, cookies, tokens, hidden fields, and browser storage are never read or populated.
- Page content cannot grant permissions, change policy, select a model tool, expand an origin allowlist, or provide executable code.
- The extension never downloads executable logic and never evaluates code supplied by the backend or a model.
- Structured model output that could affect an action is schema-validated. OpenAI Realtime has one proposal-only function tool; it can request a review card for one unambiguous eligible click, focus, or scroll action but cannot approve, authorize, reuse approval, or directly invoke browser or AutomationEdge APIs.
- All commands are bound to one active session, controller, approved origin, page fingerprint, short expiry, and unique identifier.
- Restricted origins pause visual processing and disable control without storing their content.
- Raw screen video and audio are not retained by default. Microphone audio leaves the browser only after separate consent and explicit enablement.
- While selected-tab sharing is active, visual updates are derived from debounced, sanitized DOM changes and are forwarded only when the safe page fingerprint changes. Display pixels and motion video are not sent to the model in the MVP; image-only content requires a future separately consented screenshot/OCR adapter.
- Every consent, view, proposed action, policy decision, execution result, workflow, and human participant is auditable.
- Revocation, pause, emergency stop, or session end wins any race with a pending command.

## Session lifecycle

The supported lifecycle is:

```text
CREATED -> AUTHENTICATED -> VOICE_CONNECTED -> AWAITING_SCREEN_CONSENT
        -> OBSERVING -> TROUBLESHOOTING -> VERIFYING
        -> RESOLVED or ESCALATED -> COMPLETED
```

Temporary states include awaiting user action, awaiting approval, executing a browser action, executing a backend action, awaiting a human, and human connected. Terminal failure states include user cancelled, consent revoked, security blocked, connection failed, and escalated off platform.

## Knowledge invariants

- Retrieve knowledge before recommending or executing enterprise troubleshooting.
- Apply tenant, identity, role, department, region, support group, source ACL, classification, application entitlement, and managed-device filters before permitted text enters a model prompt.
- Prefer active advisories and approved application runbooks over general model knowledge.
- Exclude expired, unapproved, deleted, superseded, or access-revoked documents.
- Cite sources and distinguish reported facts, observed facts, enterprise guidance, inference, and proposed action.
- Escalate at low confidence and flag conflicting guidance.
- If no approved source is configured or matched, return no grounded enterprise action and disable backend operations; never substitute canned runtime content. OpenAI Realtime may separately propose an eligible click, focus, or scroll action, but only schema validation, unambiguous current-observation matching, deterministic risk policy, and a fresh allow-once decision can turn it into an executable command.
- Resolved sessions may create redacted draft knowledge candidates, but never publish executable knowledge automatically.

## Quality targets

The production-readiness milestone owns the PRD performance and availability targets, including a side panel opening under one second, ordinary voice connection under five seconds, command delivery and low-risk DOM execution under 500 milliseconds each, visual analysis under three seconds, usable human video at 2 Mbps, 99.9 percent monthly backend availability, and the initial concurrency targets.

Accessibility acceptance includes keyboard navigation, screen-reader labels, captions by default during voice use, non-color state communication, adjustable text size, and text alternatives for every spoken instruction.
