"use strict";
/**
 * AiChatV2 local voice worker entry.
 *
 * Runs in an Electron `utilityProcess` spawned by `SherpaVoiceWorkerClient`.
 * Parses inbound messages (Zod), lazily loads STT/TTS services, routes
 * transcribe/synthesize, and returns outbound messages. Hard rules (design §2.3):
 *  - no SQLite / TypeORM / Model / Module imports
 *  - no chat history or token storage access
 *  - validates every inbound message
 *
 * The routing is exported as `dispatchVoiceMessage` (DI'd services + sink) so it
 * is unit-testable without forking. Real `sherpa-onnx` inference is the marked
 * extension point in `voiceServices.ts`.
 */
import {
  type AiChatVoiceInboundMessage,
  type AiChatVoiceOutboundMessage,
} from "@/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes";
import { aiChatVoiceInboundSchema } from "@/schemas/worker/aiChatVoice";
import {
  createVoiceServices,
  type VoiceServices,
} from "@/childprocess/ai-chat-voice/voiceServices";

interface ParentPortMessageEvent {
  data: string;
}

interface WorkerParentPort {
  on: (
    event: "message",
    handler: (event: ParentPortMessageEvent) => void | Promise<void>
  ) => void;
  postMessage: (message: string) => void;
}

/** Sink the dispatcher uses to post results / exit. Abstracted for testing. */
export interface WorkerSink {
  post(message: AiChatVoiceOutboundMessage): void;
  exit(code: number): void;
}

function requestIdOf(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "requestId" in raw &&
    typeof (raw as { requestId?: unknown }).requestId === "string"
  ) {
    return (raw as { requestId: string }).requestId;
  }
  return "unknown";
}

async function handleInitialize(
  message: Extract<AiChatVoiceInboundMessage, { type: "initialize" }>,
  services: VoiceServices,
  sink: WorkerSink
): Promise<void> {
  const sttAvailable = await services.stt.load(
    message.sttModelPath,
    message.sttLanguage
  );
  const ttsAvailable = await services.tts.load(
    message.ttsModelPath,
    message.ttsLanguage
  );
  sink.post({
    type: "ready",
    requestId: message.requestId,
    sttAvailable,
    ttsAvailable,
  });
}

async function handleTranscribe(
  message: Extract<AiChatVoiceInboundMessage, { type: "transcribe" }>,
  services: VoiceServices,
  sink: WorkerSink
): Promise<void> {
  if (!services.stt.isLoaded()) {
    sink.post({
      type: "error",
      requestId: message.requestId,
      error: "STT model is not loaded.",
    });
    return;
  }
  const out = await services.stt.transcribe(
    message.audioBase64,
    message.mimeType,
    message.language
  );
  sink.post({
    type: "transcribe-result",
    requestId: message.requestId,
    transcript: out.transcript,
    ...(out.language !== undefined ? { language: out.language } : {}),
    ...(out.durationMs !== undefined ? { durationMs: out.durationMs } : {}),
  });
}

async function handleSynthesize(
  message: Extract<AiChatVoiceInboundMessage, { type: "synthesize" }>,
  services: VoiceServices,
  sink: WorkerSink
): Promise<void> {
  if (!services.tts.isLoaded()) {
    sink.post({
      type: "error",
      requestId: message.requestId,
      error: "TTS model is not loaded.",
    });
    return;
  }
  const out = await services.tts.synthesize(
    message.text,
    message.voiceId,
    message.speed
  );
  sink.post({
    type: "synthesize-result",
    requestId: message.requestId,
    audioBase64: out.audioBase64,
    mimeType: "audio/wav",
    ...(out.durationMs !== undefined ? { durationMs: out.durationMs } : {}),
  });
}

/**
 * Route one inbound message. Exported for unit testing (inject mock services +
 * a capturing sink). Throws are converted to error outbound messages.
 */
export async function dispatchVoiceMessage(
  raw: unknown,
  services: VoiceServices,
  sink: WorkerSink
): Promise<void> {
  const parsed = aiChatVoiceInboundSchema().safeParse(raw);
  if (!parsed.success) {
    sink.post({
      type: "error",
      requestId: requestIdOf(raw),
      error: "Invalid inbound message.",
    });
    return;
  }
  const message = parsed.data;
  try {
    switch (message.type) {
      case "initialize":
        await handleInitialize(message, services, sink);
        break;
      case "transcribe":
        await handleTranscribe(message, services, sink);
        break;
      case "synthesize":
        await handleSynthesize(message, services, sink);
        break;
      case "cancel":
        // Best-effort: the client does not await a cancel response. Real
        // per-job cancellation arrives with streaming STT/TTS.
        break;
      case "shutdown":
        sink.exit(0);
        break;
      default: {
        // Unreachable for a discriminated union; guard anyway.
        const fallbackRequestId =
          (message as { requestId?: string }).requestId ?? "unknown";
        sink.post({
          type: "error",
          requestId: fallbackRequestId,
          error: "Unknown message type.",
        });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    sink.post({
      type: "error",
      requestId: message.requestId,
      error: errorMessage,
    });
  }
}

// --- Process wiring (only active when forked as a utilityProcess) -----------

const parentPort = (process as unknown as { parentPort?: WorkerParentPort })
  .parentPort;

if (parentPort) {
  const services = createVoiceServices();
  const sink: WorkerSink = {
    post: (message) => {
      try {
        parentPort.postMessage(JSON.stringify(message));
      } catch (postError) {
        const msg =
          postError instanceof Error ? postError.message : String(postError);
        console.error(`[AiChatVoiceWorker] Failed to post message: ${msg}`);
      }
    },
    exit: (code) => process.exit(code),
  };

  parentPort.on("message", async (event: ParentPortMessageEvent) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch (parseError) {
      const msg =
        parseError instanceof Error ? parseError.message : String(parseError);
      console.error(`[AiChatVoiceWorker] Non-JSON inbound: ${msg}`);
      sink.post({
        type: "error",
        requestId: "unknown",
        error: "Inbound message is not valid JSON.",
      });
      return;
    }
    await dispatchVoiceMessage(parsed, services, sink);
  });

  process.on("uncaughtException", (error: unknown) => {
    console.error("[AiChatVoiceWorker] Uncaught exception:", error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    console.error("[AiChatVoiceWorker] Unhandled rejection:", reason);
    process.exit(1);
  });
}
