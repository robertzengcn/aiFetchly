import { describe, it, expect, vi, type Mock } from "vitest";
import {
  VoicePlaybackQueue,
  type PlayableAudioElement,
} from "@/views/components/aiChatV2/voice/VoicePlaybackQueue";

interface FakeEl {
  src: string;
  play: Mock;
  pause: Mock;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

function makeFakeAudio(): {
  createAudio: (src: string) => PlayableAudioElement;
  current: () => FakeEl | null;
  created: string[];
  fireEnded: () => void;
} {
  let current: FakeEl | null = null;
  const created: string[] = [];
  const createAudio = (src: string): PlayableAudioElement => {
    const el: FakeEl = {
      src,
      play: vi.fn(async () => {
        /* fake */
      }) as Mock,
      pause: vi.fn() as Mock,
      onended: null,
      onerror: null,
    };
    current = el;
    created.push(src);
    return el as unknown as PlayableAudioElement;
  };
  return {
    createAudio,
    current: () => current,
    created,
    fireEnded: () => {
      current?.onended?.();
    },
  };
}

function makeQueue(fx: ReturnType<typeof makeFakeAudio>): {
  queue: VoicePlaybackQueue;
  revoked: string[];
} {
  const revoked: string[] = [];
  const queue = new VoicePlaybackQueue({
    resolveAudioUrl: (b) => `blob:${b}`,
    revokeObjectUrl: (u) => revoked.push(u),
    createAudio: fx.createAudio,
  });
  return { queue, revoked };
}

describe("VoicePlaybackQueue", () => {
  it("plays an enqueued chunk and reports isSpeaking", () => {
    const fx = makeFakeAudio();
    const { queue, revoked } = makeQueue(fx);
    queue.enqueue("AAA");
    expect(queue.isSpeaking).toBe(true);
    expect(fx.created).toEqual(["blob:AAA"]);
    fx.fireEnded();
    expect(revoked).toEqual(["blob:AAA"]);
    expect(queue.isSpeaking).toBe(false);
  });

  it("plays chunks in enqueue order", () => {
    const fx = makeFakeAudio();
    const { queue } = makeQueue(fx);
    queue.enqueue("A");
    queue.enqueue("B");
    queue.enqueue("C");
    // Only the first chunk plays immediately; the rest wait.
    expect(fx.created).toEqual(["blob:A"]);
    fx.fireEnded();
    expect(fx.created).toEqual(["blob:A", "blob:B"]);
    fx.fireEnded();
    expect(fx.created).toEqual(["blob:A", "blob:B", "blob:C"]);
    fx.fireEnded();
    expect(queue.isSpeaking).toBe(false);
  });

  it("stop pauses the current chunk and clears the queue", () => {
    const fx = makeFakeAudio();
    const { queue } = makeQueue(fx);
    queue.enqueue("A");
    queue.enqueue("B");
    const playing = fx.current();
    expect(playing).not.toBeNull();
    queue.stop();
    expect(queue.isSpeaking).toBe(false);
    expect(playing?.pause).toHaveBeenCalled();
    // After stop, firing ended on the stale element must not advance playback.
    fx.fireEnded();
    expect(fx.created).toEqual(["blob:A"]);
  });

  it("stop revokes the current object URL so no TTS artifact leaks (TODO P2)", () => {
    const fx = makeFakeAudio();
    const { queue, revoked } = makeQueue(fx);
    queue.enqueue("A");
    expect(revoked).toEqual([]);
    queue.stop();
    expect(revoked).toEqual(["blob:A"]);
  });

  it("onerror revokes the current URL and advances to the next chunk", () => {
    const fx = makeFakeAudio();
    const { queue, revoked } = makeQueue(fx);
    queue.enqueue("A");
    queue.enqueue("B");
    expect(fx.current()?.onerror).not.toBeNull();
    fx.current()?.onerror?.(); // playback failure on A
    expect(revoked).toContain("blob:A");
    // The queue advanced to B instead of stalling.
    expect(fx.created).toEqual(["blob:A", "blob:B"]);
  });
});
