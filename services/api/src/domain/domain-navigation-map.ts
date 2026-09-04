import { isPotentiallyLowRiskAction } from "@remoteassist/policy-model";
import type { SafeControl } from "@remoteassist/shared-types";

export interface DomainNavigationFallback {
  readonly domainName: string;
  readonly keywords: readonly string[];
  readonly plausibleControlNames: readonly string[];
  readonly destinationDescription: string;
  readonly destinationSearchKeywords: readonly string[];
}

/**
 * Isolated domain navigation fallback table.
 * NOTE: This is a narrow fallback patch for when the primary LLM classification
 * path is unavailable or unconfigured. General intent classification is handled
 * by the LLM proposer layer (see docs/decisions/0021-grounded-investigative-navigation-plans.md).
 */
export const ENTERPRISE_DOMAIN_NAVIGATION_FALLBACKS: readonly DomainNavigationFallback[] = [
  {
    domainName: "Procurement",
    keywords: [
      "purchase order",
      "purchase orders",
      "po",
      "procurement",
      "procure",
      "vendor",
      "supplier",
      "requisition",
    ],
    plausibleControlNames: [
      "Create Purchase Order",
      "Manage Purchase Orders",
      "Procurement",
    ],
    destinationDescription: "Manage Purchase Orders area",
    destinationSearchKeywords: ["search", "purchase order", "filter", "supplier"],
  },
  {
    domainName: "Sales",
    keywords: [
      "sales order",
      "sales orders",
      "customer order",
      "quotation",
      "shipment",
      "sales",
    ],
    plausibleControlNames: ["Sales", "Manage Sales Orders"],
    destinationDescription: "Manage Sales Orders area",
    destinationSearchKeywords: ["search", "sales order", "filter"],
  },
  {
    domainName: "Finance",
    keywords: [
      "invoice",
      "invoices",
      "supplier invoice",
      "billing",
      "payment",
      "general ledger",
      "gl",
      "accounts payable",
      "finance",
    ],
    plausibleControlNames: [
      "Finance",
      "Create Supplier Invoice",
      "Manage Invoices",
    ],
    destinationDescription: "Finance & Invoicing area",
    destinationSearchKeywords: ["search", "invoice", "filter"],
  },
  {
    domainName: "Manufacturing",
    keywords: [
      "work order",
      "production order",
      "manufacturing",
      "supply chain",
      "inventory",
      "plant",
    ],
    plausibleControlNames: ["Manufacturing and Supply Chain", "Production"],
    destinationDescription: "Manufacturing & Supply Chain area",
    destinationSearchKeywords: ["search", "order", "filter"],
  },
];

export function isInvestigativeQuery(query: string): boolean {
  return /\b(?:can\s+you\s+)?(?:check(?:\s+into)?|look\s+into|what(?:'s|\s+is)\s+(?:wrong|happening)\s+with|why\s+is|what(?:'s|\s+is)\s+going\s+on\s+with|diagnose|troubleshoot|inspect|find\s+out)\b/i.test(
    query,
  );
}

export function findGroundedPlausibleControl(
  query: string,
  controls: readonly SafeControl[],
): { control: SafeControl; destination: string; fallback: DomainNavigationFallback } | null {
  const normQuery = query.toLowerCase();

  for (const fallback of ENTERPRISE_DOMAIN_NAVIGATION_FALLBACKS) {
    const matchesKeyword = fallback.keywords.some((kw) =>
      normQuery.includes(kw),
    );
    if (!matchesKeyword) continue;

    const eligibleControls = controls.filter((c) =>
      isPotentiallyLowRiskAction("CLICK_ELEMENT", c),
    );

    const scoredCandidates: Array<{
      control: SafeControl;
      destination: string;
      fallback: DomainNavigationFallback;
      score: number;
    }> = [];

    for (const plausibleName of fallback.plausibleControlNames) {
      const match = eligibleControls.find(
        (c) =>
          c.name.toLowerCase() === plausibleName.toLowerCase() ||
          c.name.toLowerCase().startsWith(plausibleName.toLowerCase()),
      );
      if (!match) continue;

      let score = 0;
      const normName = plausibleName.toLowerCase();

      // Highest priority: user query explicitly mentions this specific control!
      // e.g. "in manage purchase orders" -> matches "Manage Purchase Orders" (+100)
      if (normQuery.includes(normName)) {
        score += 100;
      }

      // Deeper / destination controls (buttons, links, tiles) take priority over high-level tabs
      // so we don't propose clicking the tab the user is already on
      if (match.role.toLowerCase() !== "tab") {
        score += 50;
      }
      score += normName.length;

      scoredCandidates.push({
        control: match,
        destination: fallback.destinationDescription,
        fallback,
        score,
      });
    }

    if (scoredCandidates.length > 0) {
      scoredCandidates.sort((a, b) => b.score - a.score);
      return scoredCandidates[0]!;
    }
  }

  return null;
}

export function findGroundedSearchInput(
  controls: readonly SafeControl[],
  searchKeywords: readonly string[] = ["search", "filter", "find", "input"],
): SafeControl | null {
  for (const c of controls) {
    const role = c.role.toLowerCase();
    if (["textbox", "combobox", "searchbox"].includes(role)) {
      if (!isPotentiallyLowRiskAction("FOCUS_ELEMENT", c)) continue;
      const normName = c.name.toLowerCase();
      if (
        searchKeywords.some((kw) => normName.includes(kw)) ||
        normName.length > 0
      ) {
        return c;
      }
    }
  }
  return null;
}
