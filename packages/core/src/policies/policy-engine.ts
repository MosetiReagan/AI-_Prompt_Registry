import { Policy, Prompt, PromptVersion, Evaluation, Approval } from "../types/models.js";
import { auditPromptSecurity } from "../security/sanitizer.js";

export interface PolicyCheckResult {
  allowed: boolean;
  policyName: string;
  violations: Array<{
    rule: string;
    message: string;
    severity: "error" | "warning";
  }>;
}

export class PolicyEngine {
  /**
   * Evaluates policies before publishing a new prompt version
   */
  static checkPublish(
    prompt: Prompt,
    version: PromptVersion,
    policy?: Policy | null
  ): PolicyCheckResult {
    const rules = policy?.rules || {
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
    };

    const violations: Array<{ rule: string; message: string; severity: "error" | "warning" }> = [];

    // 1. Require description
    if (rules.requireDescription && (!prompt.description || prompt.description.trim() === "")) {
      violations.push({
        rule: "requireDescription",
        message: "Prompt description is required by organization policy.",
        severity: "error"
      });
    }

    // 2. Require owner
    if (rules.requireOwner && (!prompt.owner || prompt.owner.trim() === "")) {
      violations.push({
        rule: "requireOwner",
        message: "Prompt owner must be assigned before publishing.",
        severity: "error"
      });
    }

    // 3. Forbid secrets in template or variables
    if (rules.forbidSecrets) {
      const templateStr = typeof version.template === "string"
        ? version.template
        : JSON.stringify(version.template);
      const sec = auditPromptSecurity(templateStr);
      if (sec.hasSecrets) {
        violations.push({
          rule: "forbidSecrets",
          message: `Forbidden hardcoded secrets detected in prompt template: ${sec.detectedSecrets.map(s => s.slice(0, 8) + "...").join(", ")}`,
          severity: "error"
        });
      }
    }

    // 4. Allowed providers/models
    if (rules.allowedModels && rules.allowedModels.length > 0 && version.modelPreferences?.name) {
      if (!rules.allowedModels.includes(version.modelPreferences.name)) {
        violations.push({
          rule: "allowedModels",
          message: `Model '${version.modelPreferences.name}' is not in the allowed models list: [${rules.allowedModels.join(", ")}]`,
          severity: "error"
        });
      }
    }

    return {
      allowed: violations.every(v => v.severity !== "error"),
      policyName: policy?.name || "Default Policy",
      violations
    };
  }

  /**
   * Evaluates policies before promoting a prompt version to an environment (e.g. production)
   */
  static checkPromotion(
    targetEnv: string,
    version: PromptVersion,
    policy?: Policy | null,
    context?: {
      latestEvaluation?: Evaluation | null;
      approvedApproval?: Approval | null;
    }
  ): PolicyCheckResult {
    const rules = policy?.rules || {
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
    };

    const violations: Array<{ rule: string; message: string; severity: "error" | "warning" }> = [];
    const isProd = targetEnv.toLowerCase() === "production";

    if (isProd && rules.production) {
      // 1. Require evaluation
      if (rules.production.requireEvaluation) {
        if (!context?.latestEvaluation) {
          violations.push({
            rule: "production.requireEvaluation",
            message: "Promotion to production requires a successful evaluation run.",
            severity: "error"
          });
        } else {
          // Verify that evaluation has real test assertions
          const results = context.latestEvaluation.testResults || [];
          const hasRealAssertions =
            results.length > 0 &&
            results.some(r => r.evaluations && r.evaluations.length > 0);

          if (!hasRealAssertions) {
            violations.push({
              rule: "production.requireRealTestCases",
              message: "Promotion to production requires an evaluation with real assertions, not an empty auto-generated test case.",
              severity: "error"
            });
          }

          // Check score
          if (context.latestEvaluation.score < rules.production.minimumScore) {
            violations.push({
              rule: "production.minimumScore",
              message: `Evaluation score (${(context.latestEvaluation.score * 100).toFixed(1)}%) does not meet minimum production threshold of ${(rules.production.minimumScore * 100).toFixed(1)}%.`,
              severity: "error"
            });
          }
        }
      }

      // 2. Require approval
      if (rules.production.requireApproval) {
        if (!context?.approvedApproval || context.approvedApproval.status !== "approved") {
          violations.push({
            rule: "production.requireApproval",
            message: "Production deployment requires an approved review before promotion.",
            severity: "error"
          });
        }
      }
    }

    return {
      allowed: violations.every(v => v.severity !== "error"),
      policyName: policy?.name || "Default Policy",
      violations
    };
  }
}
