/// <reference types="vitest" />
//
// Vite build for the Playwright Electron E2E main-process bundle.
//
// This compiles ONLY:
//   1. The E2E bootstrap entry (src/main-process/e2e/E2EMain.ts) and the
//      production code it pulls in via dynamic import of `../../background`.
//   2. The production preload (built separately via vite.e2e.preload.config.mjs).
//
// It reuses the production main-process externals, resolve aliases, and platform
// copy/interop-fix plugins (vite.main.shared.mjs) so native modules, TypeORM,
// sqlite-vec, and electron-store bundle exactly as they do in production.
//
// Two Forge-injected globals that background.ts relies on are defined here
// directly (Forge is not used for the E2E build):
//   - MAIN_WINDOW_VITE_DEV_SERVER_URL -> the worker Vite renderer origin
//   - MAIN_WINDOW_VITE_NAME            -> "main_window"
//
// Playwright owns the Electron process via _electron.launch(); electron-forge
// start must NOT be the test driver (design §6.1).

import { defineConfig } from "vite";
import alias from "@rollup/plugin-alias";
import * as path from "path";
import {
  MAIN_PROCESS_EXTERNALS,
  MAIN_PROCESS_RESOLVE_ALIAS,
  emptyModulesPlugin,
  fixInteropNamespacePlugin,
  platformCopyPlugin,
} from "./vite.main.shared.mjs";

// The renderer dev server Playwright starts via playwright.config.ts `webServer`.
export const E2E_RENDERER_ORIGIN =
  process.env.AIFETCHLY_E2E_RENDERER_ORIGIN || "http://127.0.0.1:5173";

export default defineConfig({
  plugins: [
    alias(),
    emptyModulesPlugin(),
    // Copy sqlite-vec native extension + platform icon into the E2E build dir
    // so the bundled main process can load them at runtime, mirroring the
    // production platformCopyPlugin run.
    platformCopyPlugin({ outDir: ".vite/e2e/build" }),
    fixInteropNamespacePlugin(),
  ],
  resolve: {
    alias: MAIN_PROCESS_RESOLVE_ALIAS,
    conditions: ["node"],
  },
  define: {
    // Forge normally injects these; define them explicitly for the E2E bundle
    // so background.ts loads the Playwright-managed renderer server and uses the
    // "main_window" renderer name for packaged-HTML path resolution.
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(E2E_RENDERER_ORIGIN),
    MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
    // The E2E suite must never contact the production login backend.
    "process.env.VITE_LOGIN_URL": JSON.stringify(""),
  },
  build: {
    outDir: ".vite/e2e/build",
    // The preload build writes into the same outDir; do not wipe it.
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "src/main-process/e2e/E2EMain.ts"),
      formats: ["cjs"],
      fileName: () => "e2e-main.js",
    },
    rollupOptions: {
      external: MAIN_PROCESS_EXTERNALS,
    },
  },
});
