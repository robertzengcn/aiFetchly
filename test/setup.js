/**
 * Mocha test setup file
 * Configures environment variables and test globals
 */

// Set up test environment variables
process.env.VITE_LOGIN_URL = 'http://localhost:3000';
process.env.VITE_REMOTEADD = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

// Polyfill import.meta.env for Vite compatibility
global.importMetaEnv = {
  VITE_LOGIN_URL: process.env.VITE_LOGIN_URL,
  VITE_REMOTEADD: process.env.VITE_REMOTEADD,
  BASE_URL: process.env.VITE_LOGIN_URL,
};

// Create import.meta object
global.import = {
  meta: {
    env: global.importMetaEnv,
  },
};

// Create a minimal mock for Electron
global.window = {
  location: {
    hostname: 'localhost',
  },
};

// Mock __electronLog for electron-log compatibility
global.__electronLog = {
  transports: [],
  scopes: {},
};

// Mock electron module
const electronMock = {
  app: {
    getName: () => 'aiFetchly',
    getPath: (name) => {
      const paths = {
        home: '/tmp/test/home',
        appData: '/tmp/test/appdata',
        userData: '/tmp/test/userdata',
        temp: '/tmp/test/temp',
      };
      return paths[name] || '/tmp/test';
    },
  },
  BrowserWindow: class MockBrowserWindow {
    constructor() {
      // Mock constructor
    }

    loadURL() {
      // Mock implementation
    }

    reload() {
      // Mock implementation
    }

    destroy() {
      // Mock implementation
    }

    show() {
      // Mock implementation
    }

    hide() {
      // Mock implementation
    }

    close() {
      // Mock implementation
    }

    static getAllWindows() {
      return [];
    }
  },
  ipcMain: {
    handle() {
      // Mock implementation
    },
    on() {
      // Mock implementation
    },
    removeHandler() {
      // Mock implementation
    },
    removeListener() {
      // Mock implementation
    },
    removeAllListeners() {
      // Mock implementation
    },
  },
  ipcRenderer: {
    invoke: async () => undefined,
    send() {
      // Mock implementation
    },
    sendSync() {
      return undefined;
    },
    on() {
      // Mock implementation
    },
    once() {
      // Mock implementation
    },
    removeListener() {
      // Mock implementation
    },
    removeAllListeners() {
      // Mock implementation
    },
  },
};

// Make electron mock available globally for tests that need it
global.electronMock = electronMock;

// Mock the electron module when imported
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(...args) {
  const id = args[0];
  if (id === 'electron') {
    return electronMock;
  }
  if (id === 'electron-log') {
    return {
      info() {
        // Mock implementation
      },
      warn() {
        // Mock implementation
      },
      error() {
        // Mock implementation
      },
      debug() {
        // Mock implementation
      },
      verbose() {
        // Mock implementation
      },
      silly() {
        // Mock implementation
      },
      scopes() {
        return {
          info() {
            // Mock implementation
          },
          warn() {
            // Mock implementation
          },
          error() {
            // Mock implementation
          },
          debug() {
            // Mock implementation
          },
          verbose() {
            // Mock implementation
          },
          silly() {
            // Mock implementation
          },
        };
      },
    };
  }
  return originalRequire.apply(this, args);
};

console.log('✓ Test environment configured');
