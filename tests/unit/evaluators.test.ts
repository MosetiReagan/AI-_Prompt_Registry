import { describe, it, expect } from "vitest";
import {
  DeterministicEvaluator,
  evaluateTestCaseOutput,
  TestCase
} from "@ai-prompt-registry/core";

describe("Deterministic Evaluators", () => {
  it("evaluates exact match", () => {
    const pass = DeterministicEvaluator.exactMatch("Hello World", "Hello World");
    expect(pass.passed).toBe(true);
    expect(pass.score).toBe(1.0);

    const fail = DeterministicEvaluator.exactMatch("Hello World", "Goodbye");
    expect(fail.passed).toBe(false);
    expect(fail.score).toBe(0.0);
  });

  it("evaluates contains substrings", () => {
    const res = DeterministicEvaluator.contains("Your payment was successful", ["payment", "successful"]);
    expect(res.passed).toBe(true);
    expect(res.score).toBe(1.0);

    const partial = DeterministicEvaluator.contains("Your payment failed", ["payment", "successful"]);
    expect(partial.passed).toBe(false);
    expect(partial.score).toBe(0.5);
  });

  it("evaluates regex patterns", () => {
    const pass = DeterministicEvaluator.regex("Order #12345 confirmed", "#\\d{5}");
    expect(pass.passed).toBe(true);

    const fail = DeterministicEvaluator.regex("Order abc confirmed", "#\\d{5}");
    expect(fail.passed).toBe(false);
  });

  it("evaluates JSON validity and JSON schemas", () => {
    const validJson = '{"id": 1, "name": "John", "status": "active"}';
    const invalidJson = '{"id": 1, name: unquoted}';

    expect(DeterministicEvaluator.jsonValid(validJson).passed).toBe(true);
    expect(DeterministicEvaluator.jsonValid(invalidJson).passed).toBe(false);

    const schemaPass = DeterministicEvaluator.jsonSchema(validJson, {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        status: { type: "string", enum: ["active", "inactive"] }
      },
      required: ["id", "name", "status"]
    });
    expect(schemaPass.passed).toBe(true);

    const schemaFail = DeterministicEvaluator.jsonSchema(validJson, {
      type: "object",
      required: ["missingField"]
    });
    expect(schemaFail.passed).toBe(false);

    // Fails on type mismatch
    const typeMismatch = DeterministicEvaluator.jsonSchema(validJson, {
      type: "object",
      properties: {
        id: { type: "string" } // id in validJson is a number!
      }
    });
    expect(typeMismatch.passed).toBe(false);
    expect(typeMismatch.reason).toContain("must be string");

    // Fails on enum violation
    const enumMismatch = DeterministicEvaluator.jsonSchema(validJson, {
      type: "object",
      properties: {
        status: { enum: ["archived", "deleted"] }
      }
    });
    expect(enumMismatch.passed).toBe(false);
  });

  it("evaluates forbidden terms", () => {
    const clean = "Your refund has been initiated.";
    const dirty = "Internal secret sk-ant-12345 should not leak.";

    expect(DeterministicEvaluator.forbiddenTerms(clean, ["secret", "confidential"]).passed).toBe(true);
    expect(DeterministicEvaluator.forbiddenTerms(dirty, ["secret", "confidential"]).passed).toBe(false);
  });

  it("evaluates length bounds", () => {
    const text = "Short summary";
    expect(DeterministicEvaluator.length(text, { minChars: 5, maxChars: 50 }).passed).toBe(true);
    expect(DeterministicEvaluator.length(text, { minChars: 100 }).passed).toBe(false);
  });

  it("runs composite test case evaluation", async () => {
    const tc: TestCase = {
      id: "tc_1",
      promptId: "p_1",
      name: "Payment Confirmation Check",
      inputs: { amount: 50 },
      expectedOutput: undefined,
      expectedProperties: {
        contains: ["payment", "$50"],
        forbiddenTerms: ["error", "declined"],
        minChars: 10
      },
      tags: ["billing"],
      metadata: {},
      createdAt: new Date().toISOString()
    };

    const output = "Your payment of $50 has been received successfully.";
    const result = await evaluateTestCaseOutput(tc, output);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });
});
