import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Vite 8 only exposes types via package "exports", which need
 * moduleResolution node16/nodenext/bundler. This project's tsconfig uses
 * "node", so a static `import { build } from "vite"` fails `tsc --noEmit`.
 */
interface ViteBuildFn {
  (inlineConfig: Record<string, unknown>): Promise<unknown>;
}

const require = createRequire(import.meta.url);
const { build } = require("vite") as { build: ViteBuildFn };

export const NODE_BUILTIN_EXTERNALS: readonly string[] = [
  "fs",
  "path",
  "os",
  "crypto",
  "util",
  "stream",
  "events",
  "buffer",
  "url",
  "zlib",
  "assert",
  "http",
  "https",
  "net",
  "tls",
  "child_process",
];

export interface ViteCjsBundleOptions {
  readonly entryPath: string;
  readonly tempPrefix: string;
  readonly fileName?: string;
  readonly alias?: Record<string, string>;
  readonly external?: readonly string[];
  /**
   * Force-bundle these packages (Vite `ssr.noExternal`), matching worker
   * packaging that cannot rely on NODE_PATH→asar for pure-JS deps.
   */
  readonly ssrNoExternal?: readonly string[];
  /** When true, set NODE_PATH to the project node_modules for external requires. */
  readonly nodePathModules?: boolean;
  /** Defaults to true. Set false for readable crash-mode stacks. */
  readonly minify?: boolean;
  /** When true, only build the bundle; do not execute it. */
  readonly skipRun?: boolean;
}

export interface ViteCjsBundleResult {
  readonly bundlePath: string;
  readonly code: string;
  readonly run: SpawnSyncReturns<string> | null;
  readonly combinedOutput: string;
}

/**
 * Build a minimal Vite CJS lib bundle and optionally execute it with Node.
 * Used by packaging regression tests that catch Windows launch crashes
 * before electron-forge packaging.
 */
export async function buildAndRunViteCjsBundle(
  options: ViteCjsBundleOptions
): Promise<ViteCjsBundleResult> {
  const fileName = options.fileName ?? "bundle.cjs";
  const minify = options.minify !== false;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), options.tempPrefix));
  const outDir = path.join(tempRoot, "dist");
  const bundlePath = path.join(outDir, fileName);

  try {
    if (!fs.existsSync(options.entryPath)) {
      throw new Error(`Vite CJS fixture entry missing: ${options.entryPath}`);
    }

    const ssrNoExternal = options.ssrNoExternal ?? [];
    const useSsrNoExternal = ssrNoExternal.length > 0;
    // SSR builds ignore lib.fileName and emit <entryBasename>.js; use explicit
    // rollup output names so packaging regressions can assert on a stable path.
    await build({
      configFile: false,
      root: process.cwd(),
      logLevel: "error",
      ...(useSsrNoExternal ? { ssr: { noExternal: [...ssrNoExternal] } } : {}),
      build: {
        ...(useSsrNoExternal
          ? {}
          : {
              lib: {
                entry: options.entryPath,
                formats: ["cjs"],
                fileName: () => fileName,
              },
            }),
        outDir,
        emptyOutDir: true,
        minify,
        target: "node18",
        ...(useSsrNoExternal ? { ssr: true } : {}),
        commonjsOptions: {
          transformMixedEsModules: true,
          include: [/node_modules/],
        },
        rollupOptions: {
          ...(useSsrNoExternal
            ? {
                input: options.entryPath,
                output: {
                  entryFileNames: fileName,
                  format: "cjs",
                },
              }
            : {}),
          external: [...NODE_BUILTIN_EXTERNALS, ...(options.external ?? [])],
        },
      },
      resolve: {
        conditions: ["node"],
        ...(options.alias ? { alias: options.alias } : {}),
      },
    });

    if (!fs.existsSync(bundlePath)) {
      throw new Error(`Vite CJS bundle was not written: ${bundlePath}`);
    }

    const code = fs.readFileSync(bundlePath, "utf-8");
    if (options.skipRun) {
      return {
        bundlePath,
        code,
        run: null,
        combinedOutput: "",
      };
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.nodePathModules) {
      env.NODE_PATH = path.join(process.cwd(), "node_modules");
    }

    const run = spawnSync(process.execPath, [bundlePath], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      bundlePath,
      code,
      run,
      combinedOutput: `${run.stdout ?? ""}\n${run.stderr ?? ""}`,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
