#!/usr/bin/env node
/**
 * Verify a packaged application's production closure against the native
 * dependency policy (PRD FR-23/FR-26, design §25.4.1, §26.5).
 *
 * Usage:
 *   node scripts/verify-production-package.mjs \
 *     --app <unpacked-app-dir> --policy config/native-dependency-policy.json \
 *     --platform win32 --arch x64 [--inventory-out <file.json>]
 *
 * Builds the inventory (or reuses --inventory if provided), runs the gates, and
 * exits nonzero on any violation. Emits the inventory + report to stderr so CI
 * captures them in the job log.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadPolicy } from "./lib/localAiRuntime/nativeDependencyPolicy.mjs";
import { buildInventory } from "./lib/localAiRuntime/packageInventory.mjs";
import { verifyClosureReport } from "./lib/localAiRuntime/productionClosure.mjs";

function parseArgs(argv) {
  const args = { app: null, inventory: null, policy: null, platform: null, arch: null, inventoryOut: null };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case "--app": args.app = val; break;
      case "--inventory": args.inventory = val; break;
      case "--policy": args.policy = val; break;
      case "--platform": args.platform = val; break;
      case "--arch": args.arch = val; break;
      case "--inventory-out": args.inventoryOut = val; break;
      default: throw new Error(`Unknown argument: ${key}`);
    }
  }
  if (!args.policy || !args.platform || !args.arch) {
    throw new Error("Usage: --policy <file> --platform <p> --arch <a> (--app <dir> | --inventory <file>)");
  }
  if (!args.app && !args.inventory) {
    throw new Error("Either --app <dir> or --inventory <file> is required");
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const policy = loadPolicy(args.policy);

  let inventory;
  if (args.inventory) {
    inventory = JSON.parse(readFileSync(args.inventory, "utf-8"));
  } else {
    let rootPkg = null;
    try {
      rootPkg = JSON.parse(readFileSync(path.join(args.app, "package.json"), "utf-8"));
    } catch {
      // fall through
    }
    inventory = buildInventory(args.app, rootPkg, {
      platform: args.platform,
      arch: args.arch,
      artifactName: path.basename(path.resolve(args.app)),
    });
  }

  if (args.inventoryOut) {
    writeFileSync(args.inventoryOut, JSON.stringify(inventory, null, 2) + "\n");
  }

  const result = verifyClosureReport(inventory, policy, args.platform, args.arch);
  console.error(result.report);
  console.error(
    `Inventory: ${inventory.packages?.length ?? 0} packages, ${inventory.nativeFiles?.length ?? 0} native files.`,
  );
  if (!result.ok) {
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(`verify-production-package: ${err.message}`);
  process.exit(1);
}
