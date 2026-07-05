/**
 * WorkerNoDbBoundary — WAT-02 grep gate.
 *
 * The worker under src/childprocess/aifetchly-config/ is sandboxed by
 * construction: child_process.fork() yields a pure-Node child that cannot
 * import the Electron main module or the ORM. This test is the file-content
 * backstop — it walks every .ts file under the worker dir and asserts NONE
 * matches the forbidden-import regex set. If a future change adds a stray
 * forbidden import, this test fails before the worker ships.
 *
 * This is the canonical WorkerNoDbBoundary forbidden-import set — referenced
 * by name from PLAN.md and worker source comments (do NOT inline the literal
 * patterns in worker source; describe by concept).
 *
 * The set covers:
 *   - import-from or require-of the Electron main module
 *   - import-from the ORM
 *   - import-from the @/modules business-logic tree
 *   - import-from the @/model DB-model tree
 *   - any direct repository/datasource/SqliteDb symbol
 *
 * Allowed under the worker dir: chokidar, stdlib (path/fs/crypto), and the
 * PURE helpers under @/service/aifetchlyConfig/* and @/service/workspaceWatch/*
 * (verified Phase 13-01 + Task 1/2 of this plan — no DB coupling).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname, relative } from "path";

const WORKER_ROOT = "src/childprocess/aifetchly-config";

/**
 * The canonical WorkerNoDbBoundary forbidden-import regex set.
 *
 * Names below are by concept (per Phase 13-03b lesson #429 / Rule 3) —
 * worker source comments reference "the WorkerNoDbBoundary forbidden-import
 * set" rather than inlining these patterns.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "electron-main-module-from", re: /from\s+["']electron(?:\/[^"']*)?["']/ },
  { name: "electron-main-module-require", re: /require\(\s*["']electron(?:\/[^"']*)?["']\s*\)/ },
  { name: "typeorm-from", re: /from\s+["']typeorm["']/ },
  { name: "typeorm-require", re: /require\(\s*["']typeorm["']\s*\)/ },
  { name: "modules-business-logic-from", re: /from\s+["']@\/modules\// },
  { name: "model-db-from", re: /from\s+["']@\/model\// },
  { name: "repository-direct-access", re: /\bgetRepository\s*\(/ },
  { name: "datasource-direct-access", re: /\bDataSource\b/ },
  { name: "sqlite-db-direct-access", re: /\bSqliteDb\b/ },
];

/** Walk the worker dir recursively for .ts files. Returns relative paths. */
function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const stat = statSync(p);
    if (stat.isDirectory()) {
      walk(p, acc);
    } else if (extname(p) === ".ts") {
      acc.push(p);
    }
  }
  return acc;
}

describe("WAT-02 worker sandbox — WorkerNoDbBoundary grep gate", () => {
  it("worker directory exists and contains at least one .ts file (positive gate)", () => {
    const files = walk(WORKER_ROOT);
    expect(
      files.length,
      `worker dir ${WORKER_ROOT} must exist and contain .ts files`
    ).toBeGreaterThan(0);
  });

  it("no worker file imports any forbidden module (WorkerNoDbBoundary forbidden-import set)", () => {
    const files = walk(WORKER_ROOT);
    expect(files.length, "worker dir must be non-empty").toBeGreaterThan(0);

    const violations: Array<{ file: string; name: string; line: string; lineNo: number }> = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, idx) => {
        for (const { name, re } of FORBIDDEN_PATTERNS) {
          // Skip comment lines (// or * or /*) — they describe the prohibition,
          // they don't constitute an actual import. Phase 13-03b lesson #429.
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
            continue;
          }
          if (re.test(line)) {
            violations.push({
              file: relative(process.cwd(), f),
              name,
              line,
              lineNo: idx + 1,
            });
          }
        }
      });
    }

    expect(
      violations,
      `forbidden imports detected:\n${violations
        .map((v) => `  ${v.file}:${v.lineNo} [${v.name}] ${v.line.trim()}`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("forbidden-import set is non-empty (sanity — the gate has teeth)", () => {
    expect(FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
  });
});
