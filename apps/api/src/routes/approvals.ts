import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import { Approval } from "@ai-prompt-registry/core";

export function registerApprovalRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/approvals
  app.get("/v1/approvals", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { status } = req.query as { status?: string };
    const list = await storage.listApprovals(orgId, status);
    return reply.send(list);
  });

  // POST /v1/approvals
  app.post("/v1/approvals", { preHandler: requireScope("write") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as {
      promptName: string;
      version: string;
      targetEnvironment: string;
    };

    if (!body.promptName || !body.version || !body.targetEnvironment) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "'promptName', 'version', and 'targetEnvironment' are required"
      });
    }

    const prompt = await storage.getPrompt(orgId, body.promptName);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${body.promptName}' not found` });
    }

    const verObj = await storage.getPromptVersion(orgId, prompt.id, body.version);
    if (!verObj) {
      return reply.status(404).send({ error: "Not Found", message: `Version '${body.version}' not found` });
    }

    const approval: Approval = {
      id: `appr_${randomUUID()}`,
      promptId: prompt.id,
      promptName: prompt.name,
      promptVersionId: verObj.id,
      version: verObj.version,
      targetEnvironment: body.targetEnvironment,
      requestedBy: req.identity!.name,
      status: "pending",
      reviewedBy: null,
      reviewNote: "",
      createdAt: new Date().toISOString(),
      reviewedAt: null
    };

    const created = await storage.createApproval(approval);

    await storage.createAuditLog({
      id: `audit_${randomUUID()}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "approval.requested",
      resource: { type: "approval", id: created.id, name: prompt.name, version: verObj.version },
      environment: body.targetEnvironment,
      requestId: req.requestId,
      metadata: { targetEnvironment: body.targetEnvironment },
      timestamp: new Date().toISOString()
    });

    return reply.status(201).send(created);
  });

  // POST /v1/approvals/:id/review
  app.post("/v1/approvals/:id/review", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { id } = req.params as { id: string };
    const { status, note } = req.body as { status: "approved" | "rejected"; note?: string };

    if (!["approved", "rejected"].includes(status)) {
      return reply.status(400).send({ error: "Bad Request", message: "Status must be 'approved' or 'rejected'" });
    }

    try {
      const updated = await storage.updateApproval(orgId, id, {
        status,
        reviewedBy: req.identity!.name,
        reviewNote: note || "",
        reviewedAt: new Date().toISOString()
      });

      await storage.createAuditLog({
        id: `audit_${randomUUID()}`,
        organizationId: orgId,
        actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
        action: `approval.${status}`,
        resource: { type: "approval", id: updated.id, name: updated.promptName, version: updated.version },
        environment: updated.targetEnvironment,
        requestId: req.requestId,
        metadata: { note },
        timestamp: new Date().toISOString()
      });

      return reply.send(updated);
    } catch (err: any) {
      return reply.status(404).send({ error: "Not Found", message: err.message });
    }
  });
}
