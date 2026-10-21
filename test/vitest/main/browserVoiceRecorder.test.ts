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

  it("hands the max-duration capture to onAutoStop instead of discarding it (audit R2 N05)", async () => {
    const fx = makeFakeMedia();
    const autoResults: unknown[] = [];
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: (m) => m === "audio/webm;codecs=opus",
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => 1000,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
      onAutoStop: (result) => autoResults.push(result),
    });

    await rec.start(100);
    fx.recorderRef()?.pushData({ size: 9 } as unknown as Blob);
    fx.getMaxCallback()!();
    await Promise.resolve();
    expect(autoResults).toHaveLength(1);
    const result = autoResults[0] as { mimeType: string; blob: { size: number } };
    expect(result.mimeType).toBe("audio/webm;codecs=opus");
    expect(result.blob.size).toBe(1);
    expect(rec.recordingState).toBe("idle");
    expect(fx.tracksStopped.length).toBe(1);
  });

  it("does not invoke onAutoStop for an explicit stop (audit R2 N05)", async () => {
    const fx = makeFakeMedia();
    const onAutoStop = vi.fn();
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => 1000,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
      onAutoStop,
    });

    await rec.start(60_000);
    const result = await rec.stop();
    expect(result.blob.size).toBe(0);
    expect(onAutoStop).not.toHaveBeenCalled();
    expect(rec.recordingState).toBe("idle");
  });

  it("dispose releases the mic, drops in-flight capture, and never resolves to a transcript (audit R2 N06)", async () => {
    const fx = makeFakeMedia();
    const onAutoStop = vi.fn();
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
      now: () => 1000,
      blobFactory: (parts) => ({ size: parts.length }) as unknown as Blob,
      onAutoStop,
    });

    await rec.start(60_000);
    fx.recorderRef()?.pushData({ size: 3 } as unknown as Blob);
    rec.dispose();
    expect(rec.recordingState).toBe("idle");
    expect(fx.tracksStopped.length).toBe(1);
    // The max timer was cleared — dispose() removed it.
    expect(fx.clearTimeoutFn).toHaveBeenCalled();
    expect(fx.getMaxCallback()).toBeNull();
    // Late onstop from the disposed recorder flags no auto completion and
    // leaves no resolver behind.
    fx.recorderRef()?.onstop?.();
    await Promise.resolve();
    expect(onAutoStop).not.toHaveBeenCalled();
    // The disposed recorder can keep starting fresh sessions (no residue).
    await rec.start(60_000);
    expect(rec.recordingState).toBe("recording");
    await rec.stop();
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

  it("AUDIT3 dispose during microphone acquisition prevents a late recorder start", async () => {
    const fx = makeFakeMedia();
    let giveStream: (stream: MediaStreamLike) => void = () => undefined;
    const rec = new BrowserVoiceRecorder({
      getUserMedia: () => new Promise(resolve => { giveStream = resolve; }),
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
    });
    const stopped = vi.fn();
    const started = rec.start();
    rec.dispose();
    giveStream({ getTracks: () => [{ stop: stopped }] });
    await started.catch(() => undefined);
    const stateAfterResolve = rec.recordingState;
    rec.dispose();
    expect(stateAfterResolve).toBe("idle");
    expect(fx.mediaRecorderFactory).not.toHaveBeenCalled();
  });
});


describe("BrowserVoiceRecorder failed initialization rollback (audit R4-02)", () => {
  it("releases the acquired stream and stops its tracks if the MediaRecorder constructor fails", async () => {
    const fx = makeFakeMedia();
    fx.mediaRecorderFactory.mockImplementationOnce(() => {
      throw new Error("unsupported recording device");
    });
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
    });
    await expect(rec.start()).rejects.toThrow("unsupported recording device");
    // The rollback ran immediately: the microphone is released BEFORE any
    // external dispose and no max-duration timer was ever armed.
    expect(fx.tracksStopped.length).toBe(1);
    expect(fx.setTimeoutFn).not.toHaveBeenCalled();
    expect(fx.getMaxCallback()).toBeNull();
    expect(rec.recordingState).toBe("idle");
    // ambient dispose is a no-op — never a second stop.
    rec.dispose();
    expect(fx.tracksStopped.length).toBe(1);
    // A retry acquires a fresh stream and records normally (the throwing
    // once-entry was consumed; the base factory works).
    await rec.start();
    expect(rec.recordingState).toBe("recording");
    await rec.stop();
    expect(fx.tracksStopped.length).toBe(2);
  });

  it("rolls back and releases the stream when MIME probing throws", async () => {
    const fx = makeFakeMedia();
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => {
        throw new Error("probe exploded");
      },
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
    });
    await expect(rec.start()).rejects.toThrow("probe exploded");
    expect(fx.tracksStopped.length).toBe(1);
    expect(fx.mediaRecorderFactory).not.toHaveBeenCalled();
    expect(fx.setTimeoutFn).not.toHaveBeenCalled();
    expect(rec.recordingState).toBe("idle");
  });

  it("rolls back the armed timer and state when recorder.start() throws", async () => {
    const fx = makeFakeMedia();
    let broken: FakeRecorder | null = null;
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: fx.mediaRecorderFactory,
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
      clearTimeoutFn: fx.clearTimeoutFn,
    });
    void fx.mediaRecorderFactory.mockImplementationOnce(
      ((_stream: unknown, mime: string) => {
        const r = makeFakeRecorder(mime);
        r.start = vi.fn(() => {
          throw new Error("recorder refused to start");
        });
        broken = r;
        return r as unknown as MediaRecorderLike;
      }) as unknown as Mock
    );
    await expect(rec.start()).rejects.toThrow("recorder refused to start");
    // The timer was armed before start() — the rollback released it.
    expect(fx.clearTimeoutFn).toHaveBeenCalled();
    expect(fx.getMaxCallback()).toBeNull();
    // Tracks stopped exactly once for the failed session.
    expect(fx.tracksStopped.length).toBe(1);
    expect(rec.recordingState).toBe("idle");
    // No half-constructed session can be stopped and no detached callback
    // fires the resolution path of a dead session.
    await expect(rec.stop()).rejects.toThrow(/not recording/i);
    const brokenRef = broken as FakeRecorder | null;
    expect(brokenRef?.onstop).toBeNull();
    expect(brokenRef?.ondataavailable).toBeNull();
    // A retry starts a normal session (the once-entry was consumed).
    await rec.start();
    expect(rec.recordingState).toBe("recording");
    await rec.stop();
  });

  it("a failed start propagates the original error, not a classified substitute", async () => {
    const fx = makeFakeMedia();
    const boom = { code: -1, message: "constraint failure" };
    const rec = new BrowserVoiceRecorder({
      getUserMedia: fx.getUserMedia,
      mediaRecorderFactory: () => {
        throw boom;
      },
      isTypeSupported: () => true,
      setTimeoutFn: fx.setTimeoutFn,
    });
    await expect(rec.start()).rejects.toBe(boom);
    expect(fx.tracksStopped.length).toBe(1);
  });
});
