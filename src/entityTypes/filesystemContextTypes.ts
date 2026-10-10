/**
 * Unified conversation filesystem scope types.
 *
 * Source of truth: natural-language-skill-installation technical design §6
 * and PRD §15. Every workspace-aware tool in a conversation (file tools,
 * shell tools, prompt-skill resource access, the skill installer) must
 * resolve the SAME canonical workspace through
 * `ConversationFilesystemContextService` — a tool may have narrower
 * permissions, but it must never silently select a different root.
 *
 * Pure data — no Vue / Vue Router / Electron imports so this stays safe for
 * any process bundle.
 */

/** Operations a root can be granted for. Narrow by default, never broadened. */
export type FilesystemCapability =
  | "read"
  | "write"
  | "execute"
  | "watch"
  | "activate";

/** The class of root a capability entry describes. */
export type FilesystemRootKind =
  | "workspace"
  | "skill-source"
  | "skill-activation"
  | "install-staging"
  | "temporary-run"
  | "legacy-default";

export interface FilesystemRootCapability {
  /** Stable id for audit records (e.g. "workspace:12"). */
  readonly id: string;
  readonly kind: FilesystemRootKind;
  /** Canonical (realpath-resolved) absolute path. */
  readonly canonicalPath: string;
  readonly capabilities: ReadonlySet<FilesystemCapability>;
}

/**
 * One conversation, one filesystem world.
 *
 * The initial context holds only the approved workspace. An installation
 * session may add narrow staging/source/activation roots; installing a skill
 * must never add the whole home directory or a repository parent.
 */
export interface ConversationFilesystemContext {
  readonly conversationId: string;
  readonly workspaceId: number;
  /** Default working directory for shell tools. Always the workspace root. */
  readonly defaultCwd: string;
  /** Raw approved root (not realpath-resolved) — for display only. */
  readonly workspaceRoot: string;
  /** Canonical (realpath-resolved) workspace root — for path checks. */
  readonly canonicalWorkspaceRoot: string;
  readonly roots: readonly FilesystemRootCapability[];
  /** Opaque revision that changes when approval is granted/revoked. */
  readonly revision: string;
}

/** Structured, fail-closed resolution outcome. Never throws. */
export type FilesystemContextResolution =
  | { readonly ok: true; readonly context: ConversationFilesystemContext }
  | {
      readonly ok: false;
      readonly code:
        | "WORKSPACE_NOT_APPROVED"
        | "WORKSPACE_RESOLUTION_FAILED"
        | "INVALID_CONVERSATION";
      readonly message: string;
    };

/** Operation request for capability-aware path checks. */
export interface FilesystemPathOperationRequest {
  readonly path: string;
  readonly operation: FilesystemCapability;
  readonly context: ConversationFilesystemContext;
}

export type FilesystemPathOperationResult =
  | {
      readonly allowed: true;
      readonly resolvedPath: string;
      readonly rootId: string;
    }
  | {
      readonly allowed: false;
      readonly code:
        | "PATH_CAPABILITY_DENIED"
        | "PATH_OUTSIDE_ROOTS"
        | "PATH_MALFORMED"
        | "PATH_REALPATH_FAILED";
      readonly message: string;
    };
