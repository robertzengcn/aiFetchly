// const keytar = require('keytar')
// import keytar from 'keytar'

import Store from "electron-store";

type GlobalElectronStoreState = typeof globalThis & {
  __aifetchlyElectronStores?: Map<string, Store>;
};

/**
 * Get app name. Safe when run in child/worker process where electron.app is undefined.
 * In that case uses ELECTRON_APP_NAME env (set by main when forking) or fallback 'aiFetchly'.
 */
function getAppName(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require("electron") as { app?: { getName?: () => string } };
    if (app && typeof app.getName === "function") {
      return app.getName();
    }
  } catch {
    // Not in Electron or app unavailable (e.g. utility process / taskCode child)
  }
  return process.env.ELECTRON_APP_NAME ?? "aiFetchly";
}

/**
 * Options for Store when running outside main process (no electron.app).
 * Uses ELECTRON_USER_DATA_PATH so child process shares the same store as main.
 */
function getStoreOptions(serviceName: string): { name: string; cwd?: string } {
  const opts: { name: string; cwd?: string } = { name: serviceName };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require("electron") as {
      app?: { getPath?: (name: string) => string };
    };
    if (app && typeof app.getPath === "function") {
      // Main process: electron-store will use userData by default
      return opts;
    }
  } catch {
    // Not in Electron main process
  }
  const userDataPath = process.env.ELECTRON_USER_DATA_PATH;
  if (userDataPath) {
    opts.cwd = userDataPath;
  }
  return opts;
}

function getStoreCache(): Map<string, Store> {
  const globalState = globalThis as GlobalElectronStoreState;
  if (!globalState.__aifetchlyElectronStores) {
    globalState.__aifetchlyElectronStores = new Map<string, Store>();
  }
  return globalState.__aifetchlyElectronStores;
}

/**
 * Reuse one electron-store instance per service name.
 *
 * Creating `new Store()` repeatedly re-enters electron-store's IPC setup. With
 * Vite HMR / multiple bundle copies that can stack `electron-store-get-data`
 * listeners on ipcMain and trigger MaxListenersExceededWarning. Caching on
 * globalThis keeps a single Store (and a single IPC registration) for the
 * process lifetime.
 */
function getOrCreateStore(serviceName: string): Store {
  const cache = getStoreCache();
  const existing = cache.get(serviceName);
  if (existing) {
    return existing;
  }
  const store = new Store(getStoreOptions(serviceName));
  cache.set(serviceName, store);
  return store;
}

export class ElectronStoreService {
  private store: Store;
  // private service:string;
  constructor(service: string) {
    const appName = getAppName();
    const serviceName = `${appName}_${service}`;
    this.store = getOrCreateStore(serviceName);
    // console.log('Store Path:', this.store.path);
  }
  public setValue(key: string, value: string): void {
    this.store.set(key, value);
  }
  //get password
  public getValue(key: string): unknown {
    return this.store.get(key);
  }

  public deleteValue(key: string): void {
    this.store.delete(key);
  }

  public clearStore(): void {
    this.store.clear();
  }

  /** Test helper: expose whether two services share one Store instance. */
  public getStoreForTests(): Store {
    return this.store;
  }
}
