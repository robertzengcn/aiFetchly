/**
 * Test: Verify better-sqlite3 native module is compiled for the correct Electron version.
 *
 * This catches the common issue where `yarn install` compiles native modules against
 * the system Node.js instead of Electron's Node.js, causing ERR_DLOPEN_FAILED at runtime.
 *
 * The test reads the Electron binary's expected module version and compares it against
 * the version embedded in the .node binary.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as child_process from "child_process";
import { createRequire } from "node:module";

/**
 * Extracts the node_module_version from the Electron binary's embedded config.
 * Electron bakes a JSON config containing `node_module_version` into its binary.
 */
function getElectronModuleVersion(electronBinaryPath: string): number | null {
  const binary = fs.readFileSync(electronBinaryPath);

  // The Electron binary contains an embedded JSON config with node_module_version.
  // Search for the JSON fragment containing it.
  const marker = '"node_module_version": ';
  const idx = binary.indexOf(marker);
  if (idx === -1) {
    return null;
  }

  // Read the number following the marker
  const slice = binary.slice(idx + marker.length, idx + marker.length + 10);
  const match = slice.toString("ascii").match(/^(\d+)/);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10);
}

function getElectronBinaryPath(projectRoot: string): string {
  if (process.platform === "darwin") {
    return path.join(
      projectRoot,
      "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    );
  }
  return path.join(
    projectRoot,
    "node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
}

function getElectronCliPath(projectRoot: string): string {
  return path.join(
    projectRoot,
    "node_modules/.bin",
    process.platform === "win32" ? "electron.cmd" : "electron"
  );
}

function getElectronRuntimeModuleVersion(projectRoot: string): number | null {
  const electronCliPath = getElectronCliPath(projectRoot);
  if (!fs.existsSync(electronCliPath)) {
    return null;
  }
  const probePath = path.join(
    os.tmpdir(),
    `aifetchly-native-version-${process.pid}-${Date.now()}.js`
  );
  fs.writeFileSync(
    probePath,
    "process.stdout.write('ELECTRON_MODULE_VERSION:' + process.versions.modules); process.exit(0);"
  );
  try {
    const result = child_process.spawnSync(
      electronCliPath,
      ["--no-sandbox", "--headless", "--disable-gpu", probePath],
      {
        encoding: "utf-8",
        timeout: 15000,
      }
    );
    const match = (result.stdout || "").match(/ELECTRON_MODULE_VERSION:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } finally {
    fs.rmSync(probePath, { force: true });
  }
}

/**
 * Gets the NODE_MODULE_VERSION a .node binary was compiled against
 * by spawning a child process that tries to load it and parsing the error.
 * Uses a child process to avoid polluting the test process's module cache.
 */
function getCompiledModuleVersion(
  modulePath: string,
  projectRoot: string
): number | null {
  const electronCliPath = getElectronCliPath(projectRoot);
  if (!fs.existsSync(electronCliPath)) return null;
  const probePath = path.join(
    os.tmpdir(),
    `aifetchly-native-module-${process.pid}-${Date.now()}.js`
  );
  fs.writeFileSync(
    probePath,
    `try { require(${JSON.stringify(
      modulePath
    )}); process.stdout.write("MODULE_VERSION:" + process.versions.modules); } catch (e) { const match = String(e && e.message || e).match(/NODE_MODULE_VERSION\\s+(\\d+)/); if (match) process.stdout.write("MODULE_VERSION:" + match[1]); }`
  );
  try {
    const result = child_process.spawnSync(
      electronCliPath,
      ["--no-sandbox", "--headless", "--disable-gpu", probePath],
      { encoding: "utf-8", timeout: 15000 }
    );
    const match = (result.stdout || "").match(/MODULE_VERSION:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } finally {
    fs.rmSync(probePath, { force: true });
  }
}

describe("Native module version compatibility", () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const packageJsonPath = path.join(projectRoot, "package.json");
  const forgeConfigPath = path.join(projectRoot, "forge.config.js");
  const rebuildScriptPath = path.join(
    projectRoot,
    "scripts/rebuild-better-sqlite.js"
  );
  const electronBinaryPath = getElectronBinaryPath(projectRoot);
  const betterSqliteModulePath = path.join(
    projectRoot,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  );

  // These tests spawn the Electron binary under `spawnSync` with an internal
  // 15s timeout. On a cold CI runner Electron can take ~10-15s to spin up
  // (and the "matching Electron binary" test spawns it twice), so the
  // spawned work alone can run for ~30s while never exceeding each
  // spawnSync's own 15s cap. Vitest's default testTimeout is 5000ms, which
  // kills the test while spawnSync is still waiting and reports a spurious
  // "Test timed out" failure. Use a generous per-test timeout so Vitest
  // waits for the spawned Electron to finish (or hit its own timeout and
  // return cleanly), instead of cutting it off mid-spawn.
  it(
    "should have better-sqlite3 compiled for Electron (not system Node.js)",
    { timeout: 60000 },
    () => {
      if (!fs.existsSync(betterSqliteModulePath)) {
        console.warn(
          "Skipping: better-sqlite3 native binary not found. Run `yarn rebuild-better-sqlite` first."
        );
        return;
      }

      const compiledVersion = getCompiledModuleVersion(
        betterSqliteModulePath,
        projectRoot
      );
      expect(
        compiledVersion,
        "Should be able to read compiled module version from binary"
      ).not.toBeNull();

      const systemVersion = parseInt(process.versions.modules, 10);

      // The compiled version must differ from system Node.js version,
      // meaning it was built for Electron, not the system Node.js.
      expect(
        compiledVersion,
        `better-sqlite3 was compiled for system Node.js (MODULE_VERSION ${compiledVersion}). ` +
          `Run \`yarn rebuild-better-sqlite\` to compile it for Electron.`
      ).not.toBe(systemVersion);
    }
  );

  it(
    "should have better-sqlite3 module version matching Electron binary",
    { timeout: 60000 },
    () => {
      if (!fs.existsSync(electronBinaryPath)) {
        console.warn("Skipping: Electron binary not found.");
        return;
      }
      if (!fs.existsSync(betterSqliteModulePath)) {
        console.warn("Skipping: better-sqlite3 native binary not found.");
        return;
      }

      const electronModuleVersion =
        getElectronModuleVersion(electronBinaryPath) ??
        getElectronRuntimeModuleVersion(projectRoot);
      expect(
        electronModuleVersion,
        "Should be able to read node_module_version from Electron binary"
      ).not.toBeNull();

      const compiledVersion = getCompiledModuleVersion(
        betterSqliteModulePath,
        projectRoot
      );
      expect(
        compiledVersion,
        "Should be able to read compiled module version from binary"
      ).not.toBeNull();

      expect(
        compiledVersion,
        `better-sqlite3 MODULE_VERSION (${compiledVersion}) does not match Electron's expected version (${electronModuleVersion}). ` +
          `Run \`yarn rebuild-better-sqlite\` to fix this.`
      ).toBe(electronModuleVersion);
    }
  );

  it("should have the rebuild script target matching the installed Electron version", () => {
    const electronPkgPath = path.join(
      projectRoot,
      "node_modules/electron/package.json"
    );
    const electronVersion = JSON.parse(
      fs.readFileSync(electronPkgPath, "utf-8")
    ).version;

    const result = child_process.spawnSync(
      process.execPath,
      [rebuildScriptPath, "--print-target"],
      {
        encoding: "utf-8",
        timeout: 10000,
      }
    );

    expect(
      result.status,
      `rebuild-better-sqlite target helper failed: ${result.stderr}`
    ).toBe(0);

    const targetVersion = result.stdout.trim();
    expect(
      targetVersion,
      `rebuild-better-sqlite targets Electron ${targetVersion} but installed version is ${electronVersion}. ` +
        `Update scripts/rebuild-better-sqlite.js.`
    ).toBe(electronVersion);
  });

  it("should invoke npm through a shell on Windows rebuilds", () => {
    const rebuildScript = fs.readFileSync(rebuildScriptPath, "utf-8");

    expect(rebuildScript).toContain('shell: process.platform === "win32"');
  });

  it("should have a direct node-gyp fallback when npm rebuild leaves a bad binary", () => {
    const rebuildScript = fs.readFileSync(rebuildScriptPath, "utf-8");

    expect(rebuildScript).toContain("rebuildForElectronWithNodeGyp");
    expect(rebuildScript).toContain("--runtime=electron");
    expect(rebuildScript).toContain(
      "--dist-url=https://electronjs.org/headers"
    );
  });

  it("should pin node-gyp Python before GitHub workflow installs", () => {
    const workflowPaths = [
      path.join(projectRoot, ".github/workflows/build.yml"),
      path.join(projectRoot, ".github/workflows/ci.yml"),
      path.join(projectRoot, ".github/workflows/release.yml"),
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = fs.readFileSync(workflowPath, "utf-8");

      expect(workflow).toContain("Configure node-gyp Python");
      expect(workflow).toContain("npm_config_python");
      expect(workflow).toContain("NODE_GYP_FORCE_PYTHON");
    }
  });

  it("should not upgrade native modules to latest during GitHub builds", () => {
    const workflowPaths = [
      path.join(projectRoot, ".github/workflows/build.yml"),
      path.join(projectRoot, ".github/workflows/release.yml"),
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = fs.readFileSync(workflowPath, "utf-8");

      expect(workflow).not.toContain("better-sqlite3@latest");
      expect(workflow).not.toContain("sqlite3@latest");
    }
  });

  it("should avoid windows-latest for native Windows build jobs", () => {
    const workflowPaths = [
      path.join(projectRoot, ".github/workflows/build.yml"),
      path.join(projectRoot, ".github/workflows/release.yml"),
    ];

    for (const workflowPath of workflowPaths) {
      const workflow = fs.readFileSync(workflowPath, "utf-8");

      expect(workflow).not.toContain("runs-on: windows-latest");
      expect(workflow).toContain("runs-on: windows-2022");
    }
  });

  it("should verify native modules before Electron startup commands", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8")
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.prestart).toBe("yarn rebuild-native");
    expect(packageJson.scripts?.predev).toBe("yarn rebuild-native");
  });

  it("should rebuild Electron native modules before compatibility verification in CI", () => {
    const workflow = fs.readFileSync(
      path.join(projectRoot, ".github/workflows/ci.yml"),
      "utf-8"
    );
    const rebuildIndex = workflow.indexOf("yarn rebuild-better-sqlite");
    const verifyIndex = workflow.indexOf(
      "Run native module compatibility tests"
    );

    expect(rebuildIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(rebuildIndex).toBeLessThan(verifyIndex);
  });

  it("should keep a single resolutions map in package metadata", () => {
    const packageSource = fs.readFileSync(packageJsonPath, "utf-8");
    expect((packageSource.match(/"resolutions"\s*:/g) || []).length).toBe(1);
  });

  it("should verify native modules inside Forge preStart for direct launches", () => {
    const forgeConfig = fs.readFileSync(forgeConfigPath, "utf-8");

    expect(forgeConfig).toContain("preStart: async");
    expect(forgeConfig).toContain("ensureBetterSqliteElectronBinary");
    expect(forgeConfig).toContain('scripts", "rebuild-better-sqlite.js');
  });

  /**
   * Resolve the `node-abi` module that Forge's internal `@electron/rebuild`
   * actually loads, by anchoring `createRequire` at the rebuild package's
   * package.json. This replicates the exact resolution path that threw
   * `Could not detect abi for version 43.2.0` when the hoisted node-abi was
   * stale. Returns the node-abi module object, or null when rebuild is absent
   * (e.g. `install --production`).
   */
  function resolveForgeRebuildNodeAbi(): {
    getAbi: (version: string, runtime: string) => string;
  } | null {
    const candidates = [
      // Forge core-utils nests its own @electron/rebuild (the path in the stack trace).
      path.join(
        projectRoot,
        "node_modules/@electron-forge/core-utils/node_modules/@electron/rebuild/package.json"
      ),
      path.join(
        projectRoot,
        "node_modules/@electron-forge/core/node_modules/@electron/rebuild/package.json"
      ),
      path.join(
        projectRoot,
        "node_modules/@electron-forge/shared-types/node_modules/@electron/rebuild/package.json"
      ),
      // Top-level @electron/rebuild (devDependency).
      path.join(projectRoot, "node_modules/@electron/rebuild/package.json"),
    ];
    for (const anchor of candidates) {
      if (!fs.existsSync(anchor)) continue;
      try {
        const req = createRequire(anchor);
        const nodeAbi = req("node-abi");
        if (nodeAbi && typeof nodeAbi.getAbi === "function") return nodeAbi;
      } catch {
        // node-abi not resolvable from this anchor; try the next.
      }
    }
    return null;
  }

  it("node-abi used by Forge's rebuild must resolve the installed Electron ABI (regression for 'Could not detect abi for version 43.2.0')", () => {
    const electronPkgPath = path.join(
      projectRoot,
      "node_modules/electron/package.json"
    );
    if (!fs.existsSync(electronPkgPath)) {
      console.warn("Skipping: electron package not installed.");
      return;
    }
    const electronVersion = JSON.parse(
      fs.readFileSync(electronPkgPath, "utf-8")
    ).version as string;

    const nodeAbi = resolveForgeRebuildNodeAbi();
    expect(
      nodeAbi,
      "Could not resolve node-abi from any @electron/rebuild copy. " +
        "Run `yarn install` to install devDependencies."
    ).not.toBeNull();

    // This is the exact call that threw `Could not detect abi for version
    // 43.2.0 and runtime electron` when the hoisted node-abi@3.85.0 predates
    // Electron 43. It must return a numeric ABI string without throwing.
    let abi: string | null = null;
    expect(() => {
      abi = nodeAbi!.getAbi(electronVersion, "electron");
    }, `node-abi could not resolve ABI for installed Electron ${electronVersion}. ` + "Bump the `node-abi` resolution in package.json to a release that knows this Electron major.").not.toThrow();

    expect(abi, "getAbi returned a non-string").toBeTypeOf("string");
    expect(
      abi,
      `getAbi('${electronVersion}', 'electron') returned '${abi}', expected a numeric ABI. ` +
        "The hoisted node-abi is stale — update the package.json resolution."
    ).toMatch(/^\d+$/);
  });

  it("node-abi resolution in package.json must pin a version that knows the installed Electron major", () => {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
      resolutions?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    // The resolution is what actually keeps the hoisted copy fresh across
    // `yarn install`. Without it, Yarn is free to hoist a stale 3.x that
    // predates the installed Electron major (the recurring regression).
    expect(
      pkg.resolutions?.["node-abi"],
      "package.json is missing a `resolutions.node-abi` pin. " +
        "Without it, a stale hoisted node-abi can resurface and break Forge startup " +
        "with `Could not detect abi for version <electron>`."
    ).toBeDefined();

    const electronPkgPath = path.join(
      projectRoot,
      "node_modules/electron/package.json"
    );
    if (!fs.existsSync(electronPkgPath)) {
      console.warn("Skipping ABI cross-check: electron package not installed.");
      return;
    }
    const electronVersion = JSON.parse(
      fs.readFileSync(electronPkgPath, "utf-8")
    ).version as string;

    // Resolve the ACTUALLY hoisted node-abi (what Forge's nested CJS
    // @electron/rebuild loads) and assert it knows the installed Electron.
    const hoistedNodeAbiPath = path.join(
      projectRoot,
      "node_modules/node-abi/package.json"
    );
    expect(
      fs.existsSync(hoistedNodeAbiPath),
      "node-abi is not installed at the hoisted top-level. Run `yarn install`."
    ).toBe(true);

    const req = createRequire(path.join(projectRoot, "package.json"));
    const nodeAbi = req("node-abi") as {
      getAbi: (version: string, runtime: string) => string;
    };
    expect(
      () => nodeAbi.getAbi(electronVersion, "electron"),
      `The hoisted node-abi (pinned to ${pkg.resolutions?.["node-abi"]}) ` +
        `cannot resolve installed Electron ${electronVersion}. ` +
        "Bump the `node-abi` resolution to a release that includes this Electron major."
    ).not.toThrow();
  });
});
