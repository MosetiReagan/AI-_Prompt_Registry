import { describe, it, expect } from "vitest";
import {
  parsePromptFile,
  serializePromptToYaml,
  computePromptChecksum
} from "@ai-prompt-registry/core";

describe("Git Prompt File Formats and Checksums", () => {
  const yamlContent = `
name: support.reply
version: 1.0.0
description: Helpful customer support agent
type: chat
tags: [support, production]
messages:
  - role: system
    content: You are a support agent.
  - role: user
    content: "User {{user_name}}: {{issue}}"
variables:
  user_name:
    type: string
    required: true
  issue:
    type: string
    required: true
model:
  provider: openai
  name: gpt-4o
`;

  it("parses valid YAML prompt file into structured GitPromptFile", () => {
    const parsed = parsePromptFile(yamlContent, "support.prompt.yaml");
    expect(parsed.name).toBe("support.reply");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.type).toBe("chat");
    expect(parsed.variables.user_name.type).toBe("string");
    expect(parsed.variables.user_name.required).toBe(true);
    expect(parsed.model?.name).toBe("gpt-4o");
  });

  it("serializes prompt data back to valid YAML", () => {
    const parsed = parsePromptFile(yamlContent, "support.prompt.yaml");
    const serialized = serializePromptToYaml(parsed);
    expect(serialized).toContain("name: support.reply");
    expect(serialized).toContain("version: 1.0.0");
    expect(serialized).toContain("user_name:");
  });

  it("computes deterministic SHA-256 checksum", () => {
    const payload = {
      name: "support.reply",
      version: "1.0.0",
      template: "Hello {{name}}",
      variables: { name: { type: "string" as const, required: true } }
    };

    const checksum1 = computePromptChecksum(payload);
    const checksum2 = computePromptChecksum(payload);
    expect(checksum1).toBe(checksum2);
    expect(checksum1).toHaveLength(64); // SHA-256 hex
  });

  it("produces identical checksum regardless of nested object key insertion order", () => {
    // Object with key order A -> B -> C
    const payload1 = {
      name: "order.test",
      version: "2.0.0",
      template: {
        role: "system",
        content: "Be helpful",
        metadata: { alpha: 1, beta: 2, gamma: 3 }
      },
      variables: {
        varA: { type: "string" as const, default: "A", required: true },
        varB: { type: "number" as const, default: 10, required: false }
      }
    };

    // Exactly equivalent object with reversed key order C -> B -> A and varB before varA
    const payload2 = {
      version: "2.0.0",
      name: "order.test",
      template: {
        metadata: { gamma: 3, beta: 2, alpha: 1 },
        content: "Be helpful",
        role: "system"
      },
      variables: {
        varB: { required: false, default: 10, type: "number" as const },
        varA: { required: true, default: "A", type: "string" as const }
      }
    };

    const hash1 = computePromptChecksum(payload1);
    const hash2 = computePromptChecksum(payload2);
    expect(hash1).toBe(hash2);
  });
});
