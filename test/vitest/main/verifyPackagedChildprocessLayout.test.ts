import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  "YellowPagesScraperProcess.js",
  "googleProxyCheck.js",
  "websiteContentScraper.js",
  "YellowPagesScraper.js",
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
});
