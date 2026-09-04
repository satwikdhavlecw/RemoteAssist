import type { SafeControl } from "@remoteassist/shared-types";
import { sha256Hex } from "./sha256.js";

const sensitiveAutocompleteTokens = [
  "current-password",
  "new-password",
  "one-time-code",
  "cc-name",
  "cc-number",
  "cc-exp",
  "cc-csc",
];

const sensitiveTextPattern =
  /password|passcode|one[ -]?time|\botp\b|credit card|card number|\bcvv\b|security code|private key|secret|access token|bank account|routing number|payment/i;

const secretValuePattern =
  /(?:bearer\s+[a-z0-9._~-]+)|(?:eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,})|(?:api[_ -]?key\s*[:=])/i;

const observableTextSelector =
  "h1, h2, h3, h4, h5, [role='heading'], [role='alert'], [role='status'], p, li, td, th, dt, dd, [role='cell'], [role='gridcell']";
const MAX_SAFE_VISIBLE_TEXT_ITEMS = 300;
const MAX_SAFE_VISIBLE_TEXT_CHARS = 1500;
const MAX_FINGERPRINT_INPUT_CHARS = 200_000;
const controlSelector =
  "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='option'], [role='alert'], [role='status'], [tabindex]:not([tabindex='-1']), h1, h2, h3, h4, h5, [role='heading'], section[aria-label], [role='region'][aria-label]";
const navigationContainerSelector =
  "nav, header, [role='navigation'], [role='menubar'], [role='tablist'], [class*='nav'], [class*='navigation'], [class*='header'], [class*='menu'], [class*='tab']";
const safeNavigationLabelPattern =
  /^(?:all|favorites|history|workspaces?|admin|settings|preferences|home|dashboard|documentation|help|incidents?|tax|payment|purchasing document references|g\/l account items|general information|supplier invoice|create supplier invoice)$/i;

export interface BrowserObservationPayload {
  origin: string;
  page_title: string;
  page_fingerprint: string;
  application: string | null;
  screen_state: string | null;
  visible_text: string[];
  controls: SafeControl[];
  sensitive_content: boolean;
  confidence: number;
}

function associatedLabelText(element: Element): string {
  const values = [
    element.getAttribute("aria-label"),
    element.getAttribute("name"),
    element.getAttribute("placeholder"),
    element.getAttribute("autocomplete"),
  ];
  if (element instanceof HTMLInputElement && element.labels) {
    values.push(...Array.from(element.labels, (label) => label.textContent));
  }
  return values.filter(Boolean).join(" ");
}

export function isSensitiveElement(element: Element): boolean {
  if (element.closest("[data-remoteassist-sensitive='true']")) return true;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === "password" || type === "hidden") return true;
    const autocomplete = element.autocomplete.toLowerCase();
    if (
      sensitiveAutocompleteTokens.some((token) => autocomplete.includes(token))
    )
      return true;
  }
  return sensitiveTextPattern.test(associatedLabelText(element));
}

export function isVisibleElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.getAttribute("aria-hidden") === "true")
    return false;
  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  )
    return false;
  return element.getClientRects().length > 0;
}

function controlRole(element: Element): string {
  if (element.getAttribute("data-remoteassist-navigation") === "true") {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) return explicitRole;
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLAnchorElement) return "link";
    return "link";
  }
  const explicitRole = element.getAttribute("role");
  if (explicitRole) return explicitRole;
  if (element instanceof HTMLButtonElement) return "button";
  if (element instanceof HTMLAnchorElement) return "link";
  if (element instanceof HTMLSelectElement) return "combobox";
  if (element instanceof HTMLTextAreaElement) return "textbox";
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    return "textbox";
  }
  if (/^h[1-6]$/i.test(element.tagName)) return "heading";
  if (element.tagName.toLowerCase() === "section") return "region";
  return element.tagName.toLowerCase();
}

function normalizedText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function allElements(root: Document | ShadowRoot): Element[] {
  const elements = [...root.querySelectorAll("*")];
  for (const element of elements) {
    if (element.shadowRoot) elements.push(...allElements(element.shadowRoot));
  }
  return elements;
}

function navigationCandidates(documentRoot: Document): Element[] {
  const candidates: Element[] = [];
  for (const element of allElements(documentRoot)) {
    const name = normalizedText(element);
    if (
      !safeNavigationLabelPattern.test(name) ||
      !isVisibleElement(element) ||
      isSensitiveElement(element)
    ) {
      continue;
    }

    const hasSameTextChild = Array.from(element.children).some(
      (child) => normalizedText(child) === name,
    );
    if (hasSameTextChild) continue;

    const likelyInteractive = element.matches(
      "a, button, [role], [tabindex], [onclick], [ng-click], [data-action], [data-target], [data-toggle]",
    );
    if (!likelyInteractive && !element.closest(navigationContainerSelector)) {
      // Exact known navigation labels are still eligible when a framework
      // renders them outside a semantic navigation container.
      if (!safeNavigationLabelPattern.test(name)) continue;
    }

    const target =
      element.closest(
        "a, button, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [tabindex], [onclick], [ng-click], [data-action], [data-target], [data-toggle]",
      ) ?? element;
    target.setAttribute("data-remoteassist-navigation", "true");
    if (!candidates.includes(target)) candidates.push(target);
  }
  return candidates;
}

function accessibleName(element: Element): string {
  // 1. aria-labelledby takes top precedence per AccName 1.2
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) return text.slice(0, 300);
  }

  // 2. aria-label takes precedence over inner text
  const ariaLabel = element
    .getAttribute("aria-label")
    ?.replace(/\s+/g, " ")
    .trim();
  if (ariaLabel) return ariaLabel.slice(0, 300);

  // 3. Associated label (for inputs, selects, textareas)
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const label = associatedLabelText(element).replace(/\s+/g, " ").trim();
    if (label) return label.slice(0, 300);
  }

  // 4. If container element has interactive children, do not concatenate child text
  const hasInteractiveChildren =
    element.children.length > 0 &&
    Boolean(
      element.querySelector(
        "button, a, [role='button'], [role='tab'], [role='link'], [role='menuitem'], input, select, textarea",
      ),
    );
  if (hasInteractiveChildren) {
    const title = element.getAttribute("title")?.trim();
    return title ? title.slice(0, 300) : "";
  }

  // 5. If element contains a heading child (e.g. Fiori tile, dashboard card), use the heading as its primary accessible name
  const headingChild = element.querySelector(
    "h1, h2, h3, h4, h5, h6, [role='heading']",
  );
  if (headingChild) {
    const headingText = (headingChild.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (headingText) return headingText.slice(0, 300);
  }

  // 6. Visible text content of element
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 300);

  // 7. Title attribute fallback
  const title = element.getAttribute("title")?.trim();
  return title ? title.slice(0, 300) : "";
}

function safeVisibleText(documentRoot: Document): string[] {
  const unique = new Set<string>();
  for (const element of documentRoot.querySelectorAll(observableTextSelector)) {
    if (
      !isVisibleElement(element) ||
      isSensitiveElement(element) ||
      element.closest("[data-remoteassist-sensitive='true']")
    ) {
      continue;
    }
    const text = (element.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_SAFE_VISIBLE_TEXT_CHARS);
    if (text && !secretValuePattern.test(text)) unique.add(text);
    if (unique.size >= MAX_SAFE_VISIBLE_TEXT_ITEMS) break;
  }
  return [...unique];
}

function safeControls(documentRoot: Document): SafeControl[] {
  const controls: SafeControl[] = [];
  const navigation = navigationCandidates(documentRoot);
  const elements = [
    ...navigation,
    ...allElements(documentRoot).filter(
      (element) =>
        element.matches(controlSelector) && !navigation.includes(element),
    ),
  ];
  for (const [index, element] of elements.entries()) {
    if (!isVisibleElement(element) || isSensitiveElement(element)) continue;
    const name = accessibleName(element);
    if (!name || secretValuePattern.test(name)) continue;
    const htmlElement = element as HTMLElement;
    const elementId = htmlElement.dataset.remoteassistId ?? `ra-${index + 1}`;
    htmlElement.dataset.remoteassistId = elementId;
    const rectangle = htmlElement.getBoundingClientRect();
    controls.push({
      elementId,
      role: controlRole(element),
      name,
      disabled:
        element.getAttribute("aria-disabled") === "true" ||
        ("disabled" in htmlElement &&
          Boolean((htmlElement as HTMLButtonElement).disabled)),
      rectangle: {
        x: rectangle.x,
        y: rectangle.y,
        width: rectangle.width,
        height: rectangle.height,
      },
    });
    if (controls.length >= 300) break;
  }
  return controls;
}

async function fingerprint(values: string[]): Promise<string> {
  const normalized = values.join("\n").slice(0, MAX_FINGERPRINT_INPUT_CHARS);
  return `sha256:${sha256Hex(normalized)}`;
}

function cleanApplicationCandidate(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (
    normalized.length < 2 ||
    sensitiveTextPattern.test(normalized) ||
    secretValuePattern.test(normalized)
  ) {
    return null;
  }
  const withoutPagePurpose = normalized
    .replace(
      /\s*(?:[-|:–—]\s*)?(?:sign[ -]?in|log[ -]?in|login|authentication)\s*$/i,
      "",
    )
    .trim();
  if (
    withoutPagePurpose.length < 2 ||
    /^(?:sign[ -]?in|log[ -]?in|login|home|welcome)$/i.test(withoutPagePurpose)
  ) {
    return null;
  }
  return withoutPagePurpose;
}

function detectApplication(documentRoot: Document): string | null {
  const candidates = [
    documentRoot
      .querySelector("meta[name='application-name']")
      ?.getAttribute("content") ?? null,
    documentRoot
      .querySelector("meta[property='og:site_name']")
      ?.getAttribute("content") ?? null,
    documentRoot.title,
    documentRoot.querySelector("h1, [role='heading'][aria-level='1']")
      ?.textContent ?? null,
  ];
  for (const candidate of candidates) {
    const cleaned = cleanApplicationCandidate(candidate);
    if (cleaned) return cleaned;
  }
  return cleanApplicationCandidate(documentRoot.location.hostname);
}

export async function sanitizeDocument(
  documentRoot: Document = document,
): Promise<BrowserObservationPayload> {
  const visibleText = safeVisibleText(documentRoot);
  const controls = safeControls(documentRoot);
  const sensitiveContent = [
    ...documentRoot.querySelectorAll(
      "input, textarea, select, [data-remoteassist-sensitive]",
    ),
  ].some(isSensitiveElement);
  const textSummary = visibleText.join(" ").toLowerCase();
  const screenState = textSummary.includes("saml authentication failed")
    ? "saml_login_error"
    : null;
  const origin = documentRoot.location.origin;
  const pageTitle = documentRoot.title.slice(0, 500);
  return {
    origin,
    page_title: pageTitle,
    page_fingerprint: await fingerprint([
      origin,
      pageTitle,
      ...visibleText,
      ...controls.map(
        (control) => `${control.role}:${control.name}:${control.disabled}`,
      ),
    ]),
    application: detectApplication(documentRoot),
    screen_state: screenState,
    visible_text: visibleText,
    controls,
    sensitive_content: sensitiveContent,
    confidence: screenState ? 0.94 : 0.7,
  };
}
