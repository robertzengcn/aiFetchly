import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPackagedWorkerPathCandidates,
  mirrorAppAsarUnpackedPath,
  resolvePackagedWorkerPath,
} from "@/utils/packagedWorkerPath";

describe("packaged worker path resolution", () => {
  it("resolves a local Vite worker bundle", () => {
    const expected = path.join("/repo", ".vite", "build", "Worker.js");

    const resolved = resolvePackagedWorkerPath(
      {
        dirname: path.join("/repo", ".vite", "build"),
        cwd: "/repo",
        existsSync: (candidate) => candidate === expected,
      },
      {
        dirnameRelativePaths: ["Worker.js"],
        cwdRelativePaths: [path.join(".vite", "build", "Worker.js")],
      }
    );

    expect(resolved).toBe(expected);
  });

  it("prefers the unpacked packaged worker mirror when running from app.asar", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const expected = path.join(
      resourcesPath,
      "app.asar.unpacked",
      ".vite",
      "build",
      "Worker.js"
    );

    const resolved = resolvePackagedWorkerPath(
      {
        dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
        cwd: "/tmp",
        resourcesPath,
        existsSync: (candidate) => candidate === expected,
      },
      {
        dirnameRelativePaths: ["Worker.js"],
        cwdRelativePaths: [path.join(".vite", "build", "Worker.js")],
      }
    );

    expect(resolved).toBe(expected);
  });

  it("deduplicates candidates while preserving fallback order", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const candidates = getPackagedWorkerPathCandidates(
      {
        dirname: path.join(resourcesPath, "app.asar", ".vite", "build"),
        cwd: "/tmp",
        resourcesPath,
        existsSync: () => false,
      },
      {
        dirnameRelativePaths: ["Worker.js"],
        cwdRelativePaths: [path.join(".vite", "build", "Worker.js")],
      }
    );

    expect(candidates).toEqual([...new Set(candidates)]);
    expect(candidates[0]).toBe(
      path.join(
        resourcesPath,
        "app.asar.unpacked",
        ".vite",
        "build",
        "Worker.js"
      )
    );
  });

  it("maps Windows app.asar paths to app.asar.unpacked", () => {
    const packedPath =
      "E:\\aifetchly\\app-1.0.131\\resources\\app.asar\\.vite\\build\\Worker.js";

    expect(mirrorAppAsarUnpackedPath(packedPath)).toBe(
      "E:\\aifetchly\\app-1.0.131\\resources\\app.asar.unpacked\\.vite\\build\\Worker.js"
    );
  });
});
