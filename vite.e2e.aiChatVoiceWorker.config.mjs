//
// Vite build for the Playwright Electron E2E local voice worker bundle.
//
// The production voice launcher (SherpaVoiceWorkerClient) forks
// `AiChatVoiceWorker.js` resolved relative to the main bundle's __dirname,
// which is `.vite/e2e/build` for the E2E main process. `yarn build:e2e`
// therefore must emit an AiChatVoiceWorker.js into that directory — otherwise
// every transcription/synthesis request fails fast with "Local voice worker
// file not found" and the voice parity E2E (aiChatVoiceParity.test.ts) cannot
// reach the worker-level missing-runtime/model paths.
//
// This reuses the production `vite.aiChatVoiceWorker.config.mjs` as a base
// (plugins, alias, native/heavy external list identical to production) and
// overrides only the output directory. The E2E main bundle lives in the same
// dir; emptyOutDir:false so it never deletes e2e-main.js.
//
// Usage: invoked by scripts/build-electron-e2e.mjs.
//

import { defineConfig, mergeConfig } from "vite";
// eslint-disable-next-line import/default
import aiChatVoiceWorkerConfig from "./vite.aiChatVoiceWorker.config.mjs";

const devWorkerConfig =
  typeof aiChatVoiceWorkerConfig === "function"
    ? aiChatVoiceWorkerConfig({ mode: "development", command: "build" })
    : aiChatVoiceWorkerConfig;

export default defineConfig(
  mergeConfig(devWorkerConfig, {
    build: {
      outDir: ".vite/e2e/build",
      // The E2E main bundle is already in this dir; do not wipe it.
      emptyOutDir: false,
      rollupOptions: {
        output: {
          dir: ".vite/e2e/build",
          entryFileNames: "AiChatVoiceWorker.js",
        },
      },
    },
  })
);
