# ADR 0004: OpenAI Realtime through backend-created WebRTC calls

Status: accepted on 2026-07-16

## Context

The credential-free voice adapter acquired a microphone track but deliberately did not transmit or transcribe it. The product now needs a real OpenAI Realtime conversation while preserving separate microphone consent, server-only credentials, immediate local revocation, deterministic browser control, and an auditable provider boundary.

OpenAI supports browser WebRTC through either an ephemeral client secret or a unified call-creation interface. An ephemeral secret would let the browser create the provider call directly, but the backend would not automatically retain the provider call identifier used for an explicit hangup request.

## Decision

Use OpenAI's unified WebRTC call-creation interface. After microphone consent, the extension creates a peer connection and sends its SDP offer plus sanitized support context to the RemoteAssist API. The API adds fixed safety instructions and audio configuration, authenticates to OpenAI with `OPENAI_API_KEY`, and sends the request to `/v1/realtime/calls`. It keeps the call identifier from the response location and returns only the SDP answer, model name, and transport type to the extension.

The extension attaches the microphone track, plays the remote audio track, displays completed input and output transcripts, and uses the WebRTC data channel for function-call proposals, post-action review, response cancellation, and audio-buffer clearing. The session exposes one narrow `propose_browser_action` function tool. It returns only a proposed current action type, control name, and purpose for a review card; it cannot approve, authorize, or execute browser or backend actions.

Chrome side panels do not have the browser user interface needed to present a microphone permission prompt. For an extension origin without an existing grant, RemoteAssist opens a packaged extension page in a normal tab. That page requests permission during an explicit click, immediately stops its probe track, and creates neither RemoteAssist consent nor an OpenAI call. The employee returns to the side panel and explicitly enables voice as a separate step.

Pause, revoke, end, emergency stop, unmount, and connection failure close the local peer and media tracks. Pause, revoke, and end also make the API request provider hangup. Raw audio is not recorded by RemoteAssist.

## Consequences

- The standard OpenAI API key stays on the backend and is never returned to extension code.
- Microphone audio and bounded sanitized context leave the local machine and are processed by OpenAI when the user enables the microphone; the UI and operating documentation must say so plainly.
- Voice now requires network access, an eligible OpenAI API project, cost controls, and an approved data-region and retention posture.
- The backend becomes part of WebRTC session initialization and provider availability affects voice startup.
- Up to 25 locally filtered observed control names and roles are included in the Realtime session so the model can make a contextual proposal. The client and server revalidate every proposal against their own current state.
- First-time Chrome users complete one extra full-tab permission step before side-panel voice can start; this preserves an explicit browser prompt without adding broad extension permissions.
- Provider call creation and hangup are contract-tested without making live OpenAI requests. Live Chrome/Edge qualification, reconnect, device selection, outage fallback, secrets-manager integration, and provider observability remain release work.
