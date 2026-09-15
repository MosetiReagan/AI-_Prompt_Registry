import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import { redactObject } from "@ai-prompt-registry/core";

export function registerAuditRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/audit-logs
  app.get("/v1/audit-logs", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const query = req.query as { limit?: string | number; offset?: string | number };
    const limit = query.limit !== undefined ? Math.min(Math.max(1, Number(query.limit) || 1), 200) : 50;
    const offset = query.offset !== undefined ? Math.max(0, Number(query.offset) || 0) : 0;
    const logs = await storage.listAuditLogs(orgId, limit, offset);
    // Redact any potential secrets in audit logs
    const safeLogs = logs.map(l => redactObject(l));
    return reply.send(safeLogs);
  });
}
