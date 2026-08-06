import { defineConfig, loadEnv } from "vite";
import alias from "@rollup/plugin-alias";
import * as path from "path";

import ClosePlugin from "./vite-plugin-close.js";
import checker from "vite-plugin-checker";
import { optionalChecker } from "./vite-checker-toggle.mjs";
import { ZOD_SSR_NO_EXTERNAL } from "./vite.workerSsrNoExternal.mjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import sourcemaps from "rollup-plugin-sourcemaps";

function emptyModulesPlugin() {
  const emptyModules = [
    "@sap/hana-client/extension/Stream",
    "@sap/hana-client",
    "typeorm-aurora-data-api-driver",
    "@google-cloud/spanner",
    "mysql",
    "mysql2",
    "pg",
    "pg-query-stream",
    "pg-native",
    "mongodb",
    "mssql",
    "oracledb",
    "hdb-pool",
    "redis",
    "ioredis",
    "sql.js",
  ];

  return {
    name: "empty-modules",
    resolveId(id) {
      if (
        emptyModules.includes(id) ||
        emptyModules.some((m) => id.startsWith(`${m}/`))
      ) {
        return { id: "virtual:empty-module", external: false };
      }
      return null;
    },
    load(id) {
      if (id === "virtual:empty-module") {
        return "export default {}; export const Stream = {}; export const Readable = {}; export const Writable = {}; export const PassThrough = {};";
      }
      return null;
    },
  };
}

export default ({ mode }) => {
  process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };
  return defineConfig({
    plugins: [
      alias(),
      nodeResolve(),
      emptyModulesPlugin(),
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
          AiChatVoiceWorker: path.resolve(
            __dirname,
            "src/childprocess/ai-chat-voice/AiChatVoiceWorker.ts"
          ),
        },
        output: {
          dir: "dist/childprocess",
          entryFileNames: "AiChatVoiceWorker.js",
          format: "cjs",
        },
        // sherpa-onnx ships native ONNX runtime artifacts that break when
        // bundled; resolve it at runtime from node_modules. The worker loads
        // it via a bundler-opaque require so it also degrades gracefully when
        // the package is not installed.
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
