import { randomUUID } from "node:crypto";
import { findActiveConsent } from "@remoteassist/policy-model";
import type {
  SanitizedObservation,
  SupportSession,
} from "@remoteassist/shared-types";
import { DomainError } from "./errors.js";
import type { Identity, SessionStore } from "./session-store.js";

export interface WorkflowDefinition {
  id: string;
  name: string;
  riskTier: "low" | "medium" | "high";
  requiresUserApproval: boolean;
  requiresTechnicalApproval: boolean;
  idempotent: boolean;
  timeoutSeconds: number;
  verificationMethod: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  sessionId: string;
  status: "completed";
  startedAt: string;
  completedAt: string;
  output: Record<string, unknown>;
  verification: "passed";
  idempotencyKey: string;
}

export interface TicketRecord {
  id: string;
  sessionId: string;
  tenantId: string;
  provider: "mock_servicenow";
  state: "open" | "resolved";
  issue: string;
  application: string | null;
  diagnosis: string;
  actions: string[];
  knowledgeReferences: string[];
  workflowExecutionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HumanHandoffRecord {
  id: string;
  sessionId: string;
  tenantId: string;
  employeeId: string;
  employeeDisplayName: string;
  issue: string;
  application: string | null;
  visibleError: string | null;
  consentStatus: "human_view_granted";
  status: "queued" | "connected" | "completed";
  requestedAt: string;
  joinedAt: string | null;
  agentId: string | null;
  agentDisplayName: string | null;
  ticketId: string;
}

interface InternalHandoff {
  record: HumanHandoffRecord;
  session: SupportSession;
}

const workflowRegistry: WorkflowDefinition[] = [
  {
    id: "AE-SUPPORT-DEMO-SESSION-STATUS",
    name: "Check enterprise application session",
    riskTier: "low",
    requiresUserApproval: true,
    requiresTechnicalApproval: false,
    idempotent: true,
    timeoutSeconds: 30,
    verificationMethod: "session_status_lookup",
  },
  {
    id: "AE-SUPPORT-DEMO-ACCOUNT-UNLOCK",
    name: "Unlock enterprise account",
    riskTier: "medium",
    requiresUserApproval: true,
    requiresTechnicalApproval: false,
    idempotent: true,
    timeoutSeconds: 120,
    verificationMethod: "account_status_lookup",
  },
];

export class OperationsService {
  readonly #executions = new Map<string, WorkflowExecution>();
  readonly #executionsByKey = new Map<string, WorkflowExecution>();
  readonly #tickets = new Map<string, TicketRecord>();
  readonly #handoffs = new Map<string, InternalHandoff>();

  constructor(private readonly sessions: SessionStore) {}

  workflows(): WorkflowDefinition[] {
    return [...workflowRegistry];
  }

  executeWorkflow(
    session: SupportSession,
    workflowId: string,
    idempotencyKey: string,
    userApproved: boolean,
  ): WorkflowExecution {
    this.sessions.assertActive(session);
    if (session.status !== "TROUBLESHOOTING") {
      throw new DomainError(
        "wrong_session_state",
        "A backend workflow can run only while troubleshooting.",
        409,
      );
    }
    const workflow = workflowRegistry.find(
      (candidate) => candidate.id === workflowId,
    );
    if (!workflow)
      throw new DomainError(
        "workflow_not_found",
        "The workflow is not registered.",
        404,
      );
    if (workflow.requiresUserApproval && !userApproved) {
      throw new DomainError(
        "workflow_approval_required",
        "The workflow requires explicit user approval.",
        403,
      );
    }
    if (workflow.riskTier === "high") {
      throw new DomainError(
        "workflow_risk_blocked",
        "High-risk workflows require technical approval.",
        403,
      );
    }
    const existing = this.#executionsByKey.get(
      `${session.id}:${idempotencyKey}`,
    );
    if (existing) return existing;

    const startedAt = new Date();
    this.sessions.transition(session, "EXECUTING_BACKEND_ACTION");
    const execution: WorkflowExecution = {
      id: `aex_${randomUUID()}`,
      workflowId,
      sessionId: session.id,
      status: "completed",
      startedAt: startedAt.toISOString(),
      completedAt: new Date(startedAt.getTime() + 250).toISOString(),
      output:
        workflowId === "AE-SUPPORT-DEMO-SESSION-STATUS"
          ? {
              serviceStatus: "operational",
              enterpriseSession: "expired",
              safeToRetry: true,
            }
          : { accountStatus: "unlocked", changed: true },
      verification: "passed",
      idempotencyKey,
    };
    this.#executions.set(execution.id, execution);
    this.#executionsByKey.set(`${session.id}:${idempotencyKey}`, execution);
    this.sessions.transition(session, "VERIFYING");
    this.sessions.transition(session, "TROUBLESHOOTING");
    return execution;
  }

  createTicket(
    session: SupportSession,
    issue: string,
    observation: SanitizedObservation | null,
    knowledgeReferences: string[] = [],
  ): TicketRecord {
    this.sessions.assertActive(session);
    const existing = [...this.#tickets.values()].find(
      (ticket) => ticket.sessionId === session.id,
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const ticket: TicketRecord = {
      id: `INC-DEMO-${String(this.#tickets.size + 1).padStart(5, "0")}`,
      sessionId: session.id,
      tenantId: session.tenantId,
      provider: "mock_servicenow",
      state: session.status === "RESOLVED" ? "resolved" : "open",
      issue,
      application: observation?.application ?? null,
      diagnosis: observation?.screenState ?? "Pending human diagnosis",
      actions: [],
      knowledgeReferences,
      workflowExecutionIds: [...this.#executions.values()]
        .filter((execution) => execution.sessionId === session.id)
        .map((execution) => execution.id),
      createdAt: now,
      updatedAt: now,
    };
    this.#tickets.set(ticket.id, ticket);
    return ticket;
  }

  getTicket(identity: Identity, ticketId: string): TicketRecord | null {
    const ticket = this.#tickets.get(ticketId);
    return ticket?.tenantId === identity.tenantId ? ticket : null;
  }

  requestHandoff(
    session: SupportSession,
    identity: Identity,
    issue: string,
    observation: SanitizedObservation | null,
  ): HumanHandoffRecord {
    this.sessions.assertActive(session);
    const origin = observation?.origin ?? session.entryOrigin ?? undefined;
    if (!findActiveConsent(session, "screen_view_human", origin)) {
      throw new DomainError(
        "human_view_consent_required",
        "Human viewing requires a separate active employee grant.",
        403,
      );
    }
    if (session.status !== "TROUBLESHOOTING") {
      throw new DomainError(
        "wrong_session_state",
        "Handoff can be requested while troubleshooting.",
        409,
      );
    }
    const ticket = this.createTicket(session, issue, observation, []);
    this.sessions.transition(session, "AWAITING_HUMAN");
    const record: HumanHandoffRecord = {
      id: `hnd_${randomUUID()}`,
      sessionId: session.id,
      tenantId: session.tenantId,
      employeeId: identity.userId,
      employeeDisplayName: "Local Employee",
      issue,
      application: observation?.application ?? null,
      visibleError:
        observation?.visibleText.find((text) => /error|failed/i.test(text)) ??
        null,
      consentStatus: "human_view_granted",
      status: "queued",
      requestedAt: new Date().toISOString(),
      joinedAt: null,
      agentId: null,
      agentDisplayName: null,
      ticketId: ticket.id,
    };
    this.#handoffs.set(record.id, { record, session });
    return record;
  }

  queue(identity: Identity): HumanHandoffRecord[] {
    if (!identity.roles.includes("support_agent")) return [];
    return [...this.#handoffs.values()]
      .filter((item) => this.sessions.isActive(item.session))
      .map((item) => item.record)
      .filter(
        (record) =>
          record.tenantId === identity.tenantId && record.status === "queued",
      );
  }

  join(identity: Identity, handoffId: string): HumanHandoffRecord {
    if (!identity.roles.includes("support_agent")) {
      throw new DomainError(
        "support_role_required",
        "A support-agent role is required.",
        403,
      );
    }
    const item = this.#handoffs.get(handoffId);
    if (!item || item.record.tenantId !== identity.tenantId) {
      throw new DomainError(
        "handoff_not_found",
        "The handoff request was not found.",
        404,
      );
    }
    this.sessions.assertActive(item.session);
    if (item.record.status !== "queued") {
      throw new DomainError(
        "handoff_already_claimed",
        "The handoff is no longer in the queue.",
        409,
      );
    }
    item.record.status = "connected";
    item.record.joinedAt = new Date().toISOString();
    item.record.agentId = identity.userId;
    item.record.agentDisplayName = "Local Support Engineer";
    this.sessions.transition(item.session, "HUMAN_CONNECTED");
    return item.record;
  }
}
