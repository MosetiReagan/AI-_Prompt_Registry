import { ChatMessage, VariableDefinition, VariableType } from "../types/models.js";

export interface RenderResult {
  rendered: string | ChatMessage[];
  variablesUsed: Record<string, any>;
}

export class TemplateRenderError extends Error {
  public readonly code: string;
  public readonly missingVariables?: string[];
  public readonly invalidVariables?: Array<{ name: string; message: string }>;

  constructor(
    message: string,
    code: string,
    details?: {
      missingVariables?: string[];
      invalidVariables?: Array<{ name: string; message: string }>;
    }
  ) {
    super(message);
    this.name = "TemplateRenderError";
    this.code = code;
    this.missingVariables = details?.missingVariables;
    this.invalidVariables = details?.invalidVariables;
  }
}

/**
 * Extracts all unique {{variable}} names found in template string or chat messages.
 * Supports dot-notation paths like {{user.name}}.
 */
export function extractVariables(template: string | ChatMessage[]): string[] {
  const vars = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

  if (typeof template === "string") {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(template)) !== null) {
      vars.add(match[1]);
    }
  } else if (Array.isArray(template)) {
    for (const msg of template) {
      if (typeof msg.content === "string") {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(msg.content)) !== null) {
          vars.add(match[1]);
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            let match: RegExpExecArray | null;
            while ((match = regex.exec(part.text)) !== null) {
              vars.add(match[1]);
            }
          }
        }
      }
    }
  }

  return Array.from(vars);
}

/**
 * Resolves a nested property path from an object without using eval.
 * Example: resolvePath({ user: { name: "Alice" } }, "user.name") => "Alice"
 */
function resolvePath(obj: any, path: string): any {
  if (obj == null) return undefined;
  if (path in obj) return obj[path];

  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Validates input values against the variable definitions.
 */
export function validateVariables(
  definitions: Record<string, VariableDefinition>,
  inputs: Record<string, any>,
  options: { strict?: boolean } = {}
): { valid: boolean; errors: Array<{ name: string; message: string }> } {
  const errors: Array<{ name: string; message: string }> = [];

  // Check required variables and type checking
  for (const [name, def] of Object.entries(definitions)) {
    const value = resolvePath(inputs, name);

    if (value === undefined || value === null) {
      if (def.required && def.default === undefined) {
        errors.push({ name, message: `Missing required variable '${name}'` });
      }
      continue;
    }

    // Type validation
    if (!checkType(value, def.type)) {
      errors.push({
        name,
        message: `Variable '${name}' must be of type '${def.type}', received '${typeof value}'`
      });
      continue;
    }

    // Enum validation
    if (def.enum && def.enum.length > 0) {
      if (!def.enum.includes(String(value))) {
        errors.push({
          name,
          message: `Variable '${name}' must be one of [${def.enum.join(", ")}], received '${value}'`
        });
      }
    }

    // Regex validation
    if (def.regex) {
      try {
        const re = new RegExp(def.regex);
        if (!re.test(String(value))) {
          errors.push({
            name,
            message: `Variable '${name}' failed pattern validation '${def.regex}'`
          });
        }
      } catch {
        // Invalid regex in definition
      }
    }
  }

  // Strict mode: check for undeclared variables
  if (options.strict) {
    for (const key of Object.keys(inputs)) {
      if (!definitions[key] && !key.includes(".")) {
        errors.push({
          name: key,
          message: `Unknown variable '${key}' is not defined in prompt variable schema`
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function checkType(value: any, expectedType: VariableType): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "json":
      return typeof value === "object" && value !== null;
    default:
      return true;
  }
}

/**
 * Safely interpolates variables into a text string without eval.
 */
function interpolateString(
  text: string,
  variables: Record<string, any>,
  definitions: Record<string, VariableDefinition>
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, varName) => {
    let val = resolvePath(variables, varName);

    if (val === undefined && definitions[varName]?.default !== undefined) {
      val = definitions[varName].default;
    }

    if (val === undefined || val === null) {
      throw new TemplateRenderError(
        `Variable '${varName}' is unresolved and has no default value.`,
        "UNRESOLVED_VARIABLE",
        { missingVariables: [varName] }
      );
    }

    if (typeof val === "object") {
      return JSON.stringify(val, null, 2);
    }

    return String(val);
  });
}

/**
 * Safely renders a prompt template (string or ChatMessage[]) with input variables.
 */
export function renderPrompt(
  template: string | ChatMessage[],
  variables: Record<string, any>,
  definitions: Record<string, VariableDefinition> = {},
  options: { strict?: boolean } = {}
): RenderResult {
  // Validate variables
  const validation = validateVariables(definitions, variables, options);
  if (!validation.valid) {
    throw new TemplateRenderError(
      `Variable validation failed: ${validation.errors.map(e => e.message).join("; ")}`,
      "VARIABLE_VALIDATION_ERROR",
      { invalidVariables: validation.errors }
    );
  }

  // Populate defaults into variablesUsed
  const mergedVars: Record<string, any> = { ...variables };
  for (const [name, def] of Object.entries(definitions)) {
    if (mergedVars[name] === undefined && def.default !== undefined) {
      mergedVars[name] = def.default;
    }
  }

  if (typeof template === "string") {
    const rendered = interpolateString(template, mergedVars, definitions);
    return { rendered, variablesUsed: mergedVars };
  }

  if (Array.isArray(template)) {
    const renderedMessages: ChatMessage[] = template.map(msg => {
      if (typeof msg.content === "string") {
        return {
          ...msg,
          content: interpolateString(msg.content, mergedVars, definitions)
        };
      }
      if (Array.isArray(msg.content)) {
        const renderedParts = msg.content.map(part => {
          if (part.type === "text") {
            return {
              ...part,
              text: interpolateString(part.text, mergedVars, definitions)
            };
          }
          return part;
        });
        return {
          ...msg,
          content: renderedParts
        };
      }
      return msg;
    });

    return { rendered: renderedMessages, variablesUsed: mergedVars };
  }

  throw new TemplateRenderError("Invalid template format", "INVALID_TEMPLATE_FORMAT");
}
