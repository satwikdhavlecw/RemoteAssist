# Developer and operator runbook

## Current stage

The acceptance build is runnable with browser Web Speech + Vertex voice testing, live backend voice turns through ElevenLabs + Vertex, optional OpenAI Realtime voice, plus local identity, AutomationEdge, ServiceNow, and human-queue implementations. It observes and sanitizes a user-selected tab. Runtime knowledge starts empty, so knowledge-derived and backend operations remain disabled. OpenAI Realtime can separately propose one eligible click, focus, or scroll action through a structured function call; execution remains behind the allow-once browser-command path.

Live OpenAI browser qualification and the remaining production providers are still open release gates. The local support console has no live media or human-control channel.

## Local topology

- Browser extension built from `apps/browser-extension`.
- Modular local API from `services/api`.
- Mock identity and an empty-by-default governed knowledge service in the API.
- Consent-gated microphone audio. Browser speech uses the Web Speech API; OpenAI Realtime uses WebRTC; ElevenLabs and Google Voice use bounded backend voice turns through `/voice-query`.
- Injected knowledge fixtures in automated tests plus local AutomationEdge, ServiceNow, and handoff adapters.
- Role-scoped support console built from `apps/support-console`.
- Controlled Salesforce SAML test page under `tests/fixtures`.

Identity and the non-voice enterprise-system adapters remain local implementations. Voice requires real provider credentials because the local voice mock has been removed. The running API does not load canned knowledge.

## Prerequisites

- Node.js 22 or newer.
- npm 10 or newer.
- Chrome or Edge 120 or newer for Side Panel API support.
- Vertex AI service-account credentials, or a Gemini API key, for the text answer.
- Optional: an ElevenLabs API key for STT and TTS when `VOICE_PROVIDER=elevenlabs`.
- Optional: an OpenAI API project with access to the configured Realtime and transcription models if `VOICE_PROVIDER=openai_realtime`.

## Environment policy

Secrets belong in local `.env` files or an external secrets manager and are ignored by Git. Copy `.env.example` to `.env`, set the Vertex/Gemini credential, and use `VOICE_PROVIDER=browser_speech` for a no-speech-provider test. Leave provider keys out of extension code, browser storage, logs, and screenshots. Never commit tokens, connector credentials, media credentials, raw captures, production URLs containing secrets, or customer data.

## Install and validate

```powershell
npm ci
Copy-Item .env.example .env
npm run check
npm audit --audit-level=low
```

Edit `.env` before starting the API:

```env
VOICE_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_server_side_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
LLM_PROVIDER=vertex
VERTEX_AI_KEY_PATH=path_to_service_account_json
VERTEX_AI_PROJECT_ID=your_project_id
VERTEX_AI_LOCATION=global
VERTEX_AI_MODEL=gemini-3.5-flash
```

For browser speech testing, replace the provider line with `VOICE_PROVIDER=browser_speech`. No ElevenLabs key or speech audio upload is needed; Chrome or Edge performs recognition and playback through its Web Speech implementation.

The API development command loads this file. Empty required provider credentials stop startup with a configuration error. Do not add keys to the extension manifest, browser storage, source code, logs, or screenshots.

`npm run check` runs formatting verification, lint, TypeScript checks, automated tests, and production builds. Generated output is written to each workspace's `dist` folder and is not committed.

## Run locally

In terminal 1:

```powershell
npm run dev:api
```

In terminal 2:

```powershell
npm run fixture
```

In terminal 3, build and serve the support console:

```powershell
npm run build --workspace @remoteassist/support-console
npm run serve:support-console
```

Open `http://127.0.0.1:4330`. Leave it open to see a consented handoff appear. The local support identity is represented by fixed role headers and must never be treated as production authentication.

Build the extension whenever packaged code changes:

```powershell
npm run build --workspace @remoteassist/browser-extension
```

Load it in the browser:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select `apps/browser-extension/dist`.
5. Open `http://127.0.0.1:4320/salesforce-saml`.
6. Select the RemoteAssist toolbar action to open its side panel.
7. Select **Use this page**, approve temporary tab identification if Chrome asks, verify the displayed origin, then select **Allow this site and start support**. For an external HTTP or HTTPS application, approve the exact-site access prompt.

## Manual acceptance

1. Leave the fixture's password value in place; it exists to prove sanitation.
2. Enter or keep the Salesforce SAML issue and select **Start support**.
3. Confirm no page content is visible to RemoteAssist before selecting **Choose a tab**.
4. In the browser chooser, select only the Salesforce fixture tab.
5. Confirm the side panel reports **No approved knowledge source matched** and contains no `KB-DEMO-001` citation.
6. Enable voice or use chat and ask what action to take. Confirm the proposal card shows the AI-selected click, focus, or scroll action, exact current control, and purpose rather than fixed card copy. In OpenAI Realtime mode this can come from the `propose_browser_action` function; in ElevenLabs + Vertex mode it comes from the backend `/action-suggestions` route. Confirm the proposed control is highlighted. The voice should not speak simply because a proposal card appeared. Select the exact **Allow once** button and verify packaged execution starts only after separate consent. The UI must not claim an enterprise-verified outcome.
7. After execution, confirm the prior card disappears, the refreshed page identity is visible, and OpenAI reviews the result silently. If it proposes another action, confirm a new approval card appears and the previous approval cannot execute it.
8. Cause a visible DOM change in the shared fixture and confirm a new `OBSERVATION_RECORDED` audit event appears, the prior action card disappears, guidance refreshes from the new sanitized observation, and the AI can propose a fresh eligible action from the current controls. Confirm no page refresh is sent when the safe fingerprint stays unchanged. This does not test pixel motion or image-only content.
9. Enable the microphone if desired. Confirm a separate browser prompt appears, the UI identifies the configured voice provider, microphone speech is transcribed, provider audio plays, mute and interrupt work, and no local audio recording is created.
10. Confirm a denied browser microphone request creates no `/consents` or `/voice/disconnect` traffic. A successful request should create consent and then call `/realtime-call`.
11. Select **Pause observation** and confirm the microphone indicator turns off, the WebRTC connection closes, and provider hangup is requested. After Resume, confirm microphone access stays off until explicitly enabled again.
12. Select **Stop all access** and confirm sharing, DOM-change observation, overlays, and voice playback stop.
13. Request `/v1/support-sessions/{session_id}/audit-events` with the local employee headers and confirm `integrityValid` is `true`, `MODEL_ACTION_PROPOSED` exists for displayed model cards, and no sensitive fixture values appear.

The browser build environment used for the 2026-07-15 iteration could not provide an interactive browser surface. This manual procedure is therefore an explicit release gate, not a claimed automated result.

If the voice card says Chrome cannot show its microphone prompt in the side panel, select **Grant microphone in extension tab**. In the packaged RemoteAssist tab, select **Grant microphone permission** and choose **Allow** in Chrome's prompt. The probe track stops immediately. Return to the side panel and select **Enable microphone** again. Until permission succeeds and voice is explicitly enabled, the API correctly receives no microphone consent or Realtime call request.

Chrome retains extension errors until they are cleared. If an old `background.js` `onInstalled` error remains while observation works, open `chrome://extensions`, remove any RemoteAssist entry loaded from a path other than `apps/browser-extension/dist`, select **Clear all** in the error view, rebuild, and reload the `dist` entry. The background bundle now reports an actionable wrong-context message instead of throwing if it is evaluated outside the extension service worker.

After reloading an unpacked extension, an already-open application tab can still contain the previous content script. The current build catches the invalidated-context message and stops that observer cleanly. Refresh the affected application tab once, then start a new support session so the rebuilt content script is injected.

## Extension tab-access troubleshooting

If the side panel asks you to activate the affected page, make the normal HTTP/HTTPS application tab active and select **Use this page**. Do not select a `chrome://` settings or extensions page. Verify the displayed origin before selecting **Allow this site and start support**. Chrome may show two first-use prompts: temporary tab identification followed by access to the selected site. Denying either prompt leaves observation off.

If an older build reports `Cannot read properties of undefined (reading 'digest')` on a remote HTTP application, rebuild and reload the unpacked extension. Current builds use packaged SHA-256 and do not require `crypto.subtle` from the page. Do not enable insecure-origin browser flags as a workaround.

Once **Start support** succeeds, RemoteAssist pins that affected tab. The browser sharing chooser, microphone settings tab, or later focus changes do not change the observation target. If the pinned tab is closed, start a new support session instead of silently falling back to another active tab.

If `npm run dev:api` logs `[Vertex AI API Error] ... Please use a valid role: user, model.`, the Node guidance provider is sending an invalid Gemini content shape. Current builds send `role: "user"` explicitly for the guidance prompt. Rebuild/restart the API, then start a new support session so old provider state and old Realtime tool instructions are not reused.

If the log shows `ConnectTimeoutError` for `oauth2.googleapis.com`, the service-account Vertex path could not reach Google OAuth to get or refresh an access token. Confirm the machine can reach Google OAuth through the current proxy/VPN/firewall. The API caches successful service-account tokens, so repeated voice or knowledge turns should not request a new OAuth token until the cached token is close to expiry.

If backend voice is slow, watch the API logs for `voice_query_transcription_completed`, `voice_query_guidance_completed`, `voice_query_vertex_assistant_completed`, and `voice_query_synthesis_completed`. These show which provider step is taking time. If the side panel reports text but no voice audio, check the API log for `ElevenLabs TTS Error`; the default TTS model should be `eleven_flash_v2_5`, not the retired `eleven_monolingual_v1`. This provider chain is live turn mode, not full-duplex streaming: your short utterance is processed, spoken back, and then listening resumes. If `/voice-query` returns `request_body_too_large`, speak one shorter request; the extension also stops recording at a bounded utterance length to prevent oversized chunks.

## Development workflow

Update implementation, tests, roadmap status, and relevant plain-English documentation together. Run `npm run check` before committing. Do not expose `AUTH_MODE=mock` outside the local machine.

## Incident safety

If observation or control behaves unexpectedly:

1. Use the extension emergency stop.
2. Stop screen sharing from the browser indicator.
3. End the support session.
4. Preserve redacted audit identifiers, not raw sensitive page content.
5. Disable the affected tenant feature flag.
6. Review command, policy, consent, and session-revision events.
7. Do not re-enable control until the cause and revocation behavior are verified.

If a credential is exposed, revoke it at the provider, rotate the stored secret, inspect access logs, and follow the tenant's incident-response process. Removing a secret from a later commit is not sufficient because Git history and external logs may retain it.

## Release gates

No release may enable browser control unless command and revocation security tests pass. No release may enable human control unless human-role and audit-integrity tests pass. Production release also requires extension permission review, dependency scanning, privacy review, threat-model review, and a documented rollback.
