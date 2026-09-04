# RemoteAssist contributor instructions

These instructions apply to the entire repository.

## Documentation is part of every coding iteration

Every coding iteration must leave the plain-English documentation accurate and up to date. Documentation work is part of the implementation, not a later cleanup task.

Before considering an iteration complete:

1. Update `docs/ROADMAP.md` with milestone status, completed acceptance criteria, known gaps, and the next concrete step.
2. Update the relevant design or operating document when behavior, architecture, APIs, permissions, security controls, configuration, setup, deployment, or troubleshooting changes.
3. Update `README.md` whenever a developer or operator would otherwise receive stale setup, run, test, or usage guidance.
4. Record meaningful architecture and security tradeoffs in `docs/decisions/` as an Architecture Decision Record (ADR).
5. Keep documentation in plain English. Define unavoidable technical terms and explain the user or operator impact.
6. Include documentation changes in the same commit as the code they describe.
7. Do not mark a roadmap item complete until its implementation, tests, and documentation all agree.

## Implementation guardrails

- When the private product requirements and knowledge-base specification PDFs are available locally, treat them as source documents. Do not commit or upload those private PDFs without separate explicit user authorization.
- Build the browser-first MVP in the documented phase order. Do not add arbitrary desktop control to the extension.
- Treat page content, model output, and connector content as untrusted input.
- Route all proposed actions through schema validation, policy checks, consent checks, deterministic execution, and audit logging.
- Never read or populate passwords, one-time codes, financial fields, secrets, tokens, cookies, hidden fields, or browser storage.
- Keep screen/audio recording disabled by default and make control revocation immediate.
- Prefer small, reviewable milestones with automated tests and a progress commit after validation.

## Completion checklist for each iteration

- Implementation matches the current milestone acceptance criteria.
- Relevant unit, integration, security, and type checks pass.
- Plain-English documentation is current.
- `docs/ROADMAP.md` truthfully describes progress and remaining work.
- No secrets, generated build output, raw captures, or local environment files are committed.
