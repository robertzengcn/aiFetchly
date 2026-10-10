const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const plist = require("plist");

const EXPECTED_BUNDLE_IDENTIFIER = "com.aifetchly.desktop";
const EXPECTED_TEAM_IDENTIFIER = "22RY733FNY";
const EXPECTED_APPLICATION_IDENTIFIER = `${EXPECTED_TEAM_IDENTIFIER}.${EXPECTED_BUNDLE_IDENTIFIER}`;
const MAIN_REQUIRED_ENTITLEMENTS = [
  "com.apple.security.app-sandbox",
  "com.apple.security.network.client",
  "com.apple.security.files.user-selected.read-write",
  "com.apple.security.files.bookmarks.app-scope",
];
const HELPER_REQUIRED_ENTITLEMENTS = [
  "com.apple.security.app-sandbox",
  "com.apple.security.inherit",
];

function defaultRunCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });

  if (result.error) {
    throw new Error(`Unable to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`${command} failed: ${details}`);
  }

  return result.stdout.trim() || result.stderr.trim();
}

function findElectronHelperApps(appPath) {
  const frameworksPath = path.join(appPath, "Contents", "Frameworks");
  if (!fs.existsSync(frameworksPath)) {
    return [];
  }

  return fs
    .readdirSync(frameworksPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && / Helper(?: \(.+\))?\.app$/.test(entry.name)
    )
    .map((entry) => path.join(frameworksPath, entry.name));
}

function readBundleIdentifier(appPath, runCommand) {
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  return runCommand("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    infoPlistPath,
  ]).trim();
}

function readEntitlements(targetPath, runCommand) {
  const output = runCommand("codesign", [
    "-d",
    "--entitlements",
    ":-",
    targetPath,
  ]);
  const plistStart = output.indexOf("<?xml");
  const plistDocument = plistStart >= 0 ? output.slice(plistStart) : output;

  try {
    return plist.parse(plistDocument);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read entitlements for ${targetPath}: ${message}`);
  }
}

function requireBooleanEntitlement(entitlements, key, targetPath) {
  if (entitlements[key] !== true) {
    throw new Error(`Missing required entitlement ${key} on ${targetPath}.`);
  }
}

function requireStringEntitlement(entitlements, key, expectedValue, targetPath) {
  if (entitlements[key] !== expectedValue) {
    throw new Error(
      `Expected entitlement ${key}=${expectedValue} on ${targetPath}, received ${String(
        entitlements[key]
      )}.`
    );
  }
}

function verifyMacStoreApp(
  appPath,
  dependencies = {
    existsSync: fs.existsSync,
    runCommand: defaultRunCommand,
  }
) {
  if (!dependencies.existsSync(appPath)) {
    throw new Error(`Application bundle not found: ${appPath}`);
  }
  if (path.extname(appPath).toLowerCase() !== ".app") {
    throw new Error(`Expected a macOS .app bundle, received: ${appPath}`);
  }

  const bundleIdentifier = readBundleIdentifier(
    appPath,
    dependencies.runCommand
  );
  if (bundleIdentifier !== EXPECTED_BUNDLE_IDENTIFIER) {
    throw new Error(
      `Expected bundle ID ${EXPECTED_BUNDLE_IDENTIFIER}, received ${bundleIdentifier}.`
    );
  }

  const mainEntitlements = readEntitlements(
    appPath,
    dependencies.runCommand
  );
  for (const entitlement of MAIN_REQUIRED_ENTITLEMENTS) {
    requireBooleanEntitlement(mainEntitlements, entitlement, appPath);
  }
  requireStringEntitlement(
    mainEntitlements,
    "com.apple.application-identifier",
    EXPECTED_APPLICATION_IDENTIFIER,
    appPath
  );
  requireStringEntitlement(
    mainEntitlements,
    "com.apple.developer.team-identifier",
    EXPECTED_TEAM_IDENTIFIER,
    appPath
  );

  const helperApps = findElectronHelperApps(appPath);
  if (helperApps.length === 0) {
    throw new Error(
      `No Electron helper applications found in ${path.join(
        appPath,
        "Contents",
        "Frameworks"
      )}.`
    );
  }

  for (const helperPath of helperApps) {
    const helperEntitlements = readEntitlements(
      helperPath,
      dependencies.runCommand
    );
    for (const entitlement of HELPER_REQUIRED_ENTITLEMENTS) {
      requireBooleanEntitlement(helperEntitlements, entitlement, helperPath);
    }
  }

  return {
    appPath,
    bundleIdentifier,
    helperCount: helperApps.length,
  };
}

if (require.main === module) {
  const appArgument = process.argv[2];
  if (!appArgument || process.argv.length !== 3) {
    console.error("Usage: yarn verify-mac:store /path/to/AiFetchly.app");
    process.exitCode = 1;
  } else {
    try {
      const result = verifyMacStoreApp(path.resolve(appArgument));
      console.log(
        `Mac App Store verification passed for ${result.bundleIdentifier} (${result.helperCount} helpers).`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Mac App Store verification failed: ${message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  verifyMacStoreApp,
};
