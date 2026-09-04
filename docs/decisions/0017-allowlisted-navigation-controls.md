# ADR 0017: Allowlisted navigation controls

Status: accepted

Date: 2026-08-27

## Context

Users need to ask RemoteAssist to open common navigation areas such as the
ServiceNow `History` tab. General link clicking is too broad because a page
could contain links that submit data, change state, or leave the approved
site.

## Decision

For a clear navigation request, RemoteAssist may propose clicking a current
visible button or link whose name is explicitly mentioned by the user. The
target must still be an observed enabled control and pass the normal risk
checks. This supports arbitrary external destinations only when the user
names the observed link; it does not permit arbitrary selectors or model-only
navigation. For applications that render common navigation labels as plain
text inside a navigation container, the sanitizer may assign the visible text
node a synthetic observed link role and stable element identity. This fallback
also covers class-based application headers such as ServiceNow Polaris. It is
limited to known navigation labels, including common SAP invoice sections,
traverses open shadow roots, and still
requires the same approval and pre-dispatch checks.

The user must approve the proposal once. The server and extension continue to
validate the session, origin, page fingerprint, target identity, visibility,
and sensitive-target status before dispatching the click. Form entry,
submission, deletion, approval, unnamed links, and model-only external URL
navigation remain unavailable. Matching ignores generic command words such as
"open" and requires a requested destination word, preventing a control named
"Open accessibility preferences" from being selected for an "Open History"
request. Named scroll requests use the same observed-control requirement and
may propose `SCROLL_TO_ELEMENT` for an explicitly mentioned section or tab.
They do not create an arbitrary scroll command when the requested target is not
present in the current sanitized observation. If the page observation changes
while an LLM suggestion is being generated, the suggestion is discarded and a
new request is made for the current observation. The side panel displays a
proposal only when exactly one current low-risk observed control matches the
proposal name and policy; this prevents stale or ambiguous cards without
weakening the consent boundary. Common intent phrases such as `take me to
invoice page` are classified as navigation, but still require the requested
destination to be an unambiguous observed low-risk control. If the backend
returns no proposal for an explicit click or scroll request, the extension may
create the same review card locally, but only from that current observation;
approval and server-side command validation remain mandatory.

The side panel passes the exact observation returned by the initial capture or
page-change refresh into proposal matching. Approval also sends the proposed
control role, and the command service requires both the control name and role
to match the current sanitized observation. This prevents delayed guidance or
duplicate labels from selecting a different rendered element.

## Consequences

Common navigation requests can produce an actionable approval card even when
an optional LLM is unavailable. The user sees the named target and must
approve it before the click is dispatched. The proposal card remains mounted
after execution so the user can see whether the command executed or was
blocked. For a tab click, the extension dispatches against the rendered hit
element inside the observed tab container, then checks the sanitized page
fingerprint and the tab's accessible state before reporting verification. A
native click, Enter, or Space dispatch alone is not presented as a verified
page change.
