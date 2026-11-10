import { defineConfig, loadEnv } from "vite";
import alias from "@rollup/plugin-alias";
import * as path from "path";

import ClosePlugin from "./vite-plugin-close.js";
import { ZOD_SSR_NO_EXTERNAL } from "./vite.workerSsrNoExternal.mjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import sourcemaps from "rollup-plugin-sourcemaps";

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  return defineConfig({
    plugins: [alias(), nodeResolve(), sourcemaps(), ClosePlugin()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      conditions: ["node"],
    },
    // SSR builds externalize node_modules by default, but the packaged
    // worker lives under app.asar.unpacked where modules that only live
    // inside app.asar cannot be resolved; bundle zod (pure JS) instead.
    ssr: {
      noExternal: ZOD_SSR_NO_EXTERNAL,
    },
    build: {
      rollupOptions: {
        input: {
          ManagedBrowser: path.resolve(
            __dirname,
            "src/childprocess/managed-browser/index.ts"
          ),
        },
        output: {
          dir: "dist/childprocess",
          entryFileNames: "ManagedBrowser.js",
          format: "cjs",
        },
        external: [
          // Native/heavy deps stay external and resolve from node_modules at
          // runtime (same convention as vite.skillWorker.config.mjs).
          "sqlite3",
          "better-sqlite3",
          "bindings",
          "typeorm",
          "puppeteer",
          "puppeteer-core",
          "puppeteer-extra",
          "puppeteer-extra-plugin-stealth",
          "devtools-protocol",
          "electron",
        ],
      },
      sourcemap: true,
      ssr: true,
    },
  });
};
