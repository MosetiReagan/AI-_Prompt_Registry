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

export function authMiddleware(storage: IRegistryStorage) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Generate request ID
    req.requestId = (req.headers["x-request-id"] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const authHeader = req.headers["authorization"] || (req.headers["x-api-key"] as string);

    if (authHeader) {
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : (authHeader as string).trim();
      const hash = hashApiKey(token);

      const apiKey = await storage.findApiKeyByHash(hash);
      if (!apiKey) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Invalid or expired API key",
          code: "INVALID_API_KEY"
        });
      }

      req.identity = {
        id: apiKey.id,
        name: apiKey.name,
        organizationId: apiKey.organizationId,
        type: "api_key",
        scopes: apiKey.scopes
      };
      return;
    }

    // Default development/anonymous identity
    req.identity = {
      id: "anon-dev",
      name: "Developer",
      organizationId: (req.headers["x-organization-id"] as string) || "default",
      type: "anonymous",
      scopes: ["read", "write", "publish", "admin", "execute"]
    };
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
