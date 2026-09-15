import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../../apps/api/src/server.js";
import { MemoryStorage } from "../../apps/api/src/storage/memory.js";
import { PromptRegistry } from "@ai-prompt-registry/sdk";

import { hashApiKey } from "../../apps/api/src/middleware/auth.js";

describe("TypeScript SDK Integration", () => {
  let app: FastifyInstance;
  let client: PromptRegistry;

  beforeAll(async () => {
    const storage = new MemoryStorage();
    const sdkApiKey = "apr_live_sdk_test_key";
    await storage.createApiKey({
      id: "key_sdk",
      organizationId: "default",
      name: "SDK Test Key",
      keyHash: hashApiKey(sdkApiKey),
      keyPrefix: "apr_live_sdk",
      scopes: ["read", "write", "publish", "admin", "execute"],
      expiresAt: null,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    });

    app = await buildServer({ storage, logger: false });
    await app.ready();

    // Setup custom fetch adapter to route directly through Fastify inject
    const customFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === "string" ? input : (input as Request).url;
      const parsedUrl = new URL(urlStr, "http://localhost:3000");

      const response = await app.inject({
        method: (init?.method as any) || "GET",
        url: parsedUrl.pathname + parsedUrl.search,
        headers: (init?.headers as Record<string, string>) || {},
        payload: init?.body ? String(init.body) : undefined
      });

      return new Response(response.body, {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: response.headers as any
      });
    };

    client = new PromptRegistry({
      baseUrl: "http://localhost:3000",
      apiKey: sdkApiKey,
      fetch: customFetch
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates prompt, publishes version, and resolves via SDK", async () => {
    const promptName = "sdk-test.greeting";

    // 1. Create prompt
    const p = await client.createPrompt({
      name: promptName,
      description: "SDK test prompt"
    });
    expect(p.name).toBe(promptName);

    // 2. Publish version 1.0.0
    const v = await client.publishVersion(promptName, {
      version: "1.0.0",
      template: "Hello {{name}}, order #{{order_id}} confirmed.",
      variables: {
        name: { type: "string", required: true },
        order_id: { type: "number", required: true }
      },
      changelog: "SDK test release"
    });
    expect(v.version).toBe("1.0.0");

    // 2b. Create test case with assertions
    await client.createTestCase(promptName, {
      name: "Order greeting test",
      inputs: { name: "Alice", order_id: 42 },
      expectedProperties: {
        contains: ["order #42"]
      }
    });

    // 3. Evaluate prompt before promotion to satisfy production policy
    const ev = await client.evaluate(promptName, "1.0.0");
    expect(ev.score).toBeGreaterThanOrEqual(0.85);

    // 4. Promote to production
    await client.promote(promptName, "1.0.0", "production");

    // 4. Resolve via get()
    const resolved = await client.get(promptName, "production");
    expect(resolved.resolvedVersion).toBe("1.0.0");

    // 5. Render via render()
    const rendered = await client.render(promptName, {
      name: "Neo",
      order_id: 101
    });
    expect(rendered.rendered).toBe("Hello Neo, order #101 confirmed.");
    expect(rendered.version).toBe("1.0.0");

    // 6. Check telemetry headers
    const headers = client.getTelemetryHeaders(promptName, "1.0.0", "production");
    expect(headers["x-prompt-name"]).toBe(promptName);
    expect(headers["x-prompt-version"]).toBe("1.0.0");
    expect(headers["x-prompt-environment"]).toBe("production");
  });

  it("retries on transient 5xx errors and succeeds upon recovery", async () => {
    let callCount = 0;
    const retryFetch: typeof fetch = async () => {
      callCount++;
      if (callCount < 3) {
        return new Response(JSON.stringify({ message: "Service Unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify([{ id: "p1", name: "recovered-prompt" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const retryClient = new PromptRegistry({
      baseUrl: "http://localhost:3000",
      fetch: retryFetch,
      maxRetries: 3,
      retryInitialDelayMs: 10
    });

    const result = await retryClient.listPrompts();
    expect(callCount).toBe(3);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("recovered-prompt");
  });

  it("retries network failures and surfaces error when retries are exhausted", async () => {
    let callCount = 0;
    const failFetch: typeof fetch = async () => {
      callCount++;
      throw new Error("Connection reset by peer");
    };

    const failClient = new PromptRegistry({
      baseUrl: "http://localhost:3000",
      fetch: failFetch,
      maxRetries: 2,
      retryInitialDelayMs: 10
    });

    await expect(failClient.listPrompts()).rejects.toThrow("Connection reset by peer");
    expect(callCount).toBe(3); // 1 initial + 2 retries
  });

  it("aborts when request exceeds timeoutMs", async () => {
    const slowFetch: typeof fetch = async (_input, init) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response("[]", { status: 200 }));
        }, 500);

        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("The operation was aborted");
            err.name = "TimeoutError";
            reject(err);
          });
        }
      });
    };

    const timeoutClient = new PromptRegistry({
      baseUrl: "http://localhost:3000",
      fetch: slowFetch,
      timeoutMs: 50,
      maxRetries: 1,
      retryInitialDelayMs: 10
    });

    await expect(timeoutClient.listPrompts()).rejects.toThrow();
  });
});
