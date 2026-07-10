const { spawnSync } = require("node:child_process");

function getElectronTargetVersion() {
  return require("electron/package.json").version;
}

function rebuildBetterSqlite() {
  const electronVersion = getElectronTargetVersion();
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
