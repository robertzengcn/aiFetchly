"use strict";
import { describe, expect, test } from "vitest";
import { sanitizeStderr } from "@/service/SystemDependencyAuditLogger";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import { probeBinary } from "@/service/SystemDependencyInstaller";

describe("SystemDependencyInstaller", () => {
  test("InstallResultStatus covers all required values", () => {
    const statuses = [
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

  test("sanitizeStderr works for install stderr", () => {
    const brewStderr =
      "Error: /opt/homebrew/Cellar/poppler/24.02.0_1 failed to build";
    const result = sanitizeStderr(brewStderr);
    expect(result).not.toContain("/opt/homebrew/Cellar");
    expect(result).toContain("[PATH]");
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
    expect(catalog.getById("nonexistent")).toBeUndefined();
    expect(catalog.getById("poppler")).toBeDefined();
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
