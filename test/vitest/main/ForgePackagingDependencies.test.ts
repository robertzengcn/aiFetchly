import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface ForgeConfigForTest {
  readonly packagerConfig: {
    readonly ignore: (file: string) => boolean;
  };
  readonly hooks: {
    readonly prePackage: () => Promise<void>;
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
});
