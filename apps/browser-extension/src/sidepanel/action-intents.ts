import {
  isHigherRiskActionIntent,
  isHigherRiskControlName,
  isPotentiallyLowRiskAction,
} from "@remoteassist/policy-model";
import type { SafeControl } from "@remoteassist/shared-types";
import type { RealtimeActionProposal } from "./realtime-actions.js";

const navigationWords = new Set([
  "open",
  "go",
  "to",
  "navigate",
  "view",
  "show",
  "click",
  "select",
  "take",
  "bring",
  "me",
  "page",
  "tab",
  "section",
  "for",
  "the",
  "a",
  "an",
  "down",
  "up",
  "scroll",
]);

function queryMentionsControl(query: string, controlName: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const normalizedName = controlName.toLowerCase().trim();
  const requestedWords = normalizedQuery
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !navigationWords.has(word));
  return (
    normalizedQuery.includes(normalizedName) ||
    normalizedName
      .split(/\s+/)
      .some(
        (word) =>
          word.length >= 4 &&
          !navigationWords.has(word) &&
          requestedWords.includes(word),
      )
  );
}

function actionForRequest(
  query: string,
  controlRole?: string,
): RealtimeActionProposal["actionType"] | null {
  if (
    /\bscroll(?:\s+(?:down|up))?(?:\s+to)?\b/i.test(query) ||
    /\b(?:move|go)\s+(?:down|up)\b/i.test(query)
  ) {
    return "SCROLL_TO_ELEMENT";
  }
  if (/\b(focus|enter|type|fill|input|provide)\b/i.test(query) && !/\b(reset|clear)\b/i.test(query)) {
    if (
      controlRole &&
      ["textbox", "combobox", "searchbox"].includes(controlRole.toLowerCase())
    ) {
      return "FOCUS_ELEMENT";
    }
  }
  if (
    /\b(open|go\s+to|navigate(?:\s+to)?|take\s+me\s+to|bring\s+me\s+to|view|show|click(?:\s+on)?|select|access|check|inspect|unlock|release|clear|reset|request|override)\b/i.test(
      query,
    )
  ) {
    if (
      controlRole &&
      ["region", "heading", "generic", "section", "alert", "status"].includes(
        controlRole.toLowerCase(),
      )
    ) {
      return "SCROLL_TO_ELEMENT";
    }
    return "CLICK_ELEMENT";
  }
  return null;
}

export function deterministicActionProposal(
  query: string,
  controls: SafeControl[],
): RealtimeActionProposal | null {
  const cleanedTarget = query
    .replace(
      /^\s*(?:how\s+do\s+i\s+)?(?:can\s+you\s+)?(?:open|go\s+to|navigate(?:\s+to)?|take\s+me\s+to|bring\s+me\s+to|view|show|click(?:\s+on)?|select|access|check|inspect|unlock|release|clear|reset|request|override|focus|enter|fill)\s+(?:an?\s+)?(?:the\s+)?/i,
      "",
    )
    .trim()
    .toLowerCase();

  // If the query targets or requests an action on a control that is higher-risk / blocked by policy:
  // Do NOT fall back to proposing random buttons or inputs!
  const hasHigherRiskTarget = controls.some((c) => {
    const normName = c.name.toLowerCase().trim();
    const isTargeted =
      (cleanedTarget.length >= 3 && (normName === cleanedTarget || normName.includes(cleanedTarget) || cleanedTarget.includes(normName))) ||
      (queryMentionsControl(query, c.name) && isHigherRiskActionIntent(query)) ||
      (normName === "reset" && /\breset\b/i.test(query));
    return isTargeted && isHigherRiskControlName(c.name);
  });

  if (hasHigherRiskTarget) {
    return null;
  }

  const scored = controls
    .map((control) => {
      const actionType = actionForRequest(query, control.role);
      if (!actionType || !isPotentiallyLowRiskAction(actionType, control)) {
        return null;
      }
      const name = control.name.toLowerCase().trim();
      let score = 0;
      if (/\b(?:unlock|release\s+lock|clear\s+lock)\b/i.test(query)) {
        if (name === "unlock") {
          score = 150;
        } else if (/\b(?:unlock|simulate\s+lock\s+clearance|release\s+lock)\b/i.test(name)) {
          score = 120;
        }
      }
      if (/\b(?:reset|clear\s+form|reset\s+form)\b/i.test(query)) {
        if (name === "reset" || name === "reset form") {
          score = 150;
        } else if (/\b(?:reset|clear\s+form)\b/i.test(name)) {
          score = 120;
        }
      }
      if (score === 0) {
        if (name === cleanedTarget) {
          score = 100;
        } else if (name.startsWith(cleanedTarget) || cleanedTarget.startsWith(name)) {
          score = 80;
        } else if (name.includes(cleanedTarget)) {
          score = 60;
        } else if (cleanedTarget.includes(name)) {
          score = 50;
        } else if (queryMentionsControl(query, control.name)) {
          const stopWords = new Set(["how", "can", "you", "the", "for", "this", "that", "and", "with", "please", "help"]);
          const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
          const ctrlWords = name.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
          const overlap = queryWords.filter((w) => ctrlWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
          score = overlap * 10;
          if (actionType === "CLICK_ELEMENT" && ["button", "link"].includes(control.role.toLowerCase())) {
            score += 5;
          }
        }
      }
      return score > 0 ? { control, actionType, score } : null;
    })
    .filter((item): item is { control: SafeControl; actionType: RealtimeActionProposal["actionType"]; score: number } => item !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const top = scored[0]!;
  if (scored.length > 1 && top.score === scored[1]!.score) {
    // Ambiguous match between multiple equally-scored controls
    return null;
  }

  const { control, actionType } = top;
  const actionVerb =
    actionType === "SCROLL_TO_ELEMENT"
      ? "Scroll to"
      : actionType === "FOCUS_ELEMENT"
        ? "Focus"
        : "Click";
  return {
    callId: `local_${crypto.randomUUID()}`,
    controlName: control.name,
    controlRole: control.role,
    actionType,
    purpose: `${actionVerb} ${control.name} after your approval.`,
  };
}
