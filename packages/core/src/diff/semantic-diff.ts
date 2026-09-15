import { PromptVersion, VariableDefinition } from "../types/models.js";

export type ChangeType = "PATCH" | "MINOR" | "MAJOR";

export interface SemanticChange {
  category:
    | "system_instruction"
    | "user_instruction"
    | "variable_added"
    | "variable_removed"
    | "variable_modified"
    | "output_schema"
    | "model_preferences"
    | "template_content";
  isBreaking: boolean;
  summary: string;
  details?: {
    before?: any;
    after?: any;
  };
}

export interface PromptDiffResult {
  fromVersion: string;
  toVersion: string;
  recommendedBump: ChangeType;
  isBreaking: boolean;
  breakingChanges: string[];
  changes: SemanticChange[];
  textDiff?: {
    before: string;
    after: string;
  };
}

/**
 * Normalizes template to string for comparison
 */
function stringifyTemplate(template: any): string {
  if (typeof template === "string") return template;
  if (Array.isArray(template)) {
    return template
      .map(m => `[${m.role.toUpperCase()}]: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n\n");
  }
  return JSON.stringify(template);
}

/**
 * Extracts system prompt text if present
 */
function extractSystemPrompt(template: any): string | null {
  if (Array.isArray(template)) {
    const sys = template.find(m => m.role === "system");
    if (sys) {
      return typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content);
    }
  }
  return null;
}

/**
 * Computes semantic differences between two PromptVersions
 */
export function computePromptDiff(
  vFrom: PromptVersion,
  vTo: PromptVersion
): PromptDiffResult {
  const changes: SemanticChange[] = [];
  const breakingChanges: string[] = [];

  // 1. Compare Variables
  const fromVars: Record<string, VariableDefinition> = vFrom.variables || {};
  const toVars: Record<string, VariableDefinition> = vTo.variables || {};

  const allVarKeys = new Set([...Object.keys(fromVars), ...Object.keys(toVars)]);

  for (const key of allVarKeys) {
    const fromDef = fromVars[key];
    const toDef = toVars[key];

    if (!fromDef && toDef) {
      // Variable was added
      const isBreaking = toDef.required && toDef.default === undefined;
      const summary = `Added ${toDef.required ? "required" : "optional"} variable: '${key}' (type: ${toDef.type})`;
      changes.push({
        category: "variable_added",
        isBreaking,
        summary,
        details: { after: toDef }
      });
      if (isBreaking) {
        breakingChanges.push(`Added required variable without default: '${key}'`);
      }
    } else if (fromDef && !toDef) {
      // Variable was removed
      const isBreaking = true; // Breaking for callers expecting it
      const summary = `Removed variable: '${key}'`;
      changes.push({
        category: "variable_removed",
        isBreaking,
        summary,
        details: { before: fromDef }
      });
      breakingChanges.push(`Removed variable: '${key}'`);
    } else if (fromDef && toDef) {
      // Variable was modified
      const typeChanged = fromDef.type !== toDef.type;
      const requiredChanged = fromDef.required !== toDef.required;

      if (typeChanged || requiredChanged) {
        const isBreaking = typeChanged || (!fromDef.required && toDef.required && toDef.default === undefined);
        const summary = `Modified variable '${key}': ${
          typeChanged ? `type ${fromDef.type} → ${toDef.type}` : ""
        } ${requiredChanged ? `required ${fromDef.required} → ${toDef.required}` : ""}`.trim();

        changes.push({
          category: "variable_modified",
          isBreaking,
          summary,
          details: { before: fromDef, after: toDef }
        });

        if (isBreaking) {
          breakingChanges.push(`Modified variable '${key}': broke type or requirement compatibility`);
        }
      }
    }
  }

  // 2. Compare Output Schema
  const fromSchema = vFrom.outputSchema;
  const toSchema = vTo.outputSchema;

  if (!fromSchema && toSchema) {
    changes.push({
      category: "output_schema",
      isBreaking: true,
      summary: `Introduced strict output schema '${toSchema.name || "unnamed"}'`,
      details: { after: toSchema }
    });
    breakingChanges.push(`Added required JSON output schema constraint`);
  } else if (fromSchema && !toSchema) {
    changes.push({
      category: "output_schema",
      isBreaking: true,
      summary: `Removed structured output schema constraint`,
      details: { before: fromSchema }
    });
    breakingChanges.push(`Removed structured output schema constraint`);
  } else if (fromSchema && toSchema) {
    const fromStr = JSON.stringify(fromSchema.schema);
    const toStr = JSON.stringify(toSchema.schema);
    if (fromStr !== toStr) {
      changes.push({
        category: "output_schema",
        isBreaking: true,
        summary: `Changed output schema structure`,
        details: { before: fromSchema, after: toSchema }
      });
      breakingChanges.push(`Changed output JSON schema specification`);
    }
  }

  // 3. Compare System Instruction
  const sysFrom = extractSystemPrompt(vFrom.template);
  const sysTo = extractSystemPrompt(vTo.template);

  if (sysFrom !== null || sysTo !== null) {
    if (sysFrom !== sysTo) {
      // Detect if safety instructions or core guidelines were altered
      const safetyKeywords = ["harmful", "illegal", "security", "never", "confidential", "forbidden"];
      const touchesSafety = safetyKeywords.some(
        k => (sysFrom?.toLowerCase().includes(k) || false) !== (sysTo?.toLowerCase().includes(k) || false)
      );

      changes.push({
        category: "system_instruction",
        isBreaking: touchesSafety,
        summary: touchesSafety
          ? `Changed system instruction (altered safety constraints)`
          : `Changed system prompt instruction`,
        details: { before: sysFrom, after: sysTo }
      });

      if (touchesSafety) {
        breakingChanges.push(`Altered safety constraints in system instruction`);
      }
    }
  }

  // 4. Compare Full Template Content
  const strFrom = stringifyTemplate(vFrom.template);
  const strTo = stringifyTemplate(vTo.template);

  if (strFrom !== strTo && changes.every(c => c.category !== "system_instruction")) {
    changes.push({
      category: "template_content",
      isBreaking: false,
      summary: `Modified template wording or structure`,
      details: { before: strFrom, after: strTo }
    });
  }

  // 5. Compare Model Preferences
  const prefFrom = vFrom.modelPreferences;
  const prefTo = vTo.modelPreferences;
  if (JSON.stringify(prefFrom || {}) !== JSON.stringify(prefTo || {})) {
    const isBreaking = prefFrom?.name !== prefTo?.name && !!prefTo?.name;
    changes.push({
      category: "model_preferences",
      isBreaking,
      summary: `Updated model preferences: ${prefFrom?.provider || "any"}/${prefFrom?.name || "any"} → ${prefTo?.provider || "any"}/${prefTo?.name || "any"}`,
      details: { before: prefFrom, after: prefTo }
    });
  }

  // Determine recommended SemVer bump
  let recommendedBump: ChangeType = "PATCH";
  const hasBreaking = breakingChanges.length > 0 || changes.some(c => c.isBreaking);

  if (hasBreaking) {
    recommendedBump = "MAJOR";
  } else if (changes.some(c => c.category === "variable_added" || c.category === "system_instruction")) {
    recommendedBump = "MINOR";
  } else if (changes.length > 0) {
    recommendedBump = "PATCH";
  }

  return {
    fromVersion: vFrom.version,
    toVersion: vTo.version,
    recommendedBump,
    isBreaking: hasBreaking,
    breakingChanges,
    changes,
    textDiff: {
      before: strFrom,
      after: strTo
    }
  };
}
