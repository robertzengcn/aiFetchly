/**
 * TRS-07 Boundary Test — Renderer never reads WORKSPACE CONFIG files directly.
 *
 * Extends Phase 13-05's `rendererNoFsAccessToAifetchly.test.ts` (which asserts
 * no renderer file references the dot-prefixed config-root folder literal and
 * no renderer imports node fs/path/os/child_process). This test adds the
 * workspace-config-specific invariant: NO line in src/views/** combines a
 * filesystem/path/os call with the workspace-config literals (".aifetchly" or
 * "AGENTS.md"). The combination is what would constitute an actual TRS-07
 * violation — the renderer reading workspace file bytes off disk instead of
 * going through the AIFETCHLY_WORKSPACE_TRUST_PREVIEW IPC channel.
 *
 * Workspace-config preview content reaches the renderer ONLY via the IPC
 * invoke channel (Plan 14-04's previewWorkspaceAgents). WorkspaceTrustCard.vue
 * references ".aifetchly" / "AGENTS.md" in COMMENTS only — never paired with
 * an fs/path/os call. This test FAILS if a future renderer module tries to
 * bypass the IPC boundary.
 *
 * The forbidden-token set is named (not inline) so worker source / source
 * comments beyond this test file do not carry the literal substrings in a
 * way that confuses grep audits.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname, relative } from "path";

const RENDERER_ROOT = "src/views";

// The TRS-07 workspace-config boundary token set. Spell the dot-prefixed
// literal as a join so THIS test file does not contain the literal in a way
// that would trip its own walk (it lives under test/, not src/views/, so it
// is not scanned — but defensive against future audits).
const WORKSPACE_CONFIG_TOKENS = ["." + "aifetchly", "AGENT" + "S.md"] as const;

// Filesystem / path / os call sites that, combined with a workspace-config
// token on the same line, indicate a TRS-07 violation. We deliberately keep
// this narrow — we want to catch actual disk reads, not casual mentions of
// `path`/`fs` in unrelated code. Match is per-LINE (case-sensitive).
const FS_CALL_PATTERNS: readonly RegExp[] = [
  // Direct readFile* APIs (sync + async + promises form)
  /\breadFileSync\s*\(/,
  /\breadFile\s*\(/,
  /\bfs\.promises\.readFile\s*\(/,
  /\bfs\/promises[\s\S]*?\.readFile\s*\(/,
  /\bcreateReadStream\s*\(/,
  // path.join / path.resolve constructing a workspace path
  /\bpath\.join\s*\(/,
  /\bpath\.resolve\s*\(/,
  // os.homedir / os.tmpdir as a workspace-root seed
  /\bos\.homedir\s*\(/,
  /\bos\.tmpdir\s*\(/,
  // require('fs') / require('node:fs') / dynamic import('fs')
  /\brequire\(\s*['"](fs|node:fs|fs\/promises|node:fs\/promises)['"]\s*\)/,
  /\bimport\(\s*['"](fs|node:fs|fs\/promises|node:fs\/promises)['"]\s*\)/,
];

/**
 * Allowlist for renderer files that have a legitimate, audited reason to
 * reference a workspace-config token alongside a path/fs API. Each entry
 * MUST link to a justification. Keep this empty by default.
 */
const LEGACY_ALLOWLIST: readonly string[] = [];

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

interface Offense {
  readonly file: string;
  readonly lineNo: number;
  readonly line: string;
  readonly token: string;
  readonly pattern: string;
}

function scanForOffenses(files: readonly string[]): Offense[] {
  const offenses: Offense[] = [];
  for (const f of files) {
    const rel = relative(RENDERER_ROOT, f);
    if (LEGACY_ALLOWLIST.includes(rel)) continue;
    const src = readFileSync(f, "utf8");
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Quick pre-filter: line must mention at least one workspace-config
      // token. This keeps the inner regex loop off lines that cannot offend.
      let tokenHit: string | null = null;
      for (const tok of WORKSPACE_CONFIG_TOKENS) {
        if (line.includes(tok)) {
          tokenHit = tok;
          break;
        }
      }
      if (tokenHit === null) continue;
      for (const re of FS_CALL_PATTERNS) {
        if (re.test(line)) {
          offenses.push({
            file: rel,
            lineNo: i + 1,
            line: line.trim(),
            token: tokenHit,
            pattern: re.source,
          });
          break; // one fs-call hit per line is enough to flag
        }
      }
    }
  }
  return offenses;
}

function formatOffenses(offenses: readonly Offense[]): string {
  return offenses
    .map(
      (o) =>
        `  - ${o.file}:${o.lineNo} (token=${o.token}, fs=${o.pattern})\n    ${o.line}`
    )
    .join("\n");
}

describe("TRS-07 — renderer never reads workspace config files directly (src/views/**)", () => {
  const files = walk(RENDERER_ROOT);

  it("renderer tree was walked (found .ts/.vue files)", () => {
    expect(
      files.length,
      "expected to find renderer source files under src/views"
    ).toBeGreaterThan(0);
  });

  it("no renderer line combines a workspace-config literal with an fs/path/os call", () => {
    const offenses = scanForOffenses(files);
    expect(
      offenses,
      `TRS-07 violation — renderer files read workspace config files directly ` +
        `(must route through AIFETCHLY_WORKSPACE_TRUST_PREVIEW IPC):\n${formatOffenses(
          offenses
        )}` +
        (LEGACY_ALLOWLIST.length
          ? `\n  allowlist: ${LEGACY_ALLOWLIST.join(", ")}`
          : "")
    ).toEqual([]);
  });

  it("WorkspaceTrustCard.vue (the only intentional workspace-config consumer in renderer) routes preview through IPC, not fs", () => {
    // Smoke-level positive assertion: the trust card exists and does NOT
    // read workspace files directly. It calls previewWorkspaceAgents() (IPC).
    const card = files.find((f) =>
      f.endsWith("components/aiChatV2/WorkspaceTrustCard.vue")
    );
    expect(
      card,
      "WorkspaceTrustCard.vue must exist under src/views/components/aiChatV2/"
    ).toBeDefined();
    const src = readFileSync(card as string, "utf8");
    const offenses = scanForOffenses([card as string]);
    expect(
      offenses,
      `WorkspaceTrustCard.vue must not read workspace files directly:\n${formatOffenses(
        offenses
      )}`
    ).toEqual([]);
    // Positive assertion: the card reaches preview content via the IPC API.
    expect(src).toContain("previewWorkspaceAgents");
  });
});
