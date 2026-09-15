import { describe, it, expect } from "vitest";
import { computePromptDiff, PromptVersion } from "@ai-prompt-registry/core";

describe("Semantic Prompt Diff & SemVer Classification", () => {
  const baseVersion: PromptVersion = {
    id: "v_1",
    promptId: "p_1",
    version: "1.0.0",
    lifecycleState: "published",
    template: "Hello {{name}}",
    variables: {
      name: { type: "string", required: true }
    },
    checksum: "chk1",
    publishedAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    changelog: "init",
    metadata: {}
  };

  it("detects PATCH for minor wording modifications", () => {
    const patchVersion: PromptVersion = {
      ...baseVersion,
      id: "v_2",
      version: "1.0.1",
      template: "Hello, {{name}}!"
    };

    const diff = computePromptDiff(baseVersion, patchVersion);
    expect(diff.recommendedBump).toBe("PATCH");
    expect(diff.isBreaking).toBe(false);
    expect(diff.breakingChanges).toHaveLength(0);
  });

  it("detects MINOR when adding an optional variable", () => {
    const minorVersion: PromptVersion = {
      ...baseVersion,
      id: "v_2",
      version: "1.1.0",
      template: "Hello {{name}} {{title}}",
      variables: {
        name: { type: "string", required: true },
        title: { type: "string", required: false, default: "" }
      }
    };

    const diff = computePromptDiff(baseVersion, minorVersion);
    expect(diff.recommendedBump).toBe("MINOR");
    expect(diff.isBreaking).toBe(false);
  });

  it("detects MAJOR when adding a required variable without default", () => {
    const majorVersion: PromptVersion = {
      ...baseVersion,
      id: "v_2",
      version: "2.0.0",
      template: "Hello {{name}}, account: {{account_id}}",
      variables: {
        name: { type: "string", required: true },
        account_id: { type: "string", required: true } // BREAKING!
      }
    };

    const diff = computePromptDiff(baseVersion, majorVersion);
    expect(diff.recommendedBump).toBe("MAJOR");
    expect(diff.isBreaking).toBe(true);
    expect(diff.breakingChanges.some(b => b.includes("account_id"))).toBe(true);
  });

  it("detects MAJOR when removing a variable", () => {
    const removedVarVersion: PromptVersion = {
      ...baseVersion,
      id: "v_2",
      version: "2.0.0",
      template: "Hello world",
      variables: {}
    };

    const diff = computePromptDiff(baseVersion, removedVarVersion);
    expect(diff.recommendedBump).toBe("MAJOR");
    expect(diff.isBreaking).toBe(true);
    expect(diff.breakingChanges.some(b => b.includes("Removed variable"))).toBe(true);
  });

  it("detects MAJOR when introducing strict output schema constraints", () => {
    const schemaVersion: PromptVersion = {
      ...baseVersion,
      id: "v_2",
      version: "2.0.0",
      outputSchema: {
        type: "json_schema",
        name: "OrderOutput",
        strict: true,
        schema: { type: "object", required: ["status"] }
      }
    };

    const diff = computePromptDiff(baseVersion, schemaVersion);
    expect(diff.recommendedBump).toBe("MAJOR");
    expect(diff.isBreaking).toBe(true);
    expect(diff.breakingChanges.some(b => b.includes("JSON output schema"))).toBe(true);
  });
});
