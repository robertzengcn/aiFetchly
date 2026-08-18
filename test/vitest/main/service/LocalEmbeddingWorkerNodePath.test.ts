"use strict";
import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { buildLocalEmbeddingWorkerNodePathExtras } from "@/service/embedding/LocalEmbeddingWorkerClient";

describe("buildLocalEmbeddingWorkerNodePathExtras", () => {
  it("prepends runtime node_modules and cwd node_modules when app.asar is absent", () => {
    const workerPath = path.join(
      "/tmp/runtimes/embedding-xenova/1.0.0",
      "worker.js"
    );
    const runtimeModules = path.join(
      "/tmp/runtimes/embedding-xenova/1.0.0",
      "node_modules"
    );
    const cwdModules = path.join("/tmp/app", "node_modules");
    const result = buildLocalEmbeddingWorkerNodePathExtras(workerPath, {
      cwd: "/tmp/app",
      resourcesPath: "/tmp/Electron.app/Contents/Resources",
      existingNodePath: "",
      pathDelimiter: ":",
      existsSync: (candidate: string) =>
        candidate === runtimeModules || candidate === cwdModules,
    });

    expect(result.split(":")).toEqual([runtimeModules, cwdModules]);
  });

  it("does not add cwd node_modules when packaged app.asar modules exist", () => {
    const workerPath = path.join(
      "/tmp/runtimes/embedding-xenova/1.0.0",
      "worker.js"
    );
    const runtimeModules = path.join(
      "/tmp/runtimes/embedding-xenova/1.0.0",
      "node_modules"
    );
    const asarModules = path.join(
      "/tmp/App.app/Contents/Resources",
      "app.asar",
      "node_modules"
    );
    const result = buildLocalEmbeddingWorkerNodePathExtras(workerPath, {
      cwd: "/tmp/app",
      resourcesPath: "/tmp/App.app/Contents/Resources",
      existingNodePath: "",
      pathDelimiter: ":",
      existsSync: (candidate: string) =>
        candidate === asarModules || candidate === runtimeModules,
    });

    expect(result).toBe(runtimeModules);
  });
});
