# RemoteAssist

RemoteAssist is a voice-enabled, visually aware enterprise support agent for Chrome and Edge. It helps an employee diagnose a browser problem, retrieves approved enterprise guidance, requests explicit consent before observing or acting, executes only policy-approved browser commands, and can escalate to backend automation or a human support engineer.

This application was designed from two private source specifications supplied locally: the Product Requirements Document and the Knowledge Base and Troubleshooting Intelligence specification. They remain local source material and are intentionally excluded from the distributable repository.

The MVP is deliberately browser-first. It works on approved HTTP/HTTPS applications with accessible page content; it does not provide arbitrary desktop control, operate remote-desktop or canvas-only screens, read or enter passwords or one-time codes, submit sign-in or payment actions, or run code supplied by an AI model.

## Current status

The current observation transport accepts up to 300 visible non-sensitive text entries of 1,500 characters each. Provider summaries and action-review chat history remain separately bounded, and long answers wrap in the side panel instead of being clipped.

The current build includes the Manifest V3 employee extension, explicit and separate consent grants, sensitive-field-safe observation, browser Web Speech API or ElevenLabs + Vertex live turn voice guidance, optional OpenAI Realtime voice over WebRTC, a governed allow-once browser-command path, deterministic backend diagnostic and ticket adapters, and a role-scoped human handoff console. Local identity, AutomationEdge, ServiceNow, storage, and the human queue remain development implementations.

Runtime knowledge now starts empty and fails closed. The Salesforce article and `KB-DEMO-001` procedure have been removed from the application and exist only as renamed, explicitly injected test fixtures. Until an approved enterprise knowledge connector is configured, the side panel uses the configured LLM for a direct page-context response and disables knowledge-derived and backend operations. The chat does not display an internal database-status prefix when no article matches. OpenAI Realtime can use a narrow function tool to select an eligible click, focus, or scroll action over one unambiguous current control. When using backend voice or chat with Vertex/Gemini, RemoteAssist can also ask the backend LLM for one current low-risk action suggestion after chat, voice, initial observation, or a changed page observation. The proposal becomes a review card only; deterministic policy and explicit allow-once approval remain mandatory before packaged code can execute it.

Action proposals are tied to the exact sanitized observation that produced them. The side panel validates proposals against its current observation, uses a deterministic fallback for explicit low-risk requests when the advisory API returns no proposal, and re-observes the page immediately before approval. It then requires the target name and role to match again, so a proposal cannot be displayed for or dispatched to an older or different control. This handles enterprise pages that replace tab elements during rendering without bypassing consent or policy checks.

After an approved action, RemoteAssist immediately records the new sanitized page state and asks the active Realtime session to review the result silently. The model may create one new action proposal card through the function tool, but it should not speak simply because a card was created or an action result was recorded. This creates a multi-step guided troubleshooting loop without giving the model an executor, continuous control, or extra narration around internal state changes.

Voice starts only after separate microphone consent. With `VOICE_PROVIDER=browser_speech`, Chrome or Edge transcribes the microphone with `SpeechRecognition` and speaks the returned LLM guidance with `speechSynthesis`; only the recognized text and sanitized support context go to the RemoteAssist API. Browser speech services may process microphone audio according to browser settings. With `VOICE_PROVIDER=openai_realtime`, the browser sends its WebRTC offer through the RemoteAssist API, which authenticates to OpenAI with the server-only API key. With `VOICE_PROVIDER=elevenlabs` or `google_voice`, the extension runs live turn mode: it detects one short utterance, sends it to the API for STT, Vertex/Gemini guidance, action review over recent conversation and current screen context, and TTS, plays the reply, then immediately resumes listening. If the same voice turn produces an action card, the spoken reply names that exact proposed action and reminds the user that allow-once review is still required. RemoteAssist does not create a local audio recording. Pause, consent revocation, and session end close local media, request provider cleanup, and block new side effects. Resume never restarts microphone access automatically.

Browser-window sharing is change-driven, not a video feed to the model. The employee can choose the complete Chrome window in the browser picker; monitor capture and system audio remain excluded. The extension still pins one active HTTP/HTTPS tab for sanitized DOM observation and approved commands. While that tab remains available, the content script watches visible DOM changes, waits briefly for the page to settle, creates a new sensitive-field-safe observation, and submits it only when the page fingerprint changes. RemoteAssist refreshes guidance from that observation and may ask the active AI provider to review current eligible control names and actions. Pixels from the display-capture track are not sent to the AI provider, so canvas-only applications, remote desktops, videos, and image-only errors still require a future separately approved screenshot/OCR capability.

Page fingerprints use a packaged SHA-256 implementation rather than the page's Web Crypto API. This preserves the same cryptographic fingerprint on approved remote HTTP applications, where Chrome intentionally withholds `crypto.subtle`, and does not require relaxing browser security settings.

Application identity is not limited to a hardcoded product list. The sanitizer derives a bounded, non-sensitive name from standard application metadata, the document title, or the primary heading and sends the page title with the Realtime context. Field values remain excluded, so a login page can be recognized as **ConversationFlo** without exposing the entered username or password.

RemoteAssist pins the affected tab when the employee starts the session. Opening the browser sharing chooser or focusing another tab afterward does not redirect observation or an approved action. In the side panel, select **Use this page** while the affected HTTP/HTTPS application is active. Chrome first grants temporary tab metadata access so RemoteAssist can show the selected origin. Select **Allow this site and start support** to approve that exact host; the temporary tab-list permission is then removed. The sharing picker can offer the complete Chrome window, while the pinned tab remains the authoritative observation and command target. The side panel keeps the main workflow in one page: status, watched page, conversation, text input, and microphone controls are visible in one scrollable support flow. Chat replies show returned grounded guidance or a clearly labeled informational LLM explanation from the sanitized page context when no approved article matches. The complete parsed LLM response is shown in chat without a second local character slice; the provider still has a finite output-token budget and damaged or truncated provider responses fall back safely. Long responses are not clipped by an inner chat viewport; the side panel remains the scroll container. Navigation requests such as `open first incident`, `open settings page`, or `open history tab` can create an allow-once proposal for the named observed control. Named requests such as `scroll down to the Tax section` can create an allow-once scroll proposal when that target is currently observed. After approval, the action card remains visible with the execution or safe-block result; tab clicks are reported verified only when the page or tab state changes. Form submission, data entry, destructive actions, and unnamed or unobserved links remain blocked.

The browser-action review card appears immediately below the watched-page header, before the conversation, so an incident or navigation proposal can be approved without searching below the chat. Clearly named navigation controls such as `History`, `Home`, `Dashboard`, `Settings`, `Preferences`, `Help`, `Documentation`, `Workspace`, and `Incidents` are supported even when an application renders them as plain text inside a navigation container; arbitrary links remain blocked unless the user explicitly names an observed link.

Chrome cannot display its microphone permission prompt inside an extension side panel. On first use, RemoteAssist opens a packaged extension page in a normal browser tab to request the extension-origin permission. That page immediately stops its probe track and sends no audio to a voice provider; the employee then returns to the side panel and enables voice explicitly.

Interactive Chrome/Edge and live-provider acceptance remain open. Production Entra ID, OCR/vision, connector authentication, durable storage, AutomationEdge, ServiceNow, and live human media remain documented activation work. See [MVP acceptance](docs/MVP_ACCEPTANCE.md).

## Quick start

Requirements: Node.js 22 or newer, npm, Chrome or Edge 120 or newer, and Vertex AI service-account credentials or a Gemini API key. ElevenLabs credentials are only required for `VOICE_PROVIDER=elevenlabs`; browser speech mode does not require a speech-provider key.

```powershell
npm ci
Copy-Item .env.example .env
npm run check
```

For no-speech-provider local testing, set `VOICE_PROVIDER=browser_speech` with `LLM_PROVIDER=vertex`. This uses browser `SpeechRecognition` for the question and browser `speechSynthesis` for the reply. Configure either `VERTEX_AI_KEY_PATH` with `VERTEX_AI_PROJECT_ID`/`VERTEX_AI_LOCATION`, or `GEMINI_API_KEY`. Keep `VOICE_PROVIDER=elevenlabs` only when `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are configured. The default guidance model is `gemini-3.5-flash`. RemoteAssist sends Gemini content with the explicit `user` role required by Vertex; if you change providers, restart `npm run dev:api`.

OpenAI Realtime remains optional. To use it instead, set `VOICE_PROVIDER=openai_realtime` and provide `OPENAI_API_KEY`. Never put any provider key in extension code or commit `.env`.

Start the local API and controlled Salesforce fixture in separate terminals:

```powershell
npm run dev:api
npm run fixture
```

Build and serve the human support console in another terminal:

```powershell
npm run build --workspace @remoteassist/support-console
npm run serve:support-console
```

The console is available at `http://127.0.0.1:4330`. It shows a request only after the employee separately grants human-view consent and selects **Request human engineer**.

Build the extension:

```powershell
npm run build --workspace @remoteassist/browser-extension
```

Open `chrome://extensions` or `edge://extensions`, enable developer mode, choose **Load unpacked**, and select `apps/browser-extension/dist`. Then open `http://127.0.0.1:4320/salesforce-saml`, open RemoteAssist, select **Use this page**, confirm the displayed origin, and follow the consent flow. External HTTP and HTTPS applications receive an exact-site Chrome permission prompt before the session starts.

The local API loads the repository-root `.env`, uses mock identity, starts with no knowledge documents, and sends explicitly consented voice data to OpenAI Realtime. It must not be exposed to an untrusted network. Production authentication and enterprise knowledge connectors are deliberately unavailable until their activation milestones.

## Repository map

```text
apps/
  browser-extension/    Chrome and Edge Manifest V3 extension
  support-console/      Role-scoped human handoff and context workspace
services/
  api/                  Session, consent, command, knowledge, audit and handoff APIs
packages/
  shared-types/         Cross-application data contracts
  command-schema/       Strict browser-command validation
  policy-model/         Consent, origin, risk and session policy evaluation
docs/                   Plain-English product, architecture, security and operating docs
tests/                  Cross-component acceptance and security tests
```

The folders are introduced as their roadmap milestones become runnable. Empty placeholders are not used.

## Documentation

- [Roadmap and delivery status](docs/ROADMAP.md)
- [Requirements traceability](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Backend API](docs/API.md)
- [MVP acceptance](docs/MVP_ACCEPTANCE.md)
- [Provider configuration and activation](docs/PROVIDER_CONFIGURATION.md)
- [Extension permissions](docs/EXTENSION_PERMISSIONS.md)
- [Developer and operator runbook](docs/RUNBOOK.md)
- [Architecture decisions](docs/decisions/)

`AGENTS.md` requires every coding iteration to update the relevant plain-English documentation in the same commit as the code.

## Security position

RemoteAssist follows five non-negotiable rules:

1. The user is always told when voice, screen viewing, AI control, or human control is active.
2. An AI may propose an action, but only deterministic packaged code may execute it.
3. Every action passes schema, session, origin, consent, risk, target, expiry, and sensitive-field checks.
4. Page content and model output are treated as hostile input.
5. Stopping, pausing, ending a session, or revoking consent immediately prevents further control.

The automated regression suite also verifies that a paused or ended session cannot start voice, workflow, or handoff work, and that a failed browser command cannot report successful verification.

See [the threat model](docs/THREAT_MODEL.md) for the full set of controls.
