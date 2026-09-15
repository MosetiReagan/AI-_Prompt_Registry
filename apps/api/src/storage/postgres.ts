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

/**
 * Production PostgreSQL Storage Adapter
 * Compatible with node-postgres (pg) pool or Neon / Supabase / RDS
 */
export class PostgresStorage implements IRegistryStorage {
  private pool: any;

  constructor(pool: any) {
    this.pool = pool;
  }

  private async query(text: string, params: any[] = []): Promise<any> {
    return this.pool.query(text, params);
  }

  async getPrompt(orgId: string, nameOrId: string): Promise<Prompt | null> {
    const res = await this.query(
      `SELECT * FROM prompts WHERE organization_id = $1 AND (name = $2 OR id = $2)`,
      [orgId, nameOrId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      type: r.type,
      status: r.status,
      tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags || [],
      owner: r.owner,
      team: r.team,
      organizationId: r.organization_id,
      projectId: r.project_id,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at.toISOString ? r.updated_at.toISOString() : r.updated_at,
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {}
    };
  }

  async listPrompts(orgId: string, query?: { search?: string; tag?: string; status?: string; limit?: number; offset?: number }): Promise<Prompt[]> {
    let sql = `SELECT * FROM prompts WHERE organization_id = $1`;
    const params: any[] = [orgId];

    if (query?.status) {
      params.push(query.status);
      sql += ` AND status = $${params.length}`;
    }
    if (query?.search) {
      params.push(`%${query.search}%`);
      sql += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }
    sql += ` ORDER BY updated_at DESC`;

    if (query?.limit !== undefined) {
      params.push(query.limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (query?.offset !== undefined) {
      params.push(query.offset);
      sql += ` OFFSET $${params.length}`;
    }

    const res = await this.query(sql, params);
    return res.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      type: r.type,
      status: r.status,
      tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags || [],
      owner: r.owner,
      team: r.team,
      organizationId: r.organization_id,
      projectId: r.project_id,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at.toISOString ? r.updated_at.toISOString() : r.updated_at,
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {}
    }));
  }

  async createPrompt(prompt: Prompt): Promise<Prompt> {
    await this.query(
      `INSERT INTO prompts (id, organization_id, project_id, name, slug, description, type, status, tags, owner, team, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        prompt.id,
        prompt.organizationId,
        prompt.projectId,
        prompt.name,
        prompt.slug,
        prompt.description,
        prompt.type,
        prompt.status,
        JSON.stringify(prompt.tags),
        prompt.owner,
        prompt.team,
        JSON.stringify(prompt.metadata),
        prompt.createdAt,
        prompt.updatedAt
      ]
    );
    return prompt;
  }

  async updatePrompt(orgId: string, name: string, updates: Partial<Prompt>): Promise<Prompt> {
    const existing = await this.getPrompt(orgId, name);
    if (!existing) throw new Error(`Prompt '${name}' not found`);

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.query(
      `UPDATE prompts SET description = $1, status = $2, tags = $3, owner = $4, team = $5, metadata = $6, updated_at = $7
       WHERE organization_id = $8 AND name = $9`,
      [
        updated.description,
        updated.status,
        JSON.stringify(updated.tags),
        updated.owner,
        updated.team,
        JSON.stringify(updated.metadata),
        updated.updatedAt,
        orgId,
        name
      ]
    );

    return updated;
  }

  async deletePrompt(orgId: string, name: string): Promise<boolean> {
    const res = await this.query(`DELETE FROM prompts WHERE organization_id = $1 AND name = $2`, [orgId, name]);
    return (res.rowCount || 0) > 0;
  }

  // --- Versions ---
  async getPromptVersion(orgId: string, promptId: string, version: string): Promise<PromptVersion | null> {
    const res = await this.query(
      `SELECT pv.* FROM prompt_versions pv
       JOIN prompts p ON pv.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2) AND pv.version = $3`,
      [orgId, promptId, version]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      promptId: r.prompt_id,
      version: r.version,
      lifecycleState: r.lifecycle_state,
      template: typeof r.template === "string" ? JSON.parse(r.template) : r.template,
      variables: typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables || {},
      outputSchema: r.output_schema ? (typeof r.output_schema === "string" ? JSON.parse(r.output_schema) : r.output_schema) : undefined,
      modelPreferences: r.model_preferences ? (typeof r.model_preferences === "string" ? JSON.parse(r.model_preferences) : r.model_preferences) : undefined,
      author: r.author,
      changelog: r.changelog,
      checksum: r.checksum,
      publishedAt: r.published_at ? (r.published_at.toISOString ? r.published_at.toISOString() : r.published_at) : null,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {}
    };
  }

  async listPromptVersions(orgId: string, promptId: string): Promise<PromptVersion[]> {
    const res = await this.query(
      `SELECT pv.* FROM prompt_versions pv
       JOIN prompts p ON pv.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2)
       ORDER BY pv.created_at DESC`,
      [orgId, promptId]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      promptId: r.prompt_id,
      version: r.version,
      lifecycleState: r.lifecycle_state,
      template: typeof r.template === "string" ? JSON.parse(r.template) : r.template,
      variables: typeof r.variables === "string" ? JSON.parse(r.variables) : r.variables || {},
      outputSchema: r.output_schema ? (typeof r.output_schema === "string" ? JSON.parse(r.output_schema) : r.output_schema) : undefined,
      modelPreferences: r.model_preferences ? (typeof r.model_preferences === "string" ? JSON.parse(r.model_preferences) : r.model_preferences) : undefined,
      author: r.author,
      changelog: r.changelog,
      checksum: r.checksum,
      publishedAt: r.published_at ? (r.published_at.toISOString ? r.published_at.toISOString() : r.published_at) : null,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {}
    }));
  }

  async createPromptVersion(version: PromptVersion): Promise<PromptVersion> {
    const res = await this.query(
      `INSERT INTO prompt_versions (id, prompt_id, version, lifecycle_state, template, variables, output_schema, model_preferences, author, changelog, checksum, published_at, created_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (prompt_id, version) DO UPDATE SET
         lifecycle_state = EXCLUDED.lifecycle_state,
         template = EXCLUDED.template,
         variables = EXCLUDED.variables,
         output_schema = EXCLUDED.output_schema,
         model_preferences = EXCLUDED.model_preferences,
         author = EXCLUDED.author,
         changelog = EXCLUDED.changelog,
         checksum = EXCLUDED.checksum,
         published_at = EXCLUDED.published_at,
         metadata = EXCLUDED.metadata
       WHERE prompt_versions.lifecycle_state NOT IN ('published', 'approved')
       RETURNING *`,
      [
        version.id,
        version.promptId,
        version.version,
        version.lifecycleState,
        JSON.stringify(version.template),
        JSON.stringify(version.variables),
        version.outputSchema ? JSON.stringify(version.outputSchema) : null,
        version.modelPreferences ? JSON.stringify(version.modelPreferences) : null,
        version.author,
        version.changelog,
        version.checksum,
        version.publishedAt,
        version.createdAt,
        JSON.stringify(version.metadata)
      ]
    );

    if (res.rows.length === 0) {
      throw new Error(`Version '${version.version}' is already published and immutable.`);
    }

    return version;
  }

  async resolveVersion(
    orgId: string,
    promptName: string,
    target: string
  ): Promise<{ prompt: Prompt; version: PromptVersion; environment?: string } | null> {
    const prompt = await this.getPrompt(orgId, promptName);
    if (!prompt) return null;

    if (/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(target)) {
      const v = await this.getPromptVersion(orgId, prompt.id, target);
      if (v) return { prompt, version: v };
      return null;
    }

    const alias = await this.getAlias(orgId, prompt.id, target);
    if (alias) {
      const v = await this.getPromptVersion(orgId, prompt.id, alias.version);
      if (v) return { prompt, version: v, environment: target };
    }

    const latestDep = await this.getLatestDeployment(orgId, prompt.id, target);
    if (latestDep) {
      const v = await this.getPromptVersion(orgId, prompt.id, latestDep.version);
      if (v) return { prompt, version: v, environment: target };
    }

    if (target === "latest") {
      const all = await this.listPromptVersions(orgId, prompt.id);
      if (all.length > 0) return { prompt, version: all[0] };
    }

    return null;
  }

  async getEnvironment(orgId: string, name: string): Promise<Environment | null> {
    const res = await this.query(`SELECT * FROM environments WHERE organization_id = $1 AND name = $2`, [orgId, name]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      organizationId: r.organization_id,
      projectId: "default",
      isProtected: r.is_protected,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at
    };
  }

  async listEnvironments(orgId: string): Promise<Environment[]> {
    const res = await this.query(`SELECT * FROM environments WHERE organization_id = $1 ORDER BY name ASC`, [orgId]);
    return res.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      organizationId: r.organization_id,
      projectId: "default",
      isProtected: r.is_protected,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at
    }));
  }

  async createEnvironment(env: Environment): Promise<Environment> {
    await this.query(
      `INSERT INTO environments (id, organization_id, name, description, is_protected, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, name) DO NOTHING`,
      [env.id, env.organizationId, env.name, env.description, env.isProtected, env.createdAt]
    );
    return env;
  }

  async createDeployment(deployment: Deployment): Promise<Deployment> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE deployments SET status = 'superseded' WHERE prompt_id = $1 AND environment_name = $2 AND status = 'active'`,
        [deployment.promptId, deployment.environmentName]
      );

      await client.query(
        `INSERT INTO deployments (id, prompt_id, prompt_name, environment_name, version, prompt_version_id, deployed_by, deployed_at, rollback_from_deployment_id, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          deployment.id,
          deployment.promptId,
          deployment.promptName,
          deployment.environmentName,
          deployment.version,
          deployment.promptVersionId,
          deployment.deployedBy,
          deployment.deployedAt,
          deployment.rollbackFromDeploymentId,
          deployment.status,
          deployment.notes
        ]
      );

      await client.query(
        `INSERT INTO aliases (id, prompt_id, name, version, prompt_version_id, updated_at, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (prompt_id, name) DO UPDATE SET
           version = EXCLUDED.version,
           prompt_version_id = EXCLUDED.prompt_version_id,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
        [
          `alias-${deployment.promptId}-${deployment.environmentName}`,
          deployment.promptId,
          deployment.environmentName,
          deployment.version,
          deployment.promptVersionId,
          deployment.deployedAt,
          deployment.deployedBy
        ]
      );

      await client.query("COMMIT");
      return deployment;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listDeployments(orgId: string, promptId: string): Promise<Deployment[]> {
    const res = await this.query(
      `SELECT d.* FROM deployments d
       JOIN prompts p ON d.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2)
       ORDER BY d.deployed_at DESC`,
      [orgId, promptId]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      promptId: r.prompt_id,
      promptName: r.prompt_name,
      environmentName: r.environment_name,
      version: r.version,
      promptVersionId: r.prompt_version_id,
      deployedBy: r.deployed_by,
      deployedAt: r.deployed_at.toISOString ? r.deployed_at.toISOString() : r.deployed_at,
      rollbackFromDeploymentId: r.rollback_from_deployment_id,
      status: r.status,
      notes: r.notes
    }));
  }

  async getLatestDeployment(orgId: string, promptId: string, environment: string): Promise<Deployment | null> {
    const res = await this.query(
      `SELECT d.* FROM deployments d
       JOIN prompts p ON d.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2) AND d.environment_name = $3 AND d.status = 'active'
       ORDER BY d.deployed_at DESC LIMIT 1`,
      [orgId, promptId, environment]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      promptId: r.prompt_id,
      promptName: r.prompt_name,
      environmentName: r.environment_name,
      version: r.version,
      promptVersionId: r.prompt_version_id,
      deployedBy: r.deployed_by,
      deployedAt: r.deployed_at.toISOString ? r.deployed_at.toISOString() : r.deployed_at,
      rollbackFromDeploymentId: r.rollback_from_deployment_id,
      status: r.status,
      notes: r.notes
    };
  }

  async setAlias(alias: Alias): Promise<Alias> {
    await this.query(
      `INSERT INTO aliases (id, prompt_id, name, version, prompt_version_id, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (prompt_id, name) DO UPDATE SET
         version = EXCLUDED.version,
         prompt_version_id = EXCLUDED.prompt_version_id,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
      [alias.id, alias.promptId, alias.name, alias.version, alias.promptVersionId, alias.updatedAt, alias.updatedBy]
    );
    return alias;
  }

  async getAlias(orgId: string, promptId: string, name: string): Promise<Alias | null> {
    const res = await this.query(
      `SELECT a.* FROM aliases a
       JOIN prompts p ON a.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2) AND a.name = $3`,
      [orgId, promptId, name]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      promptId: r.prompt_id,
      name: r.name,
      version: r.version,
      promptVersionId: r.prompt_version_id,
      updatedAt: r.updated_at.toISOString ? r.updated_at.toISOString() : r.updated_at,
      updatedBy: r.updated_by
    };
  }

  async listTestCases(orgId: string, promptId: string): Promise<TestCase[]> {
    const res = await this.query(
      `SELECT tc.* FROM test_cases tc
       JOIN prompts p ON tc.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2)
       ORDER BY tc.created_at ASC`,
      [orgId, promptId]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      promptId: r.prompt_id,
      name: r.name,
      description: r.description,
      inputs: typeof r.inputs === "string" ? JSON.parse(r.inputs) : r.inputs,
      expectedOutput: r.expected_output,
      expectedProperties: typeof r.expected_properties === "string" ? JSON.parse(r.expected_properties) : r.expected_properties || {},
      tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags || [],
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {},
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at
    }));
  }

  async createTestCase(testCase: TestCase): Promise<TestCase> {
    await this.query(
      `INSERT INTO test_cases (id, prompt_id, name, description, inputs, expected_output, expected_properties, tags, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        testCase.id,
        testCase.promptId,
        testCase.name,
        testCase.description,
        JSON.stringify(testCase.inputs),
        testCase.expectedOutput,
        JSON.stringify(testCase.expectedProperties),
        JSON.stringify(testCase.tags),
        JSON.stringify(testCase.metadata),
        testCase.createdAt
      ]
    );
    return testCase;
  }

  async createEvaluation(evaluation: Evaluation): Promise<Evaluation> {
    await this.query(
      `INSERT INTO evaluations (id, prompt_id, prompt_version_id, version, type, score, passed, total_tests, passed_tests, test_results, evaluator_config, is_ai_generated, created_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        evaluation.id,
        evaluation.promptId,
        evaluation.promptVersionId,
        evaluation.version,
        evaluation.type,
        evaluation.score,
        evaluation.passed,
        evaluation.totalTests,
        evaluation.passedTests,
        JSON.stringify(evaluation.testResults),
        JSON.stringify(evaluation.evaluatorConfig),
        evaluation.isAIGenerated,
        evaluation.createdAt,
        evaluation.createdBy
      ]
    );
    return evaluation;
  }

  async getLatestEvaluation(orgId: string, promptId: string, version: string): Promise<Evaluation | null> {
    const res = await this.query(
      `SELECT e.* FROM evaluations e
       JOIN prompts p ON e.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2) AND e.version = $3
       ORDER BY e.created_at DESC LIMIT 1`,
      [orgId, promptId, version]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      promptId: r.prompt_id,
      promptVersionId: r.prompt_version_id,
      version: r.version,
      type: r.type,
      score: parseFloat(r.score),
      passed: r.passed,
      totalTests: r.total_tests,
      passedTests: r.passed_tests,
      testResults: typeof r.test_results === "string" ? JSON.parse(r.test_results) : r.test_results,
      evaluatorConfig: typeof r.evaluator_config === "string" ? JSON.parse(r.evaluator_config) : r.evaluator_config,
      isAIGenerated: r.is_ai_generated,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      createdBy: r.created_by
    };
  }

  async listEvaluations(orgId: string, promptId: string): Promise<Evaluation[]> {
    const res = await this.query(
      `SELECT e.* FROM evaluations e
       JOIN prompts p ON e.prompt_id = p.id
       WHERE p.organization_id = $1 AND (p.id = $2 OR p.name = $2)
       ORDER BY e.created_at DESC`,
      [orgId, promptId]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      promptId: r.prompt_id,
      promptVersionId: r.prompt_version_id,
      version: r.version,
      type: r.type,
      score: parseFloat(r.score),
      passed: r.passed,
      totalTests: r.total_tests,
      passedTests: r.passed_tests,
      testResults: typeof r.test_results === "string" ? JSON.parse(r.test_results) : r.test_results,
      evaluatorConfig: typeof r.evaluator_config === "string" ? JSON.parse(r.evaluator_config) : r.evaluator_config,
      isAIGenerated: r.is_ai_generated,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      createdBy: r.created_by
    }));
  }

  async getPolicy(orgId: string): Promise<Policy | null> {
    const res = await this.query(`SELECT * FROM policies WHERE organization_id = $1`, [orgId]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      description: r.description,
      rules: typeof r.rules === "string" ? JSON.parse(r.rules) : r.rules,
      enabled: r.enabled,
      updatedAt: r.updated_at.toISOString ? r.updated_at.toISOString() : r.updated_at,
      updatedBy: r.updated_by
    };
  }

  async savePolicy(policy: Policy): Promise<Policy> {
    await this.query(
      `INSERT INTO policies (id, organization_id, name, description, rules, enabled, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (organization_id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         rules = EXCLUDED.rules,
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
      [
        policy.id,
        policy.organizationId,
        policy.name,
        policy.description,
        JSON.stringify(policy.rules),
        policy.enabled,
        policy.updatedAt,
        policy.updatedBy
      ]
    );
    return policy;
  }

  async createApproval(approval: Approval): Promise<Approval> {
    await this.query(
      `INSERT INTO approvals (id, prompt_id, prompt_name, prompt_version_id, version, target_environment, requested_by, status, reviewed_by, review_note, created_at, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        approval.id,
        approval.promptId,
        approval.promptName,
        approval.promptVersionId,
        approval.version,
        approval.targetEnvironment,
        approval.requestedBy,
        approval.status,
        approval.reviewedBy,
        approval.reviewNote,
        approval.createdAt,
        approval.reviewedAt
      ]
    );
    return approval;
  }

  async getApproval(orgId: string, id: string): Promise<Approval | null> {
    const res = await this.query(
      `SELECT a.* FROM approvals a
       JOIN prompts p ON a.prompt_id = p.id
       WHERE p.organization_id = $1 AND a.id = $2`,
      [orgId, id]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      promptId: r.prompt_id,
      promptName: r.prompt_name,
      promptVersionId: r.prompt_version_id,
      version: r.version,
      targetEnvironment: r.target_environment,
      requestedBy: r.requested_by,
      status: r.status,
      reviewedBy: r.reviewed_by,
      reviewNote: r.review_note,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      reviewedAt: r.reviewed_at ? (r.reviewed_at.toISOString ? r.reviewed_at.toISOString() : r.reviewed_at) : null
    };
  }

  async updateApproval(orgId: string, id: string, updates: Partial<Approval>): Promise<Approval> {
    const existing = await this.getApproval(orgId, id);
    if (!existing) throw new Error("Approval not found");
    const updated = { ...existing, ...updates };

    await this.query(
      `UPDATE approvals SET status = $1, reviewed_by = $2, review_note = $3, reviewed_at = $4 WHERE id = $5`,
      [updated.status, updated.reviewedBy, updated.reviewNote, updated.reviewedAt, id]
    );
    return updated;
  }

  async listApprovals(orgId: string, status?: string, limit?: number, offset?: number): Promise<Approval[]> {
    let sql = `SELECT a.* FROM approvals a
               JOIN prompts p ON a.prompt_id = p.id
               WHERE p.organization_id = $1`;
    const params: any[] = [orgId];
    if (status) {
      params.push(status);
      sql += ` AND a.status = $2`;
    }
    sql += ` ORDER BY a.created_at DESC`;

    if (limit !== undefined) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }
    if (offset !== undefined) {
      params.push(offset);
      sql += ` OFFSET $${params.length}`;
    }

    const res = await this.query(sql, params);
    return res.rows.map((r: any) => ({
      id: r.id,
      promptId: r.prompt_id,
      promptName: r.prompt_name,
      promptVersionId: r.prompt_version_id,
      version: r.version,
      targetEnvironment: r.target_environment,
      requestedBy: r.requested_by,
      status: r.status,
      reviewedBy: r.reviewed_by,
      reviewNote: r.review_note,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      reviewedAt: r.reviewed_at ? (r.reviewed_at.toISOString ? r.reviewed_at.toISOString() : r.reviewed_at) : null
    }));
  }

  async createApiKey(apiKey: ApiKey): Promise<ApiKey> {
    await this.query(
      `INSERT INTO api_keys (id, organization_id, name, key_hash, key_prefix, scopes, expires_at, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        apiKey.id,
        apiKey.organizationId,
        apiKey.name,
        apiKey.keyHash,
        apiKey.keyPrefix,
        JSON.stringify(apiKey.scopes),
        apiKey.expiresAt,
        apiKey.createdAt,
        apiKey.lastUsedAt
      ]
    );
    return apiKey;
  }

  async findApiKeyByHash(hash: string): Promise<ApiKey | null> {
    const res = await this.query(`SELECT * FROM api_keys WHERE key_hash = $1`, [hash]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      keyHash: r.key_hash,
      keyPrefix: r.key_prefix,
      scopes: typeof r.scopes === "string" ? JSON.parse(r.scopes) : r.scopes,
      expiresAt: r.expires_at ? (r.expires_at.toISOString ? r.expires_at.toISOString() : r.expires_at) : null,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      lastUsedAt: r.last_used_at ? (r.last_used_at.toISOString ? r.last_used_at.toISOString() : r.last_used_at) : null
    };
  }

  async updateApiKeyLastUsed(id: string, lastUsedAt: string): Promise<void> {
    await this.query(`UPDATE api_keys SET last_used_at = $1 WHERE id = $2`, [lastUsedAt, id]);
  }

  async listApiKeys(orgId: string): Promise<ApiKey[]> {
    const res = await this.query(`SELECT * FROM api_keys WHERE organization_id = $1 ORDER BY created_at DESC`, [orgId]);
    return res.rows.map((r: any) => ({
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      keyHash: "[REDACTED]",
      keyPrefix: r.key_prefix,
      scopes: typeof r.scopes === "string" ? JSON.parse(r.scopes) : r.scopes,
      expiresAt: r.expires_at ? (r.expires_at.toISOString ? r.expires_at.toISOString() : r.expires_at) : null,
      createdAt: r.created_at.toISOString ? r.created_at.toISOString() : r.created_at,
      lastUsedAt: r.last_used_at ? (r.last_used_at.toISOString ? r.last_used_at.toISOString() : r.last_used_at) : null
    }));
  }

  async deleteApiKey(orgId: string, id: string): Promise<boolean> {
    const res = await this.query(`DELETE FROM api_keys WHERE organization_id = $1 AND id = $2`, [orgId, id]);
    return (res.rowCount || 0) > 0;
  }

  async createAuditLog(log: AuditLog): Promise<AuditLog> {
    await this.query(
      `INSERT INTO audit_logs (id, organization_id, actor, action, resource, environment, request_id, ip_address, user_agent, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        log.id,
        log.organizationId,
        JSON.stringify(log.actor),
        log.action,
        JSON.stringify(log.resource),
        log.environment,
        log.requestId,
        log.ipAddress,
        log.userAgent,
        JSON.stringify(log.metadata),
        log.timestamp
      ]
    );
    return log;
  }

  async listAuditLogs(orgId: string, limit: number = 50, offset: number = 0): Promise<AuditLog[]> {
    const res = await this.query(
      `SELECT * FROM audit_logs WHERE organization_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      organizationId: r.organization_id,
      actor: typeof r.actor === "string" ? JSON.parse(r.actor) : r.actor,
      action: r.action,
      resource: typeof r.resource === "string" ? JSON.parse(r.resource) : r.resource,
      environment: r.environment,
      requestId: r.request_id,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {},
      timestamp: r.timestamp.toISOString ? r.timestamp.toISOString() : r.timestamp
    }));
  }

  async recordUsageEvent(event: UsageEvent): Promise<void> {
    await this.query(
      `INSERT INTO usage_events (id, organization_id, prompt_name, prompt_version, environment, latency_ms, prompt_tokens, completion_tokens, total_tokens, estimated_cost, success, error_code, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        event.id,
        event.organizationId,
        event.promptName,
        event.promptVersion,
        event.environment,
        event.latencyMs,
        event.promptTokens,
        event.completionTokens,
        event.totalTokens,
        event.estimatedCost,
        event.success,
        event.errorCode,
        event.timestamp
      ]
    );
  }

  async getUsageOverview(orgId: string): Promise<{
    totalRequests: number;
    totalTokens: number;
    avgLatencyMs: number;
    recentEvents: UsageEvent[];
  }> {
    const totalRes = await this.query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(AVG(latency_ms), 0) as avg_latency
       FROM usage_events WHERE organization_id = $1`,
      [orgId]
    );
    const recentRes = await this.query(
      `SELECT * FROM usage_events WHERE organization_id = $1 ORDER BY timestamp DESC LIMIT 20`,
      [orgId]
    );

    const row = totalRes.rows[0] || {};
    return {
      totalRequests: parseInt(row.cnt || "0", 10),
      totalTokens: parseInt(row.tokens || "0", 10),
      avgLatencyMs: Math.round(parseFloat(row.avg_latency || "0")),
      recentEvents: recentRes.rows.map((r: any) => ({
        id: r.id,
        organizationId: r.organization_id,
        promptName: r.prompt_name,
        promptVersion: r.prompt_version,
        environment: r.environment,
        latencyMs: parseFloat(r.latency_ms),
        promptTokens: r.prompt_tokens,
        completionTokens: r.completion_tokens,
        totalTokens: r.total_tokens,
        estimatedCost: r.estimated_cost ? parseFloat(r.estimated_cost) : undefined,
        success: r.success,
        errorCode: r.error_code,
        timestamp: r.timestamp.toISOString ? r.timestamp.toISOString() : r.timestamp
      }))
    };
  }
}
