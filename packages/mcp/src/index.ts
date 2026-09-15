#!/usr/bin/env node
import * as readline from "readline";
import { PromptRegistry } from "@ai-prompt-registry/sdk";
import { renderPrompt, computePromptDiff } from "@ai-prompt-registry/core";

const registryUrl = process.env.PROMPT_REGISTRY_URL || "http://localhost:3000";
const registryApiKey = process.env.PROMPT_REGISTRY_KEY;

const client = new PromptRegistry({
  baseUrl: registryUrl,
  apiKey: registryApiKey
});

const TOOLS = [
  {
    name: "prompt_list",
    description: "List all prompts registered in AI Prompt Registry",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search query for prompt name or description" },
        tag: { type: "string", description: "Filter by tag" }
      }
    }
  },
  {
    name: "prompt_get",
    description: "Retrieve a prompt and its resolved version by environment (e.g. production) or alias",
    inputSchema: {
      type: "object",
      required: ["promptName"],
      properties: {
        promptName: { type: "string", description: "The unique name/slug of the prompt" },
        environmentOrVersion: {
          type: "string",
          description: "Target environment (e.g. 'production', 'staging') or exact semver version (e.g. '1.0.0')",
          default: "production"
        }
      }
    }
  },
  {
    name: "prompt_get_version",
    description: "Retrieve an exact immutable version of a prompt",
    inputSchema: {
      type: "object",
      required: ["promptName", "version"],
      properties: {
        promptName: { type: "string", description: "The unique name of the prompt" },
        version: { type: "string", description: "Exact semver version, e.g. '1.2.0'" }
      }
    }
  },
  {
    name: "prompt_render",
    description: "Safely render a prompt with variables without executing arbitrary code",
    inputSchema: {
      type: "object",
      required: ["promptName", "variables"],
      properties: {
        promptName: { type: "string", description: "The prompt name" },
        variables: { type: "object", description: "Key-value map of input variables" },
        environmentOrVersion: { type: "string", default: "production" }
      }
    }
  },
  {
    name: "prompt_diff",
    description: "Semantically compare two versions of a prompt, showing breaking changes and recommended bump",
    inputSchema: {
      type: "object",
      required: ["promptName", "fromVersion", "toVersion"],
      properties: {
        promptName: { type: "string", description: "The prompt name" },
        fromVersion: { type: "string", description: "Baseline version (e.g. '1.0.0')" },
        toVersion: { type: "string", description: "Candidate version (e.g. '1.1.0')" }
      }
    }
  },
  {
    name: "prompt_evaluate",
    description: "Run evaluation test cases on a prompt version",
    inputSchema: {
      type: "object",
      required: ["promptName", "version"],
      properties: {
        promptName: { type: "string", description: "The prompt name" },
        version: { type: "string", description: "Prompt version to evaluate" }
      }
    }
  }
];

async function handleToolCall(name: string, args: any): Promise<any> {
  switch (name) {
    case "prompt_list": {
      const prompts = await client.listPrompts(args);
      return {
        content: [{ type: "text", text: JSON.stringify(prompts, null, 2) }]
      };
    }
    case "prompt_get": {
      const result = await client.get(args.promptName, args.environmentOrVersion || "production");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
    case "prompt_get_version": {
      const version = await client.getVersion(args.promptName, args.version);
      return {
        content: [{ type: "text", text: JSON.stringify(version, null, 2) }]
      };
    }
    case "prompt_render": {
      const rendered = await client.render(args.promptName, args.variables, {
        environmentOrVersion: args.environmentOrVersion
      });
      return {
        content: [{ type: "text", text: JSON.stringify(rendered, null, 2) }]
      };
    }
    case "prompt_diff": {
      const diff = await client.diff(args.promptName, args.fromVersion, args.toVersion);
      return {
        content: [{ type: "text", text: JSON.stringify(diff, null, 2) }]
      };
    }
    case "prompt_evaluate": {
      const ev = await client.evaluate(args.promptName, args.version);
      return {
        content: [{ type: "text", text: JSON.stringify(ev, null, 2) }]
      };
    }
    default:
      throw new Error(`Unknown tool '${name}'`);
  }
}

/**
 * Standard MCP JSON-RPC stdio protocol loop
 */
export function startMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on("line", async (line) => {
    if (!line.trim()) return;

    try {
      const req = JSON.parse(line);
      const id = req.id;

      if (req.method === "initialize") {
        const response = {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "ai-prompt-registry-mcp",
              version: "1.0.0"
            }
          }
        };
        process.stdout.write(JSON.stringify(response) + "\n");
        return;
      }

      if (req.method === "notifications/initialized") {
        return;
      }

      if (req.method === "tools/list") {
        const response = {
          jsonrpc: "2.0",
          id,
          result: {
            tools: TOOLS
          }
        };
        process.stdout.write(JSON.stringify(response) + "\n");
        return;
      }

      if (req.method === "tools/call") {
        const toolName = req.params?.name;
        const toolArgs = req.params?.arguments || {};
        try {
          const res = await handleToolCall(toolName, toolArgs);
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: res
            }) + "\n"
          );
        } catch (err: any) {
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message}` }]
              }
            }) + "\n"
          );
        }
        return;
      }

      // Default method not found
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method '${req.method}' not found` }
        }) + "\n"
      );
    } catch (err: any) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` }
        }) + "\n"
      );
    }
  });
}

// If directly executed
if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
