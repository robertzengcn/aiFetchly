import { describe, expect, test } from "vitest";
import { LocalAiRuntimeOperationCoordinator } from "@/service/localAiRuntime/LocalAiRuntimeOperationCoordinator";
import { LocalAiRuntimeError } from "@/entityTypes/localAiRuntimeTypes";

const OP_A = "11111111-2222-3333-4444-555555555555";
const OP_B = "22222222-3333-4444-5555-666666666666";

describe("LocalAiRuntimeOperationCoordinator operations", () => {
  test("acquire then get returns the lease", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    const lease = c.acquire("voice-sherpa", OP_A);
    expect(lease.operationId).toBe(OP_A);
    expect(c.get("voice-sherpa")?.operationId).toBe(OP_A);
  });

  test("second acquire for same runtime throws runtime_busy", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    c.acquire("voice-sherpa", OP_A);
    try {
      c.acquire("voice-sherpa", OP_B);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalAiRuntimeError);
      expect((error as LocalAiRuntimeError).code).toBe("runtime_busy");
      expect((error as LocalAiRuntimeError).recoverable).toBe(true);
    }
  });

  test("voice and embedding may run concurrently", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    c.acquire("voice-sherpa", OP_A);
    expect(() => c.acquire("embedding-xenova", OP_B)).not.toThrow();
  });

  test("cancel aborts the controller and reports true only when found", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    const lease = c.acquire("voice-sherpa", OP_A);
    expect(c.cancel(OP_A)).toBe(true);
    expect(lease.controller.signal.aborted).toBe(true);
    expect(c.cancel(OP_B)).toBe(false);
  });

  test("release frees the lock for reuse", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    c.acquire("voice-sherpa", OP_A);
    c.release(OP_A);
    expect(c.get("voice-sherpa")).toBeNull();
    expect(() => c.acquire("voice-sherpa", OP_B)).not.toThrow();
  });

  test("release is idempotent for unknown ids", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    expect(() => c.release(OP_A)).not.toThrow();
  });
});

describe("LocalAiRuntimeOperationCoordinator version leases", () => {
  test("acquire/release/isVersionLeased", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    expect(c.isVersionLeased("voice-sherpa", "1.0.0")).toBe(false);
    c.acquireVersionLease("voice-sherpa", "1.0.0");
    expect(c.isVersionLeased("voice-sherpa", "1.0.0")).toBe(true);
    c.releaseVersionLease("voice-sherpa", "1.0.0");
    expect(c.isVersionLeased("voice-sherpa", "1.0.0")).toBe(false);
  });

  test("version lease is scoped per runtime+version", () => {
    const c = new LocalAiRuntimeOperationCoordinator();
    c.acquireVersionLease("voice-sherpa", "1.0.0");
    expect(c.isVersionLeased("voice-sherpa", "1.0.0")).toBe(true);
    expect(c.isVersionLeased("voice-sherpa", "2.0.0")).toBe(false);
    expect(c.isVersionLeased("embedding-xenova", "1.0.0")).toBe(false);
  });
});
