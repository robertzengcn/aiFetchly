import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  loadPolicy,
  parsePolicy,
  getTargetPolicy,
  isPackageForbidden,
  isPackageRequired,
  hasActiveException,
  nativeDependencyPolicySchema,
} from "../../../scripts/lib/localAiRuntime/nativeDependencyPolicy.mjs";

const POLICY_PATH = path.resolve(
  __dirname,
  "../../../config/native-dependency-policy.json"
);

describe("native-dependency policy", () => {
  test("the checked-in policy loads and validates", () => {
    const policy = loadPolicy(POLICY_PATH);
    expect(policy.schemaVersion).toBe(1);
    expect(policy.targets["win32-x64"]).toBeDefined();
    expect(policy.targets["darwin-arm64"]).toBeDefined();
  });

  test("parsePolicy rejects an invalid schema", () => {
    expect(() => parsePolicy({ schemaVersion: 99 })).toThrow();
    expect(() =>
      parsePolicy({
        schemaVersion: 1,
        targets: {},
        reviewedDevelopmentExceptions: [],
      })
    ).toThrow();
  });

  test("nativeDependencyPolicySchema is exported for reuse", () => {
    expect(typeof nativeDependencyPolicySchema.parse).toBe("function");
  });

  test("getTargetPolicy returns per-target entries and throws on unknown", () => {
    const policy = loadPolicy(POLICY_PATH);
    expect(getTargetPolicy(policy, "win32", "x64").requiredPackages).toContain(
      "better-sqlite3"
    );
    expect(() => getTargetPolicy(policy, "linux", "x64")).toThrow();
  });
});

describe("isPackageForbidden (foreign-target isolation)", () => {
  const policy = loadPolicy(POLICY_PATH);

  test("sqlite3 is forbidden on every target", () => {
    for (const entry of Object.values(policy.targets)) {
      expect(
        isPackageForbidden("sqlite3", entry.forbiddenPackagePatterns)
      ).toBe(true);
      expect(
        isPackageForbidden("@types/sqlite3", entry.forbiddenPackagePatterns)
      ).toBe(true);
    }
  });

  test("win32-x64 forbids foreign sherpa/sqlite-vec variants but allows the matching one", () => {
    const patterns = policy.targets["win32-x64"].forbiddenPackagePatterns;
    expect(isPackageForbidden("sherpa-onnx-darwin-arm64", patterns)).toBe(true);
    expect(isPackageForbidden("sherpa-onnx-linux-x64", patterns)).toBe(true);
    expect(isPackageForbidden("sqlite-vec-darwin-x64", patterns)).toBe(true);
    // The matching variants are NOT forbidden.
    expect(isPackageForbidden("sherpa-onnx-win-x64", patterns)).toBe(false);
    expect(isPackageForbidden("sqlite-vec-windows-x64", patterns)).toBe(false);
  });

  test("darwin-arm64 allows its matching variants, forbids the others", () => {
    const patterns = policy.targets["darwin-arm64"].forbiddenPackagePatterns;
    expect(isPackageForbidden("sqlite-vec-darwin-arm64", patterns)).toBe(false);
    expect(isPackageForbidden("sherpa-onnx-darwin-arm64", patterns)).toBe(
      false
    );
    expect(isPackageForbidden("sqlite-vec-darwin-x64", patterns)).toBe(true);
    expect(isPackageForbidden("sherpa-onnx-win-x64", patterns)).toBe(true);
  });
});

describe("isPackageRequired + hasActiveException", () => {
  const policy = loadPolicy(POLICY_PATH);

  test("isPackageRequired exact-matches the required list", () => {
    expect(
      isPackageRequired(
        "better-sqlite3",
        policy.targets["win32-x64"].requiredPackages
      )
    ).toBe(true);
    expect(
      isPackageRequired("sqlite3", policy.targets["win32-x64"].requiredPackages)
    ).toBe(false);
  });

  test("hasActiveException respects expiry", () => {
    const future = new Date(Date.now() + 10_000).toISOString();
    const past = new Date(Date.now() - 10_000).toISOString();
    const exceptions = [
      { package: "sqlite3", reason: "temp", owner: "rel", expiresAt: future },
      { package: "old", reason: "temp", owner: "rel", expiresAt: past },
    ];
    expect(hasActiveException("sqlite3", exceptions)).toBe(true);
    expect(hasActiveException("old", exceptions)).toBe(false);
    expect(hasActiveException("absent", exceptions)).toBe(false);
  });
});
