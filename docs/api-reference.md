# API Reference & Specification

All API endpoints are mounted under `/v1` and communicate using JSON over HTTP.

## Base URL
- Production: `https://api.promptregistry.dev` (or self-hosted domain)
- Local Development: `http://localhost:3000`

---

## Authentication

All requests require an API key passed via the `Authorization` header:

```http
Authorization: Bearer apr_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

If unauthenticated requests are sent when `ALLOW_ANONYMOUS=true` is enabled, the request receives an anonymous identity with restricted scopes (`read`, `execute`). When disabled, `401 Unauthorized` (`AUTHENTICATION_REQUIRED`) is returned.

### Scopes
- `read`: Read prompts, versions, environments, deployments, evaluations.
- `write`: Create prompts, versions, and test cases.
- `publish`: Publish prompt versions and promote to environments.
- `admin`: Manage API keys, organization policies, and view audit logs.
- `execute`: Execute prompt renders and playground simulations.

---

## Endpoints

### 1. Prompts

#### List Prompts
`GET /v1/prompts`
- **Query Parameters**:
  - `search` *(string, optional)*: Filter by name or description.
  - `tag` *(string, optional)*: Filter by prompt tag.
  - `status` *(string, optional)*: `active` or `archived`.
  - `limit` *(integer, optional, default: 50, max: 200)*.
  - `offset` *(integer, optional, default: 0)*.
- **Response**: `200 OK` with array of Prompt objects.

#### Create Prompt
`POST /v1/prompts`
- **Body**:
  ```json
  {
    "name": "customer-support.reply",
    "description": "Agent responses for support tickets",
    "type": "chat",
    "tags": ["support", "production"]
  }
  ```
- **Response**: `201 Created` with created Prompt object.

#### Get Prompt Details
`GET /v1/prompts/:name`
- **Response**: `200 OK` with prompt metadata and active environment deployments.

---

### 2. Versions

#### Publish Prompt Version
`POST /v1/prompts/:name/versions`
- **Body**:
  ```json
  {
    "version": "1.0.0",
    "template": "Hello {{customer_name}}, thank you for contacting us about {{issue}}.",
    "variables": {
      "customer_name": { "type": "string", "required": true },
      "issue": { "type": "string", "required": true }
    },
    "changelog": "Initial release"
  }
  ```
- **Response**: `201 Created` with created PromptVersion object.

#### Semantic Diff Between Versions
`GET /v1/prompts/:name/diff?from=1.0.0&to=1.1.0`
- **Response**: `200 OK` with semantic diff, detected breaking changes, and recommended semver bump (`major`, `minor`, `patch`).

---

### 3. Deployments & Environments

#### Promote Version to Environment
`POST /v1/prompts/:name/promote`
- **Body**:
  ```json
  {
    "version": "1.0.0",
    "environment": "production",
    "notes": "Deploying tested prompt to prod"
  }
  ```
- **Response**: `200 OK` with Deployment object. Blocked with `422 Unprocessable Entity` if organization quality gates fail.

#### Rollback Environment
`POST /v1/prompts/:name/rollback`
- **Body**:
  ```json
  {
    "environment": "production",
    "targetVersion": "1.0.0"
  }
  ```

---

### 4. Evaluations

#### Run Evaluation
`POST /v1/prompts/:name/evaluate`
- **Body**:
  ```json
  {
    "version": "1.0.0"
  }
  ```
- **Response**: `200 OK` with overall test score, pass/fail status, and breakdown of assertion results.

---

### 5. Audit Logs

#### Query Audit Logs
`GET /v1/audit-logs`
- **Required Scope**: `admin`
- **Query Parameters**:
  - `limit` *(integer, default: 50, max: 200)*
  - `offset` *(integer, default: 0)*
- **Response**: `200 OK` with sanitized audit log entries (sensitive tokens and secrets automatically redacted).
