/**
 * Mock for electron-log module
 * This file is loaded by tests to mock electron-log APIs
 */

const logFunctions = {
  info: (..._args: unknown[]) => {
    // Silent in tests
  },
  warn: (..._args: unknown[]) => {
    // Silent in tests
  },
  error: (..._args: unknown[]) => {
    // Silent in tests
  },
  debug: (..._args: unknown[]) => {
    // Silent in tests
  },
  verbose: (..._args: unknown[]) => {
    // Silent in tests
  },
  silly: (..._args: unknown[]) => {
    // Silent in tests
  },
};

const createScopedLogger = (_scopeName: string) => ({
  ...logFunctions,
});

export const log = {
  ...logFunctions,
  scopes: (scopeNames: string | string[]) => {
    if (typeof scopeNames === 'string') {
      return createScopedLogger(scopeNames);
    }
    // Return default logger for multiple scopes
    return logFunctions;
  },
  create: createScopedLogger,
};

export default log;

// Set global __electronLog for compatibility
(globalThis as unknown as { __electronLog: Record<string, unknown> }).__electronLog = {
  transports: [],
  scopes: {},
};
