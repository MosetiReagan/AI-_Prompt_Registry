import YAML from "yaml";
import { createHash } from "crypto";
import { z } from "zod";
import {
  ChatMessageSchema,
  VariableDefinitionSchema,
  ModelPreferencesSchema,
  OutputSchemaDefinitionSchema
} from "../types/models.js";

export const GitPromptFileSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  owner: z.string().optional(),
  team: z.string().optional(),
  type: z.enum(["text", "chat"]).default("chat"),
  template: z.union([
    z.string(),
    z.array(ChatMessageSchema)
  ]).optional(),
  messages: z.array(ChatMessageSchema).optional(),
  variables: z.record(VariableDefinitionSchema).default({}),
  outputSchema: OutputSchemaDefinitionSchema.optional(),
  model: ModelPreferencesSchema.optional(),
  metadata: z.record(z.any()).default({}),
  tests: z.array(z.object({
    name: z.string(),
    inputs: z.record(z.any()),
    expectedOutput: z.string().optional(),
    expectedProperties: z.record(z.any()).default({})
  })).optional()
});
export type GitPromptFile = z.infer<typeof GitPromptFileSchema>;

/**
 * Computes deterministic SHA-256 checksum of prompt version content
 */
export function computePromptChecksum(payload: {
  name: string;
  version: string;
  template: any;
  variables: any;
  outputSchema?: any;
}): string {
  const normalized = JSON.stringify({
    name: payload.name,
    version: payload.version,
    template: payload.template,
    variables: payload.variables,
    outputSchema: payload.outputSchema || null
  });
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Parses raw YAML or JSON string into validated GitPromptFile
 */
export function parsePromptFile(raw: string, filename: string = "prompt.yaml"): GitPromptFile {
  let parsedObj: any;
  if (filename.endsWith(".json")) {
    parsedObj = JSON.parse(raw);
  } else {
    parsedObj = YAML.parse(raw);
  }

  // Support both 'messages' and 'template' keys
  if (!parsedObj.template && parsedObj.messages) {
    parsedObj.template = parsedObj.messages;
  }

  const result = GitPromptFileSchema.safeParse(parsedObj);
  if (!result.success) {
    throw new Error(
      `Failed to parse prompt file: ${result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")}`
    );
  }

  return result.data;
}

/**
 * Serializes prompt version data to YAML string
 */
export function serializePromptToYaml(data: Partial<GitPromptFile>): string {
  const docData: any = {
    name: data.name,
    version: data.version,
    description: data.description || "",
    tags: data.tags || []
  };

  if (data.owner) docData.owner = data.owner;
  if (data.team) docData.team = data.team;

  if (Array.isArray(data.template)) {
    docData.messages = data.template;
  } else if (typeof data.template === "string") {
    docData.template = data.template;
  }

  if (data.variables && Object.keys(data.variables).length > 0) {
    docData.variables = data.variables;
  }

  if (data.model) {
    docData.model = data.model;
  }

  if (data.outputSchema) {
    docData.outputSchema = data.outputSchema;
  }

  return YAML.stringify(docData, { indent: 2 });
}
