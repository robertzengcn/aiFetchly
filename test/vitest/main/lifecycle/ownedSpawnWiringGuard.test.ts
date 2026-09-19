/**
 * ownedSpawn Wiring Guard — prevent AC-05 spawn-gate regressions.
 *
 * Every process-launching call site in src/ (outside the lifecycle layer
 * itself) must consult the spawn gate (`ownedSpawnAllowed(`) in the same
 * function that launches, and registered sites must register the launched
 * process (`registerOwnedProcess(`). A deleted gate line otherwise passes
 * the entire suite — this test is what catches it.
 *
 * If this test fails, do NOT add an allowlist entry without a matching
 * exclusion row in docs/prd/application-exit-and-system-tray-inventory.md.
 * Wire the site through the gate (or ownedSpawn helper) instead.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve("src");

/** Collect .ts/.vue files under a directory (recursive). */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, out);
    } else if (/\.(ts|vue)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Launch expressions that create app-owned processes. Matches the transports
 * from the inventory: utilityProcess.fork, child_process spawn/execFile with
 * a variable command, and puppeteer launches (main-process side only).
 */
const LAUNCH_PATTERN =
  /utilityProcess\.fork\(|(^|[^.\w])spawn\(\s*[^"'"]|(^|[^.\w])execFile\(|puppeteer\.launch\(|puppeteer\.connect\(/;

/** Files excluded by the documented inventory (see the inventory doc). */
const EXCLUDED_FILES = [
  "src/main-process/lifecycle", // the lifecycle layer itself
  "src/childprocess", // worker-side entries (cannot gate from main)
  "src/utils/windowsOpenWith.ts", // OS launcher (inventory exclusion)
  "src/controller/searchProcessKill.ts", // kill helper, not a launcher
  "src/utils/packagedWorkerPath.ts", // path resolution only
  "src/modules/lib/function.ts", // awaited seconds-scale one-shots (inventory)
  "src/modules/lib/pipUtils.ts",
  "src/service/SystemDependencyInstaller.ts", // spawnSync probes
  "src/service/SkillEnvironmentManager.ts",
  "src/service/WorkspaceKeyService.ts",
  "src/service/PortableWorkspaceMemoryGitStatusService.ts",
  "src/controller/extramoduleController.ts",
  "src/service/ChunkingService.ts",
  "src/service/MCPToolService.ts", // one-shot helpers; servers are gated
  "src/modules/socialScraper.ts", // legacy utility paths (inventory)
  "src/modules/browserManager.ts", // worker-side puppeteer (inventory)
  "src/modules/browserManagerExample.ts",
  "src/service/ShellToolService.ts", // gated inside runShell (spawn hit is the taskkill helper)
  "src/background.ts", // E2E-only fixture hook (env-gated, quitting-gated)
  "src/service/ToolJobRegistry.ts", // `spawn` is an injected callback, not child_process
].map((p) => path.resolve(p));

function isExcluded(file: string): boolean {
  return EXCLUDED_FILES.some(
    (ex) => file === ex || file.startsWith(ex + path.sep)
  );
}

describe("ownedSpawn wiring guard (AC-05)", () => {
  it("every main-process launch site consults the spawn gate", () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC_ROOT)) {
      if (isExcluded(file)) continue;
      const rel = path.relative(process.cwd(), file);
      // Strip comment-only lines so commented-out spawn code cannot trip the scan.
      const source = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      if (!LAUNCH_PATTERN.test(source)) continue;
      // The file must reference the gate somewhere (per-function precision is
      // intentionally coarse — a false pass requires deleting ALL gates).
      if (
        !/ownedSpawnAllowed\(|assertSpawnAllowed\(|isSpawnAllowed\(|spawnOwned\(/.test(
          source
        )
      ) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      "Launch sites with no spawn gate (see application-exit-and-system-tray-inventory.md; fix by wiring the gate, not by allowlisting)"
    ).toEqual([]);
  });

  it("registered families: gate and register mention the same owner ids", () => {
    const mismatches: string[] = [];
    for (const file of collectFiles(SRC_ROOT)) {
      if (file.includes(path.join("main-process", "lifecycle"))) continue;
      const source = readFileSync(file, "utf8");
      const gated = [
        ...source.matchAll(/(?:ownedSpawnAllowed|spawnOwned)\("([^"]+)"\)/g),
      ].map(
        (m) => m[1]
      );
      const registered = [
        ...source.matchAll(/registerOwnedProcess\("([^"]+)",/g),
      ].map((m) => m[1]);
      if (registered.length === 0) continue;
      const ungated = registered.filter((owner) => !gated.includes(owner));
      if (ungated.length > 0) {
        mismatches.push(
          `${path.relative(process.cwd(), file)}: registered but never gated: ${ungated.join(", ")}`
        );
      }
    }
    expect(mismatches, "register-without-gate drift").toEqual([]);
  });
});
