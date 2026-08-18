import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  mirrorAppAsarUnpackedPath,
  resolveContactExtractionWorkerPath,
} from "@/main-process/communication/contactExtractionWorkerPath";

describe("contact extraction worker path resolution", () => {
  it("resolves the local Vite worker bundle", () => {
    const expected = path.join(
      "/repo",
      ".vite",
      "build",
      "ContactExtractionWorker.js"
    );

    const resolved = resolveContactExtractionWorkerPath({
      dirname: path.join("/repo", ".vite", "build"),
      cwd: "/repo",
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("resolves the app.asar virtual path when running from app.asar", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const expected = path.join(
      resourcesPath,
      "app.asar",
      ".vite",
      "build",
      "ContactExtractionWorker.js"
    );

    const resolved = resolveContactExtractionWorkerPath({
      dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
      cwd: "/tmp",
      resourcesPath,
      existsSync: (candidate) => candidate === expected,
    });

    expect(resolved).toBe(expected);
  });

  it("falls back to the unpacked mirror when the app.asar virtual path is missing", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const asarPath = path.join(
      resourcesPath,
      "app.asar",
      ".vite",
      "build",
      "ContactExtractionWorker.js"
    );
    const expected = path.join(
      resourcesPath,
      "app.asar.unpacked",
      ".vite",
      "build",
      "ContactExtractionWorker.js"
    );

    const resolved = resolveContactExtractionWorkerPath({
      dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
      cwd: "/tmp",
      resourcesPath,
      existsSync: (candidate) => candidate !== asarPath,
    });

    expect(resolved).toBe(expected);
  });

  it("maps Windows app.asar paths to the app.asar.unpacked mirror", () => {
    const packedPath =
      "E:\\aifetchly\\app-1.0.130\\resources\\app.asar\\.vite\\build\\ContactExtractionWorker.js";

    expect(mirrorAppAsarUnpackedPath(packedPath)).toBe(
      "E:\\aifetchly\\app-1.0.130\\resources\\app.asar.unpacked\\.vite\\build\\ContactExtractionWorker.js"
    );
  });
});
