// const keytar = require('keytar')
// import keytar from 'keytar'

import Store from "electron-store";
import { SecureStore, isSecureStoreEnabled } from "@/modules/SecureStore";

type GlobalElectronStoreState = typeof globalThis & {
  __aifetchlyElectronStores?: Map<string, Store>;
};

type ElectronStoreConstructorOptions = {
  name: string;
  cwd?: string;
  projectName?: string;
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
      const name = app.getName();
      if (typeof name === "string" && name.trim().length > 0) {
        return name;
      }
    }
  } catch {
    // Not in Electron or app unavailable (e.g. utility process / taskCode child)
  }
  const fromEnv = process.env.ELECTRON_APP_NAME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return "aiFetchly";
}

function resolveUserDataPath(): string | undefined {
  const fromEnv = process.env.ELECTRON_USER_DATA_PATH;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require("electron") as {
      app?: { getPath?: (name: string) => string };
    };
    if (app && typeof app.getPath === "function") {
      const userData = app.getPath("userData");
      if (typeof userData === "string" && userData.trim().length > 0) {
        return userData;
      }
    }
  } catch {
    // Not in Electron, or getPath unavailable in this process type
  }
  return undefined;
}

/**
 * Options for Store that remain valid in main, utilityProcess, and
 * ELECTRON_RUN_AS_NODE workers.
 *
 * electron-store only auto-resolves `cwd` from `app.getPath("userData")` when
 * BOTH `app` and `ipcMain` exist (main process). Utility processes expose `app`
 * without `ipcMain`, so omitting `cwd` leaves Conf with `cwd === undefined`.
 * Inside a packaged asar, Conf then fails with:
 *   "Project name could not be inferred. Please specify the `projectName` option."
 * and Node emits DEP0187 when existsSync receives a non-string path.
 *
 * Always pass an absolute cwd when known, plus projectName as a fallback so
 * Conf can still build env-paths if cwd is unavailable.
 */
function getStoreOptions(serviceName: string): ElectronStoreConstructorOptions {
  const opts: ElectronStoreConstructorOptions = {
    name: serviceName,
    projectName: getAppName(),
  };
  const userDataPath = resolveUserDataPath();
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

/**
 * Internal store interface — abstracts over plain Store and SecureStore so
 * ElectronStoreService callers are unchanged regardless of encryption mode.
 */
interface IStore {
  setValue(key: string, value: string): void;
  getValue(key: string): unknown;
  deleteValue(key: string): void;
  clearStore(): void;
}

/** Plain store adapter — wraps electron-store's set/get/delete/clear. */
class PlainStoreAdapter implements IStore {
  private store: Store;
  constructor(options: unknown) {
    // Reuse one electron-store instance per service name (see getOrCreateStore)
    // so repeated construction cannot stack IPC listeners.
    const opts = options as { name?: unknown };
    const serviceName = typeof opts.name === "string" ? opts.name : "";
    this.store = serviceName
      ? getOrCreateStore(serviceName)
      : new Store(options as never);
  }
  setValue(key: string, value: string): void {
    this.store.set(key, value);
  }
  getValue(key: string): unknown {
    return this.store.get(key);
  }
  deleteValue(key: string): void {
    this.store.delete(key);
  }
  clearStore(): void {
    this.store.clear();
  }

  /** Expose the underlying shared Store (test helper). */
  getStore(): Store {
    return this.store;
  }
}

export class ElectronStoreService {
  private backend: IStore;

  constructor(service: string) {
    const appName = getAppName();
    const serviceName = `${appName}_${service}`;
    const options = getStoreOptions(serviceName);

    // WS-1 R1.1: when AIFETCHLY_ENCRYPT_STORE=1, use SecureStore (safeStorage)
    // to encrypt sensitive keys at rest. Default off — see ADR-0001.
    if (isSecureStoreEnabled()) {
      this.backend = new SecureStore(options);
    } else {
      this.backend = new PlainStoreAdapter(options);
    }
  }

  public setValue(key: string, value: string): void {
    this.backend.setValue(key, value);
  }

  public getValue(key: string): unknown {
    return this.backend.getValue(key);
  }

  public deleteValue(key: string): void {
    this.backend.deleteValue(key);
  }

  public clearStore(): void {
    this.backend.clearStore();
  }

  /** Test helper: expose the shared Store instance (plain mode only). */
  public getStoreForTests(): Store {
    if (this.backend instanceof PlainStoreAdapter) {
      return this.backend.getStore();
    }
    throw new Error(
      "getStoreForTests is only supported in plain (non-encrypted) store mode"
    );
  }
}
