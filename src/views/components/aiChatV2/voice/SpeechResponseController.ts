/**
 * SpeechResponseController — orchestrates spoken assistant responses.
 *
 * Buffers streamed assistant text deltas, splits into sentence chunks
 * (SentenceChunker), sanitizes each (SpeechTextSanitizer), synthesizes via the
 * TTS API, and plays them in order (VoicePlaybackQueue). Applies the speak
 * policy (ttsMode + latest input source). Cancelable on stop / new
 * conversation / unmount. Design §12.1.
 *
 * The synthesize function + playback queue are DI'd so the controller logic is
 * unit-testable without the IPC or DOM audio.
 */
import { SentenceChunker } from "./SentenceChunker";
import { sanitizeForSpeech } from "./SpeechTextSanitizer";
import { VoicePlaybackQueue } from "./VoicePlaybackQueue";
import { synthesizeVoice } from "@/views/api/aiChatV2Voice";
import type { AiChatVoiceTtsMode } from "@/entityTypes/aiChatVoiceTypes";

export interface SpeechResponseOptions {
  ttsMode: AiChatVoiceTtsMode;
  /** Whether the latest user message came from voice input. */
  latestInputWasVoice: boolean;
  language?: string;
  voiceId?: string;
  speed?: number;
}

export type SynthesizeFn = (request: {
  text: string;
  language?: string;
  voiceId?: string;
  speed?: number;
}) => Promise<{ audioBase64: string }>;

export interface SpeechResponseError {
  readonly phase: "synthesis" | "playback";
  readonly message: string;
}

const defaultSynthesize: SynthesizeFn = (req) =>
  synthesizeVoice(req).then((r) => ({ audioBase64: r.audioBase64 }));

export class SpeechResponseController {
  private readonly chunker = new SentenceChunker();
  private readonly queue: VoicePlaybackQueue;
  private readonly synthesize: SynthesizeFn;
  private readonly onError?: (error: SpeechResponseError) => void;
  private options: SpeechResponseOptions;
  private active = false;
  private pendingSynth = 0;
  private sessionId = 0;
  private readonly speakingListeners = new Set<(speaking: boolean) => void>();
  private lastNotifiedSpeaking = false;

  constructor(
    options: SpeechResponseOptions,
    queue?: VoicePlaybackQueue,
    synthesize: SynthesizeFn = defaultSynthesize,
    onError?: (error: SpeechResponseError) => void
  ) {
    this.options = options;
    this.onError = onError;
    // When the controller owns the queue, wire playback transitions back to
    // `notifySpeaking` so subscribers learn the combined speaking state. A
    // DI'd queue (tests) keeps its own behavior.
    this.queue =
      queue ??
      new VoicePlaybackQueue({
        onSpeakingChange: () => this.notifySpeaking(),
        onPlaybackError: (error) => this.reportError("playback", error),
      });
    this.synthesize = synthesize;
  }

  get isSpeaking(): boolean {
    return this.queue.isSpeaking || this.pendingSynth > 0;
  }

  /**
   * Subscribe to combined speaking-state transitions (TODO P1-2). The listener
   * is fired only when `isSpeaking` flips between true/false, not on every
   * chunk. Returns an unsubscribe function.
   */
  subscribe(listener: (speaking: boolean) => void): () => void {
    this.speakingListeners.add(listener);
    return () => {
      this.speakingListeners.delete(listener);
    };
  }

  private notifySpeaking(): void {
    const current = this.isSpeaking;
    if (current === this.lastNotifiedSpeaking) return;
    this.lastNotifiedSpeaking = current;
    for (const listener of this.speakingListeners) {
      listener(current);
    }
  }

  /** Whether the policy says to speak for the current response. */
  shouldSpeak(): boolean {
    const { ttsMode, latestInputWasVoice } = this.options;
    if (ttsMode === "disabled") return false;
    if (ttsMode === "after_voice_input") return latestInputWasVoice;
    return true; // all_assistant_messages
  }

  /** Start a new response (resets the chunker). */
  start(): void {
    this.active = true;
    this.sessionId += 1;
    this.chunker.flush(); // discard any stale buffer
  }

  /** Feed an assistant text delta; emits sentence chunks to TTS. */
  pushDelta(delta: string): void {
    if (!this.active || !this.shouldSpeak()) return;
    const chunks = this.chunker.push(delta);
    for (const chunk of chunks) {
      void this.synthesizeChunk(chunk);
    }
  }

  /** Flush remaining buffered text (call when the response completes). */
  flush(): void {
    if (!this.active || !this.shouldSpeak()) return;
    const remaining = this.chunker.flush();
    if (remaining) {
      void this.synthesizeChunk(remaining);
    }
  }

  /** Stop: cancel playback, clear queue + chunker, deactivate. */
  stop(): void {
    this.active = false;
    this.sessionId += 1;
    this.chunker.flush();
    this.queue.stop();
    this.pendingSynth = 0;
    this.notifySpeaking();
  }

  /** Update options at runtime (e.g., ttsMode or language changed). */
  updateOptions(options: Partial<SpeechResponseOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private async synthesizeChunk(rawText: string): Promise<void> {
    const text = sanitizeForSpeech(rawText);
    if (!text) return;
    const chunkSessionId = this.sessionId;
    this.pendingSynth += 1;
    this.notifySpeaking();
    try {
      const result = await this.synthesize({
        text,
        ...(this.options.language ? { language: this.options.language } : {}),
        ...(this.options.voiceId ? { voiceId: this.options.voiceId } : {}),
        ...(this.options.speed !== undefined
          ? { speed: this.options.speed }
          : {}),
      });
      // Only enqueue if still active in the same response session. A stopped
      // synthesis can resolve after the next message re-arms the controller;
      // the session guard prevents abandoned audio from leaking into that
      // newer reply.
      if (this.active && chunkSessionId === this.sessionId) {
        this.queue.enqueue(result.audioBase64);
      }
    } catch (err) {
      // Synthesis failed (model not loaded, etc.); skip this chunk but expose
      // the error so the UI doesn't look enabled while staying silent.
      if (this.active && chunkSessionId === this.sessionId) {
        this.reportError("synthesis", err);
      }
    } finally {
      this.pendingSynth = Math.max(0, this.pendingSynth - 1);
      this.notifySpeaking();
    }
  }

  private reportError(
    phase: SpeechResponseError["phase"],
    error: unknown
  ): void {
    const fallback =
      phase === "synthesis"
        ? "Speech synthesis failed."
        : "Speech playback failed.";
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : fallback;
    this.onError?.({ phase, message: message.trim() || fallback });
  }
}
