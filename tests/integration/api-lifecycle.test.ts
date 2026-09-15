import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../../apps/api/src/server.js";
import { MemoryStorage } from "../../apps/api/src/storage/memory.js";

import { hashApiKey } from "../../apps/api/src/middleware/auth.js";

describe("End-to-End Prompt Registry Lifecycle", () => {
  let app: FastifyInstance;
  let storage: MemoryStorage;

  const adminApiKey = "apr_live_lifecycle_test_admin_key";
  const authHeaders = { authorization: `Bearer ${adminApiKey}` };

  beforeAll(async () => {
    storage = new MemoryStorage();
    // Provision admin API key for tests
    await storage.createApiKey({
      id: "key_admin",
      organizationId: "default",
      name: "Admin Lifecycle Key",
      keyHash: hashApiKey(adminApiKey),
      keyPrefix: "apr_live_lif",
      scopes: ["read", "write", "publish", "admin", "execute"],
      expiresAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });

    app = await buildServer({ storage, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated requests by default with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/prompts"
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("allows unauthenticated read but blocks publish/admin when ALLOW_ANONYMOUS=true", async () => {
    process.env.ALLOW_ANONYMOUS = "true";

    // Read should succeed with anonymous identity
    const readRes = await app.inject({
      method: "GET",
      url: "/v1/prompts"
    });
    expect(readRes.statusCode).toBe(200);

    // Write / Admin action must be rejected with 403
    const writeRes = await app.inject({
      method: "POST",
      url: "/v1/prompts",
      payload: { name: "unauthorized.prompt" }
    });
    expect(writeRes.statusCode).toBe(403);
    expect(writeRes.json().code).toBe("INSUFFICIENT_SCOPE");

    delete process.env.ALLOW_ANONYMOUS;
  });

  it("completes full production lifecycle: create -> version -> test -> evaluate -> publish -> promote -> resolve -> rollback", async () => {
    const promptName = "customer-support.reply";

    // 1. Create prompt
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/prompts",
      headers: authHeaders,
      payload: {
        name: promptName,
        description: "Customer support reply assistant",
        type: "chat",
        tags: ["support", "production"]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const createdPrompt = createRes.json();
    expect(createdPrompt.name).toBe(promptName);

    // 2. Publish version 1.0.0
    const v1Res = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/versions`,
      headers: authHeaders,
      payload: {
        version: "1.0.0",
        template: [
          { role: "system", content: "You are a helpful customer support assistant." },
          { role: "user", content: "Customer: {{customer_name}}, Issue: {{issue}}" }
        ],
        variables: {
          customer_name: { type: "string", required: true },
          issue: { type: "string", required: true }
        },
        changelog: "Initial release"
      }
    });
    expect(v1Res.statusCode).toBe(201);
    const v1 = v1Res.json();
    expect(v1.version).toBe("1.0.0");
    expect(v1.checksum).toBeDefined();

    // 2b. Attempting to evaluate without test cases returns 422 NO_TEST_CASES_FOUND
    const noTcEval = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/evaluate`,
      headers: authHeaders,
      payload: { version: "1.0.0" }
    });
    expect(noTcEval.statusCode).toBe(422);
    expect(noTcEval.json().code).toBe("NO_TEST_CASES_FOUND");

    // 3. Add test case
    const tcRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/test-cases`,
      headers: authHeaders,
      payload: {
        name: "Billing issue test",
        inputs: {
          customer_name: "Sarah Connor",
          issue: "My credit card was declined"
        },
        expectedProperties: {
          contains: ["credit card", "declined"]
        }
      }
    });
    expect(tcRes.statusCode).toBe(201);

    // 4. Run evaluation on version 1.0.0
    const evalRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/evaluate`,
      headers: authHeaders,
      payload: {
        version: "1.0.0"
      }
    });
    expect(evalRes.statusCode).toBe(200);
    const evalData = evalRes.json();
    expect(evalData.score).toBeGreaterThanOrEqual(0.85);

    // 4b. Run evaluation with 'latest' version target (default in CLI)
    const evalLatestRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/evaluate`,
      headers: authHeaders,
      payload: {
        version: "latest"
      }
    });
    expect(evalLatestRes.statusCode).toBe(200);
    expect(evalLatestRes.json().version).toBe("1.0.0");

    // 5. Promote to staging
    const promoteStagingRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/promote`,
      headers: authHeaders,
      payload: {
        version: "1.0.0",
        environment: "staging",
        notes: "Promotion to staging for verification"
      }
    });
    expect(promoteStagingRes.statusCode).toBe(200);
    expect(promoteStagingRes.json().environmentName).toBe("staging");

    // 6. Promote to production
    const promoteProdRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/promote`,
      headers: authHeaders,
      payload: {
        version: "1.0.0",
        environment: "production",
        notes: "Production launch"
      }
    });
    expect(promoteProdRes.statusCode).toBe(200);
    expect(promoteProdRes.json().environmentName).toBe("production");

    // 7. Retrieve exact production version
    const resolveProdRes = await app.inject({
      method: "GET",
      url: `/v1/prompts/${promptName}/resolve?target=production`,
      headers: authHeaders
    });
    expect(resolveProdRes.statusCode).toBe(200);
    const resolvedProd = resolveProdRes.json();
    expect(resolvedProd.resolvedVersion).toBe("1.0.0");
    expect(resolvedProd.environment).toBe("production");

    // 8. Safe render production version
    const renderRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/render`,
      headers: authHeaders,
      payload: {
        target: "production",
        variables: {
          customer_name: "John Connor",
          issue: "Password reset"
        }
      }
    });
    expect(renderRes.statusCode).toBe(200);
    const rendered = renderRes.json();
    expect(rendered.version).toBe("1.0.0");
    expect(rendered.rendered[1].content).toBe("Customer: John Connor, Issue: Password reset");

    // 9. Create version 1.1.0
    const v11Res = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/versions`,
      headers: authHeaders,
      payload: {
        version: "1.1.0",
        template: [
          { role: "system", content: "You are an empathetic customer support specialist." },
          { role: "user", content: "Customer: {{customer_name}}, Issue: {{issue}}" }
        ],
        variables: {
          customer_name: { type: "string", required: true },
          issue: { type: "string", required: true }
        },
        changelog: "Polished system tone"
      }
    });
    expect(v11Res.statusCode).toBe(201);

    // 9b. Calling regression without candidate evaluation returns 422 NO_EVALUATION_FOUND
    const prematureRegRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/regression`,
      headers: authHeaders,
      payload: {
        baselineVersion: "1.0.0",
        candidateVersion: "1.1.0"
      }
    });
    expect(prematureRegRes.statusCode).toBe(422);
    expect(prematureRegRes.json().code).toBe("NO_EVALUATION_FOUND");

    // Evaluate 1.1.0 before regression comparison
    const eval11Res = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/evaluate`,
      headers: authHeaders,
      payload: {
        version: "1.1.0"
      }
    });
    expect(eval11Res.statusCode).toBe(200);

    // 10. Run regression tests between 1.0.0 and 1.1.0
    const regRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/regression`,
      headers: authHeaders,
      payload: {
        baselineVersion: "1.0.0",
        candidateVersion: "1.1.0",
        minimumScore: 0.85,
        maxRegression: 0.05
      }
    });
    expect(regRes.statusCode).toBe(200);
    const regData = regRes.json();
    expect(regData.passedThresholds).toBe(true);

    // 11. Promote 1.1.0 to production
    const promoteProd11 = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/promote`,
      headers: authHeaders,
      payload: {
        version: "1.1.0",
        environment: "production",
        notes: "Promoting polished v1.1.0"
      }
    });
    expect(promoteProd11.statusCode).toBe(200);

    // Verify production now resolves to 1.1.0
    const verifyProd11 = await app.inject({
      method: "GET",
      url: `/v1/prompts/${promptName}/resolve?target=production`,
      headers: authHeaders
    });
    expect(verifyProd11.json().resolvedVersion).toBe("1.1.0");

    // 12. First-class Rollback production
    const rollbackRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/rollback`,
      headers: authHeaders,
      payload: {
        environment: "production"
      }
    });
    expect(rollbackRes.statusCode).toBe(200);
    const rolledBackDep = rollbackRes.json();
    expect(rolledBackDep.version).toBe("1.0.0");
    expect(rolledBackDep.rollbackFromDeploymentId).toBeDefined();

    // 13. Verify production resolved version is restored to 1.0.0
    const verifyRestored = await app.inject({
      method: "GET",
      url: `/v1/prompts/${promptName}/resolve?target=production`,
      headers: authHeaders
    });
    expect(verifyRestored.json().resolvedVersion).toBe("1.0.0");

    // 14. Immutability check: verify published version CANNOT be modified or overwritten
    const overwriteRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/versions`,
      headers: authHeaders,
      payload: {
        version: "1.0.0",
        template: "Tampered content",
        variables: {}
      }
    });
    expect(overwriteRes.statusCode).toBe(409);
    expect(overwriteRes.json().code).toBe("VERSION_IMMUTABLE");

    // 15. Verify cryptographic audit log records exist
    const auditRes = await app.inject({
      method: "GET",
      url: "/v1/audit-logs",
      headers: authHeaders
    });
    expect(auditRes.statusCode).toBe(200);
    const logs = auditRes.json();
    const actions = logs.map((l: any) => l.action);
    expect(actions).toContain("prompt.created");
    expect(actions).toContain("version.published");
    expect(actions).toContain("environment.promoted");
    expect(actions).toContain("environment.rolled_back");

    // 16. Verify pagination and limit capping
    const page1Res = await app.inject({
      method: "GET",
      url: "/v1/audit-logs?limit=2&offset=0",
      headers: authHeaders
    });
    expect(page1Res.statusCode).toBe(200);
    const page1Logs = page1Res.json();
    expect(page1Logs.length).toBe(2);

    const page2Res = await app.inject({
      method: "GET",
      url: "/v1/audit-logs?limit=2&offset=2",
      headers: authHeaders
    });
    expect(page2Res.statusCode).toBe(200);
    const page2Logs = page2Res.json();
    expect(page2Logs.length).toBeGreaterThanOrEqual(1);
    expect(page2Logs[0].id).not.toBe(page1Logs[0].id);

    // Limit cap enforcement (max 200)
    const cappedPromptRes = await app.inject({
      method: "GET",
      url: "/v1/prompts?limit=9999",
      headers: authHeaders
    });
    expect(cappedPromptRes.statusCode).toBe(200);
  });
});
