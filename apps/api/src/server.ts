import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { IRegistryStorage } from "./storage/interface.js";
import { getStorage } from "./storage/index.js";
import { authMiddleware } from "./middleware/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPromptRoutes } from "./routes/prompts.js";
import { registerVersionRoutes } from "./routes/versions.js";
import { registerEnvironmentRoutes } from "./routes/environments.js";
import { registerEvaluationRoutes } from "./routes/evaluations.js";
import { registerPolicyRoutes } from "./routes/policies.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerApiKeyRoutes } from "./routes/apikeys.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerPlaygroundRoutes } from "./routes/playground.js";

export async function buildServer(options: { storage?: IRegistryStorage; logger?: boolean } = {}): Promise<FastifyInstance> {
  const storage = options.storage || (await getStorage());

  const app = fastify({
    logger: options.logger ?? false
  });

  // Register Security Headers (Helmet)
  await app.register(helmet, {
    contentSecurityPolicy: false
  });

  // Register Rate Limiter
  await app.register(rateLimit, {
    max: parseInt(process.env.RATE_LIMIT_MAX || "1000", 10),
    timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute"
  });

  // Enable CORS with configurable allowlist
  const corsOrigin = process.env.CORS_ORIGIN;
  const origin = corsOrigin
    ? (corsOrigin.includes(",") ? corsOrigin.split(",").map(s => s.trim()) : corsOrigin)
    : "*";

  await app.register(cors, {
    origin,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  // Global Auth & Context Middleware
  app.addHook("onRequest", authMiddleware(storage));

  // Register Routes
  registerHealthRoutes(app, storage);
  registerPromptRoutes(app, storage);
  registerVersionRoutes(app, storage);
  registerEnvironmentRoutes(app, storage);
  registerEvaluationRoutes(app, storage);
  registerPolicyRoutes(app, storage);
  registerApprovalRoutes(app, storage);
  registerAuditRoutes(app, storage);
  registerApiKeyRoutes(app, storage);
  registerAnalyticsRoutes(app, storage);
  registerPlaygroundRoutes(app, storage);

  return app;
}
