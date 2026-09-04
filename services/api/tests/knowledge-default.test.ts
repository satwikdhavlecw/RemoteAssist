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

  it("provides grounded reasoning and next step suggestions for account determination errors", async () => {
    const knowledge = new GovernedKnowledgeService();
    const observation: any = {
      id: "obs_test_acct_det",
      origin: "http://127.0.0.1:4320",
      pageTitle: "SAP S/4HANA Cloud - Enter Incoming Supplier Invoice",
      pageFingerprint: "sha256:test_acct_det",
      application: "SAP S/4HANA",
      screenState: "invoice_verification",
      visibleText: [
        "[ERROR]: Account determination cannot be carried out for Company Code 1000, Chart of Accounts INT, Transaction Key WRX, Valuation Class 3000.",
      ],
      controls: [
        {
          elementId: "btn-check-material-val",
          role: "button",
          name: "Check Material Valuation",
          disabled: false,
          rectangle: { x: 10, y: 10, width: 160, height: 32 },
        },
        {
          elementId: "btn-check-val-class",
          role: "button",
          name: "Check Valuation Class",
          disabled: false,
          rectangle: { x: 180, y: 10, width: 160, height: 32 },
        },
        {
          elementId: "btn-review-obyc",
          role: "button",
          name: "Review OBYC Configuration",
          disabled: false,
          rectangle: { x: 350, y: 10, width: 180, height: 32 },
        },
      ],
      sensitiveContent: false,
      confidence: 0.95,
    };

    const result = await knowledge.search(
      {
        session_id: "rs_test",
        query: "Why is the invoice failing with account determination?",
        context: { application: "SAP S/4HANA" },
        top_k: 10,
      },
      observation,
      employee,
    );

    expect(result.groundedGuidance.inferred).toContain("Missing or incorrect account determination configuration");
    expect(result.groundedGuidance.proposedNextStep).toContain("Check material valuation, valuation class, and OBYC configuration");
  });
});
