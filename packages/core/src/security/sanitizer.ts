export const SECRET_PATTERNS = [
  // OpenAI API Key
  /sk-[a-zA-Z0-9]{20,}/g,
  // Anthropic API Key
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  // AWS Access Key
  /AKIA[0-9A-Z]{16}/g,
  // GitHub Token
  /ghp_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{40,}/g,
  // Generic Bearer or Private Key headers
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
  // Generic password or api_key assignment
  /(?:api[_-]?key|secret|password|auth[_-]?token)\s*[:=]\s*["']?([a-zA-Z0-9_\-.~+]{12,})["']?/gi
];

/**
 * Scans text to find leaked secrets
 */
export function findSecrets(text: string): string[] {
  const found: string[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return Array.from(new Set(found));
}

/**
 * Redacts any detected secrets with [REDACTED_SECRET]
 */
export function redactSecrets(text: string): string {
  let cleaned = text;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED_SECRET]");
  }
  return cleaned;
}

/**
 * Recursively redacts secrets in an object or array
 */
export function redactObject<T>(val: T): T {
  if (val == null) return val;
  if (typeof val === "string") {
    return redactSecrets(val) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map(item => redactObject(item)) as unknown as T;
  }
  if (typeof val === "object") {
    const res: any = {};
    for (const [k, v] of Object.entries(val)) {
      // Sensitive field names are redacted entirely
      if (/^(password|secret|apiKey|api_key|token|authorization)$/i.test(k)) {
        res[k] = "[REDACTED_FIELD]";
      } else {
        res[k] = redactObject(v);
      }
    }
    return res;
  }
  return val;
}

/**
 * Security analysis for prompt templates and variables
 */
export interface SecurityAuditResult {
  hasSecrets: boolean;
  detectedSecrets: string[];
  injectionRisks: string[];
  passed: boolean;
}

export function auditPromptSecurity(content: string): SecurityAuditResult {
  const secrets = findSecrets(content);
  const injectionRisks: string[] = [];

  const suspiciousPatterns = [
    { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, risk: "Instruction override attempt" },
    { pattern: /disregard\s+(all\s+)?prior\s+guidelines/i, risk: "Guideline bypass attempt" },
    { pattern: /reveal\s+(your\s+)?system\s+prompt/i, risk: "System prompt leakage attempt" },
    { pattern: /you\s+are\s+now\s+in\s+developer\s+mode/i, risk: "Jailbreak mode attempt" }
  ];

  for (const { pattern, risk } of suspiciousPatterns) {
    if (pattern.test(content)) {
      injectionRisks.push(risk);
    }
  }

  return {
    hasSecrets: secrets.length > 0,
    detectedSecrets: secrets,
    injectionRisks,
    passed: secrets.length === 0
  };
}
