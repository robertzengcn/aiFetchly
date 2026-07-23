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
});
