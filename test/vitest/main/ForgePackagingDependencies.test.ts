import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import minimatch from "minimatch";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface ForgeConfigForTest {
  readonly packagerConfig: {
    readonly ignore: (file: string) => boolean;
    readonly asar?: {
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

  it("unpacks dist/childprocess so packaged workers are extractable on Windows", async () => {
    const forgeConfig = await loadForgeConfig();
    const unpackDir = forgeConfig.packagerConfig.asar?.unpackDir;

    expect(unpackDir).toBeTruthy();

    // @electron/asar matches unpackDir against path.dirname(file), so worker
    // files in dist/childprocess/*.js are checked as "dist/childprocess".
    expect(minimatch("dist/childprocess", unpackDir as string)).toBe(true);
    expect(minimatch(".vite/build", unpackDir as string)).toBe(true);
    expect(minimatch("node_modules/better-sqlite3", unpackDir as string)).toBe(
      true
    );

    // Guard against regressing to "**/dist/childprocess/**" alone, which
    // fails to match the directory itself and leaves workers packed in asar.
    expect(minimatch("dist/childprocess", "**/dist/childprocess/**")).toBe(
      false
    );
  });

  // clone-deep@0.2.x uses lazy-cache; Vite/Rollup bundles break utils.typeOf and
  // crash packaged ScheduleManager with "n.typeOf is not a function" when
  // puppeteer-extra-plugin → merge-deep → clone-deep is pulled into the chunk.
  // package.json resolutions must keep clone-deep at 4.x (no lazy-cache).
  it("pins clone-deep to 4.x so Vite-bundled merge-deep keeps working typeOf", () => {
    const cloneDeepPkgPath = require.resolve("clone-deep/package.json");
    const cloneDeepPkg = JSON.parse(
      fs.readFileSync(cloneDeepPkgPath, "utf-8")
    ) as {
      version: string;
      dependencies?: Record<string, string>;
    };

    expect(cloneDeepPkg.version.startsWith("4.")).toBe(true);
    expect(cloneDeepPkg.dependencies?.["lazy-cache"]).toBeUndefined();

    const mergeDeep = require("merge-deep") as (
      ...objects: Record<string, unknown>[]
    ) => Record<string, unknown>;
    expect(mergeDeep({ a: 1 }, { b: 2, c: { d: 3 } }, { c: { e: 4 } })).toEqual(
      { a: 1, b: 2, c: { d: 3, e: 4 } }
    );
  });

  it("fails packaging when generated taskCode requires an omitted package", async () => {
    const forgeConfig = await loadForgeConfig();
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "aifetchly-package-runtime-")
    );
    const taskBundlePath = path.join(tempRoot, ".vite", "build", "taskCode.js");

    try {
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
});
