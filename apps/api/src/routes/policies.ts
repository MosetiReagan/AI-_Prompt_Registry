import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import { Policy, PolicyEngine } from "@ai-prompt-registry/core";

export function registerPolicyRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/policies
  app.get("/v1/policies", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const policy = await storage.getPolicy(orgId);
    return reply.send(policy);
  });

  // PUT /v1/policies
  app.put("/v1/policies", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as Partial<Policy>;

    const existing = await storage.getPolicy(orgId);
    const policy: Policy = {
      id: existing?.id || `pol_${randomUUID()}`,
      organizationId: orgId,
      name: body.name || existing?.name || "Organization Policy",
      description: body.description || existing?.description || "",
      rules: {
        ...(existing?.rules || {
          requireDescription: false,
          requireOwner: false,
          forbidSecrets: true,
          immutablePublished: true,
          production: {
            requireEvaluation: true,
            minimumScore: 0.85,
            maxRegression: 0.05,
            requireApproval: false
          }
        }),
        ...(body.rules || {})
      },
      enabled: body.enabled ?? (existing?.enabled ?? true),
      updatedAt: new Date().toISOString(),
      updatedBy: req.identity!.name
    };

    const saved = await storage.savePolicy(policy);

    await storage.createAuditLog({
      id: `audit_${randomUUID()}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "policy.updated",
      resource: { type: "policy", id: saved.id, name: saved.name },
      requestId: req.requestId,
      metadata: { rules: saved.rules },
      timestamp: new Date().toISOString()
    });

    return reply.send(saved);
  });

  // POST /v1/prompts/:name/policy-check
  app.post("/v1/prompts/:name/policy-check", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { version, environment } = req.body as { version: string; environment?: string };

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const verObj = await storage.getPromptVersion(orgId, prompt.id, version);
    if (!verObj) {
      return reply.status(404).send({ error: "Not Found", message: `Version '${version}' not found for prompt '${name}'` });
    }

    const policy = await storage.getPolicy(orgId);

    const publishCheck = PolicyEngine.checkPublish(prompt, verObj, policy);
    let promotionCheck = null;

    if (environment) {
      const latestEval = await storage.getLatestEvaluation(orgId, prompt.id, version);
      const approvals = await storage.listApprovals(orgId, "approved");
      const approved = approvals.find(
        a => a.promptId === prompt.id && a.version === version && a.targetEnvironment === environment
      );
      promotionCheck = PolicyEngine.checkPromotion(environment, verObj, policy, {
        latestEvaluation: latestEval,
        approvedApproval: approved
      });
    }

    return reply.send({
      promptName: name,
      version,
      environment,
      publishCheck,
      promotionCheck
    });
  });
}
