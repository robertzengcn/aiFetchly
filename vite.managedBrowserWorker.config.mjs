import { defineConfig, loadEnv } from "vite";
import alias from "@rollup/plugin-alias";
import * as path from "path";

import ClosePlugin from "./vite-plugin-close.js";
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
