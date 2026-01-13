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

console.log('✓ Test environment configured');
