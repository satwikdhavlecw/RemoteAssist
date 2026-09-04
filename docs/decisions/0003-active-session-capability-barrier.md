# ADR 0003: Paused and terminal sessions are capability barriers

Status: accepted on 2026-07-15

## Context

RemoteAssist previously checked session state separately in observation and command policy code. Other side-effect paths, including voice-provider credentials, workflows, tickets, and human handoff, could accidentally omit the same check. A paused browser UI could also retain a microphone track owned by a child component.

Security promises such as “Pause stops access” must apply to every capability, not only visual observation.

## Decision

The session domain owns one active-session assertion. Domain services call it before creating or exercising voice, browser-command, workflow, ticket, or human-handoff capabilities. A terminal session fails with `session_terminal`; a paused session fails with `session_paused`.

Pause, consent revocation, and session end close the current voice-provider session. The extension also stops its local microphone track immediately. Resume does not restart media or a provider session; the employee must explicitly enable the microphone again.

Workflow execution additionally requires the troubleshooting state. Human queue entries are visible and joinable only while their session remains active. Command-result validation permits successful verification only after an executed command actually dispatched its action.

The development API explicitly accepts both documented loopback host forms, `localhost` and `127.0.0.1`, while production authentication remains unavailable.

## Consequences

- Pause and end win consistently across local and provider-backed capabilities.
- New side-effect services must call the shared assertion rather than inventing their own state check.
- Resume is intentionally conservative: media access always requires a new visible user gesture.
- Idempotent workflow replays are rejected after a session pauses or ends.
- Support engineers cannot claim a handoff while the employee has paused or ended the session.
- Regression tests cover the domain, API, schema, CORS, and rendered microphone behavior.
