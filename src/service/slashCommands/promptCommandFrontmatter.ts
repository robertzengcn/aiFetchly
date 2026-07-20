// src/service/slashCommands/promptCommandFrontmatter.ts
// CMD-06 (Phase 15) — single owner of the prompt-command frontmatter schema.
//
// This validator consumes ALREADY-PARSED frontmatter (the
// Record<string, string | readonly string[]> shape produced by the Phase 13-01
// restricted frontmatter parser / Phase 14 WorkspaceCommandDraft) and either:
//   - returns a {ok:true, SlashCommandDefinition} with type 'prompt', or
//   - returns a {ok:false, diagnostic} describing the FIRST violated check.
//
// Plan 15-02 reuses this function from BOTH the global (~/.aifetchly) loader
// AND the workspace conversion path so the CMD-06 schema is encoded exactly
// once. Inputs are NEVER mutated; outputs are defensive copies.
//
// Pure module: imports only types + AIFetchlyConfigConstants. NO fs / Electron
// / TypeORM / Vue / other-service imports (verified by grep gate). Never
// throws — malformed drafts return {ok:false, diagnostic}.

import type { AIFetchlyConfigDiagnostic, AIFetchlyConfigSourceKind } from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import {
  AIFETCHLY_CONFIG_LIMITS,
  COMMAND_NAME_REGEX,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";

/**
 * A parsed frontmatter value: scalar string or a readonly string array
 * (e.g. aliases). Mirrors the {@link WorkspaceCommandDraft.frontmatter}
 * shape produced by the restricted frontmatter parser.
 */
export type FrontmatterValue = string | readonly string[];

/**
 * Input draft — parsed frontmatter + body + relative path. The validator
 * does NOT re-parse bytes; it consumes already-parsed frontmatter records.
 *
 * `frontmatter` uses `Readonly<Record<...>>` to make the immutability
 * contract explicit; callers may pass a plain record. The validator never
 * mutates the input.
 */
export interface PromptCommandDraft {
  readonly frontmatter: Readonly<Record<string, FrontmatterValue>>;
  readonly body: string;
  readonly relativePath: string;
}

/**
 * Source attribution applied to the produced {@link SlashCommandDefinition}
 * and any diagnostic. Mirrors the global/workspace/plugin source metadata
 * carried by Phase 13-02 / Phase 14 snapshots.
 *
 * `source` is the narrower {@link AIFetchlyConfigSourceKind} union
 * (excludes "built-in") because prompt commands never come from the
 * built-in source — built-ins are `type: "local"`. It is structurally
 * assignable to {@link SlashCommandDefinition.source}.
 */
export interface PromptCommandSourceMeta {
  readonly source: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly requiresTrust: boolean;
}

/**
 * Discriminated result of {@link buildPromptCommandDefinition}.
 */
export type PromptCommandBuildResult =
  | { readonly ok: true; readonly definition: SlashCommandDefinition }
  | { readonly ok: false; readonly diagnostic: AIFetchlyConfigDiagnostic };

/**
 * Build a CMD-06-conformant {@link SlashCommandDefinition} from a parsed
 * frontmatter draft, or return a diagnostic describing the first violated
 * constraint (SC4).
 *
 * Validation order (first violation wins):
 *   1. `name` present, string, and matches {@link COMMAND_NAME_REGEX}
 *      (else `command-name-invalid`).
 *   2. `description` present and non-empty (else `command-description-missing`).
 *   3. `description` length <= commandDescriptionLength (else `frontmatter-invalid`).
 *   4. `argumentHint` (optional) length <= commandArgumentHintLength (else `frontmatter-invalid`).
 *   5. `aliases` (optional, defaults to []) is an array of <= commandAliases
 *      entries, each matching {@link COMMAND_NAME_REGEX} (else `frontmatter-invalid`).
 *   6. `type` is exactly `"prompt"` (else `frontmatter-invalid` — Phase 15
 *      handles prompt commands only).
 *   7. `body` is non-empty after trim (else `frontmatter-invalid`).
 *
 * On success, the definition has:
 *   - `id` = `${sourceMeta.sourceId}:command:${name}` (stable per source+name)
 *   - `type` = `"prompt"`
 *   - `enabled` = `true`
 *   - `aliases` = defensive `Array.from` copy
 *   - all other fields sourced verbatim from `draft`/`sourceMeta`
 *
 * Never throws — malformed drafts (non-string scalars, wrong-type aliases)
 * return `{ok:false, diagnostic}`.
 */
export function buildPromptCommandDefinition(
  draft: PromptCommandDraft,
  sourceMeta: PromptCommandSourceMeta
): PromptCommandBuildResult {
  const fm = draft.frontmatter ?? {};
  const filePath = draft.relativePath ?? "";

  // Helper: build a diagnostic with the project's stable shape.
  const fail = (code: string, message: string): PromptCommandBuildResult => ({
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

  // 1. name — required, must match the CMD-06 name pattern.
  const name = asString("name");
  if (name === undefined || name.length === 0) {
    return fail("command-name-invalid", "Command frontmatter is missing a name.");
  }
  if (!COMMAND_NAME_REGEX.test(name)) {
    return fail(
      "command-name-invalid",
      `Command name '${name}' is invalid — must match ${COMMAND_NAME_REGEX} (lowercase letter first, then letters/digits/hyphens/underscores).`
    );
  }

  // 2. description — required, non-empty.
  const description = asString("description");
  if (description === undefined || description.trim().length === 0) {
    return fail(
      "command-description-missing",
      `Command '${name}' is missing a description.`
    );
  }

  // 3. description length cap.
  if (description.length > AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength) {
    return fail(
      "frontmatter-invalid",
      `Command '${name}' description is ${description.length} characters — exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandDescriptionLength}-character cap.`
    );
  }

  // 4. argumentHint (optional) length cap.
  const argumentHintRaw = asString("argumentHint");
  if (
    argumentHintRaw !== undefined &&
    argumentHintRaw.length > AIFETCHLY_CONFIG_LIMITS.commandArgumentHintLength
  ) {
    return fail(
      "frontmatter-invalid",
      `Command '${name}' argumentHint is ${argumentHintRaw.length} characters — exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandArgumentHintLength}-character cap.`
    );
  }

  // 5. aliases — optional, default []; each must match the name pattern.
  const aliasesRaw = (fm as Record<string, unknown>).aliases;
  let aliases: readonly string[] = [];
  if (aliasesRaw !== undefined) {
    if (!Array.isArray(aliasesRaw)) {
      return fail(
        "frontmatter-invalid",
        `Command '${name}' aliases must be a YAML string array.`
      );
    }
    // Defensive copy with element-type check (parser guarantees strings, but
    // never trust unchecked input at a trust boundary).
    const coerced: string[] = [];
    for (const a of aliasesRaw) {
      if (typeof a !== "string") {
        return fail(
          "frontmatter-invalid",
          `Command '${name}' aliases contains a non-string entry.`
        );
      }
      coerced.push(a);
    }
    aliases = coerced;
    if (aliases.length > AIFETCHLY_CONFIG_LIMITS.commandAliases) {
      return fail(
        "frontmatter-invalid",
        `Command '${name}' has ${aliases.length} aliases — exceeds the ${AIFETCHLY_CONFIG_LIMITS.commandAliases}-alias cap.`
      );
    }
    for (const a of aliases) {
      if (!COMMAND_NAME_REGEX.test(a)) {
        return fail(
          "frontmatter-invalid",
          `Command '${name}' alias '${a}' is invalid — must match ${COMMAND_NAME_REGEX}.`
        );
      }
    }
  }

  // 6. type — required, must be exactly "prompt" (Phase 15 scope).
  const type = asString("type");
  if (type !== "prompt") {
    return fail(
      "frontmatter-invalid",
      type === undefined
        ? `Command '${name}' is missing the required 'type: prompt' field.`
        : `Command '${name}' has type '${type}' — only 'prompt' commands are supported in Phase 15.`
    );
  }

  // 7. body — required, non-empty after trim.
  const body = typeof draft.body === "string" ? draft.body : "";
  if (body.trim().length === 0) {
    return fail(
      "frontmatter-invalid",
      `Command '${name}' has an empty body — prompt commands require a non-empty body.`
    );
  }

  const definition: SlashCommandDefinition = {
    id: `${sourceMeta.sourceId}:command:${name}`,
    name,
    description,
    aliases: Array.from(aliases),
    type: "prompt",
    source: sourceMeta.source,
    sourceId: sourceMeta.sourceId,
    sourceLabel: sourceMeta.sourceLabel,
    argumentHint: argumentHintRaw,
    requiresTrust: sourceMeta.requiresTrust,
    enabled: true,
    body,
  };

  return { ok: true, definition };
}
