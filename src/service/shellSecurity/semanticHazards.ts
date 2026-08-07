/**
 * Semantic hazard detection.
 *
 * Even cleanly-parsed commands can be semantically dangerous. This module
 * matches command *heads* (argv[0]) against a curated deny/ask list, plus
 * detects structural hazards the lexer flagged (heredocs, command
 * substitution, process substitution).
 *
 * Returns a verdict so the orchestrator can short-circuit before the more
 * expensive per-path validation.
 */

import type { CommandSegment } from "./compoundSplitter";
import { deny, ask, type PermissionVerdict } from "./verdict";
import {
  SHELL_DENYLIST_PATTERNS,
  SHELL_ASK_PATTERNS,
} from "@/config/shellToolConfig";

// ---------------------------------------------------------------------------
// Hazards derived from structural lexer output
// ---------------------------------------------------------------------------

/**
 * Reject any command whose structural analysis surfaced an unanalyzable
 * construct. This is the core "parser uncertainty → ask" rule, matching
 * Claude Code's design.
 */
export function structuralHazards(
  unanalyzable: readonly string[],
  hasHeredoc: boolean
): PermissionVerdict | null {
  if (hasHeredoc) {
    return deny(
      "HEREDOC_BLOCKED",
      "Heredocs (<<) can hide arbitrary commands and are blocked."
    );
  }
  if (unanalyzable.length > 0) {
    return ask(
      "UNANALYZABLE_CONSTRUCT",
      "Command contains a construct that cannot be statically analyzed " +
        `(${unanalyzable.join(", ")}). Reject or simplify and retry.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hazards derived from segment content
// ---------------------------------------------------------------------------

/** Commands that always require approval regardless of arguments. */
const HAZARD_DENY_HEADS = new Set([
  "eval",
  "source",
  ".", // POSIX source
  "exec",
]);

/**
 * Subshell-style entry points that take a command string, spawn an
 * interactive shell, or wrap an arbitrary child command.
 */
const HAZARD_ASK_HEADS = new Set([
  // Interactive shells
  "bash",
  "sh",
  "zsh",
  "dash",
  "fish",
  "powershell",
  "pwsh",
  // Wrappers that take a command to run
  "env",
  "xargs",
  "timeout",
  "nohup",
  "stdbuf",
  // Schedulers / nice-level wrappers (can wrap arbitrary commands)
  "time",
  "nice",
  "ionice",
  "chrt",
  "taskset",
  // Tracing wrappers (capture/inspect arbitrary commands)
  "strace",
  "ltrace",
  // Bypass utilities
  "command",
  "builtin",
  "setsid",
]);

/**
 * Normalize a command head by stripping leading backslash.
 *
 * Bash treats `\rm` as "run rm bypassing aliases" — the backslash is purely
 * an alias-bypass marker and the effective command is still `rm`. Without
 * this normalization, `\rm` would evade the head-detection sets.
 */
function normalizeHead(rawHead: string): string {
  // The lexer preserves `\rm` literally (backslash escape + literal chars).
  // Strip a single leading backslash if present.
  if (rawHead.startsWith("\\")) return rawHead.slice(1);
  return rawHead;
}

export function semanticHazards(
  segments: readonly CommandSegment[]
): PermissionVerdict | null {
  for (const seg of segments) {
    if (seg.empty) continue;
    const head = normalizeHead(seg.words[0] ?? "");
    if (!head) continue;

    // Direct deny heads (eval, source, ., exec)
    if (HAZARD_DENY_HEADS.has(head)) {
      return deny(
        "HAZARD_BUILTIN",
        `'${head}' can execute arbitrary code and bypass the safety analysis.`
      );
    }

    // Shell invocations with -c: always ask (the inner command is opaque to us)
    if (HAZARD_ASK_HEADS.has(head)) {
      // -c <command-string> form is the dangerous one. Also detect
      // powershell's -Command / -Expression long-form flags.
      const hasStringFlag = seg.words
        .slice(1)
        .some(
          (w) =>
            w === "-c" ||
            w === "/c" ||
            w === "-Command" ||
            w === "--command" ||
            w === "-Expression"
        );
      if (hasStringFlag) {
        return ask(
          "SHELL_INTERPRETER_STRING",
          `'${head} -c' evaluates an opaque command string; requires approval.`
        );
      }
      // Plain `bash`/`sh` invocation (interactive) — also ask, since it
      // escapes our analysis for whatever the user/LLM types inside.
      return ask(
        "SHELL_INTERPRETER",
        `'${head}' spawns an interactive shell that bypasses static analysis.`
      );
    }
    // NOTE: Fork-bomb detection moved to SHELL_DENYLIST_PATTERNS in
    // shellToolConfig — running it on per-segment raw text was broken
    // because compoundSplitter already split on |, &, and ;, so the
    // signature `NAME(){ NAME|NAME& }` never survived into a single
    // segment's raw field.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regex denylist + ask-list (tiered rules)
// ---------------------------------------------------------------------------

/**
 * Apply regex-based tiered rules. Deny rules win over ask rules, and both
 * win over the per-path validation that runs next.
 *
 * This is the legacy `SHELL_DENYLIST_PATTERNS` lifted into a tiered model
 * plus a new `SHELL_ASK_PATTERNS` for "dangerous but not blocked".
 */
export function tieredRegexRules(command: string): PermissionVerdict | null {
  for (const entry of SHELL_DENYLIST_PATTERNS) {
    if (entry.pattern.test(command)) {
      return deny("DENYLIST_MATCH", entry.description);
    }
  }
  for (const entry of SHELL_ASK_PATTERNS) {
    if (entry.pattern.test(command)) {
      return ask("ASK_PATTERN_MATCH", entry.description);
    }
  }
  return null;
}
