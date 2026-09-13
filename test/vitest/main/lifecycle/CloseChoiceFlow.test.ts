import { describe, expect, it } from "vitest";
import { ApplicationLifecycleService } from "@/main-process/lifecycle/ApplicationLifecycleService";
import { CloseChoiceFlow } from "@/main-process/lifecycle/CloseChoiceFlow";
import type { CloseChoiceFlowPorts } from "@/main-process/lifecycle/CloseChoiceFlow";

/**
 * CloseChoiceFlow tests (design §9, PRD FR-01/AC-01/AC-08): renderer-first
 * dialog, ack-timeout native fallback, single-active-surface, stale-token
 * rejection, and no-stacking on repeated closes.
 */

type NativeChoice = "hide" | "exit" | "cancel";

function makeHarness(
  options: {
    ackTimeoutMs?: number;
    backgroundAvailable?: boolean;
    nativeChoice?: NativeChoice;
    nativeThrows?: boolean;
  } = {}
): {
  lifecycle: ApplicationLifecycleService;
  flow: CloseChoiceFlow;
  requests: Array<{ token: string; backgroundAvailable: boolean }>;
  nativeCalls: number;
  hideCalls: number;
  fireAckTimeout: () => void;
} {
  const {
    ackTimeoutMs = 2_000,
    backgroundAvailable = true,
    nativeChoice = "cancel",
    nativeThrows = false,
  } = options;

  const lifecycle = new ApplicationLifecycleService();
  lifecycle.setBackgroundAvailable(backgroundAvailable);

  const requests: Array<{ token: string; backgroundAvailable: boolean }> = [];
  const timers: Array<() => void> = [];
  const counters = { native: 0, hide: 0 };

  const ports: CloseChoiceFlowPorts = {
    sendRendererRequest: (token, available) => {
      requests.push({ token, backgroundAvailable: available });
    },
    showNativeFallback: async () => {
      counters.native += 1;
      if (nativeThrows) throw new Error("dialog unavailable");
      return nativeChoice;
    },
    hideWindow: () => {
      counters.hide += 1;
    },
    ackTimeoutMs,
    setTimeoutFn: ((fn: () => void) => {
      timers.push(fn);
      return timers.length;
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as unknown as typeof clearTimeout,
  };

  return {
    lifecycle,
    flow: new CloseChoiceFlow(lifecycle, ports),
    requests,
    get nativeCalls(): number {
      return counters.native;
    },
    get hideCalls(): number {
      return counters.hide;
    },
    fireAckTimeout: () => {
      for (const timer of timers.splice(0)) timer();
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("CloseChoiceFlow — renderer path", () => {
  it("sends one request per close and never stacks (AC-08)", () => {
    const h = makeHarness();
    h.flow.begin();
    h.flow.begin();
    h.flow.begin();
    expect(h.requests).toHaveLength(1);
    expect(h.flow.isActive()).toBe(true);
  });

  it("acknowledging cancels the native fallback", async () => {
    const h = makeHarness();
    h.flow.begin();
    const token = h.requests[0]!.token;
    expect(h.flow.acknowledge(token)).toBe(true);
    h.fireAckTimeout();
    await flush();
    expect(h.nativeCalls).toBe(0);
  });

  it("hide hides via the injected port and flips the state", () => {
    const h = makeHarness();
    h.flow.begin();
    const token = h.requests[0]!.token;
    h.flow.acknowledge(token);
    h.flow.submit(token, "hide");
    expect(h.hideCalls).toBe(1);
    expect(h.lifecycle.getState()).toBe("hidden");
    expect(h.flow.isActive()).toBe(false);
  });

  it("exit flips to quitting synchronously and hides nothing", () => {
    const h = makeHarness();
    h.flow.begin();
    const token = h.requests[0]!.token;
    h.flow.submit(token, "exit");
    expect(h.lifecycle.getState()).toBe("quitting");
    expect(h.hideCalls).toBe(0);
  });

  it("cancel keeps the window open", () => {
    const h = makeHarness();
    h.flow.begin();
    const token = h.requests[0]!.token;
    h.flow.submit(token, "cancel");
    expect(h.lifecycle.getState()).toBe("visible");
    expect(h.flow.isActive()).toBe(false);
  });

  it("a stale (already-consumed) token submission is ignored", () => {
    const h = makeHarness();
    h.flow.begin();
    const token = h.requests[0]!.token;
    h.flow.submit(token, "cancel");
    // Replay the same token with a different choice.
    h.flow.submit(token, "exit");
    expect(h.lifecycle.getState()).toBe("visible");
  });

  it("begin is a no-op while quitting", () => {
    const h = makeHarness();
    h.lifecycle.requestExit("tray");
    h.flow.begin();
    expect(h.requests).toHaveLength(0);
  });

  it("the request reports current background availability", () => {
    const h = makeHarness({ backgroundAvailable: false });
    h.flow.begin();
    expect(h.requests[0]!.backgroundAvailable).toBe(false);
  });
});

describe("CloseChoiceFlow — native fallback (design §9)", () => {
  it("shows the native dialog when the renderer never acks", async () => {
    const h = makeHarness();
    h.flow.begin();
    h.fireAckTimeout();
    await flush();
    expect(h.nativeCalls).toBe(1);
  });

  it("a renderer ack arriving before the timer prevents the fallback", async () => {
    const h = makeHarness();
    h.flow.begin();
    h.flow.acknowledge(h.requests[0]!.token);
    h.fireAckTimeout();
    await flush();
    expect(h.nativeCalls).toBe(0);
  });

  it("native cancel keeps the window open", async () => {
    const h = makeHarness({ nativeChoice: "cancel" });
    h.flow.begin();
    h.fireAckTimeout();
    await flush();
    expect(h.lifecycle.getState()).toBe("visible");
    expect(h.flow.isActive()).toBe(false);
  });

  it("native hide hides the window", async () => {
    const h = makeHarness({ nativeChoice: "hide" });
    h.flow.begin();
    h.fireAckTimeout();
    await flush();
    expect(h.lifecycle.getState()).toBe("hidden");
    expect(h.hideCalls).toBe(1);
  });

  it("native exit starts the coordinated quit", async () => {
    const h = makeHarness({ nativeChoice: "exit" });
    h.flow.begin();
    h.fireAckTimeout();
    await flush();
    expect(h.lifecycle.getState()).toBe("quitting");
  });

  it("a throwing native dialog resolves to cancel semantics", async () => {
    const h = makeHarness({ nativeThrows: true });
    h.flow.begin();
    h.fireAckTimeout();
    await flush();
    expect(h.lifecycle.getState()).toBe("visible");
    expect(h.flow.isActive()).toBe(false);
  });

  it("a stale renderer answer after the native choice is ignored", async () => {
    const h = makeHarness({ nativeChoice: "cancel" });
    h.flow.begin();
    const token = h.requests[0]!.token;
    h.fireAckTimeout();
    await flush(); // native cancel consumed the token
    h.flow.submit(token, "hide");
    expect(h.lifecycle.getState()).toBe("visible");
    expect(h.hideCalls).toBe(0);
  });
});
