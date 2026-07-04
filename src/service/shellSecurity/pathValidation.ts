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
import { containsExpansion } from "./ShellLexer";

// ---------------------------------------------------------------------------
// Command classification
// ---------------------------------------------------------------------------

export type PathOpKind = "read" | "create" | "write" | "none";

interface CommandProfile {
  readonly kind: PathOpKind;
  /** Minimum index where path args start (usually 1). */
  readonly pathStart: number;
}

const PROFILES: Record<string, CommandProfile> = {
  // Reads
  cat: { kind: "read", pathStart: 1 },
  less: { kind: "read", pathStart: 1 },
  more: { kind: "read", pathStart: 1 },
  head: { kind: "read", pathStart: 1 },
  tail: { kind: "read", pathStart: 1 },
  grep: { kind: "read", pathStart: 2 },
  rg: { kind: "read", pathStart: 2 },
  ack: { kind: "read", pathStart: 2 },
  wc: { kind: "read", pathStart: 1 },
  stat: { kind: "read", pathStart: 1 },
  ls: { kind: "read", pathStart: 1 },
  du: { kind: "read", pathStart: 1 },
  df: { kind: "read", pathStart: 1 },
  file: { kind: "read", pathStart: 1 },
  diff: { kind: "read", pathStart: 1 },
  md5sum: { kind: "read", pathStart: 1 },
  sha256sum: { kind: "read", pathStart: 1 },

  // Creates
  touch: { kind: "create", pathStart: 1 },
  mkdir: { kind: "create", pathStart: 1 },

  // Writes / destructive
  rm: { kind: "write", pathStart: 1 },
  rmdir: { kind: "write", pathStart: 1 },
  mv: { kind: "write", pathStart: 1 },
  cp: { kind: "write", pathStart: 1 },
  install: { kind: "write", pathStart: 1 },
  chmod: { kind: "write", pathStart: 1 },
  chown: { kind: "write", pathStart: 1 },
  chgrp: { kind: "write", pathStart: 1 },
  ln: { kind: "write", pathStart: 1 },
  truncate: { kind: "write", pathStart: 1 },
  tee: { kind: "write", pathStart: 1 },
  shred: { kind: "write", pathStart: 1 },
  unlink: { kind: "write", pathStart: 1 },
  // Archivers — extraction can overwrite arbitrary files via path traversal
  tar: { kind: "write", pathStart: 1 },
  cpio: { kind: "write", pathStart: 1 },
  unzip: { kind: "write", pathStart: 1 },
  zip: { kind: "write", pathStart: 1 },
  "7z": { kind: "write", pathStart: 1 },
  gzip: { kind: "write", pathStart: 1 },
  gunzip: { kind: "write", pathStart: 1 },
  bzip2: { kind: "write", pathStart: 1 },
  xz: { kind: "write", pathStart: 1 },

  // Editors / in-place mutations
  sed: { kind: "write", pathStart: 1 },
  awk: { kind: "write", pathStart: 1 },
  perl: { kind: "write", pathStart: 1 },
};

/**
 * `find` is special: it is nominally a read but has destructive side-effect
 * flags. Any of these flags triggers a deny regardless of path.
 */
const FIND_DESTRUCTIVE_FLAGS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
]);

/**
 * Commands too dangerous to ever auto-approve; always require approval even
 * when their arguments look benign. `dd` is the canonical example.
 */
const ALWAYS_ASK_HEADS = new Set(["dd", "shred", "mkfs", "fdisk", "parted"]);

/**
 * Normalize a command head: strip a leading backslash so that `\rm`
 * (alias-bypass form) classifies the same as `rm`.
 */
function normalizeHead(rawHead: string): string {
  if (rawHead.startsWith("\\")) return rawHead.slice(1);
  return rawHead;
}

function classify(head: string): CommandProfile | null {
  const normalized = normalizeHead(head);
  if (PROFILES[normalized]) return PROFILES[normalized];
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
function extractPathArgs(
  words: readonly string[],
  profile: CommandProfile
): readonly string[] {
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

  // For both 'all' and 'tail' profiles we validate every positional — for
  // grep/rg the pattern is usually harmless to also validate (worst case is
  // a false positive FilePathGuard deny, which is the safer failure mode).
  return paths;
}

// Pre-resolved SHELL_CRITICAL_PATHS at module load — avoids re-running
// path.resolve() per call in isCriticalPath (hot path: once per path arg).
const RESOLVED_CRITICAL_PATHS: readonly string[] = SHELL_CRITICAL_PATHS.map(
  (p) => path.resolve(p)
);

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
  // Caller already passes a resolved path; just compare against the
  // pre-resolved constant list.
  for (const critical of RESOLVED_CRITICAL_PATHS) {
    if (resolved === critical || resolved.startsWith(critical + path.sep)) {
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
    const head = normalizeHead(seg.words[0] ?? "");
    if (!head) continue;

    // Validate redirects first — they apply to every command, classified or not
    for (const redirect of seg.redirects) {
      const v = validateRedirect(redirect, guard);
      if (v) return v;
    }

    // `find` with destructive flags — deny regardless of which paths are used.
    // Runs before path classification because `find` is profiled as 'read'
    // and we don't want the destructive flags to be skipped as flags.
    if (head === "find") {
      const hit = seg.words.find((w) => FIND_DESTRUCTIVE_FLAGS.has(w));
      if (hit) {
        return deny(
          "FIND_DESTRUCTIVE",
          `'find' with '${hit}' deletes files or executes arbitrary commands.`
        );
      }
    }

    // If this head is an always-ask destructive command (dd, mkfs...), ask.
    // NOTE: this runs AFTER path validation below for non-classified heads.
    // For commands without a profile (dd, mkfs...), we ask immediately.
    // For commands WITH a profile that are also in ALWAYS_ASK (shred), we
    // let path validation run first so outside-workspace denies win.

    const profile = classify(head);
    if (!profile) {
      // Unclassified head — check ALWAYS_ASK before falling through.
      if (ALWAYS_ASK_HEADS.has(head)) {
        return ask(
          "DESTRUCTIVE_COMMAND",
          `'${head}' is a high-risk operation; requires approval.`
        );
      }
      continue;
    }

    const paths = extractPathArgs(seg.words, profile);

    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi];
      // Skip stdin/stdout markers
      if (
        p === "-" ||
        p === "/dev/stdin" ||
        p === "/dev/stdout" ||
        p === "/dev/stderr"
      ) {
        continue;
      }

      // Reject non-literal path args for write/create ops — the final path
      // is unknowable at runtime (e.g. `rm $EVIL`). Reads of $VAR are
      // suspicious too but not destructive, so they fall to `ask`.
      //
      // Detection uses the lexer's PLACEHOLDERS via containsExpansion() —
      // single source of truth for "is this text an expansion placeholder".
      const isNonLiteral = seg.hasNonLiteral && containsExpansion(p);
      if (isNonLiteral) {
        return profile.kind === "write" || profile.kind === "create"
          ? deny(
              "PATH_NON_LITERAL",
              `'${head}' target '${p}' contains shell expansion; the actual ` +
                "path cannot be statically verified."
            )
          : ask(
              "READ_NON_LITERAL",
              `'${head}' reads '${p}' which contains shell expansion; the ` +
                "actual path cannot be statically verified."
            );
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

      // Critical-path protection: write/create against critical paths always denies
      if (
        (head === "rm" ||
          head === "rmdir" ||
          profile.kind === "write" ||
          profile.kind === "create") &&
        isCriticalPath(result.resolvedPath)
      ) {
        return deny(
          "CRITICAL_PATH",
          `'${head}' targets a critical path ('${p}'). ` +
            "This operation is blocked even if an allow rule exists."
        );
      }

      // Critical-path protection: rm/rmdir against a workspace ROOT itself
      // (would delete the entire workspace).
      if (
        (head === "rm" || head === "rmdir") &&
        roots.some((r) => result.resolvedPath === r)
      ) {
        return deny(
          "WORKSPACE_ROOT_DELETE",
          `'${head}' on a workspace root ('${p}') is blocked.`
        );
      }
    }

    // All paths validated clean. If this is an always-ask head with a profile
    // (e.g. shred), ask before allowing. Runs AFTER path validation so that
    // outside-workspace denies take precedence over the always-ask signal.
    if (ALWAYS_ASK_HEADS.has(head)) {
      return ask(
        "DESTRUCTIVE_COMMAND",
        `'${head}' is a high-risk operation; requires approval.`
      );
    }
  }
  return null;
}
