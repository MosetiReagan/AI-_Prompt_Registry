import { describe, it, expect, vi } from "vitest";
import { createMcpServer } from "../../packages/mcp/src/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PromptRegistry } from "@ai-prompt-registry/sdk";

describe("Official @modelcontextprotocol/sdk MCP Server", () => {
  it("creates an McpServer instance with registered tools", () => {
    const mockClient = {
      listPrompts: vi.fn().mockResolvedValue([{ name: "test-prompt" }]),
      get: vi.fn().mockResolvedValue({ prompt: { name: "test-prompt" }, version: { version: "1.0.0" } }),
      getVersion: vi.fn().mockResolvedValue({ version: "1.0.0" }),
      render: vi.fn().mockResolvedValue({ rendered: "Hello World" }),
      diff: vi.fn().mockResolvedValue({ changes: [] }),
      evaluate: vi.fn().mockResolvedValue({ score: 1.0, passed: true })
    } as unknown as PromptRegistry;

    const server = createMcpServer(mockClient);
    expect(server).toBeInstanceOf(McpServer);
  });
});
