"use strict";
import { expect } from "chai";
import type { SkillManifest } from "@/entityTypes/skillTypes";
import {
  SystemDependencyCatalog,
  loadCatalogFromConfig,
} from "@/service/SystemDependencyCatalog";
import { SystemDependencyResolver } from "@/service/SystemDependencyResolver";

describe("SystemDependencyModule.resolve()", () => {
  it("resolve with known failure returns recommendation with platform_candidates", () => {
    // Unit test — module.resolve delegates to resolver
    // We verify the contract: known stderr + manifest → resolved with candidates
    const input = {
      stderr: "PDFInfoNotInstalledError: Unable to get page count.",
      manifest: {
        name: "pdf-skill",
        version: "1.0.0",
        description: "d",
        runtime: "python",
        entry: "run.py",
        parameters: { type: "object", properties: {} },
        python: {
          version: ">=3.10",
          requirements_file: "requirements.txt",
          system: [{ name: "poppler", probe: "pdfinfo" }],
        },
      } as SkillManifest,
      platform: "darwin" as NodeJS.Platform,
    };

    const catalogData = {
      version: 1,
      dependencies: {
        poppler: {
          probe: "pdfinfo",
          description: "PDF lib",
          platforms: {
            darwin: { manager: "brew", package: "poppler" },
            linux: { manager: "apt", package: "poppler-utils" },
          },
        },
      },
    };
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig(catalogData)
    );
    const resolver = new SystemDependencyResolver(catalog);
    const result = resolver.resolve(input);

    expect(result.resolved).to.equal(true);
    expect(result.dependency_id).to.equal("poppler");
    expect(result.platform_candidates?.darwin).to.not.equal(undefined);
    expect(result.requires_manual_review).to.equal(false);
  });

  it("resolve with low confidence flags manual review", () => {
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
    const resolver = new SystemDependencyResolver(catalog);

    // No manifest → pattern-only match → lower confidence
    const result = resolver.resolve({
      stderr: "PDFInfoNotInstalledError",
      platform: "darwin" as NodeJS.Platform,
    });

    expect(result.resolved).to.equal(true);
    expect(result.requires_manual_review).to.equal(true);
  });

  it("resolve with unknown error returns not-resolved", () => {
    const catalogData = {
      version: 1,
      dependencies: {},
    };
    const catalog = new SystemDependencyCatalog(
      loadCatalogFromConfig(catalogData)
    );
    const resolver = new SystemDependencyResolver(catalog);

    const result = resolver.resolve({
      stderr: "Random unrelated error",
      platform: "darwin" as NodeJS.Platform,
    });

    expect(result.resolved).to.equal(false);
    expect(result.confidence).to.equal(0);
  });
});
