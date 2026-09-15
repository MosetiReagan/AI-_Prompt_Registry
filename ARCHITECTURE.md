# AI Prompt Registry — Technical Architecture

This document details the architecture, design principles, domain models, and technical boundaries of **AI Prompt Registry**.

---

## 1. High-Level Architecture

```text
                               ┌─────────────────────────┐
                               │   AI Client Application │
                               └────────────┬────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │       TypeScript SDK    │
                               │  (@ai-prompt-registry)  │
                               └────────────┬────────────┘
                                            │ HTTP / JSON
                                            ▼
┌──────────────────┐           ┌─────────────────────────┐           ┌──────────────────┐
│   MCP Server     ├──────────►│    Fastify REST API     │◄──────────┤   CLI Tool       │
│  (Claude/Cursor) │           │     (apps/api)          │           │ (prompt-registry)│
└──────────────────┘           └────────────┬────────────┘           └──────────────────┘
                                            │
                      ┌─────────────────────┼─────────────────────┐
                      │                     │                     │
                      ▼                     ▼                     ▼
             ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
             │ Policy Engine   │   │ Template Engine │   │ Semantic Diff   │
             │ (Secret Scan,   │   │ (Safe AST,      │   │ (Breaking Change│
             │ Gates, Reviews) │   │  No Eval)       │   │  Classification)│
             └─────────────────┘   └─────────────────┘   └─────────────────┘
                      │                     │                     │
                      └─────────────────────┼─────────────────────┘
                                            │
                                            ▼
                               ┌─────────────────────────┐
                               │      Storage Layer      │
                               │ (PostgreSQL / Memory)   │
                               └────────────┬────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
          ┌─────────────────────┐                       ┌─────────────────────┐
          │     PostgreSQL      │                       │     Audit Trail     │
          │ Relational Database │                       │ (Cryptographic Log) │
          └─────────────────────┘                       └─────────────────────┘
```

---

## 2. Core Domain Models

### Prompt (`Prompt`)
The top-level logical resource identifying a prompt family.
* `id`: Unique identifier (e.g. `prompt_172638491_abc`)
* `name`: Human-readable identifier (e.g. `customer-support.reply`)
* `slug`: URL-friendly identifier
* `type`: `"text"` or `"chat"`
* `status`: `"active"`, `"archived"`, `"deprecated"`
* `organizationId`: Multi-tenant isolation boundary

### PromptVersion (`PromptVersion`)
An immutable snapshot of a prompt at a specific semantic version.
* `version`: Semantic version string conforming to SemVer 2.0 (e.g. `1.2.0`)
* `lifecycleState`: `"draft"` → `"testing"` → `"approved"` → `"published"` → `"deprecated"`
* `template`: String or structured array of `ChatMessage` (`system`, `user`, `assistant`, `tool`)
* `variables`: Record of typed variable definitions
* `outputSchema`: Optional strict JSON Schema constraint
* `modelPreferences`: Optional recommended provider, model, and hyperparameters
* `checksum`: SHA-256 hash of normalized content
* `publishedAt`: Timestamp when state transitioned to published. Once published, modification is forbidden.

### Environment (`Environment`)
Named execution targets (e.g. `development`, `staging`, `production`).
* `isProtected`: If `true`, requires approved review and passing regression evaluation before promotion.

### Deployment (`Deployment`)
Point-in-time assignment of an immutable `PromptVersion` to an `Environment`.
* `promptId` & `promptVersionId`
* `version`: The exact SemVer version deployed
* `rollbackFromDeploymentId`: Tracks rollback provenance
* `status`: `"active"`, `"superseded"`, `"rolled_back"`

### Alias (`Alias`)
Pointer to an exact prompt version (e.g. `@latest`, `@stable`, `@production`, `@canary`). Changing an alias is recorded in the audit trail.

---

## 3. Safe Template Rendering Engine

Arbitrary code execution or template injection (such as Mustache/Handlebars eval, Python `eval()`, or JavaScript `new Function()`) is completely eliminated.

1. **AST Tokenizer**: Scans template strings and chat message structures strictly for regex pattern `/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g`.
2. **Safe Property Resolver**: Resolves dot-notation properties (e.g. `user.profile.name`) recursively without calling `eval`.
3. **Type Validation**: Validates inputs against `VariableDefinition`:
   * `string`
   * `number`
   * `boolean`
   * `json` (recursively stringified safely)
   * `array`
4. **Strict Mode**: Optionally rejects payloads containing undeclared variables to prevent prompt injection and variable poisoning.

---

## 4. Semantic Prompt Diff & SemVer Classification

Rather than a simple character-level textual diff, AI Prompt Registry parses and contrasts the semantic elements of two prompt versions:

| Change Category | Impact | SemVer Bump |
| :--- | :--- | :--- |
| Minor wording adjustments | Non-breaking | `PATCH` |
| Added optional variable (with default) | Non-breaking backward-compatible | `MINOR` |
| Added required variable without default | **Breaking** | `MAJOR` |
| Removed variable | **Breaking** | `MAJOR` |
| Modified variable type or requirement | **Breaking** | `MAJOR` |
| Changed structured output JSON schema | **Breaking** | `MAJOR` |
| Altered safety or security instructions | **Breaking** | `MAJOR` |

---

## 5. Evaluators and Regression Testing

The registry includes 8 built-in deterministic evaluators:
1. `exact_match`: Exact string match (case-sensitive or insensitive)
2. `contains`: Verifies existence of required substrings
3. `regex`: Verifies regex pattern matches
4. `json_valid`: Verifies output parses as valid JSON
5. `json_schema`: Validates output conforms to a defined JSON Schema
6. `length`: Enforces character and word count boundaries
7. `required_fields`: Checks top-level required JSON properties
8. `forbidden_terms`: Detects forbidden, toxic, or confidential keywords

### Regression Pipeline
When evaluating candidate version $V_{cand}$ against baseline version $V_{base}$:
$$\Delta = \text{Score}(V_{cand}) - \text{Score}(V_{base})$$
A promotion is rejected if:
1. $\text{Score}(V_{cand}) < \text{minimum\_score}$ (e.g. $0.85$)
2. $\Delta < -\text{max\_regression}$ (e.g. drop $> 5\%$)
3. Any previously passing test case regresses to failing.

---

## 6. Telemetry & AI Cost Integration

Every prompt execution recorded through the registry attaches standard metadata headers:
* `x-prompt-name`: e.g. `customer-support.reply`
* `x-prompt-version`: e.g. `1.2.0`
* `x-prompt-environment`: e.g. `production`
* `x-registry-client`: `ai-prompt-registry-sdk`

Downstream providers and cost tracking systems (such as **AI Cost**) can consume these headers to attribute token usage and cost per prompt version.
