# ADR 0013: Allow informational LLM explanations when approved knowledge is absent

## Context

The runtime governed knowledge store intentionally starts empty. That correctly prevents unsupported enterprise procedures and backend operations, but it made the chat panel return only a generic no-match message even when the sanitized page visibly explained the issue.

## Decision

The observation transport may carry more visible page context, but it remains fixed at 300 non-sensitive entries of 1,500 characters each. LLM summaries and action-review conversation history have separate smaller bounds so a large page cannot create an unbounded provider request.

The no-source dashboard prompt uses complete plain text so provider wrappers do not leak into the chat. The parser still accepts valid JSON for compatibility, preserves the complete parsed response without a second character slice, and rejects incomplete or provider-truncated wrapper output. The provider retains a finite output-token budget to prevent runaway responses.

When retrieval finds no approved article, the API asks the configured LLM for a direct page-context explanation using the user question and bounded sanitized page context. The chat does not prepend an internal database-status label; the API leaves `enterpriseGuidance` empty for the no-source response. The prompt forbids claims of enterprise approval, invented company policy, secret requests, backend workflows, and browser-control authorization. The no-source response continues to require human review, and knowledge-derived operations remain disabled. The sanitizer and API use larger but fixed bounds for visible non-sensitive page context, and chat rendering preserves complete wrapped responses.

## Consequences

Users receive a useful explanation of visible page facts while an enterprise connector is pending. The provider requests complete plain text for no-source dashboard questions, and the parser accepts valid JSON or prose forms commonly returned by Gemini while normalizing a missing final period. Incomplete connector endings, damaged JSON wrappers, and provider-truncated responses are rejected, and the deterministic fallback explicitly states when a dashboard has no visible problem. The response is not an official troubleshooting instruction and must not be treated as authorization for an action. Approved knowledge remains required for grounded procedures, workflow execution, and enterprise claims.
