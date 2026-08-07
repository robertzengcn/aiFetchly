import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  AIChatConversationTurnCoordinator,
  ConversationTurnBusyError,
} from "@/service/AIChatConversationTurnCoordinator";

let coordinator: AIChatConversationTurnCoordinator;

beforeEach(() => {
  coordinator = AIChatConversationTurnCoordinator.getInstance();
  coordinator.resetForTesting();
  vi.useRealTimers();
});

describe("AIChatConversationTurnCoordinator - mutual exclusion", () => {
  it("grants the first lease and denies a concurrent same-conversation lease", () => {
    const lease = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    expect(lease).not.toBeNull();
    const second = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "scheduled",
      ownerId: "s1",
    });
    expect(second).toBeNull();
  });

  it("allows different conversations concurrently", () => {
    const a = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    const b = coordinator.tryAcquire({
      conversationId: "v2-b",
      owner: "scheduled",
      ownerId: "s1",
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(coordinator.isBusy("v2-a")).toBe(true);
    expect(coordinator.isBusy("v2-b")).toBe(true);
  });

  it("release is idempotent and frees the conversation", () => {
    const lease = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    expect(lease).not.toBeNull();
    lease!.release();
    lease!.release(); // idempotent
    expect(coordinator.isBusy("v2-a")).toBe(false);
  });
});

describe("AIChatConversationTurnCoordinator - acquire with wait", () => {
  it("rejects immediately with waitMs 0 when busy", async () => {
    coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    await expect(
      coordinator.acquire({
        conversationId: "v2-a",
        owner: "scheduled",
        ownerId: "s1",
        waitMs: 0,
      })
    ).rejects.toBeInstanceOf(ConversationTurnBusyError);
  });

  it("resolves once the active lease is released (FIFO)", async () => {
    const first = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    const pending = coordinator
      .acquire({
        conversationId: "v2-a",
        owner: "scheduled",
        ownerId: "s1",
        waitMs: 5000,
      })
      .then((lease) => lease.ownerId);
    // Not yet acquired.
    expect(coordinator.isBusy("v2-a")).toBe(true);
    first!.release();
    await expect(pending).resolves.toBe("s1");
  });

  it("grants interactive waiters before scheduled waiters", async () => {
    const first = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "holder",
    });
    const scheduled = coordinator
      .acquire({
        conversationId: "v2-a",
        owner: "scheduled",
        ownerId: "sched",
        waitMs: 5000,
      })
      .then((l) => l.ownerId);
    const interactive = coordinator
      .acquire({
        conversationId: "v2-a",
        owner: "interactive",
        ownerId: "inter",
        waitMs: 5000,
      })
      .then((l) => l.ownerId);
    first!.release();
    // interactive waiter should be granted before the scheduled waiter.
    await expect(interactive).resolves.toBe("inter");
    // The scheduled waiter is still pending until the interactive lease releases.
    const granted = await coordinator.acquire({
      conversationId: "v2-a",
      owner: "scheduled",
      ownerId: "sched2",
      waitMs: 0,
    }).catch(() => null);
    expect(granted).toBeNull();
  });

  it("rejects with ConversationTurnBusyError on timeout", async () => {
    coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    await expect(
      coordinator.acquire({
        conversationId: "v2-a",
        owner: "scheduled",
        ownerId: "s1",
        waitMs: 20,
      })
    ).rejects.toBeInstanceOf(ConversationTurnBusyError);
  });

  it("removes a waiter immediately when its abort signal fires", async () => {
    coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "interactive",
      ownerId: "i1",
    });
    const controller = new AbortController();
    const pending = coordinator.acquire({
      conversationId: "v2-a",
      owner: "scheduled",
      ownerId: "s1",
      waitMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ConversationTurnBusyError);
    // After abort, a fresh acquire that releases + retries can succeed.
    const newLease = coordinator.tryAcquire({
      conversationId: "v2-a",
      owner: "scheduled",
      ownerId: "s2",
    });
    expect(newLease).toBeNull();
  });
});
