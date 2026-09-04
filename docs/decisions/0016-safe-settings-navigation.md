# ADR 0016: Safe navigation for settings controls

Status: accepted

Date: 2026-08-27

## Context

Users may ask RemoteAssist to open a visible settings page. The existing
browser-control MVP did not provide a deterministic proposal for that request
and general link clicking would give the agent too much authority.

## Decision

Allow a click proposal for a visible, enabled link or button whose accessible
name clearly contains `Settings` or `Preferences`. The API creates this
proposal only for a clear navigation request such as "open settings page".
Existing risk-word checks still reject labels such as `Save settings` or
`Change settings`.

The normal controls remain mandatory: the user must approve once, the server
must authorize the command, and the extension must recheck the pinned tab,
origin, page fingerprint, target identity, visibility, and sensitivity before
dispatching the click. Arbitrary links, form submission, and data entry remain
blocked.

## Consequences

Common settings navigation is supported without enabling general browsing
control. Settings forms are not filled or submitted by this change; those
operations need a separate field-level consent and final confirmation design.
