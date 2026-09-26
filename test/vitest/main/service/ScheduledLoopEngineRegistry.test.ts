import { describe, expect, it, beforeEach, vi } from "vitest";
import { ScheduledLoopEngineRegistry } from "@/service/ScheduledLoopEngineRegistry";

describe("ScheduledLoopEngineRegistry", () => {
  beforeEach(() => {
    ScheduledLoopEngineRegistry.getInstance().clear();
  });

  it("registers and looks up an engine by conversationId", () => {
    const engine = {
      resumeToolAfterPermission: vi.fn(),
      denyToolPermission: vi.fn(),
    } as never;
    const registry = ScheduledLoopEngineRegistry.getInstance();
    registry.register({
      conversationId: "v2-a",
      engine,
      runId: 10,
      scheduleId: 2,
    });
    const entry = registry.getByConversation("v2-a");
    expect(entry?.engine).toBe(engine);
    expect(entry?.runId).toBe(10);
    expect(entry?.scheduleId).toBe(2);
  });

  it("returns undefined for an unregistered conversation", () => {
    expect(
      ScheduledLoopEngineRegistry.getInstance().getByConversation("v2-z")
    ).toBeUndefined();
  });

  it("unregisters an engine", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const engine = {} as never;
    registry.register({
      conversationId: "v2-b",
      engine,
      runId: 1,
      scheduleId: 1,
    });
    registry.unregister("v2-b");
    expect(registry.getByConversation("v2-b")).toBeUndefined();
  });

  it("hasPendingPermission reports pending state set by the engine", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const engine = {} as never;
    registry.register({
      conversationId: "v2-c",
      engine,
      runId: 5,
      scheduleId: 3,
    });
    registry.setPendingPermission("v2-c", { toolId: "t1" });
    expect(registry.hasPendingPermission("v2-c", "t1")).toBe(true);
    expect(registry.hasPendingPermission("v2-c", "other")).toBe(false);
    registry.clearPendingPermission("v2-c");
    expect(registry.hasPendingPermission("v2-c", "t1")).toBe(false);
  });

  it("register clears the prior entry's backstop + pending metadata on overlap (defense-in-depth)", () => {
    // The conversation lease should prevent overlap, but a second register for
    // the same conversation must not silently orphan the prior 1h backstop or
    // leave stale pending metadata pointing at the old engine. It coalesces to
    // the newest occurrence.
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const priorBackstop = vi.fn();
    const priorEngine = {} as never;
    registry.register({
      conversationId: "v2-overlap",
      engine: priorEngine,
      runId: 1,
      scheduleId: 9,
      clearPermissionBackstop: priorBackstop,
    });
    registry.setPendingPermission("v2-overlap", { toolId: "old-tool" });

    const newEngine = {} as never;
    registry.register({
      conversationId: "v2-overlap",
      engine: newEngine,
      runId: 2,
      scheduleId: 9,
    });

    // Prior backstop was cleared so the orphaned timer can't fire.
    expect(priorBackstop).toHaveBeenCalledTimes(1);
    // New entry is the live one.
    const entry = registry.getByConversation("v2-overlap");
    expect(entry?.engine).toBe(newEngine);
    expect(entry?.runId).toBe(2);
    // Stale pending metadata was cleared — the old tool is no longer "pending".
    expect(registry.hasPendingPermission("v2-overlap", "old-tool")).toBe(false);
  });

  it("register without an existing entry is a clean no-op (no backstop call)", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const backstop = vi.fn();
    registry.register({
      conversationId: "v2-clean",
      engine: {} as never,
      runId: 1,
      scheduleId: 1,
      clearPermissionBackstop: backstop,
    });
    expect(backstop).not.toHaveBeenCalled();
  });
});
