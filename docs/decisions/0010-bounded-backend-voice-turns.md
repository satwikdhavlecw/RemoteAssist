# ADR 0010: Bound backend voice turns and keep runtime knowledge empty

Date: 2026-07-17

Status: accepted

## Context

OpenAI Realtime uses a live WebRTC audio path. ElevenLabs and Google Voice do not use that OpenAI data channel in the local build; they use backend request/response turns for speech-to-text, guidance, and text-to-speech.

An earlier backend-voice implementation allowed microphone chunks to grow too large before sending them to `/voice-query`, which could exceed the API request-body limit. The runtime API also loaded default knowledge fixtures again, causing canned retry guidance to appear in local sessions and adding unnecessary LLM calls.

## Decision

Runtime knowledge starts empty unless a test explicitly injects fixtures. This preserves the product rule that local sessions must not show canned enterprise guidance as if it were approved tenant knowledge.

Backend voice providers use live turn mode with one bounded in-memory utterance at a time. The extension starts recording only after speech is detected, stops after short silence or a maximum turn length, rejects oversized chunks before sending, and clears chunks after each turn. It pauses listening while the synthesized reply plays, then resumes listening automatically. The API allows a larger bounded JSON body for voice chunks and returns a clear `request_body_too_large` error if the limit is still exceeded.

The ElevenLabs path uses `scribe_v2` for turn STT and the `/stream` TTS endpoint with `eleven_flash_v2_5` by default, matching the low-latency ConversationFlo provider settings. The retired `eleven_monolingual_v1` TTS model is not used because it can fail on current provider accounts. STT audio-event tags are disabled for live turns, and bracketed/noise-only transcripts such as `[indistinct chatter]` are treated as unclear audio instead of becoming the reported support problem.

The API logs separate timing events for transcription, guidance, Vertex informational replies, and synthesis. Greeting-only turns are handled directly and do not run troubleshooting retrieval.

## Consequences

- Backend voice turns feel closer to live support while still using the explicit STT -> Vertex/Gemini -> TTS chain.
- Backend voice turns are less likely to fail with oversized request bodies.
- Operators can see which backend step is slow from the API logs.
- Greeting, microphone-test speech, or noise-only transcripts no longer produce unrelated troubleshooting guidance.
- ElevenLabs and Google Voice remain turn-based provider paths, not live OpenAI Realtime sessions.
