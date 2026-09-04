# ADR 0006: Let Realtime propose actions but never authorize execution

Date: 2026-07-16

Status: accepted

## Context

The first no-knowledge browser-action card selected a retry control with fixed application code. That preserved safety but did not let the live voice model make a contextual next-step decision. Giving a model a browser executor would violate RemoteAssist's consent, policy, and deterministic-control boundaries.

## Decision

Expose one OpenAI Realtime function tool named `propose_browser_action`. The API includes at most 25 current controls with locally allowed action types. The tool schema constrains `control_name` to current names, restricts `action_type` to click, focus, or scroll, and requires a short purpose. The client and server reject action/control pairs that are disallowed or whose accessible name is ambiguous.

The extension listens for a completed Realtime function call and validates its shape, call identifier, exact current control match, role, enabled state, and local risk classification. It then sends the proposal to the API, which repeats the current-observation and low-risk checks and appends `MODEL_ACTION_PROPOSED`. Only that validated response is displayed as a proposal card. The extension returns `awaiting_user_approval` to OpenAI. It does not execute the action.

If the employee chooses **Allow once and click/focus/scroll**, the existing backend resolves the target from its authoritative observation, repeats risk and session checks, requires separate consent, authorizes a short-lived command, and dispatches packaged deterministic code. Higher-risk clicks, stale targets, duplicate names, selectors, malformed calls, and unobserved controls fail closed.

After execution, RemoteAssist records the refreshed sanitized observation and may ask Realtime for one next-step review. Any resulting function call starts a new proposal and approval cycle; the model cannot chain execution or reuse the previous approval.

## Consequences

- The card's control and purpose are selected dynamically by OpenAI rather than fixed UI copy.
- Model proposals remain untrusted and cannot bypass explicit employee approval or deterministic policy.
- Filtered control names, roles, and allowed action types are sent to OpenAI as part of the consented support context; no selectors, element identifiers, field values, or hidden content are included.
- A voice response may contain no action card when the model does not call the tool or when its proposal is rejected.
- Live browser qualification must cover valid, malformed, stale, and higher-risk proposals.
