# ADR 0015: Safe navigation for observed incident links

Status: accepted

Date: 2026-08-26

## Context

ServiceNow incident lists expose incident records as links, for example
`INC0011556`. RemoteAssist already supports an explicit allow-once click for
low-risk buttons, but its policy rejected every link. As a result, a request
such as "Open the first incident for me" produced guidance instead of an
action proposal.

## Decision

Allow a `CLICK_ELEMENT` proposal only for an observed link whose accessible
name contains a clearly identified incident number matching `INC` followed by
at least three digits. This tolerates harmless duplicated or decorated
accessible text while still requiring the link role and existing risk checks.
For an explicit first-incident request, the API selects the first matching
link in the current sanitized observation. If the request names an incident
number, such as `INC0011556`, the API selects that exact observed link. The
guidance layer also distinguishes navigation wording such as "open first
incident" from creation wording such as "create new incident".

The existing controls remain mandatory:

- the page must be the pinned same-origin page;
- the target must still match the current observation and fingerprint;
- the action must pass schema and policy validation;
- the employee must grant allow-once consent;
- execution and result are audited; and
- arbitrary links, form submission, password fields, and data entry remain
  unavailable. Other external links follow the same explicit-name and
  allow-once approval rule only when the user clearly names an observed
  navigation control; unnamed or model-selected links remain unavailable.

## Consequences

The common ServiceNow list-navigation case is actionable without granting
general link-click capability. The action is still not automatic: the user
reviews the proposal before the extension dispatches the click. Creating or
editing an incident remains a separate workflow because it requires
field-level consent, safe text handling, and final submission confirmation.
