"use strict";
import { describe, expect, test } from "vitest";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";

const TEST_CATALOG = {
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
  },
};

describe("SystemDependencyCatalog", () => {
  const catalog = new SystemDependencyCatalog(TEST_CATALOG);

  test("lookup by dependency_id returns correct entry", () => {
    const entry = catalog.getById("poppler");
    expect(entry).toBeDefined();
    expect(entry?.probe).toBe("pdfinfo");
    expect(entry?.description).toBe("PDF rendering library");
  });

  test("lookup by dependency_id returns undefined for unknown", () => {
    const entry = catalog.getById("nonexistent");
    expect(entry).toBeUndefined();
  });

  test("lookup by probe binary returns correct entry", () => {
    const entry = catalog.getByProbe("pdfinfo");
    expect(entry).toBeDefined();
    expect(entry?.dependency_id).toBe("poppler");
  });

  test("lookup by probe binary returns undefined for unknown", () => {
    const entry = catalog.getByProbe("nonexistent-binary");
    expect(entry).toBeUndefined();
  });

  test("platform candidate returns correct brew info on darwin", () => {
    const candidate = catalog.getPlatformCandidate("poppler", "darwin");
    expect(candidate).toBeDefined();
    expect(candidate?.manager).toBe("brew");
    expect(candidate?.package).toBe("poppler");
  });

  test("platform candidate returns correct apt info on linux", () => {
    const candidate = catalog.getPlatformCandidate("poppler", "linux");
    expect(candidate).toBeDefined();
    expect(candidate?.manager).toBe("apt");
    expect(candidate?.package).toBe("poppler-utils");
  });

  test("platform candidate returns undefined for unsupported platform", () => {
    const candidate = catalog.getPlatformCandidate("tesseract", "win32");
    expect(candidate).toBeUndefined();
  });

  test("platform candidate returns undefined for unknown dependency", () => {
    const candidate = catalog.getPlatformCandidate("nonexistent", "darwin");
    expect(candidate).toBeUndefined();
  });

  test("all dependency IDs are enumerable", () => {
    const ids = catalog.getAllIds();
    expect(ids).toContain("poppler");
    expect(ids).toContain("tesseract");
    expect(ids).toHaveLength(2);
  });
});

describe("loadCatalogFromConfig", () => {
  test("validates catalog version", () => {
    const bad = { version: 999, dependencies: {} };
    expect(() => loadCatalogFromConfig(bad)).toThrow(/version/i);
  });

  test("validates required fields in dependency entry", () => {
    const bad = {
      version: 1,
      dependencies: {
        foo: { description: "missing probe and platforms" },
      },
    };
    expect(() => loadCatalogFromConfig(bad)).toThrow();
  });

  test("accepts valid catalog", () => {
    expect(() => loadCatalogFromConfig(TEST_CATALOG)).not.toThrow();
  });
});
