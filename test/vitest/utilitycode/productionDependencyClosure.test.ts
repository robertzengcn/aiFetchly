import { describe, expect, test } from "vitest";
import path from "node:path";
import { loadPolicy } from "../../../scripts/lib/localAiRuntime/nativeDependencyPolicy.mjs";
import {
  verifyClosure,
  verifyClosureReport,
} from "../../../scripts/lib/localAiRuntime/productionClosure.mjs";

const POLICY_PATH = path.resolve(
  __dirname,
  "../../../config/native-dependency-policy.json"
);
const policy = loadPolicy(POLICY_PATH);

type DependencyClass = "production" | "development" | "optional" | "unknown";
interface TestPackage {
  name: string;
  version: string;
  dependencyClass: DependencyClass;
  sizeBytes: number;
}
interface TestInventory {
  schemaVersion: 1;
  artifactName: string;
  platform: string;
  arch: string;
  packages: TestPackage[];
  nativeFiles: {
    relativePath: string;
    format: string;
    detectedArch?: string;
    sizeBytes: number;
  }[];
}
interface ClosureReport {
  ok: boolean;
  report: string;
  violations: { code: string; message: string }[];
}

/** A clean win32-x64 inventory: required packages present, matching native. */
function cleanWin32Inventory(): TestInventory {
  return {
    schemaVersion: 1,
    artifactName: "app",
    platform: "win32",
    arch: "x64",
    packages: [
      {
        name: "better-sqlite3",
        version: "11.9.1",
        dependencyClass: "production",
        sizeBytes: 10,
      },
      {
        name: "sqlite-vec",
        version: "0.1.9",
        dependencyClass: "production",
        sizeBytes: 10,
      },
      {
        name: "sqlite-vec-windows-x64",
        version: "0.1.9",
        dependencyClass: "optional",
        sizeBytes: 10,
      },
    ],
    nativeFiles: [
      {
        relativePath: "better-sqlite3.node",
        format: "node-addon",
        detectedArch: "x64",
        sizeBytes: 10,
      },
      {
        relativePath: "vec0.dll",
        format: "pe",
        detectedArch: "x64",
        sizeBytes: 10,
      },
    ],
  };
}

describe("verifyClosure", () => {
  test("passes on a clean win32-x64 inventory", () => {
    const result = verifyClosure(cleanWin32Inventory(), policy, "win32", "x64");
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("fails when sqlite3 is present (forbidden)", () => {
    const inv = cleanWin32Inventory();
    inv.packages.push({
      name: "sqlite3",
      version: "5.1.7",
      dependencyClass: "production",
      sizeBytes: 10,
    });
    const result = verifyClosure(inv, policy, "win32", "x64");
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) =>
          v.code === "forbidden_package_present" &&
          v.message.includes("sqlite3")
      )
    ).toBe(true);
  });

  test("fails when a required package is missing", () => {
    const inv = cleanWin32Inventory();
    inv.packages = inv.packages.filter((p) => p.name !== "better-sqlite3");
    const result = verifyClosure(inv, policy, "win32", "x64");
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) =>
          v.code === "required_package_missing" &&
          v.message.includes("better-sqlite3")
      )
    ).toBe(true);
  });

  test("fails on a foreign-format native binary (mach-o in a win32 artifact)", () => {
    const inv = cleanWin32Inventory();
    inv.nativeFiles.push({
      relativePath: "suspicious.dylib",
      format: "mach-o",
      detectedArch: "arm64",
      sizeBytes: 10,
    });
    const result = verifyClosure(inv, policy, "win32", "x64");
    expect(result.ok).toBe(false);
    expect(
      result.violations.some((v) => v.code === "foreign_binary_format")
    ).toBe(true);
    expect(
      result.violations.some((v) => v.code === "foreign_binary_arch")
    ).toBe(true);
  });

  test("fails on a foreign-arch PE binary (arm64 in an x64 artifact)", () => {
    const inv = cleanWin32Inventory();
    inv.nativeFiles.push({
      relativePath: "arm.dll",
      format: "pe",
      detectedArch: "arm64",
      sizeBytes: 10,
    });
    const result = verifyClosure(inv, policy, "win32", "x64");
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) => v.code === "foreign_binary_arch" && v.message.includes("arm64")
      )
    ).toBe(true);
  });

  test("fails when a development-only dependency is shipped", () => {
    const inv = cleanWin32Inventory();
    inv.packages.push({
      name: "vite",
      version: "5.0.0",
      dependencyClass: "development",
      sizeBytes: 10,
    });
    const result = verifyClosure(inv, policy, "win32", "x64");
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) =>
          v.code === "development_dependency_shipped" &&
          v.message.includes("vite")
      )
    ).toBe(true);
  });

  test("a foreign sherpa platform package is forbidden on the wrong target", () => {
    const inv = cleanWin32Inventory();
    inv.packages.push({
      name: "sherpa-onnx-darwin-arm64",
      version: "1.13.4",
      dependencyClass: "optional",
      sizeBytes: 10,
    });
    const result = verifyClosure(inv, policy, "win32", "x64");
    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) =>
          v.code === "forbidden_package_present" &&
          v.message.includes("sherpa-onnx-darwin-arm64")
      )
    ).toBe(true);
  });

  test("verifyClosureReport produces a human-readable PASS/FAIL report", () => {
    const pass = verifyClosureReport(
      cleanWin32Inventory(),
      policy,
      "win32",
      "x64"
    ) as unknown as ClosureReport;
    expect(pass.report).toContain("PASS");
    const inv = cleanWin32Inventory();
    inv.packages.push({
      name: "sqlite3",
      version: "5.1.7",
      dependencyClass: "production",
      sizeBytes: 10,
    });
    const fail = verifyClosureReport(
      inv,
      policy,
      "win32",
      "x64"
    ) as unknown as ClosureReport;
    expect(fail.report).toContain("FAIL");
    expect(fail.report).toContain("forbidden_package_present");
  });
});

describe("verifyClosure — active exception suppresses a forbidden package", () => {
  test("a non-expired exception for sqlite3 suppresses the violation", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const policyWithException = {
      ...policy,
      reviewedDevelopmentExceptions: [
        {
          package: "sqlite3",
          reason: "temporary migration",
          owner: "release",
          expiresAt: future,
        },
      ],
    };
    const inv = cleanWin32Inventory();
    inv.packages.push({
      name: "sqlite3",
      version: "5.1.7",
      dependencyClass: "production",
      sizeBytes: 10,
    });
    const result = verifyClosure(inv, policyWithException, "win32", "x64");
    expect(result.violations.some((v) => v.message.includes("sqlite3"))).toBe(
      false
    );
  });
});
