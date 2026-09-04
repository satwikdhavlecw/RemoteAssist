import type {
  CommandResult,
  ControlCommand,
} from "@remoteassist/command-schema";
import {
  isSensitiveElement,
  isVisibleElement,
  sanitizeDocument,
} from "../security/sanitize.js";

export interface BrowserExecutionResponse {
  result: CommandResult;
  observation: Awaited<ReturnType<typeof sanitizeDocument>>;
}

function allElements(root: Document | ShadowRoot): Element[] {
  const elements = [...root.querySelectorAll("*")];
  for (const element of elements) {
    if (element.shadowRoot) elements.push(...allElements(element.shadowRoot));
  }
  return elements;
}

function blockedResult(
  command: ControlCommand,
  startedAt: string,
  failureCode: string,
  elementFound = false,
): CommandResult {
  return {
    command_id: command.command_id,
    status: "blocked",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    result: {
      element_found: elementFound,
      action_dispatched: false,
      page_changed: false,
      verification_result: "not_requested",
      failure_code: failureCode,
    },
  };
}

function singleInteractionState(element: Element): string {
  return [
    element.getAttribute("aria-selected"),
    element.getAttribute("aria-expanded"),
    element.getAttribute("data-state"),
    element.getAttribute("aria-current"),
    element.getAttribute("tabindex"),
    element.getAttribute("class"),
  ].join("|");
}

function interactionState(element: HTMLElement): string {
  const tablist = element.closest("[role='tablist']");
  return [
    singleInteractionState(element),
    ...(tablist
      ? Array.from(
          tablist.querySelectorAll("[role='tab']"),
          singleInteractionState,
        )
      : []),
  ].join("||");
}

function clickDispatchTarget(element: HTMLElement): HTMLElement {
  if (typeof document.elementFromPoint !== "function") return element;
  const rectangle = element.getBoundingClientRect();
  const hit = document.elementFromPoint(
    rectangle.left + rectangle.width / 2,
    rectangle.top + rectangle.height / 2,
  );
  if (!(hit instanceof HTMLElement) || !element.contains(hit)) return element;
  const interactiveAncestor = hit.closest(
    "button, a, [role='button'], [role='tab'], [role='menuitem']",
  );
  return interactiveAncestor instanceof HTMLElement &&
    element.contains(interactiveAncestor)
    ? interactiveAncestor
    : element;
}

function dispatchNativePointerActivation(element: HTMLElement): void {
  const rectangle = element.getBoundingClientRect();
  const left = rectangle.left ?? rectangle.x;
  const top = rectangle.top ?? rectangle.y;
  const eventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: left + rectangle.width / 2,
    clientY: top + rectangle.height / 2,
    button: 0,
    buttons: 1,
  };
  if (typeof PointerEvent === "function") {
    element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  }
  element.dispatchEvent(new MouseEvent("mousedown", eventInit));
  if (typeof PointerEvent === "function") {
    element.dispatchEvent(
      new PointerEvent("pointerup", { ...eventInit, buttons: 0 }),
    );
  }
  element.dispatchEvent(
    new MouseEvent("mouseup", { ...eventInit, buttons: 0 }),
  );
  element.click();
}

async function dispatchApprovedClick(
  element: HTMLElement,
  role: string,
  initialState: string,
): Promise<void> {
  const dispatchTarget = clickDispatchTarget(element);
  dispatchNativePointerActivation(dispatchTarget);

  const tileAncestor = element.closest<HTMLElement>(
    "[tabindex='0'], .sapMGTI, .sapUshellTile, [role='button'], [role='link']",
  );
  if (tileAncestor && tileAncestor !== dispatchTarget) {
    dispatchNativePointerActivation(tileAncestor);
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  if (interactionState(element) !== initialState) return;

  const keyboardTarget = tileAncestor ?? dispatchTarget;
  keyboardTarget.focus({ preventScroll: true });
  for (const key of ["Enter", " "]) {
    keyboardTarget.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: key === " " ? "Space" : "Enter",
        keyCode: key === " " ? 32 : 13,
        which: key === " " ? 32 : 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    keyboardTarget.dispatchEvent(
      new KeyboardEvent("keyup", {
        key,
        code: key === " " ? "Space" : "Enter",
        keyCode: key === " " ? 32 : 13,
        which: key === " " ? 32 : 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

export async function executeBrowserCommand(
  command: ControlCommand,
): Promise<BrowserExecutionResponse> {
  const startedAt = new Date().toISOString();
  const before = await sanitizeDocument();

  if (
    command.execution_status !== "authorized" ||
    command.approval_status !== "approved"
  ) {
    return {
      result: blockedResult(command, startedAt, "authorization_missing"),
      observation: before,
    };
  }
  if (new Date(command.expires_at).getTime() <= Date.now()) {
    return {
      result: blockedResult(command, startedAt, "command_expired"),
      observation: before,
    };
  }
  if (before.origin !== new URL(command.expected_page.origin).origin) {
    return {
      result: blockedResult(command, startedAt, "origin_changed"),
      observation: before,
    };
  }
  if (before.page_fingerprint !== command.expected_page.page_fingerprint) {
    return {
      result: blockedResult(command, startedAt, "page_fingerprint_changed"),
      observation: before,
    };
  }

  const resolvedTarget = allElements(document).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.dataset.remoteassistId === command.target.element_id,
  );
  if (!resolvedTarget) {
    return {
      result: blockedResult(command, startedAt, "target_not_found"),
      observation: before,
    };
  }
  if (!isVisibleElement(resolvedTarget) || isSensitiveElement(resolvedTarget)) {
    return {
      result: blockedResult(
        command,
        startedAt,
        "target_sensitive_or_hidden",
        true,
      ),
      observation: before,
    };
  }
  const observedTarget = before.controls.find(
    (control) => control.elementId === command.target.element_id,
  );
  const resolvedText = (resolvedTarget.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const targetName = command.target.name.toLowerCase().trim();
  const ariaLabel = (resolvedTarget.getAttribute("aria-label") ?? "")
    .toLowerCase()
    .trim();
  const ariaLabelledBy = (resolvedTarget.getAttribute("aria-labelledby") ?? "")
    .toLowerCase()
    .trim();
  const title = (resolvedTarget.getAttribute("title") ?? "")
    .toLowerCase()
    .trim();
  const placeholder = (resolvedTarget.getAttribute("placeholder") ?? "")
    .toLowerCase()
    .trim();

  const nameMatches =
    resolvedText.includes(targetName) ||
    targetName.includes(resolvedText) ||
    ariaLabel.includes(targetName) ||
    ariaLabelledBy.includes(targetName) ||
    title.includes(targetName) ||
    placeholder.includes(targetName);

  if (!observedTarget || observedTarget.disabled || !nameMatches) {
    return {
      result: blockedResult(
        command,
        startedAt,
        "target_precondition_failed",
        true,
      ),
      observation: before,
    };
  }

  const observedInteractionState = interactionState(resolvedTarget);
  if (command.type === "CLICK_ELEMENT")
    await dispatchApprovedClick(
      resolvedTarget,
      observedTarget.role,
      observedInteractionState,
    );
  else if (command.type === "FOCUS_ELEMENT")
    (resolvedTarget as HTMLElement).focus({ preventScroll: true });
  else if (command.type === "SCROLL_TO_ELEMENT") {
    (resolvedTarget as HTMLElement).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  } else {
    return {
      result: blockedResult(
        command,
        startedAt,
        "command_type_not_enabled",
        true,
      ),
      observation: before,
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  let after = await sanitizeDocument();
  let pageChanged = after.page_fingerprint !== before.page_fingerprint;
  let tabStateChanged =
    observedTarget.role.toLowerCase() === "tab" &&
    interactionState(resolvedTarget) !== observedInteractionState;
  const expected = command.expected_text?.toLowerCase() ?? null;

  if (
    observedTarget.role.toLowerCase() === "tab" &&
    !(pageChanged || tabStateChanged)
  ) {
    for (let i = 0; i < 35; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = await sanitizeDocument();
      pageChanged = after.page_fingerprint !== before.page_fingerprint;
      tabStateChanged =
        interactionState(resolvedTarget) !== observedInteractionState;
      if (pageChanged || tabStateChanged) {
        break;
      }
    }
  } else if (
    expected &&
    !after.visible_text.some((text) => text.toLowerCase().includes(expected))
  ) {
    for (let i = 0; i < 35; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = await sanitizeDocument();
      if (
        after.visible_text.some((text) => text.toLowerCase().includes(expected))
      ) {
        break;
      }
    }
  }

  const verificationResult = expected
    ? after.visible_text.some((text) => text.toLowerCase().includes(expected))
      ? "passed"
      : "failed"
    : observedTarget.role.toLowerCase() === "tab"
      ? pageChanged || tabStateChanged
        ? "passed"
        : "failed"
      : "not_requested";
  return {
    result: {
      command_id: command.command_id,
      status: "executed",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      result: {
        element_found: true,
        action_dispatched: true,
        page_changed: pageChanged,
        verification_result: verificationResult,
        failure_code: null,
      },
    },
    observation: after,
  };
}
