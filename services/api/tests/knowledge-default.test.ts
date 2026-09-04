import { describe, expect, it } from "vitest";
import { GovernedKnowledgeService } from "../src/domain/governed-knowledge-service.js";

const employee = {
  tenantId: "tenant-test",
  userId: "user-test",
  roles: ["employee"],
};

describe("default governed knowledge", () => {
  it("starts empty and fails closed instead of returning canned guidance", async () => {
    const knowledge = new GovernedKnowledgeService();

    expect(knowledge.listPermittedDocuments(employee)).toEqual([]);
    expect(
      knowledge.listConnectors({ ...employee, roles: ["knowledge_admin"] }),
    ).toEqual([]);

    const result = await knowledge.search(
      {
        session_id: "rs_test",
        query: "Salesforce shows SAML authentication failed",
        context: {
          application: "Salesforce",
          visible_error: "SAML authentication failed",
        },
        top_k: 10,
      },
      null,
      employee,
    );

    expect(result.results).toEqual([]);
    expect(result.recommendedProcedure).toBeNull();
    expect(result.requiresHumanReview).toBe(true);
    expect(result.groundedGuidance.enterpriseGuidance).toBe("");
  });

  it("explains policy restrictions when user asks to click a higher-risk control like Reset", async () => {
    const knowledge = new GovernedKnowledgeService();
    const observation: any = {
      id: "obs_test",
      origin: "https://login.salesforce.com",
      pageTitle: "SAP S/4HANA",
      pageFingerprint: "sha256:test",
      application: "SAP",
      screenState: "invoice_entry",
      visibleText: ["Invoice Entry Form"],
      controls: [
        {
          elementId: "btn-reset",
          role: "button",
          name: "Reset",
          disabled: false,
          rectangle: { x: 10, y: 10, width: 80, height: 32 },
        },
      ],
      sensitiveContent: false,
      confidence: 0.95,
    };

    const result = await knowledge.search(
      {
        session_id: "rs_test",
        query: "click on reset",
        context: { application: "SAP" },
        top_k: 10,
      },
      observation,
      employee,
    );

    expect(result.groundedGuidance.proposedNextStep).toContain("higher-risk control by security policy");
    expect(result.groundedGuidance.proposedNextStep).toContain("cannot be executed automatically");
    expect(result.groundedGuidance.proposedNextStep).toContain("manually");
  });
});
