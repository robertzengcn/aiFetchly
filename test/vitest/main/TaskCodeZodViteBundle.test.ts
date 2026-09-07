import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "taskCodeZodV4Entry.mjs"
);
const taskCodeViteConfigPath = path.resolve(
  process.cwd(),
  "vite.taskCode.config.mjs"
);
const sharedNoExternalPath = path.resolve(
  process.cwd(),
  "vite.workerSsrNoExternal.mjs"
);

/**
 * Regression for GitHub Actions build failure (run #257 and earlier):
 *   Unresolvable packaged runtime dependencies:
 *   - .../app.asar.unpacked/.vite/build/taskCode.js requires zod: package is
 *     not in app.asar.unpacked/node_modules (only inside app.asar).
 *
 * Commit 95df73de imported a Zod schema (authorizedEmailWorkerPayloadV2Schema
 * from zod/v4) into src/taskCode.ts. SSR Vite builds externalize node_modules
 * by default, so the packaged taskCode worker emitted a bare require("zod")
 * that cannot be resolved from app.asar.unpacked on Windows utilityProcess.
 * Like the other zod-using workers, vite.taskCode.config.mjs must list zod in
 * ssr.noExternal (via the shared ZOD_SSR_NO_EXTERNAL constant) so zod is
 * bundled into the worker.
 */
describe("taskCode zod Vite bundle packaging", () => {
  it("lists zod in ssr.noExternal in vite.taskCode.config.mjs", () => {
    const config = fs.readFileSync(taskCodeViteConfigPath, "utf-8");
    const shared = fs.readFileSync(sharedNoExternalPath, "utf-8");

    // The shared constant is the canonical zod list; reference it like the
    // other zod-consuming worker configs do.
    expect(config).toMatch(/noExternal:\s*\[\s*\.\.\.ZOD_SSR_NO_EXTERNAL/);
    expect(config).toMatch(
      /import\s*\{\s*ZOD_SSR_NO_EXTERNAL\s*\}\s*from\s*["']\.\/vite\.workerSsrNoExternal\.mjs["']/
    );
    expect(shared).toMatch(/ZOD_SSR_NO_EXTERNAL\s*=\s*\[["']zod["']\]/);
    // zod must never be marked external for the packaged worker.
    const externalMatch = config.match(
      /rollupOptions:\s*\{[\s\S]*?external:\s*\[([\s\S]*?)\]/
    );
    expect(externalMatch).not.toBeNull();
    expect(externalMatch?.[1]).not.toMatch(/["']zod["']/);
  });

  it("inlines zod/v4 when ssr.noExternal includes zod (no bare require)", async () => {
    const withZodBundled = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-taskcode-zod-bundled-",
      fileName: "taskcode-zod-bundled.cjs",
      ssrNoExternal: ["zod"],
      skipRun: true,
      minify: false,
    });
    expect(withZodBundled.code).not.toMatch(
      /require\(\s*["']zod(?:\/v4)?["']\s*\)/
    );
    expect(withZodBundled.code).toMatch(/node_modules\/zod\//);

    // Counter-proof: without noExternal, an externalized zod/v4 import emits
    // the exact bare require that fails from app.asar.unpacked. (Rollup
    // external strings are exact-match, so spell out the subpath specifier
    // Vite's SSR externalizer produced in the failing CI bundle.)
    const withZodExternal = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-taskcode-zod-external-",
      fileName: "taskcode-zod-external.cjs",
      external: ["zod", "zod/v4"],
      skipRun: true,
      minify: false,
    });
    expect(withZodExternal.code).toMatch(
      /require\(\s*["']zod(?:\/v4)?["']\s*\)/
    );
  });
});
