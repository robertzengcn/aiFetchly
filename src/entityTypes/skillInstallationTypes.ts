/**
 * Skill installation domain types (PRD §10-12, §18-19; design §5, §8-9).
 *
 * Pure data — no Vue / Electron imports (main-process + renderer safe).
 * Zod schemas live alongside so every untrusted boundary (model tool
 * arguments, IPC, worker messages) validates against the same contract.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Identity (design §5.1)
// ---------------------------------------------------------------------------

export type SkillInstallationId = string;
export type SkillInstallationSessionId = string;

export type PortableSkillKind =
  | "prompt"
  | "executable"
  | "plugin"
  | "ambiguous";

export type SkillActivationMode =
  | "managed-copy"
  | "symbolic-link"
  | "junction"
  | "legacy-installed";

export type SkillScope = "user" | "workspace";

// ---------------------------------------------------------------------------
// Sources (design §5.4)
// ---------------------------------------------------------------------------

export type SkillSourceKind =
  | "github"
  | "git"
  | "local-directory"
  | "local-archive";

export interface SkillSourceDescriptor {
  readonly kind: SkillSourceKind;
  /** Canonical URI with credentials stripped and GitHub shape normalized. */
  readonly canonicalUri: string;
  readonly requestedRevision?: string;
  readonly subdirectory?: string;
}

export interface ResolvedSkillSource {
  readonly sourceId: string;
  readonly canonicalUri: string;
  /** Commit SHA / content hash resolved at acquisition. */
  readonly resolvedRevision: string;
  readonly acquiredRoot: string;
  readonly contentHash: string;
  readonly acquisitionMethod:
    | "git"
    | "github-archive"
    | "github-release-asset"
    | "local-copy";
}

// ---------------------------------------------------------------------------
// Session state machine (design §5.3)
// ---------------------------------------------------------------------------

export type SkillInstallationState =
  | "requested"
  | "acquiring"
  | "inspecting"
  | "planning"
  | "awaiting_approval"
  | "installing_dependencies"
  | "awaiting_secret"
  | "awaiting_commands"
  | "activating"
  | "verifying"
  | "ready"
  | "failed"
  | "cancelled"
  | "rollback_required";

/** The single authority for the model's next step (design §8.6). */
export type SkillInstallNextAction =
  | "inspect-in-progress"
  | "review-plan"
  | "approve-plan"
  | "approve-dependency"
  | "provide-secret-securely"
  | "run-commands"
  | "resume"
  | "retry"
  | "manual-action-required"
  | "ready"
  | "terminal-error";

// ---------------------------------------------------------------------------
// Plan (design §8.3) — immutable; any change creates a new revision
// ---------------------------------------------------------------------------

export type DependencyKind =
  | "system-binary"
  | "python-environment"
  | "node-environment"
  | "repository-command"
  /** PRD §18.1 classification: MCP server / model-or-artifact requirements
   *  surface as visible plan items instead of being silently ignored. */
  | "mcp-server"
  | "model-artifact";

export interface VerificationProbe {
  readonly command: string;
  readonly expectedPattern?: string;
  readonly description: string;
}

export interface DependencyPlanItem {
  readonly id: string;
  readonly kind: DependencyKind;
  readonly name: string;
  readonly currentStatus: "satisfied" | "missing" | "incompatible" | "unknown";
  readonly requiredVersion?: string;
  readonly installMethod?: string;
  readonly requiresElevation: boolean;
  readonly approvalRisk: "low" | "medium" | "high";
  readonly probes: readonly VerificationProbe[];
  /** Redacted probe evidence from the LAST detection run — version line,
   *  diagnostic codes (design §14.1). Recorded so the review card and
   *  readiness report show WHAT was detected, not just satisfied/missing
   *  (audit finding 12 / NFR-08). */
  readonly detectionEvidence?: string;
  /** Audit R9 (PRD §18.2): the version the probe actually detected (e.g.
   *  "4.4.2" parsed from `ffmpeg -version` output). */
  readonly detectedVersion?: string;
  /** Audit R9 (PRD §18.3): the resolved executable path (`which`/`where`)
   *  for the detected binary — stored in typed skill configuration, never
   *  in the repository. */
  readonly resolvedPath?: string;
  /** Audit R9 (PRD §18.2): whether the dependency is a shared system
   *  package (true) or skill-specific (false — e.g. managed language
   *  environments under skill-environments/<installation-id>/). */
  readonly shared?: boolean;
}

export interface CredentialRequirement {
  readonly id: string;
  readonly name: string;
  readonly environmentVariable: string;
  readonly provider: string;
  readonly required: boolean;
}

export interface ApprovedCommandTemplate {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environmentNames: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly rationale: string;
}

export interface RequestedSkillPermission {
  readonly kind:
    | "helper-execution"
    | "network"
    | "workspace-write"
    | "package-manager";
  readonly detail: string;
}

export interface InstallWarning {
  readonly code: string;
  readonly message: string;
}

export interface DiscoveredSkillPackage {
  readonly candidateId: string;
  readonly rootRelativePath: string;
  readonly kind: PortableSkillKind;
  readonly name: string;
  readonly description: string;
  readonly skillMarkdownPath?: string;
  readonly legacyManifestPath?: string;
  readonly helperSummaryCount: number;
  readonly compatibilityWarnings: readonly InstallWarning[];
}

export interface ActivationPlan {
  readonly mode: SkillActivationMode;
  readonly targetDirectory: string;
  readonly skillsToActivate: readonly string[];
}

export interface SkillInstallPlan {
  readonly planVersion: 1;
  readonly planRevision: string;
  readonly sessionId: SkillInstallationSessionId;
  readonly source: ResolvedSkillSource;
  readonly discoveredSkills: readonly DiscoveredSkillPackage[];
  readonly selectedSkillIds: readonly string[];
  readonly activation: ActivationPlan;
  readonly dependencies: readonly DependencyPlanItem[];
  readonly credentials: readonly CredentialRequirement[];
  readonly commands: readonly ApprovedCommandTemplate[];
  readonly permissions: readonly RequestedSkillPermission[];
  readonly warnings: readonly InstallWarning[];
  readonly verification: readonly VerificationProbe[];
  /** Non-secret user constraints from the request (PRD §9.2 / FR-04,
   *  FR-18–20) — persisted so the session independently restores the
   *  request contract (read-order, wait/do-not-transcribe, explicit
   *  dependency asks) across retry and recovery. */
  readonly constraints?: readonly string[];
  /** Review RV1+RV2: the APPROVED-COMMAND verification baseline — the tree
   *  hash of the plan's acquiredRoot (the inspection sub-root when one was
   *  requested) at approval time, advanced after every successful approved
   *  command so multi-command setup writes are sanctioned ACROSS process
   *  restarts. Falls back to source.contentHash when absent (legacy plans). */
  readonly commandBaselineHash?: string;
}

// ---------------------------------------------------------------------------
// Snapshot (design §8.2) — the tool/IPC response envelope
// ---------------------------------------------------------------------------

/** Structured, renderer-facing plan view (design §22.1 / TODO 8). */
export interface SafePlanView {
  readonly source: string;
  readonly revision: string;
  readonly skills: readonly {
    readonly name: string;
    readonly kind: string;
    readonly description: string;
    /** Candidate id (e.g. "skills/one") — the selection control's value
     *  and the approve() selectedSkillIds entry (audit R2). */
    readonly candidateId?: string;
    /** Whether this candidate is in the plan's current selection. */
    readonly selected?: boolean;
  }[];
  readonly dependencies: readonly {
    /** Plan item id (e.g. "dep:ffmpeg") — the approveDependency target. */
    readonly id: string;
    readonly name: string;
    readonly status: string;
    /** Audit R9 (PRD §18.1): the dependency's classification — shown so
     *  the review card distinguishes system binaries from managed language
     *  environments, MCP servers, and model artifacts. */
    readonly kind?: string;
    /** Audit R9 (PRD §18.2): optional version range the plan requires. */
    readonly requiredVersion?: string;
    /** Audit R9 (PRD §18.2): the version the probe detected. */
    readonly detectedVersion?: string;
    readonly installMethod?: string;
    /** Whether the typed installer may need OS elevation (winget/apt/brew). */
    readonly requiresElevation?: boolean;
    /** Redacted probe evidence (version output / diagnostic codes) from the
     *  last detection run (audit finding 12). */
    readonly evidence?: string;
  }[];
  readonly credentials: readonly string[];
  /** Audit R3: the credential the secure input should collect NEXT — the
   *  first declared name still unconfigured (equal to credentials[0] when
   *  none are configured yet; absent when every value is stored). */
  readonly nextMissingCredential?: string;
  readonly mode: string;
  /** Approved command templates (review D1: informed consent requires the
   *  card to show exactly what will execute). Args + riskLevel + declared
   *  env-var NAMES (never values) so the run controls show what would be
   *  injected from the secure store. */
  readonly commands: readonly {
    readonly id: string;
    readonly executable: string;
    readonly args: readonly string[];
    readonly riskLevel: string;
    readonly rationale: string;
    readonly environmentNames: readonly string[];
  }[];
  readonly warnings: readonly string[];
  /** Requested permissions with human-readable detail (§22.2 / finding 12):
   *  what the package asks for (package-manager, network, helper-exec). */
  readonly permissions?: readonly { readonly kind: string }[];
  /** Where the activation lands (e.g. "<global prompt skills>"). */
  readonly activationTarget?: string;
}

export interface InstallSnapshot {
  readonly sessionId: SkillInstallationSessionId;
  readonly installationId: SkillInstallationId | null;
  readonly state: SkillInstallationState;
  readonly nextAction: SkillInstallNextAction;
  readonly planRevision: string | null;
  readonly safeSummary: string;
  /** Structured fields when a plan is loaded (awaiting_approval onward). */
  readonly safePlan?: SafePlanView;
  readonly recoverable: boolean;
  readonly errorCode?: string;
  /** Audit R3: the credential the secure input should collect next (top
   *  level for easy card binding; undefined when nothing is missing). */
  nextMissingCredential?: string;
}

// ---------------------------------------------------------------------------
// Structured error codes (design §19)
// ---------------------------------------------------------------------------

export type SkillInstallErrorCode =
  | "WORKSPACE_NOT_APPROVED"
  | "WORKSPACE_RESOLUTION_FAILED"
  | "SOURCE_ACQUISITION_FAILED"
  | "SOURCE_LIMIT_EXCEEDED"
  | "SOURCE_REVISION_CHANGED"
  | "SKILL_NOT_FOUND"
  | "SKILL_AMBIGUOUS"
  | "SKILL_FORMAT_INVALID"
  | "INSTRUCTION_FILE_INVALID"
  | "PLAN_REVISION_MISMATCH"
  | "APPROVAL_REQUIRED"
  | "DEPENDENCY_MISSING"
  | "DEPENDENCY_INSTALL_FAILED"
  | "SECRET_REQUIRED"
  | "SECURE_STORAGE_UNAVAILABLE"
  | "ACTIVATION_COLLISION"
  | "LINK_CREATION_FAILED"
  | "ACTIVATION_VERIFICATION_FAILED"
  | "REGISTRY_RELOAD_FAILED"
  | "INSTALL_SESSION_REQUIRED"
  | "INSTALL_SESSION_CONVERSATION_MISMATCH"
  | "INSTALL_SECRET_CHANNEL_REQUIRED"
  | "INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED"
  | "INSTALL_TOOL_LOAD_RETRY_EXHAUSTED"
  | "ROLLBACK_FAILED";

// ---------------------------------------------------------------------------
// Zod schemas — model-facing tool arguments (design §8.6: no secret fields)
// ---------------------------------------------------------------------------

/**
 * Deep secret-shape validator (design §8.6 layer 2). Rejects known
 * credential keys, bearer tokens, private-key material, and secret-shaped
 * values in ANY string field of the tool arguments.
 */
const SECRET_KEY_RE =
  /(api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|bearer|authorization)/i;
export const SECRET_VALUE_RE =
  /(?:^|[\s=:,(])(sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/;

export function rejectSecretShaped(value: unknown, path: string[]): string[] {
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value.trim())) {
      return [`${path.join(".") || "value"} looks like a secret value`];
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) =>
      rejectSecretShaped(item, [...path, String(i)])
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => {
      if (SECRET_KEY_RE.test(key)) {
        return [`${[...path, key].join(".")} is a credential-shaped field`];
      }
      return rejectSecretShaped(child, [...path, key]);
    });
  }
  return [];
}

export const secretFreeRecord = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    for (const problem of rejectSecretShaped(value, [])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  });

/**
 * FR-16/NFR-03: credentialed source URLs never enter normalization,
 * persistence, logging, or process arguments. Credentials belong to Git
 * credential helpers / SSH agents, never URL rewriting (PRD §11.2).
 *
 * Rejected: http(s)/ssh URLs with userinfo (`scheme://user[:pass]@host`)
 * — including bare-token forms like `https://x-access-token@github.com/…`
 * — and scp-style remotes carrying a password (`user:pass@host:path`).
 * Allowed: clean https URLs, `git@host:owner/repo` scp syntax (standard
 * SSH, no password), local paths, and archives.
 */
export function rejectCredentialedSource(source: string): string | null {
  const trimmed = source.trim();
  // scheme://user[:pass]@host — any userinfo in an absolute URL.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/@\s]+@[^@\s]+/.test(trimmed)) {
    return "Source URLs may not embed credentials (user:password@). Use Git credential helpers or SSH keys instead.";
  }
  // scp-style with a password: user:pass@host:path (git@host:path is fine).
  if (/^[^/@\s:]+:[^\s]+@[^\s]+:/.test(trimmed)) {
    return "Source URLs may not embed credentials (user:password@). Use Git credential helpers or SSH keys instead.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Manual-action fallback approval (design §8.6, PRD §9.7 — audit R8)
// ---------------------------------------------------------------------------

/**
 * The typed provider manual-action result a user approves to open the
 * bounded generic fallback. The audit event stores this as JSON; the tool
 * boundary authorizes ONLY the exact tool + operation (+ cwd) it names —
 * never every call against the target.
 */
export interface SkillManualActionApprovalRecord {
  /** Canonical install target the fallback was approved for. */
  readonly target: string;
  /** The exact generic tool the fallback may run (e.g. shell_execute). */
  readonly toolName: string;
  /** The exact command line (or file path) being authorized. */
  readonly operation: string;
  /** The exact working directory, when the plan names one. */
  readonly cwd?: string;
  /** §8.6 payload: why no typed provider can perform this step. */
  readonly reason?: string;
  /** §8.6 payload: the permission the operation needs. */
  readonly permission?: string;
  /** §8.6 payload: how the user verifies the step happened. */
  readonly verification?: string;
  /** §8.6 payload: how to undo the operation. */
  readonly rollback?: string;
}

/**
 * Parse an audit event detail back into an approval record. Pre-R8 events
 * stored the bare target URI — those parse as target-only (legacy scope,
 * never broader). Unparseable details yield an empty record (fail closed
 * to "approved with no binding", which the policy refuses for bounded use).
 */
export function parseManualActionApprovalDetail(
  detail: string
): Partial<SkillManualActionApprovalRecord> {
  if (!detail) return {};
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== "object" || parsed === null) {
      return { target: detail };
    }
    const record = parsed as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of [
      "target",
      "toolName",
      "operation",
      "cwd",
      "reason",
      "permission",
      "verification",
      "rollback",
    ] as const) {
      const value = record[key];
      if (typeof value === "string" && value !== "") {
        out[key] = value;
      }
    }
    return out;
  } catch {
    // Legacy plain-string detail: the target URI itself.
    return { target: detail };
  }
}

/**
 * Session/installation ids are app-generated opaque tokens (UUID hex or
 * `update-<hex>-<ts>` shapes). A strict charset at every schema boundary
 * keeps model/renderer-supplied ids from ever reaching path joins or
 * recursive deletes (S1: acquisition staging traversal).
 */
export const SkillSessionIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[A-Za-z0-9:_-]+$/,
    "Session ids may only contain letters, digits, ':', '_' and '-'."
  );

export const SkillInstallPrepareArgsSchema = z
  .object({
    source: z.string().min(1, "A repository URL or local path is required"),
    ref: z.string().max(200).optional(),
    subdirectory: z.string().max(500).optional(),
    mode: z.enum(["managed-copy", "linked"]).optional(),
    /**
     * Non-secret user constraints from the request (e.g. "read install.md
     * first", "wire up ffmpeg", "wait for footage after install"). Each entry
     * runs through the deep secret-shape validator above (FR-31) — an API key
     * pasted into ordinary tool arguments is a schema error.
     */
    constraints: z.array(z.string().max(2_000)).max(20).optional(),
    sessionId: SkillSessionIdSchema.optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    // FR-31/NFR-03: EVERY ordinary field is checked, not just constraints —
    // a pasted key in source, ref, or subdirectory is a schema error, and
    // a credentialed URL never reaches normalization or persistence.
    const credentialed = rejectCredentialedSource(args.source);
    if (credentialed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: credentialed });
    }
    for (const problem of rejectSecretShaped(args, [])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  });

export const SkillInstallApproveArgsSchema = z
  .object({
    sessionId: SkillSessionIdSchema,
    planRevision: z.string().min(1),
    approve: z.boolean(),
    selectedSkillIds: z.array(z.string().max(200)).max(100).optional(),
    /**
     * FR-29: the calling conversation. When present, a session created in a
     * DIFFERENT conversation is rejected with a stable error code — model
     * tools always supply it from their execution context.
     */
    conversationId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const SkillInstallStatusArgsSchema = z
  .object({
    sessionId: SkillSessionIdSchema,
    /** FR-29 calling-conversation binding (see ApproveArgsSchema). */
    conversationId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const SkillInstallCancelArgsSchema = z
  .object({
    sessionId: SkillSessionIdSchema,
    /** FR-29 calling-conversation binding (see ApproveArgsSchema). */
    conversationId: z.string().min(1).max(100).optional(),
  })
  .strict();

export type SkillInstallPrepareArgs = z.infer<
  typeof SkillInstallPrepareArgsSchema
>;
export type SkillInstallApproveArgs = z.infer<
  typeof SkillInstallApproveArgsSchema
>;
export type SkillInstallStatusArgs = z.infer<
  typeof SkillInstallStatusArgsSchema
>;
export type SkillInstallCancelArgs = z.infer<
  typeof SkillInstallCancelArgsSchema
>;
