/**
 * Runtime package roots shared by the archive builder and the CI fingerprint.
 *
 * This module must stay free of third-party imports. The detect job in
 * local-ai-runtime-release.yml runs without `yarn install`; pulling
 * build-local-ai-runtime.mjs (and deterministicZip → crc-32) made run #16
 * fail with ERR_MODULE_NOT_FOUND.
 */
export const RUNTIME_ROOTS = {
  "embedding-xenova": [
    "@xenova/transformers",
    "onnxruntime-node",
    "onnxruntime-common",
    "sharp",
  ],
  "voice-sherpa": ["sherpa-onnx-node"],
};

export const SHERPA_PLATFORM_PACKAGE = {
  "win32-x64": "sherpa-onnx-win-x64",
  "darwin-x64": "sherpa-onnx-darwin-x64",
  "darwin-arm64": "sherpa-onnx-darwin-arm64",
  "linux-x64": "sherpa-onnx-linux-x64",
};
