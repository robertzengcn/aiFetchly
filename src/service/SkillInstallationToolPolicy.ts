/**
 * SkillInstallationToolPolicy — request/session-scoped allow/deny rules
 * applied BEFORE tool execution (design §8.6, PRD §9.7, FR-30).
 *
 * After an explicit package-install intent is recognized:
 *   - generic shell/file/catalog tools cannot perform acquisition, setup,
 *     copy, link, or registration FOR THAT TARGET (unrelated workspace work
 *     stays legal);
 *   - a blocked call returns the stable INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED
 *     result naming the typed entry point;
 *   - a generic fallback is allowed ONLY after a typed
 *     manual-action-required transition.
 *
 * This is a request-scoped decision on top of — never a replacement for —
 * existing permission checks.
 */

import type { SkillRoutingDecision } from "@/service/SkillInstallIntentGuard";
import { toolCatalogCounters } from "@/service/ToolCatalogCounters";

export const INSTALLER_TOOL_NAMES: ReadonlySet<string> = new Set([
  "skill_install_prepare",
  "skill_install_approve",
  "skill_install_status",
  "skill_install_cancel",
  "skill_install_update",
  "skill_install_repair",
  "skill_install_retry",
]);

export interface ToolPolicyInput {
  readonly routing: SkillRoutingDecision | null;
  readonly toolName: string;
  readonly toolArguments: Record<string, unknown>;
  /** Normalized install target when an explicit intent is active. */
  readonly installTarget?: string;
  /**
   * Manual-action fallback approval. `true` (legacy boolean) approves the
   * current routing decision's target; a record approves ONLY the exact
   * target it names (audit finding 9 — the fallback must not become a
   * process-wide allow-all).
   */
  readonly manualActionApproved?:
    | boolean
    | {
        readonly target: string;
        /** Audit R8: the EXACT approved operation — tool name plus the
         *  command line for shell fallbacks. A target-only record
         *  authorized ANY call against that target. */
        readonly toolName?: string;
        readonly operation?: string;
        /** Audit R8: the exact working directory, when the approval names
         *  one — a matching command in a different cwd is refused. */
        readonly cwd?: string;
      };
}

export type ToolPolicyVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED";
      readonly message: string;
    };

/**
 * Commands that constitute installation acquisition/setup by shell.
 * Flag-tolerant shapes (audit finding 9): `git -c advice.detachedHead=false
 * clone <target>` and `git --depth 1 clone <target>` carry options between
 * the verb and the action, so the pattern allows tokens between them and
 * stops at shell separators (| ; &&) — each segment is judged on its own.
 */
const SHELL_INSTALL_RE =
  /\b(?:git|gh)\b[^\n|;&]*\b(?:clone|repo\s+clone)\b|\b(?:curl|wget)\b[^\n|;&]*\b(?:\.zip|\.tar\.gz|\.tgz)\b|\b(?:pip|npm|brew|apt(?:-get)?|winget|uv)\b[^\n|;&]*\binstall\b|\bunzip\b|\btar\b[^\n|;&]*\s-[xf]|\bcp\b[^\n|;&]*\s-r\b|\bmv\b[^\n|;&]*\.(?:aifetchly|claude)\b[^\n|;&]*\bskills\b|\bln\b[^\n|;&]*\b-s\b/i;

/** File writes that mutate the install destination. */
const INSTALL_DEST_RE =
  /[\\/]\.aifetchly[\\/]skills[\\/]|[\\/]\.claude[\\/]skills[\\/]/i;

export function evaluateSkillInstallationToolPolicy(
  input: ToolPolicyInput
): ToolPolicyVerdict {
  const { routing } = input;

  // Policy activates only for an explicit package-install decision.
  if (!routing || routing.confidence !== "explicit") {
    return { allowed: true };
  }
  const target = (input.installTarget ?? routing.source ?? "").toLowerCase();

  if (input.manualActionApproved !== undefined) {
    // NFR-12: bounded approvals honored (release metrics, PRD §14).
    toolCatalogCounters.increment("install_manual_approval_honored");
    // Bounded fallback (audit finding 9): the approval applies to THIS
    // explicit-install routing decision's target, not to every future
    // call. When the caller records the approved target, a different
    // target (or a later, unrelated decision) is NOT covered.
    // Legacy boolean `true` keeps the finding-9 scope: the CURRENT
    // routing decision's target. A record carries the R8 operation
    // binding.
    if (input.manualActionApproved === true) {
      return { allowed: true };
    }
    const approvedTarget = (
      input.manualActionApproved as unknown as
        | {
            target?: string;
            toolName?: string;
            operation?: string;
            cwd?: string;
          }
        | string
        | undefined
    );
    const approvedTargetStr =
      typeof approvedTarget === "string"
        ? approvedTarget
        : approvedTarget?.target;
    const approvedTool =
      typeof approvedTarget === "string" ? undefined : approvedTarget?.toolName;
    const approvedOperation =
      typeof approvedTarget === "string" ? undefined : approvedTarget?.operation;
    const approvedCwd =
      typeof approvedTarget === "string" ? undefined : approvedTarget?.cwd;
    const targetMatches =
      approvedTargetStr !== undefined &&
      target &&
      approvedTargetStr.toLowerCase() === target;
    // Operation binding (audit R8): when the record names the approved
    // operation, ONLY that operation is authorized — the tool name must
    // match, the command line must match exactly (normalized
    // whitespace), and, when the approval names a cwd, the call's
    // working directory must match it. A target-only record keeps the
    // legacy target scope (never broader).
    if (
      approvedTool !== undefined ||
      approvedOperation !== undefined ||
      approvedCwd !== undefined
    ) {
      const toolMatches =
        approvedTool === undefined || approvedTool === input.toolName;
      const command = String(
        input.toolArguments.command ?? ""
      ).replace(/\s+/g, " ").trim();
      const operationMatches =
        approvedOperation === undefined ||
        approvedOperation.replace(/\s+/g, " ").trim() === command;
      // Fail closed: an approval naming a cwd refuses calls that omit it.
      const callCwd = String(input.toolArguments.cwd ?? "").trim();
      const cwdMatches =
        approvedCwd === undefined ||
        (callCwd !== "" && callCwd === approvedCwd.trim());
      if (targetMatches && toolMatches && operationMatches && cwdMatches) {
        return { allowed: true };
      }
      return blocked();
    }
    if (targetMatches) {
      return { allowed: true };
    }
  }

  // 1. tool_catalog_search must not be used to find Git/filesystem
  //    substitutes for installation (FR-28).
  if (input.toolName === "tool_catalog_search") {
    const query = String(
      input.toolArguments.query ?? input.toolArguments.search ?? ""
    ).toLowerCase();
    if (
      target &&
      query &&
      (query.includes("git") ||
        query.includes("clone") ||
        query.includes("file") ||
        query.includes("shell"))
    ) {
      return blocked();
    }
    if (/\b(?:git|clone|shell|file\s*read|glob)\b/.test(query)) {
      return blocked();
    }
    return { allowed: true };
  }

  // 2. shell_execute: block installation acquisition/setup commands —
  //    unrelated commands (the user's actual work) stay legal.
  if (input.toolName === "shell_execute") {
    const command = String(input.toolArguments.command ?? "");
    // Audit finding 9: acquisition/setup commands are blocked under an
    // explicit install decision REGARDLESS of whether the target string
    // appears — `git -c advice.detachedHead=false clone <target>`,
    // `pip install <anything>`, and archive curls all belong to the typed
    // installer (or a bounded, per-target manual approval above).
    if (SHELL_INSTALL_RE.test(command)) {
      return blocked();
    }
    return { allowed: true };
  }

  // 3. file_write/file_edit under the install destination.
  if (input.toolName === "file_write" || input.toolName === "file_edit") {
    const p = String(input.toolArguments.path ?? "");
    if (INSTALL_DEST_RE.test(p)) {
      return blocked();
    }
    return { allowed: true };
  }

  // 4. glob/file_read must not substitute for installer acquisition or
  //    inspection of the install target.
  if (
    (input.toolName === "glob_files" || input.toolName === "file_read") &&
    target
  ) {
    const p = String(
      input.toolArguments.path ?? input.toolArguments.pattern ?? ""
    ).toLowerCase();
    // Only block when explicitly probing the target source/destination —
    // ordinary workspace reads are unrelated.
    if (p.includes(target)) {
      return blocked();
    }
  }

  return { allowed: true };
}

function blocked(): ToolPolicyVerdict {
  return {
    allowed: false,
    code: "INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED",
    message:
      "This installation step is owned by the typed installer. Call " +
      "skill_install_prepare with the source and continue via its returned " +
      "session_id and next_action.",
  };
}
