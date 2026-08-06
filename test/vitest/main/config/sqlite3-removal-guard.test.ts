import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Phase 1 guard (PRD FR-19 / FR-20).
 *
 * The separate `sqlite3` Node driver is unused: the active TypeORM driver is
 * `better-sqlite3` and `sqlite-vec` remains the vector extension. These tests
 * keep `sqlite3` / `@types/sqlite3` from creeping back into dependency
 * metadata, packaging config, the release workflow, or active source.
 *
 * Allowed occurrences are limited to this guard file and explicit migration
 * notes. `better-sqlite3` is the active driver and is not restricted here.
 */

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf-8");
}

interface SourceHit {
  file: string;
  line: number;
  text: string;
}

// Matches active (non-comment) sqlite3 driver usage. Better-sqlite3 is excluded
// by the negative lookbehind/lookahead on the package boundary.
const ACTIVE_SQLITE3_USAGE =
  /(?:from\s+['"]sqlite3['"])|(?:require\s*\(\s*['"]sqlite3['"]\s*\))|(?:type\s*:\s*['"]sqlite3['"])/;

/** Scan a directory recursively for active sqlite3 driver references. */
function scanActiveUsage(
  dir: string,
  ignore: ReadonlySet<string>
): SourceHit[] {
  const hits: SourceHit[] = [];
  if (!fs.existsSync(dir)) return hits;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      hits.push(...scanActiveUsage(fullPath, ignore));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
    const rel = path.relative(PROJECT_ROOT, fullPath);
    if (ignore.has(rel)) continue;
    const lines = fs.readFileSync(fullPath, "utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      ) {
        continue;
      }
      if (ACTIVE_SQLITE3_USAGE.test(lines[i])) {
        hits.push({ file: rel, line: i + 1, text: trimmed });
      }
    }
  }
  return hits;
}

describe("sqlite3 removal guard", () => {
  test("package.json does not declare sqlite3 or @types/sqlite3", () => {
    const pkg = JSON.parse(readText("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(allDeps).not.toHaveProperty("sqlite3");
    expect(allDeps).not.toHaveProperty("@types/sqlite3");
  });

  test("forge.config.js does not reference sqlite3 in ASAR unpack or rebuild modules", () => {
    const forge = readText("forge.config.js");
    expect(forge).not.toMatch(/node_modules\/sqlite3\b/);
    // The rebuild onlyModules list is the only place a bare "sqlite3" string
    // could reappear; ensure it is gone while better-sqlite3 remains. The value
    // may be a plain array or a conditional expression (CI skips the rebuild),
    // so capture the whole assignment up to the end of rebuildConfig rather than
    // assuming a literal array literal directly follows the key.
    const onlyModulesMatch = forge.match(/onlyModules:([\s\S]*?)\n\s*\},/);
    expect(onlyModulesMatch).not.toBeNull();
    const onlyModulesBlock = onlyModulesMatch![1];
    expect(onlyModulesBlock).not.toMatch(/["']sqlite3["']/);
    expect(onlyModulesBlock).toMatch(/["']better-sqlite3["']/);
  });

  test("release workflow does not rebuild or reference sqlite3", () => {
    const workflow = readText(".github/workflows/release.yml");
    expect(workflow).not.toMatch(/rebuild-sqlite3/);
    // No bare `sqlite3` package token anywhere; `better-sqlite3` stays allowed.
    expect(workflow).not.toMatch(/(?<![a-zA-Z0-9_-])sqlite3\b(?!-)/);
  });

  test("no active sqlite3 driver import/require/type usage exists in source", () => {
    const ignore = new Set<string>([
      path.normalize("test/vitest/main/config/sqlite3-removal-guard.test.ts"),
    ]);
    const srcHits = scanActiveUsage(path.join(PROJECT_ROOT, "src"), ignore);
    const testHits = scanActiveUsage(path.join(PROJECT_ROOT, "test"), ignore);
    const hits = [...srcHits, ...testHits];
    if (hits.length > 0) {
      throw new Error(
        "Active sqlite3 driver usage found:\n" +
          hits.map((h) => `  ${h.file}:${h.line} -> ${h.text}`).join("\n")
      );
    }
  });
});
