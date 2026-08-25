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

export type PortableSkillKind = "prompt" | "executable" | "plugin" | "ambiguous";

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
  readonly acquisitionMethod: "git" | "github-archive" | "local-copy";
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
  | "repository-command";

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
}

// ---------------------------------------------------------------------------
// Snapshot (design §8.2) — the tool/IPC response envelope
// ---------------------------------------------------------------------------

export interface InstallSnapshot {
  readonly sessionId: SkillInstallationSessionId;
  readonly installationId: SkillInstallationId | null;
  readonly state: SkillInstallationState;
  readonly nextAction: SkillInstallNextAction;
  readonly planRevision: string | null;
  readonly safeSummary: string;
  readonly recoverable: boolean;
  readonly errorCode?: string;
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
const SECRET_VALUE_RE =
  /(?:^|[\s=:,(])(sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/;

function rejectSecretShaped(value: unknown, path: string[]): string[] {
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value.trim())) {
      return [`${path.join(".") || "value"} looks like a secret value`];
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => rejectSecretShaped(item, [...path, String(i)]));
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

export const SkillInstallPrepareArgsSchema = z.object({
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
  constraints: z
    .array(z.string().max(2_000))
    .max(20)
    .superRefine((entries, ctx) => {
      for (const problem of rejectSecretShaped(entries, ["constraints"])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }
    })
    .optional(),
  sessionId: z.string().max(100).optional(),
});

export const SkillInstallApproveArgsSchema = z.object({
  sessionId: z.string().min(1),
  planRevision: z.string().min(1),
  approve: z.boolean(),
  selectedSkillIds: z.array(z.string().max(200)).max(100).optional(),
});

export const SkillInstallStatusArgsSchema = z.object({
  sessionId: z.string().min(1),
});

export const SkillInstallCancelArgsSchema = z.object({
  sessionId: z.string().min(1),
});

export type SkillInstallPrepareArgs = z.infer<typeof SkillInstallPrepareArgsSchema>;
export type SkillInstallApproveArgs = z.infer<typeof SkillInstallApproveArgsSchema>;
export type SkillInstallStatusArgs = z.infer<typeof SkillInstallStatusArgsSchema>;
export type SkillInstallCancelArgs = z.infer<typeof SkillInstallCancelArgsSchema>;
