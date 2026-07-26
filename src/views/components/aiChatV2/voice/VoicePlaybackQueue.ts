/**
 * VoicePlaybackQueue — ordered playback of TTS WAV chunks in the renderer.
 *
 * Plays base64 WAV chunks in enqueue order, exposes `isSpeaking`, supports
 * stop/clear with object-URL revocation. Prefers HTMLAudioElement for MVP
 * (design §13.1). Dependency-injectable (audio element factory, URL resolve/
 * revoke) so the ordering + lifecycle is unit-testable without a DOM.
 */

/** Minimal HTMLAudioElement surface used by the queue. */
export interface PlayableAudioElement {
  src: string;
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export interface VoicePlaybackQueueDeps {
  /** Resolve a base64 WAV chunk to a playable src (Blob URL by default). */
  readonly resolveAudioUrl?: (audioBase64: string) => string;
  /** Revoke a previously resolved URL. */
  readonly revokeObjectUrl?: (url: string) => void;
  /** Create a playable audio element bound to a src. */
  readonly createAudio?: (src: string) => PlayableAudioElement;
  /** Notified when playback starts/stops (false<->true transitions only). */
  readonly onSpeakingChange?: (speaking: boolean) => void;
  /** Notified when browser audio playback fails. */
  readonly onPlaybackError?: (error: unknown) => void;
}

const defaultResolveAudioUrl = (audioBase64: string): string => {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
};

const defaultCreateAudio = (src: string): PlayableAudioElement => {
  const el = new Audio(src);
  return el as unknown as PlayableAudioElement;
};

export class VoicePlaybackQueue {
  private readonly resolveAudioUrl: (audioBase64: string) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly createAudio: (src: string) => PlayableAudioElement;
  private readonly onSpeakingChange?: (speaking: boolean) => void;
  private readonly onPlaybackError?: (error: unknown) => void;
  private readonly queue: string[] = [];
  private current: PlayableAudioElement | null = null;
  private currentUrl: string | null = null;
  private speaking = false;

  constructor(deps: VoicePlaybackQueueDeps = {}) {
    this.resolveAudioUrl = deps.resolveAudioUrl ?? defaultResolveAudioUrl;
    this.revokeObjectUrl = deps.revokeObjectUrl ?? URL.revokeObjectURL;
    this.createAudio = deps.createAudio ?? defaultCreateAudio;
    this.onSpeakingChange = deps.onSpeakingChange;
    this.onPlaybackError = deps.onPlaybackError;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Append a WAV chunk (base64); starts playback if idle. */
  enqueue(audioBase64: string): void {
    this.queue.push(audioBase64);
    if (!this.speaking) {
      void this.playNext();
    }
  }

  /** Stop current audio, clear the queue, revoke the current URL. */
  stop(): void {
    this.queue.length = 0;
    this.teardownCurrent();
    this.setSpeaking(false);
  }

  private setSpeaking(value: boolean): void {
    if (this.speaking === value) return;
    this.speaking = value;
    this.onSpeakingChange?.(value);
  }

  private async playNext(): Promise<void> {
    const next = this.queue.shift();
    if (next === undefined) {
      this.setSpeaking(false);
      return;
    }
    this.setSpeaking(true);
    const url = this.resolveAudioUrl(next);
    this.currentUrl = url;
    const el = this.createAudio(url);
    this.current = el;
    let finalized = false;
    const finalize = (error?: unknown): void => {
      if (finalized) return;
      finalized = true;

      const stillCurrent = this.current === el || this.currentUrl === url;
      if (!stillCurrent) return;

      el.onended = null;
      el.onerror = null;
      if (error !== undefined) {
        this.onPlaybackError?.(error);
      }
      if (this.current === el) {
        this.current = null;
      }
      if (this.currentUrl === url) {
        this.revokeObjectUrl(url);
        this.currentUrl = null;
      }
      void this.playNext();
    };
    el.onended = () => finalize();
    el.onerror = () => finalize(new Error("Audio playback failed."));
    try {
      await el.play();
    } catch (err) {
      // Autoplay/play failure: drop this chunk and advance.
      finalize(err);
    }
  }

  private teardownCurrent(): void {
    if (this.current) {
      this.current.onended = null;
      this.current.onerror = null;
      try {
        this.current.pause();
      } catch {
        // ignore
      }
      this.current = null;
    }
    if (this.currentUrl) {
      this.revokeObjectUrl(this.currentUrl);
      this.currentUrl = null;
    }
  }
}
