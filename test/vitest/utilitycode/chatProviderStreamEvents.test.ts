// test/vitest/utilitycode/chatProviderStreamEvents.test.ts
//
// Stage B1 (generator-streaming PRD FR-001, design §5.1/§7): the provider
// streamEvents iterator — native parsing, [DONE] termination, causal
// retry/recovery order through the callback facade, early-consumer-close
// cleanup, and abort behavior.
import { describe, it, expect } from "vitest";
import { OpenAIStreamParser } from "@/service/aiProvider/OpenAIStreamParser";
import { OpenAICompatibleProviderClient } from "@/service/aiProvider/OpenAICompatibleProviderClient";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const CONFIG: LocalAIProviderConfig = {
  preset: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  defaultModel: "llama3.1",
  apiKeyConfigured: false,
};

describe("OpenAIStreamParser.parseBodyStream (native iteration, FR-001)", () => {
  it("yields chunks across split frames and fragmented payloads", async () => {
    const parser = new OpenAIStreamParser();
    const response = sseResponse([
      'data: {"choices":[{"index":0,"delta":{"content":"Hel',
      'lo"}}]}\n\ndata: {"choices":[{"index":0,"delta":{"content":"!"}}],',
      '"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
      "data: [DONE]\n\n",
    ]);
    const chunks = [];
    for await (const chunk of parser.parseBodyStream(response)) {
      chunks.push(chunk);
    }
    // Frame 1+2 reassemble into "Hello"; frame 3 carries "!" plus usage.
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0]?.delta.content).toBe("Hello");
    expect(chunks[1].choices[0]?.delta.content).toBe("!");
    expect(chunks[1].usage?.total_tokens).toBe(3);
  });

  it("[DONE] terminates the stream — later buffered payload never becomes output", async () => {
    const parser = new OpenAIStreamParser();
    const response = sseResponse([
      'data: {"choices":[{"index":0,"delta":{"content":"a"}}]}\n\n',
      "data: [DONE]\n\n",
      'data: {"choices":[{"index":0,"delta":{"content":"LATE"}}]}\n\n',
    ]);
    const chunks = [];
    for await (const chunk of parser.parseBodyStream(response)) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
  });

  it("ignores keepalive comments, event lines, and blank separators", async () => {
    const parser = new OpenAIStreamParser();
    const response = sseResponse([
      ": OPENROUTER PROCESSING\n\n",
      "event: message\n",
      'data: {"choices":[{"index":0,"delta":{"content":"x"}}]}\n\n',
    ]);
    const chunks = [];
    for await (const chunk of parser.parseBodyStream(response)) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0]?.delta.content).toBe("x");
  });

  it("rejects promptly when the signal is already aborted", async () => {
    const parser = new OpenAIStreamParser();
    const controller = new AbortController();
    controller.abort();
    await expect(
      parser.parseBodyStream(sseResponse(["data: [DONE]\n\n"]), controller.signal)
        .next()
    ).rejects.toThrow(/abort/i);
  });

  it("early consumer close cancels the body reader", async () => {
    const parser = new OpenAIStreamParser();
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"a"}}]}\n\n')
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"b"}}]}\n\n')
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const iterator = parser.parseBodyStream(new Response(stream));
    const first = await iterator.next();
    expect(first.done).toBe(false);
    await iterator.return(undefined as never);
    expect(cancelled).toBe(true);
  });
});

describe("OpenAICompatibleProviderClient.streamEvents (FR-001)", () => {
  it("streams chunk events natively and the callback facade drains identically", async () => {
    const encoder = new TextEncoder();
    const bodyData =
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    // Fresh Response per invocation — a body can only be consumed once.
    const fetchImpl = ((): typeof fetch =>
      ((_url: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(encoder.encode(bodyData));
                controller.close();
              },
            }),
            { status: 200 }
          )
        )) as unknown as typeof fetch)();
    const client = new OpenAICompatibleProviderClient(CONFIG, "", fetchImpl);

    const events = [];
    for await (const event of client.streamEvents({
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("chunk");
    if (events[0].type === "chunk") {
      expect(events[0].chunk.choices[0]?.delta.content).toBe("hi");
    }

    // The deprecated callback facade consumes the same implementation.
    const chunks: string[] = [];
    await client.stream(
      { messages: [{ role: "user", content: "hello" }] },
      (chunk) => {
        chunks.push(chunk.choices[0]?.delta.content ?? "");
      }
    );
    expect(chunks).toEqual(["hi"]);
  });
});

describe("TODO-03: caller abort stays connected through body reads", () => {
  it("aborting mid-read aborts the fetch transport signal (pending read cancelled by fetch)", async () => {
    const encoder = new TextEncoder();
    const callerController = new AbortController();
    let transportSignal: AbortSignal | undefined;
    let streamCancelReason: unknown = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"index":0,"delta":{"content":"a"}}]}\n\n'
          )
        );
      },
      cancel(reason) {
        streamCancelReason = reason;
      },
    });
    const fetchImpl = ((): typeof fetch =>
      ((_url: string | URL | Request, init?: RequestInit) => {
        transportSignal = init?.signal as AbortSignal;
        return Promise.resolve(new Response(stream, { status: 200 }));
      }) as unknown as typeof fetch)();
    const client = new OpenAICompatibleProviderClient(CONFIG, "", fetchImpl);

    const iterator = client
      .streamEvents(
        { messages: [{ role: "user", content: "hello" }] },
        { signal: callerController.signal }
      )
      [Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);

    // OLD BEHAVIOR: the listener was removed when headers arrived, so this
    // abort never reached the transport. TODO-03: it must.
    callerController.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(transportSignal?.aborted).toBe(true);

    // NOTE: .return() while suspended mid-read cannot run the parser's
    // finally until the read settles (design §6: abort FIRST, then close) —
    // the transport abort above is the client's cancellation surface here.
    void streamCancelReason;
  });
});
