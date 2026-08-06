import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeUpdateSupport,
  mapAutoUpdaterEvent,
} from '@/main-process/updater/UpdateStatus';
import {
  AppUpdateService,
  type AppUpdateServiceDeps,
} from '@/main-process/updater/AppUpdateService';

/**
 * Minimal autoUpdater fake. Captures event listeners so tests can emit events,
 * and counts checkForUpdates / quitAndInstall calls.
 */
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
    const list = this.listeners.get(event);
    if (list) {
      list.forEach((l) => l(...args));
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}

interface FakeDepsKit {
  autoUpdater: FakeAutoUpdater;
  deps: AppUpdateServiceDeps;
  setNow: (ms: number) => void;
  setVersion: (v: string) => void;
  updateElectronAppCalls: { count: number; lastOptions: Record<string, unknown> | null };
}

function makeKit(overrides: Partial<AppUpdateServiceDeps> = {}): FakeDepsKit {
  const autoUpdater = new FakeAutoUpdater();
  const updateElectronAppCalls = { count: 0, lastOptions: null as Record<string, unknown> | null };
  const fakeUpdateElectronApp = (options: Record<string, unknown>): void => {
    updateElectronAppCalls.count += 1;
    updateElectronAppCalls.lastOptions = options;
  };
  let version = '1.2.3';
  let nowMs = 1_000_000;
  const deps: AppUpdateServiceDeps = {
    isPackaged: () => true,
    platform: () => 'win32',
    isWindowsStore: () => false,
    getAppVersion: () => version,
    getAutoUpdater: () => autoUpdater,
    getUpdateElectronApp: () => fakeUpdateElectronApp,
    now: () => nowMs,
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
    updateElectronAppCalls,
  };
}

describe('computeUpdateSupport', () => {
  it('rejects unpackaged development builds', () => {
    expect(computeUpdateSupport({ isPackaged: false, platform: 'win32', isWindowsStore: false }))
      .toEqual({ supported: false, reason: 'development' });
  });

  it('rejects Microsoft Store / MSIX builds even when packaged', () => {
    expect(computeUpdateSupport({ isPackaged: true, platform: 'win32', isWindowsStore: true }))
      .toEqual({ supported: false, reason: 'store' });
  });

  it('rejects unsupported platforms (linux)', () => {
    expect(computeUpdateSupport({ isPackaged: true, platform: 'linux', isWindowsStore: false }))
      .toEqual({ supported: false, reason: 'platform' });
  });

  it('accepts packaged Windows GitHub builds', () => {
    expect(computeUpdateSupport({ isPackaged: true, platform: 'win32', isWindowsStore: false }))
      .toEqual({ supported: true });
  });

  it('accepts packaged macOS GitHub builds (arm64 + x64)', () => {
    expect(computeUpdateSupport({ isPackaged: true, platform: 'darwin', isWindowsStore: false }))
      .toEqual({ supported: true });
  });

  it('development reason takes precedence over store', () => {
    // Unpackaged dev run reported as windowsStore — still development.
    expect(computeUpdateSupport({ isPackaged: false, platform: 'win32', isWindowsStore: true }))
      .toEqual({ supported: false, reason: 'development' });
  });
});

describe('mapAutoUpdaterEvent', () => {
  it('maps each known event to its UI state', () => {
    expect(mapAutoUpdaterEvent('checking-for-update')).toBe('checking');
    expect(mapAutoUpdaterEvent('update-available')).toBe('downloading');
    expect(mapAutoUpdaterEvent('update-not-available')).toBe('up-to-date');
    expect(mapAutoUpdaterEvent('update-downloaded')).toBe('ready-to-restart');
    expect(mapAutoUpdaterEvent('error')).toBe('error');
  });

  it('returns null for events Phase 1 ignores', () => {
    expect(mapAutoUpdaterEvent('download-progress')).toBeNull();
    expect(mapAutoUpdaterEvent('unexpected')).toBeNull();
  });
});

describe('AppUpdateService', () => {
  describe('initial status', () => {
    it('reports idle with current version on a supported channel', () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      const status = svc.getStatus();
      expect(status.state).toBe('idle');
      expect(status.currentVersion).toBe('1.2.3');
      expect(status.unsupportedReason).toBeUndefined();
    });

    it('reports unsupported (development) on an unpackaged build', () => {
      const kit = makeKit({ isPackaged: () => false });
      const svc = new AppUpdateService(kit.deps);
      const status = svc.getStatus();
      expect(status.state).toBe('unsupported');
      expect(status.unsupportedReason).toBe('development');
    });

    it('reports unsupported (store) on a windowsStore build', () => {
      const kit = makeKit({ isWindowsStore: () => true });
      const svc = new AppUpdateService(kit.deps);
      expect(svc.getStatus().unsupportedReason).toBe('store');
    });

    it('reports unsupported (platform) on linux', () => {
      const kit = makeKit({ platform: () => 'linux' });
      const svc = new AppUpdateService(kit.deps);
      expect(svc.getStatus().unsupportedReason).toBe('platform');
    });
  });

  describe('initializeAppUpdates', () => {
    it('configures update-electron-app and subscribes events once when supported', () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      svc.initializeAppUpdates();
      svc.initializeAppUpdates(); // second call must be a no-op

      expect(kit.updateElectronAppCalls.count).toBe(1);
      expect(kit.updateElectronAppCalls.lastOptions).toMatchObject({
        repo: 'robertzengcn/aiFetchly',
        updateInterval: '1 hour',
      });
      // Five autoUpdater events subscribed exactly once each.
      expect(kit.autoUpdater.listenerCount('checking-for-update')).toBe(1);
      expect(kit.autoUpdater.listenerCount('update-available')).toBe(1);
      expect(kit.autoUpdater.listenerCount('update-not-available')).toBe(1);
      expect(kit.autoUpdater.listenerCount('update-downloaded')).toBe(1);
      expect(kit.autoUpdater.listenerCount('error')).toBe(1);
    });

    it('does not touch update-electron-app or autoUpdater when unsupported', () => {
      const kit = makeKit({ isPackaged: () => false });
      const svc = new AppUpdateService(kit.deps);
      svc.initializeAppUpdates();

      expect(kit.updateElectronAppCalls.count).toBe(0);
      expect(kit.autoUpdater.listenerCount('checking-for-update')).toBe(0);
    });
  });

  describe('checkForUpdatesNow', () => {
    it('returns unsupported snapshot without invoking autoUpdater', async () => {
      const kit = makeKit({ isPackaged: () => false });
      const svc = new AppUpdateService(kit.deps);
      const status = await svc.checkForUpdatesNow();
      expect(status.state).toBe('unsupported');
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(0);
    });

    it('triggers autoUpdater.checkForUpdates and enters checking state', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      const status = await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1);
      expect(status.state).toBe('checking');
      expect(svc.getStatus().state).toBe('checking');
    });

    it('does not start a second concurrent check while checking', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow(); // -> checking
      const status = await svc.checkForUpdatesNow(); // concurrent -> no-op
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1);
      expect(status.state).toBe('checking');
    });

    it('does not start a second concurrent check while downloading', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit('update-available'); // -> downloading
      await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1);
      expect(svc.getStatus().state).toBe('downloading');
    });

    it('respects the 60s cooldown after a terminal result', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit('update-not-available'); // -> up-to-date, stamps lastCheckedAt
      kit.setNow(1_000_000 + 30_000); // 30s later, inside cooldown

      await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(1); // still one
      expect(svc.getStatus().state).toBe('up-to-date');
    });

    it('allows a new check after the cooldown elapses', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit('update-not-available');
      kit.setNow(1_000_000 + 61_000); // past 60s cooldown

      await svc.checkForUpdatesNow();
      expect(kit.autoUpdater.checkForUpdatesCalls).toBe(2);
    });
  });

  describe('autoUpdater event handling', () => {
    it('transitions to up-to-date and stamps lastCheckedAt', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.setNow(2_000_000);
      kit.autoUpdater.emit('update-not-available');

      const status = svc.getStatus();
      expect(status.state).toBe('up-to-date');
      expect(status.lastCheckedAt).toBe(2_000_000);
    });

    it('transitions to ready-to-restart and captures available version', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit('update-downloaded', {}, { version: '1.3.0' });

      const status = svc.getStatus();
      expect(status.state).toBe('ready-to-restart');
      expect(status.availableVersion).toBe('1.3.0');
    });

    it('transitions to error with a bounded errorCode, never raw message', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit('error', new Error('ECONNREFUSED secrets: sk-xxxx'));

      const status = svc.getStatus();
      expect(status.state).toBe('error');
      expect(status.errorCode).toBe('UPDATE_CHECK_FAILED');
      expect(JSON.stringify(status)).not.toContain('sk-xxxx');
    });
  });

  describe('quitAndInstall', () => {
    it('installs when an update is downloaded', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      await svc.checkForUpdatesNow();
      kit.autoUpdater.emit('update-downloaded', {}, { version: '1.3.0' });

      svc.quitAndInstall();
      expect(kit.autoUpdater.quitAndInstallCalls).toBe(1);
    });

    it('refuses to install when not ready-to-restart', () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      svc.quitAndInstall();
      expect(kit.autoUpdater.quitAndInstallCalls).toBe(0);
    });
  });

  describe('status sink', () => {
    it('pushes every transition to the sink', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      const seen: string[] = [];
      svc.setStatusSink((s) => seen.push(s.state));

      await svc.checkForUpdatesNow(); // checking
      kit.autoUpdater.emit('update-not-available'); // up-to-date

      expect(seen).toEqual(['checking', 'up-to-date']);
    });

    it('can detach the sink', async () => {
      const kit = makeKit();
      const svc = new AppUpdateService(kit.deps);
      const seen: string[] = [];
      svc.setStatusSink((s) => seen.push(s.state));
      svc.setStatusSink(null);

      await svc.checkForUpdatesNow();
      expect(seen).toHaveLength(0);
    });
  });
});
