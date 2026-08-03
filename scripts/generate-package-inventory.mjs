#!/usr/bin/env node
/**
 * Generate a machine-readable package + native-binary inventory for an unpacked
 * application or extracted runtime (PRD FR-26, design §26.4).
 *
 * Usage:
 *   node scripts/generate-package-inventory.mjs \
 *     --app <unpacked-app-dir> --platform win32 --arch x64 \
 *     [--artifact-name <name>] [--out <file.json>]
 *
 * Writes the inventory JSON to --out (or stdout). Exits nonzero on error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildInventory } from "./lib/localAiRuntime/packageInventory.mjs";

function parseArgs(argv) {
  const args = { app: null, platform: null, arch: null, artifactName: null, out: null };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case "--app": args.app = val; break;
      case "--platform": args.platform = val; break;
      case "--arch": args.arch = val; break;
      case "--artifact-name": args.artifactName = val; break;
      case "--out": args.out = val; break;
      default: throw new Error(`Unknown argument: ${key}`);
    }
  }
  if (!args.app || !args.platform || !args.arch) {
    throw new Error("Usage: --app <dir> --platform <p> --arch <a> [--artifact-name <n>] [--out <file>]");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  let rootPkg = null;
  try {
    rootPkg = JSON.parse(readFileSync(path.join(args.app, "package.json"), "utf-8"));
  } catch {
    // Some unpacked apps nest package.json elsewhere; let buildInventory try.
  }
  const inventory = buildInventory(args.app, rootPkg, {
    platform: args.platform,
    arch: args.arch,
    artifactName: args.artifactName ?? path.basename(path.resolve(args.app)),
  });
  const json = JSON.stringify(inventory, null, 2);
  if (args.out) {
    writeFileSync(args.out, json + "\n");
    console.error(`Wrote inventory for ${inventory.artifactName}: ${inventory.packages.length} packages, ${inventory.nativeFiles.length} native files -> ${args.out}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

try {
  main();
} catch (err) {
  console.error(`generate-package-inventory: ${err.message}`);
  process.exit(1);
}
