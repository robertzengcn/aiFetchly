/**
 * Mock for electron-store module
 * This file is loaded by tests to mock electron-store APIs
 */

class MockElectronStore {
  private store: Record<string, unknown> = {};

  /** Mock path for compatibility with electron-store API (required by Store type) */
  readonly path: string = '';

  constructor(options?: unknown) {
    // Mock constructor - eslint-disable-next-line @typescript-eslint/no-unused-vars
    options; // Intentionally unused
  }

  get(key: string): unknown {
    return this.store[key];
  }

  set(key: string, value: unknown): void {
    this.store[key] = value;
  }

  has(key: string): boolean {
    return key in this.store;
  }

  delete(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }

  static initRenderer(): void {
    // Mock implementation
  }
}

export default MockElectronStore;
