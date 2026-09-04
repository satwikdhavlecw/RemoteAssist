# ADR 0020: Multi-step resolution plan proposals with live per-step re-verification

Date: 2026-09-02

Status: accepted

## Context

Under [ADR 0006](./0006-realtime-proposals-not-execution.md), RemoteAssist established the principle that AI models may propose browser actions, but packaged code executes them only after explicit human approval. Historically, every action was proposed and approved strictly one at a time.

For multi-step enterprise workflows (such as SAP Fiori tile navigation followed by section scrolling, or Salesforce list filtering), approving individual actions one-by-one imposed substantial user friction and latency. However, naive batch execution of pre-planned steps creates a serious security risk known as *stale-plan drift*: after step 1 executes, DOM replacement, asynchronous updates, client-side routing, or redirects may shift page coordinates, replace element identifiers, alter control destinations, or navigate cross-origin. Blindly replaying cached steps could click an unintended or dangerous control.

## Decision

Redesign RemoteAssist's action flow from single-action approval to multi-step resolution-plan approval while strictly enforcing that **a plan is a proposal, not an execution bypass**:

1. **Step capping**: Proposed plans are capped at `MAX_RESOLUTION_PLAN_STEPS = 5`. If an LLM or heuristic generates more than 5 steps, the plan is truncated and a clear safety warning banner is surfaced to the user.
2. **Upfront review**: The user is presented with the complete ordered sequence of steps, target controls, and purposes in a single approval card before any execution occurs.
3. **Non-blind live execution loop**:
   - Immediately before **each** step executes, the extension acquires a fresh live observation of the active tab.
   - Origin invariance is verified (`fresh.origin === initial.origin`). If the page navigated to a different origin, the plan aborts immediately.
   - The target control is re-resolved dynamically from the live observation rather than using stale snapshots.
   - The authoritative risk gate (`isPotentiallyLowRiskAction` and action allowlist) is re-evaluated against the live control.
   - If the target is missing, disabled, altered, or fails the risk gate, the plan stops safely and reports the exact failure reason in the sidepanel.
4. **Distinct audit attribution**:
   - Standing plan approval does not masquerade as individual human clicks. Step 1 logs `COMMAND_APPROVED_UNDER_PLAN` (actor: `user`), while steps 2 through $N$ log `COMMAND_AUTO_APPROVED_UNDER_PLAN` (actor: `system`).
   - Every audit event for proposed, approved, authorized, and executed commands carries `planId`, `approvedViaPlanId`, and `stepIndex`.
   - The plan lifecycle itself logs `PLAN_PROPOSED`, `PLAN_APPROVED_BY_USER`, and a concluding summary event: `PLAN_COMPLETED` (on full success) or `PLAN_ABORTED` (on user stop, policy block, or failure).
5. **Always-visible abort control**: A Stop/Abort button is visible at all times during plan execution. Abort checks run both before initiating each step and immediately after fresh observation acquisition, guaranteeing prompt termination before the next step dispatches.

## Consequences

- Multi-step enterprise resolutions can be reviewed and approved in a single human decision, eliminating repetitive approval prompts.
- Zero-trust safety invariants are fully preserved: no blind command execution, zero access to sensitive fields, and full policy enforcement immediately prior to dispatch.
- Auditors can unambiguously distinguish between genuine single-click human approvals and automated steps executed under a standing plan approval.
- Stale-plan drift is prevented by live pre-step DOM re-observation and fresh control binding.
