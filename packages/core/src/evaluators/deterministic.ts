import { TestCase, TestResult } from "../types/models.js";

export interface EvaluationCriterionResult {
  type: string;
  passed: boolean;
  score: number;
  reason: string;
}

export type CustomEvaluatorFn = (
  output: string,
  context: { testCase: TestCase; variables: Record<string, any> }
) => Promise<EvaluationCriterionResult> | EvaluationCriterionResult;

export function isSafeRegex(pattern: string): { safe: boolean; reason?: string } {
  if (pattern.length > 500) {
    return { safe: false, reason: `Pattern length (${pattern.length}) exceeds maximum allowed 500 characters` };
  }
  // Check for nested quantifiers like (a+)+, (a*)*, (a|b+)+, (.+)*, (a{1,5})+
  const nestedQuantifiers = /\([^)]*(\+|\*|\{\d+,?\d*\})\)[+*?{]/;
  if (nestedQuantifiers.test(pattern)) {
    return { safe: false, reason: "Pattern contains dangerous nested quantifiers susceptible to catastrophic backtracking (ReDoS)" };
  }
  const overlappingWildcards = /(\.\*|\.\+)[+*]/;
  if (overlappingWildcards.test(pattern)) {
    return { safe: false, reason: "Pattern contains overlapping repeated wildcards susceptible to catastrophic backtracking (ReDoS)" };
  }
  return { safe: true };
}

export class DeterministicEvaluator {
  static isSafeRegex = isSafeRegex;
  /**
   * 1. Exact Match Evaluator
   */
  static exactMatch(
    output: string,
    expected: string,
    caseSensitive: boolean = true
  ): EvaluationCriterionResult {
    const o = caseSensitive ? output.trim() : output.trim().toLowerCase();
    const e = caseSensitive ? expected.trim() : expected.trim().toLowerCase();
    const passed = o === e;
    return {
      type: "exact_match",
      passed,
      score: passed ? 1.0 : 0.0,
      reason: passed ? "Output exactly matches expected text" : `Output differs from expected text`
    };
  }

  /**
   * 2. Contains Substrings Evaluator
   */
  static contains(
    output: string,
    substrings: string[],
    caseSensitive: boolean = false
  ): EvaluationCriterionResult {
    const text = caseSensitive ? output : output.toLowerCase();
    const missing: string[] = [];

    for (const sub of substrings) {
      const target = caseSensitive ? sub : sub.toLowerCase();
      if (!text.includes(target)) {
        missing.push(sub);
      }
    }

    const passed = missing.length === 0;
    const score = substrings.length > 0 ? (substrings.length - missing.length) / substrings.length : 1.0;

    return {
      type: "contains",
      passed,
      score,
      reason: passed
        ? `Output contains all ${substrings.length} required term(s)`
        : `Output missing required term(s): ${missing.map(m => `"${m}"`).join(", ")}`
    };
  }


  /**
   * 3. Regex Pattern Evaluator
   */
  static regex(output: string, pattern: string, flags: string = ""): EvaluationCriterionResult {
    const safety = isSafeRegex(pattern);
    if (!safety.safe) {
      return {
        type: "regex",
        passed: false,
        score: 0.0,
        reason: `Regex pattern rejected: ${safety.reason}`
      };
    }

    try {
      const re = new RegExp(pattern, flags);
      const passed = re.test(output);
      return {
        type: "regex",
        passed,
        score: passed ? 1.0 : 0.0,
        reason: passed ? `Output matches regex /${pattern}/` : `Output does not match regex /${pattern}/`
      };
    } catch (err: any) {
      return {
        type: "regex",
        passed: false,
        score: 0.0,
        reason: `Invalid regular expression: ${err.message}`
      };
    }
  }

  /**
   * 4. JSON Validity Evaluator
   */
  static jsonValid(output: string): EvaluationCriterionResult {
    try {
      // Find possible JSON substring if wrapped in markdown code fence
      const cleaned = output.replace(/```json\s*([\s\S]*?)\s*```/i, "$1").trim();
      JSON.parse(cleaned);
      return {
        type: "json_valid",
        passed: true,
        score: 1.0,
        reason: "Output is valid JSON"
      };
    } catch (err: any) {
      return {
        type: "json_valid",
        passed: false,
        score: 0.0,
        reason: `Output is not valid JSON: ${err.message}`
      };
    }
  }

  /**
   * 5. JSON Schema Validation Evaluator
   */
  static jsonSchema(output: string, schema: Record<string, any>): EvaluationCriterionResult {
    try {
      const cleaned = output.replace(/```json\s*([\s\S]*?)\s*```/i, "$1").trim();
      const parsed = JSON.parse(cleaned);

      // Check required fields from schema if specified
      if (schema.required && Array.isArray(schema.required)) {
        const missing = schema.required.filter((field: string) => !(field in parsed));
        if (missing.length > 0) {
          return {
            type: "json_schema",
            passed: false,
            score: 0.5,
            reason: `JSON missing required properties: ${missing.join(", ")}`
          };
        }
      }

      return {
        type: "json_schema",
        passed: true,
        score: 1.0,
        reason: "Output satisfies JSON schema constraints"
      };
    } catch (err: any) {
      return {
        type: "json_schema",
        passed: false,
        score: 0.0,
        reason: `JSON schema validation failed: ${err.message}`
      };
    }
  }

  /**
   * 6. Length Constraints Evaluator
   */
  static length(
    output: string,
    options: { minChars?: number; maxChars?: number; minWords?: number; maxWords?: number }
  ): EvaluationCriterionResult {
    const chars = output.length;
    const words = output.trim().split(/\s+/).filter(Boolean).length;

    if (options.minChars !== undefined && chars < options.minChars) {
      return {
        type: "length",
        passed: false,
        score: 0.0,
        reason: `Output length (${chars} chars) is below minimum of ${options.minChars}`
      };
    }
    if (options.maxChars !== undefined && chars > options.maxChars) {
      return {
        type: "length",
        passed: false,
        score: 0.0,
        reason: `Output length (${chars} chars) exceeds maximum of ${options.maxChars}`
      };
    }
    if (options.minWords !== undefined && words < options.minWords) {
      return {
        type: "length",
        passed: false,
        score: 0.0,
        reason: `Word count (${words} words) is below minimum of ${options.minWords}`
      };
    }
    if (options.maxWords !== undefined && words > options.maxWords) {
      return {
        type: "length",
        passed: false,
        score: 0.0,
        reason: `Word count (${words} words) exceeds maximum of ${options.maxWords}`
      };
    }

    return {
      type: "length",
      passed: true,
      score: 1.0,
      reason: `Output satisfies length bounds (${chars} chars, ${words} words)`
    };
  }

  /**
   * 7. Required Fields Evaluator (JSON)
   */
  static requiredFields(output: string, fields: string[]): EvaluationCriterionResult {
    try {
      const cleaned = output.replace(/```json\s*([\s\S]*?)\s*```/i, "$1").trim();
      const parsed = JSON.parse(cleaned);
      const missing = fields.filter(f => !(f in parsed));

      const passed = missing.length === 0;
      const score = fields.length > 0 ? (fields.length - missing.length) / fields.length : 1.0;

      return {
        type: "required_fields",
        passed,
        score,
        reason: passed
          ? `All required fields present (${fields.join(", ")})`
          : `Missing required field(s): ${missing.join(", ")}`
      };
    } catch (err: any) {
      return {
        type: "required_fields",
        passed: false,
        score: 0.0,
        reason: `Cannot check required fields: output is not valid JSON (${err.message})`
      };
    }
  }

  /**
   * 8. Forbidden Terms Evaluator
   */
  static forbiddenTerms(
    output: string,
    terms: string[],
    caseSensitive: boolean = false
  ): EvaluationCriterionResult {
    const text = caseSensitive ? output : output.toLowerCase();
    const found: string[] = [];

    for (const term of terms) {
      const target = caseSensitive ? term : term.toLowerCase();
      if (text.includes(target)) {
        found.push(term);
      }
    }

    const passed = found.length === 0;
    return {
      type: "forbidden_terms",
      passed,
      score: passed ? 1.0 : 0.0,
      reason: passed
        ? "No forbidden terms found"
        : `Output contains forbidden term(s): ${found.map(t => `"${t}"`).join(", ")}`
    };
  }
}

/**
 * Runs all configured deterministic evaluations on a single test case output
 */
export async function evaluateTestCaseOutput(
  testCase: TestCase,
  output: string,
  durationMs: number = 0,
  customEvaluators?: Record<string, CustomEvaluatorFn>
): Promise<TestResult> {
  const evaluations: EvaluationCriterionResult[] = [];
  const expectedProps = testCase.expectedProperties || {};

  // 1. Exact match
  if (testCase.expectedOutput !== undefined) {
    evaluations.push(
      DeterministicEvaluator.exactMatch(
        output,
        testCase.expectedOutput,
        expectedProps.caseSensitive ?? false
      )
    );
  }

  // 2. Contains
  if (expectedProps.contains && Array.isArray(expectedProps.contains)) {
    evaluations.push(
      DeterministicEvaluator.contains(
        output,
        expectedProps.contains,
        expectedProps.caseSensitive ?? false
      )
    );
  }

  // 3. Regex
  if (expectedProps.regex) {
    evaluations.push(DeterministicEvaluator.regex(output, expectedProps.regex, expectedProps.regexFlags || ""));
  }

  // 4. JSON Valid
  if (expectedProps.jsonValid === true) {
    evaluations.push(DeterministicEvaluator.jsonValid(output));
  }

  // 5. JSON Schema
  if (expectedProps.jsonSchema) {
    evaluations.push(DeterministicEvaluator.jsonSchema(output, expectedProps.jsonSchema));
  }

  // 6. Length
  if (
    expectedProps.minChars !== undefined ||
    expectedProps.maxChars !== undefined ||
    expectedProps.minWords !== undefined ||
    expectedProps.maxWords !== undefined
  ) {
    evaluations.push(
      DeterministicEvaluator.length(output, {
        minChars: expectedProps.minChars,
        maxChars: expectedProps.maxChars,
        minWords: expectedProps.minWords,
        maxWords: expectedProps.maxWords
      })
    );
  }

  // 7. Required Fields
  if (expectedProps.requiredFields && Array.isArray(expectedProps.requiredFields)) {
    evaluations.push(DeterministicEvaluator.requiredFields(output, expectedProps.requiredFields));
  }

  // 8. Forbidden Terms
  if (expectedProps.forbiddenTerms && Array.isArray(expectedProps.forbiddenTerms)) {
    evaluations.push(
      DeterministicEvaluator.forbiddenTerms(
        output,
        expectedProps.forbiddenTerms,
        expectedProps.caseSensitive ?? false
      )
    );
  }

  // 9. Custom Evaluators
  if (customEvaluators && expectedProps.customEvaluator) {
    const fn = customEvaluators[expectedProps.customEvaluator];
    if (fn) {
      const res = await fn(output, { testCase, variables: testCase.inputs });
      evaluations.push(res);
    }
  }

  // Compute aggregate score
  if (evaluations.length === 0) {
    // Default pass if no criteria specified
    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      passed: true,
      score: 1.0,
      output,
      evaluations: [{
        type: "none",
        passed: true,
        score: 1.0,
        reason: "No evaluation criteria specified; execution succeeded"
      }],
      durationMs
    };
  }

  const allPassed = evaluations.every(e => e.passed);
  const avgScore = evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length;

  return {
    testCaseId: testCase.id,
    testCaseName: testCase.name,
    passed: allPassed,
    score: Math.round(avgScore * 100) / 100,
    output,
    evaluations,
    durationMs
  };
}
