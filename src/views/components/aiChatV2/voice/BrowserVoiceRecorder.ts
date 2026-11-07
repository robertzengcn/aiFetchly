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
  /**
   * Audit R2 N05: invoked when the max-duration cap stops the recording by
   * itself. Receives the captured audio so the owner (the composer) can
   * transcribe it through the same release path as an explicit Stop — a
   * discarded capture silently loses the user's speech (FR-VOI-006).
   */
  onAutoStop?: (result: RecordingResult) => void;
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
  /** Max-duration completion sink (audit R2 N05); set at construction. */
  private readonly autoStopListener: ((result: RecordingResult) => void) | null;

  private state: RecorderState = "idle";
  private stream: MediaStreamLike | null = null;
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private selectedMime = "";
  private startedAt = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolver: ((result: RecordingResult) => void) | null = null;
  /** The pending in-flight stop was triggered by the max-duration cap. */
  private autoStopPending = false;
  /**
   * Monotonic acquisition generation (audit 2026-10-21 R02): bumped by every
   * start() request and by dispose(), so a getUserMedia promise that resolves
   * after its session was invalidated can never arm a live capture.
   */
  private acquisitionSeq = 0;

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
    this.autoStopListener = deps.onAutoStop ?? null;
  }

  get recordingState(): RecorderState {
    return this.state;
  }

  /** Request the mic and start recording; auto-stops at maxDurationMs. */
  async start(maxDurationMs: number = DEFAULT_MAX_DURATION_MS): Promise<void> {
    if (this.state === "recording") {
      throw new Error("Already recording.");
    }
    // Each start request invalidates any earlier in-flight acquisition; an
    // unbalanced dispose() (below) does the same. The resolved stream is
    // only adopted while its session is still the newest one.
    const acquisition = ++this.acquisitionSeq;
    const stream = await this.getUserMedia({ audio: true });
    if (acquisition !== this.acquisitionSeq) {
      // Audit 2026-10-21 R02: the acquisition was disposed (or replaced by a
      // newer start) while the permission prompt was pending — release the
      // captured stream immediately and abort without arming a session.
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("Recording was cancelled during acquisition.");
    }
    this.stream = stream;
    // Audit R4-02: transactional post-acquisition setup. Every stage below
    // (MIME probing, recorder construction, callback wiring, state arming,
    // recorder.start()) can fail; any failure rolls the whole session back
    // — the acquired stream's tracks are released, callbacks are detached,
    // the armed max-duration timer is cleared, and state resets — so a
    // failed start never leaves the microphone acquired or half-armed.
    try {
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
        const result: RecordingResult = {
          blob,
          mimeType: this.selectedMime,
          durationMs,
        };
        const resolver = this.stopResolver;
        this.stopResolver = null;
        const autoStop = this.autoStopPending;
        this.autoStopPending = false;
        this.cleanup();
        // The max-duration cap consumed this capture (audit R2 N05): hand it
        // to the owner before resolving the (discarded) stop promise so the
        // recording is transcribed, not thrown away.
        if (autoStop) {
          this.autoStopListener?.(result);
        }
        resolver?.(result);
      };
      this.startedAt = this.now();
      this.state = "recording";
      this.maxTimer = this.setTimeoutFn(() => {
        this.autoStopPending = true;
        void this.stop().catch(() => {
          /* max-duration stop failed; leave state to next explicit stop */
        });
      }, maxDurationMs);
      recorder.start();
    } catch (err) {
      this.rollbackFailedStart(acquisition);
      throw err;
    }
  }

  /**
   * Audit R4-02: undo everything a failed start() attempt adopted or armed.
   * The generation guard keeps a superseded failure from tearing down a
   * NEWER session (dispose() and a newer start own the state then) — within
   * one session it is exception-safe on each stage individually.
   */
  private rollbackFailedStart(acquisition: number): void {
    if (acquisition !== this.acquisitionSeq) {
      return;
    }
    if (this.maxTimer) {
      this.clearTimeoutFn(this.maxTimer);
      this.maxTimer = null;
    }
    // Detach callbacks of a half-constructed recorder so a late onstop can
    // never run the capture/resolution path of a session that failed to
    // initialize.
    const aborted = this.recorder;
    if (aborted) {
      aborted.ondataavailable = null;
      aborted.onstop = null;
      aborted.onerror = null;
    }
    this.autoStopPending = false;
    this.stopResolver = null;
    this.selectedMime = "";
    this.cleanup();
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

  /**
   * Dispose the recorder (audit R2 N06 / FR-LIF-002): clear the max-duration
   * timer, drop any in-flight resolver and release the microphone. Used when
   * the owning composer unmounts so a live capture never outlives its owner.
   */
  dispose(): void {
    // Invalidate any in-flight acquisition first (audit 2026-10-21 R02): a
    // getUserMedia promise that resolves after disposal must not arm a live
    // capture whose owner is gone.
    this.acquisitionSeq += 1;
    if (this.maxTimer) {
      this.clearTimeoutFn(this.maxTimer);
      this.maxTimer = null;
    }
    this.autoStopPending = false;
    this.stopResolver = null;
    this.cleanup();
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
