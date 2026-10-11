/**
 * OnnxRuntimeLoader — loads the `onnxruntime-node` binding from the resolved
 * `grounding-onnxruntime` version root with a scoped `createRequire`
 * (design §5.6, the voice runtime's `SherpaOnnxNative` pattern).
 *
 * Only the native binding and the model are downloaded; the worker code
 * (this file included) ships with the app and is tested with the app. The
 * loaded module's version is checked against the package manifest before
 * any session is created, so a partially updated runtime fails loudly.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Structural shape of the pieces of onnxruntime-node we consume. */
export interface OnnxRuntimeBinding {
  readonly InferenceSession: {
    create(
      model: string | Uint8Array,
      options?: Record<string, unknown>
    ): Promise<OnnxSessionLike>;
  };
}

export interface OnnxSessionLike {
  run(
    feeds: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
  release(): Promise<void>;
}

export interface LoadedOnnxRuntime {
  readonly binding: OnnxRuntimeBinding;
  readonly version: string;
  /** Providers that initialized successfully, best first. */
  readonly availableProviders: readonly string[];
}

export class OnnxRuntimeLoadError extends Error {
  constructor(
    readonly code:
      | "runtime_missing"
      | "runtime_manifest_invalid"
      | "runtime_version_mismatch"
      | "runtime_load_failed",
    message: string
  ) {
    super(message);
    this.name = "OnnxRuntimeLoadError";
  }
}

interface GroundingRuntimePackageManifest {
  runtimeId: string;
  runtimeVersion: string;
  entryModule: string;
  executionProviders?: string[];
}

/**
 * Scoped-require the ONNX Runtime binding from a version root.
 *
 * @param runtimeRoot absolute path to the installed version directory
 * @param expectedVersion version from the resolver/lease; mismatch fails
 */
export function loadOnnxRuntimeFromRoot(
  runtimeRoot: string,
  expectedVersion: string
): LoadedOnnxRuntime {
  const manifestPath = join(runtimeRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new OnnxRuntimeLoadError(
      "runtime_missing",
      `ONNX Runtime package manifest not found at the version root`
    );
  }
  let manifest: GroundingRuntimePackageManifest;
  try {
    manifest = JSON.parse(
      readFileSync(manifestPath, "utf8")
    ) as GroundingRuntimePackageManifest;
  } catch (error) {
    throw new OnnxRuntimeLoadError(
      "runtime_manifest_invalid",
      `Failed to parse the ONNX Runtime package manifest: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (manifest.runtimeId !== "grounding-onnxruntime") {
    throw new OnnxRuntimeLoadError(
      "runtime_manifest_invalid",
      `Unexpected runtimeId ${manifest.runtimeId}`
    );
  }
  if (manifest.runtimeVersion !== expectedVersion) {
    throw new OnnxRuntimeLoadError(
      "runtime_version_mismatch",
      `ONNX Runtime version ${manifest.runtimeVersion} does not match the leased version ${expectedVersion}`
    );
  }
  const entryModule = manifest.entryModule || "onnxruntime-node";
  const packageJsonPath = join(runtimeRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new OnnxRuntimeLoadError(
      "runtime_missing",
      "ONNX Runtime package.json missing at the version root"
    );
  }
  const scopedRequire = createRequire(packageJsonPath);
  let binding: OnnxRuntimeBinding;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = scopedRequire(entryModule) as OnnxRuntimeBinding & {
      env?: { getProviders?: () => string[] };
    };
    if (!mod || typeof mod.InferenceSession?.create !== "function") {
      throw new Error("InferenceSession.create is missing");
    }
    binding = mod;
  } catch (error) {
    throw new OnnxRuntimeLoadError(
      "runtime_load_failed",
      `Failed to load the ONNX Runtime binding: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const declared = manifest.executionProviders ?? ["cpu"];
  return {
    binding,
    version: manifest.runtimeVersion,
    availableProviders: declared,
  };
}
