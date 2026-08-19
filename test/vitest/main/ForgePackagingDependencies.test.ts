import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";

interface ForgeConfigForTest {
  readonly packagerConfig: {
    readonly ignore: (file: string) => boolean;
    readonly asar?:
      | boolean
      | {
          readonly unpackDir?: string;
          readonly unpack?: string;
        };
  };
  readonly hooks: {
    readonly prePackage: () => Promise<void>;
    readonly packageAfterPrune: (
      forgeConfig: unknown,
      buildPath: string
    ) => Promise<void>;
  };
}

async function loadForgeConfig(): Promise<ForgeConfigForTest> {
  const configPath = path.resolve(process.cwd(), "forge.config.js");
  const module = await import(
    `${pathToFileURL(configPath).href}?t=${Date.now()}`
  );
  return module.default as ForgeConfigForTest;
}

function isProductionAsarConfig(
  asar: ForgeConfigForTest["packagerConfig"]["asar"]
): asar is { readonly unpackDir?: string; readonly unpack?: string } {
  return typeof asar === "object" && asar !== null;
}

function stageRendererHtml(root: string): void {
  const rendererHtmlPath = path.join(
    root,
    ".vite",
    "renderer",
    "main_window",
    "index.html"
  );
  fs.mkdirSync(path.dirname(rendererHtmlPath), { recursive: true });
  fs.writeFileSync(rendererHtmlPath, "<!doctype html><title>ok</title>");
}

describe("Forge packaging dependencies", () => {
  it("keeps TypeORM SQL formatter dependency in packaged node_modules", async () => {
    const forgeConfig = await loadForgeConfig();

    await forgeConfig.hooks.prePackage();

    expect(forgeConfig.packagerConfig.ignore("/node_modules/@sqltools")).toBe(
      false
    );
    expect(
      forgeConfig.packagerConfig.ignore(
        "/node_modules/@sqltools/formatter/package.json"
      )
    ).toBe(false);
    expect(
      forgeConfig.packagerConfig.ignore(
        "/node_modules/@sqltools/formatter/lib/index.js"
      )
    ).toBe(false);
  });

  // electron-store must ship in packaged node_modules: taskCode inlines it for
  // the worker, and vite.main.config.mjs externalizes it for the main process.
  it("keeps electron-store for packaged taskCode runtime", async () => {
    const forgeConfig = await loadForgeConfig();

    await forgeConfig.hooks.prePackage();

    expect(
      forgeConfig.packagerConfig.ignore(
        "/node_modules/electron-store/package.json"
      )
    ).toBe(false);
    expect(
      forgeConfig.packagerConfig.ignore("/node_modules/electron-store/index.js")
    ).toBe(false);
  });

  // pdf-lib must ship in packaged node_modules because vite.main.config.mjs
  // externalizes it. If Forge ignores it, Windows launch fails when
  // DocumentService/RAG (pulled via ScheduleManager) requires("pdf-lib").
  it("keeps pdf-lib for packaged main-process external require", async () => {
    const forgeConfig = await loadForgeConfig();

    await forgeConfig.hooks.prePackage();

    expect(
      forgeConfig.packagerConfig.ignore("/node_modules/pdf-lib/package.json")
    ).toBe(false);
    expect(
      forgeConfig.packagerConfig.ignore("/node_modules/pdf-lib/cjs/index.js")
    ).toBe(false);
  });

  it("unpacks dist/childprocess so packaged workers are extractable on Windows", async () => {
    const previousDisableAsar = process.env.FORGE_DISABLE_ASAR;
    delete process.env.FORGE_DISABLE_ASAR;
    try {
      const forgeConfig = await loadForgeConfig();
      const asarConfig = forgeConfig.packagerConfig.asar;
      expect(isProductionAsarConfig(asarConfig)).toBe(true);
      if (!isProductionAsarConfig(asarConfig)) {
        return;
      }
      const unpackDir = asarConfig.unpackDir;

      expect(unpackDir).toBeTruthy();

      // @electron/asar matches unpackDir against path.dirname(file), so worker
      // files in dist/childprocess/*.js are checked as "dist/childprocess".
      expect(minimatch("dist/childprocess", unpackDir as string)).toBe(true);
      expect(minimatch(".vite/build", unpackDir as string)).toBe(true);
      expect(
        minimatch("node_modules/better-sqlite3", unpackDir as string)
      ).toBe(true);

      // Renderer must stay packed: unpacking .vite/renderer breaks
      // BrowserWindow.loadFile with ERR_FAILED (-2) on Windows.
      expect(minimatch(".vite/renderer", unpackDir as string)).toBe(false);
      expect(minimatch(".vite/renderer/main_window", unpackDir as string)).toBe(
        false
      );

      // Guard against regressing to "**/dist/childprocess/**" alone, which
      // fails to match the directory itself and leaves workers packed in asar.
      expect(minimatch("dist/childprocess", "**/dist/childprocess/**")).toBe(
        false
      );
    } finally {
      if (previousDisableAsar === undefined) {
        delete process.env.FORGE_DISABLE_ASAR;
      } else {
        process.env.FORGE_DISABLE_ASAR = previousDisableAsar;
      }
    }
  });

  it("fails packaging when generated taskCode requires an omitted package", async () => {
    const forgeConfig = await loadForgeConfig();
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-package-runtime-")
    );
    const taskBundlePath = path.join(tempRoot, ".vite", "build", "taskCode.js");

    try {
      stageRendererHtml(tempRoot);
      fs.mkdirSync(path.dirname(taskBundlePath), { recursive: true });
      fs.writeFileSync(
        taskBundlePath,
        'require("electron-store"); require("node:path"); require("./local");'
      );

      await expect(
        forgeConfig.hooks.packageAfterPrune({}, tempRoot)
      ).rejects.toThrow(/electron-store/);

      fs.mkdirSync(path.join(tempRoot, "node_modules", "electron-store"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempRoot, "node_modules", "electron-store", "package.json"),
        "{}"
      );

      await expect(
        forgeConfig.hooks.packageAfterPrune({}, tempRoot)
      ).resolves.toBeUndefined();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails packaging when the staged renderer HTML is missing", async () => {
    const forgeConfig = await loadForgeConfig();
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-package-renderer-")
    );

    try {
      await expect(
        forgeConfig.hooks.packageAfterPrune({}, tempRoot)
      ).rejects.toThrow(/missing renderer HTML/i);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails packaging when the staged renderer HTML is empty", async () => {
    const forgeConfig = await loadForgeConfig();
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-package-renderer-empty-")
    );

    try {
      const rendererHtmlPath = path.join(
        tempRoot,
        ".vite",
        "renderer",
        "main_window",
        "index.html"
      );
      fs.mkdirSync(path.dirname(rendererHtmlPath), { recursive: true });
      fs.writeFileSync(rendererHtmlPath, "");

      await expect(
        forgeConfig.hooks.packageAfterPrune({}, tempRoot)
      ).rejects.toThrow(/empty renderer HTML/i);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("disables ASAR when FORGE_DISABLE_ASAR=1 for memory-safe CI packaging", async () => {
    const previousDisableAsar = process.env.FORGE_DISABLE_ASAR;
    process.env.FORGE_DISABLE_ASAR = "1";
    try {
      const forgeConfig = await loadForgeConfig();
      expect(forgeConfig.packagerConfig.asar).toBe(false);
    } finally {
      if (previousDisableAsar === undefined) {
        delete process.env.FORGE_DISABLE_ASAR;
      } else {
        process.env.FORGE_DISABLE_ASAR = previousDisableAsar;
      }
    }
  });

  it("keeps ASAR enabled without FORGE_DISABLE_ASAR for production packaging", async () => {
    const previousDisableAsar = process.env.FORGE_DISABLE_ASAR;
    delete process.env.FORGE_DISABLE_ASAR;
    try {
      const forgeConfig = await loadForgeConfig();
      expect(forgeConfig.packagerConfig.asar).not.toBe(false);
    } finally {
      if (previousDisableAsar === undefined) {
        delete process.env.FORGE_DISABLE_ASAR;
      } else {
        process.env.FORGE_DISABLE_ASAR = previousDisableAsar;
      }
    }
  });
});
