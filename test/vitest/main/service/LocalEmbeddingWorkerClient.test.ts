"use strict";
import { describe, expect, it } from "vitest";
import { LocalEmbeddingWorkerClient } from "@/service/embedding/LocalEmbeddingWorkerClient";
import type {
  ForkFn,
  UtilityProcessLike,
} from "@/service/embedding/LocalEmbeddingWorkerClient";
import type { LocalEmbeddingOutboundMessage } from "@/childprocess/embedding/LocalEmbeddingWorkerTypes";
import { LOCAL_XENOVA_ALL_MINILM_MODEL_ID } from "@/service/embedding/LocalEmbeddingModels";

interface SentMessage {
  type: string;
  requestId: string;
  modelId?: string;
  texts?: string[];
}

type Responder = (
  msg: SentMessage
) => LocalEmbeddingOutboundMessage | undefined | void;

/**
 * Minimal stand-in for an Electron UtilityProcess. Does NOT implement
 * UtilityProcessLike directly because that interface uses overloaded `on`
 * signatures; instead we cast at the fork boundary.
 */
class FakeWorker {
  readonly sent: SentMessage[] = [];
  private readonly messageHandlers: Array<(m: unknown) => void> = [];
  private readonly exitHandlers: Array<(c: number | null) => void> = [];
  private readonly errorHandlers: Array<(e: unknown) => void> = [];
  killed = false;

  constructor(private readonly responder: Responder) {}

  on(
    event: "error" | "exit" | "message",
    handler: (arg: unknown) => void
  ): unknown {
    if (event === "message") {
      this.messageHandlers.push(handler as (m: unknown) => void);
    } else if (event === "exit") {
      this.exitHandlers.push(handler as (c: number | null) => void);
    } else if (event === "error") {
      this.errorHandlers.push(handler as (e: unknown) => void);
    }
    return this;
  }

  postMessage(raw: unknown): unknown {
    const msg =
      typeof raw === "string"
        ? (JSON.parse(raw) as SentMessage)
        : (raw as SentMessage);
    this.sent.push(msg);
    const response = this.responder(msg);
    if (response) {
      // Emit on a microtask so the client registers its pending handler first.
      queueMicrotask(() => this.emit(response));
    }
    return undefined;
  }

  kill(): unknown {
    this.killed = true;
    return undefined;
  }

  emit(message: unknown): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  emitExit(code: number | null): void {
    for (const handler of this.exitHandlers) {
      handler(code);
    }
  }
}

const autoResponder: Responder = (msg) => {
  if (msg.type === "initialize") {
    return {
      type: "ready",
      requestId: msg.requestId,
      modelId: msg.modelId ?? LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: 384,
    };
  }
  if (msg.type === "embed-batch") {
    const count = msg.texts?.length ?? 1;
    return {
      type: "embed-batch-result",
      requestId: msg.requestId,
      modelId: msg.modelId ?? LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
      dimensions: 384,
      embeddings: new Array(count).fill(0).map(() => new Array(384).fill(0.1)),
    };
  }
  return undefined;
};

function makeClient(
  responder: Responder,
  timeoutMs = 2000
): { client: LocalEmbeddingWorkerClient; worker: FakeWorker } {
  const worker = new FakeWorker(responder);
  const fork: ForkFn = () => worker as unknown as UtilityProcessLike;
  const client = LocalEmbeddingWorkerClient.createWithFork(fork, timeoutMs);
  return { client, worker };
}

describe("LocalEmbeddingWorkerClient", () => {
  it("initializes then embeds, returning a 384-dim vector per text", async () => {
    const { client, worker } = makeClient(autoResponder);

    const result = await client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, [
      "hello",
      "world",
    ]);

    expect(worker.sent[0].type).toBe("initialize");
    expect(worker.sent[1].type).toBe("embed-batch");
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(384);
    expect(result.dimensions).toBe(384);

    client.dispose();
  });

  it("reuses the same worker across calls (no second initialize)", async () => {
    const { client, worker } = makeClient(autoResponder);

    await client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["a"]);
    await client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["b"]);

    const initializes = worker.sent.filter((m) => m.type === "initialize");
    expect(initializes).toHaveLength(1);
    client.dispose();
  });

  it("rejects when the worker returns an error for the embed request", async () => {
    const { client } = makeClient((msg) => {
      if (msg.type === "initialize") {
        return {
          type: "ready",
          requestId: msg.requestId,
          modelId: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
          dimensions: 384,
        };
      }
      return {
        type: "error",
        requestId: msg.requestId,
        error: "model load failed",
      };
    });

    await expect(
      client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["a"])
    ).rejects.toThrow("model load failed");

    client.dispose();
  });

  it("rejects on timeout when the worker never responds", async () => {
    const { client } = makeClient(() => undefined, 30);

    await expect(
      client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["a"])
    ).rejects.toThrow("timeout");

    client.dispose();
  });

  it("rejects pending requests when the worker exits mid-request", async () => {
    // Answer initialize only — embed-batch stays pending so we can crash it.
    const initOnlyResponder: Responder = (msg) => {
      if (msg.type === "initialize") {
        return {
          type: "ready",
          requestId: msg.requestId,
          modelId: LOCAL_XENOVA_ALL_MINILM_MODEL_ID,
          dimensions: 384,
        };
      }
      return undefined;
    };
    const worker = new FakeWorker(initOnlyResponder);
    const fork: ForkFn = () => worker as unknown as UtilityProcessLike;
    const client = LocalEmbeddingWorkerClient.createWithFork(fork, 5000);

    const pending = client.embedBatch(LOCAL_XENOVA_ALL_MINILM_MODEL_ID, ["a"]);
    // Let microtasks flush so embed-batch is posted and registered as pending.
    await new Promise((resolve) => setTimeout(resolve, 5));
    worker.emitExit(1);

    await expect(pending).rejects.toThrow("unavailable");
    client.dispose();
  });
});
