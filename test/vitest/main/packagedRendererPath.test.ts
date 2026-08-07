/**
 * Unit tests for packaged renderer HTML path resolution.
 *
 * Regression: Windows packaged apps failed to start with
 * ERR_FAILED (-2) loading
 * `.../app.asar/.vite/renderer/main_window/index.html` when the
 * renderer was asar-unpacked (Chromium cannot load unpacked files
 * via the virtual asar URL).
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import {
  preferUnpackedRendererPath,
  getPackagedRendererHtmlCandidates,
  resolvePackagedRendererHtmlPath,
} from "@/utils/packagedRendererPath";

describe("preferUnpackedRendererPath", () => {
  it("maps Windows app.asar renderer paths to app.asar.unpacked when present", () => {
    const asarPath =
      "E:\\aifetchly\\app-1.0.165\\resources\\app.asar\\.vite\\renderer\\main_window\\index.html";
    const unpackedPath =
      "E:\\aifetchly\\app-1.0.165\\resources\\app.asar.unpacked\\.vite\\renderer\\main_window\\index.html";

    const resolved = preferUnpackedRendererPath(
      asarPath,
      (candidate) => path.normalize(candidate) === path.normalize(unpackedPath)
    );

    expect(path.normalize(resolved)).toBe(path.normalize(unpackedPath));
  });

  it("keeps the asar path when the unpacked mirror does not exist", () => {
    const asarPath =
      "/opt/AiFetchly/resources/app.asar/.vite/renderer/main_window/index.html";

    const resolved = preferUnpackedRendererPath(asarPath, () => false);

    expect(path.normalize(resolved)).toBe(path.normalize(asarPath));
  });
});

describe("resolvePackagedRendererHtmlPath", () => {
  it("prefers the unpacked renderer when both asar and unpacked exist", () => {
    const resourcesPath = "E:\\aifetchly\\app-1.0.165\\resources";
    const asarHtml = path.join(
      resourcesPath,
      "app.asar",
      ".vite",
      "renderer",
      "main_window",
      "index.html"
    );
    const unpackedHtml = path.join(
      resourcesPath,
      "app.asar.unpacked",
      ".vite",
      "renderer",
      "main_window",
      "index.html"
    );
    const existing = new Set([
      path.normalize(asarHtml),
      path.normalize(unpackedHtml),
    ]);

    const resolved = resolvePackagedRendererHtmlPath(
      {
        dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
        resourcesPath,
        existsSync: (candidate) => existing.has(path.normalize(candidate)),
      },
      "main_window"
    );

    expect(resolved).not.toBeNull();
    expect(path.normalize(resolved as string)).toBe(
      path.normalize(unpackedHtml)
    );
  });

  it("returns the packed renderer path when only asar contains it", () => {
    const resourcesPath = "/opt/AiFetchly/resources";
    const asarHtml = path.join(
      resourcesPath,
      "app.asar",
      ".vite",
      "renderer",
      "main_window",
      "index.html"
    );
    const existing = new Set([path.normalize(asarHtml)]);

    const resolved = resolvePackagedRendererHtmlPath(
      {
        dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
        resourcesPath,
        existsSync: (candidate) => existing.has(path.normalize(candidate)),
      },
      "main_window"
    );

    expect(path.normalize(resolved as string)).toBe(path.normalize(asarHtml));
  });

  it("lists unpacked candidates before relying on a failed asar loadFile", () => {
    const resourcesPath = "/opt/AiFetchly/resources";
    const candidates = getPackagedRendererHtmlCandidates(
      {
        dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
        resourcesPath,
        existsSync: () => false,
      },
      "main_window"
    );

    expect(
      candidates.some((c) =>
        c.includes(`${path.sep}app.asar.unpacked${path.sep}`)
      )
    ).toBe(true);
  });
});
