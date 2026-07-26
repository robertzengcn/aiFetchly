import { describe, it, expect, vi } from "vitest";
import {
  SpeechResponseController,
  type SynthesizeFn,
} from "@/views/components/aiChatV2/voice/SpeechResponseController";
import { VoicePlaybackQueue } from "@/views/components/aiChatV2/voice/VoicePlaybackQueue";

function makeMockQueue(): {
  queue: VoicePlaybackQueue;
  enqueued: string[];
  stopMock: ReturnType<typeof vi.fn>;
} {
  const enqueued: string[] = [];
  const stopMock = vi.fn();
  const queue = {
    enqueue: (b64: string) => {
      enqueued.push(b64);
    },
    stop: stopMock,
    get isSpeaking() {
      return false;
    },
  } as unknown as VoicePlaybackQueue;
  return { queue, enqueued, stopMock };
}

function makeMockSynth(): {
  synth: SynthesizeFn;
  calls: string[];
} {
  const calls: string[] = [];
  const synth = vi.fn(async (req: { text: string }) => {
    calls.push(req.text);
    return { audioBase64: `audio:${req.text.slice(0, 6)}` };
  }) as unknown as SynthesizeFn;
  return { synth, calls };
}

describe("SpeechResponseController.shouldSpeak", () => {
  it("applies the ttsMode + input-source policy", () => {
    const { queue } = makeMockQueue();
    const { synth } = makeMockSynth();
    expect(
      new SpeechResponseController(
        { ttsMode: "disabled", latestInputWasVoice: true },
        queue,
        synth
      ).shouldSpeak()
    ).toBe(false);
    expect(
      new SpeechResponseController(
        { ttsMode: "after_voice_input", latestInputWasVoice: false },
        queue,
        synth
      ).shouldSpeak()
    ).toBe(false);
    expect(
      new SpeechResponseController(
        { ttsMode: "after_voice_input", latestInputWasVoice: true },
        queue,
        synth
      ).shouldSpeak()
    ).toBe(true);
    expect(
      new SpeechResponseController(
        { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
        queue,
        synth
      ).shouldSpeak()
    ).toBe(true);
  });
});

describe("SpeechResponseController.pushDelta", () => {
  it("synthesizes a sentence chunk and enqueues the audio", async () => {
    const { queue, enqueued } = makeMockQueue();
    const { synth, calls } = makeMockSynth();
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.start();
    c.pushDelta("This is a long enough sentence to trigger a chunk.");
    await vi.waitFor(() => expect(calls.length).toBe(1));
    await vi.waitFor(() => expect(enqueued.length).toBe(1));
    expect(calls[0]).toContain("long enough sentence");
  });

  it("strips code blocks before synthesis", async () => {
    const { queue } = makeMockQueue();
    const { synth, calls } = makeMockSynth();
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.start();
    c.pushDelta(
      "```python\nprint('hi')\n```\nThis is the actual spoken response text here."
    );
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).not.toContain("python");
    expect(calls[0]).toContain("actual spoken response");
  });
});

describe("SpeechResponseController.flush", () => {
  it("flushes buffered text that did not cross a sentence boundary", async () => {
    const { queue } = makeMockQueue();
    const { synth, calls } = makeMockSynth();
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.start();
    c.pushDelta("Short partial");
    expect(calls.length).toBe(0);
    c.flush();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toBe("Short partial");
  });
});

describe("SpeechResponseController.stop", () => {
  it("stops the queue and blocks further synthesis", async () => {
    const { queue, stopMock } = makeMockQueue();
    const { synth, calls } = makeMockSynth();
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.start();
    c.stop();
    c.pushDelta("This text should not be synthesized at all here.");
    expect(calls.length).toBe(0);
    expect(stopMock).toHaveBeenCalled();
  });

  it("does not enqueue stale synthesis after a later response starts", async () => {
    const { queue, enqueued } = makeMockQueue();
    let resolveFirstSynth!: (value: { audioBase64: string }) => void;
    const synth: SynthesizeFn = vi.fn(
      () =>
        new Promise<{ audioBase64: string }>((resolve) => {
          resolveFirstSynth = resolve;
        })
    );
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.start();
    c.pushDelta("This old sentence should never play after a stop.");
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1));

    c.stop();
    c.start();
    resolveFirstSynth({ audioBase64: "stale-audio" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(enqueued).toHaveLength(0);
  });
});

describe("SpeechResponseController.updateOptions", () => {
  it("propagates language/voiceId/speed into the synthesize call", async () => {
    const requests: {
      language?: string;
      voiceId?: string;
      speed?: number;
    }[] = [];
    const synth: SynthesizeFn = vi.fn(async (req) => {
      requests.push({
        language: req.language,
        voiceId: req.voiceId,
        speed: req.speed,
      });
      return { audioBase64: "audio:x" };
    });
    const queue = makeMockQueue().queue;
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    // Mirror what AiChatV2.loadVoiceSettings pushes from saved settings.
    c.updateOptions({ language: "zh", voiceId: "amy", speed: 1.5 });
    c.start();
    c.pushDelta("A complete sentence that is long enough to emit now.");
    await vi.waitFor(() => expect(requests.length).toBe(1));
    expect(requests[0].language).toBe("zh");
    expect(requests[0].voiceId).toBe("amy");
    expect(requests[0].speed).toBe(1.5);
  });

  it("omits language/voiceId when not provided so the worker applies defaults", async () => {
    const requests: { language?: string; voiceId?: string }[] = [];
    const synth: SynthesizeFn = vi.fn(async (req) => {
      requests.push({ language: req.language, voiceId: req.voiceId });
      return { audioBase64: "audio:x" };
    });
    const queue = makeMockQueue().queue;
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.updateOptions({ speed: 1 });
    c.start();
    c.pushDelta("A complete sentence that is long enough to emit now.");
    await vi.waitFor(() => expect(requests.length).toBe(1));
    expect(requests[0].language).toBeUndefined();
    expect(requests[0].voiceId).toBeUndefined();
  });
});

describe("SpeechResponseController.subscribe", () => {
  it("notifies subscribers when synthesis starts and ends", async () => {
    const events: boolean[] = [];
    const queue = makeMockQueue().queue; // isSpeaking stays false
    let resolveSynth!: (value: { audioBase64: string }) => void;
    const synth: SynthesizeFn = vi.fn(
      () =>
        new Promise<{ audioBase64: string }>((resolve) => {
          resolveSynth = resolve;
        })
    );
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    c.subscribe((speaking) => events.push(speaking));
    c.start();
    c.pushDelta("A complete sentence that is long enough to emit now.");
    // While synthesis is pending, pendingSynth > 0 -> speaking flips true.
    await vi.waitFor(() => expect(events).toContain(true));
    resolveSynth({ audioBase64: "audio:x" });
    // After synthesis completes, pendingSynth returns to 0 -> speaking false.
    await vi.waitFor(() => expect(events[events.length - 1]).toBe(false));
  });

  it("unsubscribe stops further notifications", async () => {
    const events: boolean[] = [];
    const queue = makeMockQueue().queue;
    const synth = makeMockSynth().synth;
    const c = new SpeechResponseController(
      { ttsMode: "all_assistant_messages", latestInputWasVoice: false },
      queue,
      synth
    );
    const unsub = c.subscribe((speaking) => events.push(speaking));
    unsub();
    c.start();
    c.pushDelta("A complete sentence that is long enough to emit now.");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toHaveLength(0);
  });
});
