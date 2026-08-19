import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock SqliteDb so we can assert getInstance is NOT called during construction.
const { mockGetInstance, mockEnsureInitialized } = vi.hoisted(() => ({
  mockGetInstance: vi.fn(),
  mockEnsureInitialized: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/SqliteDb", () => ({
  SqliteDb: {
    getInstance: mockGetInstance,
    ensureInitialized: mockEnsureInitialized,
  },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue("/tmp/test-db"),
  })),
}));

import { BaseModule } from "@/modules/baseModule";

/** Concrete subclass — BaseModule is abstract. */
class TestModule extends BaseModule {
  constructor() {
    super();
  }
}

describe("BaseModule lazy constructor (WS-5 R5.2)", () => {
  beforeEach(() => {
    mockGetInstance.mockClear();
    mockEnsureInitialized.mockClear();
  });

  it("constructor does NOT touch the DB singleton (SqliteDb.getInstance)", () => {
    new TestModule();
    expect(mockGetInstance).not.toHaveBeenCalled();
  });

  it("constructor resolves dbpath via Token (available immediately)", () => {
    const mod = new TestModule();
    // dbpath is set from the mocked Token getValue -> "/tmp/test-db"
    expect(mod).toHaveProperty("dbpath");
  });

  it("ensureConnection() calls SqliteDb.getInstance (deferred from constructor)", async () => {
    const mod = new TestModule();
    await mod.ensureConnection();
    expect(mockGetInstance).toHaveBeenCalledTimes(1);
    expect(mockEnsureInitialized).toHaveBeenCalledTimes(1);
  });

  it("ensureConnection() is idempotent (getInstance called once)", async () => {
    const mod = new TestModule();
    await mod.ensureConnection();
    await mod.ensureConnection();
    expect(mockGetInstance).toHaveBeenCalledTimes(1);
  });
});
