/**
 * Portable prompt-skill types (natural-language-skill-installation PRD §13-14,
 * tech design §10).
 *
 * A prompt skill is a directory whose primary entry is a `SKILL.md` file. It
 * is a model-guidance package — NOT an executable AiFetchly manifest — and it
 * must never be converted into a documentation-only executable wrapper.
 *
 * Pure data — no Vue / Vue Router / Electron imports (main-process safe).
 */

/** Opaque scoped runtime identity, e.g. `prompt:user:<installation-uuid>`. */
export type SkillRuntimeId = string;

export type SkillScope = "user" | "workspace" | "plugin" | "built-in";

/**
 * Parsed SKILL.md frontmatter (design §10.2). Unknown fields are preserved
 * for diagnostics/future compatibility and can never expand capability.
 */
export interface PromptSkillManifest {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly allowedTools?: readonly string[];
  readonly declaredCredentials?: readonly string[];
  readonly resourceDirectories?: readonly string[];
  /** Controls explicit user (/name) invocation visibility. */
  readonly userInvocable?: boolean;
  /** Prevents automatic model selection; explicit invocation stays allowed. */
  readonly disableModelInvocation?: boolean;
  /** Frontmatter keys that were recognized but not interpreted. */
  readonly unknownFields: Readonly<Record<string, string | readonly string[]>>;
}

/** Registry entry for one installed prompt skill. */
export interface PromptSkillDefinition {
  readonly runtimeId: SkillRuntimeId;
  readonly installationId: string;
  readonly sourceId: string;
  readonly scope: SkillScope;
  readonly name: string;
  readonly description: string;
  /** Canonical (realpath) directory containing SKILL.md. */
  readonly canonicalRoot: string;
  readonly skillMarkdownPath: string;
  /** SHA-256 of the raw SKILL.md bytes — verified again at invocation. */
  readonly contentHash: string;
  readonly manifest: PromptSkillManifest;
  readonly enabled: boolean;
}

/** Non-fatal registry diagnostics (collisions, broken links, …). */
export interface PromptSkillCatalogDiagnostic {
  readonly code:
    | "prompt-skill-name-collision"
    | "prompt-skill-link-broken"
    | "prompt-skill-link-escape"
    | "prompt-skill-hash-mismatch"
    | "prompt-skill-duplicate-realpath"
    | "prompt-skill-limit-exceeded";
  readonly message: string;
  readonly sourceId: string;
  readonly runtimeId?: string;
}

/** Workspace context used to resolve scope precedence. */
export interface PromptSkillResolutionContext {
  readonly workspaceId?: number;
}

/** Bounded model-facing discovery view — never contains instruction bodies. */
export interface AvailablePromptSkill {
  readonly runtimeId: SkillRuntimeId;
  readonly name: string;
  readonly description: string;
  readonly sourceLabel?: string;
  readonly argumentHint?: string;
  readonly userInvocable: boolean;
  readonly modelInvocable: boolean;
}

// ---------------------------------------------------------------------------
// Universal invocation tool contract (design §10.4)
// ---------------------------------------------------------------------------

export interface UsePromptSkillInput {
  readonly skill: string;
  readonly arguments?: string;
  readonly invocationReason?: string;
}

export interface UsePromptSkillResult {
  readonly status: "loaded" | "already-loaded";
  readonly runtimeId: SkillRuntimeId;
  readonly name: string;
  readonly contentHash: string;
  readonly contextRevision: number;
}

export interface UsePromptSkillError {
  readonly status: "error";
  readonly code:
    | "SKILL_NOT_FOUND"
    | "SKILL_AMBIGUOUS"
    | "SKILL_DISABLED"
    | "SKILL_CONTEXT_HASH_MISMATCH"
    | "SKILL_CONTEXT_BUDGET_EXCEEDED"
    | "SKILL_INSTALL_MUTATION_REJECTED";
  readonly message: string;
  readonly candidates?: readonly AvailablePromptSkill[];
}

// ---------------------------------------------------------------------------
// Hidden context attachment (design §10.5-10.6)
// ---------------------------------------------------------------------------

/**
 * Model-visible but non-user instruction block injected AFTER the short tool
 * acknowledgement. Repository-authored content wrapped in application-owned
 * boundary markers — never trusted system policy.
 */
export interface PromptSkillContextAttachment {
  readonly type: "invoked_prompt_skill";
  readonly conversationId: string;
  readonly agentId?: string;
  readonly runtimeId: SkillRuntimeId;
  readonly name: string;
  readonly sourceLabel: string;
  readonly canonicalRoot: string;
  readonly contentHash: string;
  readonly contextRevision: number;
  readonly normalizedInstructions: string;
  readonly tokenEstimate: number;
  readonly invokedAt: string;
}

// ---------------------------------------------------------------------------
// Token-budget decisions (design §10.7)
// ---------------------------------------------------------------------------

export interface PromptSkillBudgetDecision {
  readonly mode: "full" | "section-selected" | "metadata-only";
  readonly availableTokens: number;
  readonly selectedSections: readonly string[];
  readonly omittedSections: readonly string[];
  readonly estimatedTokens: number;
  readonly resourceReadRequired: boolean;
}

/** One markdown section produced by the section-aware splitter. */
export interface PromptSkillSection {
  readonly heading: string;
  readonly content: string;
}

// ---------------------------------------------------------------------------
// Resource tools (design §10.8)
// ---------------------------------------------------------------------------

export interface SkillResourceSummary {
  readonly relativePath: string;
  readonly sizeBytes: number;
}

export interface SkillResourceReadResult {
  readonly relativePath: string;
  readonly content: string;
  readonly contentHash: string;
  readonly truncated: boolean;
  readonly sizeBytes: number;
}
