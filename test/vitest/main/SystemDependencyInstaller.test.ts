"use strict";
import { describe, expect, test } from "vitest";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import { SystemDependencyInstaller, probeBinary } from "@/service/SystemDependencyInstaller";
import type { DependencyPlatform, InstallResultStatus } from "@/entityTypes/systemDependencyTypes";

describe("SystemDependencyInstaller", () => {
  test("InstallResultStatus covers all required values", () => {
    const statuses: InstallResultStatus[] = [
      "installed",
      "already_installed",
      "permission_denied",
      "installer_not_found",
      "unsupported_platform",
      "path_issue",
      "installation_failed",
    ];
    for (const s of statuses) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });

  test("catalog validation blocks unknown dependency_id", () => {
    const catalogData = {
      version: 1,
      dependencies: {
        poppler: {
          probe: "pdfinfo",
          description: "PDF lib",
          platforms: { darwin: { manager: "brew", package: "poppler" } },
        },
      },
    };
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig(catalogData)
    );
    const installer = new SystemDependencyInstaller(catalog, "darwin");
    const result = installer.install("nonexistent");
    expect(result.status).toBe("unsupported_platform");
    expect(result.shouldRetry).toBe(false);
  });

  test("unsupported platform returns should_retry=false", () => {
    const catalogData = {
      version: 1,
      dependencies: {
        poppler: {
          probe: "pdfinfo",
          description: "PDF lib",
          platforms: { darwin: { manager: "brew", package: "poppler" } },
        },
      },
    };
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig(catalogData)
    );
    const installer = new SystemDependencyInstaller(catalog, "win32");
    const result = installer.install("poppler");
    expect(result.status).toBe("unsupported_platform");
    expect(result.shouldRetry).toBe(false);
  });
});

describe("probeBinary", () => {
  test("returns false for nonexistent binary", () => {
    const result = probeBinary("nonexistent_binary_xyz_12345");
    expect(result).toBe(false);
  });

  test("returns true for existing binary", () => {
    // 'node' should exist in any Node.js environment
    const result = probeBinary("node");
    expect(result).toBe(true);
  });
});
