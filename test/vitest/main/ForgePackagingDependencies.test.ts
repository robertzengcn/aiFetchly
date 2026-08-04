import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface ForgeConfigForTest {
  readonly packagerConfig: {
    readonly ignore: (file: string) => boolean;
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
  const module = await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
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
