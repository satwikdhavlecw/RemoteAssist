# ADR 0018: Bind proposals to the current observed control

Status: accepted

Date: 2026-08-29

## Context

Action suggestions are asynchronous. A page can change while knowledge search,
LLM guidance, or action review is still running. React state can also lag the
observation that was just submitted. In addition, enterprise pages can render
the same visible label in more than one role.

Without an explicit handoff, a valid request such as `click on Tax` can lose
its approval card because the fallback examines the previous observation. If
the card is shown but the command request carries only the label, the server
can no longer prove that the approved target is the same observed control.

## Decision

Proposal generation accepts the exact sanitized observation that triggered the
request. A delayed result is accepted only when its page fingerprint is still
current. The extension carries both the proposed control name and role into
the command proposal request. The server requires both values to match one
enabled control in the latest observation before creating a command.

This does not bypass approval or policy. Origin, fingerprint, expiry, consent,
risk, target visibility, sensitive-field, authorization, deterministic
execution, verification, and audit checks remain in force.

## Consequences

Explicit click and scroll requests can reliably produce a review card after an
observation refresh, including when the optional action LLM returns no
proposal. Duplicate labels cannot silently resolve to a different role. A
target that changed or disappeared is rejected and must be proposed again from
the newly observed page.
