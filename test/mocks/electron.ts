/**
 * Mock for Electron module
 * This file is loaded by tests to mock Electron APIs
 */

export const app = {
  getName: () => "aiFetchly",
  getVersion: () => "1.0.0",
  isPackaged: false,
  getPath: (name: string) => {
    const paths: Record<string, string> = {
      home: "/tmp/test/home",
      appData: "/tmp/test/appdata",
      userData: "/tmp/test/userdata",
      temp: "/tmp/test/temp",
    };
    return paths[name] || "/tmp/test";
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

export class BrowserWindow {
  readonly webContents: WebContents = {
    send(_channel: string, ..._args: unknown[]): void {
      // Mock implementation
    },
    isDestroyed(): boolean {
      return false;
    },
  };

  constructor(_options?: unknown) {
    // Mock constructor
  }

  isDestroyed(): boolean {
    return false;
  }

  loadURL(_url: string): void {
    // Mock implementation
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

  hide(): void {
    // Mock implementation
  }

  close(): void {
    // Mock implementation
  }

  static getAllWindows(): unknown[] {
    return [];
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
  sendSync: (_channel: string, ..._args: unknown[]) => {
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
/** Mock WebContents for services that need to send IPC to renderer. */
export interface WebContents {
  send(_channel: string, ..._args: unknown[]): void;
  isDestroyed(): boolean;
}

export const webUtils = {
  getPathForFile(_file: File): string {
    return "";
  },
};

export default {
  app,
  autoUpdater,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  webUtils,
};
