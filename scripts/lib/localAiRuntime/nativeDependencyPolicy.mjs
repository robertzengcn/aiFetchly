/**
 * Native dependency policy loader + matchers (PRD FR-21, design §26.3).
 *
 * Pure, importable by both the CI CLI scripts (scripts/*.mjs) and the vitest
 * suite (test/vitest/utilitycode). The policy pins, per build target, which
 * native packages are required, which foreign-target packages are forbidden,
 * the allowed on-disk binary formats, and the modules needing an Electron-ABI
 * rebuild.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import picomatch from "picomatch";

export const TARGET_KEYS = ["win32-x64", "darwin-x64", "darwin-arm64"];

export const nativeDependencyPolicySchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  targets: z
    .object({
      "win32-x64": z.object({
        requiredPackages: z.array(z.string().min(1)),
        forbiddenPackagePatterns: z.array(z.string().min(1)),
        allowedBinaryFormats: z.array(z.enum(["pe", "mach-o", "elf", "node-addon"])),
        rebuildModules: z.array(z.string().min(1)),
      }),
      "darwin-x64": z.object({
        requiredPackages: z.array(z.string().min(1)),
        forbiddenPackagePatterns: z.array(z.string().min(1)),
        allowedBinaryFormats: z.array(z.enum(["pe", "mach-o", "elf", "node-addon"])),
        rebuildModules: z.array(z.string().min(1)),
      }),
      "darwin-arm64": z.object({
        requiredPackages: z.array(z.string().min(1)),
        forbiddenPackagePatterns: z.array(z.string().min(1)),
        allowedBinaryFormats: z.array(z.enum(["pe", "mach-o", "elf", "node-addon"])),
        rebuildModules: z.array(z.string().min(1)),
      }),
    })
    .required(),
  reviewedDevelopmentExceptions: z
    .array(
      z.object({
        package: z.string().min(1),
        reason: z.string().min(1),
        owner: z.string().min(1),
        expiresAt: z.string().min(1),
      }),
    )
    .default([]),
});

/**
 * Validate a parsed policy object. Throws on an invalid policy so CI fails
 * closed rather than packaging with an unenforced config.
 */
export function parsePolicy(value) {
  return nativeDependencyPolicySchema.parse(value);
}

/** Read + validate the policy JSON from disk. */
export function loadPolicy(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  return parsePolicy(JSON.parse(raw));
}

/** Compose the `<platform>-<arch>` target key and return its policy entry. */
export function getTargetPolicy(policy, platform, arch) {
  const key = `${platform}-${arch}`;
  const entry = policy.targets[key];
  if (!entry) {
    throw new Error(
      `No native dependency policy for target ${key}. Known: ${TARGET_KEYS.join(", ")}.`,
    );
  }
  return entry;
}

/** True iff `packageName` matches any forbidden glob pattern (picomatch). */
export function isPackageForbidden(packageName, forbiddenPackagePatterns) {
  if (!Array.isArray(forbiddenPackagePatterns) || forbiddenPackagePatterns.length === 0) {
    return false;
  }
  return picomatch(forbiddenPackagePatterns)(packageName);
}

/** True iff `packageName` is in the exact required list. */
export function isPackageRequired(packageName, requiredPackages) {
  return Array.isArray(requiredPackages) && requiredPackages.includes(packageName);
}

/**
 * True iff `packageName` is covered by a reviewed development-exception
 * (design §4.12 / FR-23). Exceptions expire; an expired exception is ignored.
 */
export function hasActiveException(packageName, exceptions, now = Date.now()) {
  return (exceptions ?? []).some((ex) => {
    if (ex.package !== packageName) return false;
    const expiresAt = Date.parse(ex.expiresAt ?? "");
    return Number.isNaN(expiresAt) ? false : expiresAt >= now;
  });
}
