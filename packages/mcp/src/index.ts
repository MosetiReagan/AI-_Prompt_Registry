#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PromptRegistry } from "@ai-prompt-registry/sdk";

const registryUrl = process.env.PROMPT_REGISTRY_URL || "http://localhost:3000";
const registryApiKey = process.env.PROMPT_REGISTRY_KEY;

const defaultClient = new PromptRegistry({
  baseUrl: registryUrl,
  apiKey: registryApiKey
});

/**
 * Creates and configures the standard Model Context Protocol (MCP) server
 * for AI Prompt Registry with all prompt management tools.
 */
export function createMcpServer(client: PromptRegistry = defaultClient): McpServer {
  const server = new McpServer({
    name: "ai-prompt-registry-mcp",
    version: "1.0.0"
  });

  // 1. prompt_list
  server.tool(
    "prompt_list",
    "List all prompts registered in AI Prompt Registry",
    {
      search: z.string().optional().describe("Search query for prompt name or description"),
      tag: z.string().optional().describe("Filter by tag")
    },
    async (args) => {
      try {
        const prompts = await client.listPrompts(args);
        return {
          content: [{ type: "text", text: JSON.stringify(prompts, null, 2) }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }]
        };
      }
    }
  );

  // 2. prompt_get
  server.tool(
    "prompt_get",
    "Retrieve a prompt and its resolved version by environment (e.g. production) or alias",
    {
      promptName: z.string().describe("The unique name/slug of the prompt"),
      environmentOrVersion: z
        .string()
        .optional()
        .default("production")
        .describe("Target environment (e.g. 'production', 'staging') or exact semver version (e.g. '1.0.0')")
    },
    async (args) => {
      try {
        const result = await client.get(args.promptName, args.environmentOrVersion || "production");
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }]
        };
      }
    }
  );

  // 3. prompt_get_version
  server.tool(
    "prompt_get_version",
    "Retrieve an exact immutable version of a prompt",
    {
      promptName: z.string().describe("The unique name of the prompt"),
      version: z.string().describe("Exact semver version, e.g. '1.2.0'")
    },
    async (args) => {
      try {
        const version = await client.getVersion(args.promptName, args.version);
        return {
          content: [{ type: "text", text: JSON.stringify(version, null, 2) }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }]
        };
      }
    }
  );

  // 4. prompt_render
  server.tool(
    "prompt_render",
    "Safely render a prompt with variables without executing arbitrary code",
    {
      promptName: z.string().describe("The prompt name"),
      variables: z.record(z.string(), z.any()).describe("Key-value map of input variables"),
      environmentOrVersion: z.string().optional().default("production").describe("Target environment or version")
    },
    async (args) => {
      try {
        const rendered = await client.render(args.promptName, args.variables, {
          environmentOrVersion: args.environmentOrVersion
        });
        return {
          content: [{ type: "text", text: JSON.stringify(rendered, null, 2) }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }]
        };
      }
    }
  );

  // 5. prompt_diff
  server.tool(
    "prompt_diff",
    "Semantically compare two versions of a prompt, showing breaking changes and recommended bump",
    {
      promptName: z.string().describe("The prompt name"),
      fromVersion: z.string().describe("Baseline version (e.g. '1.0.0')"),
      toVersion: z.string().describe("Candidate version (e.g. '1.1.0')")
    },
    async (args) => {
      try {
        const diff = await client.diff(args.promptName, args.fromVersion, args.toVersion);
        return {
          content: [{ type: "text", text: JSON.stringify(diff, null, 2) }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }]
        };
      }
    }
  );

  // 6. prompt_evaluate
  server.tool(
    "prompt_evaluate",
    "Run evaluation test cases on a prompt version",
    {
      promptName: z.string().describe("The prompt name"),
      version: z.string().describe("Prompt version to evaluate")
    },
    async (args) => {
      try {
        const ev = await client.evaluate(args.promptName, args.version);
        return {
          content: [{ type: "text", text: JSON.stringify(ev, null, 2) }]
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message}` }]
        };
      }
    }
  );

  return server;
}

/**
 * Starts the MCP server on stdio transport
 */
export async function startMcpServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// If directly executed
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
  });
}
