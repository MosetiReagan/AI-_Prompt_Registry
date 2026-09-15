import { Evaluation, TestResult } from "../types/models.js";

export interface RegressionThresholds {
  minimumScore?: number; // e.g. 0.90
  maxRegression?: number; // e.g. 0.02 (allowable drop in overall score)
}

export interface TestCaseRegression {
  testCaseId: string;
  testCaseName: string;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  baselinePassed: boolean;
  candidatePassed: boolean;
  regressed: boolean; // passed on baseline, failed on candidate
}

export interface RegressionReport {
  baselineVersion: string;
  candidateVersion: string;
  baselineScore: number;
  candidateScore: number;
  scoreDelta: number; // candidateScore - baselineScore
  improvementPercentage: number;
  hasRegression: boolean;
  passedThresholds: boolean;
  failureReasons: string[];
  totalTestCases: number;
  regressedCases: TestCaseRegression[];
  caseComparisons: TestCaseRegression[];
}

/**
 * Compares two Evaluation runs to detect performance or accuracy regressions
 */
export function computeRegressionReport(
  baseline: Evaluation,
  candidate: Evaluation,
  thresholds: RegressionThresholds = {}
): RegressionReport {
  const minScore = thresholds.minimumScore ?? 0.85;
  const maxAllowableRegression = thresholds.maxRegression ?? 0.05;

  const baselineMap = new Map<string, TestResult>(
    baseline.testResults.map(r => [r.testCaseId, r])
  );
  const candidateMap = new Map<string, TestResult>(
    candidate.testResults.map(r => [r.testCaseId, r])
  );

  const allTestIds = new Set([...baselineMap.keys(), ...candidateMap.keys()]);
  const caseComparisons: TestCaseRegression[] = [];
  const regressedCases: TestCaseRegression[] = [];

  for (const testId of allTestIds) {
    const baseResult = baselineMap.get(testId);
    const candResult = candidateMap.get(testId);

    if (baseResult && candResult) {
      const baseScore = baseResult.score;
      const candScore = candResult.score;
      const delta = Math.round((candScore - baseScore) * 100) / 100;
      // Regressed if it passed before but failed now, or lost significant points
      const regressed = (baseResult.passed && !candResult.passed) || (baseScore - candScore > 0.1);

      const comparison: TestCaseRegression = {
        testCaseId: testId,
        testCaseName: candResult.testCaseName || baseResult.testCaseName,
        baselineScore: baseScore,
        candidateScore: candScore,
        delta,
        baselinePassed: baseResult.passed,
        candidatePassed: candResult.passed,
        regressed
      };

      caseComparisons.push(comparison);
      if (regressed) {
        regressedCases.push(comparison);
      }
    }
  }

  const scoreDelta = Math.round((candidate.score - baseline.score) * 100) / 100;
  const improvementPercentage = Math.round(scoreDelta * 100);

  const failureReasons: string[] = [];

  // Check minimum score threshold
  if (candidate.score < minScore) {
    failureReasons.push(
      `Candidate score (${(candidate.score * 100).toFixed(1)}%) is below minimum required score of ${(minScore * 100).toFixed(1)}%`
    );
  }

  // Check overall regression drop threshold
  if (scoreDelta < -maxAllowableRegression) {
    failureReasons.push(
      `Overall score dropped by ${(Math.abs(scoreDelta) * 100).toFixed(1)}%, exceeding maximum allowable regression of ${(maxAllowableRegression * 100).toFixed(1)}%`
    );
  }

  // Check individual regressed test cases
  if (regressedCases.length > 0) {
    failureReasons.push(
      `${regressedCases.length} previously passing test case(s) regressed in candidate version: ${regressedCases.map(c => `"${c.testCaseName}"`).join(", ")}`
    );
  }

  const hasRegression = scoreDelta < 0 || regressedCases.length > 0;
  const passedThresholds = failureReasons.length === 0;

  return {
    baselineVersion: baseline.version,
    candidateVersion: candidate.version,
    baselineScore: baseline.score,
    candidateScore: candidate.score,
    scoreDelta,
    improvementPercentage,
    hasRegression,
    passedThresholds,
    failureReasons,
    totalTestCases: caseComparisons.length,
    regressedCases,
    caseComparisons
  };
}
