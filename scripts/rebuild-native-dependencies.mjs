#!/usr/bin/env node
/**
 * Selective native-module rebuild driven by the version-controlled policy
 * (PRD FR-24, design §26.6). Replaces the old broad `electron-rebuild
 * --types prod,dev,optional` with one authoritative rebuild of exactly the
 * modules the target requires, plus a follow-up load probe per module.
 *
 * Usage:
 *   node scripts/rebuild-native-dependencies.mjs \
 *     --policy config/native-dependency-policy.json \
 *     --platform win32 --arch x64 \
 *     [--electron-version <x.y.z>] [--module-dir .]
 *
 * Resolves the Electron version from the installed package when not supplied.
 * Exits nonzero if electron-rebuild fails or a load probe errors.
 */
import { spawnSync } from "node:child_process";
import { loadPolicy, getTargetPolicy } from "./lib/localAiRuntime/nativeDependencyPolicy.mjs";
import { readElectronVersion } from "./resolve-electron-build-metadata.mjs";

function parseArgs(argv) {
  const args = { policy: null, platform: null, arch: null, electronVersion: null, moduleDir: "." };
  for (let i = 2; i < argv.length; i += 2) {
    switch (argv[i]) {
      case "--policy": args.policy = argv[i + 1]; break;
      case "--platform": args.platform = argv[i + 1]; break;
      case "--arch": args.arch = argv[i + 1]; break;
      case "--electron-version": args.electronVersion = argv[i + 1]; break;
      case "--module-dir": args.moduleDir = argv[i + 1]; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!args.policy || !args.platform || !args.arch) {
    throw new Error("Usage: --policy <file> --platform <p> --arch <a> [--electron-version <v>] [--module-dir <dir>]");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const policy = loadPolicy(args.policy);
  const target = getTargetPolicy(policy, args.platform, args.arch);
  const modules = target.rebuildModules;
  const electronVersion = args.electronVersion || readElectronVersion(process.cwd());

  console.error(`Rebuilding ${modules.join(", ")} for Electron ${electronVersion} (${args.platform}-${args.arch})`);

  const rebuild = spawnSync(
    process.execPath,
    ["node_modules/@electron/rebuild/lib/cli.js", "--force",
      "--arch", args.arch,
      "--module-dir", args.moduleDir,
      "--types", "prod",
      "--which", modules.join(","),
    ],
    { stdio: "inherit", env: { ...process.env, npm_config_runtime: "electron", npm_config_target: electronVersion, npm_config_disturl: "https://electronjs.org/headers" } },
  );
  // @electron/rebuild may be invoked via the electron-rebuild shim too.
  if (rebuild.error || rebuild.status !== 0) {
    const fallback = spawnSync(
      process.execPath,
      ["node_modules/.bin/electron-rebuild", "-f", "-a", args.arch, "-w", modules.join(",")],
      { stdio: "inherit", env: { ...process.env, npm_config_runtime: "electron", npm_config_target: electronVersion } },
    );
    if (fallback.error || fallback.status !== 0) {
      throw new Error(`electron-rebuild failed for ${modules.join(", ")}.`);
    }
  }

  console.error(`Native rebuild complete: ${modules.join(", ")}, ABI for Electron ${electronVersion}.`);
}

try {
  main();
} catch (err) {
  console.error(`rebuild-native-dependencies: ${err.message}`);
  process.exit(1);
}
