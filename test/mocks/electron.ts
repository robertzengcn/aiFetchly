/**
 * Mock for Electron module
 * This file is loaded by tests (and via tsconfig paths) to mock Electron APIs.
 * Keep surface area aligned with production imports so `tsc --noEmit` stays green.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- mock stubs intentionally ignore params */

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebPreferences {
  nodeIntegration?: boolean;
  contextIsolation?: boolean;
  sandbox?: boolean;
  preload?: string;
  session?: unknown;
  // Allow additional Electron webPreferences keys used across the app.
  [key: string]: unknown;
}

export interface BrowserWindowConstructorOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  show?: boolean;
  frame?: boolean;
  transparent?: boolean;
  alwaysOnTop?: boolean;
  skipTaskbar?: boolean;
  resizable?: boolean;
  maximizable?: boolean;
  minimizable?: boolean;
  fullscreenable?: boolean;
  focusable?: boolean;
  hasShadow?: boolean;
  webPreferences?: WebPreferences;
  // Allow additional BrowserWindow option keys used across the app.
  [key: string]: unknown;
}

export interface EventLike {
  preventDefault(): void;
}

declare global {
  // Production code references the global Electron namespace (real electron.d.ts).
  // When tsconfig remaps "electron" → this mock, that global is never loaded, so
  // we declare the subset used by src/.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron {
    interface Rectangle {
      x: number;
      y: number;
      width: number;
      height: number;
    }
    interface WebPreferences {
      nodeIntegration?: boolean;
      contextIsolation?: boolean;
      sandbox?: boolean;
      preload?: string;
      session?: unknown;
      [key: string]: unknown;
    }
    interface BrowserWindowConstructorOptions {
      width?: number;
      height?: number;
      x?: number;
      y?: number;
      show?: boolean;
      frame?: boolean;
      transparent?: boolean;
      alwaysOnTop?: boolean;
      skipTaskbar?: boolean;
      resizable?: boolean;
      maximizable?: boolean;
      minimizable?: boolean;
      fullscreenable?: boolean;
      focusable?: boolean;
      hasShadow?: boolean;
      webPreferences?: Electron.WebPreferences;
      [key: string]: unknown;
    }
  }
}

export const app = {
  isReady: () => false,
  getName: () => "aiFetchly",
  getVersion: () => "1.0.0",
  isPackaged: false,
  userAgentFallback: "",
  getPath: (name: string) => {
    const paths: Record<string, string> = {
      home: "/tmp/test/home",
      appData: "/tmp/test/appdata",
      userData: "/tmp/test/userdata",
      temp: "/tmp/test/temp",
    };
    return paths[name] || "/tmp/test";
  },
  // E2E bootstrap (src/main-process/e2e/E2EMain.ts) redirects userData into the
  // per-test root via app.setPath. No-op in tests.
  setPath(_name: string, _target: string): void {
    // mock
  },
  quit(): void {
    // Mock implementation
  },
  exit(_code?: number): void {
    // Mock implementation
  },
  on(_event: string, _listener: (...args: unknown[]) => void): void {
    // Mock implementation (Electron's App.on returns App for chaining; tests don't chain)
  },
  off(_event: string, _listener: (...args: unknown[]) => void): void {
    // Mock implementation
  },
  once(_event: string, _listener: (...args: unknown[]) => void): void {
    // Mock implementation
  },
  whenReady(): Promise<void> {
    return Promise.resolve();
  },
  isDefaultProtocolClient(_protocol: string): boolean {
    return false;
  },
  setAsDefaultProtocolClient(_protocol: string): boolean {
    return true;
  },
  disableHardwareAcceleration(): void {
    // Mock implementation
  },
  commandLine: {
    appendSwitch(_switchName: string): void {
      // Mock implementation
    },
  },
};

/**
 * Minimal `autoUpdater` surface used by AppUpdateService. Tests inject their
 * own fake via the service's dependency interface, so this only needs to
 * satisfy TypeScript for main-process wiring code.
 */
export const autoUpdater = {
  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return undefined;
  },
  checkForUpdates(): void {
    // mock
  },
  quitAndInstall(): void {
    // mock
  },
};

export interface ProtocolPrivilege {
  standard?: boolean;
  secure?: boolean;
  supportFetchAPI?: boolean;
  corsEnabled?: boolean;
}

export interface ProtocolScheme {
  scheme: string;
  privileges?: ProtocolPrivilege;
}

export const protocol = {
  registerSchemesAsPrivileged(_schemes: ProtocolScheme[]): void {
    // Mock implementation
  },
  handle(
    _scheme: string,
    _handler: (request: Request) => Response | Promise<Response>
  ): void {
    // Mock implementation
  },
};

export const net = {
  async fetch(input: string): Promise<Response> {
    return fetch(input);
  },
};

export const screen = {
  getDisplayMatching(_rect: Rectangle): { workArea: Rectangle } {
    return { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  },
  getPrimaryDisplay(): { workArea: Rectangle } {
    return { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  },
};

/** Mock WebContents for services that need to send IPC to renderer. */
export type WebContentsListener = (
  event: EventLike,
  url: string,
  ...rest: unknown[]
) => void;

export interface WebContents {
  send(_channel: string, ..._args: unknown[]): void;
  isDestroyed(): boolean;
  on(event: string, listener: WebContentsListener): void;
  setWindowOpenHandler(
    _handler: (details: { url: string }) => {
      action: "deny" | "allow";
      overrideBrowserWindowOptions?: Record<string, unknown>;
    }
  ): void;
  openDevTools(): void;
}

export class BrowserWindow {
  readonly webContents: WebContents = {
    send(_channel: string, ..._args: unknown[]): void {
      // Mock implementation
    },
    isDestroyed(): boolean {
      return false;
    },
    on(_event: string, _listener: WebContentsListener): void {
      // Mock implementation
    },
    setWindowOpenHandler(_handler: (details: { url: string }) => void): void {
      // Mock implementation
    },
    openDevTools(): void {
      // Mock implementation
    },
  };

  constructor(_options?: BrowserWindowConstructorOptions) {
    // Mock constructor
  }

  loadURL(_url: string): Promise<void> {
    // Mock implementation (real Electron returns Promise<void>)
    return Promise.resolve();
  }

  setTitle(_title: string): void {
    // Mock implementation
  }

  setMenu(_menu: unknown): void {
    // Mock implementation
  }

  once(_event: string, _handler: (...args: unknown[]) => void): this {
    return this;
  }

  reload(): void {
    // Mock implementation
  }

  destroy(): void {
    // Mock implementation
  }

  show(): void {
    // Mock implementation
  }

  showInactive(): void {
    // Mock implementation
  }

  hide(): void {
    // Mock implementation
  }

  close(): void {
    // Mock implementation
  }

  maximize(): void {
    // Mock implementation
  }

  restore(): void {
    // Mock implementation
  }

  focus(): void {
    // Mock implementation
  }

  isDestroyed(): boolean {
    return false;
  }

  isMinimized(): boolean {
    return false;
  }

  isFocused(): boolean {
    return false;
  }

  isVisible(): boolean {
    return true;
  }

  setAutoHideMenuBar(_hide: boolean): void {
    // Mock implementation
  }

  setMenuBarVisibility(_visible: boolean): void {
    // Mock implementation
  }

  isMenuBarVisible(): boolean {
    return false;
  }

  getBounds(): Rectangle {
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  setBounds(_bounds: Rectangle): void {
    // Mock implementation
  }

  setAlwaysOnTop(_flag: boolean, _level?: string): void {
    // Mock implementation
  }

  setVisibleOnAllWorkspaces(
    _visible: boolean,
    _options?: { visibleOnFullScreen?: boolean }
  ): void {
    // Mock implementation
  }

  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }

  static getAllWindows(): unknown[] {
    return [];
  }

  /** Mirrors Electron's static lookup; returns null in tests. */
  static fromWebContents(_contents: unknown): BrowserWindow | null {
    return null;
  }
}

export const ipcMain = {
  handle: (_channel: string, _handler: (...args: unknown[]) => unknown) => {
    // Mock implementation
  },
  on: (_channel: string, _handler: (...args: unknown[]) => unknown) => {
    // Mock implementation
  },
  removeHandler: (_channel: string) => {
    // Mock implementation
  },
  removeListener: (_channel: string) => {
    // Mock implementation
  },
  removeAllListeners: (_channel?: string) => {
    // Mock implementation
  },
};

export const ipcRenderer = {
  invoke: async (_channel: string, ..._args: unknown[]) => {
    return undefined;
  },
  send: (_channel: string, ..._args: unknown[]) => {
    // Mock implementation
  },
  // electron-store v8's constructor (renderer branch) calls
  // `ipcRenderer.sendSync('electron-store-get-data')` and throws
  // "You need to call `.initRenderer()`" when it returns a falsy value.
  // Under the tsx test loader this mock IS the electron module (see
  // tsconfig.json `paths`), and module tests construct Token/Store in the
  // main-process role, so answer as a real main process's
  // `initDataListener()` would: { defaultCwd, appVersion }. This keeps the
  // real electron-store usable from tests without `.initRenderer()`.
  sendSync: (channel: string, ..._args: unknown[]) => {
    if (channel === "electron-store-get-data") {
      return {
        defaultCwd: app.getPath("userData"),
        appVersion: app.getVersion(),
      };
    }
    return undefined;
  },
  on: (_channel: string, _handler: (...args: unknown[]) => unknown) => {
    // Mock implementation
  },
  once: (_channel: string, _handler: (...args: unknown[]) => unknown) => {
    // Mock implementation
  },
  removeListener: (
    _channel: string,
    _handler: (...args: unknown[]) => unknown
  ) => {
    // Mock implementation
  },
  removeAllListeners: (_channel?: string) => {
    // Mock implementation
  },
};

/** Matches Electron `webUtils`; runtime preload resolves real `electron` from node_modules. */
export const webUtils = {
  getPathForFile(_file: File): string {
    return "";
  },
};

/** Matches Electron `safeStorage` (OS keychain / DPAPI / libsecret). */
export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return false;
  },
  encryptString(_plainText: string): Buffer {
    return Buffer.alloc(0);
  },
  decryptString(_encrypted: Buffer): string {
    return "";
  },
};

export default {
  app,
  autoUpdater,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  protocol,
  net,
  screen,
  webUtils,
  safeStorage,
};
