/**
 * Unit tests for AppUpdateService — the main-process adapter around
 * `update-electron-app` that gates GitHub auto-updates by packaging state,
 * platform, and Microsoft Store build channel.
 *
 * See docs/prd/windows-macos-github-auto-upgrade-technical-design.md §13.2.
 *
 * The service holds module-level state (the cached stopUpdates handle), so each
 * test resets the module registry and re-imports a fresh copy rather than
 * mutating global process/app state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const REPO = "robertzengcn/aiFetchly";

/**
 * Stable mock references usable inside the hoisted vi.mock factory.
 * `vi.hoisted` guarantees these exist before module mocking is applied.
 */
const mocks = vi.hoisted(() => ({
  updateElectronApp: vi.fn(() => ({ stopUpdates: vi.fn() })),
}));

vi.mock("update-electron-app", () => ({
  // Numeric value mirrors the real UpdateSourceType.ElectronPublicUpdateService.
  UpdateSourceType: { ElectronPublicUpdateService: 0 },
  updateElectronApp: mocks.updateElectronApp,
}));

// Keep the heavyweight real Logger (electron-log, fs, Electron app) out of
// these tests; the service only forwards updater messages through `log`.
vi.mock("@/modules/Logger", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    getLogDir: () => "",
    getLogger: () => ({}),
    scheduleLogCleanup: () => undefined,
    stopLogCleanup: () => undefined,
  },
}));

type InitializeAppUpdates =
  typeof import("@/main-process/updater/AppUpdateService").initializeAppUpdates;
let initializeAppUpdates: InitializeAppUpdates;

beforeEach(async () => {
  // Fresh module per test so the cached stopUpdates handle resets to null.
  vi.resetModules();
  mocks.updateElectronApp.mockClear();
  mocks.updateElectronApp.mockImplementation(() => ({ stopUpdates: vi.fn() }));
  ({ initializeAppUpdates } = await import(
    "@/main-process/updater/AppUpdateService"
  ));
});

describe("AppUpdateService.initializeAppUpdates", () => {
  it("skips initialization when the app is not packaged", () => {
    const result = initializeAppUpdates({
      isPackaged: false,
      platform: "win32",
    });

    expect(result.initialized).toBe(false);
    expect(result.reason).toBe("not-packaged");
    expect(mocks.updateElectronApp).not.toHaveBeenCalled();
  });

  it("skips initialization on an unsupported platform (linux)", () => {
    const result = initializeAppUpdates({
      isPackaged: true,
      platform: "linux",
    });

    expect(result.initialized).toBe(false);
    expect(result.reason).toBe("unsupported-platform");
    expect(mocks.updateElectronApp).not.toHaveBeenCalled();
  });

  it("skips initialization for Microsoft Store builds", () => {
    const result = initializeAppUpdates({
      isPackaged: true,
      platform: "win32",
      isWindowsStore: true,
    });

    expect(result.initialized).toBe(false);
    expect(result.reason).toBe("microsoft-store");
    expect(mocks.updateElectronApp).not.toHaveBeenCalled();
  });

  it("initializes once on a packaged win32 build", () => {
    const result = initializeAppUpdates({
      isPackaged: true,
      platform: "win32",
    });

    expect(result.initialized).toBe(true);
    expect(result.reason).toBe("initialized");
    expect(typeof result.stopUpdates).toBe("function");
    expect(mocks.updateElectronApp).toHaveBeenCalledTimes(1);
  });

  it("initializes once on a packaged darwin build", () => {
    const result = initializeAppUpdates({
      isPackaged: true,
      platform: "darwin",
    });

    expect(result.initialized).toBe(true);
    expect(result.reason).toBe("initialized");
    expect(mocks.updateElectronApp).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second call reports already-initialized without re-invoking", () => {
    const first = initializeAppUpdates({ isPackaged: true, platform: "win32" });
    const second = initializeAppUpdates({
      isPackaged: true,
      platform: "win32",
    });

    expect(first.initialized).toBe(true);
    expect(second.initialized).toBe(false);
    expect(second.reason).toBe("already-initialized");
    expect(typeof second.stopUpdates).toBe("function");
    expect(mocks.updateElectronApp).toHaveBeenCalledTimes(1);
  });

  it("configures updateElectronApp with the explicit robertzengcn/aiFetchly repo", () => {
    initializeAppUpdates({ isPackaged: true, platform: "win32" });

    expect(mocks.updateElectronApp).toHaveBeenCalledWith(
      expect.objectContaining({
        updateSource: expect.objectContaining({ repo: REPO }),
      })
    );
  });

  it("uses a 1 hour update interval by default", () => {
    initializeAppUpdates({ isPackaged: true, platform: "win32" });

    expect(mocks.updateElectronApp).toHaveBeenCalledWith(
      expect.objectContaining({ updateInterval: "1 hour" })
    );
  });

  it("enables the default user restart prompt (notifyUser: true)", () => {
    initializeAppUpdates({ isPackaged: true, platform: "win32" });

    expect(mocks.updateElectronApp).toHaveBeenCalledWith(
      expect.objectContaining({ notifyUser: true })
    );
  });

  it("returns initialization-error and does not cache a handle when updateElectronApp throws", () => {
    mocks.updateElectronApp.mockImplementation(() => {
      throw new Error("boom");
    });

    const result = initializeAppUpdates({
      isPackaged: true,
      platform: "win32",
    });

    expect(result.initialized).toBe(false);
    expect(result.reason).toBe("initialization-error");
    expect(result.stopUpdates).toBeUndefined();
  });
});
