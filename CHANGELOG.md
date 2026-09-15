# Changelog

All notable changes to **AI Prompt Registry** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-15

### Added
* **Core Prompt Infrastructure**:
  * Semantic Versioning engine conforming to SemVer 2.0.
  * SHA-256 deterministic checksum verification for immutable prompt versions.
  * Safe AST template rendering engine supporting text and structured chat formats without `eval`.
  * Typed variable validation (`string`, `number`, `boolean`, `json`, `array`) and strict schema checks.
  * Semantic Prompt Diff engine with automatic breaking change classification and recommended SemVer bumps (`PATCH`, `MINOR`, `MAJOR`).
  * 8 deterministic evaluators (`exact_match`, `contains`, `regex`, `json_valid`, `json_schema`, `length`, `required_fields`, `forbidden_terms`).
  * Automated Prompt Regression Testing engine comparing candidate and baseline versions.
  * Policy Engine enforcing quality gates, secret scanning, minimum scores, and review approvals.
  * Security analyzer with secret redaction and prompt injection risk detection.
  * Git file formats parser and serializer (`.prompt.yaml` and `.prompt.json`).
* **Fastify REST API**:
  * Full REST endpoints for prompts, versions, environments, promotions, rollbacks, diffs, rendering, evaluations, policies, approvals, audit logs, and API keys.
  * Scoped API key authentication with SHA-256 hashing.
  * Strict multi-tenant isolation.
  * Health (`/health`) and readiness (`/ready`) endpoints.
  * Dual storage architecture: High-performance memory storage engine and production PostgreSQL relational schema with migrations.
* **TypeScript SDK (`@ai-prompt-registry/sdk`)**:
  * Strongly typed client with in-memory caching (immutable versions cached, environment aliases TTL cached).
  * Automated telemetry header generation for AI Cost and downstream tracking.
* **CLI (`prompt-registry`)**:
  * Interactive and scriptable commands: `init`, `login`, `doctor`, `ci`, `prompt create/list/get/publish/versions/diff/deploy/rollback/render/test/evaluate`, `env list/promote`.
* **Model Context Protocol (MCP) Server (`@ai-prompt-registry/mcp`)**:
  * Standard stdio JSON-RPC 2.0 MCP server for Claude Desktop, Cursor, and AI agents.
* **Interactive Dashboard**:
  * Vite + React + Tailwind CSS dashboard with Prompts explorer, Semantic Diff viewer, live Playground, Evaluations, Deployments, Policies, and Audit Logs.
* **Production Packaging & CI**:
  * Multi-stage Dockerfile and Docker Compose setup for PostgreSQL, Redis, API, and Dashboard.
  * GitHub Actions CI pipeline for automated testing, typechecking, building, and fixture validation.
