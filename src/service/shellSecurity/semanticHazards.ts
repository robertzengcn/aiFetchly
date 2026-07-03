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

/** Subshell-style entry points that take a command string. */
const HAZARD_ASK_HEADS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "fish",
  "powershell",
  "pwsh",
  "env",
  "xargs",
  "timeout",
  "nohup",
  "stdbuf",
]);

export function semanticHazards(segments: readonly CommandSegment[]): PermissionVerdict | null {
  for (const seg of segments) {
    if (seg.empty) continue;
    const head = seg.words[0];
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
      // -c <command-string> form is the dangerous one
      if (seg.words.slice(1).some((w) => w === "-c" || w === "/c")) {
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

    // Fork bomb — naive but catches the canonical pattern `:(){ :|:& };:`
    // and the bashbomb variant.
    if (/:|\(\)\s*\{/.test(seg.raw) && seg.raw.includes(":|:")) {
      return deny("FORK_BOMB", "Fork bomb pattern detected.");
    }
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
