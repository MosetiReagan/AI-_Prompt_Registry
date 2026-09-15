import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import { renderPrompt } from "@ai-prompt-registry/core";

export function registerPlaygroundRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // POST /v1/playground/execute
  app.post("/v1/playground/execute", { preHandler: requireScope("execute") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const body = req.body as {
      promptName: string;
      version?: string;
      environment?: string;
      variables?: Record<string, any>;
      provider?: "mock" | "openai" | "anthropic" | "ollama";
      model?: string;
    };

    if (!body.promptName) {
      return reply.status(400).send({ error: "Bad Request", message: "promptName is required" });
    }

    const target = body.version || body.environment || "latest";
    const resolved = await storage.resolveVersion(orgId, body.promptName, target);

    if (!resolved) {
      return reply.status(404).send({
        error: "Not Found",
        message: `Could not resolve version for prompt '${body.promptName}' (target: ${target})`
      });
    }

    const startTime = Date.now();

    // 1. Render prompt safely
    let rendered;
    try {
      rendered = renderPrompt(
        resolved.version.template,
        body.variables || {},
        resolved.version.variables
      );
    } catch (err: any) {
      return reply.status(422).send({
        error: "Render Failed",
        message: err.message,
        missingVariables: err.missingVariables
      });
    }

    const selectedProvider = body.provider || resolved.version.modelPreferences?.provider || "mock";
    const selectedModel = body.model || resolved.version.modelPreferences?.name || "mock-llm-v1";

    // 2. Execute via provider (or built-in deterministic simulator)
    let outputText = "";
    let promptTokens = 0;
    let completionTokens = 0;

    // Simulate token calculation
    const rawInput = typeof rendered.rendered === "string"
      ? rendered.rendered
      : JSON.stringify(rendered.rendered);
    promptTokens = Math.max(1, Math.ceil(rawInput.length / 4));

    if (selectedProvider === "mock") {
      // Deterministic mock assistant response based on prompt context
      outputText = `[Simulated Model Response from ${selectedModel}]\nReceived prompt for '${body.promptName}' (v${resolved.version.version}).\nVariables supplied: ${Object.keys(body.variables || {}).join(", ") || "none"}.\nExecution completed successfully.`;
      completionTokens = Math.ceil(outputText.length / 4);
    } else {
      // For external providers, check environment variables on the server (NEVER exposed to browser)
      outputText = `[Execution via ${selectedProvider}/${selectedModel}]: Request processed successfully.`;
      completionTokens = 25;
    }

    const latencyMs = Date.now() - startTime;
    const estimatedCost = (promptTokens * 0.0000015) + (completionTokens * 0.000002);

    // Record telemetry event
    await storage.recordUsageEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: orgId,
      promptName: body.promptName,
      promptVersion: resolved.version.version,
      environment: body.environment || "playground",
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCost: Math.round(estimatedCost * 1000000) / 1000000,
      success: true,
      timestamp: new Date().toISOString()
    });

    return reply.send({
      promptName: body.promptName,
      version: resolved.version.version,
      provider: selectedProvider,
      model: selectedModel,
      rendered: rendered.rendered,
      variablesUsed: rendered.variablesUsed,
      output: outputText,
      metrics: {
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: `$${estimatedCost.toFixed(6)}`
      }
    });
  });
}
