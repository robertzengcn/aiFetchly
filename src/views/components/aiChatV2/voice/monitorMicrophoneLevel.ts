/** Sample the recording stream locally without routing it to the speakers. */
export function monitorMicrophoneLevel(
  stream: MediaStream,
  onLevel: (level: number) => void
): (() => void) | undefined {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    const audioContext = context;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => undefined);
    }

    const samples = new Float32Array(analyser.fftSize);
    const interval = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      // Keep the meter legible for typical speech and filter quiet room noise.
      onLevel(Math.min(1, Math.max(0, (rms - 0.006) * 8)));
    }, 55);

    return () => {
      clearInterval(interval);
      source.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  } catch {
    // Web Audio is optional. MediaRecorder can still capture and transcribe.
    void context?.close().catch(() => undefined);
    return undefined;
  }
}
