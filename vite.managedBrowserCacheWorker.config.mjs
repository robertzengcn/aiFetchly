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
      alias: { "@": path.resolve(__dirname, "./src") },
      conditions: ["node"],
    },
    build: {
      rollupOptions: {
        input: {
          ManagedBrowserCacheWorker: path.resolve(
            __dirname,
            "src/childprocess/managed-browser-cache/index.ts"
          ),
        },
        output: {
          dir: "dist/childprocess",
          entryFileNames: "ManagedBrowserCacheWorker.js",
          format: "cjs",
        },
        // The cache worker touches NO database and NO browser — only the
        // filesystem and the parent port. Keep externals minimal.
        external: ["sqlite3", "bindings", "electron"],
      },
      sourcemap: true,
      ssr: true,
    },
  });
};
