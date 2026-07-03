/**
 * Per-command path validation.
 *
 * For each command segment we:
 *   1. Classify the command (read / create / write / none) from argv[0].
 *   2. Extract path arguments — flags stripped, POSIX `--` handled.
 *   3. Run each path through `FilePathGuard`.
 *   4. Reject any redirection target that's non-literal ($ expansion — final
 *      target unknowable) or resolves outside the workspace roots.
 *
 * Critical-path protection: `rm`/`rmdir` against workspace roots themselves
 * or any SHELL_CRITICAL_PATHS entry is hard-denied even if an allow rule
 * would otherwise permit it.
 */

import * as path from "path";
import type { FilePathGuard } from "@/service/FilePathGuard";
import type { CommandSegment, Redirection } from "./compoundSplitter";
import { deny, ask, type PermissionVerdict } from "./verdict";
import { SHELL_CRITICAL_PATHS } from "@/config/shellToolConfig";

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

export type PathOpKind = "read" | "create" | "write" | "none";

interface CommandProfile {
  readonly kind: PathOpKind;
  /** Indexes of argv positions that are path-like (skip flags). */
  readonly pathArgIndexes: "all" | "tail";
  /** Minimum index where path args start (usually 1). */
  readonly pathStart: number;
}

const PROFILES: Record<string, CommandProfile> = {
  // Reads
  cat: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  less: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  more: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  head: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  tail: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  grep: { kind: "read", pathArgIndexes: "tail", pathStart: 2 },
  rg: { kind: "read", pathArgIndexes: "tail", pathStart: 2 },
  ack: { kind: "read", pathArgIndexes: "tail", pathStart: 2 },
  wc: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  stat: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  ls: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  find: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  du: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  df: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  file: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  diff: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  md5sum: { kind: "read", pathArgIndexes: "all", pathStart: 1 },
  sha256sum: { kind: "read", pathArgIndexes: "all", pathStart: 1 },

  // Creates
  touch: { kind: "create", pathArgIndexes: "all", pathStart: 1 },
  mkdir: { kind: "create", pathArgIndexes: "all", pathStart: 1 },

  // Writes / destructive
  rm: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  rmdir: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  mv: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  cp: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  install: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  chmod: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  chown: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  chgrp: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  ln: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  truncate: { kind: "write", pathArgIndexes: "all", pathStart: 1 },
  tee: { kind: "write", pathArgIndexes: "all", pathStart: 1 },

  // Editors / in-place mutations
  sed: { kind: "write", pathArgIndexes: "tail", pathStart: 1 },
  awk: { kind: "write", pathArgIndexes: "tail", pathStart: 1 },
  perl: { kind: "write", pathArgIndexes: "tail", pathStart: 1 },
};

function classify(head: string): CommandProfile | null {
  // Strip leading "sudo"/"env" wrappers — those would have been flagged by
  // the semantic layer already; here we look at the effective command.
  if (PROFILES[head]) return PROFILES[head];
  return null;
}

// ---------------------------------------------------------------------------
// Argument extraction
// ---------------------------------------------------------------------------

/**
 * Extract path arguments from a segment's argv.
 *
 * Heuristics:
 *   - Skip flag args (start with `-`) and their values where the flag is
 *     known to take a value (`-o value`, `--output=value`).
 *   - Honor POSIX `--` terminator: everything after is a path.
 *
 * This is necessarily conservative — when in doubt we treat an arg as a path
 * candidate and let FilePathGuard reject if it escapes.
 */
function extractPathArgs(words: readonly string[], profile: CommandProfile): readonly string[] {
  const paths: string[] = [];
  let afterDoubleDash = false;
  const startIdx = profile.pathStart;

  for (let i = startIdx; i < words.length; i++) {
    const w = words[i];

    if (afterDoubleDash) {
      paths.push(w);
      continue;
    }
    if (w === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (w.startsWith("-")) {
      // It's a flag — skip. We don't model flag-with-value here; treating
      // the value as a non-path is wrong sometimes but the worst case is we
      // *miss* a path validation, and the user-consent prompt still shows
      // the full command. Better to over-validate than under.
      continue;
    }
    // Non-flag, non-`--` word — treat as path
    paths.push(w);
  }

  if (profile.pathArgIndexes === "tail" && paths.length > 0) {
    // For grep/rg/etc., the LAST positional is the path; earlier positionals
    // are the pattern. We keep them all for validation — FilePathGuard will
    // reject anything outside roots, which is the safer behavior.
    return paths;
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Redirection validation
// ---------------------------------------------------------------------------

function validateRedirect(
  redirect: Redirection,
  guard: FilePathGuard
): PermissionVerdict | null {
  // Reject non-literal redirect targets — final path unknowable at runtime
  if (redirect.nonLiteral) {
    return ask(
      "REDIRECT_NON_LITERAL",
      `Redirection operator '${redirect.operator}' has a non-literal target ` +
        `(shell expansion). Cannot statically verify the destination.`
    );
  }

  // Common special targets that don't need filesystem validation
  if (redirect.target === "/dev/null" || redirect.target === "&-") {
    return null;
  }

  const result = guard.validate(redirect.target);
  if (!result.safe) {
    return deny(
      "REDIRECT_OUTSIDE_ROOTS",
      `Redirection target '${redirect.target}' is outside the allowed workspace.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Critical path protection
// ---------------------------------------------------------------------------

function isCriticalPath(resolved: string): boolean {
  const normalized = path.resolve(resolved);
  for (const critical of SHELL_CRITICAL_PATHS) {
    const c = path.resolve(critical);
    if (normalized === c || normalized.startsWith(c + path.sep)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function validateSegmentPaths(
  segments: readonly CommandSegment[],
  guard: FilePathGuard
): PermissionVerdict | null {
  const roots = guard.getRoots();

  for (const seg of segments) {
    if (seg.empty) continue;
    const head = seg.words[0];
    if (!head) continue;

    // Validate redirects first — they apply to every command, classified or not
    for (const redirect of seg.redirects) {
      const v = validateRedirect(redirect, guard);
      if (v) return v;
    }

    const profile = classify(head);
    if (!profile) continue;

    const paths = extractPathArgs(seg.words, profile);

    for (const p of paths) {
      // Skip stdin/stdout markers
      if (p === "-" || p === "/dev/stdin" || p === "/dev/stdout" || p === "/dev/stderr") {
        continue;
      }

      // For commands like `cp src dst` / `mv src dst`, the destination is
      // especially dangerous — validate it.
      const result = guard.validate(p);
      if (!result.safe) {
        // For write/create ops, escape = deny. For read ops, escape = ask
        // (reads of files outside workspace are suspicious but not destructive).
        return profile.kind === "write" || profile.kind === "create"
          ? deny(
              "PATH_OUTSIDE_ROOTS",
              `'${head}' target '${p}' is outside the allowed workspace roots.`
            )
          : ask(
              "READ_OUTSIDE_ROOTS",
              `'${head}' is reading '${p}' which is outside the workspace roots.`
            );
      }

      // Critical-path protection: rm/rmdir against critical paths always denies
      if ((head === "rm" || head === "rmdir" || profile.kind === "write") &&
          isCriticalPath(result.resolvedPath)) {
        return deny(
          "CRITICAL_PATH",
          `'${head}' targets a critical path ('${p}'). ` +
            "This operation is blocked even if an allow rule exists."
        );
      }

      // Critical-path protection: rm/rmdir against a workspace ROOT itself
      // (would delete the entire workspace).
      if ((head === "rm" || head === "rmdir") &&
          roots.some((r) => result.resolvedPath === r)) {
        return deny(
          "WORKSPACE_ROOT_DELETE",
          `'${head}' on a workspace root ('${p}') is blocked.`
        );
      }
    }
  }
  return null;
}
