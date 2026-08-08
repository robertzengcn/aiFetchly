#!/usr/bin/env node
/**
 * Installer size regression gate (PRD §18/§24, design §18).
 *
 * Compares a built installer's size against a checked-in baseline (captured
 * from the last release) and fails when the artifact grew. An optional
 * pre-slim baseline + required-reduction percentage enforces the >=15% size
 * cut at the slim release.
 *
 * Usage:
 *   node scripts/check-installer-size.mjs \
 *     --artifact <installer-file> --baseline config/installer-size-baseline.json \
 *     [--artifact-key <name>] [--max-growth-percent 0] \
 *     [--pre-slim-baseline <bytes> --require-reduction-percent 15]
 *
 * The baseline file maps artifact keys to { sizeBytes }. Exits nonzero on
 * regression.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Pure size comparison. Returns ok=false when the current size exceeds the
 * baseline by more than the allowed growth fraction.
 */
export function compareInstallerSize(currentBytes, baselineBytes, options = {}) {
  const maxGrowthFraction = (options.maxGrowthPercent ?? 0) / 100;
  const deltaBytes = currentBytes - baselineBytes;
  const deltaPercent = baselineBytes > 0 ? (deltaBytes / baselineBytes) * 100 : 0;
  const ok = currentBytes <= baselineBytes * (1 + maxGrowthFraction);
  return { ok, currentBytes, baselineBytes, deltaBytes, deltaPercent };
}

/**
 * Enforce a minimum reduction vs a pre-slim baseline (PRD goal #1: >=15%).
 * Returns ok=false when the current size is not at least `requiredPercent`
 * smaller than the pre-slim baseline.
 */
export function checkReductionVsPreSlim(currentBytes, preSlimBytes, requiredPercent) {
  if (!preSlimBytes || preSlimBytes <= 0) {
    return { ok: true, skipped: true, reductionPercent: 0 };
  }
  const reductionPercent = ((preSlimBytes - currentBytes) / preSlimBytes) * 100;
  return { ok: reductionPercent >= requiredPercent, skipped: false, reductionPercent };
}

function parseArgs(argv) {
  const a = {
    artifact: null, baseline: null, artifactKey: null,
    maxGrowthPercent: 0, preSlimBaseline: null, requireReductionPercent: 15,
  };
  for (let i = 2; i < argv.length; i += 2) {
    switch (argv[i]) {
      case "--artifact": a.artifact = argv[i + 1]; break;
      case "--baseline": a.baseline = argv[i + 1]; break;
      case "--artifact-key": a.artifactKey = argv[i + 1]; break;
      case "--max-growth-percent": a.maxGrowthPercent = Number(argv[i + 1]); break;
      case "--pre-slim-baseline": a.preSlimBaseline = Number(argv[i + 1]); break;
      case "--require-reduction-percent": a.requireReductionPercent = Number(argv[i + 1]); break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!a.artifact || !a.baseline) {
    throw new Error("Usage: --artifact <file> --baseline <file.json> [--artifact-key <name>]");
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  const currentBytes = statSync(args.artifact).size;
  const baselineMap = JSON.parse(readFileSync(args.baseline, "utf-8"));
  const key = args.artifactKey || args.artifact.split("/").pop();
  const entry = baselineMap[key] ?? baselineMap[args.artifact];
  if (!entry) {
    throw new Error(`No baseline entry for "${key}". Known: ${Object.keys(baselineMap).join(", ")}`);
  }
  const baselineBytes = entry.sizeBytes ?? entry;

  const cmp = compareInstallerSize(currentBytes, baselineBytes, { maxGrowthPercent: args.maxGrowthPercent });
  const lines = [
    `Installer size: ${currentBytes} bytes (${key})`,
    `Baseline:       ${baselineBytes} bytes → delta ${cmp.deltaBytes >= 0 ? "+" : ""}${cmp.deltaBytes} (${cmp.deltaPercent.toFixed(1)}%)`,
  ];
  let ok = cmp.ok;

  if (args.preSlimBaseline) {
    const red = checkReductionVsPreSlim(currentBytes, args.preSlimBaseline, args.requireReductionPercent);
    if (!red.skipped) {
      lines.push(`Pre-slim:        ${args.preSlimBaseline} bytes → reduction ${(100 - red.reductionPercent).toFixed(1)}% (require >=${args.requireReductionPercent}%)`);
      ok = ok && red.ok;
    }
  }

  lines.push(ok ? "SIZE GATE: PASS" : "SIZE GATE: FAIL");
  console.log(lines.join("\n"));
  if (!ok) process.exit(1);
}

export function isDirectExecution(metaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return pathToFileURL(path.resolve(argvPath)).href === metaUrl;
}

const isMain = isDirectExecution(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`check-installer-size: ${err.message}`);
    process.exit(1);
  }
}
