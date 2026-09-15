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
import { IRegistryStorage } from "./interface.js";

function clone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

export class MemoryStorage implements IRegistryStorage {
  private prompts = new Map<string, Prompt>(); // key: `${orgId}:${name}`
  private versions = new Map<string, PromptVersion>(); // key: `${promptId}:${version}`
  private environments = new Map<string, Environment>(); // key: `${orgId}:${name}`
  private deployments: Deployment[] = [];
  private aliases = new Map<string, Alias>(); // key: `${promptId}:${aliasName}`
  private testCases = new Map<string, TestCase>(); // key: testCase.id
  private evaluations = new Map<string, Evaluation>(); // key: evaluation.id
  private policies = new Map<string, Policy>(); // key: orgId
  private approvals = new Map<string, Approval>(); // key: id
  private apiKeys = new Map<string, ApiKey>(); // key: id
  private apiKeyHashes = new Map<string, string>(); // key: keyHash -> id
  private auditLogs: AuditLog[] = [];
  private usageEvents: UsageEvent[] = [];

  constructor() {
    this.seedDefaults("default");
  }

  public seedDefaults(orgId: string = "default") {
    // Default environments
    const envs = ["development", "staging", "production"];
    for (const name of envs) {
      const key = `${orgId}:${name}`;
      if (!this.environments.has(key)) {
        this.environments.set(key, {
          id: `env-${name}`,
          name,
          description: `Default ${name} environment`,
          organizationId: orgId,
          projectId: "default",
          isProtected: name === "production",
          createdAt: new Date().toISOString()
        });
      }
    }

    // Default policy
    if (!this.policies.has(orgId)) {
      this.policies.set(orgId, {
        id: `pol-${orgId}`,
        organizationId: orgId,
        name: "Default Quality & Security Policy",
        description: "Standard production quality gates and secret protection",
        rules: {
          requireDescription: false,
          requireOwner: false,
          forbidSecrets: true,
          immutablePublished: true,
          production: {
            requireEvaluation: true,
            minimumScore: 0.85,
            maxRegression: 0.05,
            requireApproval: false
          }
        },
        enabled: true,
        updatedAt: new Date().toISOString(),
        updatedBy: "system"
      });
    }
  }

  // --- Prompts ---
  async getPrompt(orgId: string, nameOrId: string): Promise<Prompt | null> {
    const byKey = this.prompts.get(`${orgId}:${nameOrId}`);
    if (byKey) return clone(byKey);

    // Try finding by id
    for (const p of this.prompts.values()) {
      if (p.organizationId === orgId && (p.id === nameOrId || p.name === nameOrId)) {
        return clone(p);
      }
    }
    return null;
  }

  async listPrompts(orgId: string, query?: { search?: string; tag?: string; status?: string; limit?: number; offset?: number }): Promise<Prompt[]> {
    const list: Prompt[] = [];
    for (const p of this.prompts.values()) {
      if (p.organizationId !== orgId) continue;
      if (query?.status && p.status !== query.status) continue;
      if (query?.tag && !p.tags.includes(query.tag)) continue;
      if (query?.search) {
        const q = query.search.toLowerCase();
        const matches = p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
        if (!matches) continue;
      }
      list.push(clone(p));
    }
    const offset = query?.offset ?? 0;
    if (query?.limit !== undefined) {
      return list.slice(offset, offset + query.limit);
    }
    return offset > 0 ? list.slice(offset) : list;
  }

  async createPrompt(prompt: Prompt): Promise<Prompt> {
    const key = `${prompt.organizationId}:${prompt.name}`;
    if (this.prompts.has(key)) {
      throw new Error(`Prompt '${prompt.name}' already exists in organization '${prompt.organizationId}'`);
    }
    this.prompts.set(key, clone(prompt));
    return clone(prompt);
  }

  async updatePrompt(orgId: string, name: string, updates: Partial<Prompt>): Promise<Prompt> {
    const key = `${orgId}:${name}`;
    const existing = this.prompts.get(key);
    if (!existing) {
      throw new Error(`Prompt '${name}' not found`);
    }
    const updated: Prompt = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.prompts.set(key, clone(updated));
    return clone(updated);
  }

  async deletePrompt(orgId: string, name: string): Promise<boolean> {
    const key = `${orgId}:${name}`;
    return this.prompts.delete(key);
  }

  // --- Versions ---
  async getPromptVersion(orgId: string, promptId: string, version: string): Promise<PromptVersion | null> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return null;
    const v = this.versions.get(`${prompt.id}:${version}`) || this.versions.get(`${prompt.name}:${version}`);
    return v ? clone(v) : null;
  }

  async listPromptVersions(orgId: string, promptId: string): Promise<PromptVersion[]> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return [];
    const list: PromptVersion[] = [];
    for (const v of this.versions.values()) {
      if (v.promptId === prompt.id || v.promptId === prompt.name) {
        list.push(clone(v));
      }
    }
    return list;
  }

  async createPromptVersion(version: PromptVersion): Promise<PromptVersion> {
    const key = `${version.promptId}:${version.version}`;
    const existing = this.versions.get(key);

    if (existing) {
      // If already published and immutable, reject modification
      if (existing.lifecycleState === "published" || existing.lifecycleState === "approved") {
        throw new Error(`Version '${version.version}' is already published and immutable.`);
      }
    }

    this.versions.set(key, clone(version));
    return clone(version);
  }

  async resolveVersion(
    orgId: string,
    promptName: string,
    target: string
  ): Promise<{ prompt: Prompt; version: PromptVersion; environment?: string } | null> {
    const prompt = await this.getPrompt(orgId, promptName);
    if (!prompt) return null;

    // 1. Is target an exact semver version?
    if (/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(target)) {
      const v = await this.getPromptVersion(orgId, prompt.id, target);
      if (v) return { prompt, version: v };
      return null;
    }

    // 2. Is target an alias (e.g. latest, canary, production)?
    const alias = await this.getAlias(orgId, prompt.id, target);
    if (alias) {
      const v = await this.getPromptVersion(orgId, prompt.id, alias.version);
      if (v) return { prompt, version: v, environment: target };
    }

    // 3. Is target an environment deployment (e.g. production, staging)?
    const latestDep = await this.getLatestDeployment(orgId, prompt.id, target);
    if (latestDep) {
      const v = await this.getPromptVersion(orgId, prompt.id, latestDep.version);
      if (v) return { prompt, version: v, environment: target };
    }

    // 4. Fallback: if 'latest' requested, pick latest published version
    if (target === "latest") {
      const all = await this.listPromptVersions(orgId, prompt.id);
      if (all.length > 0) {
        const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { prompt, version: sorted[0] };
      }
    }

    return null;
  }

  // --- Environments & Deployments ---
  async getEnvironment(orgId: string, name: string): Promise<Environment | null> {
    const env = this.environments.get(`${orgId}:${name}`);
    return env ? clone(env) : null;
  }

  async listEnvironments(orgId: string): Promise<Environment[]> {
    const res: Environment[] = [];
    for (const e of this.environments.values()) {
      if (e.organizationId === orgId) res.push(clone(e));
    }
    return res;
  }

  async createEnvironment(env: Environment): Promise<Environment> {
    const key = `${env.organizationId}:${env.name}`;
    this.environments.set(key, clone(env));
    return clone(env);
  }

  async createDeployment(deployment: Deployment): Promise<Deployment> {
    // Mark prior active deployment in this environment as superseded
    for (const d of this.deployments) {
      if (
        d.promptId === deployment.promptId &&
        d.environmentName === deployment.environmentName &&
        d.status === "active"
      ) {
        d.status = "superseded";
      }
    }
    this.deployments.push(clone(deployment));

    // Also update alias for environment name
    await this.setAlias({
      id: `alias-${deployment.promptId}-${deployment.environmentName}`,
      promptId: deployment.promptId,
      name: deployment.environmentName,
      version: deployment.version,
      promptVersionId: deployment.promptVersionId,
      updatedAt: deployment.deployedAt,
      updatedBy: deployment.deployedBy
    });

    return clone(deployment);
  }

  async listDeployments(orgId: string, promptId: string): Promise<Deployment[]> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return [];
    return this.deployments
      .filter(d => d.promptId === prompt.id || d.promptId === prompt.name)
      .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt))
      .map(clone);
  }

  async getLatestDeployment(orgId: string, promptId: string, environment: string): Promise<Deployment | null> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return null;
    const matching = this.deployments
      .filter(d => (d.promptId === prompt.id || d.promptId === prompt.name) && d.environmentName === environment && d.status === "active")
      .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));

    return matching.length > 0 ? clone(matching[0]) : null;
  }

  // --- Aliases ---
  async setAlias(alias: Alias): Promise<Alias> {
    const key = `${alias.promptId}:${alias.name}`;
    this.aliases.set(key, clone(alias));
    return clone(alias);
  }

  async getAlias(orgId: string, promptId: string, name: string): Promise<Alias | null> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return null;
    const a = this.aliases.get(`${prompt.id}:${name}`) || this.aliases.get(`${prompt.name}:${name}`);
    return a ? clone(a) : null;
  }

  // --- Testing & Evaluation ---
  async listTestCases(orgId: string, promptId: string): Promise<TestCase[]> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return [];
    const list: TestCase[] = [];
    for (const t of this.testCases.values()) {
      if (t.promptId === prompt.id || t.promptId === prompt.name) list.push(clone(t));
    }
    return list;
  }

  async createTestCase(testCase: TestCase): Promise<TestCase> {
    this.testCases.set(testCase.id, clone(testCase));
    return clone(testCase);
  }

  async createEvaluation(evaluation: Evaluation): Promise<Evaluation> {
    this.evaluations.set(evaluation.id, clone(evaluation));
    return clone(evaluation);
  }

  async getLatestEvaluation(orgId: string, promptId: string, version: string): Promise<Evaluation | null> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return null;
    const matching: Evaluation[] = [];
    for (const e of this.evaluations.values()) {
      if ((e.promptId === prompt.id || e.promptId === prompt.name) && e.version === version) {
        matching.push(e);
      }
    }
    if (matching.length === 0) return null;
    matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return clone(matching[0]);
  }

  async listEvaluations(orgId: string, promptId: string): Promise<Evaluation[]> {
    const prompt = await this.getPrompt(orgId, promptId);
    if (!prompt) return [];
    const matching: Evaluation[] = [];
    for (const e of this.evaluations.values()) {
      if (e.promptId === prompt.id || e.promptId === prompt.name) {
        matching.push(e);
      }
    }
    matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return matching.map(clone);
  }

  // --- Policies ---
  async getPolicy(orgId: string): Promise<Policy | null> {
    const p = this.policies.get(orgId);
    return p ? clone(p) : null;
  }

  async savePolicy(policy: Policy): Promise<Policy> {
    this.policies.set(policy.organizationId, clone(policy));
    return clone(policy);
  }

  // --- Approvals ---
  async createApproval(approval: Approval): Promise<Approval> {
    this.approvals.set(approval.id, clone(approval));
    return clone(approval);
  }

  async getApproval(orgId: string, id: string): Promise<Approval | null> {
    const a = this.approvals.get(id);
    if (!a) return null;
    const prompt = await this.getPrompt(orgId, a.promptId);
    if (!prompt) return null;
    return clone(a);
  }

  async updateApproval(orgId: string, id: string, updates: Partial<Approval>): Promise<Approval> {
    const existing = await this.getApproval(orgId, id);
    if (!existing) throw new Error("Approval request not found");
    const updated = { ...existing, ...updates };
    this.approvals.set(id, clone(updated));
    return clone(updated);
  }

  async listApprovals(orgId: string, status?: string, limit?: number, offset?: number): Promise<Approval[]> {
    const list: Approval[] = [];
    for (const a of this.approvals.values()) {
      const prompt = await this.getPrompt(orgId, a.promptId);
      if (!prompt) continue;
      if (status && a.status !== status) continue;
      list.push(clone(a));
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const off = offset ?? 0;
    if (limit !== undefined) {
      return list.slice(off, off + limit);
    }
    return off > 0 ? list.slice(off) : list;
  }

  // --- API Keys ---
  async createApiKey(apiKey: ApiKey): Promise<ApiKey> {
    this.apiKeys.set(apiKey.id, clone(apiKey));
    this.apiKeyHashes.set(apiKey.keyHash, apiKey.id);
    return clone(apiKey);
  }

  async findApiKeyByHash(hash: string): Promise<ApiKey | null> {
    const id = this.apiKeyHashes.get(hash);
    if (!id) return null;
    const key = this.apiKeys.get(id);
    return key ? clone(key) : null;
  }

  async updateApiKeyLastUsed(id: string, lastUsedAt: string): Promise<void> {
    const key = this.apiKeys.get(id);
    if (key) {
      key.lastUsedAt = lastUsedAt;
    }
  }

  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    const list: ApiKey[] = [];
    for (const k of this.apiKeys.values()) {
      if (k.organizationId === orgId) {
        // Return without raw hash for security
        list.push({ ...clone(k), keyHash: "[REDACTED]" });
      }
    }
    return list;
  }

  async deleteApiKey(orgId: string, id: string): Promise<boolean> {
    const key = this.apiKeys.get(id);
    if (!key || key.organizationId !== orgId) return false;
    this.apiKeyHashes.delete(key.keyHash);
    return this.apiKeys.delete(id);
  }

  // --- Audit Logs ---
  async createAuditLog(log: AuditLog): Promise<AuditLog> {
    this.auditLogs.unshift(clone(log));
    return clone(log);
  }

  async listAuditLogs(orgId: string, limit: number = 50, offset: number = 0): Promise<AuditLog[]> {
    return this.auditLogs
      .filter(l => l.organizationId === orgId)
      .slice(offset, offset + limit)
      .map(clone);
  }

  // --- Usage / Telemetry ---
  async recordUsageEvent(event: UsageEvent): Promise<void> {
    this.usageEvents.push(clone(event));
  }

  async getUsageOverview(orgId: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    avgLatencyMs: number;
    recentEvents: UsageEvent[];
  }> {
    const events = this.usageEvents.filter(e => e.organizationId === orgId);
    const totalRequests = events.length;
    const totalTokens = events.reduce((sum, e) => sum + (e.totalTokens || 0), 0);
    const avgLatencyMs =
      totalRequests > 0 ? Math.round(events.reduce((sum, e) => sum + e.latencyMs, 0) / totalRequests) : 0;

    return {
      totalRequests,
      totalTokens,
      avgLatencyMs,
      recentEvents: events.slice(-20).reverse().map(clone)
    };
  }
}
