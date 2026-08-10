import { defineConfig, loadEnv } from "vite";
import alias from "@rollup/plugin-alias";
import * as path from "path";

import ClosePlugin from "./vite-plugin-close.js";
import checker from "vite-plugin-checker";
import { optionalChecker } from "./vite-checker-toggle.mjs";
import { ZOD_SSR_NO_EXTERNAL } from "./vite.workerSsrNoExternal.mjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import sourcemaps from "rollup-plugin-sourcemaps";

/**
 * Disposable runtime-probe worker build.
 *
 * Tiny one-shot worker (see src/childprocess/local-ai-runtime/RuntimeProbeWorker.ts)
 * that loads a staged native runtime addon in a child process so the main
 * process never file-locks it. Same externalization rules as the voice worker:
 * native ONNX/sherpa artifacts must resolve at runtime, not be bundled.
 */
export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  return defineConfig({
    plugins: [
      alias(),
      nodeResolve(),
      sourcemaps(),
      ClosePlugin(),
      ...optionalChecker(() => checker({ typescript: true })),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      conditions: ["node"],
    },
    ssr: {
      noExternal: ZOD_SSR_NO_EXTERNAL,
    },
    build: {
      rollupOptions: {
        input: {
          RuntimeProbeWorker: path.resolve(
            __dirname,
            "src/childprocess/local-ai-runtime/RuntimeProbeWorker.ts"
          ),
        },
        output: {
          dir: "dist/childprocess",
          entryFileNames: "RuntimeProbeWorker.js",
          format: "cjs",
        },
        external: [
          "sherpa-onnx",
          "sherpa-onnx-node",
          "onnxruntime-node",
          "onnxruntime-common",
          "onnxruntime-web",
          "sharp",
          "sqlite3",
          "better-sqlite3",
          "bindings",
          "typeorm",
          "isolated-vm",
        ],
      },
      sourcemap: true,
      ssr: true,
    },
  });
};
