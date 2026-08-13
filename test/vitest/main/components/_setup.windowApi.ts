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
  Object.defineProperty(window, "api", {
    configurable: true,
    writable: true,
    value: {
      invoke: vi.fn().mockResolvedValue(undefined),
      receive: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    },
  });
});
