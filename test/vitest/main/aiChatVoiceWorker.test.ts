import { describe, it, expect, vi, type Mock } from "vitest";
import {
  dispatchVoiceMessage,
  type WorkerSink,
} from "@/childprocess/ai-chat-voice/AiChatVoiceWorker";
import type { AiChatVoiceOutboundMessage } from "@/childprocess/ai-chat-voice/AiChatVoiceWorkerTypes";
import type { VoiceServices } from "@/childprocess/ai-chat-voice/voiceServices";

function makeMockServices(
  opts: { sttLoaded?: boolean; ttsLoaded?: boolean } = {}
): {
  services: VoiceServices;
  transcribe: Mock;
  synthesize: Mock;
} {
  const sttLoaded = opts.sttLoaded ?? true;
  const ttsLoaded = opts.ttsLoaded ?? true;
  const transcribe = vi.fn(async () => ({ transcript: "hi" })) as Mock;
  const synthesize = vi.fn(async () => ({ audioBase64: "//uQ" })) as Mock;
  const services = {
    stt: {
      load: vi.fn(async () => sttLoaded),
      isLoaded: () => sttLoaded,
      transcribe,
    },
    tts: {
      load: vi.fn(async () => ttsLoaded),
      isLoaded: () => ttsLoaded,
      synthesize,
    },
  } as unknown as VoiceServices;
  return { services, transcribe, synthesize };
}

function makeCapturingSink(): WorkerSink & {
  posted: AiChatVoiceOutboundMessage[];
  exitCode: () => number | null;
} {
  const posted: AiChatVoiceOutboundMessage[] = [];
  let exitCode: number | null = null;
  return {
    post: (m) => posted.push(m),
    exit: (c) => {
      exitCode = c;
    },
    posted,
    exitCode: () => exitCode,
  };
}

describe("dispatchVoiceMessage", () => {
  it("initialize posts ready with availability from the services", async () => {
    const { services } = makeMockServices({
      sttLoaded: true,
      ttsLoaded: false,
    });
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      {
        type: "initialize",
        requestId: "r1",
        sttModelPath: "/m/stt",
        ttsModelPath: "/m/tts",
      },
      services,
      sink
    );
    expect(sink.posted).toEqual([
      {
        type: "ready",
        requestId: "r1",
        sttAvailable: true,
        ttsAvailable: false,
      },
    ]);
  });

  it("transcribe returns the transcript when STT is loaded", async () => {
    const { services, transcribe } = makeMockServices({ sttLoaded: true });
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      {
        type: "transcribe",
        requestId: "r2",
        audioBase64: "AAAA",
        mimeType: "audio/webm",
      },
      services,
      sink
    );
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(sink.posted[0]).toMatchObject({
      type: "transcribe-result",
      requestId: "r2",
      transcript: "hi",
    });
  });

  it("transcribe errors when the STT model is not loaded", async () => {
    const { services, transcribe } = makeMockServices({ sttLoaded: false });
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      {
        type: "transcribe",
        requestId: "r3",
        audioBase64: "AAAA",
        mimeType: "audio/webm",
      },
      services,
      sink
    );
    expect(transcribe).not.toHaveBeenCalled();
    const msg = sink.posted[0];
    expect(msg.type).toBe("error");
    if (msg.type === "error") {
      expect(msg.requestId).toBe("r3");
      expect(msg.error).toMatch(/stt model is not loaded/i);
    }
  });

  it("synthesize returns WAV audio when TTS is loaded", async () => {
    const { services, synthesize } = makeMockServices({ ttsLoaded: true });
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      { type: "synthesize", requestId: "r4", text: "Hello." },
      services,
      sink
    );
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(sink.posted[0]).toMatchObject({
      type: "synthesize-result",
      requestId: "r4",
      audioBase64: "//uQ",
      mimeType: "audio/wav",
    });
  });

  it("synthesize errors when the TTS model is not loaded", async () => {
    const { services } = makeMockServices({ ttsLoaded: false });
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      { type: "synthesize", requestId: "r5", text: "Hello." },
      services,
      sink
    );
    const msg = sink.posted[0];
    expect(msg.type).toBe("error");
    if (msg.type === "error") {
      expect(msg.error).toMatch(/tts model is not loaded/i);
    }
  });

  it("rejects invalid inbound and recovers the requestId", async () => {
    const { services } = makeMockServices();
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      { type: "bogus", requestId: "r6" },
      services,
      sink
    );
    const msg = sink.posted[0];
    expect(msg.type).toBe("error");
    if (msg.type === "error") {
      expect(msg.requestId).toBe("r6");
    }
  });

  it("shutdown exits the process cleanly", async () => {
    const { services } = makeMockServices();
    const sink = makeCapturingSink();
    await dispatchVoiceMessage(
      { type: "shutdown", requestId: "r7" },
      services,
      sink
    );
    expect(sink.exitCode()).toBe(0);
  });
});
