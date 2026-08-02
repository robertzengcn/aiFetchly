import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  utilityProcess: {
    fork: vi.fn(),
  },
}));

import { WebsiteContentScrapeService } from "@/service/WebsiteContentScrapeService";

describe("WebsiteContentScrapeService worker path resolution", () => {
  it("resolves the local dist childprocess worker used by Vite worker builds", () => {
    const expected = path.join(
      "/repo",
      "dist",
      "childprocess",
      "websiteContentScraper.js"
    );

    const resolved = WebsiteContentScrapeService.resolveChildProcessPath({
      dirname: path.join("/repo", ".vite", "build"),
      cwd: "/repo",
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("resolves the unpacked packaged worker when running from app.asar", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const expected = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "dist",
      "childprocess",
      "websiteContentScraper.js"
    );

    const resolved = WebsiteContentScrapeService.resolveChildProcessPath({
      dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
      cwd: "/tmp",
      resourcesPath,
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("maps Windows app.asar paths to the app.asar.unpacked mirror", () => {
    const packedPath =
      "E:\\aifetchly\\app-1.0.123\\resources\\app.asar\\.vite\\build\\childprocess\\websiteContentScraper.js";

    expect(
      WebsiteContentScrapeService.mirrorAppAsarUnpackedPath(packedPath)
    ).toBe(
      "E:\\aifetchly\\app-1.0.123\\resources\\app.asar.unpacked\\.vite\\build\\childprocess\\websiteContentScraper.js"
    );
  });
});
