/**
 * Fast packaging-config gate (no Electron package required).
 *
 * Fails if forge unpackDir would pull .vite/renderer out of app.asar.
 * That layout breaks Windows startup: Chromium loadFile returns
 * ERR_FAILED (-2) for unpacked HTML loaded via the app.asar virtual path.
 */
"use strict";

const path = require("node:path");
const { minimatch } = require("minimatch");

async function loadProductionAsarUnpackDir() {
  const previousDisableAsar = process.env.FORGE_DISABLE_ASAR;
  delete process.env.FORGE_DISABLE_ASAR;
  try {
    // forge.config.js is CommonJS and reads env at load time.
    const forgePath = path.join(__dirname, "..", "forge.config.js");
    delete require.cache[require.resolve(forgePath)];
    const forgeConfig = require(forgePath);
    const asar = forgeConfig.packagerConfig?.asar;
    if (!asar || typeof asar !== "object") {
      throw new Error(
        "Expected production packagerConfig.asar object when FORGE_DISABLE_ASAR is unset"
      );
    }
    return asar.unpackDir;
  } finally {
    if (previousDisableAsar === undefined) {
      delete process.env.FORGE_DISABLE_ASAR;
    } else {
      process.env.FORGE_DISABLE_ASAR = previousDisableAsar;
    }
  }
}

function assertRendererNotUnpacked(unpackDir) {
  if (!unpackDir || typeof unpackDir !== "string") {
    throw new Error("packagerConfig.asar.unpackDir must be a non-empty string");
  }

  const forbidden = [
    ".vite/renderer",
    ".vite/renderer/main_window",
    "renderer/main_window",
  ];

  for (const dirname of forbidden) {
    if (minimatch(dirname, unpackDir)) {
      throw new Error(
        `asar.unpackDir must not unpack renderer HTML (matched "${dirname}"). ` +
          `Current unpackDir=${JSON.stringify(unpackDir)}`
      );
    }
  }

  // Workers / native still need to unpack.
  const required = [".vite/build", "dist/childprocess"];
  for (const dirname of required) {
    if (!minimatch(dirname, unpackDir)) {
      throw new Error(
        `asar.unpackDir must still unpack "${dirname}". ` +
          `Current unpackDir=${JSON.stringify(unpackDir)}`
      );
    }
  }
}

async function main() {
  const unpackDir = await loadProductionAsarUnpackDir();
  assertRendererNotUnpacked(unpackDir);
  console.log(
    "OK: forge asar.unpackDir keeps .vite/renderer packed and unpacks .vite/build"
  );
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

module.exports = {
  assertRendererNotUnpacked,
  loadProductionAsarUnpackDir,
};
