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

export const INSTALLER_TOOL_NAMES: ReadonlySet<string> = new Set([
  "skill_install_prepare",
  "skill_install_approve",
  "skill_install_status",
  "skill_install_cancel",
]);

export interface ToolPolicyInput {
  readonly routing: SkillRoutingDecision | null;
  readonly toolName: string;
  readonly toolArguments: Record<string, unknown>;
  /** Normalized install target when an explicit intent is active. */
  readonly installTarget?: string;
  /** True when the installer returned an approved manual-action transition. */
  readonly manualActionApproved?: boolean;
}

export type ToolPolicyVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: "INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED";
      readonly message: string;
    };

/** Commands that constitute installation acquisition/setup by shell. */
const SHELL_INSTALL_RE =
  /\b(?:git\s+clone|gh\s+repo\s+clone|curl\s+[^\n]*\b(?:zip|tar\.gz|tgz)\b|wget\s|unzip\s|tar\s+[xf]|\bcp\s+-r?\s|\bmv\s+.*(?:skills|\.aifetchly)|pip\s+install|npm\s+install|brew\s+install|apt(?:-get)?\s+install|winget\s+install|ln\s+-s)\b/i;

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
  if (input.manualActionApproved) {
    return { allowed: true };
  }

  const target = (input.installTarget ?? routing.source ?? "").toLowerCase();

  // 1. tool_catalog_search must not be used to find Git/filesystem
  //    substitutes for installation (FR-28).
  if (input.toolName === "tool_catalog_search") {
    const query = String(
      input.toolArguments.query ?? input.toolArguments.search ?? ""
    ).toLowerCase();
    if (target && query && (query.includes("git") || query.includes("clone") || query.includes("file") || query.includes("shell"))) {
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
    if (SHELL_INSTALL_RE.test(command)) {
      // If the command references the recognized install target, block.
      if (!target || command.toLowerCase().includes(target) || /\bclone\b/i.test(command)) {
        return blocked();
      }
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
