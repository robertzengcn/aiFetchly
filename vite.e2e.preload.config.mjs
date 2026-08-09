//
// Vite build for the Playwright Electron E2E preload bundle.
//
// Mirrors the production vite.preload.config.mjs (production preload source,
// no test-specific bridge — design §6.5) but emits into the E2E build directory
// so background.ts finds it via `path.join(__dirname, "preload.js")`, where
// __dirname is `.vite/e2e/build` for the E2E main bundle.

import { defineConfig } from "vite";
import * as path from "path";
import { builtinModules } from "node:module";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: ".vite/e2e/build",
    // The E2E main bundle is already in this dir; do not wipe it.
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, "src/preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    rollupOptions: {
      // `electron` MUST stay external so the preload's `import ... from
      // "electron"` resolves to Electron's built-in module at runtime. Without
      // this, Vite bundles the `electron` npm package's index.js (which uses
      // __dirname/spawnSync/path.txt to locate the binary), and that throws
      // `ReferenceError: __dirname is not defined` in the sandboxed preload,
      // so contextBridge never runs and `window.api` is never exposed.
      external: [
        "electron",
        "electron/main",
        "electron/renderer",
        "electron/common",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        "sqlite3",
      ],
    },
  },
});
