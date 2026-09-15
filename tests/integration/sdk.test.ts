import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildServer } from "../../apps/api/src/server.js";
import { MemoryStorage } from "../../apps/api/src/storage/memory.js";
import { PromptRegistry } from "@ai-prompt-registry/sdk";

describe("TypeScript SDK Integration", () => {
  let app: FastifyInstance;
  let client: PromptRegistry;

  beforeAll(async () => {
    const storage = new MemoryStorage();
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
});
