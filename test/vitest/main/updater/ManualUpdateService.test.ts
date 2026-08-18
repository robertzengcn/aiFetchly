import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeUpdateSupport,
  mapAutoUpdaterEvent,
} from "@/main-process/updater/UpdateStatus";
import {
  ManualUpdateService,
  type ManualUpdateServiceDeps,
} from "@/main-process/updater/ManualUpdateService";

/** Minimal autoUpdater fake capturing listeners + call counts. */
class FakeAutoUpdater {
  readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  checkForUpdatesCalls = 0;
  quitAndInstallCalls = 0;

  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event);
    if (list) {
      list.push(listener);
    } else {
      this.listeners.set(event, [listener]);
    }
    return this;
  }
  async checkForUpdates(): Promise<void> {
    this.checkForUpdatesCalls += 1;
  }
  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }
  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((l) => l(...args));
  }
}

interface FakeDepsKit {
  autoUpdater: FakeAutoUpdater;
  deps: ManualUpdateServiceDeps;
  setNow: (ms: number) => void;
  setVersion: (v: string) => void;
}

function makeKit(overrides: Partial<ManualUpdateServiceDeps> = {}): FakeDepsKit {
  const autoUpdater = new FakeAutoUpdater();
  let version = "1.2.3";
  let nowMs = 1_000_000;
  const deps: ManualUpdateServiceDeps = {
    isPackaged: () => true,
    platform: () => "win32",
    isWindowsStore: () => false,
    getAppVersion: () => version,
    getAutoUpdater: () => autoUpdater,
    now: () => nowMs,
    watchdogMs: 0,
    ...overrides,
  };
  return {
    autoUpdater,
    deps,
    setNow: (ms) => {
      nowMs = ms;
    },
    setVersion: (v) => {
      version = v;
    },
  };
}

describe("computeUpdateSupport", () => {
  it("rejects unpackaged dev builds", () => {
    expect(
      computeUpdateSupport({ isPackaged: false, platform: "win32", isWindowsStore: false }),
    ).toEqual({ supported: false, reason: "development" });
  });
  it("rejects Microsoft Store builds", () => {
    expect(
      computeUpdateSupport({ isPackaged: true, platform: "win32", isWindowsStore: true }),
    ).toEqual({ supported: false, reason: "store" });
  });
  it("rejects unsupported platforms (linux)", () => {
    expect(
      computeUpdateSupport({ isPackaged: true, platform: "linux", isWindowsStore: false }),
    ).toEqual({ supported: false, reason: "platform" });
  });
  it("accepts packaged Windows + macOS GitHub builds", () => {
    expect(
      computeUpdateSupport({ isPackaged: true, platform: "win32", isWindowsStore: false }),
    ).toEqual({ supported: true });
    expect(
      computeUpdateSupport({ isPackaged: true, platform: "darwin", isWindowsStore: false }),
    ).toEqual({ supported: true });
  });
});

describe("mapAutoUpdaterEvent", () => {
  it("maps known events to UI states", () => {
    expect(mapAutoUpdaterEvent("checking-for-update")).toBe("checking");
    expect(mapAutoUpdaterEvent("update-available")).toBe("downloading");
    expect(mapAutoUpdaterEvent("update-not-available")).toBe("up-to-date");
    expect(mapAutoUpdaterEvent("update-downloaded")).toBe("ready-to-restart");
    expect(mapAutoUpdaterEvent("error")).toBe("error");
  });
  it("returns null for events Phase 1 ignores", () => {
    expect(mapAutoUpdaterEvent("download-progress")).toBeNull();
  });
});

describe("ManualUpdateService", () => {
  describe("initial status + start()", () => {
    it("reports idle with current version on a supported channel", () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      const status = svc.getStatus();
      expect(status.state).toBe("idle");
      expect(status.currentVersion).toBe("1.2.3");
    });
    it("reports unsupported (development) on an unpackaged build", () => {
      const kit = makeKit({ isPackaged: () => false });
      expect(new ManualUpdateService(kit.deps).getStatus().unsupportedReason).toBe(
        "development",
      );
    });
    it("start() subscribes autoUpdater events once on a supported channel", () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      svc.start();
      svc.start(); // idempotent
      // handleAutoUpdaterEvent is wired through ensureEventSubscribers: a
      // downloaded event should transition state.
      kit.autoUpdater.emit("update-downloaded", {}, { version: "1.3.0" });
      expect(svc.getStatus().state).toBe("ready-to-restart");
      expect(svc.getStatus().availableVersion).toBe("1.3.0");
    });
    it("start() is a no-op on unsupported channels", () => {
      const kit = makeKit({ isPackaged: () => false });
      const svc = new ManualUpdateService(kit.deps);
      svc.start();
      expect(kit.autoUpdater.listeners.size).toBe(0);
    });
  });

  describe("checkForUpdatesNow", () => {
    it("returns unsupported without invoking autoUpdater", async () => {
      const kit = makeKit({ isPackaged: () => false });
      const status = await new ManualUpdateService(kit.deps).checkForUpdatesNow();
      expect(status.state).toBe("unsupported");
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(0);
    });
    it("triggers checkForUpdates and enters checking", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      const status = await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1);
      expect(status.state).toBe("checking");
    });
    it("does not start a second concurrent check while checking", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1);
    });
    it("respects the 60s cooldown after a terminal result", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("update-not-available");
      kit.setNow(1_000_000 + 30_000);
      await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1);
      expect(svc.getStatus().state).toBe("up-to-date");
    });
    it("allows a new check after the cooldown elapses", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("update-not-available");
      kit.setNow(1_000_000 + 61_000);
      await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(2);
    });
  });

  describe("autoUpdater event handling", () => {
    it("stamps lastCheckedAt on up-to-date", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.setNow(2_000_000);
      kit.autoUpdater.emit("update-not-available");
      expect(svc.getStatus()).toMatchObject({
        state: "up-to-date",
        lastCheckedAt: 2_000_000,
      });
    });
    it("captures available version during downloading", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("update-available", {}, { version: "1.3.0" });
      expect(svc.getStatus()).toMatchObject({
        state: "downloading",
        availableVersion: "1.3.0",
      });
    });
    it("uses a bounded errorCode on error, never the raw message", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("error", new Error("secrets: sk-xxxx"));
      const status = svc.getStatus();
      expect(status.state).toBe("error");
      expect(status.errorCode).toBe("UPDATE_CHECK_FAILED");
      expect(JSON.stringify(status)).not.toContain("sk-xxxx");
    });
  });

  describe("quitAndInstall", () => {
    it("installs when ready-to-restart", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("update-downloaded", {}, { version: "1.3.0" });
      svc.quitAndInstall();
      expect(kit.autoUpdater.quitAndInstallCalls).toBe(1);
    });
    it("refuses to install when not ready", () => {
      const kit = makeKit();
      new ManualUpdateService(kit.deps).quitAndInstall();
      expect(kit.autoUpdater.quitAndInstallCalls).toBe(0);
    });
  });

  describe("status sink", () => {
    it("pushes transitions and can detach", async () => {
      const kit = makeKit();
      const svc = new ManualUpdateService(kit.deps);
      const seen: string[] = [];
      svc.setStatusSink((s) => seen.push(s.state));
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("update-not-available");
      expect(seen).toEqual(["checking", "up-to-date"]);
      svc.setStatusSink(null);
      kit.autoUpdater.emit("update-available");
      expect(seen).toEqual(["checking", "up-to-date"]);
    });
  });

  describe("manual-check watchdog", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    it("forces error when a manual check hangs in checking", async () => {
      vi.useFakeTimers();
      const kit = makeKit({ watchdogMs: 1000 });
      const svc = new ManualUpdateService(kit.deps);
      const check = svc.checkForUpdatesNow();
      await vi.advanceTimersByTimeAsync(0);
      expect(svc.getStatus().state).toBe("checking");
      await vi.advanceTimersByTimeAsync(1000);
      expect(svc.getStatus()).toMatchObject({
        state: "error",
        errorCode: "UPDATE_CHECK_FAILED",
      });
      await check;
    });
    it("clears the watchdog when a terminal event arrives in time", async () => {
      vi.useFakeTimers();
      const kit = makeKit({ watchdogMs: 1000 });
      const svc = new ManualUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit("update-not-available");
      await vi.advanceTimersByTimeAsync(2000);
      expect(svc.getStatus().state).toBe("up-to-date");
    });
  });
});
