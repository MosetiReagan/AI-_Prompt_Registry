import { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope, hashApiKey } from "../middleware/auth.js";
import { ApiKey, ApiKeyScope } from "@ai-prompt-registry/core";

export function registerApiKeyRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/api-keys
  app.get("/v1/api-keys", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const keys = await storage.listApiKeys(orgId);
    return reply.send(keys);
  });

  // POST /v1/api-keys
  app.post("/v1/api-keys", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as {
      name: string;
      scopes?: ApiKeyScope[];
      expiresInDays?: number;
    };

    if (!body.name) {
      return reply.status(400).send({ error: "Bad Request", message: "Key name is required" });
    }

    // Generate random secure token
    const tokenBytes = randomBytes(24).toString("hex");
    const rawKey = `apr_live_${tokenBytes}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = hashApiKey(rawKey);

    const now = new Date();
    let expiresAt: string | null = null;
    if (body.expiresInDays) {
      expiresAt = new Date(now.getTime() + body.expiresInDays * 86400000).toISOString();
    }

    const apiKey: ApiKey = {
      id: `key_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: orgId,
      name: body.name,
      keyHash,
      keyPrefix,
      scopes: body.scopes || ["read", "execute"],
      expiresAt,
      createdAt: now.toISOString(),
      lastUsedAt: null
    };

    await storage.createApiKey(apiKey);

    await storage.createAuditLog({
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "api_key.created",
      resource: { type: "api_key", id: apiKey.id, name: apiKey.name },
      requestId: req.requestId,
      metadata: { prefix: keyPrefix, scopes: apiKey.scopes },
      timestamp: now.toISOString()
    });

    // Return the raw key ONLY once
    return reply.status(201).send({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      secretKey: rawKey // User must save this!
    });
  });

  // DELETE /v1/api-keys/:id
  app.delete("/v1/api-keys/:id", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { id } = req.params as { id: string };

    const deleted = await storage.deleteApiKey(orgId, id);
    if (!deleted) {
      return reply.status(404).send({ error: "Not Found", message: `API Key '${id}' not found` });
    }

    await storage.createAuditLog({
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "api_key.revoked",
      resource: { type: "api_key", id },
      requestId: req.requestId,
      metadata: {},
      timestamp: new Date().toISOString()
    });

    return reply.send({ success: true });
  });
}
