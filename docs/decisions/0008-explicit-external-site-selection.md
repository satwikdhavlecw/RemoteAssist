# ADR 0008: Select external sites with temporary metadata and exact-host approval

Date: 2026-07-16

Status: accepted

## Context

Chrome can open a globally pinned extension side panel without granting `activeTab` to the page beside it. In that state, `tabs.query` returns a tab ID but withholds the URL, so RemoteAssist cannot validate or bind the affected origin. Repeatedly telling the employee to click the toolbar action did not work consistently across pinned-side-panel profiles. Granting permanent access to all sites or permanent tab metadata would exceed the least-privilege boundary.

## Decision

Declare `tabs` as an optional permission and HTTP/HTTPS wildcard hosts as optional host permissions. The wildcards define which exact origins Chrome may later prompt for; they do not grant install-time access.

The side panel uses two employee gestures. **Use this page** temporarily requests tab metadata, resolves the active tab, and displays its normalized origin. **Allow this site and start support** requests host access for only that scheme and hostname, binds the returned tab ID, and removes the optional `tabs` grant. Existing restricted-origin, consent, sanitizer, session, and command checks remain mandatory.

## Consequences

- Globally opened or pinned side panels can select external HTTP and HTTPS applications without depending on an inconsistent action grant.
- The employee sees the exact origin before observation begins and may deny either permission prompt.
- RemoteAssist does not retain permission to list tab URLs after the target host is approved.
- The approved host permission persists according to Chrome's permission model until the employee or administrator revokes it; RemoteAssist still requires session-specific screen consent each time.
- Browser-store permission disclosures and enterprise deployment documentation must explain the temporary metadata request and optional site access.
