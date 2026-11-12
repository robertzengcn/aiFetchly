"use strict";
/**
 * Patches Electron Forge internals for memory-safe CI packaging:
 *
 * 1. `@electron-forge/core-utils/dist/remote-rebuild.js`:
 *    Short-circuits to a no-op when `FORGE_SKIP_NATIVE_REBUILD=1` is set so
 *    `@electron/rebuild`'s `ModuleWalker` does not walk the full dependency
 *    graph when native modules were already rebuilt before packaging.
 *
 * 2. `@electron-forge/plugin-vite/dist/VitePlugin.js`:
 *    - Serializes the outer `prePackage` Listr (`Building main and preload
 *      targets...` then `Building renderer targets...`, `{ concurrent: false }`
 *      instead of hardcoded `{ concurrent: true }`) so `src/background` and
 *      `main_window` never run concurrently even when `concurrent: 1`.
 *    - Runs each production `vite.build(...)` target in a short-lived child
 *      Node process (`process.exit(0)` on bundle completion) unless
 *      `FORGE_VITE_IN_PROCESS=1` is set. Without this, all 20 Vite/Rollup
 *      builds execute inside the single `electron-forge` parent process and
 *      retain ~2.5-3 GB of V8 old-space + native buffers into
 *      `@electron/packager`'s copy/finalize phase, starving the 7 GB GitHub
 *      Actions runner until it loses communication with the server (CI #781).
 *
 * Idempotent: re-applies only if the sentinel markers are missing.
 * Invoked from `postinstall`, `rebuild-native`, and `forge.config.js`.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * @returns {string|null} path to the installed remote-rebuild.js, or null when
 *   the package isn't installed (e.g. production install without devDeps).
 */
function findRemoteRebuildPath() {
  const candidates = [
    path.join(
      PROJECT_ROOT,
      "node_modules",
      "@electron-forge",
      "core-utils",
      "dist",
      "remote-rebuild.js"
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * @returns {string|null} path to the installed VitePlugin.js, or null when
 *   the package isn't installed.
 */
function findVitePluginPath() {
  const candidates = [
    path.join(
      PROJECT_ROOT,
      "node_modules",
      "@electron-forge",
      "plugin-vite",
      "dist",
      "VitePlugin.js"
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Sentinel the patch inserts at the top of the worker. Re-applying checks for
// this so the patch is idempotent across runs.
const GUARD_MARKER = "/* AIFETCHLY-SKIP-NATIVE-REBUILD-GUARD */";

// The no-op guard block. Runs before the upstream `rebuild()` call. When
// FORGE_SKIP_NATIVE_REBUILD=1, emits the `rebuild-done` IPC message that
// forge's listrCompatibleRebuildHook awaits (see @electron-forge/core-utils
// dist/rebuild.js), then exits 0 so the parent treats the step as done.
const GUARD_BLOCK = `${GUARD_MARKER}
if (process.env.FORGE_SKIP_NATIVE_REBUILD === '1' && process.send) {
  process.send({ msg: 'rebuild-done' });
  process.exit(0);
}
`;

const VITE_ISOLATION_MARKER = "/* AIFETCHLY-ISOLATED-VITE-BUILD-GUARD */";

const VITE_ISOLATION_HELPER = `${VITE_ISOLATION_MARKER}
const aifetchly_cp_1 = require("node:child_process");
const AIFETCHLY_ISOLATED_WORKER_CODE = \`
process.env.VITE_CJS_IGNORE_WARNING = 'true';
process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = 'true';
(async () => {
  const payload = JSON.parse(process.env.AIFETCHLY_VITE_ISOLATED_PAYLOAD || '{}');
  const viteMod = require(payload.viteModulePath);
  const vite = viteMod.default || viteMod;
  const ViteConfigMod = require(payload.viteConfigModulePath);
  const ViteConfigGenerator = ViteConfigMod.default || ViteConfigMod;
  const generator = new ViteConfigGenerator(payload.pluginConfig, payload.projectDir, true);
  if (payload.kind === 'renderer') {
    const userConfig = await generator.resolveConfig(payload.buildConfig, 'renderer');
    await vite.build({
      configFile: false,
      logLevel: 'error',
      ...userConfig,
    });
  } else {
    const userConfig = await generator.resolveConfig(payload.buildConfig, payload.buildConfig.target ?? 'main');
    let buildError = null;
    await vite.build({
      configFile: false,
      logLevel: 'silent',
      ...userConfig,
      plugins: [
        {
          name: '@electron-forge/plugin-vite:build-done',
          buildEnd(err) {
            if (err instanceof Error) {
              buildError = err;
            }
          },
        },
        ...(userConfig.plugins ?? []),
      ],
      clearScreen: false,
    });
    if (buildError) {
      throw buildError;
    }
  }
})().then(
  () => process.exit(0),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
);
\`;
function runAifetchlyIsolatedViteTarget(plugin, buildConfig, kind) {
  return new Promise((resolve, reject) => {
    const payload = {
      viteModulePath: require.resolve("vite"),
      viteConfigModulePath: require.resolve("./ViteConfig"),
      projectDir: plugin.projectDir,
      pluginConfig: plugin.config,
      buildConfig,
      kind,
    };
    const child = aifetchly_cp_1.spawn(
      process.execPath,
      ["-e", AIFETCHLY_ISOLATED_WORKER_CODE],
      {
        cwd: plugin.projectDir,
        env: {
          ...process.env,
          AIFETCHLY_VITE_ISOLATED_PAYLOAD: JSON.stringify(payload),
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const details = output.trim();
      reject(
        new Error(
          details ||
            \`Isolated Vite \${kind} target failed (code=\${code}, signal=\${signal})\`
        )
      );
    });
  });
}
function runAifetchlyIsolatedViteBuildListr(plugin, task, kind) {
  if (kind === "renderer") {
    const rendererConfigs = (plugin.config.renderer || []).filter(({ config }) => config);
    return task?.newListr(
      rendererConfigs.map((buildConfig) => ({
        task: async (_ctx, subtask) => {
          const targetName = buildConfig.name || buildConfig.config || "";
          await runAifetchlyIsolatedViteTarget(plugin, buildConfig, "renderer");
          subtask.title = \`Built target \${chalk_1.default.dim(targetName)}\`;
        },
      })),
      {
        concurrent: plugin.config.concurrent ?? true,
      }
    );
  }
  const buildConfigs = (plugin.config.build || []).filter(({ config }) => config);
  return task?.newListr(
    buildConfigs.map((buildConfig) => {
      const target = buildConfig.entry || buildConfig.config || "";
      return {
        title: \`Building \${chalk_1.default.green(target)} target\`,
        task: async (_ctx, subtask) => {
          await runAifetchlyIsolatedViteTarget(plugin, buildConfig, "build");
          subtask.title = \`Built target \${chalk_1.default.dim(target)}\`;
        },
      };
    }),
    {
      concurrent: plugin.config.concurrent ?? true,
      exitOnError: plugin.isProd,
    }
  );
}
`;

/**
 * @param {string} filePath - absolute path to remote-rebuild.js
 * @returns {boolean} true if the file was modified, false if already patched
 */
function patchRemoteRebuild(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }

  if (raw.includes(GUARD_MARKER)) {
    return false;
  }

  // Insert the guard immediately after the `@electron/rebuild` require line,
  // which is the first statement. This guarantees the guard runs before the
  // upstream `rebuild()` invocation whatever the upstream file shape.
  const requireLine = 'const rebuild_1 = require("@electron/rebuild");';
  const requireAlt = "const rebuild_1 = require('@electron/rebuild');";
  const idx = raw.includes(requireLine)
    ? raw.indexOf(requireLine) + requireLine.length
    : raw.includes(requireAlt)
      ? raw.indexOf(requireAlt) + requireAlt.length
      : -1;

  let patched;
  if (idx >= 0) {
    patched = raw.slice(0, idx) + "\n" + GUARD_BLOCK + raw.slice(idx);
  } else {
    // Fallback: prepend the guard at the very top (after the strict directive).
    patched = raw.replace(
      /"use strict";\s*/,
      (m) => `"use strict";\n${GUARD_BLOCK}`
    );
  }

  try {
    fs.writeFileSync(filePath, patched, "utf-8");
    console.log(
      `patch-remote-rebuild: inserted skip guard into ${filePath} (active when FORGE_SKIP_NATIVE_REBUILD=1)`
    );
    return true;
  } catch (err) {
    console.warn(`patch-remote-rebuild: failed to write ${filePath}: ${err}`);
    return false;
  }
}

/**
 * Patches `@electron-forge/plugin-vite/dist/VitePlugin.js` so production
 * packaging runs `build` and `buildRenderer` sequentially and isolates each
 * `vite.build(...)` target in a short-lived child process that frees its heap
 * on exit.
 *
 * @param {string} filePath - absolute path to VitePlugin.js
 * @returns {boolean} true if the file was modified, false if already patched
 */
function patchVitePlugin(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }

  if (raw.includes(VITE_ISOLATION_MARKER)) {
    return false;
  }

  const viteConfigRequire =
    'const ViteConfig_1 = __importDefault(require("./ViteConfig"));';
  const buildEntryAnchor =
    "this.build = async (task) => {\n            const configs = await this.configGenerator.getBuildConfigs();";
  const buildRendererAnchor =
    "this.buildRenderer = async (task) => {\n            const rendererConfigs = await this.configGenerator.getRendererConfig();";
  const prePackageAnchor =
    "                        ], { concurrent: true });\n                    }, 'Building production Vite bundles'),";

  if (
    !raw.includes(viteConfigRequire) ||
    !raw.includes(buildEntryAnchor) ||
    !raw.includes(buildRendererAnchor)
  ) {
    console.warn(
      `patch-remote-rebuild: unexpected VitePlugin.js shape at ${filePath}; skipping Vite isolation patch`
    );
    return false;
  }

  let patched = raw.replace(
    viteConfigRequire,
    `${viteConfigRequire}\n${VITE_ISOLATION_HELPER}`
  );

  if (patched.includes(prePackageAnchor)) {
    patched = patched.replace(
      prePackageAnchor,
      "                        ], { concurrent: false });\n                    }, 'Building production Vite bundles'),"
    );
  }

  patched = patched.replace(
    buildEntryAnchor,
    `this.build = async (task) => {\n            if (this.isProd && process.env.FORGE_VITE_IN_PROCESS !== '1') {\n                return runAifetchlyIsolatedViteBuildListr(this, task, 'build');\n            }\n            const configs = await this.configGenerator.getBuildConfigs();`
  );

  patched = patched.replace(
    buildRendererAnchor,
    `this.buildRenderer = async (task) => {\n            if (this.isProd && process.env.FORGE_VITE_IN_PROCESS !== '1') {\n                return runAifetchlyIsolatedViteBuildListr(this, task, 'renderer');\n            }\n            const rendererConfigs = await this.configGenerator.getRendererConfig();`
  );

  try {
    fs.writeFileSync(filePath, patched, "utf-8");
    console.log(
      `patch-remote-rebuild: patched ${filePath} for child-process isolated production Vite builds`
    );
    return true;
  } catch (err) {
    console.warn(`patch-remote-rebuild: failed to write ${filePath}: ${err}`);
    return false;
  }
}

function run() {
  const remoteRebuildPath = findRemoteRebuildPath();
  if (remoteRebuildPath) {
    patchRemoteRebuild(remoteRebuildPath);
  }
  const vitePluginPath = findVitePluginPath();
  if (vitePluginPath) {
    patchVitePlugin(vitePluginPath);
  }
  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = {
  run,
  patchRemoteRebuild,
  findRemoteRebuildPath,
  patchVitePlugin,
  findVitePluginPath,
};