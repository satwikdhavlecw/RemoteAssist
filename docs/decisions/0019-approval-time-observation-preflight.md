# ADR 0019: Re-observe before browser-action approval

Status: accepted

Date: 2026-08-29

## Context

Enterprise web applications commonly replace navigation and tab elements after
rendering, scrolling, or data refreshes. RemoteAssist can therefore display a
proposal from a valid observation while the command proposal request sees a
different element identity. The result was a safe `safe_target_not_found` or
`target_precondition_failed` response even though the same visible control was
still present.

Action suggestions can also return no proposal when the advisory model is
slow, conservative, or temporarily unavailable. Explicit low-risk requests
still need a review card when the current sanitized observation contains one
unambiguous eligible control.

## Decision

The side panel re-observes the pinned tab immediately before creating a browser
command. It submits that sanitized observation to the server, resolves the
requested control by name and low-risk policy, prefers the original role when
it still matches, and otherwise accepts one unique safe control with the same
name if the page framework changed its semantic role. The server then repeats
its authoritative observation, consent, origin, revision, expiry, and policy
checks as before.

For explicit click and scroll requests, a deterministic local resolver is used
when the advisory action API returns no proposal or has a transient failure.
The local result is still only a proposal; it cannot approve, authorize, or
execute a command.

## Consequences

SAP/UI5 tab activation and similar dynamic pages are less likely to fail
between proposal and approval. The security boundary remains intact because
the command is bound to the fresh sanitized observation and still requires a
separate allow-once consent and approval. Duplicate or hidden controls remain
blocked. The extra observation adds one small request before execution.
