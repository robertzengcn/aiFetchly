import { describe, it, expect, vi } from "vitest";
import {
  SherpaVoiceWorkerClient,
  type UtilityProcessLike,
  type ForkFn,
} from "@/service/aiChatVoice/SherpaVoiceWorkerClient";

interface PostedInbound {
  type: string;
  requestId: string;
}

/**
 * Fake fork harness. Captures the worker's message/exit handlers so the test
 * can simulate worker replies and crashes. `autoReady` makes the fake reply to
 * `initialize` with a `ready` message so the handshake completes automatically.
 */
function makeFakeFork(opts: { autoReady?: boolean } = {}): {
  fork: ForkFn;
  posted: PostedInbound[];
  emit: (m: Record<string, unknown>) => void;
  exit: (code: number | null) => void;
  requestIdFor: (type: string) => string | undefined;
} {
  let onMessage: ((m: unknown) => void) | null = null;
  let onExit: ((code: number | null) => void) | null = null;
  const posted: PostedInbound[] = [];
  const proc: UtilityProcessLike = {
    on: ((event: string, handler: (arg: unknown) => void) => {
      if (event === "message") {
        onMessage = handler as (m: unknown) => void;
      } else if (event === "exit") {
        onExit = handler as (code: number | null) => void;
      }
    }) as UtilityProcessLike["on"],
    postMessage: (msg: string) => {
      let parsed: PostedInbound;
      try {
        parsed = JSON.parse(msg) as PostedInbound;
      } catch {
        return;
      }
      posted.push(parsed);
      if (opts.autoReady && parsed.type === "initialize") {
        queueMicrotask(() =>
          onMessage?.(
            JSON.stringify({
              type: "ready",
              requestId: parsed.requestId,
              sttAvailable: true,
              ttsAvailable: true,
            })
          )
        );
      }
    },
    kill: vi.fn(),
  };
  return {
    fork: () => proc,
    posted,
    emit: (m) => onMessage?.(JSON.stringify(m)),
    exit: (code) => onExit?.(code),
    requestIdFor: (type) =>
      [...posted].reverse().find((p) => p.type === type)?.requestId,
  };
}

describe("SherpaVoiceWorkerClient", () => {
  it("completes the initialize -> ready handshake and transcribes", async () => {
    const fx = makeFakeFork({ autoReady: true });
    const client = SherpaVoiceWorkerClient.createWithFork(fx.fork, 2000);

    const p = client.transcribe("AAAA", "audio/webm", "en");
    await vi.waitFor(() => expect(fx.requestIdFor("transcribe")).toBeDefined());
    fx.emit({
      type: "transcribe-result",
      requestId: fx.requestIdFor("transcribe"),
      transcript: "hello world",
    });

    await expect(p).resolves.toMatchObject({ transcript: "hello world" });
    // The client sent initialize (handshake) before the transcribe request.
    expect(fx.requestIdFor("initialize")).toBeDefined();
    client.dispose();
  });

  it("synthesizes speech via the worker", async () => {
    const fx = makeFakeFork({ autoReady: true });
    const client = SherpaVoiceWorkerClient.createWithFork(fx.fork, 2000);

    const p = client.synthesize("Hello.", { speed: 1.0 });
    await vi.waitFor(() => expect(fx.requestIdFor("synthesize")).toBeDefined());
    fx.emit({
      type: "synthesize-result",
      requestId: fx.requestIdFor("synthesize"),
      audioBase64: "//uQAAAA",
      mimeType: "audio/wav",
    });

    await expect(p).resolves.toMatchObject({ audioBase64: "//uQAAAA" });
    client.dispose();
  });

  it("rejects the caller when the worker reports an error for its request", async () => {
    const fx = makeFakeFork({ autoReady: true });
    const client = SherpaVoiceWorkerClient.createWithFork(fx.fork, 2000);

    const p = client.transcribe("AAAA", "audio/webm");
    await vi.waitFor(() => expect(fx.requestIdFor("transcribe")).toBeDefined());
    fx.emit({
      type: "error",
      requestId: fx.requestIdFor("transcribe"),
      error: "model missing",
    });

    await expect(p).rejects.toThrow("model missing");
    client.dispose();
  });

  it("rejects on request timeout when no result arrives", async () => {
    const fx = makeFakeFork({ autoReady: true });
    const client = SherpaVoiceWorkerClient.createWithFork(fx.fork, 30);

    const p = client.transcribe("AAAA", "audio/webm");
    await expect(p).rejects.toThrow(/timeout/i);
    client.dispose();
  });

  it("rejects pending requests when the worker crashes (exit)", async () => {
    const fx = makeFakeFork({ autoReady: true });
    const client = SherpaVoiceWorkerClient.createWithFork(fx.fork, 5000);

    const p = client.transcribe("AAAA", "audio/webm");
    await vi.waitFor(() => expect(fx.requestIdFor("transcribe")).toBeDefined());
    fx.exit(1); // simulate worker crash

    await expect(p).rejects.toThrow(/unavailable/i);
    client.dispose();
  });

  it("does not fork until the first request", async () => {
    const fx = makeFakeFork({ autoReady: true });
    const client = SherpaVoiceWorkerClient.createWithFork(fx.fork, 2000);
    expect(fx.posted).toHaveLength(0);
    client.dispose();
  });
});
