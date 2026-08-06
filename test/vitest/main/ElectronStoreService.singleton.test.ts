import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeCtor = vi.fn(function MockStore(this: {
  name: string;
  data: Record<string, unknown>;
}) {
  this.name = "mock";
  this.data = {};
});

vi.mock("electron-store", () => ({
  default: storeCtor,
}));

vi.mock("electron", () => ({
  app: {
    getName: () => "aiFetchly-test",
    getPath: () => "/tmp/aifetchly-test",
    getVersion: () => "0.0.0-test",
  },
}));

describe("ElectronStoreService store singleton cache", () => {
  beforeEach(() => {
    storeCtor.mockClear();
    const globalState = globalThis as typeof globalThis & {
      __aifetchlyElectronStores?: Map<string, unknown>;
    };
    delete globalState.__aifetchlyElectronStores;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("reuses one Store instance per service name across ElectronStoreService constructions", async () => {
    const { ElectronStoreService } = await import(
      "@/modules/electronstoreservice"
    );

    const first = new ElectronStoreService("userservice");
    const second = new ElectronStoreService("userservice");

    expect(storeCtor).toHaveBeenCalledTimes(1);
    expect(first.getStoreForTests()).toBe(second.getStoreForTests());
  });

  it("creates separate Store instances for different service names", async () => {
    const { ElectronStoreService } = await import(
      "@/modules/electronstoreservice"
    );

    const userStore = new ElectronStoreService("userservice");
    const otherStore = new ElectronStoreService("otherservice");

    expect(storeCtor).toHaveBeenCalledTimes(2);
    expect(userStore.getStoreForTests()).not.toBe(
      otherStore.getStoreForTests()
    );
  });

  it("keeps electron-store external in vite.main.config.mjs", () => {
    const viteMain = fs.readFileSync(
      path.resolve(process.cwd(), "vite.main.config.mjs"),
      "utf-8"
    );
    expect(viteMain).toMatch(/external\s*:\s*\[[\s\S]*['"]electron-store['"]/);
  });
});
