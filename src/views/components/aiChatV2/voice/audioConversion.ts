/**
 * Renderer-side audio conversion: recorded WebM/Opus Blob -> 16 kHz mono WAV
 * base64, so the voice worker's `parseWavSamples` receives PCM samples that
 * sherpa-onnx can transcribe. Uses the browser's AudioContext + OfflineAudioContext
 * for decoding + resampling (not available in the Node worker). Design §11.
 */

const TARGET_SAMPLE_RATE = 16000;

/**
 * Convert a recorded audio Blob to 16 kHz mono WAV base64.
 * Decodes the compressed format (WebM/Opus), resamples to 16 kHz mono, then
 * encodes to 16-bit PCM WAV.
 */
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode the compressed audio (WebM/Opus -> AudioBuffer).
  const decodeCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }

  // Resample to mono 16 kHz via OfflineAudioContext.
  const length = Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);

  return float32ToWavBase64(samples, TARGET_SAMPLE_RATE);
}

/** Encode Float32 PCM samples into 16-bit mono WAV as a base64 string. */
function float32ToWavBase64(
  samples: Float32Array,
  sampleRate: number
): string {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    );
    offset += 2;
  }

  // Browser base64 encoding (btoa).
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
