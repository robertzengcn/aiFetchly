// src/service/hooks/hookFileFrontmatter.ts
// HOK-01 (Phase 17 / Plan 02) — single owner of the hooks.json entry schema.
//
// This validator consumes an ALREADY-JSON-parsed hooks.json entry (`unknown`)
// and returns either:
//   - { ok: true, definition: CommandHookDefinition }, or
//   - { ok: false, diagnostic } describing the first violated check.
//
// Both the global loader (~/.aifetchly/hooks/hooks.json, source "user") and the
// main-side workspace converter (buildWorkspaceHookDefinitions, source
// "workspace") route every entry through this validator so the HOK-01 schema
// is encoded exactly once (mirrors agentFrontmatter.ts for the hook capability).
//
// Skill-ref entries (an entry declaring `skill` with no `command`) are
// intentionally registered as type "command" with a `skill:<name>` sentinel
// command — a documented no-op (D-Vocabulary). Plan 03's dispatcher detects
// the `skill:` prefix at fire time and emits a skill-registry-not-available
// diagnostic. They are NOT rejected at parse time.
//
// Pure module: imports only zod + types. NO fs / Electron / TypeORM / Vue /
// other-service imports (verified by the grep gate in the plan). Never throws —
// malformed entries return { ok: false, diagnostic }.

import { z } from "zod";
import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSourceKind,
} from "@/entityTypes/aifetchlyConfigTypes";
import type {
  CommandHookDefinition,
  HookFailureMode,
  HookSource,
} from "@/entityTypes/hookTypes";

/**
 * Events supported by config-sourced hooks (HOK-01). The lifecycle supports
 * more events internally, but only these four are authorable via hooks.json;
 * any other event yields an `unsupported-event` diagnostic (HOK-02 SC4).
 */
export const SUPPORTED_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "Stop",
] as const;

const hookEventEnum = z.enum(SUPPORTED_HOOK_EVENTS);

/**
 * Strict zod schema for a single hooks.json entry. `command` XOR `skill` is
 * required (enforced by the refine). Unknown keys are rejected (`.strict()`).
 */
export const hookEntrySchema = z
  .object({
    event: hookEventEnum,
    matcher: z.string().max(128).optional(),
    command: z.string().min(1).optional(),
    skill: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(60000).optional(),
    cwd: z.string().optional(),
    envAllowlist: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    failureMode: z.enum(["warn", "block"]).optional(),
  })
  .strict()
  .refine((d) => d.command !== undefined || d.skill !== undefined, {
    message: "a hooks.json entry must declare either 'command' or 'skill'",
    path: ["command"],
  });

export type HookEntry = z.infer<typeof hookEntrySchema>;

/**
 * Source attribution applied to the produced {@link CommandHookDefinition}
 * (via its scoped id) and any diagnostic. Mirrors the agent analog.
 * `source` is the narrower {@link AIFetchlyConfigSourceKind} union.
 */
export interface HookDefinitionSourceMeta {
  readonly source: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly relativePath: string;
}

/** Discriminated result of {@link buildHookDefinition}. */
export type HookDefinitionBuildResult =
  | { readonly ok: true; readonly definition: CommandHookDefinition }
  | { readonly ok: false; readonly diagnostic: AIFetchlyConfigDiagnostic };

/**
 * Build a HOK-01-conformant {@link CommandHookDefinition} from a parsed
 * hooks.json entry, or return a diagnostic.
 *
 * Diagnostic codes:
 *   - `unsupported-event` — the `event` field is outside the supported enum.
 *   - `hooks-json-invalid` — any other shape/validation failure (including the
 *     command-or-skill refine and unknown keys).
 *
 * The produced definition:
 *   - `id` = `${sourceMeta.sourceId}:hook:${index}` (stable scoped id).
 *   - `source`: `"project"` when `sourceMeta.source === "workspace"` (A3 —
 *     there is no "workspace" HookSource enum value; SOURCE_PRIORITY
 *     project:3 < user:5 ranks workspace above user), else `"user"`.
 *   - `trusted`: `true`. The validator is only invoked for sources that are
 *     trusted at the call site — user-owned globally, and workspace only
 *     AFTER the Task 2a trust filter passes — so the produced definition is
 *     trusted at registry-read time. (HookRegistry.getMatchingHooks skips
 *     untrusted command hooks as defense-in-depth; setting trusted=true here
 *     is what lets a trusted workspace hook actually fire per SC1.)
 *   - `failureMode`: authored value or `"warn"`.
 *   - Skill-ref entries: `type: "command"`, `command: \`skill:${skill}\`` (the
 *     D-Vocabulary no-op sentinel; Plan 03 detects the prefix at fire time).
 *
 * Never throws — malformed entries (non-object, wrong-type fields) return
 * `{ ok: false, diagnostic }`.
 */
export function buildHookDefinition(
  raw: unknown,
  sourceMeta: HookDefinitionSourceMeta,
  index: number
): HookDefinitionBuildResult {
  const filePath = sourceMeta.relativePath ?? "";
  const fail = (code: string, message: string): HookDefinitionBuildResult => ({
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

  const parsed = hookEntrySchema.safeParse(raw);
  if (!parsed.success) {
    const code = isEventIssue(parsed.error)
      ? "unsupported-event"
      : "hooks-json-invalid";
    return fail(
      code,
      `hooks.json entry #${index} failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`
    );
  }
  const entry = parsed.data;

  // A3: workspace-sourced hooks carry the "project" enum value.
  const source: HookSource =
    sourceMeta.source === "workspace" ? "project" : "user";

  // Resolve the command string. The refine guarantees command OR skill is
  // present, but zod infers both as optional, so narrow explicitly (no cast).
  // Skill-ref entries (skill, no command) get the `skill:<name>` sentinel — a
  // documented no-op (D-Vocabulary); Plan 03 detects the prefix at fire time.
  let command: string;
  let isSkillRef = false;
  if (entry.command !== undefined) {
    command = entry.command;
  } else if (entry.skill !== undefined) {
    command = `skill:${entry.skill}`;
    isSkillRef = true;
  } else {
    // Unreachable: the refine rejects both-empty. Defensive return.
    return fail(
      "hooks-json-invalid",
      `hooks.json entry #${index} declares neither 'command' nor 'skill'`
    );
  }
  void isSkillRef;

  const definition: CommandHookDefinition = {
    id: `${sourceMeta.sourceId}:hook:${index}`,
    eventName: entry.event,
    source,
    enabled: entry.enabled ?? true,
    trusted: true,
    type: "command",
    command,
    failureMode: (entry.failureMode ?? "warn") as HookFailureMode,
    ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
    ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
    ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
    ...(entry.envAllowlist !== undefined
      ? { envAllowlist: [...entry.envAllowlist] }
      : {}),
  };

  return { ok: true, definition };
}

/**
 * Whether a zod failure includes an `event`-field issue (used to pick the
 * `unsupported-event` code over the generic `hooks-json-invalid` code).
 */
function isEventIssue(error: z.ZodError): boolean {
  return error.issues.some((i) => i.path[0] === "event");
}
