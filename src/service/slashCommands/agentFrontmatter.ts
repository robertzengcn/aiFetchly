// src/service/slashCommands/agentFrontmatter.ts
// AGT-02 / DX-01 (Phase 16) — single owner of the agent frontmatter schema.
//
// This validator consumes ALREADY-PARSED frontmatter (the
// Record<string, string | readonly string[]> shape produced by the Phase 13-01
// restricted frontmatter parser / Phase 14 WorkspaceAgentDraft) and either:
//   - returns {ok:true, definition: AgentDefinitionView} with system defaults
//     applied, or
//   - returns {ok:false, diagnostic} describing the FIRST violated check.
//
// Plan 02 reuses buildAgentDefinition from BOTH the global (~/.aifetchly) loader
// AND the workspace conversion path so the AGT-02 schema is encoded exactly
// once. Inputs are NEVER mutated; outputs are defensive copies.
//
// detectUnknownTools is a SEPARATE pure helper that emits non-fatal
// agent-tool-invalid (DX-01) warnings. It is intentionally kept OUT of the
// validator so the validator stays single-purpose and the loader owns emitting
// the warnings (D-ToolDiagnostic / RESEARCH Pattern 2 recommendation). A valid
// definition with unknown tools is still registrable — the warning is purely
// author-facing early feedback (the runtime intersection in
// AgentToolPolicyService still runs at dispatch).
//
// Pure module: imports only types + AIFetchlyConfigConstants. NO fs / Electron
// / TypeORM / Vue / other-service imports (verified by grep gate). Never
// throws — malformed drafts return {ok:false, diagnostic}.

import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSourceKind,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import {
  AIFETCHLY_CONFIG_LIMITS,
  COMMAND_NAME_REGEX,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";

/**
 * A parsed frontmatter value: scalar string or a readonly string array
 * (e.g. tools). Mirrors the {@link WorkspaceAgentDraft.frontmatter} shape
 * produced by the restricted frontmatter parser.
 */
export type AgentFrontmatterValue = string | readonly string[];

/**
 * Input draft — parsed frontmatter + body + relative path. The validator
 * does NOT re-parse bytes; it consumes already-parsed frontmatter records.
 *
 * `frontmatter` uses `Readonly<Record<...>>` to make the immutability
 * contract explicit; callers may pass a plain record. The validator never
 * mutates the input.
 */
export interface AgentDefinitionDraft {
  readonly frontmatter: Readonly<Record<string, AgentFrontmatterValue>>;
  readonly body: string;
  readonly relativePath: string;
}

/**
 * Source attribution applied to the produced {@link AgentDefinitionView}
 * (via its scoped id) and any diagnostic. Mirrors the global/workspace/plugin
 * source metadata carried by Phase 13-02 / Phase 14 snapshots.
 *
 * `source` is the narrower {@link AIFetchlyConfigSourceKind} union
 * (excludes "built-in") because dynamic agents never come from the built-in
 * source — built-ins are seeded directly into the registry.
 */
export interface AgentDefinitionSourceMeta {
  readonly source: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly requiresTrust: boolean;
}

/**
 * Discriminated result of {@link buildAgentDefinition}.
 */
export type AgentDefinitionBuildResult =
  | { readonly ok: true; readonly definition: AgentDefinitionView }
  | { readonly ok: false; readonly diagnostic: AIFetchlyConfigDiagnostic };

/** System default for maxToolCalls when not authored (mirrors the built-in). */
const DEFAULT_MAX_TOOL_CALLS = 8;
/** System default for maxRuntimeMs when not authored (mirrors the built-in). */
const DEFAULT_MAX_RUNTIME_MS = 180000;
/** System default for maxContinueCalls (mirrors the built-in). */
const DEFAULT_MAX_CONTINUE_CALLS = 8;

/**
 * Build an AGT-02-conformant {@link AgentDefinitionView} from a parsed
 * frontmatter draft, or return a diagnostic describing the first violated
 * constraint.
 *
 * Validation order (first violation wins):
 *   1. `name` present, string, and matches {@link COMMAND_NAME_REGEX}
 *      (else `agent-name-invalid`).
 *   2. `description` present and non-empty (else `frontmatter-missing`).
 *   3. `description` length <= commandDescriptionLength (else `frontmatter-invalid`).
 *   4. `tools` (optional, defaults to []) must be a string array with each
 *      entry a non-empty string (else `frontmatter-invalid`).
 *   5. `maxToolCalls` (optional) must parse as a positive integer
 *      (else `frontmatter-invalid`).
 *   6. `maxRuntimeMs` (optional) must parse as a positive integer
 *      (else `frontmatter-invalid`).
 *   7. `body` is non-empty after trim (else `frontmatter-invalid`).
 *
 * On success, the definition has:
 *   - `id` = `${sourceMeta.sourceId}:agent:${name}` (stable scoped ID —
 *     mirrors the `${sourceId}:command:${name}` convention from Phase 15).
 *   - `systemPrompt` = body
 *   - `allowedTools` = defensive `Array.from` copy (default [] when absent)
 *   - `mode` = "specialist" (dynamic agents are specialists)
 *   - `version` = 1, `status` = "active"
 *   - `maxToolCalls` = authored value or {@link DEFAULT_MAX_TOOL_CALLS}
 *   - `maxRuntimeMs` = authored value or {@link DEFAULT_MAX_RUNTIME_MS}
 *   - `maxContinueCalls` = {@link DEFAULT_MAX_CONTINUE_CALLS}
 *   - `outputSchema` = {} (structured authoring deferred — RESEARCH Pitfall 4;
 *     the field is ALWAYS present because AgentDefinitionView.outputSchema is
 *     required-typed)
 *
 * Never throws — malformed drafts (non-string scalars, wrong-type tools)
 * return `{ok:false, diagnostic}`.
 */
export function buildAgentDefinition(
  draft: AgentDefinitionDraft,
  sourceMeta: AgentDefinitionSourceMeta
): AgentDefinitionBuildResult {
  const fm = draft.frontmatter ?? {};
  const filePath = draft.relativePath ?? "";

  // Helper: build a diagnostic with the project's stable shape.
  const fail = (code: string, message: string): AgentDefinitionBuildResult => ({
    ok: false,
    diagnostic: {
      severity: "warning",
      source: sourceMeta.source,
      sourceId: sourceMeta.sourceId,
      filePath,
      code,
      message,
      recoverable: true,
    },
  });

  // Coerce a frontmatter value to a string defensively. Non-string scalars
  // (numbers, booleans, null) are treated as missing — the caller gets a
  // diagnostic rather than a thrown TypeError.
  const asString = (key: string): string | undefined => {
    const v = (fm as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  };

  // 1. name — required, must match the agent-name pattern (reuses the
  //    command-name regex: lowercase letter first, then letters/digits/
  //    hyphens/underscores).
  const name = asString("name");
  if (name === undefined || name.length === 0) {
    return fail("agent-name-invalid", "Agent frontmatter is missing a name.");
  }
  if (!COMMAND_NAME_REGEX.test(name)) {
    return fail(
      "agent-name-invalid",
      `Agent name '${name}' is invalid — must match ${COMMAND_NAME_REGEX} (lowercase letter first, then letters/digits/hyphens/underscores).`
    );
  }

  // 2. description — required, non-empty. Uses the frontmatter-missing code
  //    (no agent-description-missing code is reserved in
  //    AIFETCHLY_DIAGNOSTIC_CODES; frontmatter-missing is the closest
  //    missing-field-style code per the plan's behavior note).
  const description = asString("description");
  if (description === undefined || description.trim().length === 0) {
    return fail(
      "frontmatter-missing",
      `Agent '${name}' is missing a description.`
    );
  }

  // 3. description length cap (reuse the CMD-06 bound).
  if (description.length > AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength) {
    return fail(
      "frontmatter-invalid",
      `Agent '${name}' description is ${description.length} characters — exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength}-character cap.`
    );
  }

  // 4. tools — optional, default []; must be a string array with each entry
  //    a non-empty string. Mirrors the aliases handling in
  //    promptCommandFrontmatter.ts (lines 168-204).
  const toolsRaw = (fm as Record<string, unknown>).tools;
  let tools: readonly string[] = [];
  if (toolsRaw !== undefined) {
    if (!Array.isArray(toolsRaw)) {
      return fail(
        "frontmatter-invalid",
        `Agent '${name}' tools must be a YAML string array.`
      );
    }
    // Defensive copy with element-type check (parser guarantees strings, but
    // never trust unchecked input at a trust boundary).
    const coerced: string[] = [];
    for (const t of toolsRaw) {
      if (typeof t !== "string") {
        return fail(
          "frontmatter-invalid",
          `Agent '${name}' tools contains a non-string entry.`
        );
      }
      if (t.length === 0) {
        return fail(
          "frontmatter-invalid",
          `Agent '${name}' tools contains an empty-string entry.`
        );
      }
      coerced.push(t);
    }
    tools = coerced;
  }

  // 5. maxToolCalls — optional positive integer.
  const maxToolCalls = parsePositiveInt(
    asString("maxToolCalls"),
    name,
    "maxToolCalls",
    fail
  );
  if (typeof maxToolCalls === "object") return maxToolCalls;

  // 6. maxRuntimeMs — optional positive integer.
  const maxRuntimeMs = parsePositiveInt(
    asString("maxRuntimeMs"),
    name,
    "maxRuntimeMs",
    fail
  );
  if (typeof maxRuntimeMs === "object") return maxRuntimeMs;

  // 7. body — required, non-empty after trim.
  const body = typeof draft.body === "string" ? draft.body : "";
  if (body.trim().length === 0) {
    return fail(
      "frontmatter-invalid",
      `Agent '${name}' has an empty body — agents require a non-empty system prompt body.`
    );
  }

  const definition: AgentDefinitionView = {
    id: `${sourceMeta.sourceId}:agent:${name}`,
    name,
    description,
    version: 1,
    systemPrompt: body,
    allowedTools: Array.from(tools),
    mode: "specialist",
    maxToolCalls: typeof maxToolCalls === "number" ? maxToolCalls : DEFAULT_MAX_TOOL_CALLS,
    maxRuntimeMs: typeof maxRuntimeMs === "number" ? maxRuntimeMs : DEFAULT_MAX_RUNTIME_MS,
    maxContinueCalls: DEFAULT_MAX_CONTINUE_CALLS,
    outputSchema: {},
    status: "active",
  };

  return { ok: true, definition };
}

/**
 * Parse an optional positive-integer frontmatter scalar.
 *
 * Returns either a number (valid), `undefined` (absent — caller applies the
 * default), or the {@link AgentDefinitionBuildResult} diagnostic wrapper
 * (invalid). The three-way return is discriminated by typeof: `"object"` means
 * the caller must short-circuit and return the diagnostic.
 *
 * Centralised here so maxToolCalls and maxRuntimeMs share identical parsing
 * semantics: empty/whitespace string is treated as absent; any non-empty
 * string that does not parse to a positive integer is a diagnostic.
 */
function parsePositiveInt(
  raw: string | undefined,
  agentName: string,
  fieldName: string,
  fail: (code: string, message: string) => AgentDefinitionBuildResult
): number | undefined | AgentDefinitionBuildResult {
  if (raw === undefined) return undefined;
  if (raw.trim().length === 0) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return fail(
      "frontmatter-invalid",
      `Agent '${agentName}' ${fieldName} value '${raw}' is not a positive integer.`
    );
  }
  return n;
}

/**
 * Emit non-fatal `agent-tool-invalid` (DX-01) diagnostics for every tool in
 * {@link definition.allowedTools} that is NOT in {@link registeredToolNames}
 * (D-ToolDiagnostic).
 *
 * The helper is SEPARATE from {@link buildAgentDefinition} on purpose:
 *   - The validator's job is schema correctness (is the frontmatter well-
 *     formed?). It MUST NOT depend on the live tool registry — that would
 *     couple authoring-time validation to runtime registration order and
 *     make the validator impure.
 *   - The loader's job is authoring feedback. It calls detectUnknownTools
 *     AFTER the validator returns ok and emits any warnings into its
 *     diagnostics sink. The definition itself is still registered.
 *
 * Source attribution for the diagnostics is derived from the definition's
 * scoped id (the `${sourceId}:agent:${name}` form produced by the validator).
 * Built-in ids (bare `agent-*`) default to the "user" source kind — built-ins
 * do not normally flow through this helper, and the warning severity makes
 * the attribution non-critical.
 *
 * Returns a fresh array; does not throw.
 */
export function detectUnknownTools(
  definition: AgentDefinitionView,
  registeredToolNames: ReadonlySet<string>
): AIFetchlyConfigDiagnostic[] {
  const { sourceId, source } = sourceFromDefinitionId(definition.id);
  const out: AIFetchlyConfigDiagnostic[] = [];
  for (const tool of definition.allowedTools) {
    if (!registeredToolNames.has(tool)) {
      out.push({
        severity: "warning",
        source,
        sourceId,
        filePath: "",
        code: "agent-tool-invalid",
        message: `Agent '${definition.name}' references tool '${tool}' which is not currently registered. The agent will still be registered, but this tool will be unavailable at dispatch until it is registered by a skill or MCP server.`,
        recoverable: true,
      });
    }
  }
  return out;
}

/**
 * Derive source attribution from a scoped agent id. Recognises the
 * `${sourceId}:agent:${name}` form produced by {@link buildAgentDefinition}.
 * Bare built-in ids (`agent-*`) default to the "user" source kind.
 */
function sourceFromDefinitionId(id: string): {
  sourceId: string;
  source: AIFetchlyConfigSourceKind;
} {
  const marker = ":agent:";
  const idx = id.indexOf(marker);
  if (idx === -1) {
    // Bare built-in form — built-ins don't flow through detectUnknownTools in
    // practice. Default to "user" so the diagnostic is still well-typed.
    return { sourceId: "built-in", source: "user" };
  }
  const sourceId = id.slice(0, idx);
  if (sourceId === "user") return { sourceId, source: "user" };
  if (sourceId.startsWith("workspace:")) return { sourceId, source: "workspace" };
  if (sourceId.startsWith("plugin:")) return { sourceId, source: "plugin" };
  return { sourceId, source: "user" };
}
