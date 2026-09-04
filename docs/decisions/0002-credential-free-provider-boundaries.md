# ADR 0002: Credential-free adapters before production providers

Status: accepted on 2026-07-15; voice-provider decision superseded by ADR 0004 on 2026-07-16

## Context

RemoteAssist depends on identity, realtime voice, enterprise knowledge, AutomationEdge, ITSM, and human-support infrastructure. Developer machines and automated tests must not need customer credentials, and mock behavior must not be confused with production behavior.

## Decision

Each external dependency is accessed through a narrow application-owned interface. The first implementation is deterministic, in memory, and credential free. Production modes fail closed until a reviewed provider implementation is configured. User interfaces identify local mock behavior, and plain-English documentation lists the missing production capabilities.

Authorization, consent, schemas, risk classification, idempotency, sanitation, and audit checks remain inside RemoteAssist rather than being delegated to a provider. A production adapter cannot bypass them.

## Consequences

- The complete local support journey is reproducible in tests and demos.
- Security behavior can be reviewed before procurement or tenant access is available.
- Production readiness requires explicit provider work; replacing a mock is not a configuration-only claim.
- In-memory records disappear on restart and cannot be used as operational evidence.
- Provider contract tests and failure handling are required before activation.

The interface and fail-closed principles remain in force. ADR 0004 replaces only the credential-free voice implementation with OpenAI Realtime; the other enterprise adapters remain deterministic and local.
