import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../../apps/api/src/server.js";
import { MemoryStorage } from "../../apps/api/src/storage/memory.js";

describe("Security, Scopes, and Multi-Tenant Isolation", () => {
  let app: FastifyInstance;
  let storage: MemoryStorage;

  beforeAll(async () => {
    storage = new MemoryStorage();
    storage.seedDefaults("org-a");
    storage.seedDefaults("org-b");

    app = await buildServer({ storage, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates hashed API keys and authenticates valid requests", async () => {
    // 1. Create API key for org-a
    const createKeyRes = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { "x-organization-id": "org-a" },
      payload: {
        name: "Test CI Key",
        scopes: ["read", "write", "publish"]
      }
    });
    expect(createKeyRes.statusCode).toBe(201);
    const keyData = createKeyRes.json();
    expect(keyData.secretKey).toBeDefined();
    expect(keyData.secretKey.startsWith("apr_live_")).toBe(true);

    const secretKey = keyData.secretKey;

    // 2. Use valid API key
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/prompts",
      headers: {
        authorization: `Bearer ${secretKey}`
      }
    });
    expect(listRes.statusCode).toBe(200);

    // 3. Reject invalid API key
    const invalidRes = await app.inject({
      method: "GET",
      url: "/v1/prompts",
      headers: {
        authorization: "Bearer apr_live_invalidkey123456"
      }
    });
    expect(invalidRes.statusCode).toBe(401);
    expect(invalidRes.json().code).toBe("INVALID_API_KEY");
  });

  it("enforces strict multi-tenant boundary isolation", async () => {
    // Create prompt in org-a
    const pRes = await app.inject({
      method: "POST",
      url: "/v1/prompts",
      headers: { "x-organization-id": "org-a" },
      payload: {
        name: "org-a.private-prompt",
        description: "Confidential prompt for Org A"
      }
    });
    expect(pRes.statusCode).toBe(201);

    // Org A can read it
    const readOrgA = await app.inject({
      method: "GET",
      url: "/v1/prompts/org-a.private-prompt",
      headers: { "x-organization-id": "org-a" }
    });
    expect(readOrgA.statusCode).toBe(200);

    // Org B CANNOT read it (404 isolated)
    const readOrgB = await app.inject({
      method: "GET",
      url: "/v1/prompts/org-a.private-prompt",
      headers: { "x-organization-id": "org-b" }
    });
    expect(readOrgB.statusCode).toBe(404);
  });

  it("blocks policy violations during publishing (e.g. hardcoded secrets)", async () => {
    // Attempt to publish prompt version containing an OpenAI API key
    await app.inject({
      method: "POST",
      url: "/v1/prompts",
      headers: { "x-organization-id": "org-a" },
      payload: { name: "leaky-prompt" }
    });

    const leakRes = await app.inject({
      method: "POST",
      url: "/v1/prompts/leaky-prompt/versions",
      headers: { "x-organization-id": "org-a" },
      payload: {
        version: "1.0.0",
        template: "System key: sk-live1234567890abcdef1234567890",
        variables: {}
      }
    });

    expect(leakRes.statusCode).toBe(422);
    expect(leakRes.json().code).toBe("POLICY_VIOLATION");
    expect(leakRes.json().violations.some((v: any) => v.rule === "forbidSecrets")).toBe(true);
  });
});
