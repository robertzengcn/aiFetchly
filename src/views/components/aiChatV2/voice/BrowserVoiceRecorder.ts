/**
 * BrowserVoiceRecorder — microphone capture for push-to-talk voice input.
 *
 * Requests the microphone via getUserMedia, records with MediaRecorder using a
 * supported MIME type, enforces a max duration, stops all tracks on stop, and
 * resolves a { blob, mimeType, durationMs } result. Media APIs are dependency-
 * injected so the lifecycle is unit-testable without a DOM. Design §11.1.
 */

export type RecorderState = "idle" | "recording";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface MediaStreamLike {
  getTracks(): ReadonlyArray<{ stop(): void }>;
}

export interface MediaRecorderLike {
  start(): void;
  stop(): void;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface BrowserVoiceRecorderDeps {
  getUserMedia?: (constraints: { audio: boolean }) => Promise<MediaStreamLike>;
  mediaRecorderFactory?: (
    stream: MediaStreamLike,
    mimeType: string
  ) => MediaRecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
  blobFactory?: (parts: BlobPart[], options: { type: string }) => Blob;
}

const CANDIDATE_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
];

const DEFAULT_MAX_DURATION_MS = 60_000;

export class BrowserVoiceRecorder {
  private readonly getUserMedia: (constraints: {
    audio: boolean;
  }) => Promise<MediaStreamLike>;
  private readonly mediaRecorderFactory: (
    stream: MediaStreamLike,
    mimeType: string
  ) => MediaRecorderLike;
  private readonly isTypeSupported: (mimeType: string) => boolean;
  private readonly setTimeoutFn: (
    fn: () => void,
    ms: number
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (
    handle: ReturnType<typeof setTimeout>
  ) => void;
  private readonly now: () => number;
  private readonly blobFactory: (
    parts: BlobPart[],
    options: { type: string }
  ) => Blob;

  private state: RecorderState = "idle";
  private stream: MediaStreamLike | null = null;
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private selectedMime = "";
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolver: ((result: RecordingResult) => void) | null = null;

  constructor(deps: BrowserVoiceRecorderDeps = {}) {
    this.getUserMedia =
      deps.getUserMedia ??
      ((constraints) =>
        navigator.mediaDevices.getUserMedia(
          constraints
        ) as unknown as Promise<MediaStreamLike>);
    this.mediaRecorderFactory =
      deps.mediaRecorderFactory ??
      ((stream, mimeType) =>
        new MediaRecorder(stream as unknown as MediaStream, {
          mimeType,
        }) as unknown as MediaRecorderLike);
    this.isTypeSupported =
      deps.isTypeSupported ?? ((m) => MediaRecorder.isTypeSupported(m));
    this.setTimeoutFn = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));
    this.now = deps.now ?? (() => Date.now());
    this.blobFactory =
      deps.blobFactory ?? ((parts, options) => new Blob(parts, options));
  }

  get recordingState(): RecorderState {
    return this.state;
  }

  /** Request the mic and start recording; auto-stops at maxDurationMs. */
  async start(maxDurationMs: number = DEFAULT_MAX_DURATION_MS): Promise<void> {
    if (this.state === "recording") {
      throw new Error("Already recording.");
    }
    const stream = await this.getUserMedia({ audio: true });
    this.stream = stream;
    this.selectedMime = this.pickMimeType();
    const recorder = this.mediaRecorderFactory(stream, this.selectedMime);
    this.recorder = recorder;
    this.chunks = [];
    recorder.ondataavailable = (event) => {
      this.chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = this.blobFactory(this.chunks, { type: this.selectedMime });
      const durationMs = this.now() - this.startedAt;
      const resolver = this.stopResolver;
      this.stopResolver = null;
      this.cleanup();
      resolver?.({ blob, mimeType: this.selectedMime, durationMs });
    };
    this.startedAt = this.now();
    this.state = "recording";
    this.maxTimer = this.setTimeoutFn(() => {
      void this.stop().catch(() => {
        /* max-duration stop failed; leave state to next explicit stop */
      });
    }, maxDurationMs);
    recorder.start();
  }

  /** Stop recording and resolve the captured audio. */
  async stop(): Promise<RecordingResult> {
    if (this.state !== "recording" || !this.recorder) {
      throw new Error("Not recording.");
    }
    if (this.maxTimer) {
      this.clearTimeoutFn(this.maxTimer);
      this.maxTimer = null;
    }
    return new Promise<RecordingResult>((resolve) => {
      this.stopResolver = resolve;
      this.recorder?.stop();
    });
  }

  private pickMimeType(): string {
    for (const candidate of CANDIDATE_MIME_TYPES) {
      if (this.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return "";
  }

  private cleanup(): void {
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => track.stop());
      } catch {
        // ignore track-stop failures
      }
      this.stream = null;
    }
    this.recorder = null;
    this.chunks = [];
    this.state = "idle";
  }
}
