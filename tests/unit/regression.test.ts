import { describe, it, expect } from "vitest";
import { computeRegressionReport, Evaluation } from "@ai-prompt-registry/core";

describe("Prompt Regression Testing", () => {
  const baselineEval: Evaluation = {
    id: "eval_1",
    promptId: "p_1",
    promptVersionId: "v_1",
    version: "1.4.0",
    type: "deterministic",
    score: 0.914,
    passed: true,
    totalTests: 2,
    passedTests: 2,
    testResults: [
      {
        testCaseId: "tc_1",
        testCaseName: "Case 1",
        passed: true,
        score: 1.0,
        output: "Result 1",
        evaluations: [],
        durationMs: 10
      },
      {
        testCaseId: "tc_2",
        testCaseName: "Case 2",
        passed: true,
        score: 0.828,
        output: "Result 2",
        evaluations: [],
        durationMs: 12
      }
    ],
    evaluatorConfig: {},
    isAIGenerated: false,
    createdAt: "2026-09-01T00:00:00Z",
    createdBy: "system"
  };

  it("detects performance improvement and passes regression threshold", () => {
    const candidateEval: Evaluation = {
      ...baselineEval,
      id: "eval_2",
      promptVersionId: "v_2",
      version: "1.5.0",
      score: 0.941,
      testResults: [
        { ...baselineEval.testResults[0], score: 1.0 },
        { ...baselineEval.testResults[1], score: 0.882 }
      ]
    };

    const report = computeRegressionReport(baselineEval, candidateEval, {
      minimumScore: 0.90,
      maxRegression: 0.02
    });

    expect(report.scoreDelta).toBeGreaterThan(0);
    expect(report.passedThresholds).toBe(true);
    expect(report.regressedCases).toHaveLength(0);
  });

  it("detects regression when previously passing test case regresses", () => {
    const candidateWithRegression: Evaluation = {
      ...baselineEval,
      id: "eval_3",
      promptVersionId: "v_3",
      version: "1.5.0",
      score: 0.85,
      testResults: [
        { ...baselineEval.testResults[0], score: 1.0, passed: true },
        { ...baselineEval.testResults[1], score: 0.2, passed: false } // REGRESSED!
      ]
    };

    const report = computeRegressionReport(baselineEval, candidateWithRegression, {
      minimumScore: 0.90,
      maxRegression: 0.02
    });

    expect(report.hasRegression).toBe(true);
    expect(report.passedThresholds).toBe(false);
    expect(report.regressedCases).toHaveLength(1);
    expect(report.regressedCases[0].testCaseId).toBe("tc_2");
    expect(report.failureReasons.length).toBeGreaterThan(0);
  });

  it("rejects promotion if evaluation lacks real test case assertions", async () => {
    const { PolicyEngine } = await import("@ai-prompt-registry/core");
    const emptyAssertionEval: Evaluation = {
      ...baselineEval,
      testResults: [
        {
          testCaseId: "tc_empty",
          testCaseName: "Empty test",
          passed: true,
          score: 1.0,
          output: "OK",
          evaluations: [], // No real assertions!
          durationMs: 5
        }
      ]
    };
    const res = PolicyEngine.checkPromotion("production", { id: "pv_1", version: "1.0.0" } as any, null, {
      latestEvaluation: emptyAssertionEval
    });
    expect(res.allowed).toBe(false);
    expect(res.violations.some((v: any) => v.rule === "production.requireRealTestCases")).toBe(true);
  });

  it("enforces policy gates when custom environment isProtected is true", async () => {
    const { PolicyEngine } = await import("@ai-prompt-registry/core");
    // Attempting to promote to a custom environment "canary" without evaluation
    // 1. When not protected, it is allowed
    const unprot = PolicyEngine.checkPromotion("canary", { id: "pv_1", version: "1.0.0" } as any, null, {
      isProtected: false
    });
    expect(unprot.allowed).toBe(true);

    // 2. When isProtected: true, gates are strictly enforced
    const prot = PolicyEngine.checkPromotion("canary", { id: "pv_1", version: "1.0.0" } as any, null, {
      isProtected: true
    });
    expect(prot.allowed).toBe(false);
    expect(prot.violations.some((v: any) => v.rule === "production.requireEvaluation")).toBe(true);
  });
});
