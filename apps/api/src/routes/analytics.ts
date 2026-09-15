import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import { UsageEvent, UsageEventSchema } from "@ai-prompt-registry/core";

export function registerAnalyticsRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // POST /v1/analytics/usage
  app.post("/v1/analytics/usage", { preHandler: requireScope("execute") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as Partial<UsageEvent>;

    const event: UsageEvent = {
      id: `evt_${randomUUID()}`,
      promptName: body.promptName || "unknown",
      promptVersion: body.promptVersion || "1.0.0",
      environment: body.environment || "production",
      latencyMs: body.latencyMs ?? 0,
      promptTokens: body.promptTokens,
      completionTokens: body.completionTokens,
      totalTokens: (body.promptTokens || 0) + (body.completionTokens || 0),
      estimatedCost: body.estimatedCost,
      success: body.success ?? true,
      errorCode: body.errorCode,
      organizationId: orgId,
      timestamp: new Date().toISOString()
    };

    const parsed = UsageEventSchema.safeParse(event);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid usage event data" });
    }

    await storage.recordUsageEvent(event);
    return reply.status(202).send({ success: true, eventId: event.id });
  });

  // GET /v1/analytics/overview
  app.get("/v1/analytics/overview", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const overview = await storage.getUsageOverview(orgId);
    return reply.send(overview);
  });
}
