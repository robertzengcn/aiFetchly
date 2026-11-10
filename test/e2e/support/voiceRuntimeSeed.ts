/**
 * Deterministic voice runtime stand-in for voice-journey E2E specs.
 *
 * The real sherpa-onnx native runtime and Whisper/Piper model files are not
 * available in CI. To exercise the REAL production voice stack end to end
 * (status, mic recording, worker transcription synthesis, playback), this
 * module plants a fully discoverable stand-in into the redirected E2E
 * userData root BEFORE the app launches:
 *
 * 1. Local AI runtime resolution: `<userData>/local-ai-runtimes/voice-sherpa/`
 *    gets `active.json` + `<version>/manifest.json` (the strict per-runtime
 *    state store + package contract guarded by LocalAiRuntimeResolver) so
 *    `resolve("voice-sherpa")` succeeds. The manifest carries the REAL
 *    Electron ABI for the installed binary, discovered by running the
 *    electron binary itself as Node (ELECTRON_RUN_AS_NODE) from the test
 *    process — a windowless sidecar that cannot interact with the app.
 *
 * 2. Fake sherpa-onnx-node addon inside the version root: a pure-JS CommonJS
 *    module resolvable via `createRequire(<versionRoot>/package.json)` —
 *    exactly the loader path used by SherpaOnnxNative.ts. It mirrors the
 *    `SherpaOnnxNative` API surface (OfflineRecognizer/OfflineTts/
 *    GenerationConfig) and returns a deterministic transcript + 1s of
 *    Float32 WAV samples, so the REAL Worker bridge + model catalog
 *    + playback code run unmodified.
 *
 * 3. Required model files under `<userData>/voice-models/`: the catalog
 *    names-checked files for the default whisper-tiny (STT) and
 *    vits-piper-en_US-amy-medium (TTS) ids so `stateForModel` returns
 *    "ready" instead of "missing_model".
 *
 * Nothing here touches product code; it only satisfies the same on-disk
 * contracts a production install satisfies.
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Must match LocalAiRuntimePathService.ACTIVE_STATE_FILE / PACKAGE_MANIFEST_FILE. */
const ACTIVE_STATE_FILE = "active.json";
const PACKAGE_MANIFEST_FILE = "manifest.json";
const RUNTIME_DIR_NAME = "local-ai-runtimes";
const VOICE_MODEL_ROOT_DIR = "voice-models";

/** Stand-in runtime identity. */
export const STANDIN_RUNTIME_ID = "voice-sherpa";
export const STANDIN_RUNTIME_VERSION = "1.0.0";

/** The deterministic transcript the fake recognizer returns. */
export const STANDIN_TRANSCRIPT = "voice parity demo transcript";

/** 16 kHz / 1 second — same sample rate the real worker config expects. */
const STANDIN_TTS_SAMPLE_RATE = 16_000;
const STANDIN_TTS_SECONDS = 1.0;

interface ElectronAbiInfo {
  readonly electronVersion: string;
  readonly nodeModuleAbi: string;
}

/**
 * Discover the real Electron ABI by running the app's own electron binary as
 * Node (windowless, exitless sidecar). `process.versions.modules` under
 * ELECTRON_RUN_AS_NODE is the ABI the main process compares the runtime
 * manifest against.
 */
export async function resolveElectronAbi(): Promise<ElectronAbiInfo> {
  const electronRoot = path.dirname(String(require.resolve("electron")));
  const binaryName =
    process.platform === "win32" ? "electron.exe" : "electron";
  const binaryPath = path.join(electronRoot, "dist", binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Electron binary not found for voice stand-in seeding: ${binaryPath}`
    );
  }
  const result = await execFileAsync(
    binaryPath,
    [
      "-e",
      'console.log(JSON.stringify({electron: process.versions.electron, modules: process.versions.modules}))',
    ],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      timeout: 30_000,
    }
  );
  const parsed = JSON.parse(result.stdout.trim()) as {
    electron?: string;
    modules?: string;
  };
  if (!parsed.electron || !parsed.modules || !/^\d+$/.test(parsed.modules)) {
    throw new Error(
      `Could not discover Electron ABI for voice stand-in seeding: ${result.stdout}`
    );
  }
  return { electronVersion: parsed.electron, nodeModuleAbi: parsed.modules };
}

/**
 * Build the CommonJS source for the fake sherpa-onnx-node addon. Mirrors the
 * SherpaOnnxNative API surface exactly (voiceServices.ts usage):
 * OfflineRecognizer.createStream/decode/getResult, OfflineTts.generate with
 * a JS-owned Float32Array + sampleRate, and a GenerationConfig constructor.
 */
function buildStandinAddonSource(): string {
  return `"use strict";

const TRANSCRIPT = ${JSON.stringify(STANDIN_TRANSCRIPT)};
const SAMPLE_RATE = ${STANDIN_TTS_SAMPLE_RATE};
const TOTAL_SAMPLES = Math.round(SAMPLE_RATE * ${STANDIN_TTS_SECONDS});

class GenerationConfig {
  constructor(input) {
    this.sid = input && typeof input.sid === "number" ? input.sid : 0;
    this.speed = input && typeof input.speed === "number" ? input.speed : 1;
    this.silenceScale =
      input && typeof input.silenceScale === "number" ? input.silenceScale : 0.2;
  }
}

class OfflineRecognizer {
  constructor(config) {
    // The real addon needs the whisper files that exist on disk (stand-in);
    // the constructor accepts the same config object voiceServices passes.
    this.config = config ?? null;
  }
  createStream() {
    return {
      acceptWaveform() {},
    };
  }
  decode(stream) {
    void stream;
  }
  getResult(stream) {
    void stream;
    return { text: TRANSCRIPT };
  }
}

class OfflineTts {
  constructor(config) {
    this.config = config ?? null;
  }
  generate(input) {
    const textLength =
      input && typeof input.text === "string" ? input.text.length : 0;
    // Speak text length as duration (>= 1 sample), same rate/proportions
    // the real VITS engine would produce for this model id.
    const sampleCount = Math.max(1, Math.min(TOTAL_SAMPLES, 160 + textLength * 128));
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      // A quiet sine at 200Hz — valid PCM in [-1, 1] for the WAV encoder.
      samples[i] = 0.01 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE);
    }
    return { samples, sampleRate: SAMPLE_RATE };
  }
}

module.exports = { OfflineRecognizer, OfflineTts, GenerationConfig, TRANSCRIPT };
`;
}

/** Stand-in dependency record for the package manifest. */
const STANDIN_DEPENDENCIES: Record<string, string> = {
  "sherpa-onnx-node": "1.10.32",
};

/** Stand-in build record. */
const STANDIN_BUILD = {
  commit: "e2e-voice-standin",
  workflowRunId: "0",
  builtAt: "2026-10-22T00:00:00.000Z",
};

export interface VoiceRuntimeStandinPaths {
  readonly runtimeDir: string;
  readonly versionRoot: string;
  readonly activeStatePath: string;
  readonly packageManifestPath: string;
  readonly modelRoot: string;
  readonly sttModelDir: string;
  readonly ttsModelDir: string;
}

/**
 * Plant the runtime stand-in + fake model files under the redirected E2E
 * userData root. Idempotent: re-running overwrites content with the same
 * deterministic bytes. MUST run before the app launches.
 */
export async function seedVoiceRuntimeStandin(input: {
  userDataPath: string;
}): Promise<VoiceRuntimeStandinPaths> {
  const { userDataPath } = input;
  const abi = await resolveElectronAbi();

  const runtimeDir = path.join(
    userDataPath,
    RUNTIME_DIR_NAME,
    STANDIN_RUNTIME_ID
  );
  const versionRoot = path.join(runtimeDir, STANDIN_RUNTIME_VERSION);

  // --- 1. Runtime state + package manifest --------------------------------
  const activeState = {
    schemaVersion: 1,
    runtimeId: STANDIN_RUNTIME_ID,
    runtimeVersion: STANDIN_RUNTIME_VERSION,
    activatedAt: new Date().toISOString(),
    packageSha256: "e".repeat(64),
  };

  // requiredFiles list every path under versionRoot that the resolver must
  // find before declaring the runtime "ready" (LocalAiRuntimeResolver.ts).
  const requiredFiles = [
    "package.json",
    "node_modules/sherpa-onnx-node/package.json",
    "node_modules/sherpa-onnx-node/index.js",
  ];
  const manifest = {
    schemaVersion: 1,
    runtimeId: STANDIN_RUNTIME_ID,
    runtimeVersion: STANDIN_RUNTIME_VERSION,
    platform: process.platform,
    arch: process.arch,
    electronVersion: abi.electronVersion,
    nodeModuleAbi: abi.nodeModuleAbi,
    entryModule: "sherpa-onnx-node",
    requiredFiles,
    dependencies: STANDIN_DEPENDENCIES,
    build: STANDIN_BUILD,
  };

  // --- 2. Fake sherpa-onnx-node addon inside the version root -------------
  // SherpaOnnxNative loads it via createRequire(<versionRoot>/package.json)
  // → resolves the same way a real runtime installation would.
  const relativeAddonDir = "node_modules/sherpa-onnx-node";
  const addonPackageJson = {
    name: "sherpa-onnx-node",
    version: "1.10.32",
    main: "index.js",
  };
  const versionPackageJson = {
    name: "@aifetchly/voice-sherpa-standin",
    version: STANDIN_RUNTIME_VERSION,
    private: true,
  };

  // --- 3. Fake model files (real file names from VoiceModelCatalogService).
  // STT: sherpa-onnx-whisper-tiny/{tiny-encoder.int8.onnx, tiny-decoder.int8.onnx, tiny-tokens.txt}.
  // TTS: vits-piper-en_US-amy-medium/{en_US-amy-medium.onnx, tokens.txt} (+
  //      the espeak-ng-data dir the worker reads).
  const modelRoot = path.join(userDataPath, VOICE_MODEL_ROOT_DIR);
  const sttModelDir = path.join(modelRoot, "sherpa-onnx-whisper-tiny");
  const ttsModelDir = path.join(modelRoot, "vits-piper-en_US-amy-medium");
  const modelFiles: ReadonlyArray<readonly [string, string]> = [
    ["tiny-encoder.int8.onnx", "standin-whisper-tiny-encoder\n"],
    ["tiny-decoder.int8.onnx", "standin-whisper-tiny-decoder\n"],
    ["tiny-tokens.txt", "standin-whisper-tiny-tokens\n"],
  ];
  const ttsModelFiles: ReadonlyArray<readonly [string, string]> = [
    ["en_US-amy-medium.onnx", "standin-vits-piper-amy\n"],
    ["tokens.txt", "standin-vits-piper-tokens\n"],
    ["espeak-ng-data/standin-data.txt", "standin-espeak-data\n"],
  ];

  const mkFiles = (files: ReadonlyArray<readonly [string, string]>, baseDir: string): void => {
    for (const [relative, content] of files) {
      const target = path.join(baseDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    }
  };
  mkFiles(modelFiles, sttModelDir);
  mkFiles(ttsModelFiles, ttsModelDir);

  // Write the runtime tree LAST so the resolver sees a complete state.
  for (const relativeFile of requiredFiles) {
    const target = path.join(versionRoot, relativeFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (relativeFile === "package.json") {
      fs.writeFileSync(
        target,
        `${JSON.stringify(versionPackageJson, null, 2)}\n`,
        "utf8"
      );
    } else if (relativeFile === `${relativeAddonDir}/package.json`) {
      fs.writeFileSync(
        target,
        `${JSON.stringify(addonPackageJson, null, 2)}\n`,
        "utf8"
      );
    } else {
      fs.writeFileSync(target, buildStandinAddonSource(), "utf8");
    }
  }
  fs.writeFileSync(
    path.join(runtimeDir, ACTIVE_STATE_FILE),
    `${JSON.stringify(activeState, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(versionRoot, PACKAGE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return {
    runtimeDir,
    versionRoot,
    activeStatePath: path.join(runtimeDir, ACTIVE_STATE_FILE),
    packageManifestPath: path.join(versionRoot, PACKAGE_MANIFEST_FILE),
    modelRoot,
    sttModelDir,
    ttsModelDir,
  };
}
