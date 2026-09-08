//
// Vite build for the Playwright Electron E2E taskCode (utility-process) bundle.
//
// The production worker starter (OutboundEmailWorkerStarter) forks `taskCode.js`
// resolved relative to the main bundle's __dirname, which is `.vite/e2e/build`
// for the E2E main process. `yarn build:e2e` therefore must emit a production
// taskCode.js into that directory — otherwise BATCH_SEND records
// worker_start_failed because no worker entry can be resolved.
//
// This reuses the production `vite.taskCode.config.mjs` as a base (so the
// `ssr.noExternal` electron-store/html dependency bundling and the
// sqlite3/better-sqlite3 externals are identical to production) and overrides
// only the entry + outDir. The checker (forced on by taskCode.config's
// optionalChecker) is skipped here — the E2E build step runs under the same
// hooks/CI gate as the rest of the build, and the full-project tsc already
// covers taskCode.ts.

import { defineConfig, mergeConfig } from "vite";
import * as path from "path";
import taskCodeConfig from "./vite.taskCode.config.mjs";

const devTaskCodeConfig =
  typeof taskCodeConfig === "function"
    ? taskCodeConfig({ mode: "development", command: "build" })
    : taskCodeConfig;

export default defineConfig(
  mergeConfig(devTaskCodeConfig, {
    plugins:
      typeof devTaskCodeConfig.plugins === "function"
        ? undefined
        : (devTaskCodeConfig.plugins ?? []).filter((p) => {
            const name = (p && typeof p === "object" && "name" in p && p.name) || "";
            return name !== "vite-plugin-checker";
          }),
    build: {
      outDir: ".vite/e2e/build",
      // The E2E main bundle is already in this dir; do not wipe it.
      emptyOutDir: false,
      sourcemap: true,
      ssr: true,
      lib: {
        entry: path.resolve(__dirname, "src/taskCode.ts"),
        formats: ["cjs"],
        fileName: () => "taskCode.js",
      },
    },
  })
);