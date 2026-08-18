/**
 * Production-closure verifier (PRD FR-23/FR-26, design §26.5).
 *
 * Runs the release-blocking gates against a package/native inventory + target
 * policy: no `sqlite3`, no forbidden foreign-target package, every required
 * native package present, no foreign-format/foreign-arch native binary, no
 * unapproved development-only dependency. Returns a structured result so CI can
 * print each violation and exit nonzero.
 *
 * Pure (no disk access) so it is fully unit-testable.
 */
import {
  getTargetPolicy,
  isPackageForbidden,
  isPackageRequired,
  hasActiveException,
} from "./nativeDependencyPolicy.mjs";

/**
 * @param {object} inventory  buildInventory() result
 * @param {object} policy     loadPolicy() result
 * @param {string} platform   e.g. "win32"
 * @param {string} arch       e.g. "x64"
 * @returns {{ ok: boolean, target: string, violations: Array<{code:string,message:string}> }}
 */
export function verifyClosure(inventory, policy, platform, arch) {
  const targetPolicy = getTargetPolicy(policy, platform, arch);
  const targetArch = arch;
  const exceptions = policy.reviewedDevelopmentExceptions ?? [];
  const violations = [];

  const packages = inventory.packages ?? [];
  const nativeFiles = inventory.nativeFiles ?? [];

  for (const pkg of packages) {
    const forbidden = isPackageForbidden(pkg.name, targetPolicy.forbiddenPackagePatterns);
    const exempt = hasActiveException(pkg.name, exceptions);
    if (forbidden && !exempt) {
      violations.push({
        code: "forbidden_package_present",
        message: `Forbidden package for ${platform}-${arch}: ${pkg.name}`,
      });
    }
    if (pkg.dependencyClass === "development" && !exempt) {
      violations.push({
        code: "development_dependency_shipped",
        message: `Development-only dependency shipped: ${pkg.name}`,
      });
    }
  }

  const shippedPackageNames = new Set(packages.map((p) => p.name));
  for (const required of targetPolicy.requiredPackages) {
    if (!shippedPackageNames.has(required)) {
      violations.push({
        code: "required_package_missing",
        message: `Required native package missing for ${platform}-${arch}: ${required}`,
      });
    }
  }

  for (const file of nativeFiles) {
    // Foreign-format gate: a target must not ship binaries of another OS's format.
    if (file.format !== "unknown" && file.format !== "node-addon") {
      if (!targetPolicy.allowedBinaryFormats.includes(file.format)) {
        violations.push({
          code: "foreign_binary_format",
          message: `Native binary with foreign format (${file.format}) for ${platform}-${arch}: ${file.relativePath}`,
        });
      }
    }
    // Foreign-arch gate: a known-arch binary that is not the target arch.
    if (file.detectedArch && file.detectedArch !== targetArch) {
      violations.push({
        code: "foreign_binary_arch",
        message: `Native binary with foreign arch (${file.detectedArch}) for ${platform}-${arch}: ${file.relativePath}`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    target: `${platform}-${arch}`,
    violations,
  };
}

/**
 * Convenience: run verifyClosure and format a human-readable report string.
 * Returns the result with an added `report` field; callers exit nonzero when
 * `ok` is false.
 */
export function verifyClosureReport(inventory, policy, platform, arch) {
  const result = verifyClosure(inventory, policy, platform, arch);
  const lines = [`Production-closure verification for ${platform}-${arch}: ${result.ok ? "PASS" : "FAIL"}`];
  for (const v of result.violations) {
    lines.push(`  [${v.code}] ${v.message}`);
  }
  result.report = lines.join("\n");
  return result;
}
