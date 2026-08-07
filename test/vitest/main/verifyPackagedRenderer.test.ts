/**
 * Packaging verifier: renderer HTML must stay inside app.asar.
 *
 * Regression for Windows startup: ERR_FAILED (-2) loading
 * `app.asar/.vite/renderer/main_window/index.html` when the file was
 * asar-unpacked to app.asar.unpacked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar") as {
  createPackage: (src: string, dest: string) => Promise<void>;
};
const verify = require("../../../scripts/verify-packaged-childprocess.js") as {
  RENDERER_HTML_RELATIVE: string;
  verifyPackagedRenderer: (resourcesDir: string) => boolean;
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempResources(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aifetchly-renderer-"));
  tempDirs.push(root);
  const resourcesDir = path.join(root, "resources");
  fs.mkdirSync(resourcesDir, { recursive: true });
  return resourcesDir;
}

describe("verifyPackagedRenderer", () => {
  it("accepts CI-style resources/app renderer HTML", () => {
    const resourcesDir = makeTempResources();
    const htmlPath = path.join(
      resourcesDir,
      "app",
      ...verify.RENDERER_HTML_RELATIVE.split("/")
    );
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, "<!doctype html><title>ok</title>");

    expect(verify.verifyPackagedRenderer(resourcesDir)).toBe(true);
  });

  it("rejects renderer HTML that only exists under app.asar.unpacked", () => {
    const resourcesDir = makeTempResources();
    const unpackedHtml = path.join(
      resourcesDir,
      "app.asar.unpacked",
      ...verify.RENDERER_HTML_RELATIVE.split("/")
    );
    fs.mkdirSync(path.dirname(unpackedHtml), { recursive: true });
    fs.writeFileSync(unpackedHtml, "<!doctype html><title>bad</title>");
    // Touch an empty asar file so we take the asar layout branch.
    fs.writeFileSync(path.join(resourcesDir, "app.asar"), "");

    expect(verify.verifyPackagedRenderer(resourcesDir)).toBe(false);
  });

  it("accepts renderer HTML packed inside app.asar", async () => {
    const resourcesDir = makeTempResources();
    const stage = path.join(resourcesDir, "_asar_src");
    const htmlRel = verify.RENDERER_HTML_RELATIVE;
    const stagedHtml = path.join(stage, ...htmlRel.split("/"));
    fs.mkdirSync(path.dirname(stagedHtml), { recursive: true });
    fs.writeFileSync(stagedHtml, "<!doctype html><title>packed</title>");

    const asarPath = path.join(resourcesDir, "app.asar");
    await asar.createPackage(stage, asarPath);

    expect(verify.verifyPackagedRenderer(resourcesDir)).toBe(true);
  });

  it("fails when asar exists but renderer HTML is missing", async () => {
    const resourcesDir = makeTempResources();
    const stage = path.join(resourcesDir, "_asar_src");
    fs.mkdirSync(path.join(stage, ".vite", "build"), { recursive: true });
    fs.writeFileSync(path.join(stage, ".vite", "build", "main.js"), "void 0;");

    const asarPath = path.join(resourcesDir, "app.asar");
    await asar.createPackage(stage, asarPath);

    expect(verify.verifyPackagedRenderer(resourcesDir)).toBe(false);
  });
});
