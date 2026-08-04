/**
 * SKL-02 SC3 (Phase 18 / Plan 02 Task 3) — pluginPaths options.json
 * non-collision characterization test.
 *
 * PROVES the PRD §6.3 invariant: the user-home `~/.aifetchly/plugins/<name>/
 * options.json` path (the config-loader options root) and the app-data
 * `userData/plugins/installed/<pkg>` roots (the installed-plugin package roots
 * resolved by {@link getPluginsRoot}) are SEPARATE filesystem trees that cannot
 * collide by construction. This is filesystem-root separation — there is NO
 * code-level collision resolution, and none is needed (18-RESEARCH Pattern 4 /
 * Discretion Item 4).
 *
 * The mechanism this test locks in:
 *   - user-home root = `path.join(os.homedir(), ".aifetchly")` (config files)
 *   - app-data root  = `getPluginsRoot()` = `<userData>/plugins/installed`
 *     (installed packages). `<userData>` is Electron's `app.getPath('userData')`
 *     in production, and the `process.cwd()/.test-userData` fallback in tests —
 *     NEITHER is the user home, so the two roots are distinct on every platform.
 *
 * pluginPaths.ts is UNCHANGED by this task — this test only documents the
 * invariant. (The `plugin` source-badge i18n label `sourcePlugin` already
 * exists in all 6 lang files from Phase 13 CMD-05, so no lang-file change is
 * required either.)
 */
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  AIFETCHLY_CONFIG_DIR_NAME,
} from "@/service/aifetchlyConfig/AIFetchlyConfigConstants";
import {
  getPluginInstallRoot,
  getPluginOwnedSkillRoot,
  getPluginsRoot,
} from "@/service/pluginPaths";

/** True when `candidate` is inside `root` (root contains candidate) on disk. */
function isUnder(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

describe("pluginPaths options.json non-collision (SKL-02 SC3 / PRD §6.3)", () => {
  const userHomeAifetchly = path.join(os.homedir(), AIFETCHLY_CONFIG_DIR_NAME);

  it("getPluginsRoot resolves to <userData>/plugins/installed (the app-data root)", () => {
    const root = getPluginsRoot();
    // The app-data root always ends with plugins/installed (Design §8.1).
    expect(root.endsWith(path.join("plugins", "installed"))).toBe(true);
  });

  it("the installed-plugins root is NOT under the ~/.aifetchly user-home root", () => {
    const root = getPluginsRoot();
    expect(root.startsWith(userHomeAifetchly)).toBe(false);
    expect(isUnder(root, userHomeAifetchly)).toBe(false);
  });

  it("the two roots are distinct filesystem trees (neither contains the other)", () => {
    const root = getPluginsRoot();
    expect(root).not.toBe(userHomeAifetchly);
    // Neither direction shows containment.
    expect(isUnder(root, userHomeAifetchly)).toBe(false);
    expect(isUnder(userHomeAifetchly, root)).toBe(false);
  });

  it("a ~/.aifetchly/plugins/<name>/options.json path does NOT collide with getPluginsRoot", () => {
    const optionsPath = path.join(
      userHomeAifetchly,
      "plugins",
      "demo",
      "options.json"
    );
    const installedRoot = getPluginsRoot();
    // No prefix overlap: the user-home options path is not under the app-data
    // installed root, and vice versa.
    expect(optionsPath.startsWith(installedRoot)).toBe(false);
    expect(isUnder(optionsPath, installedRoot)).toBe(false);
  });

  it("pluginPaths exports NO function that resolves under ~/.aifetchly/plugins (module surface)", () => {
    // Every exported path helper resolves under the app-data root, never the
    // user-home config root. This is the structural guarantee that the two
    // trees cannot collide — there is no code path from pluginPaths into
    // ~/.aifetchly.
    const samples = [
      getPluginsRoot(),
      getPluginInstallRoot("demo"),
      getPluginOwnedSkillRoot("demo", "skill-a"),
    ];
    for (const resolved of samples) {
      expect(resolved.startsWith(userHomeAifetchly)).toBe(false);
      expect(isUnder(resolved, userHomeAifetchly)).toBe(false);
    }
    // And every sample sits UNDER the installed root (same app-data tree).
    const installedRoot = getPluginsRoot();
    for (const resolved of samples) {
      expect(isUnder(resolved, installedRoot) || resolved === installedRoot).toBe(true);
    }
  });
});
