# Security Model & Hardening Guide

## Threat Model & Security Posture

AI Prompt Registry is built with defense-in-depth principles to protect production prompt definitions, model preferences, and API keys against unauthorized access, cross-tenant leakage, and code injection.

---

## 1. Authentication & API Key Management

### Key Anatomy & Storage
- API keys use the prefix format: `apr_live_<48_hex_characters>`.
- Only the SHA-256 hash (`keyHash`) is persisted in the database; raw secret keys are displayed only once upon initial generation.
- **Key Expiration**: All API keys support an optional `expiresAt` timestamp. The authentication middleware immediately rejects expired keys with `401 Unauthorized` (`EXPIRED_API_KEY`).
- **Telemetry**: Key usage timestamps (`lastUsedAt`) are updated asynchronously on successful requests.

### Role-Based Access Control (RBAC)
Every request is bound to an identity possessing explicit granular scopes:
- `read`: Read prompts, versions, environments, deployments, evaluations.
- `write`: Create prompts, versions, and test cases.
- `publish`: Publish immutable prompt versions and promote deployments.
- `admin`: Key management, policy updates, environment creation, audit log access.
- `execute`: Template rendering and playground invocations.

---

## 2. Multi-Tenant Isolation

### SQL & Memory Partitioning
- Every table in PostgreSQL and collection in memory has an indexed `organization_id` foreign key.
- All query predicates strictly enforce tenant isolation:
  ```sql
  SELECT v.* FROM prompt_versions v
  JOIN prompts p ON v.prompt_id = p.id
  WHERE p.organization_id = $1 AND v.prompt_id = $2;
  ```
- No child record (version, deployment, alias, test case, evaluation, or approval) can be queried or mutated without verifying organization ownership.

---

## 3. Network & Transport Hardening

1. **HTTP Headers**: Enforced using `@fastify/helmet` with strict CSP, HSTS, and X-Content-Type-Options headers.
2. **Rate Limiting**: Integrated `@fastify/rate-limit` enforces 1,000 requests per minute per IP address, preventing denial-of-service and brute-force key guessing.
3. **CORS Allowlist**: Configurable via `CORS_ORIGIN` environment variable, defaulting to localhost origins during development and preventing unauthorized cross-origin requests.

---

## 4. ReDoS & Injection Protection

### Deterministic Evaluator Regex Protection
User-supplied regular expressions in test case assertions are analyzed using an AST/pattern safety verifier (`isSafeRegex`) to reject catastrophic backtracking (nested quantifiers such as `(a+)+` or `(x|y+)*`). Furthermore, regex matches are executed with hard execution timeouts and bounds.

### Template Sandbox
Prompt templates are rendered using a secure Mustache parser that strictly rejects code evaluation (`eval()`, Function constructors, or script tags).

---

## 5. Entity Identifiers & Cryptography

- All IDs (`prompt_*`, `ver_*`, `dep_*`, `eval_*`, `tc_*`, `audit_*`, `key_*`, `evt_*`) are generated using cryptographically secure `crypto.randomUUID()`.
- Audit logs automatically redact sensitive tokens (`apr_live_...`), passwords, and secrets before persisting or streaming to the client.
