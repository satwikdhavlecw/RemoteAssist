# ADR 0001: Use a TypeScript npm-workspace monorepo

Status: accepted

Date: 2026-07-15

## Context

The browser extension, support console, admin console, backend APIs, command schema, event schema, and deterministic policy model must agree on security-sensitive data shapes. The source PRD permits either a Python FastAPI or TypeScript backend.

## Decision

Use TypeScript across browser surfaces and the initial modular backend, organized with npm workspaces. Put versioned shared types, command validation, and side-effect-free policy evaluation in packages consumed by both backend and extension.

## Why

One language and type system reduces contract drift in the first vertical slices. npm workspaces require no additional repository tool. Browser and server builds can still target different runtimes. Provider adapters and service module boundaries retain the option to introduce Python or separately scaled workers when a real workload justifies it.

## Consequences

- Security-sensitive schemas must also be validated at runtime; TypeScript types alone are not a trust boundary.
- Browser packages cannot import server-only code or secrets.
- The backend begins as a modular service for delivery speed, not as a claim that all production workloads belong in one process.
- A future service split must preserve public API and event contracts and record a new decision.
