import { describe, it, expect, afterEach, vi } from "vitest";
import {
  PersistentHookAuditLogger,
  ConsoleHookAuditLogger,
  getHookAuditLogger,
  setHookAuditLogger,
  setHookAuditLoggerForTests,
} from "@/service/hooks/HookAuditService";
import type { HookAuditEntry } from "@/entityTypes/hookTypes";

function makeEntry(overrides: Partial<HookAuditEntry> = {}): HookAuditEntry {
  return {
    hookRunId: "run-1",
    hookId: "h-1",
    eventName: "PreToolUse",
    source: "user",
    type: "command",
    status: "success",
    durationMs: 10,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("PersistentHookAuditLogger", () => {
  it("does not call recordEntry when module is unset", () => {
    // Fresh logger with no module attached
    const logger = PersistentHookAuditLogger;
    logger.setModule(
      undefined as unknown as import("@/modules/HookAuditModule").HookAuditModule
    ); // explicit unset
    // Should only call ConsoleHookAuditLogger.log, not throw
    expect(() => logger.log(makeEntry())).not.toThrow();
  });

  it("calls console logger and module.recordEntry when module is set", async () => {
    const consoleSpy = vi.spyOn(ConsoleHookAuditLogger, "log");
    const recordEntry = vi.fn().mockResolvedValue(undefined);
    // Use a minimal stand-in for HookAuditModule — only `recordEntry` is called.
    const fakeModule = {
      recordEntry,
    } as unknown as import("@/modules/HookAuditModule").HookAuditModule;

    PersistentHookAuditLogger.setModule(fakeModule);
    PersistentHookAuditLogger.log(makeEntry({ hookId: "sync-test" }));

    // Synchronous: console log happens immediately
    expect(consoleSpy).toHaveBeenCalled();
    // Async: recordEntry is called fire-and-forget — await a microtask
    await Promise.resolve();
    await Promise.resolve();
    expect(recordEntry).toHaveBeenCalledWith(
      expect.objectContaining({ hookId: "sync-test" })
    );

    consoleSpy.mockRestore();
  });

  it("swallows errors from recordEntry (fire-and-forget)", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const recordEntry = vi.fn().mockRejectedValue(new Error("db down"));
    const fakeModule = {
      recordEntry,
    } as unknown as import("@/modules/HookAuditModule").HookAuditModule;

    PersistentHookAuditLogger.setModule(fakeModule);
    // Must not throw synchronously
    expect(() => PersistentHookAuditLogger.log(makeEntry())).not.toThrow();

    // Let the promise settle
    await new Promise((r) => setTimeout(r, 10));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("setHookAuditLogger / getHookAuditLogger", () => {
  afterEach(() => {
    // Restore default
    setHookAuditLoggerForTests(ConsoleHookAuditLogger);
  });

  it("setHookAuditLogger swaps the active logger and getHookAuditLogger returns it", () => {
    const custom = { log: () => undefined };
    setHookAuditLogger(custom);
    expect(getHookAuditLogger()).toBe(custom);
  });
});
