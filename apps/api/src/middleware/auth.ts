import { FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "crypto";
import { IRegistryStorage } from "../storage/interface.js";
import { ApiKeyScope } from "@ai-prompt-registry/core";

export interface AuthenticatedIdentity {
  id: string;
  name: string;
  organizationId: string;
  type: "api_key" | "user" | "anonymous";
  scopes: ApiKeyScope[];
}

declare module "fastify" {
  interface FastifyRequest {
    identity?: AuthenticatedIdentity;
    requestId: string;
  }
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

let hasWarnedAnonymous = false;

export function authMiddleware(storage: IRegistryStorage) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Generate request ID
    req.requestId = (req.headers["x-request-id"] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Public health and readiness endpoints do not require authentication
    const url = req.url.split("?")[0];
    if (url === "/health" || url === "/ready") {
      req.identity = {
        id: "public",
        name: "Public",
        organizationId: "default",
        type: "anonymous",
        scopes: ["read"]
      };
      return;
    }

    const authHeader = req.headers["authorization"] || (req.headers["x-api-key"] as string);

    if (authHeader) {
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (authHeader as string).trim();
      const hash = hashApiKey(token);

      const apiKey = await storage.findApiKeyByHash(hash);
      if (!apiKey) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Invalid API key",
          code: "INVALID_API_KEY"
        });
      }

      // Enforce API key expiration
      if (apiKey.expiresAt) {
        const expiryTime = new Date(apiKey.expiresAt).getTime();
        if (expiryTime < Date.now()) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "API key has expired",
            code: "EXPIRED_API_KEY"
          });
        }
      }

      // Update lastUsedAt timestamp asynchronously
      const nowIso = new Date().toISOString();
      apiKey.lastUsedAt = nowIso;
      storage.updateApiKeyLastUsed(apiKey.id, nowIso).catch((err) => {
        req.log?.warn?.(`Failed to update lastUsedAt for API key ${apiKey.id}: ${err}`);
      });

      req.identity = {
        id: apiKey.id,
        name: apiKey.name,
        organizationId: apiKey.organizationId,
        type: "api_key",
        scopes: apiKey.scopes
      };
      return;
    }

    // Check if anonymous access is explicitly allowed via environment variable
    if (process.env.ALLOW_ANONYMOUS === "true") {
      if (!hasWarnedAnonymous) {
        hasWarnedAnonymous = true;
        console.warn("⚠️ SECURITY WARNING: ALLOW_ANONYMOUS is enabled. Unauthenticated requests are permitted with read and execute scopes only.");
      }

      req.identity = {
        id: "anon-dev",
        name: "Anonymous User",
        organizationId: (req.headers["x-organization-id"] as string) || "default",
        type: "anonymous",
        scopes: ["read", "execute"] // NEVER admin, write, or publish
      };
      return;
    }

    return reply.status(401).send({
      error: "Unauthorized",
      message: "Authentication required. Provide an API key via Authorization: Bearer <key> header.",
      code: "AUTHENTICATION_REQUIRED"
    });
  };
}

export function requireScope(scope: ApiKeyScope) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.identity) {
      return reply.status(401).send({ error: "Unauthorized", message: "Authentication required" });
    }

    if (!req.identity.scopes.includes(scope) && !req.identity.scopes.includes("admin")) {
      return reply.status(403).send({
        error: "Forbidden",
        message: `Insufficient permissions. Required scope: '${scope}'`,
        code: "INSUFFICIENT_SCOPE"
      });
    }
  };
}
