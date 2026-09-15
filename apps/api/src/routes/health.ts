import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";

export function registerHealthRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  app.get("/health", async (_req, reply) => {
    return reply.send({
      status: "ok",
      name: "ai-prompt-registry",
      version: "1.0.0",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/ready", async (_req, reply) => {
    try {
      // Check storage responsiveness
      await storage.listEnvironments("default");
      return reply.send({
        status: "ready",
        database: "connected",
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      return reply.status(503).send({
        status: "not_ready",
        error: err.message
      });
    }
  });
}
