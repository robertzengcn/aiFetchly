"use strict";
/**
 * Runtime loader for `@xenova/transformers`.
 *
 * Kept separate from the worker entry point so the worker bundle builds without
 * the package being present. The module is loaded at runtime via a
 * bundler-opaque require (the module name is constructed via string
 * concatenation so Vite/Rollup cannot detect it as a static dependency and
 * emit a `require("@xenova/transformers")` call that would fail Forge's
 * `verifyGeneratedRuntimeRequires` check).
 *
 * Phase 9 slim installer (PRD FR-16, design §26.7): `@xenova/transformers` is
 * excluded from the base app's `EXTERNAL_DEPENDENCIES` and ships as a
 * downloadable runtime. When the runtime is not installed, `loadTransformersRuntime`
 * returns `null` and the worker reports a clear error instead of crashing.
 *
 * This mirrors the pattern established by `SherpaOnnxNative.ts` for the
 * `sherpa-onnx-node` native addon.
 */
import { createRequire } from "node:module";

/**
 * The subset of the `@xenova/transformers` API used by the local embedding
 * worker. Abstracted so tests can inject a fake runtime without depending on
 * the real package.
 */
export interface TransformersRuntime {
  /** Transformers.js environment object (cacheDir, allowRemoteModels, etc.). */
  readonly env: {
    cacheDir: string;
    allowRemoteModels: boolean;
    localModelPath?: string;
    remoteHost?: string;
  };
  /**
   * Creates a Transformers.js pipeline. The worker only uses the
   * `feature-extraction` task.
   */
  pipeline: (
    task: "feature-extraction",
    model: string
  ) => Promise<unknown>;
}

/**
 * Load `@xenova/transformers` at runtime, returning `null` when it is absent.
 *
 * The module name is split (`"@xenova/" + "transformers"`) so the bundler
 * cannot statically resolve it — this keeps the generated bundle free of a
 * `require("@xenova/transformers")` call that would fail Forge's
 * `verifyGeneratedRuntimeRequires` packaging gate.
 *
 * Resolution order:
 *  1. `globalThis.require` (Electron utilityProcess exposes a global require)
 *  2. `createRequire(__filename)` (Node's resolver relative to this file)
 *
 * @returns The loaded module, or `null` when the package is not installed.
 */
export function loadTransformersRuntime(): TransformersRuntime | null {
  // Bundler-opaque module name — do NOT combine into a single string literal.
  const moduleName = "@xenova/" + "transformers";

  const globalRequire = (
    globalThis as { require?: (id: string) => unknown }
  ).require;
  if (typeof globalRequire === "function") {
    try {
      return globalRequire(moduleName) as TransformersRuntime;
    } catch {
      // Fall through to Node's resolver below; Electron/bundled workers may
      // expose a global require with a different resolution base.
    }
  }

  try {
    const nodeRequire = createRequire(__filename);
    return nodeRequire(moduleName) as TransformersRuntime;
  } catch {
    return null;
  }
}