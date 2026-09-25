import { describe, expect, it, beforeEach, vi } from "vitest";
import { ScheduledLoopEngineRegistry } from "@/service/ScheduledLoopEngineRegistry";

describe("ScheduledLoopEngineRegistry", () => {
  beforeEach(() => {
    ScheduledLoopEngineRegistry.getInstance().clear();
  });

  it("registers and looks up an engine by conversationId", () => {
    const engine = { resumeToolAfterPermission: vi.fn(), denyToolPermission: vi.fn() } as never;
    const registry = ScheduledLoopEngineRegistry.getInstance();
    registry.register({ conversationId: "v2-a", engine, runId: 10, scheduleId: 2 });
    const entry = registry.getByConversation("v2-a");
    expect(entry?.engine).toBe(engine);
    expect(entry?.runId).toBe(10);
    expect(entry?.scheduleId).toBe(2);
  });

  it("returns undefined for an unregistered conversation", () => {
    expect(ScheduledLoopEngineRegistry.getInstance().getByConversation("v2-z")).toBeUndefined();
  });

  it("unregisters an engine", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const engine = {} as never;
    registry.register({ conversationId: "v2-b", engine, runId: 1, scheduleId: 1 });
    registry.unregister("v2-b");
    expect(registry.getByConversation("v2-b")).toBeUndefined();
  });

  it("hasPendingPermission reports pending state set by the engine", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const engine = {} as never;
    registry.register({ conversationId: "v2-c", engine, runId: 5, scheduleId: 3 });
    registry.setPendingPermission("v2-c", { toolId: "t1" });
    expect(registry.hasPendingPermission("v2-c", "t1")).toBe(true);
    expect(registry.hasPendingPermission("v2-c", "other")).toBe(false);
    registry.clearPendingPermission("v2-c");
    expect(registry.hasPendingPermission("v2-c", "t1")).toBe(false);
  });
});
