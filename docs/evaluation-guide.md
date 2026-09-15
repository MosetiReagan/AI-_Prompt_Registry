# Prompt Testing & Quality Gates Guide

## Overview

AI Prompt Registry treats prompt engineering as continuous integration. Before any prompt version can be promoted to a protected production environment, it must pass a suite of deterministic assertions and satisfy organizational regression policies.

---

## 1. Test Cases & Assertions

Test cases represent structured input-output test fixtures defined against a prompt's input variables:

```yaml
name: Order Support Assertion
description: Ensure order status response contains order number and avoids error terms
inputs:
  customer_name: "Alice"
  order_id: 12345

expectedProperties:
  contains:
    - "Alice"
    - "12345"
  forbiddenTerms:
    - "error"
    - "declined"
  regexMatch: "order\\s+#?12345"
  jsonSchema:
    type: "object"
    required: ["status", "orderId"]
    properties:
      status: { type: "string" }
      orderId: { type: "number" }
```

### Supported Assertion Types

1. **`exact_match`**: The rendered output matches the expected string verbatim.
2. **`contains`**: All specified substring tokens must appear in the output.
3. **`forbidden_terms`**: Fails if any listed toxic, forbidden, or error keywords are present in the output.
4. **`regex`**: Validates output structure against a safe, non-catastrophic regular expression.
5. **`json_validity`**: Verifies that the output is syntactically valid JSON.
6. **`json_schema`**: Validates structured JSON outputs against Draft-07 / 2020-12 JSON Schemas powered by Ajv.

---

## 2. Running Evaluations

Run evaluations via the API, CLI, or SDK:

### Via CLI
```bash
prompt-registry eval run customer-support.reply -v 1.1.0
```

### Via SDK
```typescript
const report = await client.evaluate("customer-support.reply", "1.1.0");
console.log(`Evaluation score: ${report.score * 100}% (passed: ${report.passed})`);
```

---

## 3. Regression Detection

The regression engine compares a candidate prompt version against a baseline version (e.g. current production):

```bash
prompt-registry eval regression customer-support.reply --baseline 1.0.0 --candidate 1.1.0
```

- If candidate score drops by more than `maxRegression` (default: 5%), promotion to production is automatically blocked.
- Both versions must possess verified evaluation runs; synthetic scores are rejected.

---

## 4. Policy Gate Enforcement

Organization policies configure automated rules enforced during publish and promote operations:

```json
{
  "requireDescription": true,
  "requireOwner": true,
  "forbidSecrets": true,
  "immutablePublished": true,
  "production": {
    "requireEvaluation": true,
    "minimumScore": 0.85,
    "maxRegression": 0.05,
    "requireApproval": false
  }
}
```

Promotions to any environment with `isProtected: true` (e.g. `production`, `canary-prod`) unconditionally evaluate these rules before updating active deployments.
