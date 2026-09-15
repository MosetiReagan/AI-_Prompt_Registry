import { z } from "zod";

export const VariableTypeSchema = z.enum(["string", "number", "boolean", "json", "array"]);
export type VariableType = z.infer<typeof VariableTypeSchema>;

export const VariableDefinitionSchema = z.object({
  type: VariableTypeSchema.default("string"),
  required: z.boolean().default(true),
  default: z.any().optional(),
  description: z.string().optional(),
  enum: z.array(z.string()).optional(),
  regex: z.string().optional()
});
export type VariableDefinition = z.infer<typeof VariableDefinitionSchema>;

export const ChatRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ContentPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string()
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(["low", "high", "auto"]).optional()
    })
  })
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.union([z.string(), z.array(ContentPartSchema)]),
  name: z.string().optional(),
  toolCalls: z.array(z.any()).optional()
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PromptTypeSchema = z.enum(["text", "chat"]);
export type PromptType = z.infer<typeof PromptTypeSchema>;

export const LifecycleStateSchema = z.enum([
  "draft",
  "testing",
  "approved",
  "published",
  "deprecated"
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const ModelPreferencesSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  seed: z.number().optional()
});
export type ModelPreferences = z.infer<typeof ModelPreferencesSchema>;

export const OutputSchemaDefinitionSchema = z.object({
  type: z.literal("json_schema"),
  name: z.string().optional(),
  strict: z.boolean().default(true),
  schema: z.record(z.any())
});
export type OutputSchemaDefinition = z.infer<typeof OutputSchemaDefinitionSchema>;

// Prompt Resource Schema
export const PromptSchema = z.object({
  id: z.string(),
  name: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/, {
    message: "Name must only contain alphanumeric characters, dots, dashes, and underscores"
  }),
  slug: z.string(),
  description: z.string().default(""),
  type: PromptTypeSchema.default("chat"),
  status: z.enum(["active", "archived", "deprecated"]).default("active"),
  tags: z.array(z.string()).default([]),
  owner: z.string().optional(),
  team: z.string().optional(),
  organizationId: z.string().default("default"),
  projectId: z.string().default("default"),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.any()).default({})
});
export type Prompt = z.infer<typeof PromptSchema>;

// Prompt Version Schema
export const PromptVersionSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, {
    message: "Version must follow Semantic Versioning (e.g. 1.0.0)"
  }),
  lifecycleState: LifecycleStateSchema.default("draft"),
  template: z.union([
    z.string(),
    z.array(ChatMessageSchema)
  ]),
  variables: z.record(VariableDefinitionSchema).default({}),
  outputSchema: OutputSchemaDefinitionSchema.optional(),
  modelPreferences: ModelPreferencesSchema.optional(),
  author: z.string().optional(),
  changelog: z.string().default(""),
  checksum: z.string(),
  publishedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  metadata: z.record(z.any()).default({})
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

// Environment Schema
export const EnvironmentSchema = z.object({
  id: z.string(),
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().default(""),
  organizationId: z.string().default("default"),
  projectId: z.string().default("default"),
  isProtected: z.boolean().default(false), // e.g. production requires approvals
  createdAt: z.string()
});
export type Environment = z.infer<typeof EnvironmentSchema>;

// Deployment Record
export const DeploymentSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  promptName: z.string(),
  environmentName: z.string(),
  version: z.string(),
  promptVersionId: z.string(),
  deployedBy: z.string().default("system"),
  deployedAt: z.string(),
  rollbackFromDeploymentId: z.string().nullable().default(null),
  status: z.enum(["active", "superseded", "rolled_back"]).default("active"),
  notes: z.string().default("")
});
export type Deployment = z.infer<typeof DeploymentSchema>;

// Alias Mapping
export const AliasSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  name: z.string(), // "production", "staging", "latest", "canary"
  version: z.string(),
  promptVersionId: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().default("system")
});
export type Alias = z.infer<typeof AliasSchema>;

// Test Case Schema
export const TestCaseSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  inputs: z.record(z.any()),
  expectedOutput: z.string().optional(),
  expectedProperties: z.record(z.any()).default({}), // e.g. { contains: ["x"], jsonValid: true }
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
  createdAt: z.string()
});
export type TestCase = z.infer<typeof TestCaseSchema>;

// Evaluator Config & Results
export const EvaluatorTypeSchema = z.enum([
  "exact_match",
  "contains",
  "regex",
  "json_valid",
  "json_schema",
  "length",
  "required_fields",
  "forbidden_terms",
  "llm_as_judge"
]);
export type EvaluatorType = z.infer<typeof EvaluatorTypeSchema>;

export const TestResultSchema = z.object({
  testCaseId: z.string(),
  testCaseName: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  output: z.string(),
  evaluations: z.array(z.object({
    type: z.string(),
    passed: z.boolean(),
    score: z.number().min(0).max(1),
    reason: z.string()
  })),
  durationMs: z.number(),
  error: z.string().optional()
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const EvaluationSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  promptVersionId: z.string(),
  version: z.string(),
  type: z.enum(["deterministic", "llm_as_judge", "hybrid"]).default("deterministic"),
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  totalTests: z.number().int().min(0),
  passedTests: z.number().int().min(0),
  testResults: z.array(TestResultSchema),
  evaluatorConfig: z.record(z.any()).default({}),
  isAIGenerated: z.boolean().default(false),
  createdAt: z.string(),
  createdBy: z.string().default("system")
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

// Policy Schema
export const PolicyRulesSchema = z.object({
  requireDescription: z.boolean().default(false),
  requireOwner: z.boolean().default(false),
  forbidSecrets: z.boolean().default(true),
  immutablePublished: z.boolean().default(true),
  production: z.object({
    requireEvaluation: z.boolean().default(true),
    minimumScore: z.number().min(0).max(1).default(0.85),
    maxRegression: z.number().min(0).max(1).default(0.05),
    requireApproval: z.boolean().default(false)
  }).default({
    requireEvaluation: true,
    minimumScore: 0.85,
    maxRegression: 0.05,
    requireApproval: false
  }),
  allowedProviders: z.array(z.string()).optional(),
  allowedModels: z.array(z.string()).optional()
});
export type PolicyRules = z.infer<typeof PolicyRulesSchema>;

export const PolicySchema = z.object({
  id: z.string(),
  organizationId: z.string().default("default"),
  name: z.string(),
  description: z.string().default(""),
  rules: PolicyRulesSchema,
  enabled: z.boolean().default(true),
  updatedAt: z.string(),
  updatedBy: z.string().default("system")
});
export type Policy = z.infer<typeof PolicySchema>;

// Approval Schema
export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  promptName: z.string(),
  promptVersionId: z.string(),
  version: z.string(),
  targetEnvironment: z.string(),
  requestedBy: z.string(),
  status: ApprovalStatusSchema.default("pending"),
  reviewedBy: z.string().nullable().default(null),
  reviewNote: z.string().default(""),
  createdAt: z.string(),
  reviewedAt: z.string().nullable().default(null)
});
export type Approval = z.infer<typeof ApprovalSchema>;

// API Key Schema
export const ApiKeyScopeSchema = z.enum(["read", "write", "publish", "admin", "execute"]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

export const ApiKeySchema = z.object({
  id: z.string(),
  organizationId: z.string().default("default"),
  name: z.string(),
  keyHash: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(ApiKeyScopeSchema).default(["read", "execute"]),
  expiresAt: z.string().nullable().default(null),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable().default(null)
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// Audit Log Schema
export const AuditLogSchema = z.object({
  id: z.string(),
  organizationId: z.string().default("default"),
  actor: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["user", "api_key", "system", "anonymous"])
  }),
  action: z.string(),
  resource: z.object({
    type: z.string(),
    id: z.string(),
    name: z.string().optional(),
    version: z.string().optional()
  }),
  environment: z.string().optional(),
  requestId: z.string(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.record(z.any()).default({}),
  timestamp: z.string()
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// Usage / Telemetry Schema
export const UsageEventSchema = z.object({
  id: z.string(),
  promptName: z.string(),
  promptVersion: z.string(),
  environment: z.string(),
  latencyMs: z.number().nonnegative(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  success: z.boolean(),
  errorCode: z.string().optional(),
  organizationId: z.string().default("default"),
  timestamp: z.string()
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;
