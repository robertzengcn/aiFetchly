/**
 * PackagedWorkerEnvGuard — prevent Windows packaged MODULE_NOT_FOUND regressions.
 *
 * Unpacked workers under app.asar.unpacked cannot resolve bare requires for deps
 * that only live in app.asar/node_modules unless NODE_PATH is set. Every live
 * `utilityProcess.fork` / `spawn(process.execPath, ...)` call site in src/ must
 * use `buildPackagedWorkerEnv` from `@/utils/packagedWorkerPath`.
 *
 * If this test fails, do NOT add an allowlist entry. Wire the spawn through
 * `buildPackagedWorkerEnv({ runAsNode?, extraEnv? })` instead.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative } from "path";

const SRC_ROOT = "src";

/** Production files that may reference the spawn APIs without the helper. */
const ALLOWLIST = new Set<string>([
  // The helper module itself only defines env builders — no spawn/fork.
  "src/utils/packagedWorkerPath.ts",
]);

const FORK_OR_SPAWN =
  /\butilityProcess\.fork\s*\(|\bspawn\s*\(\s*process\.execPath\s*,/;
const HELPER = /\bbuildPackagedWorkerEnv\b/;

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) {
    return acc;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") {
        continue;
      }
      walkTsFiles(full, acc);
    } else if (extname(full) === ".ts") {
      acc.push(full);
    }
  }
  return acc;
}

/** Remove line and block comments so commented-out historical forks are ignored. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{}()])\/\/.*$/gm, "$1");
}

describe("PackagedWorkerEnvGuard", () => {
  it("every live utilityProcess.fork / spawn(process.execPath) uses buildPackagedWorkerEnv", () => {
    const files = walkTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) {
        continue;
      }

      const raw = readFileSync(file, "utf8");
      const source = stripComments(raw);
      if (!FORK_OR_SPAWN.test(source)) {
        continue;
      }
      if (!HELPER.test(source)) {
        violations.push(rel);
      }
    }

    expect(
      violations,
      "These files spawn/fork a packaged worker without buildPackagedWorkerEnv:\n" +
        violations.map((v) => `  - ${v}`).join("\n") +
        "\nUse buildPackagedWorkerEnv() for env (see src/utils/packagedWorkerPath.ts)."
    ).toEqual([]);
  });

  it("ALLOWLIST stays tiny (do not paper over new spawn sites)", () => {
    expect(ALLOWLIST.size).toBeLessThanOrEqual(1);
  });
});
