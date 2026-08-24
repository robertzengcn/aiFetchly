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
  /**
   * Workspace ID for snapshots produced by the workspace scanner (Phase 14+).
   * Absent for the global ~/.aifetchly snapshot (source="user"). The watch
   * manager keys snapshots by this field; the event protocol carries it
   * redundantly so the manager can route without parsing sourceId.
   */
  readonly workspaceId?: string;
  readonly files: readonly AIFetchlyConfigFileSnapshot[];
  readonly instructions: readonly AIFetchlyInstructionBlock[];
  // Phase 13 leaves these capability arrays as `readonly unknown[]`; Plans 02
  // (commands), 16 (agents), 17 (hooks), and 18 (skills) replace them with
  // their concrete definition types. The diff function compares them by id.
  readonly commands: readonly unknown[];
  readonly agents: readonly unknown[];
  readonly hooks: readonly unknown[];
  readonly skills: readonly unknown[];
  /**
   * Portable prompt skills discovered under skills/ as SKILL.md directories
   * (including symlinks/junctions) — natural-language-skill-installation
   * design §10.9. Manifest-based executable skills stay in `skills`.
   */
  readonly promptSkills?: readonly unknown[];
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

/**
 * Phase 18 (SKL-01 / Plan 01): a raw workspace skill draft produced by the
 * WORKER scanner.
 *
 * The worker reads `<workspace>/.aifetchly/skills/<name>/manifest.json`,
 * JSON.parses it, and ships the parsed blob as opaque {@link rawManifest}
 * (an unvalidated `unknown`). NO validation runs in the worker —
 * `buildLocalSkillDraft` runs in the MAIN process via
 * `buildWorkspaceSkillDefinitions`. This keeps the worker scan-only
 * (WAT-02 worker-no-DB / no-registry / no-Electron). A structurally invalid
 * manifest is carried through unchanged; the main-process converter decides
 * whether to drop or warn.
 *
 * Defined here (rather than in `buildLocalSkillDraft.ts`) so the worker can
 * import it as a pure type without pulling main-process runtime code.
 */
export interface WorkspaceSkillDraft {
  /** Stable id `workspace:<workspaceId>:skill:<name>` — consumed by the snapshot diff. */
  readonly id: string;
  /** Always `"workspace"` (worker snapshot source kind). */
  readonly source: "workspace";
  /** The workspace source identifier (`workspace:<workspaceId>`). */
  readonly sourceId: string;
  /** Skill directory name (the `<name>` in `skills/<name>/`). */
  readonly name: string;
  /** Workspace-relative path of the manifest file (`skills/<name>/manifest.json`). */
  readonly relativePath: string;
  /** Absolute skill directory (`<workspaceRoot>/.aifetchly/skills/<name>`). */
  readonly skillDir: string;
  /** JSON-parsed manifest blob; `unknown` until validated main-side. */
  readonly rawManifest: unknown;
  /** SHA-256 of the manifest file bytes (CFG-06). */
  readonly contentHash: string;
}

/**
 * Per-capability trust flags for a config source (design §8.2 / TRS-01).
 *
 * The watcher manager applies workspace snapshots through
 * `AIFetchlyRuntimeRegistrySync.applyWorkspaceSnapshot(snapshot, trust)`
 * which DROPS untrusted capabilities before registry mutation. Phase 14
 * populates only `instructions` and `commands` from the binary workspace
 * approval state; `agents` (Phase 16), `hooks` (Phase 17), and `skills`
 * (Phase 18) stay false until those phases ship their own trust gates.
 *
 * The global user-owned path (~/.aifetchly) always calls `applySnapshot`
 * directly with every flag true — user-owned content is trusted by default.
 */
export interface AIFetchlySourceTrust {
  readonly instructions: boolean;
  readonly commands: boolean;
  readonly agents: boolean;
  readonly hooks: boolean;
  readonly skills: boolean;
}
