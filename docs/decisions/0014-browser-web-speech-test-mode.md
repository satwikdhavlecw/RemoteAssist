# ADR 0014: Use browser Web Speech for local voice testing

Date: 2026-08-26

Status: accepted

## Context

The local ElevenLabs voice path requires an STT key and a TTS voice configuration. The current development goal is to verify that a spoken question can reach the RemoteAssist LLM and that the reply can be spoken back before purchasing or configuring a speech-provider account.

## Decision

Add `VOICE_PROVIDER=browser_speech` as a development voice mode. Chrome or Edge uses `SpeechRecognition` for one short microphone utterance, sends the recognized text and existing sanitized support context to `/voice-query`, and uses `speechSynthesis` to speak the returned assistant text. Microphone consent, pause, mute, interrupt, session lifecycle, action review, and the existing server-side LLM path remain in force.

## Consequences

- Local voice testing no longer requires ElevenLabs credentials.
- Browser recognition and speech availability, language quality, and audio processing are controlled by Chrome/Edge and may involve a browser speech service; this mode is not an enterprise-approved speech transport.
- RemoteAssist does not upload a recorded audio chunk in browser speech mode, but it does send the recognized transcript to the API.
- ElevenLabs, Google Voice, and OpenAI Realtime remain available as provider-backed alternatives.
