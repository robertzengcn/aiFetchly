// test/vitest/main/components/_setup.windowApi.ts
//
// Global setup for the component-test subtree.
//
// AiChatV2 mounts unconditionally register IPC subscriptions through the
// @/views/api/* modules (onLocalAiRuntimeProgress, onVoiceModelDownloadProgress,
// onAifetchlyConfigChanged, ...). Those wrappers call window.api.receive /
// invoke / removeListener / send. happy-dom provides no window.api, so any
// AiChatV2-mount test that doesn't individually mock every one of those modules
// crashes inside onMounted with "Cannot read properties of undefined (reading
// 'receive')". Stub window.api once here so mount tests only have to mock the
// modules whose behavior they actually assert on.
import { vi, beforeAll } from "vitest";

beforeAll(() => {
  // P1-fix (CI flake): under Node 26 + happy-dom `window.localStorage` can
  // be UNDEFINED on some workers, and the global `localStorage` binding
  // then reads undefined too — tests touching bare
  // `localStorage.setItem/getItem/clear` crashed with "Cannot read
  // properties of undefined". Install a functional in-memory storage
  // shim whenever the DOM storage is missing.
  const globalScope = globalThis as {
    localStorage?: unknown;
  };
  if (window.localStorage === undefined) {
    const store = new Map<string, string>();
    const shim = {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(String(key), String(value));
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
      clear: (): void => {
        store.clear();
      },
      key: (index: number): string | null =>
        [...store.keys()][index] ?? null,
      get length(): number {
        return store.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: shim,
    });
  }
  if (typeof globalScope.localStorage === "undefined") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        return window.localStorage;
      },
    });
  }
  Object.defineProperty(window, "api", {
    configurable: true,
    writable: true,
    value: {
      invoke: vi.fn().mockResolvedValue(undefined),
      receive: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
      send: vi.fn(),
    },
  });
});
