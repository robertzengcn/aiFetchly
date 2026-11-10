import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAndRunViteCjsBundle } from "./helpers/viteCjsBundle";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntryPath = path.join(
  testDir,
  "fixtures",
  "workspaceConfigJsYamlEntry.mjs"
);
const configPath = path.resolve(
  process.cwd(),
  "vite.aifetchlyConfigWorker.config.mjs"
);
const sharedPath = path.resolve(process.cwd(), "vite.workerSsrNoExternal.mjs");

/**
 * Regression: the WorkspaceConfigWatchWorker bundle emitted
 *   require("js-yaml")
 * (PortableMemoryFileScanner parses portable-memory frontmatter with js-yaml).
 * js-yaml is not in forge.config.js EXTERNAL_DEPENDENCIES, so electron-forge's
 * keep-list dropped it from the package and packageAfterPrune failed with:
 *
 *   Error: Packaged app is missing runtime dependencies required by generated
 *   bundles: WorkspaceConfigWatchWorker.js: js-yaml.
 *
 * That aborted `Finalizing package` on every OS. The worker runs from
 * app.asar.unpacked, where NODE_PATH→asar resolution is unreliable, so js-yaml
 * must be force-bundled via ssr.noExternal (same contract as zod). CI does not
 * pre-build the worker before testmain, so this suite locks the config contract
 * and rebuilds a minimal js-yaml import with the same noExternal setting.
 */
describe("WorkspaceConfigWatchWorker js-yaml Vite bundle packaging", () => {
  it("lists js-yaml in ssr.noExternal via JS_YAML_SSR_NO_EXTERNAL", () => {
    const config = fs.readFileSync(configPath, "utf-8");
    const shared = fs.readFileSync(sharedPath, "utf-8");
    expect(config).toMatch(
      /noExternal:\s*\[[\s\S]*JS_YAML_SSR_NO_EXTERNAL[\s\S]*\]/
    );
    expect(shared).toMatch(/JS_YAML_SSR_NO_EXTERNAL\s*=\s*\[["']js-yaml["']\]/);
    const externalMatch = config.match(
      /rollupOptions:\s*\{[\s\S]*?external:\s*\[([\s\S]*?)\]/
    );
    expect(externalMatch).not.toBeNull();
    expect(externalMatch?.[1]).not.toMatch(/["']js-yaml["']/);
  });

  it("inlines js-yaml when ssr.noExternal includes js-yaml (no bare require)", async () => {
    const withJsYamlBundled = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-workspace-config-js-yaml-bundled-",
      fileName: "workspace-config-js-yaml-bundled.cjs",
      ssrNoExternal: ["js-yaml"],
      minify: false,
    });
    expect(withJsYamlBundled.code).not.toMatch(
      /require\(\s*["']js-yaml["']\s*\)/
    );
    expect(withJsYamlBundled.code).toMatch(/node_modules\/js-yaml\//);
    expect(withJsYamlBundled.run?.status).toBe(0);
    expect(withJsYamlBundled.combinedOutput).toContain(
      "workspace-config-js-yaml-ok"
    );

    const withJsYamlExternal = await buildAndRunViteCjsBundle({
      entryPath: fixtureEntryPath,
      tempPrefix: "aifetchly-workspace-config-js-yaml-external-",
      fileName: "workspace-config-js-yaml-external.cjs",
      external: ["js-yaml"],
      skipRun: true,
      minify: false,
    });
    expect(withJsYamlExternal.code).toMatch(/require\(\s*["']js-yaml["']\s*\)/);
  });
});
