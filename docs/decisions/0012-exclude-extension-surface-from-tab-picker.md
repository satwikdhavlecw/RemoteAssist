# ADR 0012: Share the browser window while pinning the support tab

## Context

RemoteAssist starts browser sharing from its side panel. The product needs the employee to be able to share the complete Chrome window, including the support surface when the browser exposes it, while keeping observation and commands bound to the affected application tab.

## Decision

The browser display request requests a complete browser window, permits the browser to include the RemoteAssist surface, excludes monitor capture and system audio, and does not prefer the current surface. The employee still selects the affected HTTP/HTTPS tab separately before consent; the pinned tab is authoritative for DOM observation and commands.

## Consequences

The complete-window option matches support scenarios where the employee needs the browser chrome and side panel visible. Chrome controls the exact captured window contents, so the extension cannot guarantee that every browser version includes the side panel. The extension still pins and separately validates the affected tab before observation and command execution.
