# ADR 0021: Grounded investigative intent classification and dynamic navigation discovery

Date: 2026-09-02

Status: accepted

## Context

Users frequently ask diagnostic and investigative questions such as *"Purchase order 4500068938 is locked by user in manage purchase orders can you check and tell me whats wrong"*, *"why is X happening"*, or *"look into Y for me"*.

Under earlier iterations, these queries were classified as purely advisory or informational because they lacked explicit imperative command verbs (e.g. "click", "open") referencing literal control names present on the current screen. As a result, the system produced text-only advice without offering an actionable browser navigation path, even when a clear enterprise navigation control (such as SAP's "Procurement" tab) was visible on the screen.

Attempting to solve this by guessing an entire 3-to-5 step plan upfront with hardcoded destination control names creates an unacceptable risk: hallucinating control names for screens that have not loaded yet. Furthermore, embedding application-specific mapping branches directly into HTTP route handlers creates brittle, unmaintainable code.

## Decision

1. **Investigative Intent Classification**:
   - Diagnostic phrasing (`"check"`, `"look into"`, `"what's wrong with"`, `"why is"`, `"tell me what's happening with"`) is classified as an implied navigation request to get the user to where that information or record lives, provided a plausible navigation control exists on the active page.
   - If no plausible navigation control exists on the current page, the system does not force or fabricate an action plan; it cleanly falls back to text-only guidance.

2. **Grounded Upfront Generation**:
   - Initial resolution plans propose **only** steps whose target controls are present and verified in the **current** page observation (`observation.controls`). For example, on the SAP Home page, Step 1 proposes `CLICK_ELEMENT` on the real, observed `"Procurement"` tab (`grounded: true`).
   - Unobserved control names for future destination screens are never invented upfront.
   - Every step carries a `grounded: boolean` attribute in both runtime models and `PLAN_PROPOSED` audit logs, guaranteeing full audit trail honesty.

3. **Dynamic Discovery on Landing Observation**:
   - When Step 1 completes, the live `ControlPanel` execution loop waits for the landing page DOM to stabilize and captures a fresh observation.
   - All safety gates are re-evaluated immediately: pre-discovery abort checks, landing origin invariance check (`landing.origin === session.origin`), and session validity.
   - If the user clicks "Stop plan execution" at any moment during Step 1 or while waiting for the landing observation, execution aborts immediately: Step 2 is **never** queried, proposed, or executed.
   - Against the real landing observation, the system discovers the next grounded step (e.g. clicking `Manage Purchase Orders` or `FOCUS_ELEMENT` on the search textbox).
   - The total chain remains strictly bounded by `MAX_RESOLUTION_PLAN_STEPS = 5`.

4. **Isolated Domain Navigation Fallback Table**:
   - Hardcoded enterprise domain mappings (e.g., purchase orders $\rightarrow$ Procurement, sales orders $\rightarrow$ Sales, invoices $\rightarrow$ Finance) are isolated into [`domain-navigation-map.ts`](../../services/api/src/domain/domain-navigation-map.ts).
   - This table serves strictly as a narrow deterministic fallback for when LLM classification is unconfigured or unavailable. General intent classification is driven by the LLM proposer layer with enhanced grounding and diagnostic prompts.

5. **Search Input Focus Without Form-Filling**:
   - When arriving at a destination screen, the final step may propose `FOCUS_ELEMENT` on an eligible `textbox` or `combobox` search input.
   - No `TYPE_TEXT`, `FILL_FIELD`, or form-entry governed action is added. The system places the user's cursor directly into the search field, leaving data entry under human control.

6. **Strict Truthfulness in Plan and Guidance Wording**:
   - Model prompts and plan explanations are prohibited from claiming or implying that a record was checked or diagnosed (e.g., forbidden: *"I checked purchase order 4500068938"* or *"Here is what is wrong with it"*).
   - Honest wording explains the navigation taking place:
     *"I've navigated you to Manage Purchase Orders — search for 4500068938 there and I can help interpret what you see."*

7. **Audit Attribution for Discovered Steps (`PLAN_STEP_DISCOVERED`)**:
   - When dynamic discovery queries the backend for subsequent steps against landing observations, the client supplies `discoveryPlanId` bound to the original approved `planId` and sets `trigger: "discovery"`.
   - The backend logs `PLAN_STEP_DISCOVERED` carrying the original `planId`, suppressing redundant `PLAN_PROPOSED` and `MODEL_ACTION_PROPOSED` events.
   - This ensures exactly one top-level `PLAN_PROPOSED` entry exists per approved multi-step plan, maintaining an unambiguous audit chain from proposal through discovery, per-step execution, and final completion with zero orphaned proposal records.

## Consequences

- Casual and investigative user queries automatically surface safe navigation plans when plausible controls exist.
- Plans remain 100% grounded in real DOM observations at every step, eliminating hallucinated future targets.
- All safety guarantees (abort flags, origin invariance, session expiry, live risk gates) apply uniformly to dynamically discovered steps without separate bypass paths.
- Audit trails clearly link discovered steps directly to the approved parent plan via `PLAN_STEP_DISCOVERED`, completely preventing orphaned proposal events.
- Wording remains strictly truthful, maintaining user trust and regulatory compliance.
