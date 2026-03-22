// const keytar = require('keytar')
// import keytar from 'keytar'

import Store from "electron-store";

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

export class ElectronStoreService {
  private store: Store;
  // private service:string;
  constructor(service: string) {
    const appName = getAppName();
    const serviceName = `${appName}_${service}`;
    this.store = new Store(getStoreOptions(serviceName));
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
}
