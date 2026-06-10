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
import * as path from "path";
import * as child_process from "child_process";

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

/**
 * Gets the NODE_MODULE_VERSION a .node binary was compiled against
 * by spawning a child process that tries to load it and parsing the error.
 * Uses a child process to avoid polluting the test process's module cache.
 */
function getCompiledModuleVersion(modulePath: string): number | null {
  const script = `
    try {
      require(${JSON.stringify(modulePath)});
      console.log('MODULE_VERSION:' + process.versions.modules);
    } catch (e) {
      const msg = e.message;
      const matches = msg.match(/NODE_MODULE_VERSION\\s+(\\d+)/g);
      if (matches && matches.length > 0) {
        const m = matches[0].match(/NODE_MODULE_VERSION\\s+(\\d+)/);
        if (m) console.log('MODULE_VERSION:' + m[1]);
      }
    }
  `;

  const result = child_process.spawnSync(process.execPath, ["-e", script], {
    encoding: "utf-8",
    timeout: 10000,
  });

  const output = result.stdout || "";
  const match = output.match(/MODULE_VERSION:(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

describe("Native module version compatibility", () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const electronBinaryPath = path.join(
    projectRoot,
    "node_modules/electron/dist/electron"
  );
  const betterSqliteModulePath = path.join(
    projectRoot,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
  );

  it("should have better-sqlite3 compiled for Electron (not system Node.js)", () => {
    if (!fs.existsSync(betterSqliteModulePath)) {
      console.warn(
        "Skipping: better-sqlite3 native binary not found. Run `yarn rebuild-better-sqlite` first."
      );
      return;
    }

    const compiledVersion = getCompiledModuleVersion(betterSqliteModulePath);
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
  });

  it("should have better-sqlite3 module version matching Electron binary", () => {
    if (!fs.existsSync(electronBinaryPath)) {
      console.warn("Skipping: Electron binary not found.");
      return;
    }
    if (!fs.existsSync(betterSqliteModulePath)) {
      console.warn("Skipping: better-sqlite3 native binary not found.");
      return;
    }

    const electronModuleVersion = getElectronModuleVersion(electronBinaryPath);
    expect(
      electronModuleVersion,
      "Should be able to read node_module_version from Electron binary"
    ).not.toBeNull();

    const compiledVersion = getCompiledModuleVersion(betterSqliteModulePath);
    expect(
      compiledVersion,
      "Should be able to read compiled module version from binary"
    ).not.toBeNull();

    expect(
      compiledVersion,
      `better-sqlite3 MODULE_VERSION (${compiledVersion}) does not match Electron's expected version (${electronModuleVersion}). ` +
        `Run \`yarn rebuild-better-sqlite\` to fix this.`
    ).toBe(electronModuleVersion);
  });

  it("should have the rebuild script target matching the installed Electron version", () => {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    const rebuildScript = pkg.scripts?.["rebuild-better-sqlite"] || "";
    const electronPkgPath = path.join(
      projectRoot,
      "node_modules/electron/package.json"
    );
    const electronVersion = JSON.parse(
      fs.readFileSync(electronPkgPath, "utf-8")
    ).version;

    const targetMatch = rebuildScript.match(/npm_config_target=([^\s]+)/);
    expect(
      targetMatch,
      "rebuild-better-sqlite script should set npm_config_target"
    ).not.toBeNull();

    const targetVersion = targetMatch![1];
    expect(
      targetVersion,
      `rebuild-better-sqlite targets Electron ${targetVersion} but installed version is ${electronVersion}. ` +
        `Update the npm_config_target in package.json scripts.`
    ).toBe(electronVersion);
  });
});
