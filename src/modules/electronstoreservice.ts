// const keytar = require('keytar')
// import keytar from 'keytar'

import Store from "electron-store";
import { SecureStore, isSecureStoreEnabled } from "@/modules/SecureStore";

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
    this.store = new Store(options as never);
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
}
