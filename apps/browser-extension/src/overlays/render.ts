import { isSensitiveElement } from "../security/sanitize.js";

const hostId = "remoteassist-overlay-host";

function allElements(root: Document | ShadowRoot): Element[] {
  const elements = [...root.querySelectorAll("*")];
  for (const element of elements) {
    if (element.shadowRoot) elements.push(...allElements(element.shadowRoot));
  }
  return elements;
}

export function clearOverlay(): void {
  document.getElementById(hostId)?.remove();
}

export function highlightElement(
  elementId: string,
  message: string,
  step = 1,
): boolean {
  clearOverlay();
  const target = allElements(document).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.dataset.remoteassistId === elementId,
  );
  if (!target || isSensitiveElement(target)) return false;

  target.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
  const rectangle = target.getBoundingClientRect();
  const width =
    rectangle.width > 0 ? rectangle.width : target.offsetWidth || 120;
  const height =
    rectangle.height > 0 ? rectangle.height : target.offsetHeight || 40;
  const left = rectangle.left > 0 ? rectangle.left : target.offsetLeft;
  const top = rectangle.top > 0 ? rectangle.top : target.offsetTop;

  const host = document.createElement("div");
  host.id = hostId;
  host.setAttribute("aria-hidden", "true");
  const root = host.attachShadow({ mode: "closed" });
  const frame = document.createElement("div");
  frame.style.cssText = [
    "position:fixed",
    `left:${Math.max(4, left - 5)}px`,
    `top:${Math.max(4, top - 5)}px`,
    `width:${width + 10}px`,
    `height:${height + 10}px`,
    "border:3px solid #7c3aed",
    "border-radius:10px",
    "box-shadow:0 0 0 5px rgba(124,58,237,.18)",
    "pointer-events:none",
    "z-index:2147483647",
    "box-sizing:border-box",
  ].join(";");
  const tooltip = document.createElement("div");
  tooltip.textContent = `${step}. ${message.slice(0, 240)}`;
  tooltip.style.cssText = [
    "position:absolute",
    "left:0",
    "bottom:calc(100% + 10px)",
    "max-width:320px",
    "padding:10px 12px",
    "border-radius:9px",
    "background:#21143f",
    "color:white",
    "font:600 13px/1.35 system-ui,sans-serif",
    "box-shadow:0 8px 26px rgba(20,10,40,.28)",
    "white-space:normal",
  ].join(";");
  frame.append(tooltip);
  root.append(frame);
  document.documentElement.append(host);
  return true;
}
