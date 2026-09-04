# Browser extension permissions

## Permission strategy

RemoteAssist asks for the narrowest capability at the latest responsible moment. Installing the extension must not silently grant access to every website, microphone, screen, or browser-control feature.

## Base permissions

- `sidePanel`: provides the persistent support interface beside the affected page.
- `storage`: stores minimal managed configuration and expiring active-session state. It must never store long-lived API keys, passwords, raw captures, cookies, or transcripts by default.
- `activeTab`: allows a direct user gesture to grant temporary access to the current tab.
- `scripting`: injects the packaged content script into a user-approved supported tab when static host access is not granted.

The service worker coordinates lifecycle and messages. Content scripts own approved-page DOM observation and deterministic actions. The side panel owns user-visible state and consent controls.

## Host permissions

The development build has narrow persistent access only to the loopback API on port `4310` and the controlled Salesforce fixture on port `4320`, for both `127.0.0.1` and `localhost`. The fixture permission prevents Chrome from hiding the demo tab URL when a pinned side panel was opened from another tab. It does not grant access to another local port or an external HTTP endpoint. WebRTC media negotiation is initiated through the loopback API; the extension does not receive the server-side OpenAI API key.

External application access may use `activeTab` when the employee invokes the toolbar action. Because globally opened or pinned side panels do not consistently receive that grant, HTTP and HTTPS origins are also declared as optional permissions and are never silently activated.

The side panel also supports Chrome profiles where opening or pinning a global side panel does not deliver an `activeTab` grant. **Use this page** requests the optional `tabs` permission long enough to read the active tab's URL, title, and ID and show the origin to the employee. **Allow this site and start support** then requests only that HTTP or HTTPS host from the declared optional host patterns. After host approval, RemoteAssist removes the optional `tabs` permission. The broad host patterns are declarations of what Chrome may prompt for, not install-time grants; no external site is accessible until the employee approves it.

Enterprise administrators may deploy a managed allowlist for approved business applications. A managed allowlist never overrides the restricted-domain blocklist or user consent.

## Media permissions

Microphone access begins with a visible user gesture. Because Chrome cannot show the media permission prompt inside a side panel, first use opens a packaged extension page in a normal tab. The employee grants the extension-origin permission there; its probe track is stopped immediately and is never sent to a provider. The employee must then return to the side panel and explicitly enable voice before RemoteAssist records server consent or creates a provider session. For OpenAI Realtime, the active microphone track is attached to a WebRTC peer connection. For ElevenLabs or Google Voice, the side panel uses `MediaRecorder` only to create one bounded in-memory utterance for the backend `/voice-query` route. Tracks and in-memory chunks are stopped or cleared on pause, revoke, end, component unmount, or connection failure. RemoteAssist does not create a local audio recording. Screen or tab sharing uses the browser's separate standard display-selection prompt. The extension prefers the current tab, shows a persistent indicator, stops on track end, stop, revoke, or session end, and never restarts automatically. The display track is not attached to OpenAI; model context comes from consent-scoped, sanitized DOM observations that refresh only after the sanitized page fingerprint changes.

The sharing picker presents the complete Chrome window, permits the browser to include the RemoteAssist surface when available, excludes entire-monitor choices and system audio, and permits browser-controlled tab switching. Observation and commands still bind to the separately selected HTTP/HTTPS tab, not to an arbitrary tab or window surface.

## Permissions excluded from the default MVP

- `debugger`: too powerful for ordinary content-script actions. A separate enterprise build may add it only after policy, threat-model, allowlist, audit, and distribution review. Raw DevTools command passthrough remains prohibited.
- Persistent `tabs` broad metadata access: excluded. A temporary optional grant is used only to select the active page and is removed after exact-host approval.
- Clipboard, downloads, native messaging, browsing history, cookies, web request interception, file URL access, and browser settings: outside the MVP requirement and security boundary.

## Content Security Policy

All executable extension code is packaged. The extension does not load remote scripts, evaluate strings as code, use model-supplied selectors, or download new executors. HTTP requests are limited to the configured backend. The browser's WebRTC implementation carries consented microphone and response audio for the backend-created OpenAI Realtime call. A model function call may name one filtered observed control for a proposal card, but RemoteAssist resolves the actual target from its own current observation and the model never gains a browser executor or authorization capability.

## Review checklist

Every permission change must document the user-visible need, least-privilege alternative, activation gesture, data touched, revocation behavior, enterprise policy interaction, test coverage, and Chrome/Edge store or enterprise-distribution impact.
