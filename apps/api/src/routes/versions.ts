import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import {
  PromptVersion,
  PromptVersionSchema,
  computePromptChecksum,
  PolicyEngine,
  computePromptDiff
} from "@ai-prompt-registry/core";

export function registerVersionRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/prompts/:name/versions
  app.get("/v1/prompts/:name/versions", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const versions = await storage.listPromptVersions(orgId, prompt.id);
    return reply.send(versions);
  });

  // GET /v1/prompts/:name/versions/:version
  app.get("/v1/prompts/:name/versions/:version", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name, version } = req.params as { name: string; version: string };

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const v = await storage.getPromptVersion(orgId, prompt.id, version);
    if (!v) {
      return reply.status(404).send({ error: "Not Found", message: `Version '${version}' not found for prompt '${name}'` });
    }

    return reply.send(v);
  });

  // POST /v1/prompts/:name/versions
  app.post("/v1/prompts/:name/versions", { preHandler: requireScope("publish") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const body = req.body as any;

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const checksum = computePromptChecksum({
      name,
      version: body.version,
      template: body.template,
      variables: body.variables,
      outputSchema: body.outputSchema
    });

    const now = new Date().toISOString();
    const candidateVersion: PromptVersion = {
      id: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      promptId: prompt.id,
      version: body.version,
      lifecycleState: body.lifecycleState || "published",
      template: body.template,
      variables: body.variables || {},
      outputSchema: body.outputSchema,
      modelPreferences: body.modelPreferences,
      author: body.author || req.identity!.name,
      changelog: body.changelog || "",
      checksum,
      publishedAt: (body.lifecycleState || "published") === "published" ? now : null,
      createdAt: now,
      metadata: body.metadata || {}
    };

    const parsed = PromptVersionSchema.safeParse(candidateVersion);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid prompt version format",
        issues: parsed.error.issues
      });
    }

    // Check organization policy
    const policy = await storage.getPolicy(orgId);
    const policyCheck = PolicyEngine.checkPublish(prompt, candidateVersion, policy);
    if (!policyCheck.allowed) {
      return reply.status(422).send({
        error: "Policy Violation",
        code: "POLICY_VIOLATION",
        message: "Version does not meet organization policy criteria",
        violations: policyCheck.violations
      });
    }

    try {
      const created = await storage.createPromptVersion(candidateVersion);

      // Audit Log
      await storage.createAuditLog({
        id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: orgId,
        actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
        action: "version.published",
        resource: { type: "prompt_version", id: created.id, name: prompt.name, version: created.version },
        requestId: req.requestId,
        metadata: { checksum: created.checksum, changelog: created.changelog },
        timestamp: now
      });

      return reply.status(201).send(created);
    } catch (err: any) {
      return reply.status(409).send({
        error: "Conflict",
        code: "VERSION_IMMUTABLE",
        message: err.message
      });
    }
  });

  // GET /v1/prompts/:name/diff?from=1.0.0&to=1.1.0
  app.get("/v1/prompts/:name/diff", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { from, to } = req.query as { from?: string; to?: string };

    if (!from || !to) {
      return reply.status(400).send({ error: "Bad Request", message: "Query parameters 'from' and 'to' are required" });
    }

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const vFrom = await storage.getPromptVersion(orgId, prompt.id, from);
    const vTo = await storage.getPromptVersion(orgId, prompt.id, to);

    if (!vFrom) {
      return reply.status(404).send({ error: "Not Found", message: `Baseline version '${from}' not found` });
    }
    if (!vTo) {
      return reply.status(404).send({ error: "Not Found", message: `Candidate version '${to}' not found` });
    }

    const diff = computePromptDiff(vFrom, vTo);
    return reply.send(diff);
  });
}
