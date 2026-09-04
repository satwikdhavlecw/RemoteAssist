# ADR 0007: Refresh visual context from changed sanitized DOM state

Date: 2026-07-16

Status: accepted

## Context

The tab-sharing prompt created an accurate consent and revocation lifecycle, but the first implementation sent only one sanitized observation. A changing page could therefore leave OpenAI reasoning about stale controls. Sending a continuous display video would expose substantially more data, increase provider cost, and require screenshot, OCR, retention, and image-safety controls that are not ready in the browser-first milestone.

## Decision

While selected-tab observation consent remains active, the packaged content script observes DOM mutations. It waits 750 milliseconds for changes to settle, re-runs the existing sensitive-field-safe sanitizer, and publishes only when the sanitized page fingerprint differs from the last observation.

Fingerprinting uses a packaged SHA-256 implementation over at most 100,000 normalized characters. It does not call the page context's Web Crypto API because Chrome may omit `crypto.subtle` on remote plain-HTTP applications. A non-cryptographic fallback was rejected because the fingerprint participates in stale-page command checks.

Application identity is derived from bounded standard metadata, document title, primary heading, or hostname rather than a fixed product-name list. Candidates matching sensitive or secret patterns fail closed. The active Realtime session receives the derived name and page title, but never form values.

The side panel records each changed observation through the existing origin, consent, session, and audit path. It invalidates any action proposal derived from the prior fingerprint. If an OpenAI Realtime WebRTC session is active, the extension sends a bounded text summary as conversation context and updates the proposal function's enum with at most 25 current low-risk controls.

The affected tab ID is captured before the browser display chooser opens and remains bound to the support session. Observation, overlays, commands, and stop messages resolve that exact tab and repeat origin policy checks. Focus changes never cause an implicit switch to another active tab.

The display-capture track is not attached to OpenAI. It remains the browser-visible sharing and revocation mechanism. Canvas-only applications, remote desktops, videos, screenshots, and image-only errors are not visually interpreted by this adapter.

## Consequences

- OpenAI can follow ordinary browser application state changes without a continuous pixel feed.
- Passwords, hidden values, payment fields, tokens, selectors, element identifiers, and display pixels remain outside provider context.
- DOM-heavy applications may generate many mutations, but debouncing and fingerprint equality suppress unchanged submissions.
- Pause, revoke, stop, navigation policy, and session end remain immediate capability barriers.
- Screenshot sampling, OCR, image safety, sampling rate, retention, and separate user disclosure require a future decision and security review.
