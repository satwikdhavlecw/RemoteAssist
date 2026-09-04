# ADR 0011: Vertex-backed action suggestions for backend voice and chat

Date: 2026-07-17

Status: accepted

## Context

The first AI action proposal path depended on OpenAI Realtime function calls. That worked only when the browser side panel had an active OpenAI data channel. When the configured voice path moved to ElevenLabs STT, Vertex/Gemini guidance, and ElevenLabs TTS, users could hear guidance but no action card appeared because backend voice turns had no equivalent proposal route.

The screen-sharing adapter already records changed sanitized DOM observations and safe control metadata, but page changes refreshed only the stored observation. The backend voice/chat path also needs to use those refreshed details when deciding whether a UI action is useful.

## Decision

RemoteAssist adds a backend `/action-suggestions` route for non-Realtime action review. The route sends Vertex/Gemini only recent chat/voice history, the user issue, a bounded sanitized page summary, and eligible current control names, roles, and locally allowed actions. The model can return at most one suggested action.

The API rejects the suggestion unless it exactly matches one current unambiguous observed control and one locally allowed low-risk action. Accepted suggestions are audited as `MODEL_ACTION_PROPOSED` and returned to the existing review-card UI. Execution still requires separate browser-control consent, allow-once approval, server authorization, packaged deterministic execution, and result verification.

The side panel calls the route after initial observation, chat messages, voice transcript confirmation, and changed sanitized page fingerprints. Page changes now also refresh guidance from the latest observation before action review. For backend voice turns, the voice card waits for action review before playback; if a proposal is accepted, the spoken reply includes the exact proposed action and a reminder that the allow-once card must be reviewed before execution.

## Consequences

- ElevenLabs + Vertex sessions can propose safe action cards without OpenAI Realtime.
- Spoken backend voice guidance is connected to the same action proposal shown in the card instead of narrating unrelated advice.
- Changed shared-page details are used by guidance and action review, not only stored.
- Model output still cannot approve or execute a browser command.
- Higher-risk controls such as sign-in, submit, save, approve, password, OTP, payment, or account-change actions remain blocked by policy even if the model suggests them.
