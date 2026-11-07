import { describe, expect, it } from "vitest";
import type { ChatV2RuntimeStatus } from "@/entityTypes/aiChatV2Types";
import {
  scheduledAwareLiveRuntime,
  type ScheduledEngineRegistryProbe,
} from "@/service/aiChatWorkspaceRuntime";

/**
 * Bugfix 2026-11-02 — a selected conversation whose scheduled occurrence is
 * mid-run hydrated `runtimeStatus: "idle"` and never showed the running
 * flag/Stop affordance at the bottom of the chat:
 *
 *   1. Scheduled turns bypass `AIChatCoordinator`, so the coordinator's live
 *      lookup returns null.
 *   2. Scheduled turns run in a DEDICATED engine instance registered in
 *      `ScheduledLoopEngineRegistry`, while `getQueryEngine()` is the
 *      interactive singleton — its per-conversation status stays idle.
 *   3. The durable workspace run envelope only exists for owner-adapter runs
 *      (chat-bound loops); the legacy scheduled-task path creates none.
 *
 * The composite lookup adds the missing fourth source: the in-memory
 * scheduled engine registry keyed by conversationId, whose engine owns the
 * authoritative per-turn status (running / awaiting_permission /
 * awaiting_user). Coordinator state always wins; the probe only fills the
 * coordinator's blind spot.
 */

interface FakeEntry {
  engine: {
    getConversationRuntimeStatus(conversationId: string): ChatV2RuntimeStatus;
  };
  runId: number;
}

/** Structural fake of `ScheduledLoopEngineRegistry.getByConversation`. */
function probeWith(
  entries: Record<string, FakeEntry | undefined>
): ScheduledEngineRegistryProbe {
  return {
    getByConversation: (conversationId: string) => entries[conversationId],
  };
}

function fakeEngine(status: ChatV2RuntimeStatus): FakeEntry["engine"] {
  return {
    getConversationRuntimeStatus: () => status,
  };
}

describe("scheduledAwareLiveRuntime (scheduled-occurrence runtime projection)", () => {
  it("a mid-run scheduled conversation surfaces running with a namespaced active run id", () => {
    const lookup = scheduledAwareLiveRuntime(
      (conversationId) => {
        expect(conversationId).toBe("v2-sched");
        return null; // coordinator blind spot
      },
      probeWith({
        "v2-sched": { engine: fakeEngine("running"), runId: 42 },
      })
    );

    expect(lookup("v2-sched")).toEqual({
      runtimeStatus: "running",
      activeRunId: "scheduled-42",
    });
  });

  it("a permission-parked scheduled conversation surfaces awaiting_permission", () => {
    const lookup = scheduledAwareLiveRuntime(
      () => null,
      probeWith({
        "v2-sched": {
          engine: fakeEngine("awaiting_permission"),
          runId: 43,
        },
      })
    );

    expect(lookup("v2-sched")).toEqual({
      runtimeStatus: "awaiting_permission",
      activeRunId: "scheduled-43",
    });
  });

  it("an interactive live run wins over the scheduled probe", () => {
    const lookup = scheduledAwareLiveRuntime(
      (conversationId) =>
        conversationId === "v2-live"
          ? { runtimeStatus: "awaiting_user", activeRunId: "run-live" }
          : null,
      probeWith({
        "v2-live": { engine: fakeEngine("running"), runId: 99 },
      })
    );

    expect(lookup("v2-live")).toEqual({
      runtimeStatus: "awaiting_user",
      activeRunId: "run-live",
    });
  });

  it("no registry entry falls through to null so durable/idle truth applies", () => {
    const lookup = scheduledAwareLiveRuntime(
      () => null,
      probeWith({ "v2-sched": undefined })
    );

    expect(lookup("v2-sched")).toBeNull();
    expect(lookup("v2-other")).toBeNull();
  });

  it("a registered engine that reports idle falls through (turn not dispatched yet)", () => {
    const lookup = scheduledAwareLiveRuntime(
      () => null,
      probeWith({
        "v2-sched": { engine: fakeEngine("idle"), runId: 7 },
      })
    );

    // The occurrence registered before the turn dispatched — the projection
    // must not claim a running state for a conversation whose scheduled
    // engine itself reports idle.
    expect(lookup("v2-sched")).toBeNull();
  });

  it("the scheduled probe composes with other conversations without interference", () => {
    const lookup = scheduledAwareLiveRuntime(
      () => null,
      probeWith({
        "v2-a": { engine: fakeEngine("running"), runId: 1 },
        "v2-b": undefined,
      })
    );

    expect(lookup("v2-a")?.runtimeStatus).toBe("running");
    expect(lookup("v2-b")).toBeNull();
  });
});
