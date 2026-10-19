//
// Vite build for the Playwright Electron E2E workspace watch worker bundle.
//
// The workspace watch manager (WorkspaceWatchManager) forks
// `WorkspaceConfigWatchWorker.js` resolved relative to the main bundle's
// __dirname, which is `.vite/e2e/build` for the E2E main process. Without this
// bundle the fork fails in E2E sessions, no config scan snapshots ever land,
// previewWorkspaceAgents always returns nothing, and the AGENTS.md trust card
// can never mount — the trust E2E (workspace-workspace-lifecycle.test.ts)
// would be impossible.
//
// This reuses the production `vite.aifetchlyConfigWorker.config.mjs` as a base
// (plugins, alias, external list identical to production) and overrides only
// the output directory. The E2E main bundle lives in the same dir;
// emptyOutDir:false so it never deletes e2e-main.js.
//
// Usage: invoked by scripts/build-electron-e2e.mjs.
//

import { defineConfig, mergeConfig } from "vite";
// eslint-disable-next-line import/default
import aifetchlyConfigWorkerConfig from "./vite.aifetchlyConfigWorker.config.mjs";

const devWorkerConfig =
  typeof aifetchlyConfigWorkerConfig === "function"
    ? aifetchlyConfigWorkerConfig({ mode: "development", command: "build" })
    : aifetchlyConfigWorkerConfig;

export default defineConfig(
  mergeConfig(devWorkerConfig, {
    build: {
      outDir: ".vite/e2e/build",
      // The E2E main bundle is already in this dir; do not wipe it.
      emptyOutDir: false,
      rollupOptions: {
        output: {
          dir: ".vite/e2e/build",
          entryFileNames: "WorkspaceConfigWatchWorker.js",
        },
      },
    },
  })
);
