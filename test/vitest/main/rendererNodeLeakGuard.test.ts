import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

/**
 * Vite 8 only exposes types via package "exports", which need
 * moduleResolution node16/nodenext/bundler. This project's tsconfig uses
 * "moduleResolution: node", so a static `import { build } from "vite"` fails
 * `tsc --noEmit` (and the vitest tsc gate). Load via createRequire with a
 * narrow local type — same pattern as CloneDeepViteBundle.test.ts.
 */
interface ViteBuildFn {
  (inlineConfig: Record<string, unknown>): Promise<unknown>;
}
const require = createRequire(import.meta.url);
const { build } = require("vite") as {
  build: ViteBuildFn;
};

const projectRoot = process.cwd();
const renderConfigPath = path.join(projectRoot, "vite.render.config.mjs");

/**
 * Regression for the recurring renderer crash:
 *   ERR_ABORTED (-3) loading http://localhost:5173/
 *   ... Cannot access "node:module.createRequire" in client code
 *   at Logger.ts:1:23
 *
 * Cause: a renderer module transitively imported @/modules/Logger, which
 * top-level imports `createRequire` from `node:module`. Vite externalizes
 * `node:module` for the browser, so evaluating the chunk threw and the page
 * aborted on launch.
 *
 * This test exercises the rendererNodeGuard Vite plugin (wired into
 * vite.render.config.mjs) to guarantee the renderer module graph never
 * bundles a Node-only / main-process-only module.
 */

// ---- unit-level: the guard's pure denylist + classification helpers ----

describe("rendererNodeGuard - denylist classification", () => {
  it("flags the exact node:module import that crashed the renderer", async () => {
    const { RENDERER_NODE_GUARD_DENYLIST, isDeniedSpecifier } =
      await loadGuardModule();
    expect(RENDERER_NODE_GUARD_DENYLIST).toContain("node:module");
    expect(isDeniedSpecifier("node:module")).toBe(true);
    expect(isDeniedSpecifier("@/modules/Logger")).toBe(true);
    expect(isDeniedSpecifier("electron-log/main")).toBe(true);
    // A normal renderer-safe module is not denied.
    expect(isDeniedSpecifier("@/service/AIChatErrorSentinels")).toBe(false);
  });

  it("treats bare node builtins (fs, path, crypto) as denied", async () => {
    const { isDeniedSpecifier } = await loadGuardModule();
    expect(isDeniedSpecifier("fs")).toBe(true);
    expect(isDeniedSpecifier("path")).toBe(true);
    expect(isDeniedSpecifier("crypto")).toBe(true);
    expect(isDeniedSpecifier("child_process")).toBe(true);
  });
});

// ---- integration-level: the plugin actually runs against a Vite build ----

describe("rendererNodeGuard plugin - Vite build integration", () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    // Ensure the guard is ACTIVE for these tests even if the host set the
    // bypass env for a tight inner loop.
    prevEnv = process.env.AIFETCHLY_DISABLE_RENDERER_NODE_GUARD;
    delete process.env.AIFETCHLY_DISABLE_RENDERER_NODE_GUARD;
  });

  afterEach(() => {
    if (prevEnv !== undefined) {
      process.env.AIFETCHLY_DISABLE_RENDERER_NODE_GUARD = prevEnv;
    } else {
      delete process.env.AIFETCHLY_DISABLE_RENDERER_NODE_GUARD;
    }
  });

  it("vite.render.config.mjs wires the guard into the plugin list", async () => {
    // Regression for the wiring itself: if someone removes the plugin from
    // the render config, the dev server and CI build lose the guard.
    const renderConfig = (await import(renderConfigPath)) as {
      default?: Record<string, unknown>;
    };
    const baseConfig = (renderConfig.default ?? renderConfig) as Record<
      string,
      unknown
    >;
    const plugins = (baseConfig.plugins as unknown[] | undefined) ?? [];
    const hasGuard = plugins.some(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as { name?: string }).name === "renderer-node-guard"
    );
    expect(hasGuard).toBe(true);
  });

  it("rejects a renderer fixture that imports @/modules/Logger", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "renderer-guard-leak-")
    );
    const entryPath = path.join(tempRoot, "entry.ts");
    try {
      // Fixture: a renderer-style entry that pulls in the Node-bearing Logger.
      // @/modules/Logger resolves via the render config's "@" alias.
      fs.writeFileSync(
        entryPath,
        `import { log } from "@/modules/Logger";\n` +
          `export const speak = (): void => { log.info("hi"); };\n`
      );

      await expect(
        buildRendererFixture(entryPath, tempRoot)
      ).rejects.toThrowError(/node:module|@\/modules\/Logger|renderer/i);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not flag a clean renderer-safe module (AIChatErrorSentinels)", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "renderer-guard-clean-")
    );
    const entryPath = path.join(tempRoot, "entry.ts");
    try {
      // The pure, Node-free sentinel module must build without the guard
      // throwing — this is the escape hatch we created when fixing the leak.
      fs.writeFileSync(
        entryPath,
        `import { AUTH_EXPIRED_SENTINEL } from "@/service/AIChatErrorSentinels";\n` +
          `export const s = AUTH_EXPIRED_SENTINEL;\n`
      );

      await expect(
        buildRendererFixture(entryPath, tempRoot)
      ).resolves.toBeDefined();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

/**
 * Build a renderer-style entry under a temp dir, using the real render config
 * (aliases + vue/vuetify plugins) with the rendererNodeGuard plugin explicitly
 * injected. Pointed at the temp entry via an inline `build.lib` so we don't
 * need index.html. `write: false` keeps it in-memory and fast.
 *
 * The guard is injected directly (rather than relying on the render config to
 * wire it) so this test exercises the PLUGIN in isolation. A separate test
 * asserts the render config wires the plugin.
 */
async function buildRendererFixture(
  entryPath: string,
  tempOutDir: string
): Promise<unknown> {
  // Load the render config the way Vite would. It is a plain
  // `defineConfig({...})` (not a fn), so importing it yields the object.
  const renderConfig = (await import(renderConfigPath)) as {
    default?: Record<string, unknown>;
  };
  const baseConfig = (renderConfig.default ?? renderConfig) as Record<
    string,
    unknown
  >;

  // Load the guard plugin factory and inject it into the plugin list.
  const guardMod = (await import(
    path.join(projectRoot, "vite-plugin-renderer-node-guard.ts")
  )) as { default: () => unknown };
  const guardPlugin = guardMod.default();

  const basePlugins = (baseConfig.plugins as unknown[] | undefined) ?? [];
  return build({
    ...baseConfig,
    configFile: false,
    logLevel: "error",
    root: projectRoot,
    plugins: [...basePlugins, guardPlugin],
    build: {
      ...(baseConfig.build as Record<string, unknown> | undefined),
      lib: {
        entry: entryPath,
        formats: ["es"],
        fileName: () => "fixture.js",
      },
      outDir: tempOutDir,
      emptyOutDir: true,
      write: false,
      minify: false,
    },
  });
}

/**
 * Load the guard plugin module (ESM) to access its exported pure helpers.
 * Uses a dynamic import so the test stays decoupled from the plugin's
 * internal file structure.
 */
async function loadGuardModule(): Promise<{
  RENDERER_NODE_GUARD_DENYLIST: readonly string[];
  isDeniedSpecifier: (specifier: string) => boolean;
}> {
  const guardPath = path.join(
    projectRoot,
    "vite-plugin-renderer-node-guard.ts"
  );
  const mod = (await import(guardPath)) as {
    RENDERER_NODE_GUARD_DENYLIST?: readonly string[];
    isDeniedSpecifier?: (specifier: string) => boolean;
  };
  if (!mod.RENDERER_NODE_GUARD_DENYLIST || !mod.isDeniedSpecifier) {
    throw new Error(
      "guard plugin must export RENDERER_NODE_GUARD_DENYLIST and isDeniedSpecifier for testing"
    );
  }
  return {
    RENDERER_NODE_GUARD_DENYLIST: mod.RENDERER_NODE_GUARD_DENYLIST,
    isDeniedSpecifier: mod.isDeniedSpecifier,
  };
}
