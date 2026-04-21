"use strict";
import { describe, expect, test } from "vitest";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import { SystemDependencyResolver } from "@/service/SystemDependencyResolver";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";

const TEST_CATALOG_DATA = {
  version: 1,
  dependencies: {
    poppler: {
      probe: "pdfinfo",
      description: "PDF rendering library",
      platforms: {
        darwin: { manager: "brew", package: "poppler" },
        linux: { manager: "apt", package: "poppler-utils" },
        win32: { manager: "winget", package: "GnuWin32.Poppler" },
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
    ffmpeg: {
      probe: "ffmpeg",
      description: "Multimedia framework",
      platforms: {
        darwin: { manager: "brew", package: "ffmpeg" },
        linux: { manager: "apt", package: "ffmpeg" },
        win32: { manager: "winget", package: "Gyan.FFmpeg" },
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

const popplerManifest: SkillManifest = {
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

describe("SystemDependencyResolver", () => {
  const resolver = makeTestResolver();

  test("resolves PDFInfoNotInstalledError with manifest → high confidence", () => {
    const result = resolver.resolve({
      stderr: "PDFInfoNotInstalledError: Unable to get page count.",
      manifest: popplerManifest,
      platform: "darwin",
    });
    expect(result.resolved).toBe(true);
    expect(result.dependency_id).toBe("poppler");
    expect(result.missing_binary).toBe("pdfinfo");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.requires_manual_review).toBe(false);
    expect(result.platform_candidates).toBeDefined();
    expect(result.platform_candidates?.darwin?.manager).toBe("brew");
  });

  test("resolves known error without manifest → moderate confidence, manual review", () => {
    const result = resolver.resolve({
      stderr: "PDFInfoNotInstalledError: Unable to get page count.",
      platform: "darwin",
    });
    expect(result.resolved).toBe(true);
    expect(result.dependency_id).toBe("poppler");
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.requires_manual_review).toBe(true);
  });

  test("non-system-tool error → not resolved", () => {
    const result = resolver.resolve({
      stderr: "ModuleNotFoundError: No module named 'pdf2image'",
      platform: "darwin",
    });
    expect(result.resolved).toBe(false);
    expect(result.dependency_id).toBeUndefined();
    expect(result.confidence).toBe(0);
  });

  test("unknown stderr → not resolved", () => {
    const result = resolver.resolve({
      stderr: "Something completely unrelated",
      platform: "darwin",
    });
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test("missing system dep with manifest → resolved from manifest", () => {
    const result = resolver.resolve({
      stderr: "Missing system dependency: pdfinfo not found",
      manifest: popplerManifest,
      platform: "darwin",
    });
    expect(result.resolved).toBe(true);
    expect(result.dependency_id).toBe("poppler");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("dependency_id not in catalog → not resolved", () => {
    const manifest: SkillManifest = {
      name: "custom-skill",
      version: "1.0.0",
      description: "d",
      runtime: "python",
      entry: "run.py",
      parameters: { type: "object", properties: {} },
      python: {
        version: ">=3.10",
        requirements_file: "requirements.txt",
        system: [{ name: "nonexistent-tool", probe: "nonexistent" }],
      },
    };
    const result = resolver.resolve({
      stderr: "Missing system dependency: nonexistent not found",
      manifest,
      platform: "darwin",
    });
    // Manifest gives a dependency_id but catalog doesn't have it
    expect(result.resolved).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test("ffmpeg not found → resolved as ffmpeg", () => {
    const result = resolver.resolve({
      stderr: "/bin/sh: ffmpeg: command not found",
      platform: "linux",
    });
    expect(result.resolved).toBe(true);
    expect(result.dependency_id).toBe("ffmpeg");
  });

  test("platform candidates populated for all platforms", () => {
    const result = resolver.resolve({
      stderr: "PDFInfoNotInstalledError",
      manifest: popplerManifest,
      platform: "darwin",
    });
    expect(result.platform_candidates?.darwin).toBeDefined();
    expect(result.platform_candidates?.linux).toBeDefined();
    expect(result.platform_candidates?.win32).toBeDefined();
  });
});
