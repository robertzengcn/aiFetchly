import { describe, it, expect, afterEach } from "vitest";
import { BaseDb } from "@/model/Basedb";

/** Concrete subclass — BaseDb is abstract. */
class TestDb extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }
}

describe("BaseDb worker guard (WS-3 R3.3)", () => {
  afterEach(() => {
    delete process.env.WORKER_TYPE;
  });

  it("blocks construction from a worker process (WORKER_TYPE set)", () => {
    process.env.WORKER_TYPE = "contact-extraction";
    expect(() => new TestDb("/tmp/aifetchly-test")).toThrow(/worker process/);
  });

  it("allows construction from the main process (no WORKER_TYPE)", () => {
    delete process.env.WORKER_TYPE;
    expect(() => new TestDb("/tmp/aifetchly-test")).not.toThrow();
  });

  it("names the offending worker type in the error", () => {
    process.env.WORKER_TYPE = "google-maps";
    try {
      new TestDb("/tmp/aifetchly-test");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("google-maps");
    }
  });
});
