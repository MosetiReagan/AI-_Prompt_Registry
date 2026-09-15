-- AI Prompt Registry PostgreSQL Database Schema
-- Production Relational Schema with Indexes and Foreign Key Constraints

CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prompts (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id VARCHAR(64) NOT NULL DEFAULT 'default',
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    type VARCHAR(32) NOT NULL DEFAULT 'chat',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    tags JSONB DEFAULT '[]'::jsonb,
    owner VARCHAR(255),
    team VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_prompts_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_prompts_org ON prompts(organization_id);
CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name);
CREATE INDEX IF NOT EXISTS idx_prompts_tags ON prompts USING gin(tags);

CREATE TABLE IF NOT EXISTS prompt_versions (
    id VARCHAR(64) PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    version VARCHAR(64) NOT NULL,
    lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'draft',
    template JSONB NOT NULL,
    variables JSONB DEFAULT '{}'::jsonb,
    output_schema JSONB,
    model_preferences JSONB,
    author VARCHAR(255),
    changelog TEXT DEFAULT '',
    checksum VARCHAR(64) NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT uq_versions_prompt_version UNIQUE (prompt_id, version)
);

CREATE INDEX IF NOT EXISTS idx_versions_prompt ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_versions_version ON prompt_versions(version);

CREATE TABLE IF NOT EXISTS environments (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    description TEXT DEFAULT '',
    is_protected BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_env_org_name UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS deployments (
    id VARCHAR(64) PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    prompt_name VARCHAR(255) NOT NULL,
    environment_name VARCHAR(64) NOT NULL,
    version VARCHAR(64) NOT NULL,
    prompt_version_id VARCHAR(64) NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
    deployed_by VARCHAR(255) DEFAULT 'system',
    deployed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    rollback_from_deployment_id VARCHAR(64),
    status VARCHAR(32) DEFAULT 'active',
    notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_deployments_prompt ON deployments(prompt_id, environment_name);

CREATE TABLE IF NOT EXISTS aliases (
    id VARCHAR(64) PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    version VARCHAR(64) NOT NULL,
    prompt_version_id VARCHAR(64) NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) DEFAULT 'system',
    CONSTRAINT uq_alias_prompt_name UNIQUE (prompt_id, name)
);

CREATE TABLE IF NOT EXISTS test_cases (
    id VARCHAR(64) PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    expected_output TEXT,
    expected_properties JSONB DEFAULT '{}'::jsonb,
    tags JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_test_cases_prompt ON test_cases(prompt_id);

CREATE TABLE IF NOT EXISTS evaluations (
    id VARCHAR(64) PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    prompt_version_id VARCHAR(64) NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
    version VARCHAR(64) NOT NULL,
    type VARCHAR(32) DEFAULT 'deterministic',
    score NUMERIC(5, 4) NOT NULL,
    passed BOOLEAN NOT NULL,
    total_tests INT NOT NULL DEFAULT 0,
    passed_tests INT NOT NULL DEFAULT 0,
    test_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluator_config JSONB DEFAULT '{}'::jsonb,
    is_ai_generated BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_eval_prompt_version ON evaluations(prompt_id, version);

CREATE TABLE IF NOT EXISTS policies (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    rules JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) DEFAULT 'system',
    CONSTRAINT uq_policy_org UNIQUE (organization_id)
);

CREATE TABLE IF NOT EXISTS approvals (
    id VARCHAR(64) PRIMARY KEY,
    prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    prompt_name VARCHAR(255) NOT NULL,
    prompt_version_id VARCHAR(64) NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
    version VARCHAR(64) NOT NULL,
    target_environment VARCHAR(64) NOT NULL,
    requested_by VARCHAR(255) NOT NULL,
    status VARCHAR(32) DEFAULT 'pending',
    reviewed_by VARCHAR(255),
    review_note TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS api_keys (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(16) NOT NULL,
    scopes JSONB NOT NULL DEFAULT '["read", "execute"]'::jsonb,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor JSONB NOT NULL,
    action VARCHAR(128) NOT NULL,
    resource JSONB NOT NULL,
    environment VARCHAR(64),
    request_id VARCHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_logs(organization_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS usage_events (
    id VARCHAR(64) PRIMARY KEY,
    organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    prompt_name VARCHAR(255) NOT NULL,
    prompt_version VARCHAR(64) NOT NULL,
    environment VARCHAR(64) NOT NULL,
    latency_ms NUMERIC(10, 2) NOT NULL,
    prompt_tokens INT,
    completion_tokens INT,
    total_tokens INT,
    estimated_cost NUMERIC(10, 6),
    success BOOLEAN NOT NULL,
    error_code VARCHAR(64),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_prompt ON usage_events(prompt_name, prompt_version);
