/**
 * Size/count limits, default settings, the global config directory name, and
 * the stable diagnostic-code tuple for the AiFetchly local extensibility
 * config stack.
 *
 * These constants are the single source of truth referenced by the loader
 * (AIFetchlyConfigLoader), the path-safety helper, the snapshot diff, and
 * downstream orchestrators. Keep this file free of filesystem or Electron
 * imports — it is pure data so it can be imported from any context.
 */

import type { AIFetchlyConfigSettings } from "@/entityTypes/aifetchlyConfigTypes";

/**
 * The single literal name of the user-editable global config directory.
 *
 * Centralised so the ".aifetchly" string appears in exactly one source file
 * (TRS-07 / CFG-01) — boundary tests can grep for this constant instead of a
 * scattered literal.
 */
export const AIFETCHLY_CONFIG_DIR_NAME = ".aifetchly";

/**
 * Per-file-type size limits and per-source count caps (design §6.5).
 *
 * Files at or above the matching limit are ignored by the loader and emit a
 * `file-too-large` diagnostic (CFG-04). Limits are checked via fs.stat BEFORE
 * fs.readFile to avoid unbounded reads (T-13-DoS mitigation).
 */
export const AIFETCHLY_CONFIG_LIMITS = {
  /** AGENTS.md (global + workspace) — 256 KiB. */
  agentsMdBytes: 256 * 1024,
  /** commands/*.md — 64 KiB each. */
  commandMdBytes: 64 * 1024,
  /** agents/*.md — 128 KiB each. */
  agentMdBytes: 128 * 1024,
  /** hooks/hooks.json — 128 KiB. */
  hooksJsonBytes: 128 * 1024,
  /** settings.json — 32 KiB. */
  settingsJsonBytes: 32 * 1024,
  /** Cap on commands accepted from a single source (DoS hygiene). */
  maxCommandsPerSource: 200,
  /** Cap on agents accepted from a single source (DoS hygiene). */
  maxAgentsPerSource: 100,
  /** Cap on hooks accepted from a single source (CFG-06 / Phase 17, DoS hygiene). */
  maxHooksPerSource: 100,
  /** CMD-06 (Phase 15): max length of a command frontmatter `description`. */
  commandDescriptionLength: 500,
  /** CMD-06 (Phase 15): max number of aliases accepted on one command. */
  commandAliases: 10,
  /** CMD-06 (Phase 15): max length of a command frontmatter `argumentHint`. */
  commandArgumentHintLength: 100,
} as const;

/**
 * CMD-06 (Phase 15) — command-name pattern.
 *
 * A valid command name is one lowercase letter followed by any number of
 * lowercase letters, digits, hyphens, or underscores (design §11 / Carry-Forward
 * in 15-CONTEXT.md). Applied to both the primary `name` and each alias.
 *
 * Two equivalent forms are exported:
 *   - {@link COMMAND_NAME_PATTERN} — the source regex literal as a string
 *     (useful for embedding in error messages, docs, or re-compilation).
 *   - {@link COMMAND_NAME_REGEX} — the compiled RegExp (use this for `.test()`).
 */
export const COMMAND_NAME_PATTERN = "^[a-z][a-z0-9_-]*$";
export const COMMAND_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;

/**
 * Default settings used when settings.json is missing, unreadable, or fails
 * validation (CFG-03 / design §6.8). Global config is enabled-by-default for
 * the capabilities that ship in v2.0; hooks default off because phase 17
 * adds the trust gate that must precede hook execution.
 */
export const DEFAULT_AIFETCHLY_CONFIG_SETTINGS: AIFetchlyConfigSettings = {
  commandsEnabled: true,
  agentsEnabled: true,
  hooksEnabled: false,
  workspaceConfigEnabled: true,
  watchEnabled: true,
};

/**
 * Stable, user-visible diagnostic codes (DX-01 / design §5.3).
 *
 * Every diagnostic emitted by the loader stack MUST use one of these codes so
 * the /status surface, telemetry, and tests can match against a closed set.
 * This tuple is the single source of truth — do not duplicate the literals.
 */
export const AIFETCHLY_DIAGNOSTIC_CODES = [
  "file-too-large",
  "frontmatter-missing",
  "frontmatter-invalid",
  "command-name-invalid",
  "command-description-missing",
  "agent-name-invalid",
  "agent-tool-invalid",
  "settings-json-invalid",
  "path-outside-root",
  "unsupported-file",
  "workspace-untrusted",
  "scanner-io-error",
  // ---- Phase 17 hooks (HOK-01 / D-Vocabulary) ----
  // hooks.json failed JSON.parse or zod validation. Consumed by Plan 02.
  "hooks-json-invalid",
  // A hooks.json entry declares an event name outside the supported set. Plan 02.
  "unsupported-event",
  // A single source exceeded maxHooksPerSource. Consumed by Plan 02.
  "count-cap",
  // A hook declares a skill action but the skill registry is not yet wired
  // (D-Vocabulary no-op). Consumed by Plan 03's dispatcher.
  "skill-registry-not-available",
] as const;

export type AIFetchlyDiagnosticCode =
  (typeof AIFETCHLY_DIAGNOSTIC_CODES)[number];
