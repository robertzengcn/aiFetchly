const { spawnSync } = require("node:child_process");

function getElectronTargetVersion() {
  try {
    return require("electron/package.json").version;
  } catch {
    // electron is a devDependency, so it is absent on `install --production`
    // (CI/Docker jobs that skip devDeps). There is nothing to rebuild for
    // Electron in that case — better-sqlite3 stays built for system Node.
    return null;
  }
}

function rebuildBetterSqlite() {
  const electronVersion = getElectronTargetVersion();
  if (!electronVersion) {
    console.log(
      "Skipping better-sqlite3 Electron rebuild: electron package not installed."
    );
    return;
  }
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const env = {
    ...process.env,
    npm_config_runtime: "electron",
    npm_config_target: electronVersion,
    npm_config_disturl: "https://electronjs.org/headers",
  };

  console.log(
    `Rebuilding better-sqlite3 for Electron ${electronVersion} (${process.platform}/${process.arch})`
  );

  const result = spawnSync(
    npmCommand,
    ["rebuild", "better-sqlite3", "--build-from-source"],
    {
      env,
      stdio: "inherit",
    }
  );

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (process.argv.includes("--print-target")) {
  console.log(getElectronTargetVersion());
} else if (require.main === module) {
  rebuildBetterSqlite();
}

module.exports = {
  getElectronTargetVersion,
};
