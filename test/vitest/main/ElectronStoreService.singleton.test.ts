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

  it("passes absolute cwd and projectName so packaged utilityProcess does not crash Conf", async () => {
    // Regression: utilityProcess has app without ipcMain. electron-store then
    // leaves cwd undefined and Conf throws "Project name could not be inferred".
    // Workers receive these via buildPackagedWorkerEnv; prefer env over app APIs.
    const prevUserData = process.env.ELECTRON_USER_DATA_PATH;
    const prevAppName = process.env.ELECTRON_APP_NAME;
    process.env.ELECTRON_USER_DATA_PATH = "/tmp/aifetchly-worker-userData";
    process.env.ELECTRON_APP_NAME = "aiFetchly-worker";
    try {
      const { ElectronStoreService } = await import(
        "@/modules/electronstoreservice"
      );

      new ElectronStoreService("userservice");

      expect(storeCtor).toHaveBeenCalledTimes(1);
      const firstCall = storeCtor.mock.calls[0] as unknown as
        | [{ name: string; cwd?: string; projectName?: string }]
        | undefined;
      expect(firstCall).toBeDefined();
      const options = firstCall![0];
      expect(options.cwd).toBe("/tmp/aifetchly-worker-userData");
      // projectName must always be set (Conf fallback); source may be env or app.getName.
      expect(typeof options.projectName).toBe("string");
      expect((options.projectName ?? "").length).toBeGreaterThan(0);
      expect(options.name).toContain("userservice");
    } finally {
      if (prevUserData === undefined) {
        delete process.env.ELECTRON_USER_DATA_PATH;
      } else {
        process.env.ELECTRON_USER_DATA_PATH = prevUserData;
      }
      if (prevAppName === undefined) {
        delete process.env.ELECTRON_APP_NAME;
      } else {
        process.env.ELECTRON_APP_NAME = prevAppName;
      }
    }
  });

  it("keeps electron-store external in vite.main.config.mjs", () => {
    const viteMain = fs.readFileSync(
      path.resolve(process.cwd(), "vite.main.config.mjs"),
      "utf-8"
    );
    expect(viteMain).toMatch(
      /const MAIN_PROCESS_EXTERNALS[\s\S]*['"]electron-store['"]/
    );
    expect(viteMain).toMatch(/external:\s*MAIN_PROCESS_EXTERNALS/);
  });
});
