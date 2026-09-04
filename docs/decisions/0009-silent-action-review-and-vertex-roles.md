# ADR 0009: Keep action review silent and send explicit Gemini roles

Date: 2026-07-17

Status: accepted

## Context

Realtime action proposals and post-action reviews are internal coordination points. Speaking after every proposal or execution result made the assistant sound noisy and could distract from the actual approval button. Separately, the optional Vertex/Gemini knowledge-guidance provider failed when the request body did not include a role that Vertex accepts.

The working Python Vertex path sends conversation contents with explicit `user` and `model` roles. Vertex rejects any other role shape with `Please use a valid role: user, model.`

## Decision

RemoteAssist treats proposal-card creation as silent. When OpenAI Realtime returns `propose_browser_action`, the extension records and displays the proposal card, returns function-call output, and does not ask the model to acknowledge it out loud.

After packaged execution, RemoteAssist sends one bounded execution-status item to the active Realtime session and requests a text-only review. The model is instructed to call `propose_browser_action` once only when exactly one low-risk next step is clear, otherwise to wait without user-facing guidance. Every resulting action still requires a fresh card and allow-once approval.

The Vertex/Gemini provider builds request contents with `role: "user"` for the guidance prompt. This matches the Vertex content contract and is covered by a regression test. The default guidance model is `gemini-3.5-flash`; it is treated as a text/structured-output guidance model, not as a Live API voice model. When using a service-account key, the API caches the returned Google access token until it is close to expiry so ordinary conversation turns do not depend on a fresh OAuth exchange every time.

## Consequences

- The user hears fewer irrelevant model acknowledgements during action approval.
- The action loop can still advance by creating a fresh proposal card when the page state clearly supports one.
- A model response cannot reuse the previous approval or execute a command.
- Provider configuration errors caused by missing Gemini roles are easier to diagnose and test.
- Temporary Google OAuth connectivity failures have a smaller impact after the first successful service-account token exchange.
