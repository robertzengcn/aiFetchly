import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPackagedWorkerEnv,
  getPackagedWorkerNodePath,
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

  it("prefers the app.asar virtual path when running packaged", () => {
    // Loading the worker through the app.asar virtual path keeps Electron's
    // fs/module-resolution patch active so bare requires (puppeteer, etc.)
    // resolve against app.asar/node_modules. The unpacked disk mirror is a
    // fallback, not the preferred path.
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const asarPath = path.join(
      resourcesPath,
      "app.asar",
      ".vite",
      "build",
      "Worker.js"
    );
    const unpackedPath = path.join(
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
        existsSync: (candidate) => candidate === asarPath,
      },
      {
        dirnameRelativePaths: ["Worker.js"],
        cwdRelativePaths: [path.join(".vite", "build", "Worker.js")],
      }
    );

    expect(resolved).toBe(asarPath);
    expect(resolved).not.toBe(unpackedPath);
  });

  it("falls back to the unpacked mirror when the virtual asar path is missing", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const unpackedPath = path.join(
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
        existsSync: (candidate) => candidate === unpackedPath,
      },
      {
        dirnameRelativePaths: ["Worker.js"],
        cwdRelativePaths: [path.join(".vite", "build", "Worker.js")],
      }
    );

    expect(resolved).toBe(unpackedPath);
  });

  it("deduplicates candidates and lists the app.asar virtual path before its unpacked mirror", () => {
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

    // Regression for the packaged-puppeteer bug: the app.asar virtual path
    // MUST come before app.asar.unpacked, or workers loaded from unpacked
    // disk cannot resolve deps shipped inside app.asar/node_modules.
    expect(candidates).toEqual([...new Set(candidates)]);
    const asarIndex = candidates.findIndex((c) =>
      c.includes(path.join("app.asar", ".vite", "build", "Worker.js"))
    );
    const unpackedIndex = candidates.findIndex((c) =>
      c.includes(path.join("app.asar.unpacked", ".vite", "build", "Worker.js"))
    );
    expect(asarIndex).toBeGreaterThanOrEqual(0);
    expect(unpackedIndex).toBeGreaterThanOrEqual(0);
    expect(asarIndex).toBeLessThan(unpackedIndex);
  });

  it("maps Windows app.asar paths to app.asar.unpacked", () => {
    const packedPath =
      "E:\\aifetchly\\app-1.0.131\\resources\\app.asar\\.vite\\build\\Worker.js";

    expect(mirrorAppAsarUnpackedPath(packedPath)).toBe(
      "E:\\aifetchly\\app-1.0.131\\resources\\app.asar.unpacked\\.vite\\build\\Worker.js"
    );
  });

  it("builds NODE_PATH entries for dependencies stored inside app.asar", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");

    expect(
      getPackagedWorkerNodePath(resourcesPath, "/existing/node_modules")
    ).toBe(
      [
        path.join(resourcesPath, "app.asar", "node_modules"),
        path.join(resourcesPath, "app.asar.unpacked", "node_modules"),
        "/existing/node_modules",
      ].join(path.delimiter)
    );
  });
});

describe("buildPackagedWorkerEnv", () => {
  it("always sets NODE_PATH for packaged resources and clears NODE_OPTIONS", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const env = buildPackagedWorkerEnv({
      resourcesPath,
      existingNodePath: "/existing/node_modules",
      processEnv: {
        NODE_OPTIONS: "--inspect",
        FOO: "bar",
      },
      extraEnv: {
        WORKER_TYPE: "test-worker",
      },
    });

    expect(env.FOO).toBe("bar");
    expect(env.WORKER_TYPE).toBe("test-worker");
    expect(env.NODE_OPTIONS).toBe("");
    expect(env.NODE_PATH).toBe(
      [
        path.join(resourcesPath, "app.asar", "node_modules"),
        path.join(resourcesPath, "app.asar.unpacked", "node_modules"),
        "/existing/node_modules",
      ].join(path.delimiter)
    );
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("sets ELECTRON_RUN_AS_NODE when runAsNode is requested", () => {
    const env = buildPackagedWorkerEnv({
      resourcesPath: path.join("/opt", "AiFetchly", "resources"),
      processEnv: {},
      runAsNode: true,
    });
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("does not let extraEnv override NODE_PATH", () => {
    const resourcesPath = path.join("/opt", "AiFetchly", "resources");
    const env = buildPackagedWorkerEnv({
      resourcesPath,
      processEnv: {},
      extraEnv: {
        NODE_PATH: "/evil/override",
        NODE_OPTIONS: "--inspect",
      },
    });
    expect(env.NODE_PATH).toContain(
      path.join(resourcesPath, "app.asar", "node_modules")
    );
    expect(env.NODE_PATH).not.toBe("/evil/override");
    expect(env.NODE_OPTIONS).toBe("");
  });
});

