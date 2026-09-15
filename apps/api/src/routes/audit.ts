import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import { redactObject } from "@ai-prompt-registry/core";

export function registerAuditRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/audit-logs
  app.get("/v1/audit-logs", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { limit = 100 } = req.query as { limit?: number };
    const logs = await storage.listAuditLogs(orgId, Number(limit));
    // Redact any potential secrets in audit logs
    const safeLogs = logs.map(l => redactObject(l));
    return reply.send(safeLogs);
  });
}
