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

const defaultSynthesize: SynthesizeFn = (req) =>
  synthesizeVoice(req).then((r) => ({ audioBase64: r.audioBase64 }));

export class SpeechResponseController {
  private readonly chunker = new SentenceChunker();
  private readonly queue: VoicePlaybackQueue;
  private readonly synthesize: SynthesizeFn;
  private options: SpeechResponseOptions;
  private active = false;
  private pendingSynth = 0;

  constructor(
    options: SpeechResponseOptions,
    queue?: VoicePlaybackQueue,
    synthesize: SynthesizeFn = defaultSynthesize
  ) {
    this.options = options;
    this.queue = queue ?? new VoicePlaybackQueue();
    this.synthesize = synthesize;
  }

  get isSpeaking(): boolean {
    return this.queue.isSpeaking || this.pendingSynth > 0;
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
    this.chunker.flush();
    this.queue.stop();
    this.pendingSynth = 0;
  }

  /** Update options at runtime (e.g., ttsMode or language changed). */
  updateOptions(options: Partial<SpeechResponseOptions>): void {
    this.options = { ...this.options, ...options };
  }

  private async synthesizeChunk(rawText: string): Promise<void> {
    const text = sanitizeForSpeech(rawText);
    if (!text) return;
    this.pendingSynth += 1;
    try {
      const result = await this.synthesize({
        text,
        ...(this.options.language ? { language: this.options.language } : {}),
        ...(this.options.voiceId ? { voiceId: this.options.voiceId } : {}),
        ...(this.options.speed !== undefined
          ? { speed: this.options.speed }
          : {}),
      });
      // Only enqueue if still active (not stopped mid-synthesis).
      if (this.active) {
        this.queue.enqueue(result.audioBase64);
      }
    } catch {
      // Synthesis failed (model not loaded, etc.); skip this chunk.
    } finally {
      this.pendingSynth -= 1;
    }
  }
}
