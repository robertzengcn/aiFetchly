/**
 * Pure type declarations for the AiFetchly local extensibility config stack.
 *
 * This module is the single source of truth for the data contracts shared by
 * the config loader (src/service/aifetchlyConfig/*), the slash command
 * registry, the context assembler, and the IPC layer. It is intentionally
 * dependency-free: no Electron, TypeORM, Vue, or service imports, so it can
 * be imported from any process context (main, worker, renderer, tests).
 *
 * Concrete SlashCommandDefinition / AgentDefinitionView / HookDefinitionView /
 * LocalSkillDefinition types are owned by downstream plans (slashCommandTypes.ts
 * and siblings). Until they land, the snapshot carries those capability arrays
 * as `readonly unknown[]`; the slash command SOURCE and TYPE unions are stable
 * enough to be defined here so the loader and registry share one vocabulary
 * without risking a circular import.
 */

export type AIFetchlyConfigSourceKind = "user" | "workspace" | "plugin";

export interface AIFetchlyConfigSourceRef {
  readonly kind: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly rootPath: string;
  readonly workspaceId?: string;
  readonly workspaceRoot?: string;
  readonly pluginName?: string;
}

export type AIFetchlyConfigFileKind =
  | "instructions"
  | "settings"
  | "command"
  | "agent"
  | "skill"
  | "hook"
  | "plugin-options"
  | "unknown";

export interface AIFetchlyConfigFileSnapshot {
  readonly relativePath: string;
  readonly kind: AIFetchlyConfigFileKind;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly contentHash: string;
}

export type AIFetchlyConfigSeverity = "info" | "warning" | "error";

export interface AIFetchlyConfigDiagnostic {
  readonly severity: AIFetchlyConfigSeverity;
  readonly source: AIFetchlyConfigSourceKind;
  readonly sourceId: string;
  readonly filePath: string;
  /** Stable code from AIFETCHLY_DIAGNOSTIC_CODES (see AIFetchlyConfigConstants). */
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface AIFetchlyInstructionBlock {
  readonly id: string;
  readonly source: "user" | "workspace";
  readonly sourceId: string;
  readonly label: string;
  readonly relativePath: string;
  readonly content: string;
  readonly contentHash: string;
  readonly trusted: boolean;
}

/**
 * Stable aliases shared across the config + slash-command stacks.
 *
 * Concrete SlashCommandDefinition / SlashCommandView shapes live in
 * slashCommandTypes.ts (Plan 02); defining the source and type unions here
 * lets both the loader and the registry import them without a cycle.
 */
export type SlashCommandSource = "built-in" | "user" | "workspace" | "plugin";
export type SlashCommandType = "prompt" | "local" | "skill";

export interface AIFetchlyConfigSnapshot {
  readonly source: "user" | "workspace";
  readonly sourceId: string;
  readonly rootPath: string;
  readonly version: number;
  readonly files: readonly AIFetchlyConfigFileSnapshot[];
  readonly instructions: readonly AIFetchlyInstructionBlock[];
  // Phase 13 leaves these capability arrays as `readonly unknown[]`; Plans 02
  // (commands), 16 (agents), 17 (hooks), and 18 (skills) replace them with
  // their concrete definition types. The diff function compares them by id.
  readonly commands: readonly unknown[];
  readonly agents: readonly unknown[];
  readonly hooks: readonly unknown[];
  readonly skills: readonly unknown[];
  readonly diagnostics: readonly AIFetchlyConfigDiagnostic[];
}

export interface AIFetchlyConfigDiff {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly commandsChanged: boolean;
  readonly agentsChanged: boolean;
  readonly skillsChanged: boolean;
  readonly hooksChanged: boolean;
  readonly instructionsChanged: boolean;
  readonly diagnosticsChanged: boolean;
}

export interface AIFetchlyConfigSettings {
  readonly commandsEnabled: boolean;
  readonly agentsEnabled: boolean;
  readonly hooksEnabled: boolean;
  readonly workspaceConfigEnabled: boolean;
  readonly watchEnabled: boolean;
}
