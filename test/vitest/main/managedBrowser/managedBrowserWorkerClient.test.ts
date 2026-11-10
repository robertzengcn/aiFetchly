import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ManagedBrowserWorkerClient,
  type UtilityProcessLike,
} from "@/service/ManagedBrowserWorkerClient";
import type { NormalizedCookie } from "@/schemas/accountCookies";
import type { ManagedBrowserOutboundMessage } from "@/schemas/worker/managedBrowser";

/**
 * Worker-client unit tests against a fake utility process. The client's
 * outbound schema gate is real — every simulated worker message must be
 * protocol-valid or it is dropped.
 */

class FakeUtilityProcess {
  public posted: unknown[] = [];
  public killed = false;
  private readonly listeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();

  public postMessage(message: unknown): void {
    this.posted.push(message);
  }

  public kill(): boolean {
    this.killed = true;
    this.emitCompat("exit", 0);
    return true;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Test helper: simulate an inbound worker message. */
  public emitMessage(message: ManagedBrowserOutboundMessage | unknown): void {
    this.emitCompat("message", JSON.stringify(message));
  }

  public emitExit(code: number | null): void {
    this.emitCompat("exit", code);
  }

  private emitCompat(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

function baseOutbound(
  type: string,
  sessionId: string,
  sequence: number
): Record<string, unknown> {
  return {
    protocolVersion: 1,
    sessionId,
    requestId: "evt-test-1",
    sequence,
    type,
  };
}

const SESSION_ID = "mb_client0001";

function makeClient(proc: FakeUtilityProcess) {
  const events: ManagedBrowserOutboundMessage[] = [];
  const refreshed: NormalizedCookie[][] = [];
  const exits: string[] = [];
  const client = new ManagedBrowserWorkerClient({
    sessionId: SESSION_ID,
    sessionNonce: "nonce-123456",
    onEvent: (message) => events.push(message),
    onRefreshedCookies: (cookies) => refreshed.push(cookies),
    onExited: (detail) => exits.push(detail),
    fork: () => proc as unknown as UtilityProcessLike,
    resolveEntryPath: () => "/fake/ManagedBrowser.js",
  });
  return { client, events, refreshed, exits };
}

/** Fork + handshake: start() FIRST (attaches listeners), then reply. */
async function startClient(
  proc: FakeUtilityProcess,
  client: ManagedBrowserWorkerClient
): Promise<void> {
  const started = client.start();
  await vi.advanceTimersByTimeAsync(1);
  proc.emitMessage({
    ...baseOutbound("WORKER_READY", SESSION_ID, 1),
    workerPid: 1234,
  });
  await started;
}

describe("ManagedBrowserWorkerClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts once WORKER_READY arrives (FR-RUNTIME-002)", async () => {
    const proc = new FakeUtilityProcess();
    const { client } = makeClient(proc);
    const started = client.start();
    // Fork happened; simulate the worker boot message.
    await vi.advanceTimersByTimeAsync(1);
    proc.emitMessage({
      ...baseOutbound("WORKER_READY", SESSION_ID, 1),
      workerPid: 1234,
    });
    await expect(started).resolves.toBeUndefined();
    // The client sent nothing to prompt WORKER_READY — it is unsolicited.
    expect(proc.posted).toHaveLength(0);
  });

  it("fails the start after the ready deadline and cleans up", async () => {
    const proc = new FakeUtilityProcess();
    const { client, exits } = makeClient(proc);
    const started = client.start();
    const assertion = expect(started).rejects.toThrow("worker_event_timeout");
    await vi.advanceTimersByTimeAsync(10_500);
    await assertion;
    expect(proc.killed).toBe(true);
    expect(exits).toEqual(["worker_start_timeout"]);
  });

  it("correlates a request with its schema-valid reply", async () => {
    const proc = new FakeUtilityProcess();
    const { client } = makeClient(proc);
    await startClient(proc, client);

    const reply = client.request(
      { type: "OBSERVE" },
      10_000,
      (m) => m.type === "OBSERVATION_RESULT"
    );
    await vi.advanceTimersByTimeAsync(1);
    const sent = JSON.parse(proc.posted[0] as string) as {
      requestId: string;
    };
    proc.emitMessage({
      ...baseOutbound("OBSERVATION_RESULT", SESSION_ID, 2),
      requestId: sent.requestId,
      observation: validObservation(),
    });
    const message = await reply;
    expect(message.type).toBe("OBSERVATION_RESULT");
  });

  it("rejects the request on a correlated WORKER_ERROR", async () => {
    const proc = new FakeUtilityProcess();
    const { client } = makeClient(proc);
    await startClient(proc, client);

    const reply = client.request(
      { type: "OBSERVE" },
      10_000,
      (m) => m.type === "OBSERVATION_RESULT"
    );
    await vi.advanceTimersByTimeAsync(1);
    const sent = JSON.parse(proc.posted[0] as string) as { requestId: string };
    proc.emitMessage({
      ...baseOutbound("WORKER_ERROR", SESSION_ID, 2),
      requestId: sent.requestId,
      code: "internal_error",
      message: "boom",
    });
    await expect(reply).rejects.toThrow("internal_error");
  });

  it("routes REFRESHED_COOKIES privately — never to the event sink", async () => {
    const proc = new FakeUtilityProcess();
    const { client, events, refreshed } = makeClient(proc);
    await startClient(proc, client);
    proc.emitMessage({
      ...baseOutbound("REFRESHED_COOKIES", SESSION_ID, 2),
      cookies: [
        {
          domain: "youtube.com",
          path: "/",
          name: "SID",
          value: "synthetic",
          secure: true,
          httpOnly: true,
        },
      ],
    });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it("tracks heartbeats for the supervisor", async () => {
    const proc = new FakeUtilityProcess();
    const { client } = makeClient(proc);
    await startClient(proc, client);
    const before = client.lastHeartbeatTime;
    proc.emitMessage({
      ...baseOutbound("WORKER_HEARTBEAT", SESSION_ID, 2),
      state: "running",
      lagBucket: "low",
      ts: 123,
    });
    expect(client.lastHeartbeatTime).toBeGreaterThanOrEqual(before);
    expect(client.lastHeartbeatTime).toBeGreaterThan(0);
  });

  it("drops a foreign-session message (fail closed)", async () => {
    const proc = new FakeUtilityProcess();
    const { client, events } = makeClient(proc);
    await startClient(proc, client);
    proc.emitMessage({
      ...baseOutbound("WORKER_HEARTBEAT", "mb_other-session", 2),
      state: "running",
      lagBucket: "low",
      ts: 1,
    });
    expect(events).toHaveLength(0);
  });

  it("three malformed messages stop the session as a protocol violation", async () => {
    const proc = new FakeUtilityProcess();
    const { client, exits } = makeClient(proc);
    await startClient(proc, client);
    proc.emitMessage({ garbage: true });
    proc.emitMessage(42);
    proc.emitMessage({ protocolVersion: 99 });
    await vi.advanceTimersByTimeAsync(1);
    expect(proc.killed).toBe(true);
    expect(exits).toContain("worker_protocol_violation");
  });

  it("stop() completes on SESSION_STOPPED and fires onExited once", async () => {
    const proc = new FakeUtilityProcess();
    const { client, exits } = makeClient(proc);
    await startClient(proc, client);

    const stopping = client.stop("user_stop");
    await vi.advanceTimersByTimeAsync(1);
    const sent = JSON.parse(proc.posted[0] as string) as {
      requestId: string;
      type: string;
    };
    expect(sent.type).toBe("STOP_SESSION");
    proc.emitMessage({
      ...baseOutbound("SESSION_STOPPED", SESSION_ID, 2),
      requestId: sent.requestId,
      terminalState: "completed",
      reasonCode: "user_stop",
    });
    const cause = await stopping;
    expect(cause).toBe("user_stop");
    expect(exits).toHaveLength(1);
  });

  it("unexpected worker exit rejects pending work and notifies once", async () => {
    const proc = new FakeUtilityProcess();
    const { client, exits } = makeClient(proc);
    await startClient(proc, client);

    const reply = client.request(
      { type: "OBSERVE" },
      10_000,
      (m) => m.type === "OBSERVATION_RESULT"
    );
    proc.emitExit(1);
    await expect(reply).rejects.toThrow("worker_exited");
    expect(exits).toEqual(["exit:1"]);
    // Idempotent: a second exit event does not re-notify.
    proc.emitExit(1);
    expect(exits).toHaveLength(1);
  });
});

function validObservation(): Record<string, unknown> {
  return {
    sessionId: SESSION_ID,
    pageRevision: 1,
    url: "https://www.youtube.com/watch",
    origin: "https://www.youtube.com",
    title: "T",
    state: "ready",
    elements: [],
    visibleText: "",
    notices: [{ code: "untrusted_content" }],
    truncated: false,
  };
}
