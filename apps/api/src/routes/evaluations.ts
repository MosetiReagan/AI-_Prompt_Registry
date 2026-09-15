import { FastifyInstance } from "fastify";
import { IRegistryStorage } from "../storage/interface.js";
import { requireScope } from "../middleware/auth.js";
import {
  TestCase,
  TestCaseSchema,
  Evaluation,
  renderPrompt,
  evaluateTestCaseOutput,
  computeRegressionReport
} from "@ai-prompt-registry/core";

export function registerEvaluationRoutes(app: FastifyInstance, storage: IRegistryStorage) {
  // GET /v1/prompts/:name/test-cases
  app.get("/v1/prompts/:name/test-cases", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const testCases = await storage.listTestCases(orgId, prompt.id);
    return reply.send(testCases);
  });

  // POST /v1/prompts/:name/test-cases
  app.post("/v1/prompts/:name/test-cases", { preHandler: requireScope("write") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const body = req.body as any;

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const testCase: TestCase = {
      id: `tc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      promptId: prompt.id,
      name: body.name || `Test Case ${Date.now()}`,
      description: body.description || "",
      inputs: body.inputs || {},
      expectedOutput: body.expectedOutput,
      expectedProperties: body.expectedProperties || {},
      tags: body.tags || [],
      metadata: body.metadata || {},
      createdAt: new Date().toISOString()
    };

    const parsed = TestCaseSchema.safeParse(testCase);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid test case",
        issues: parsed.error.issues
      });
    }

    const created = await storage.createTestCase(testCase);
    return reply.status(201).send(created);
  });

  // POST /v1/prompts/:name/evaluate
  app.post("/v1/prompts/:name/evaluate", { preHandler: requireScope("execute") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { version, mockOutput } = req.body as {
      version: string;
      mockOutput?: string | Record<string, string>; // Optional mock outputs per test case
    };

    if (!version) {
      return reply.status(400).send({ error: "Bad Request", message: "'version' parameter is required" });
    }

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const verObj = await storage.getPromptVersion(orgId, prompt.id, version);
    if (!verObj) {
      return reply.status(404).send({ error: "Not Found", message: `Version '${version}' not found for prompt '${name}'` });
    }

    const testCases = await storage.listTestCases(orgId, prompt.id);
    if (testCases.length === 0) {
      return reply.status(422).send({
        error: "Unprocessable Entity",
        code: "NO_TEST_CASES_FOUND",
        message: `No test cases found for prompt '${name}'. Create test cases with assertions before running evaluation.`
      });
    }

    const testResults = [];
    for (const tc of testCases) {
      const startTime = Date.now();
      let outputText: string;

      // Check if caller supplied mock output or if we render the prompt
      if (typeof mockOutput === "string") {
        outputText = mockOutput;
      } else if (mockOutput && typeof mockOutput === "object" && mockOutput[tc.id]) {
        outputText = mockOutput[tc.id];
      } else {
        // Render prompt and use rendered output as simulated response or expected
        try {
          const rendered = renderPrompt(verObj.template, tc.inputs, verObj.variables);
          outputText = typeof rendered.rendered === "string"
            ? rendered.rendered
            : (rendered.rendered[rendered.rendered.length - 1]?.content as string) || "OK";
        } catch (err: any) {
          outputText = `Render error: ${err.message}`;
        }
      }

      const durationMs = Date.now() - startTime;
      const res = await evaluateTestCaseOutput(tc, outputText, durationMs);
      testResults.push(res);
    }

    const totalTests = testResults.length;
    const passedTests = testResults.filter(r => r.passed).length;
    const overallScore =
      totalTests > 0
        ? Math.round((testResults.reduce((sum, r) => sum + r.score, 0) / totalTests) * 100) / 100
        : 1.0;

    const evaluation: Evaluation = {
      id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      promptId: prompt.id,
      promptVersionId: verObj.id,
      version: verObj.version,
      type: "deterministic",
      score: overallScore,
      passed: passedTests === totalTests,
      totalTests,
      passedTests,
      testResults,
      evaluatorConfig: { mode: "deterministic" },
      isAIGenerated: false,
      createdAt: new Date().toISOString(),
      createdBy: req.identity!.name
    };

    const saved = await storage.createEvaluation(evaluation);
    return reply.send(saved);
  });

  // POST /v1/prompts/:name/regression
  app.post("/v1/prompts/:name/regression", { preHandler: requireScope("read") }, async (req, reply) => {
    const orgId = req.identity!.organizationId;
    const { name } = req.params as { name: string };
    const { baselineVersion, candidateVersion, minimumScore, maxRegression } = req.body as {
      baselineVersion: string;
      candidateVersion: string;
      minimumScore?: number;
      maxRegression?: number;
    };

    if (!baselineVersion || !candidateVersion) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Both 'baselineVersion' and 'candidateVersion' are required"
      });
    }

    const prompt = await storage.getPrompt(orgId, name);
    if (!prompt) {
      return reply.status(404).send({ error: "Not Found", message: `Prompt '${name}' not found` });
    }

    const baseEval = await storage.getLatestEvaluation(orgId, prompt.id, baselineVersion);
    if (!baseEval) {
      return reply.status(422).send({
        error: "Unprocessable Entity",
        code: "NO_EVALUATION_FOUND",
        message: `No evaluation found for baseline version '${baselineVersion}'. Run an evaluation before performing regression comparison.`
      });
    }

    const candEval = await storage.getLatestEvaluation(orgId, prompt.id, candidateVersion);
    if (!candEval) {
      return reply.status(422).send({
        error: "Unprocessable Entity",
        code: "NO_EVALUATION_FOUND",
        message: `No evaluation found for candidate version '${candidateVersion}'. Run an evaluation before performing regression comparison.`
      });
    }

    const report = computeRegressionReport(baseEval, candEval, {
      minimumScore,
      maxRegression
    });

    return reply.send(report);
  });
}
