# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability within AI Prompt Registry, please report it privately. Do not disclose vulnerabilities in public GitHub issues.

Send details to: `security@ai-prompt-registry.org`

Include:
* A description of the vulnerability
* Steps to reproduce or proof-of-concept
* Affected versions or components

We will acknowledge receipt within 48 hours and provide updates through resolution.

---

## Security Architecture & Guarantees

### 1. Zero Template Execution (`eval`)
AI Prompt Registry strictly rejects arbitrary code execution inside templates.
* Template variables use AST tokenization (`{{variable}}`) with strict type validation.
* No `eval()`, `new Function()`, or unsafe template evaluation is ever performed.

### 2. Secret Redaction & Scanner
* **Hardcoded API Key Detection**: The policy engine scans templates for known secret formats before publishing:
  * OpenAI API keys (`sk-...`)
  * Anthropic API keys (`sk-ant-...`)
  * GitHub personal access tokens (`ghp_...`)
  * AWS access keys (`AKIA...`)
* **Redaction in Logs**: Audit logs, request logs, and error responses automatically sanitize detected tokens with `[REDACTED_SECRET]`.
* **API Key Hashing**: Registry API keys are never stored in plaintext. Only SHA-256 cryptographic hashes are persisted. The plaintext token is shown only once upon creation.

### 3. Multi-Tenant Isolation
* All prompts, versions, deployments, audit logs, and API keys are strictly partitioned by `organizationId`.
* Tenant identifiers are validated server-side based on authenticated credentials, not client-supplied query parameters.
* Cross-tenant access attempts return `404 Not Found` to prevent metadata leakage.

### 4. Prompt Injection Awareness
The registry treats prompt templates and variable values strictly as data.
* Security analyzers flag patterns such as `ignore previous instructions`, `disregard all prior guidelines`, and `system prompt leakage`.
* While no software can make an AI model inherently immune to semantic jailbreaks, AI Prompt Registry provides strict input typing, schema validation, and forbidden term evaluators to mitigate prompt injection risks.
