import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import {
  Deployment,
  PolicyEngine,
  Environment
} from "@ai-prompt-registry/core";

export function registerEnvironmentRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/environments
  app.get("/v1/environments", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const envs = await storage.listEnvironments(orgId);
    return reply.send(envs);
  });

  // POST /v1/environments
  app.post("/v1/environments", { preHandler: requireScope("admin") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as Partial<Environment>;

    if (!body.name) {
      return reply.status(400).send({ error: "Bad Request", message: "Environment name is required" });
    }

    const env: Environment = {
      id: `env_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: body.name.toLowerCase().trim(),
      description: body.description || "",
      organizationId: orgId,
      projectId: "default",
      isProtected: body.isProtected ?? (body.name.toLowerCase() === "production"),
      createdAt: new Date().toISOString()
    };

    const created = await storage.createEnvironment(env);
    return reply.status(201).send(created);
  });

  // POST /v1/prompts/:name/promote
  app.post("/v1/prompts/:name/promote", { preHandler: requireScope("publish") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { version, environment, notes } = req.body as {
      version: string;
      environment: string;
      notes?: string;
    };

    if (!version || !environment) {
      return reply.status(400).send({ error: "Bad Request", message: "Both 'version' and 'environment' are required" });
    }

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const targetEnv = await storage.getEnvironment(orgId, environment);
    if (!targetEnv) {
      return reply.status(404).send({ error: "Not Found", message: `Environment '${environment}' does not exist` });
    }

    const verObj = await storage.getPromptVersion(orgId, prompt.id, version);
    if (!verObj) {
      return reply.status(404).send({ error: "Not Found", message: `Version '${version}' not found for prompt '${name}'` });
    }

    // Check organization policy for promotion
    const policy = await storage.getPolicy(orgId);
    const latestEval = await storage.getLatestEvaluation(orgId, prompt.id, version);
    const approvals = await storage.listApprovals(orgId, "approved");
    const approved = approvals.find(
      a => a.promptId === prompt.id && a.version === version && a.targetEnvironment === environment
    );

    const check = PolicyEngine.checkPromotion(environment, verObj, policy, {
      latestEvaluation: latestEval,
      approvedApproval: approved,
      isProtected: targetEnv.isProtected
    });

    if (!check.allowed) {
      return reply.status(422).send({
        error: "Promotion Blocked by Policy",
        code: "POLICY_PROMOTION_BLOCKED",
        message: `Promotion of ${name}@${version} to ${environment} blocked by policy`,
        violations: check.violations
      });
    }

    const now = new Date().toISOString();
    const deployment: Deployment = {
      id: `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      promptId: prompt.id,
      promptName: prompt.name,
      environmentName: targetEnv.name,
      version: verObj.version,
      promptVersionId: verObj.id,
      deployedBy: req.identity!.name,
      deployedAt: now,
      rollbackFromDeploymentId: null,
      status: "active",
      notes: notes || `Promoted to ${environment}`
    };

    const createdDeployment = await storage.createDeployment(deployment);

    // Audit log
    await storage.createAuditLog({
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "environment.promoted",
      resource: { type: "deployment", id: createdDeployment.id, name: prompt.name, version: verObj.version },
      environment: targetEnv.name,
      requestId: req.requestId,
      metadata: { deploymentId: createdDeployment.id, notes },
      timestamp: now
    });

    return reply.send(createdDeployment);
  });

  // POST /v1/prompts/:name/rollback
  app.post("/v1/prompts/:name/rollback", { preHandler: requireScope("publish") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { environment, targetVersion } = req.body as {
      environment: string;
      targetVersion?: string;
    };

    if (!environment) {
      return reply.status(400).send({ error: "Bad Request", message: "'environment' parameter is required" });
    }

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const currentDep = await storage.getLatestDeployment(orgId, prompt.id, environment);
    if (!currentDep) {
      return reply.status(400).send({
        error: "Bad Request",
        message: `No active deployment found in environment '${environment}' to rollback from`
      });
    }

    const deployments = await storage.listDeployments(orgId, prompt.id);
    const envDeployments = deployments.filter(d => d.environmentName === environment);

    let rollbackVersion = targetVersion;
    let rollbackFromDepId = currentDep.id;

    if (!rollbackVersion) {
      // Find previous deployment before current
      const prior = envDeployments.find(d => d.id !== currentDep.id);
      if (!prior) {
        return reply.status(400).send({
          error: "Bad Request",
          message: `No previous deployment found in environment '${environment}' to rollback to`
        });
      }
      rollbackVersion = prior.version;
    }

    const verObj = await storage.getPromptVersion(orgId, prompt.id, rollbackVersion);
    if (!verObj) {
      return reply.status(404).send({
        error: "Not Found",
        message: `Target rollback version '${rollbackVersion}' not found`
      });
    }

    const now = new Date().toISOString();
    const rollbackDep: Deployment = {
      id: `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      promptId: prompt.id,
      promptName: prompt.name,
      environmentName: environment,
      version: verObj.version,
      promptVersionId: verObj.id,
      deployedBy: req.identity!.name,
      deployedAt: now,
      rollbackFromDeploymentId: rollbackFromDepId,
      status: "active",
      notes: `Rolled back from deployment ${rollbackFromDepId} (was ${currentDep.version})`
    };

    const createdDeployment = await storage.createDeployment(rollbackDep);

    // Audit log
    await storage.createAuditLog({
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: orgId,
      actor: { id: req.identity!.id, name: req.identity!.name, type: req.identity!.type },
      action: "environment.rolled_back",
      resource: { type: "deployment", id: createdDeployment.id, name: prompt.name, version: verObj.version },
      environment,
      requestId: req.requestId,
      metadata: {
        previousVersion: currentDep.version,
        targetVersion: verObj.version,
        rollbackFromDeploymentId: rollbackFromDepId
      },
      timestamp: now
    });

    return reply.send(createdDeployment);
  });

  // GET /v1/prompts/:name/deployments
  app.get("/v1/prompts/:name/deployments", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const deps = await storage.listDeployments(orgId, prompt.id);
    return reply.send(deps);
  });
}
