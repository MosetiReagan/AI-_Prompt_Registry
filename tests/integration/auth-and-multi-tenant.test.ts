import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../../apps/api/src/server.js";
import { MemoryStorage } from "../../apps/api/src/storage/memory.js";

import { hashApiKey } from "../../apps/api/src/middleware/auth.js";

describe("Security, Scopes, and Multi-Tenant Isolation", () => {
  let app: FastifyInstance;
  let storage: MemoryStorage;

  const adminApiKey = "apr_live_bootstrap_admin_key";
  const adminHeaders = { authorization: `Bearer ${adminApiKey}` };

  beforeAll(async () => {
    storage = new MemoryStorage();
    storage.seedDefaults("org-a");
    storage.seedDefaults("org-b");

    // Provision bootstrap admin key
    await storage.createApiKey({
      id: "key_bootstrap",
      organizationId: "org-a",
      name: "Bootstrap Admin",
      keyHash: hashApiKey(adminApiKey),
      keyPrefix: "apr_live_boo",
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

  it("creates hashed API keys and authenticates valid requests", async () => {
    // 1. Create API key for org-a using admin key
    const createKeyRes = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { ...adminHeaders, "x-organization-id": "org-a" },
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
      headers: { ...adminHeaders, "x-organization-id": "org-a" },
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
      headers: { ...adminHeaders, "x-organization-id": "org-a" }
    });
    expect(readOrgA.statusCode).toBe(200);

    const orgBKey = "apr_live_org_b_test_key";
    await storage.createApiKey({
      id: "key_org_b",
      organizationId: "org-b",
      name: "Org B Key",
      keyHash: hashApiKey(orgBKey),
      keyPrefix: "apr_live_org",
      scopes: ["read", "write"],
      expiresAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });

    // Org B CANNOT read Org A's prompt (404 isolated)
    const readOrgB = await app.inject({
      method: "GET",
      url: "/v1/prompts/org-a.private-prompt",
      headers: { authorization: `Bearer ${orgBKey}` }
    });
    expect(readOrgB.statusCode).toBe(404);
  });

  it("blocks policy violations during publishing (e.g. hardcoded secrets)", async () => {
    // Attempt to publish prompt version containing an OpenAI API key
    await app.inject({
      method: "POST",
      url: "/v1/prompts",
      headers: { ...adminHeaders, "x-organization-id": "org-a" },
      payload: { name: "leaky-prompt" }
    });

    const leakRes = await app.inject({
      method: "POST",
      url: "/v1/prompts/leaky-prompt/versions",
      headers: { ...adminHeaders, "x-organization-id": "org-a" },
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

  it("enforces API key expiration and updates lastUsedAt", async () => {
    // 1. Create an already-expired API key
    const expiredRawKey = "apr_live_expired_test_key_123";
    const pastDate = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    await storage.createApiKey({
      id: "key_expired",
      organizationId: "org-a",
      name: "Expired Key",
      keyHash: hashApiKey(expiredRawKey),
      keyPrefix: "apr_live_exp",
      scopes: ["read"],
      expiresAt: pastDate,
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      lastUsedAt: null
    });

    // Request with expired key must be rejected with 401 EXPIRED_API_KEY
    const expiredRes = await app.inject({
      method: "GET",
      url: "/v1/prompts",
      headers: { authorization: `Bearer ${expiredRawKey}` }
    });
    expect(expiredRes.statusCode).toBe(401);
    expect(expiredRes.json().code).toBe("EXPIRED_API_KEY");

    // 2. Create valid active key with null lastUsedAt
    const validRawKey = "apr_live_active_test_key_456";
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day in future
    const activeKey = await storage.createApiKey({
      id: "key_active_usage",
      organizationId: "org-a",
      name: "Active Key",
      keyHash: hashApiKey(validRawKey),
      keyPrefix: "apr_live_act",
      scopes: ["read"],
      expiresAt: futureDate,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });
    expect(activeKey.lastUsedAt).toBeNull();

    // Authenticate with active key
    const validRes = await app.inject({
      method: "GET",
      url: "/v1/prompts",
      headers: { authorization: `Bearer ${validRawKey}` }
    });
    expect(validRes.statusCode).toBe(200);

    // Verify lastUsedAt was updated
    const retrievedKey = await storage.findApiKeyByHash(hashApiKey(validRawKey));
    expect(retrievedKey?.lastUsedAt).toBeDefined();
    expect(retrievedKey?.lastUsedAt).not.toBeNull();
  });

  it("prevents cross-tenant access to approvals and prompt versions", async () => {
    // Org A creates prompt and version
    const p = await storage.createPrompt({
      id: "prompt-tenant-a",
      organizationId: "org-a",
      name: "tenant-a-prompt",
      description: "Tenant A secret prompt",
      tags: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await storage.createPromptVersion({
      id: "pv-tenant-a-1",
      promptId: p.id,
      version: "1.0.0",
      content: { template: "tenant a secret content" },
      variablesSchema: {},
      format: "text",
      checksum: "abc12345",
      lifecycleState: "published",
      metadata: {},
      createdAt: new Date().toISOString(),
      createdBy: "org-a-user"
    });

    const approval = await storage.createApproval({
      id: "appr-tenant-a-1",
      promptId: p.id,
      promptName: p.name,
      promptVersionId: "pv-tenant-a-1",
      version: "1.0.0",
      targetEnvironment: "production",
      requestedBy: "org-a-user",
      status: "pending",
      reviewedBy: null,
      reviewNote: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null
    });

    // Org B storage queries should return null / empty
    const orgBVersion = await storage.getPromptVersion("org-b", p.id, "1.0.0");
    expect(orgBVersion).toBeNull();

    const orgBVersions = await storage.listPromptVersions("org-b", p.id);
    expect(orgBVersions).toHaveLength(0);

    const orgBApproval = await storage.getApproval("org-b", approval.id);
    expect(orgBApproval).toBeNull();

    const orgBApprovals = await storage.listApprovals("org-b");
    expect(orgBApprovals).toHaveLength(0);

    // Org A queries succeed
    const orgAApproval = await storage.getApproval("org-a", approval.id);
    expect(orgAApproval).not.toBeNull();
    expect(orgAApproval?.id).toBe(approval.id);

    const orgAApprovals = await storage.listApprovals("org-a");
    expect(orgAApprovals.some(a => a.id === approval.id)).toBe(true);
  });

  it("does not silently fall back to memory when DATABASE_URL is invalid", async () => {
    const { getStorage, setStorage } = await import("../../apps/api/src/storage/index.js");
    setStorage(null);
    const originalDbUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://invalid-user:bad-pass@127.0.0.1:54399/nonexistent";

    try {
      // PostgresStorage pool query or connection error should throw or reject
      const storageInstance = await getStorage();
      // Verifying that it created PostgresStorage and not MemoryStorage
      expect(storageInstance.constructor.name).toBe("PostgresStorage");
    } finally {
      process.env.DATABASE_URL = originalDbUrl;
      setStorage(storage);
    }
  });
});

