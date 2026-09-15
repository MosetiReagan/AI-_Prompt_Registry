import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import {
  Prompt,
  PromptSchema,
  renderPrompt,
  TemplateRenderError,
  AuditLog
} from "@ai-prompt-registry/core";

export function registerPromptRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/prompts
  app.get("/v1/prompts", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const query = req.query as { search?: string; tag?: string; status?: string };
    const prompts = await storage.listPrompts(orgId, query);
    return reply.send(prompts);
  });

  // POST /v1/prompts
  app.post("/v1/prompts", { preHandler: requireScope("write") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as any;

    const parsed = PromptSchema.partial({
      id: true,
      slug: true,
      createdAt: true,
      updatedAt: true,
      organizationId: true
    }).safeParse(body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Validation failed",
        issues: parsed.error.issues
      });
    }

    const now = new Date().toISOString();
    const prompt: Prompt = {
      id: `prompt_${randomUUID()}`,
      name: parsed.data.name!,
      slug: parsed.data.name!.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      description: parsed.data.description || "",
      type: parsed.data.type || "chat",
      status: parsed.data.status || "active",
      tags: parsed.data.tags || [],
      owner: parsed.data.owner || req.identity!.name,
      team: parsed.data.team,
      organizationId: orgId,
      projectId: parsed.data.projectId || "default",
      createdAt: now,
      updatedAt: now,
      metadata: parsed.data.metadata || {}
    };

    try {
      const created = await storage.createPrompt(prompt);

      // Audit Log
      await storage.createAuditLog({
        id: `audit_${randomUUID()}`,
        organizationId: orgId,
        actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
        action: "prompt.created",
        resource: { type: "prompt", id: created.id, name: created.name },
        requestId: req.requestId,
        metadata: { type: created.type },
        timestamp: now
      });

      return reply.status(201).send(created);
    } catch (err: any) {
      return reply.status(409).send({ error: "Conflict", message: err.message });
    }
  });

  // GET /v1/prompts/:name
  app.get("/v1/prompts/:name", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    // Attach latest production deployment version if any
    const prodDep = await storage.getLatestDeployment(orgId, prompt.id, "production");
    const stagingDep = await storage.getLatestDeployment(orgId, prompt.id, "staging");

    return reply.send({
      ...prompt,
      activeDeployments: {
        production: prodDep ? prodDep.version : null,
        staging: stagingDep ? stagingDep.version : null
      }
    });
  });

  // PUT /v1/prompts/:name
  app.put("/v1/prompts/:name", { preHandler: requireScope("write") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const body = req.body as any;

    try {
      const updated = await storage.updatePrompt(orgId, name, {
        description: body.description,
        status: body.status,
        tags: body.tags,
        owner: body.owner,
        team: body.team,
        metadata: body.metadata
      });

      return reply.send(updated);
    } catch (err: any) {
      return reply.status(404).send({ error: "Not Found", message: err.message });
    }
  });

  // DELETE /v1/prompts/:name
  app.delete("/v1/prompts/:name", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };

    const deleted = await storage.deletePrompt(orgId, name);
    if (!deleted) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    await storage.createAuditLog({
      id: `audit_${randomUUID()}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "prompt.deleted",
      resource: { type: "prompt", id: name, name },
      requestId: req.requestId,
      metadata: {},
      timestamp: new Date().toISOString()
    });

    return reply.send({ success: true });
  });

  // GET /v1/prompts/:name/resolve?target=production|1.0.0|canary
  app.get("/v1/prompts/:name/resolve", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { target = "production" } = req.query as { target?: string };

    const resolved = await storage.resolveVersion(orgId, name, target);
    if (!resolved) {
      return reply.status(404).send({
        error: "Not Found",
        message: `Could not resolve target '${target}' for prompt '${name}'`
      });
    }

    return reply.send({
      prompt: resolved.prompt,
      version: resolved.version,
      resolvedVersion: resolved.version.version,
      environment: resolved.environment
    });
  });

  // POST /v1/prompts/:name/render
  app.post("/v1/prompts/:name/render", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const body = req.body as {
      variables?: Record<string, any>;
      target?: string;
      strict?: boolean;
    };

    const target = body?.target || "production";
    const resolved = await storage.resolveVersion(orgId, name, target);

    if (!resolved) {
      return reply.status(404).send({
        error: "Not Found",
        message: `Could not resolve target '${target}' for prompt '${name}'`
      });
    }

    try {
      const renderResult = renderPrompt(
        resolved.version.template,
        body?.variables || {},
        resolved.version.variables,
        { strict: body?.strict }
      );

      return reply.send({
        promptName: name,
        version: resolved.version.version,
        environment: resolved.environment,
        ...renderResult
      });
    } catch (err: any) {
      if (err instanceof TemplateRenderError) {
        return reply.status(422).send({
          error: "Unprocessable Entity",
          code: err.code,
          message: err.message,
          missingVariables: err.missingVariables,
          invalidVariables: err.invalidVariables
        });
      }
      return reply.status(500).send({ error: "Internal Server Error", message: err.message });
    }
  });
}
