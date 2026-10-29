//
// Vite build for the Playwright Electron E2E managed-browser worker bundle.
//
// The production session worker launcher (ManagedBrowserWorkerClient) forks
// `ManagedBrowser.js` resolved relative to the main bundle's __dirname, which
// is `.vite/e2e/build` for the E2E main process. `yarn build:e2e` therefore
// must emit a ManagedBrowser.js into that directory — otherwise every
// managed-browser session start fails with "Managed browser worker file not
// found" and the real-Chrome E2E (managedBrowser.test.ts) cannot run.
//
// This reuses the production `vite.managedBrowserWorker.config.mjs` as a base
// (plugins, alias, native/heavy external list identical to production) and
// overrides only the output directory. The E2E main bundle lives in the same
// dir; emptyOutDir:false so it never deletes e2e-main.js.
//
// Usage: invoked by scripts/build-electron-e2e.mjs.
//

import { defineConfig, mergeConfig } from "vite";
import * as path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line import/default
import managedBrowserWorkerConfig from "./vite.managedBrowserWorker.config.mjs";

const devWorkerConfig =
  typeof managedBrowserWorkerConfig === "function"
    ? managedBrowserWorkerConfig({ mode: "development", command: "build" })
    : managedBrowserWorkerConfig;

export default defineConfig(
  mergeConfig(devWorkerConfig, {
    build: {
      outDir: ".vite/e2e/build",
      // The E2E main bundle is already in this dir; do not wipe it.
      emptyOutDir: false,
      rollupOptions: {
        output: {
          dir: ".vite/e2e/build",
          entryFileNames: "ManagedBrowser.js",
        },
      },
    },
  })
);
