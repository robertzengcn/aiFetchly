/**
 * Electron mocks for testing
 * Provides mock implementations of Electron APIs for unit testing
 * Compatible with both Mocha (using Sinon) and Vitest
 */

/**
 * Mock BrowserWindow class
 */
export class MockBrowserWindow {
  public webContents = {
    send: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
    executeJavaScript: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
    loadURL: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
    reload: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
    goBack: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
    goForward: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
    toggleDevTools: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
      // Mock implementation
    },
  };

  public id = 1;
  public isDestroyed = false;
  public isVisible = true;

  constructor(options?: unknown) {
    // Mock constructor - eslint-disable-next-line @typescript-eslint/no-unused-vars
    options; // Intentionally unused
  }

  loadURL(url: string): void {
    // Mock implementation - eslint-disable-next-line @typescript-eslint/no-unused-vars
    url; // Intentionally unused
  }

  reload(): void {
    // Mock implementation
  }

  destroy(): void {
    this.isDestroyed = true;
  }

  show(): void {
    this.isVisible = true;
  }

  hide(): void {
    this.isVisible = false;
  }

  close(): void {
    this.isDestroyed = true;
  }

  static getAllWindows(): MockBrowserWindow[] {
    return [];
  }
}

/**
 * Mock ipcMain handlers storage
 */
const mockHandlers: Map<string, (...args: unknown[]) => unknown> = new Map();

/**
 * Mock ipcMain object
 * Use with Sinon (Mocha) or Vitest mocks
 */
export const mockIpcMain = {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockHandlers.set(channel, handler);
  },

  on: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mockHandlers.set(channel, handler);
  },

  removeHandler: (channel: string) => {
    mockHandlers.delete(channel);
  },

  removeListener: (channel: string) => {
    mockHandlers.delete(channel);
  },

  removeAllListeners: (channel?: string) => {
    if (channel) {
      mockHandlers.delete(channel);
    } else {
      mockHandlers.clear();
    }
  },

  // Helper method to call a handler (for testing)
  callHandler: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    const handler = mockHandlers.get(channel);
    if (handler) {
      return await handler(...args);
    }
    throw new Error(`No handler registered for channel: ${channel}`);
  },

  // Helper method to get all registered channels
  getRegisteredChannels: (): string[] => {
    return Array.from(mockHandlers.keys());
  },

  // Helper method to clear all handlers
  clearHandlers: (): void => {
    mockHandlers.clear();
  },
};

/**
 * Mock ipcRenderer object (for renderer process tests)
 */
export const mockIpcRenderer = {
  invoke: () => Promise.resolve(undefined),
  send: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
    // Mock implementation
  },
  sendSync: () => undefined,
  on: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
    // Mock implementation
  },
  once: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
    // Mock implementation
  },
  removeListener: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
    // Mock implementation
  },
  removeAllListeners: /* eslint-disable-line @typescript-eslint/no-empty-function */ () => {
    // Mock implementation
  },
};

/**
 * Setup function to mock Electron in tests
 */
export function setupElectronMocks(): void {
  // Clear all handlers before each test
  mockIpcMain.clearHandlers();
}

/**
 * Reset function to clean up after tests
 */
export function resetElectronMocks(): void {
  mockIpcMain.clearHandlers();
}
