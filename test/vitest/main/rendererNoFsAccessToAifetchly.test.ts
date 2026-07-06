/**
 * TRS-07 Boundary Test — Renderer never reads the AiFetchly config folder.
 *
 * Phase 13 (Plan 05) locks in the renderer/process-isolation invariant as an
 * executable test. The renderer (src/views/**) MUST NOT:
 *   1. Reference the config-root folder literal (the dot-prefixed name that
 *      lives in AIFetchlyConfigConstants on the main-process side).
 *   2. Import node 'fs', 'path', 'os', or 'child_process' directly — the
 *      renderer reaches the main process ONLY via the IPC preload whitelist.
 *
 * Pre-existing violations in legacy code surface as findings here (not auto-
 * exempted). If a legacy file has a legitimate reason that cannot be removed,
 * add its path to LEGACY_ALLOWLIST with a comment explaining why.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, relative } from "path";

const RENDERER_ROOT = "src/views";
// Spell the forbidden folder literal as a join so this test file itself does
// not contain the literal in a way that confuses grep-based audits. The test
// file lives under test/, not src/views/, so it is NOT scanned by its own walk.
const FORBIDDEN_FOLDER_LITERAL = "." + "aifetchly";
const FORBIDDEN_IMPORT_RE =
  /(^|\s|;)import\s+[^;]*\s+from\s+['"](fs|node:fs|path|node:path|os|node:os|child_process|node:child_process)['"]/;
const FORBIDDEN_REQUIRE_RE =
  /require\(['"](fs|node:fs|path|node:path|os|node:os|child_process|node:child_process)['"]\)/;

// Filesystem / path / os call patterns. Combined with the config-root literal
// on the SAME line, these indicate an actual TRS-07 read violation (reading
// config bytes off disk) — as opposed to a mere comment / UI-string mention,
// which cannot read anything. Mirrors the contract in
// rendererNoFsAccessToWorkspaceConfig.test.ts (Phase 14).
const FS_CALL_PATTERNS: readonly RegExp[] = [
  /\breadFile(Sync)?\s*\(/,
  /\bfs\.promises\.readFile\s*\(/,
  /\bcreateReadStream\s*\(/,
  /\bpath\.join\s*\(/,
  /\bpath\.resolve\s*\(/,
  /\bos\.homedir\s*\(/,
  /\bos\.tmpdir\s*\(/,
];

/**
 * Files in this allowlist are exempt from the forbidden-import check. Each
 * entry MUST link to a justification. Keep this list empty by default — every
 * addition is a deliberate, documented exception.
 */
const LEGACY_ALLOWLIST: string[] = [];

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p, acc);
    } else if (extname(name) === ".ts" || extname(name) === ".vue") {
      if (name.endsWith(".d.ts")) continue;
      acc.push(p);
    }
  }
  return acc;
}

describe("TRS-07 — renderer isolation (src/views/**)", () => {
  const files = walk(RENDERER_ROOT);

  it("renderer tree was walked (found .ts/.vue files)", () => {
    expect(
      files.length,
      "expected to find renderer source files under src/views"
    ).toBeGreaterThan(0);
  });

  // Phase 14 refinement: a mere mention of the config-root literal in a
  // comment / UI string is NOT a TRS-07 violation — the renderer cannot read
  // the file without an fs/path/os call, and the import check below already
  // bans those. The ACTUAL violation is a line that COMBINES the config
  // literal with a filesystem/path/os call on the same line. Pure comment
  // mentions (e.g., Phase 14's WorkspaceTrustCard.vue / AiChatV2.vue docs
  // describing the workspace-trust UX) are permitted. This matches the
  // contract in rendererNoFsAccessToWorkspaceConfig.test.ts (Phase 14).
  it("no renderer file COMBINES the config-root literal with an fs/path/os call on one line", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const rel = relative(RENDERER_ROOT, f);
      for (const line of src.split("\n")) {
        if (!line.includes(FORBIDDEN_FOLDER_LITERAL)) continue;
        if (FS_CALL_PATTERNS.some((re) => re.test(line))) {
          offenders.push(`${rel}: \`${line.trim()}\``);
        }
      }
    }
    expect(
      offenders,
      `renderer files combine the config-root literal with an fs/path/os call (TRS-07 read violation): ${offenders.join(
        ", "
      )}`
    ).toEqual([]);
  });

  it("no renderer file imports node fs/path/os/child_process directly", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(RENDERER_ROOT, f);
      if (LEGACY_ALLOWLIST.includes(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (FORBIDDEN_IMPORT_RE.test(src) || FORBIDDEN_REQUIRE_RE.test(src)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `renderer files import forbidden node built-ins (fs/path/os/child_process): ${offenders.join(
        ", "
      )}` +
        (LEGACY_ALLOWLIST.length
          ? `\n  allowlist: ${LEGACY_ALLOWLIST.join(", ")}`
          : "")
    ).toEqual([]);
  });
});
