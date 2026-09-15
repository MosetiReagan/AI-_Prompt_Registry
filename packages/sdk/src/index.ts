import {
  Prompt,
  PromptVersion,
  Deployment,
  RenderResult,
  renderPrompt,
  PromptDiffResult,
  Evaluation,
  RegressionReport,
  UsageEvent
} from "@ai-prompt-registry/core";

export interface RegistryClientOptions {
  baseUrl?: string;
  apiKey?: string;
  cacheTtlMs?: number; // Default 30,000ms for environment/alias resolutions
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number; // Default 10,000ms
  maxRetries?: number; // Default 3
  retryInitialDelayMs?: number; // Default 100ms
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class PromptRegistryError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PromptRegistryError";
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export class PromptRegistry {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly cacheTtlMs: number;
  private readonly customHeaders: Record<string, string>;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryInitialDelayMs: number;

  // In-memory cache: key -> { data, expiresAt }
  private readonly cache = new Map<string, CacheEntry<any>>();

  constructor(options: RegistryClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.customHeaders = options.headers || {};
    this.fetchFn = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryInitialDelayMs = options.retryInitialDelayMs ?? 100;
  }

  /**
   * Helper to perform HTTP requests with timeout and exponential backoff retry
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.customHeaders,
      ...((options.headers as Record<string, string>) || {})
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let lastError: any = null;
    const maxRetries = this.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let signal = options.signal;
      let timeoutSignal: AbortSignal | undefined;

      try {
        if (typeof AbortSignal.timeout === "function") {
          timeoutSignal = AbortSignal.timeout(this.timeoutMs);
          if (signal) {
            if (typeof (AbortSignal as any).any === "function") {
              signal = (AbortSignal as any).any([signal, timeoutSignal]);
            }
          } else {
            signal = timeoutSignal;
          }
        }
      } catch {}

      try {
        const response = await this.fetchFn(url, {
          ...options,
          headers,
          signal
        });

        if (!response.ok) {
          let errBody: any;
          try {
            errBody = await response.json();
          } catch {
            errBody = { message: response.statusText };
          }

          const error = new PromptRegistryError(
            errBody.message || `API request failed with status ${response.status}`,
            response.status,
            errBody.code
          );

          // Retry on 5xx server errors
          if (response.status >= 500 && attempt < maxRetries) {
            lastError = error;
            const backoffMs = this.retryInitialDelayMs * Math.pow(2, attempt);
            await sleep(backoffMs);
            continue;
          }

          throw error;
        }

        return (await response.json()) as T;
      } catch (err: any) {
        if (err instanceof PromptRegistryError) {
          throw err;
        }

        // Network error, timeout, or connection failure
        lastError = err;
        if (attempt < maxRetries) {
          const backoffMs = this.retryInitialDelayMs * Math.pow(2, attempt);
          await sleep(backoffMs);
          continue;
        }
        throw new PromptRegistryError(
          err.message || "Network request failed",
          0,
          err.name === "TimeoutError" ? "REQUEST_TIMEOUT" : "NETWORK_ERROR"
        );
      }
    }

    throw lastError || new PromptRegistryError("Request failed after retries", 0);
  }

  /**
   * Clears the in-memory cache
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Retrieves prompt by name and environment (e.g. 'production') or exact version (e.g. '1.0.0')
   */
  public async get(
    promptName: string,
    environmentOrVersion: string = "production"
  ): Promise<{
    prompt: Prompt;
    version: PromptVersion;
    resolvedVersion: string;
    environment?: string;
  }> {
    const isExactSemVer = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(environmentOrVersion);
    const cacheKey = `prompt:${promptName}:${environmentOrVersion}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const endpoint = `/v1/prompts/${encodeURIComponent(promptName)}/resolve?target=${encodeURIComponent(environmentOrVersion)}`;
    const result = await this.request<{
      prompt: Prompt;
      version: PromptVersion;
      resolvedVersion: string;
      environment?: string;
    }>(endpoint);

    // Exact semver versions are immutable, so cache them indefinitely; environments cache with TTL
    const ttl = isExactSemVer ? 24 * 60 * 60 * 1000 : this.cacheTtlMs;
    this.cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + ttl
    });

    return result;
  }

  /**
   * Resolves and renders a prompt with variable substitution in one call
   */
  public async render(
    promptName: string,
    variables: Record<string, any>,
    options: {
      environmentOrVersion?: string;
      strict?: boolean;
    } = {}
  ): Promise<RenderResult & { version: string; modelPreferences?: any }> {
    const target = options.environmentOrVersion || "production";
    const resolved = await this.get(promptName, target);

    const rendered = renderPrompt(
      resolved.version.template,
      variables,
      resolved.version.variables,
      { strict: options.strict }
    );

    return {
      ...rendered,
      version: resolved.version.version,
      modelPreferences: resolved.version.modelPreferences
    };
  }

  /**
   * Lists all prompts with optional query
   */
  public async listPrompts(query?: { search?: string; tag?: string; status?: string }): Promise<Prompt[]> {
    const params = new URLSearchParams();
    if (query?.search) params.set("search", query.search);
    if (query?.tag) params.set("tag", query.tag);
    if (query?.status) params.set("status", query.status);

    const queryString = params.toString();
    const endpoint = `/v1/prompts${queryString ? `?${queryString}` : ""}`;
    return this.request<Prompt[]>(endpoint);
  }

  /**
   * Fetches single prompt resource
   */
  public async getPrompt(promptName: string): Promise<Prompt> {
    return this.request<Prompt>(`/v1/prompts/${encodeURIComponent(promptName)}`);
  }

  /**
   * Lists all immutable versions for a prompt
   */
  public async listVersions(promptName: string): Promise<PromptVersion[]> {
    return this.request<PromptVersion[]>(`/v1/prompts/${encodeURIComponent(promptName)}/versions`);
  }

  /**
   * Fetches specific immutable version
   */
  public async getVersion(promptName: string, version: string): Promise<PromptVersion> {
    return this.request<PromptVersion>(
      `/v1/prompts/${encodeURIComponent(promptName)}/versions/${encodeURIComponent(version)}`
    );
  }

  /**
   * Creates a new prompt resource
   */
  public async createPrompt(data: {
    name: string;
    description?: string;
    type?: "text" | "chat";
    tags?: string[];
    owner?: string;
    team?: string;
  }): Promise<Prompt> {
    return this.request<Prompt>("/v1/prompts", {
      method: "POST",
      body: JSON.stringify(data)
    });
  }

  /**
   * Publishes an immutable prompt version
   */
  public async publishVersion(
    promptName: string,
    data: {
      version: string;
      template: any;
      variables?: any;
      outputSchema?: any;
      modelPreferences?: any;
      changelog?: string;
      author?: string;
    }
  ): Promise<PromptVersion> {
    const res = await this.request<PromptVersion>(
      `/v1/prompts/${encodeURIComponent(promptName)}/versions`,
      {
        method: "POST",
        body: JSON.stringify(data)
      }
    );
    this.clearCache();
    return res;
  }

  /**
   * Promotes a version to an environment (e.g. staging -> production)
   */
  public async promote(
    promptName: string,
    version: string,
    environment: string,
    notes?: string
  ): Promise<Deployment> {
    const res = await this.request<Deployment>(
      `/v1/prompts/${encodeURIComponent(promptName)}/promote`,
      {
        method: "POST",
        body: JSON.stringify({ version, environment, notes })
      }
    );
    this.clearCache();
    return res;
  }

  /**
   * Rolls back an environment to a previous deployment
   */
  public async rollback(
    promptName: string,
    environment: string,
    targetVersion?: string
  ): Promise<Deployment> {
    const res = await this.request<Deployment>(
      `/v1/prompts/${encodeURIComponent(promptName)}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({ environment, targetVersion })
      }
    );
    this.clearCache();
    return res;
  }

  /**
   * Computes semantic prompt diff between two versions
   */
  public async diff(
    promptName: string,
    fromVersion: string,
    toVersion: string
  ): Promise<PromptDiffResult> {
    return this.request<PromptDiffResult>(
      `/v1/prompts/${encodeURIComponent(promptName)}/diff?from=${encodeURIComponent(fromVersion)}&to=${encodeURIComponent(toVersion)}`
    );
  }

  /**
   * Adds a test case with assertions to a prompt
   */
  public async createTestCase(
    promptName: string,
    testCase: {
      name: string;
      description?: string;
      inputs: Record<string, any>;
      expectedProperties?: {
        exactMatch?: string;
        contains?: string[];
        regex?: string;
        jsonSchema?: any;
      };
      tags?: string[];
    }
  ): Promise<any> {
    return this.request<any>(
      `/v1/prompts/${encodeURIComponent(promptName)}/test-cases`,
      {
        method: "POST",
        body: JSON.stringify(testCase)
      }
    );
  }

  /**
   * Runs evaluation suite on a prompt version
   */
  public async evaluate(
    promptName: string,
    version: string,
    options: { testCaseIds?: string[] } = {}
  ): Promise<Evaluation> {
    return this.request<Evaluation>(
      `/v1/prompts/${encodeURIComponent(promptName)}/evaluate`,
      {
        method: "POST",
        body: JSON.stringify({ version, ...options })
      }
    );
  }

  /**
   * Runs regression testing comparing baseline and candidate versions
   */
  public async regression(
    promptName: string,
    baselineVersion: string,
    candidateVersion: string
  ): Promise<RegressionReport> {
    return this.request<RegressionReport>(
      `/v1/prompts/${encodeURIComponent(promptName)}/regression`,
      {
        method: "POST",
        body: JSON.stringify({ baselineVersion, candidateVersion })
      }
    );
  }

  /**
   * Records execution telemetry metadata (tokens, latency, cost)
   */
  public async recordUsage(
    event: Omit<UsageEvent, "id" | "timestamp">
  ): Promise<void> {
    await this.request<{ success: boolean }>("/v1/analytics/usage", {
      method: "POST",
      body: JSON.stringify(event)
    });
  }

  /**
   * Standard telemetry headers for downstream AI providers and AI Cost tracking
   */
  public getTelemetryHeaders(
    promptName: string,
    version: string,
    environment: string = "production"
  ): Record<string, string> {
    return {
      "x-prompt-name": promptName,
      "x-prompt-version": version,
      "x-prompt-environment": environment,
      "x-registry-client": "ai-prompt-registry-sdk"
    };
  }
}
