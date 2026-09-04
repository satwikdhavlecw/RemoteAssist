# RemoteAssist: In-Depth Code Architecture & File-by-File Guide

This document provides a comprehensive code-level explanation of the **RemoteAssist** codebase. Use this guide whenever you need to explain the code, architecture, and exact function implementations to technical leads, architects, or managers.

---

## 1. System Architecture Map

RemoteAssist consists of 4 main workspaces organized as an npm monorepo:

```
AERemoteSupportAgent/
├── apps/
│   ├── browser-extension/   # Chrome/Edge Extension (UI, DOM observation, click executor)
│   └── support-console/     # Human Support Dashboard
├── packages/
│   ├── command-schema/      # Zod validation schemas for all browser commands
│   ├── control-policy/      # Role and action capability definitions
│   ├── policy-model/        # Zero-trust security engine (domain allowlists, risk checks)
│   └── shared-types/        # TypeScript interfaces & state definitions
├── services/
│   └── api/                 # Node.js/Fastify Backend (RAG, Gemini LLM, Action Proposer)
└── docs/                    # Architecture, library guides, and walkthroughs
```

---

## 2. File-by-File Code Walkthrough

### A. Frontend: DOM Observation & Security Sanitization

📁 **File**: [`apps/browser-extension/src/security/sanitize.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/security/sanitize.ts)

- **`isSensitiveElement(element)`**:
  - **What it does**: Inspects every input on the web page to ensure sensitive data is never captured.
  - **How it works**: Uses regex patterns to identify passwords, credit cards, CVVs, OTP codes, bearer tokens, or API keys (`sensitiveTextPattern` and `secretValuePattern`). If matched, the element is redacted locally before anything is sent to the network.
- **`isVisibleElement(element)`**:
  - **What it does**: Verifies whether an element is currently rendered on screen.
  - **How it works**: Checks `computedStyle.display !== "none"`, `opacity !== 0`, `visibility !== "hidden"`, and `getClientRects().length > 0`.
- **`safeControls(documentRoot)`**:
  - **What it does**: Traverses interactive DOM nodes (buttons, links, tabs, menu items, custom Fiori tiles).
  - **How it works**: Stamps each element with a unique runtime ID (`data-remoteassist-id="ra-1"`, `"ra-2"`), captures its accessible name (`accessibleName()`), bounding coordinates, and returns a sanitized list of `SafeControl[]`.
- **`fingerprint(values)`**:
  - **What it does**: Computes a SHA-256 cryptographic hash of visible text and controls to track page state changes.

---

### B. Frontend: Sequential Flow Queue & Lifecycle

📁 **File**: [`apps/browser-extension/src/sidepanel/App.tsx`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/sidepanel/App.tsx)

- **`flowSteps` (Ref Queue)**:
  - **What it does**: Holds the individual steps of a multi-step query.
  - **How it works**: When a user enters _"Open project management and then open plan customer projects"_, `handleSendChat()` splits the sentence using:
    ```typescript
    const steps = text
      .split(/\b(?:and\s+then|then|after\s+that|next|and\s+after\s+that)\b/i)
      .map((s) => s.trim())
      .filter(Boolean);
    flowSteps.current = steps;
    ```
- **Auto-Follow-Up Effect (`useEffect` on `actionFollowUp`)**:
  - **What it does**: Automatically triggers the next step after a click completes without an infinite loop.
  - **How it works**: When an action completes, `actionFollowUp` updates. The hook shifts the completed step (`flowSteps.current.shift()`). If there are remaining steps, it automatically calls `updateIssueAndSearch()` with the next step on the updated DOM.

---

### C. Frontend: Proposal UI & Highlight Overlay

📁 **File**: [`apps/browser-extension/src/sidepanel/ControlPanel.tsx`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/sidepanel/ControlPanel.tsx)

- **Highlighter Lifecycle (`useEffect`)**:
  - **What it does**: Draws and removes the visual purple outline on the web page.
  - **How it works**: When `state === "offered"`, sends `REMOTEASSIST_HIGHLIGHT_ACTIVE_TAB` to outline the target. As soon as the user clicks **"Allow once"** (`state === "executing"`), or when the card unmounts, it immediately sends `REMOTEASSIST_CLEAR_ACTIVE_TAB` to remove the highlight.
- **`allowOnce()`**:
  - **What it does**: Coordinates the 4-step governance handshake:
    1. Re-observes the page to verify element identity (`freshObservation`).
    2. Grants temporary `allow_once` browser control consent.
    3. Sends proposed command to the server for authorization signature.
    4. Dispatches the command to the content script executor.

---

### D. Frontend: Deterministic Browser Executor

📁 **File**: [`apps/browser-extension/src/control-executor/execute.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/control-executor/execute.ts)

- **Precondition Target Name Check**:
  - **What it does**: Prevents clicking the wrong element if asynchronous rendering shifted indices.
  - **How it works**: Before clicking, extracts the DOM node's live visible text, aria labels, and title. Verifies that they match or contain the target name (e.g. `"Project Management"`). If shifted, aborts with `"target_precondition_failed"`.
- **Native Event Dispatcher**:
  - **What it does**: Bypasses synthetic click blockers on enterprise single-page applications.
  - **How it works**: Dispatches a full realistic event cascade to `document.elementFromPoint`:
    1. `PointerEvent` (`pointerdown`, `pointerup`)
    2. `MouseEvent` (`mousedown`, `mouseup`)
    3. `.click()`
    4. Keyboard fallback: Dispatches `Enter` / `Space` `KeyboardEvent` for SAP UI5 tabs.
- **Verification Polling Loop**:
  - **What it does**: Avoids false-positive timeout errors on slow pages.
  - **How it works**: Polls the DOM every 100ms for up to 3.5 seconds (35 iterations) checking for SHA-256 fingerprint changes or `aria-selected` tab state updates.

---

### E. Backend: Action Proposal & Dynamic Routing Engine

📁 **File**: [`services/api/src/routes/control-routes.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/routes/control-routes.ts)

- **Exact-Name Prioritization**:
  - **What it does**: Matches full control names instantly, avoiding word-overlap ambiguity.
- **Levenshtein Fuzzy Distance (`getEditDistance` & `queryMentionsControl`)**:
  - **What it does**: Resolves spelling typos (e.g. matching `"finace"` to `"Finance"`).
  - **How it works**: Calculates character matrix edit distance, permitting distance $\le 1$ for words $\ge 4$ chars, and $\le 2$ for words $\ge 6$ chars.
- **Stop-Word Filtering**:
  - **What it does**: Excludes conjunctions/prepositions (`"and"`, `"then"`, `"or"`, `"with"`, `"in"`, `"on"`) so words like `"and"` don't accidentally match `"Manufacturing and Supply Chain"`.
- **Lowest-Control Scroll Fallback**:
  - **What it does**: Handles virtual scrolling / lazy loading when target tiles are scrolled below the fold.
  - **How it works**: If a user asks to scroll but the target is not in the DOM yet, finds the control with the largest `rectangle.y` (the lowest visible element) and proposes scrolling to it, pulling lower tiles into the viewport.

---

### F. Backend: RAG Knowledge Search & Grounded Guidance

📁 **File**: [`services/api/src/domain/governed-knowledge-service.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/domain/governed-knowledge-service.ts)

- **`search(input, observation, identity)`**:
  - **What it does**: Executes the Retrieval-Augmented Generation (RAG) pipeline.
  - **How it works**:
    1. Filters mock ServiceNow/SharePoint SOPs by user permissions and tenant IDs.
    2. Calculates word overlap scores between query + visible text and documentation articles.
    3. Feeds the top article + sanitized DOM observation into **Gemini 3.7 Flash** to synthesize factual, grounded guidance.

---

### G. Policy & Risk Gatekeeper

📁 **File**: [`packages/policy-model/src/index.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/packages/policy-model/src/index.ts)

- **`evaluateOrigin()`**:
  - **What it does**: Restricts operation only to allowlisted enterprise origins and blocks sensitive domains (`paypal.com`, `1password.com`, `gmail.com`).
- **`isPotentiallyLowRiskControl()`**:
  - **What it does**: Enforces role and safety checks on click candidates.
  - **How it works**:
    1. Permits safe roles: `"button"`, `"link"`, `"tab"`, `"menuitem"`, `"checkbox"`, `"option"`, `"generic"`, `"heading"`, `"listitem"`.
    2. Blocklist check: Rejects any element matching destructive keywords (`delete`, `remove`, `purchase`, `pay`, `transfer`, `submit`, `reset`, `grant`, `revoke`).

---

## 3. Quick Reference: Where to Point When Asked

| If someone asks about...                     | Point them to this file:                                                                                                                                                                                     |
| :------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **How sensitive data is protected**          | [`apps/browser-extension/src/security/sanitize.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/security/sanitize.ts#L57)                |
| **How typos and spelling mistakes work**     | [`services/api/src/routes/control-routes.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/routes/control-routes.ts#L125)                           |
| **How multi-step sequential flows run**      | [`apps/browser-extension/src/sidepanel/App.tsx`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/sidepanel/App.tsx#L521)                     |
| **How the click and scroll execution works** | [`apps/browser-extension/src/control-executor/execute.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/apps/browser-extension/src/control-executor/execute.ts#L190) |
| **How high-risk actions are blocked**        | [`packages/policy-model/src/index.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/packages/policy-model/src/index.ts#L233)                                         |
| **How the RAG knowledge search works**       | [`services/api/src/domain/governed-knowledge-service.ts`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/services/api/src/domain/governed-knowledge-service.ts#L139)   |
| **Third-party libraries explanation**        | [`docs/LIBRARIES_GUIDE.md`](file:///c:/Users/satwik.dhavle/Downloads/AERemoteSupportAgentv3/AERemoteSupportAgent/docs/LIBRARIES_GUIDE.md)                                                                    |
