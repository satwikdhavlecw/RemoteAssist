# Provider configuration and current modes

Last updated: 2026-08-27

## Safe default

Current context bounds are deliberately larger but fixed: observation transport accepts up to 300 visible non-sensitive text entries of 1,500 characters each, and the LLM receives a bounded page summary plus up to 50 eligible controls. Chat action review keeps up to 20 recent turns with a 4,000-character limit per turn.

For no-source dashboard questions, the LLM is asked for complete plain-text sentences rather than forced JSON. Valid JSON remains accepted for compatibility, and the complete parsed provider response is shown in chat without a second application-side character slice. The provider output budget remains finite to prevent runaway responses; provider responses marked truncated or containing damaged wrappers are discarded and replaced with the safe page fallback.

The repository starts with loopback-only development services, mock identity, and an empty knowledge store. Do not expose this mode to a shared or untrusted network. Header-based local identity is a developer convenience, not authentication.

The local development voice path can use browser speech mode with `VOICE_PROVIDER=browser_speech` and `LLM_PROVIDER=vertex`, which requires no STT or TTS provider key. ElevenLabs backend live turn mode and OpenAI Realtime remain available as alternatives. The API still fails closed in production authentication mode until token verification and tenant configuration are implemented.

## Identity

Current local mode accepts the documented `x-remoteassist-*` headers. The extension uses an employee identity; the support console uses a support-agent identity. Tenant and role checks still run, which makes authorization behavior testable without an identity tenant.

Production activation requires Entra ID authorization code with PKCE, issuer and audience validation, tenant allowlisting, role mapping, managed-device policy, refresh/revocation behavior, and security review.

## Voice

The API loads these settings from the repository-root `.env`:

```env
VOICE_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
LLM_PROVIDER=vertex
VERTEX_AI_KEY_PATH=
VERTEX_AI_PROJECT_ID=
VERTEX_AI_LOCATION=global
VERTEX_AI_MODEL=gemini-3.5-flash
```

For browser-only speech testing, use `VOICE_PROVIDER=browser_speech` and omit the ElevenLabs settings. Chrome or Edge uses the Web Speech API to recognize the question and speak the returned guidance. Recognition availability and audio processing are controlled by the browser and may depend on browser speech-service support; RemoteAssist sends the recognized text, not a recorded audio file, to `/voice-query`.

Provider keys stay on the API server. The extension never receives them. In ElevenLabs + Vertex mode, the browser sends only a bounded audio chunk to the API after microphone consent. The API transcribes it with ElevenLabs, asks Vertex/Gemini for a concise support reply, synthesizes that reply with ElevenLabs, and returns audio to the side panel.

For optional OpenAI Realtime mode, set `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, and `OPENAI_REALTIME_TRANSCRIPTION_MODEL`. The API sends the browser's WebRTC offer and a bounded session configuration to OpenAI's `/v1/realtime/calls` endpoint, then returns only the SDP answer.

Microphone access requires a browser user gesture and a separate RemoteAssist consent record. Chrome side panels cannot display the media permission prompt, so first use opens the packaged `microphone-permission.html` extension page in a full tab. That page requests the extension-origin permission, immediately stops the probe track, and sends no audio to OpenAI. After the employee returns and explicitly enables voice, the side panel acquires the microphone, records server consent, and starts WebRTC. Completed input and output transcripts are shown in the side panel. Server voice activity detection creates responses and supports user interruption; the **Interrupt voice** control sends response cancellation and audio-buffer clearing events.

The Realtime session receives the reported issue, derived application identity, page title, bounded sanitized visible context, plus at most 50 locally filtered controls with their allowed click, focus, or scroll actions, and exposes one `propose_browser_action` function. While tab sharing remains active, a changed sanitized page fingerprint updates the conversation context and replaces the tool's eligible controls. The model can choose one listed action/control pair and explain its purpose, but the function result is only `awaiting_user_approval`. RemoteAssist validates the function call in the extension and then validates and audits it against the API's latest observation before rendering a card; execution still requires server-side risk checks and explicit allow-once consent. Display pixels and field values are not provider input in this milestone.

Backend voice and chat providers do not have an OpenAI data channel, so RemoteAssist uses a separate `/action-suggestions` route. After initial observation, chat, voice transcript confirmation, or a changed sanitized page fingerprint, the API sends Vertex/Gemini the recent conversation history, the current issue, a bounded page summary, and only eligible control names/actions. The model may return at most one suggested action. The API accepts it only when it exactly matches one current unambiguous safe control and an allowed low-risk action, then audits `MODEL_ACTION_PROPOSED` and returns the same review-card shape as Realtime. When a backend voice turn creates that card, RemoteAssist synthesizes one connected spoken reply that prioritizes the exact proposed action and the allow-once review reminder over generic contact-admin guidance.

Creating a proposal card is silent. After the user approves a packaged action, RemoteAssist sends a bounded execution result back to the active Realtime session as text-only context. The model may call `propose_browser_action` once for a clear next low-risk step, but it is instructed not to speak, greet, summarize internal execution, or fill the side panel with extra commentary.

When `VOICE_PROVIDER=browser_speech`, the side panel uses browser `SpeechRecognition` for one short utterance, sends only the transcript to `/v1/support-sessions/{sessionId}/voice-query`, waits for Vertex/Gemini guidance and action review, and speaks the returned text with browser `speechSynthesis`. It pauses recognition while the reply is spoken, then resumes. When `VOICE_PROVIDER=elevenlabs` or `google_voice`, it instead sends a bounded audio chunk to the same route for STT, Vertex/Gemini guidance, action suggestion, and TTS. Greeting-only turns such as "hello hello" and unclear audio-event transcripts such as "[indistinct chatter]" are handled without running troubleshooting retrieval.

When no approved knowledge article matches a text or voice question, the API may use the configured LLM for a clearly labeled informational explanation based on the sanitized page observation. This fallback must not claim enterprise approval, invent company policy, request secrets, enable workflows, or authorize browser control. The no-source response still requires human review for enterprise remediation, and the side panel keeps knowledge-derived operations disabled.

Pause, consent revocation, session end, component unmount, and emergency stop close the browser peer connection or backend voice detector and microphone tracks. The backend retains the OpenAI call identifier when OpenAI mode is active and requests provider hangup on pause, revoke, or end. Backend live turn mode uses `MediaRecorder` only to create one in-memory, bounded audio chunk for the current utterance; RemoteAssist does not save a local audio file.

Still required before enterprise production use: tenant data-region and retention approval, secrets-manager storage and rotation, rate limits and quotas, redacted provider telemetry, reconnect and device-selection UX, provider outage fallback, live browser qualification, cost controls, and a privacy/security review. Browser Web Speech recognition is a local-test convenience and is not yet an enterprise-approved speech transport. The current implementation uses the public OpenAI API endpoint and does not provide Azure Speech fallback.

## Knowledge

The runtime governed knowledge service contains no documents, procedures, or connector records by default. A search therefore returns no results, requires human review, and cannot enable knowledge-derived or backend operations. The separate Realtime proposal tool may dynamically select an eligible click, focus, or scroll action, but cannot authorize it. Separate allow-once consent and all origin, fingerprint, target, ambiguity, sensitive-field, risk, expiry, replay, and result checks remain mandatory. Authorization, lifecycle, ranking, procedure, and connector behavior is covered with explicitly injected test-only records; those records are not loaded by the running API.

When a packaged action finishes, RemoteAssist sends one bounded execution-status item and requests one text-only Realtime review against the latest sanitized page. This is not autonomous execution: a follow-up tool call creates a fresh pending approval card and cannot reuse the previous consent or command.

The optional Vertex/Gemini LLM coordinator is enabled with `LLM_PROVIDER=vertex`. For Vertex AI, set `VERTEX_AI_KEY_PATH` and the project/location/model variables. For the Gemini Developer API, set `GEMINI_API_KEY`. The default guidance model is `gemini-3.5-flash`, which supports text output, structured output, and function calling for the guidance path. It is not a Live API model, so it does not replace realtime voice. Gemini request contents must include explicit roles; RemoteAssist sends `role: "user"` for the guidance prompt, matching the Vertex contract that accepts only `user` and `model`. When a service-account key is used, the API caches the Google access token until it is near expiry instead of exchanging a new JWT on every user turn. If the API log shows `Please use a valid role: user, model.`, restart the API after updating to a build that includes the explicit role fix. If the log shows a timeout to `oauth2.googleapis.com`, check local network/proxy access to Google OAuth; after one successful token exchange, later turns should reuse the cached token.

For the no-approved-article informational path, RemoteAssist asks Gemini for complete plain-text guidance. Grounded procedure guidance still uses structured JSON. Incomplete model fragments, damaged JSON wrappers, responses ending with a connector, and provider responses that stop at the output-token limit are rejected in favor of a complete page-derived fallback. The sanitizer permits up to 300 visible non-sensitive text entries of 1,500 characters each; the LLM summary is bounded before the request is sent. The parsed LLM response itself is not locally shortened before it reaches chat. Ticket-creation questions use a request-aware safe explanation so the assistant can describe the visible New/Create path without claiming that a ticket was submitted. If the side panel shows the deterministic informational fallback instead of a page-specific LLM explanation, inspect the API terminal for `[Gemini LLM Error]` or `[Gemini LLM Exception]`. The log reports only the provider status and a bounded error body; it never logs the API key. Common causes are an invalid or expired key, a model that is unavailable to the configured API, quota denial, or blocked access to `generativelanguage.googleapis.com`. Gemini responses are normalized whether the provider returns JSON, fenced JSON, or plain explanatory prose, and all text parts in the provider response are joined before parsing.

Production activation requires authenticated connector adapters, encrypted credentials, full and incremental synchronization, deletion/supersession handling, source ACL synchronization, a persistent index, source links, and evaluation against representative enterprise queries.

## AutomationEdge and ITSM

The local AutomationEdge adapter runs registered deterministic workflows only. It checks explicit approval, risk, and idempotency, then returns a verified demo result. The local ServiceNow adapter creates an in-memory incident with sanitized context.

Production activation requires the target API contract, secrets-manager integration, request/response schemas, timeout and cancellation, callback or polling behavior, retry rules, idempotency confirmation, redaction, approval mapping, deterministic verification, and sandbox testing supplied by the enterprise owner.

## Human support

The local support console polls a tenant-scoped queue using a support-agent role. A user must grant human viewing separately before a sanitized context bundle enters that queue. Join is atomic, so a second engineer cannot claim the same queued request.

Production activation requires real identity, durable queue state, presence and disconnect handling, approved media relay, consent indicators, live revoke, and the same governed command path if human browser control is later enabled. There is no unrestricted remote-control channel in this repository.

## Production activation checklist

Before any provider is enabled for employees:

1. Document the tenant owner, data region, retention policy, data-processing agreement, and incident contact.
2. Store credentials in an approved secrets manager and rotate a test credential.
3. Add provider health, timeout, rate-limit, and redacted telemetry behavior.
4. Add contract and failure tests using a non-production tenant.
5. Re-run threat-model, privacy, extension-permission, and rollback reviews.
6. Complete the manual browser acceptance and accessibility checks.
7. Update this document, the runbook, roadmap, and iteration log in the same change.
