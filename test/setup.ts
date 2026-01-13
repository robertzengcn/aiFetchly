/**
 * Mocha test setup file
 * Configures environment variables and test globals
 */

// Set up test environment variables
process.env.VITE_LOGIN_URL = 'http://localhost:3000';
process.env.VITE_REMOTEADD = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

// Create a minimal mock for Electron
(global as any).window = {
  location: {
    hostname: 'localhost',
  },
};

// Mock console methods to avoid clutter
(global as any).console = {
  ...console,
  log: () => {}, // Suppress logs in tests
};

console.log('✓ Test environment configured');
