import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../../apps/api/src/server.js";
import { MemoryStorage } from "../../apps/api/src/storage/memory.js";

describe("End-to-End Prompt Registry Lifecycle", () => {
  let app: FastifyInstance;
  let storage: MemoryStorage;

  beforeAll(async () => {
    storage = new MemoryStorage();
    app = await buildServer({ storage, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("completes full production lifecycle: create -> version -> test -> evaluate -> publish -> promote -> resolve -> rollback", async () => {
    const promptName = "customer-support.reply";

    // 1. Create prompt
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/prompts",
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

    // 3. Add test case
    const tcRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/test-cases`,
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
      payload: {
        version: "1.0.0"
      }
    });
    expect(evalRes.statusCode).toBe(200);
    const evalData = evalRes.json();
    expect(evalData.score).toBeGreaterThanOrEqual(0.85);

    // 5. Promote to staging
    const promoteStagingRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/promote`,
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
      url: `/v1/prompts/${promptName}/resolve?target=production`
    });
    expect(resolveProdRes.statusCode).toBe(200);
    const resolvedProd = resolveProdRes.json();
    expect(resolvedProd.resolvedVersion).toBe("1.0.0");
    expect(resolvedProd.environment).toBe("production");

    // 8. Safe render production version
    const renderRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/render`,
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

    // 10. Run regression tests between 1.0.0 and 1.1.0
    const regRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/regression`,
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
      url: `/v1/prompts/${promptName}/resolve?target=production`
    });
    expect(verifyProd11.json().resolvedVersion).toBe("1.1.0");

    // 12. First-class Rollback production
    const rollbackRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/rollback`,
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
      url: `/v1/prompts/${promptName}/resolve?target=production`
    });
    expect(verifyRestored.json().resolvedVersion).toBe("1.0.0");

    // 14. Immutability check: verify published version CANNOT be modified or overwritten
    const overwriteRes = await app.inject({
      method: "POST",
      url: `/v1/prompts/${promptName}/versions`,
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
      url: "/v1/audit-logs"
    });
    expect(auditRes.statusCode).toBe(200);
    const logs = auditRes.json();
    const actions = logs.map((l: any) => l.action);
    expect(actions).toContain("prompt.created");
    expect(actions).toContain("version.published");
    expect(actions).toContain("environment.promoted");
    expect(actions).toContain("environment.rolled_back");
  });
});
