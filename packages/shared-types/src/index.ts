import { z } from "zod";

export const sessionStatuses = [
  "CREATED",
  "AUTHENTICATED",
  "VOICE_CONNECTED",
  "AWAITING_SCREEN_CONSENT",
  "OBSERVING",
  "TROUBLESHOOTING",
  "AWAITING_ACTION_APPROVAL",
  "EXECUTING_BROWSER_ACTION",
  "EXECUTING_BACKEND_ACTION",
  "AWAITING_USER_ACTION",
  "AWAITING_HUMAN",
  "HUMAN_CONNECTED",
  "VERIFYING",
  "RESOLVED",
  "ESCALATED",
  "COMPLETED",
  "USER_CANCELLED",
  "CONSENT_REVOKED",
  "SECURITY_BLOCKED",
  "CONNECTION_FAILED",
  "ESCALATED_OFF_PLATFORM",
] as const;

export type SessionStatus = (typeof sessionStatuses)[number];

export const terminalSessionStatuses = [
  "COMPLETED",
  "USER_CANCELLED",
  "CONSENT_REVOKED",
  "SECURITY_BLOCKED",
  "CONNECTION_FAILED",
  "ESCALATED_OFF_PLATFORM",
] as const satisfies readonly SessionStatus[];

export const consentGrantTypes = [
  "microphone",
  "screen_view_ai",
  "browser_control_ai",
  "screen_view_human",
  "browser_control_human",
  "recording",
] as const;

export type ConsentGrantType = (typeof consentGrantTypes)[number];

export interface ConsentGrant {
  id: string;
  sessionId: string;
  grantType: ConsentGrantType;
  scope: string;
  allowedOrigins: string[];
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
  expiresWhen: "session_ends" | "explicit_time";
}

export interface SupportSession {
  id: string;
  tenantId: string;
  userId: string;
  status: SessionStatus;
  revision: number;
  channel: "browser_extension";
  voiceEnabled: boolean;
  paused: boolean;
  entryOrigin: string | null;
  controller: "none" | "ai" | "human";
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  consents: ConsentGrant[];
}

export interface SafeControl {
  elementId: string;
  role: string;
  name: string;
  disabled: boolean;
  rectangle: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface SanitizedObservation {
  id: string;
  sessionId: string;
  origin: string;
  pageTitle: string;
  pageFingerprint: string;
  application: string | null;
  screenState: string | null;
  visibleText: string[];
  controls: SafeControl[];
  sensitiveContent: boolean;
  confidence: number;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  sessionId: string;
  actorType: "user" | "ai" | "human" | "system" | "extension";
  actorId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  timestamp: string;
  previousHash: string;
  integrityHash: string;
}

export interface KnowledgeResult {
  documentId: string;
  title: string;
  section: string;
  relevanceScore: number;
  authorityScore: number;
  freshnessScore: number;
  sourceSystem: string;
  sourceReference: string;
  content: string;
  applicableWorkflows: string[];
}

export interface KnowledgeSearchResponse {
  queryId: string;
  issue: {
    application: string | null;
    category: string;
    visibleError: string | null;
  };
  results: KnowledgeResult[];
  recommendedProcedure: string | null;
  confidence: number;
  conflictsDetected: boolean;
  requiresHumanReview: boolean;
  groundedGuidance: {
    reported: string;
    observed: string;
    enterpriseGuidance: string;
    inferred: string;
    proposedNextStep: string;
  };
}

const safeOriginSchema = z
  .string()
  .url()
  .transform((value) => new URL(value).origin);

export const createSessionRequestSchema = z
  .object({
    channel: z.literal("browser_extension"),
    voice_enabled: z.boolean().default(false),
    entry_context: z
      .object({
        tab_origin: safeOriginSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const consentRequestSchema = z
  .object({
    grant_type: z.enum(consentGrantTypes),
    scope: z.string().min(1).max(100),
    allowed_origins: z.array(safeOriginSchema).max(25).default([]),
    expires_when: z
      .enum(["session_ends", "explicit_time"])
      .default("session_ends"),
    expires_at: z.string().datetime().nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expires_when === "explicit_time" && !value.expires_at) {
      context.addIssue({
        code: "custom",
        message: "expires_at is required for explicit_time",
        path: ["expires_at"],
      });
    }
  });

export const safeControlSchema = z
  .object({
    elementId: z.string().min(1).max(120),
    role: z.string().min(1).max(80),
    name: z.string().min(1).max(300),
    disabled: z.boolean(),
    rectangle: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const observationRequestSchema = z
  .object({
    origin: safeOriginSchema,
    page_title: z.string().max(500),
    page_fingerprint: z.string().min(8).max(200),
    application: z.string().max(120).nullable().default(null),
    screen_state: z.string().max(120).nullable().default(null),
    visible_text: z.array(z.string().max(1500)).max(300),
    controls: z.array(safeControlSchema).max(300),
    sensitive_content: z.boolean(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const knowledgeSearchRequestSchema = z
  .object({
    session_id: z.string().min(1).max(100),
    query: z.string().min(2).max(2000),
    context: z
      .object({
        application: z.string().max(120).optional(),
        visible_error: z.string().max(1000).optional(),
        browser: z.string().max(120).optional(),
        operating_system: z.string().max(120).optional(),
      })
      .strict()
      .default({}),
    top_k: z.number().int().min(1).max(25).default(10),
  })
  .strict();

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type ConsentRequest = z.infer<typeof consentRequestSchema>;
export type ObservationRequest = z.infer<typeof observationRequestSchema>;
export type KnowledgeSearchRequest = z.infer<
  typeof knowledgeSearchRequestSchema
>;

export const MAX_RESOLUTION_PLAN_STEPS = 5;

export type GovernedActionType =
  | "CLICK_ELEMENT"
  | "FOCUS_ELEMENT"
  | "SCROLL_TO_ELEMENT";

export interface ResolutionPlanStep {
  id: string;
  actionType: GovernedActionType;
  controlName: string;
  controlRole: string;
  purpose: string;
  expectedText?: string | null;
  grounded?: boolean;
}

export interface ResolutionPlan {
  planId: string;
  steps: ResolutionPlanStep[];
  explanation: string;
  truncated?: boolean;
  warning?: string | null;
  investigativeQuery?: string | null;
  destinationDescription?: string | null;
  blockedByPolicy?: boolean;
  blockedReason?: string | null;
  blockedControlName?: string | null;
  blockedControlRole?: string | null;
}
