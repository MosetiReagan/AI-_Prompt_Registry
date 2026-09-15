import {
  Prompt,
  PromptVersion,
  Environment,
  Deployment,
  Alias,
  TestCase,
  Evaluation,
  Policy,
  Approval,
  ApiKey,
  AuditLog,
  UsageEvent
} from "@ai-prompt-registry/core";

export interface IRegistryStorage {
  // Prompts
  getPrompt(orgId: string, nameOrId: string): Promise<Prompt | null>;
  listPrompts(orgId: string, query?: { search?: string; tag?: string; status?: string }): Promise<Prompt[]>;
  createPrompt(prompt: Prompt): Promise<Prompt>;
  updatePrompt(orgId: string, name: string, updates: Partial<Prompt>): Promise<Prompt>;
  deletePrompt(orgId: string, name: string): Promise<boolean>;

  // Versions
  getPromptVersion(orgId: string, promptId: string, version: string): Promise<PromptVersion | null>;
  listPromptVersions(orgId: string, promptId: string): Promise<PromptVersion[]>;
  createPromptVersion(version: PromptVersion): Promise<PromptVersion>;
  resolveVersion(
    orgId: string,
    promptName: string,
    target: string
  ): Promise<{ prompt: Prompt; version: PromptVersion; environment?: string } | null>;

  // Environments & Deployments
  getEnvironment(orgId: string, name: string): Promise<Environment | null>;
  listEnvironments(orgId: string): Promise<Environment[]>;
  createEnvironment(env: Environment): Promise<Environment>;
  createDeployment(deployment: Deployment): Promise<Deployment>;
  listDeployments(orgId: string, promptId: string): Promise<Deployment[]>;
  getLatestDeployment(orgId: string, promptId: string, environment: string): Promise<Deployment | null>;

  // Aliases
  setAlias(alias: Alias): Promise<Alias>;
  getAlias(orgId: string, promptId: string, name: string): Promise<Alias | null>;

  // Testing & Evaluation
  listTestCases(orgId: string, promptId: string): Promise<TestCase[]>;
  createTestCase(testCase: TestCase): Promise<TestCase>;
  createEvaluation(evaluation: Evaluation): Promise<Evaluation>;
  getLatestEvaluation(orgId: string, promptId: string, version: string): Promise<Evaluation | null>;
  listEvaluations(orgId: string, promptId: string): Promise<Evaluation[]>;

  // Policies
  getPolicy(orgId: string): Promise<Policy | null>;
  savePolicy(policy: Policy): Promise<Policy>;

  // Approvals
  createApproval(approval: Approval): Promise<Approval>;
  getApproval(orgId: string, id: string): Promise<Approval | null>;
  updateApproval(orgId: string, id: string, updates: Partial<Approval>): Promise<Approval>;
  listApprovals(orgId: string, status?: string): Promise<Approval[]>;

  // API Keys
  createApiKey(apiKey: ApiKey): Promise<ApiKey>;
  findApiKeyByHash(hash: string): Promise<ApiKey | null>;
  listApiKeys(orgId: string): Promise<ApiKey[]>;
  deleteApiKey(orgId: string, id: string): Promise<boolean>;

  // Audit Logs
  createAuditLog(log: AuditLog): Promise<AuditLog>;
  listAuditLogs(orgId: string, limit?: number): Promise<AuditLog[]>;

  // Usage / Telemetry
  recordUsageEvent(event: UsageEvent): Promise<void>;
  getUsageOverview(orgId: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    avgLatencyMs: number;
    recentEvents: UsageEvent[];
  }>;
}
