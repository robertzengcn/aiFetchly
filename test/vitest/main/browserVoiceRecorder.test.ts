import { describe, it, expect, vi, type Mock } from "vitest";
import {
  BrowserVoiceRecorder,
  type MediaRecorderLike,
  type MediaStreamLike,
} from "@/views/components/aiChatV2/voice/BrowserVoiceRecorder";

interface FakeRecorder {
  mime: string;
  start: Mock;
  stop: Mock;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  pushData: (blob: Blob) => void;
}

function makeFakeRecorder(mime: string): FakeRecorder {
  const r: FakeRecorder = {
    mime,
    start: vi.fn(),
    stop: vi.fn(() => {
      r.onstop?.();
    }),
    state: "inactive",
    ondataavailable: null,
    onstop: null,
    onerror: null,
    pushData: (blob: Blob) => {
      r.ondataavailable?.({ data: blob });
    },
  };
  return r;
}

function makeFakeMedia(): {
  getUserMedia: Mock;
  mediaRecorderFactory: Mock;
  recorderRef: () => FakeRecorder | null;
  tracksStopped: number[];
  getMaxCallback: () => (() => void) | null;
  setTimeoutFn: Mock;
  clearTimeoutFn: Mock;
} {
  const tracksStopped: number[] = [];
  const stream: MediaStreamLike = {
    getTracks: () => [{ stop: () => tracksStopped.push(1) }],
  };
  let recorder: FakeRecorder | null = null;
  let maxCallback: (() => void) | null = null;
  return {
    getUserMedia: vi.fn(async () => stream),
    mediaRecorderFactory: vi.fn((_stream, mime) => {
      recorder = makeFakeRecorder(mime as string);
      return recorder as unknown as MediaRecorderLike;
    }),
    recorderRef: () => recorder,
    tracksStopped,
    getMaxCallback: () => maxCallback,
    setTimeoutFn: vi.fn((cb: () => void) => {
      maxCallback = cb;
      return "timer" as unknown as ReturnType<typeof setTimeout>;
    }),
    clearTimeoutFn: vi.fn(() => {
      maxCallback = null;
    }),
  };
}

describe("BrowserVoiceRecorder", () => {
  it("requests the mic, selects a supported MIME, and starts recording", async () => {
    const fx = makeFakeMedia();
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: (m) => m === "audio/webm;codecs=opus",
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => 1000,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
    });

    await rec.start(60_000);
    expect(rec.recordingState).toBe("recording");
    expect(fx.getUserMedia).toHaveBeenCalledWith({ audio: true });
    const recorder = fx.recorderRef();
    expect(recorder?.start).toHaveBeenCalled();
    expect(recorder?.mime).toBe("audio/webm;codecs=opus");
    // Max-duration timer was armed.
    expect(fx.setTimeoutFn).toHaveBeenCalled();
  });

  it("stop resolves the captured blob + duration and stops tracks", async () => {
    const fx = makeFakeMedia();
    let nowVal = 1000;
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: (m) => m === "audio/webm;codecs=opus",
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => nowVal,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
    });

    await rec.start(60_000);
    fx.recorderRef()?.pushData({ size: 5 } as unknown as Blob);
    fx.recorderRef()?.pushData({ size: 7 } as unknown as Blob);
    nowVal = 2500;

    const result = await rec.stop();
    expect(result.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.durationMs).toBe(1500);
    expect(rec.recordingState).toBe("idle");
    // The blob factory received the two captured chunks.
    expect((result.blob as unknown as { size: number }).size).toBe(2);
    // Mic tracks were stopped on cleanup.
    expect(fx.tracksStopped.length).toBe(1);
  });

  it("auto-stops when the max-duration timer fires", async () => {
    const fx = makeFakeMedia();
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => 1000,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
    });

    await rec.start(100);
    expect(rec.recordingState).toBe("recording");
    const cb = fx.getMaxCallback();
    expect(cb).not.toBeNull();
    cb!();
    // The internal stop() runs the recorder's onstop synchronously.
    await Promise.resolve();
    expect(rec.recordingState).toBe("idle");
  });

  it("throws if start is called while already recording", async () => {
    const fx = makeFakeMedia();
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => 1000,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
    });
    await rec.start(60_000);
    await expect(rec.start(60_000)).rejects.toThrow(/already recording/i);
    // cleanup so later tests/the timer don't dangle
    await rec.stop();
  });
});
