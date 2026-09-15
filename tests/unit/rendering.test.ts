import { describe, it, expect } from "vitest";
import { renderPrompt, extractVariables, TemplateRenderError } from "@ai-prompt-registry/core";

describe("Template Engine & Safe Rendering", () => {
  it("extracts variables from text and chat templates", () => {
    const text = "Hello {{name}}, your order {{order_id}} is {{status}}.";
    const vars = extractVariables(text);
    expect(vars).toEqual(["name", "order_id", "status"]);

    const chat = [
      { role: "system" as const, content: "You are {{bot_name}}." },
      { role: "user" as const, content: "My name is {{user_name}}." }
    ];
    const chatVars = extractVariables(chat);
    expect(chatVars).toEqual(["bot_name", "user_name"]);
  });

  it("safely renders text template with variable substitution", () => {
    const template = "Hello {{customer_name}}, your ticket #{{ticket_id}} is open.";
    const result = renderPrompt(
      template,
      { customer_name: "Alice", ticket_id: 42 },
      {
        customer_name: { type: "string", required: true },
        ticket_id: { type: "number", required: true }
      }
    );

    expect(result.rendered).toBe("Hello Alice, your ticket #42 is open.");
  });

  it("safely resolves nested dot-notation properties", () => {
    const template = "Welcome {{user.profile.firstName}} from {{user.company.name}}!";
    const result = renderPrompt(
      template,
      {
        user: {
          profile: { firstName: "Bob" },
          company: { name: "Acme Corp" }
        }
      },
      {}
    );

    expect(result.rendered).toBe("Welcome Bob from Acme Corp!");
  });

  it("safely stringifies JSON and array variables", () => {
    const template = "Config: {{config}}\nList: {{items}}";
    const result = renderPrompt(
      template,
      {
        config: { retries: 3, timeout: 5000 },
        items: ["apple", "banana"]
      },
      {
        config: { type: "json", required: true },
        items: { type: "array", required: true }
      }
    );

    expect(typeof result.rendered).toBe("string");
    expect(result.rendered).toContain('"retries": 3');
    expect(result.rendered).toContain('"apple"');
  });

  it("throws TemplateRenderError on missing required variables", () => {
    const template = "Hello {{name}}";
    expect(() => {
      renderPrompt(template, {}, { name: { type: "string", required: true } });
    }).toThrow(TemplateRenderError);
  });

  it("enforces strict mode rejecting undeclared variables", () => {
    const template = "Hello {{name}}";
    expect(() => {
      renderPrompt(
        template,
        { name: "John", extraVar: "malicious" },
        { name: { type: "string", required: true } },
        { strict: true }
      );
    }).toThrow(/Unknown variable 'extraVar'/);
  });

  it("safely renders chat message templates", () => {
    const chat = [
      { role: "system" as const, content: "System assistant: {{role_desc}}" },
      { role: "user" as const, content: "Query from {{user_name}}" }
    ];

    const result = renderPrompt(
      chat,
      { role_desc: "Support Agent", user_name: "Charlie" },
      {
        role_desc: { type: "string", required: true },
        user_name: { type: "string", required: true }
      }
    );

    expect(Array.isArray(result.rendered)).toBe(true);
    const messages = result.rendered as any[];
    expect(messages[0].content).toBe("System assistant: Support Agent");
    expect(messages[1].content).toBe("Query from Charlie");
  });
});
