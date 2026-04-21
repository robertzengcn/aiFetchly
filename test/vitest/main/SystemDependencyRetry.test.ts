"use strict";
import { describe, expect, test } from "vitest";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import { SystemDependencyResolver } from "@/service/SystemDependencyResolver";
import { SkillDiagnosticsService } from "@/service/SkillDiagnosticsService";
import { probeBinary } from "@/service/SystemDependencyInstaller";
import type { SkillManifest } from "@/entityTypes/skillTypes";

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

function makeTestResolver(): SystemDependencyResolver {
  const catalog = new SystemDependencyCatalog(
    loadCatalogFromConfig(TEST_CATALOG_DATA)
  );
  return new SystemDependencyResolver(catalog);
}

describe("SystemDependencyRetry — resolve phase", () => {
  test("diagnoseStderr identifies missing_system_tool for PDFInfoNotInstalledError", () => {
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(
      "PDFInfoNotInstalledError: Unable to get page count."
    );
    expect(diagnosis.cause).toBe("missing_system_tool");
    expect(diagnosis.dependency_id).toBe("poppler");
    expect(diagnosis.missing_binary).toBe("pdfinfo");
  });

  test("diagnoseStderr identifies missing_system_tool for ffmpeg not found", () => {
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(
      "/bin/sh: ffmpeg: command not found"
    );
    expect(diagnosis.cause).toBe("missing_system_tool");
    expect(diagnosis.dependency_id).toBe("ffmpeg");
  });

  test("diagnoseStderr returns unknown for non-system errors", () => {
    const diagnosis = SkillDiagnosticsService.diagnoseStderr(
      "ModuleNotFoundError: No module named 'pdf2image'"
    );
    expect(diagnosis.cause).toBe("missing_python_module");
    expect(diagnosis.dependency_id).toBeUndefined();
  });

  test("resolver resolves known dependency from catalog", () => {
    const resolver = makeTestResolver();
    const result = resolver.resolve({
      stderr: "PDFInfoNotInstalledError: Unable to get page count.",
      platform: "darwin",
    });
    expect(result.resolved).toBe(true);
    expect(result.dependency_id).toBe("poppler");
    expect(result.platform_candidates?.darwin?.manager).toBe("brew");
    expect(result.platform_candidates?.darwin?.package).toBe("poppler");
  });

  test("resolver returns not-resolved for unknown dependency", () => {
    const resolver = makeTestResolver();
    const result = resolver.resolve({
      stderr: "Random unrelated error",
      platform: "darwin",
    });
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test("resolver gives higher confidence with manifest hint", () => {
    const resolver = makeTestResolver();
    const manifest: SkillManifest = {
      name: "pdf-skill",
      version: "1.0.0",
      description: "PDF skill",
      runtime: "python",
      entry: "run.py",
      parameters: { type: "object", properties: {} },
      python: {
        version: ">=3.10",
        requirements_file: "requirements.txt",
        system: [{ name: "poppler", probe: "pdfinfo" }],
      },
    };

    const withoutManifest = resolver.resolve({
      stderr: "PDFInfoNotInstalledError",
      platform: "darwin",
    });
    const withManifest = resolver.resolve({
      stderr: "PDFInfoNotInstalledError",
      manifest,
      platform: "darwin",
    });

    expect(withManifest.confidence).toBeGreaterThan(withoutManifest.confidence);
    expect(withManifest.requires_manual_review).toBe(false);
    expect(withoutManifest.requires_manual_review).toBe(true);
  });
});

describe("SystemDependencyRetry — install phase contract", () => {
  test("probeBinary returns true for existing binary", () => {
    // 'node' exists in any Node.js environment
    expect(probeBinary("node")).toBe(true);
  });

  test("probeBinary returns false for nonexistent binary", () => {
    expect(probeBinary("nonexistent_binary_xyz_12345")).toBe(false);
  });

  test("catalog blocks unknown dependency_id from install", () => {
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig(TEST_CATALOG_DATA)
    );
    expect(catalog.getById("nonexistent")).toBeUndefined();
    expect(catalog.getById("poppler")).toBeDefined();
    expect(catalog.getPlatformCandidate("poppler", "darwin")).toBeDefined();
  });
});
