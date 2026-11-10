import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const REQUIRED_WORKERS = [
  "AiChatVoiceWorker.js",
  "ContactExtractionWorker.js",
  "GoogleMapsWorker.js",
  "HookExecutionWorker.js",
  "LocalEmbeddingWorker.js",
  "PythonRuntimeWorker.js",
  "SkillWorker.js",
  "WorkspaceConfigWatchWorker.js",
  "YandexMapsWorker.js",
  "googleProxyCheck.js",
  "websiteContentScraper.js",
];

describe("verify-packaged-childprocess layout detection", () => {
  it("accepts CI-style resources/app worker layout", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-verify-app-layout-")
    );
    const outDir = path.join(tempRoot, "out");
    const resourcesDir = path.join(outDir, "aiFetchly-linux-x64", "resources");
    const appRoot = path.join(resourcesDir, "app");
    const buildRoot = path.join(appRoot, ".vite", "build");

    try {
      fs.mkdirSync(buildRoot, { recursive: true });
      for (const workerFile of REQUIRED_WORKERS) {
        const contents =
          workerFile === "ContactExtractionWorker.js"
            ? 'require("uuid"); require("node:path"); require("./local");'
            : 'require("node:path"); require("./local");';
        fs.writeFileSync(path.join(buildRoot, workerFile), contents);
      }
      fs.writeFileSync(
        path.join(buildRoot, "taskCode.js"),
        'require("electron-store"); require("node:path"); require("./local");'
      );

      const rendererHtml = path.join(
        appRoot,
        ".vite",
        "renderer",
        "main_window",
        "index.html"
      );
      fs.mkdirSync(path.dirname(rendererHtml), { recursive: true });
      fs.writeFileSync(rendererHtml, "<!doctype html><title>ci</title>");

      // Real packages always carry an app manifest — the prune-closure gate
      // (verifyDeclaredDependenciesPresent) reads it to walk the runtime
      // transitive closure.
      fs.writeFileSync(
        path.join(appRoot, "package.json"),
        JSON.stringify({
          name: "aiFetchly",
          version: "0.0.0-test",
          dependencies: { uuid: "*", "electron-store": "*" },
        })
      );

      fs.mkdirSync(path.join(appRoot, "node_modules", "uuid"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(appRoot, "node_modules", "uuid", "package.json"),
        "{}"
      );
      fs.writeFileSync(
        path.join(appRoot, "node_modules", "uuid", "index.js"),
        "module.exports = {};"
      );
      fs.mkdirSync(path.join(appRoot, "node_modules", "electron-store"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(appRoot, "node_modules", "electron-store", "package.json"),
        "{}"
      );
      fs.writeFileSync(
        path.join(appRoot, "node_modules", "electron-store", "index.js"),
        "module.exports = {};"
      );

      const result = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "scripts/verify-packaged-childprocess.js")],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AIFETCHLY_VERIFY_OUT_DIR: outDir,
          },
          encoding: "utf-8",
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ContactExtractionWorker.js");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts real asar builds without an on-disk app manifest (run #382)", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-verify-asar-layout-")
    );
    const outDir = path.join(tempRoot, "out");
    const resourcesDir = path.join(outDir, "aiFetchly-darwin-arm64", "resources");
    const unpackedRoot = path.join(resourcesDir, "app.asar.unpacked");
    const buildRoot = path.join(unpackedRoot, ".vite", "build");

    // Node-require the asar library exactly like the script itself does.
    // Narrow local type because tsc (moduleResolution: node) cannot type it.
    interface AsarLike {
      createPackage(src: string, dest: string): Promise<void>;
    }
    const require = createRequire(import.meta.url);
    const asarLib = require("@electron/asar") as AsarLike;

    try {
      // Build the real archive the packaged app ships: package.json +
      // node_modules live INSIDE the asar, together with the renderer HTML
      // (verifyPackagedRenderer must find it in the archive, not unpacked).
      const staging = path.join(tempRoot, "staging-asar");
      const rendererHtml = path.join(
        staging,
        ".vite",
        "renderer",
        "main_window",
        "index.html"
      );
      fs.mkdirSync(path.dirname(rendererHtml), { recursive: true });
      fs.writeFileSync(rendererHtml, "<!doctype html><title>asar</title>");
      fs.writeFileSync(
        path.join(staging, "package.json"),
        JSON.stringify({
          name: "aiFetchly",
          version: "0.0.0-test",
          dependencies: { uuid: "^9.0.0" },
        })
      );
      // A resolvable package inside the archive closure.
      const asarUuid = path.join(staging, "node_modules", "uuid");
      fs.mkdirSync(asarUuid, { recursive: true });
      fs.writeFileSync(
        path.join(asarUuid, "package.json"),
        JSON.stringify({ name: "uuid", main: "index.js" })
      );
      fs.writeFileSync(path.join(asarUuid, "index.js"), "module.exports = {};");

      const asarPath = path.join(resourcesDir, "app.asar");
      fs.mkdirSync(path.dirname(asarPath), { recursive: true });
      await asarLib.createPackage(staging, asarPath);

      // Workers come from the asar unpackDir on disk (electron-forge
      // packager: asar.unpackDir) — note the package MANIFEST is NOT on
      // disk in this layout; that exact shape is what run #382's macOS
      // job crashed on inside verifyDeclaredDependenciesPresent.
      fs.mkdirSync(buildRoot, { recursive: true });
      for (const workerFile of REQUIRED_WORKERS) {
        const contents =
          workerFile === "ContactExtractionWorker.js"
            ? 'require("uuid"); require("node:path"); require("./local");'
            : 'require("node:path"); require("./local");';
        fs.writeFileSync(path.join(buildRoot, workerFile), contents);
      }
      fs.writeFileSync(
        path.join(buildRoot, "taskCode.js"),
        'require("uuid"); require("node:path"); require("./local");'
      );
      // The required package resolves from the unpacked node_modules.
      const unpackedUuid = path.join(unpackedRoot, "node_modules", "uuid");
      fs.mkdirSync(unpackedUuid, { recursive: true });
      fs.writeFileSync(
        path.join(unpackedUuid, "package.json"),
        JSON.stringify({ name: "uuid", main: "index.js" })
      );
      fs.writeFileSync(path.join(unpackedUuid, "index.js"), "module.exports = {};");

      const result = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "scripts/verify-packaged-childprocess.js")],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            AIFETCHLY_VERIFY_OUT_DIR: outDir,
          },
          encoding: "utf-8",
        }
      );

      expect(result.status).toBe(0);
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(combined).toContain(
        "Runtime dependency closure is inside the asar archive"
      );
      expect(result.stdout).toContain("ContactExtractionWorker.js");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
