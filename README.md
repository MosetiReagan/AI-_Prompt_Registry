# AI Prompt Registry

> **Open-source prompt management, versioning, and deployment infrastructure for AI applications.**
>
> *The equivalent of Git + npm registry + configuration management for AI prompts.*

[![CI](https://github.com/MosetiReagan/AI-_Prompt_Registry/actions/workflows/ci.yml/badge.svg)](https://github.com/MosetiReagan/AI-_Prompt_Registry/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)

---

## The Philosophy

A production AI application should never depend on an undocumented prompt copied into source code or hardcoded in an ad-hoc dashboard. 

Instead, prompts must be **first-class versioned engineering resources**:

```text
Application
     │
     ▼
AI Prompt Registry
     │
     ├── Prompt (e.g. customer-support.reply)
     ├── Version (e.g. 1.2.0, 2.0.0 — immutable once published)
     ├── Environment (development → staging → production)
     ├── Variables (explicitly typed, safely validated, zero eval)
     ├── Evaluation (deterministic quality gates + regression testing)
     ├── Metadata & Policy (no secrets, required owners, review approvals)
     └── Deployment
              │
              ▼
          AI Provider (OpenAI, Anthropic, Gemini, Ollama)
              │
              ▼
           AI Cost (telemetry metadata headers attached)
```

With **AI Prompt Registry**, consuming a prompt is as clean and reliable as importing a versioned package:

```ts
import { PromptRegistry } from "@ai-prompt-registry/sdk";

const registry = new PromptRegistry({
  baseUrl: process.env.PROMPT_REGISTRY_URL,
  apiKey: process.env.PROMPT_REGISTRY_KEY
});

// Production always resolves deterministically to a pinned immutable version
const prompt = await registry.get("customer-support.reply", "production");

// Safe template rendering with typed variable validation (NO eval, NO code injection)
const rendered = await registry.render("customer-support.reply", {
  customer_name: "Sarah Connor",
  issue: "Subscription renewal failed"
});
```

---

## Key Capabilities

* **Immutable Semantic Versioning**: Once a prompt version (e.g. `v1.2.0`) is published, its checksum is verified and it cannot be silently modified or corrupted.
* **Semantic Prompt Diffs**: Computes intelligent diffs between versions — highlighting breaking changes like added required variables, altered output schemas, or modified system instructions rather than just raw character diffs.
* **Environments & Safe Promotion**: Promote prompts from `development` → `staging` → `production`. Production always pins an immutable version.
* **First-Class Rollback**: Revert an environment instantaneously with complete cryptographic audit logging without destroying version history.
* **Deterministic Evaluators & Regression Testing**: Run automated test suites with evaluators (`exact_match`, `contains`, `regex`, `json_valid`, `json_schema`, `length`, `required_fields`, `forbidden_terms`). Compare candidate versions against baselines to catch regressions before they reach production.
* **Zero Hidden AI Dependency**: The entire registry, rendering engine, diffing, policies, test runners, and API operate 100% deterministically without requiring an LLM. Optional LLM-as-a-judge is strictly opt-in.
* **Enterprise Security & Policies**: Enforces organization policies (secret scanner detects OpenAI/Anthropic/AWS/GitHub tokens, requires minimum evaluation score before production promotion, enforces mandatory descriptions and reviews).
* **Multi-Tenancy & Scoped API Keys**: Organization and project boundaries with SHA-256 hashed API keys and granular scopes (`read`, `write`, `publish`, `admin`, `execute`).
* **Model Context Protocol (MCP) Server**: Exposes MCP tools (`prompt_list`, `prompt_get`, `prompt_render`, `prompt_diff`, `prompt_evaluate`) for Cursor, Claude Desktop, and AI coding agents.
* **Developer Tooling**: Full CLI (`prompt-registry`), TypeScript SDK, and an interactive React dashboard with a live Prompt Playground.

---

## Monorepo Architecture

```text
ai-prompt-registry/
├── apps/
│   ├── api/          # Production Fastify REST API, auth middleware, storage adapters
│   ├── cli/          # 'prompt-registry' CLI executable
│   └── dashboard/    # Vite + React + Tailwind CSS interactive dashboard & playground
├── packages/
│   ├── core/         # Domain models, safe template renderer, semantic diff, evaluators, policy engine
│   ├── sdk/          # Strongly typed TypeScript SDK client with in-memory caching
│   └── mcp/          # Model Context Protocol (MCP) server for AI coding agents
├── fixtures/         # Realistic prompt test fixtures (chat, variable, breaking change, security)
├── docs/             # Technical architecture, security, and API documentation
└── tests/            # Unit, integration, security, and end-to-end lifecycle test suite
```

---

## Quick Start

### 1. Installation

```bash
# Clone repository
git clone https://github.com/ai-prompt-registry/ai-prompt-registry.git
cd ai-prompt-registry

# Install dependencies using pnpm
pnpm install

# Run comprehensive test suite (33+ unit and integration tests)
pnpm test

# Build all packages, CLI, API, and Dashboard
pnpm -r build
```

### 2. Start Services Locally

```bash
# Start the API server (defaults to port 3000)
pnpm --filter @ai-prompt-registry/api start

# In a separate terminal, start the Dashboard (port 5173)
pnpm --filter @ai-prompt-registry/dashboard dev
```

Visit the dashboard at `http://localhost:5173`.

### 3. CLI Workflow

Initialize workspace and manage prompts directly from your terminal:

```bash
# Initialize local prompt workspace
prompt-registry init

# Create prompt resource
prompt-registry prompt create customer-support.reply --desc "Customer support assistant"

# Publish version 1.0.0
prompt-registry prompt publish customer-support.reply --file prompts/support-reply.prompt.yaml --ver 1.0.0

# Run evaluation test suite
prompt-registry prompt evaluate customer-support.reply --ver 1.0.0

# Promote to staging and production
prompt-registry prompt deploy customer-support.reply 1.0.0 staging
prompt-registry prompt deploy customer-support.reply 1.0.0 production

# Render prompt with variables
prompt-registry prompt render customer-support.reply --env production --vars "customer_name=John,issue=Payment failed"

# Rollback production if needed
prompt-registry prompt rollback customer-support.reply --env production

# Run automated CI checks in GitHub Actions
prompt-registry ci --dir prompts
```

---

## Prompt File Format (`.prompt.yaml`)

Prompts can be authored and tracked in Git:

```yaml
name: customer-support.reply
version: 1.2.0
description: Generate helpful customer support replies
type: chat
tags: [support, billing]

messages:
  - role: system
    content: |
      You are a helpful, professional customer support agent.
      Always respond empathetically and provide clear next steps.
  - role: user
    content: |
      Customer: {{customer_name}}
      Issue: {{issue}}

variables:
  customer_name:
    type: string
    required: true
    description: Full name of the customer
  issue:
    type: string
    required: true
    description: Description of the issue

model:
  provider: openai
  name: gpt-4o
  temperature: 0.2

outputSchema:
  type: json_schema
  strict: true
  schema:
    type: object
    required: [response, priority]
    properties:
      response: { type: string }
      priority: { type: string, enum: ["low", "medium", "high", "urgent"] }
```

---

## Model Context Protocol (MCP)

To use AI Prompt Registry with Cursor or Claude Desktop, add the MCP server configuration:

```json
{
  "mcpServers": {
    "prompt-registry": {
      "command": "node",
      "args": ["/path/to/ai-prompt-registry/packages/mcp/dist/index.js"],
      "env": {
        "PROMPT_REGISTRY_URL": "http://localhost:3000",
        "PROMPT_REGISTRY_KEY": "apr_live_..."
      }
    }
  }
}
```

Now your AI assistant can query:
* *"Find the production version of customer-support.reply"*
* *"Compare version 1.1.0 and 1.2.0 and list breaking changes"*
* *"Run regression tests for the invoice extraction prompt"*

---

## Production Deployment with Docker

```bash
# Launch PostgreSQL, Redis, API, and Dashboard
docker compose up -d
```

The database schema is automatically applied from `apps/api/src/storage/schema.sql`.

---

## License

[Apache-2.0](LICENSE) © 2026 AI Prompt Registry Contributors.

Created and maintained by [Reagan Moseti](https://www.linkedin.com/in/reagan-moseti-1a8380238/).
