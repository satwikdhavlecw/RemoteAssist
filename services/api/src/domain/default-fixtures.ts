import type {
  KnowledgeDocumentRecord,
  ProcedureRecord,
} from "./governed-knowledge-service.js";

export const defaultDocuments: KnowledgeDocumentRecord[] = [
  {
    id: "kb_test_salesforce_saml",
    tenantId: "*",
    sourceSystem: "servicenow",
    sourceRecordId: "KB-TEST-001",
    title: "Resolve Salesforce SAML authentication failure",
    section: "Retry before clearing the enterprise session",
    content:
      "Confirm there is no active outage. Retry the failed sign-in once. If the error remains, check the enterprise session before asking the user to sign in manually.",
    application: "Salesforce",
    symptoms: [
      "SAML authentication failed",
      "SSO login loop",
      "Salesforce is not opening",
    ],
    allowedRoles: ["employee", "support_agent", "knowledge_admin"],
    approvalStatus: "approved",
    validUntil: null,
    version: 1,
    sourceReference: "KB-TEST-001",
    procedureId: "proc_test_salesforce_saml",
    workflows: ["AE-SUPPORT-TEST-SESSION-STATUS"],
    authority: 1,
    freshness: 0.94,
  },
  {
    id: "kb_test_admin_secret",
    tenantId: "*",
    sourceSystem: "sharepoint",
    sourceRecordId: "SEC-TEST-002",
    title: "Privileged identity recovery procedure",
    section: "Security administrator only",
    content: "Restricted test content that an employee must never retrieve.",
    application: "Entra ID",
    symptoms: ["privileged account recovery"],
    allowedRoles: ["knowledge_admin"],
    approvalStatus: "approved",
    validUntil: null,
    version: 1,
    sourceReference: "SEC-TEST-002",
    procedureId: null,
    workflows: [],
    authority: 1,
    freshness: 0.9,
  },
];

export const defaultProcedures: ProcedureRecord[] = [
  {
    id: "proc_test_salesforce_saml",
    name: "Resolve Salesforce SAML login failure",
    application: "Salesforce",
    symptoms: ["SAML authentication failed", "login redirect loop"],
    prerequisites: ["Managed device", "No active Salesforce outage"],
    approvalStatus: "approved",
    steps: [
      {
        sequence: 1,
        type: "backend_check",
        instruction: "Check Salesforce service and enterprise session status.",
        risk: "low",
        agentControlAllowed: false,
        verification: "service_status_is_operational",
      },
      {
        sequence: 2,
        type: "browser_guidance",
        instruction: "Retry the failed SSO request once.",
        risk: "low",
        agentControlAllowed: true,
        verification: "salesforce_home_page_visible",
      },
      {
        sequence: 3,
        type: "user_action",
        instruction: "Sign in manually using the enterprise account.",
        risk: "restricted",
        agentControlAllowed: false,
        verification: "salesforce_home_page_visible",
      },
    ],
  },
];
