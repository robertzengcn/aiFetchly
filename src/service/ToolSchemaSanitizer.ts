/**
 * ToolSchemaSanitizer — caps MCP tool descriptions and prunes oversized JSON
 * schemas before they enter the model prompt.
 *
 * Why: MCP servers (especially OpenAPI-generated ones) can return 30KB+
 * descriptions and huge schemas that bloat the tools payload. Truncating the
 * description is always safe; pruning only removes non-structural metadata
 * (examples, long defaults, titles, long nested descriptions, huge enums)
 * while preserving type/properties/required/items/enum/additionalProperties so
 * the model can still issue valid calls.
 *
 * Pure functions: never throw, never mutate input (immutability rule).
 */

import { TOOL_CATALOG_DEFAULTS } from "@/config/toolCatalogConfig";

export interface TruncateDescriptionResult {
  readonly value: string | undefined;
  readonly truncated: boolean;
}

/** Cap a description to `maxChars`, appending a visible truncation marker. */
export function truncateDescription(
  value: string | undefined,
  maxChars: number = TOOL_CATALOG_DEFAULTS.mcpDescriptionChars
): TruncateDescriptionResult {
  if (!value) return { value, truncated: false };
  if (value.length <= maxChars) return { value, truncated: false };
  return {
    value: `${value.slice(0, maxChars)}... [truncated]`,
    truncated: true,
  };
}

export interface SchemaSanitizeResult {
  readonly schema: Record<string, unknown>;
  readonly changed: boolean;
  readonly originalChars: number;
  readonly sanitizedChars: number;
  readonly actions: readonly string[];
}

/** Description length cap applied to nested schema descriptions during pruning. */
const NESTED_DESCRIPTION_MAX_CHARS = 1024;
/** Max enum values retained when capping a huge enum array. */
const ENUM_CAP = 50;

/**
 * Prune a JSON schema down to under `maxChars` by removing non-structural
 * metadata. Returns the (possibly unchanged) schema plus diagnostics. Never
 * throws; non-object input is returned unchanged.
 */
export function pruneJsonSchema(
  schema: Record<string, unknown>,
  maxChars: number = TOOL_CATALOG_DEFAULTS.schemaMaxChars
): SchemaSanitizeResult {
  const originalChars = safeJsonLength(schema);
  if (
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    originalChars <= maxChars
  ) {
    return {
      schema: schema as Record<string, unknown>,
      changed: false,
      originalChars,
      sanitizedChars: originalChars,
      actions: [],
    };
  }

  const clone = deepClone(schema);
  const actions: string[] = [];
  const measure = (): number => safeJsonLength(clone);

  if (removeFieldEverywhere(clone, "examples")) {
    actions.push("removed-examples");
    if (measure() <= maxChars) return finalize(clone, originalChars, actions);
  }

  if (removeLongDefaults(clone)) {
    actions.push("removed-long-defaults");
    if (measure() <= maxChars) return finalize(clone, originalChars, actions);
  }

  if (truncateDescriptions(clone, NESTED_DESCRIPTION_MAX_CHARS)) {
    actions.push("truncated-descriptions");
    if (measure() <= maxChars) return finalize(clone, originalChars, actions);
  }

  if (removeFieldEverywhere(clone, "title")) {
    actions.push("removed-titles");
    if (measure() <= maxChars) return finalize(clone, originalChars, actions);
  }

  if (capLongEnums(clone, ENUM_CAP)) {
    actions.push("capped-enums");
  }

  return finalize(clone, originalChars, actions);
}

// ---------------------------------------------------------------------------
// Internal recursive helpers (operate in place on a deep clone)
// ---------------------------------------------------------------------------

function finalize(
  schema: Record<string, unknown>,
  originalChars: number,
  actions: string[]
): SchemaSanitizeResult {
  const sanitizedChars = safeJsonLength(schema);
  return {
    schema,
    changed: actions.length > 0,
    originalChars,
    sanitizedChars,
    actions,
  };
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Remove every occurrence of `fieldName` anywhere in the schema tree.
 * Returns true if at least one field was removed.
 */
function removeFieldEverywhere(
  node: unknown,
  fieldName: string
): boolean {
  let changed = false;
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    const obj = cur as Record<string, unknown>;
    if (fieldName in obj) {
      delete obj[fieldName];
      changed = true;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return changed;
}

/** Remove `default` values that are long strings or large objects/arrays. */
function removeLongDefaults(node: unknown): boolean {
  let changed = false;
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    const obj = cur as Record<string, unknown>;
    if ("default" in obj) {
      const def = obj.default;
      const size =
        typeof def === "string"
          ? def.length
          : def && typeof def === "object"
          ? safeJsonLength(def)
          : 0;
      if (size > 64) {
        delete obj.default;
        changed = true;
      }
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return changed;
}

/** Truncate any `description` longer than `maxChars` anywhere in the tree. */
function truncateDescriptions(node: unknown, maxChars: number): boolean {
  let changed = false;
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    const obj = cur as Record<string, unknown>;
    if (
      typeof obj.description === "string" &&
      obj.description.length > maxChars
    ) {
      obj.description = `${obj.description.slice(0, maxChars)}... [truncated]`;
      changed = true;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return changed;
}

/** Cap huge `enum` arrays to the first `cap` values plus a note. */
function capLongEnums(node: unknown, cap: number): boolean {
  let changed = false;
  const stack: unknown[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    const obj = cur as Record<string, unknown>;
    if (Array.isArray(obj.enum) && obj.enum.length > cap) {
      obj.enum = (obj.enum as unknown[]).slice(0, cap);
      obj.description = appendNote(
        typeof obj.description === "string" ? obj.description : "",
        `[enum truncated to first ${cap} values]`
      );
      changed = true;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return changed;
}

function appendNote(existing: string, note: string): string {
  return existing ? `${existing} ${note}` : note;
}

/**
 * Sanitize an MCP tool's description + input schema for LLM exposure.
 * Convenience wrapper used by MCPToolService (defense in depth).
 */
export interface SanitizeMcpToolResult {
  readonly description: string | undefined;
  readonly schema: Record<string, unknown>;
  readonly descriptionTruncated: boolean;
  readonly schemaChanged: boolean;
}

export function sanitizeMcpToolMetadata(input: {
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly descriptionMaxChars?: number;
  readonly schemaMaxChars?: number;
}): SanitizeMcpToolResult {
  const desc = truncateDescription(
    input.description,
    input.descriptionMaxChars
  );
  const schemaIn =
    input.inputSchema && typeof input.inputSchema === "object"
      ? (input.inputSchema as Record<string, unknown>)
      : { type: "object", properties: {}, required: [] };
  const schema = pruneJsonSchema(schemaIn, input.schemaMaxChars);
  return {
    description: desc.value,
    schema: schema.schema,
    descriptionTruncated: desc.truncated,
    schemaChanged: schema.changed,
  };
}
