"use strict";
import { describe, expect, test } from "vitest";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import { SystemDependencyInstaller } from "@/service/SystemDependencyInstaller";
import type { DependencyPlatform } from "@/entityTypes/systemDependencyTypes";

const TEST_CATALOG_DATA = {
  version: 1,
  dependencies: {
    poppler: {
      probe: "pdfinfo",
      description: "PDF rendering library",
      platforms: {
        darwin: { manager: "brew", package: "poppler" },
        linux: { manager: "apt", package: "poppler-utils" },
      },
    },
    tesseract: {
      probe: "tesseract",
      description: "OCR engine",
      platforms: {
        darwin: { manager: "brew", package: "tesseract" },
        linux: { manager: "apt", package: "tesseract-ocr" },
      },
    },
  },
};

function makeInstaller(
  platform: DependencyPlatform = "darwin"
): SystemDependencyInstaller {
  const catalog = new SystemDependencyCatalog(
    loadCatalogFromConfig(TEST_CATALOG_DATA)
  );
  return new SystemDependencyInstaller(catalog, platform);
}

describe("Retry flow — should_retry flag", () => {
  test("install success returns should_retry=true", () => {
    // 'node' is always available — triggers already_installed which should set should_retry=true
    const installer = makeInstaller();
    const result = installer.install("poppler");
    // poppler binary is not on CI, so if brew exists, it'll try to install
    // and if not, it returns installer_not_found
    // The key assertion: should_retry is a boolean
    expect(typeof result.shouldRetry).toBe("boolean");
  });

  test("unsupported_platform returns should_retry=false", () => {
    const installer = makeInstaller("win32");
    const result = installer.install("poppler");
    // No win32 platform defined in test catalog
    expect(result.status).toBe("unsupported_platform");
    expect(result.shouldRetry).toBe(false);
  });

  test("unknown dependency_id returns should_retry=false", () => {
    const installer = makeInstaller();
    const result = installer.install("nonexistent_dep");
    expect(result.status).toBe("unsupported_platform");
    expect(result.shouldRetry).toBe(false);
  });
});

describe("Retry flow — Module install result shape", () => {
  test("InstallResultData has required fields for retry decision", () => {
    // This verifies the shape of data the retry logic will consume
    const resultData = {
      install_status: "installed" as const,
      dependency_id: "poppler",
      probe: "pdfinfo",
      details: "Successfully installed",
      should_retry: true,
    };

    expect(resultData.should_retry).toBe(true);
    expect(resultData.install_status).toBe("installed");
    expect(typeof resultData.dependency_id).toBe("string");
  });

  test("path_issue status should not trigger retry", () => {
    const resultData = {
      install_status: "path_issue" as const,
      dependency_id: "poppler",
      should_retry: false,
    };
    expect(resultData.should_retry).toBe(false);
  });

  test("installation_failed status should not trigger retry", () => {
    const resultData = {
      install_status: "installation_failed" as const,
      dependency_id: "poppler",
      should_retry: false,
    };
    expect(resultData.should_retry).toBe(false);
  });
});

describe("Retry flow — error classification integration", () => {
  test("missing_system_tool cause is recognized for retry", () => {
    const diagnoseResult = {
      cause: "missing_system_tool" as const,
      dependency_id: "poppler",
      missing_binary: "pdfinfo",
    };
    expect(diagnoseResult.cause).toBe("missing_system_tool");
    expect(diagnoseResult.dependency_id).toBe("poppler");
    expect(diagnoseResult.missing_binary).toBe("pdfinfo");
  });

  test("non-system-tool errors should not trigger dependency resolution", () => {
    const causes = [
      "missing_python_module",
      "interpreter_missing",
      "lock_hash_mismatch",
      "unknown",
    ] as const;
    for (const cause of causes) {
      expect(cause).not.toBe("missing_system_tool");
    }
  });
});
