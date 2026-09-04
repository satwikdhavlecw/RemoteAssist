# ADR 0005: Keep runtime knowledge empty until a governed connector is configured

Date: 2026-07-16

Status: accepted

## Context

The local API previously loaded a Salesforce troubleshooting article, procedure, and connector records on every startup. The side panel presented that synthetic material as approved enterprise guidance, including a `KB-DEMO-001` citation and a proposed browser action. This could be mistaken for customer-authorized knowledge.

## Decision

The runtime governed knowledge service starts with no documents, procedures, or connectors. Synthetic records are renamed and injected only by automated tests. When retrieval has no approved result, the API requires human review and the extension displays a no-source state without knowledge-derived diagnostics, workflows, or ticket controls.

OpenAI Realtime may independently propose one locally filtered click, focus, or scroll action through a structured function call. This path is not enterprise-grounded, and the model receives no selector or executor. The client validates the function call and current unambiguous target before rendering a review card. Execution requires explicit allow-once consent and the existing server-side schema, risk, origin, page-fingerprint, target, sensitive-field, expiry, replay, deterministic-execution, result, and audit checks.

An authenticated connector must explicitly supply tenant-approved documents before grounded action guidance can appear.

## Consequences

- Local runtime no longer demonstrates a cited Salesforce procedure without a configured connector; it can demonstrate only the separately labeled model-proposal and deterministic approval path.
- OpenAI Realtime can choose a proposal from filtered current controls, but voice output cannot authorize browser or backend actions.
- Authorization, approval, expiry, ranking, citations, procedures, and connector administration remain testable without loading synthetic content into the product.
- The next knowledge milestone must implement authenticated ServiceNow Knowledge or SharePoint synchronization and durable indexing.
