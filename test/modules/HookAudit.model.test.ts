import { expect } from "chai";
import { HookAuditModel } from "@/model/HookAudit.model";

describe("HookAuditModel", () => {
  let model: HookAuditModel;

  beforeEach(() => {
    model = new HookAuditModel("");
  });

  afterEach(async () => {
    await model.clear();
  });

  async function insert(
    sample: Partial<{
      hookRunId: string;
      hookId: string;
      eventName: string;
      source: string;
      type: string;
      matchQuery: string | null;
      status: string;
      durationMs: number | null;
      reason: string | null;
      timestamp: Date;
    }> & { hookRunId: string; hookId: string }
  ) {
    return model.insert({
      hookRunId: sample.hookRunId,
      hookId: sample.hookId,
      eventName: sample.eventName ?? "PreToolUse",
      source: sample.source ?? "user",
      type: sample.type ?? "command",
      matchQuery: sample.matchQuery ?? null,
      status: sample.status ?? "success",
      durationMs: sample.durationMs ?? 10,
      reason: sample.reason ?? null,
      timestamp: sample.timestamp ?? new Date(),
    });
  }

  it("inserts and queries entries", async () => {
    await insert({ hookRunId: "r1", hookId: "h1" });
    const result = await model.query({ limit: 10, offset: 0 });
    expect(result.rows.length).to.equal(1);
    expect(result.total).to.equal(1);
    expect(result.rows[0].hookId).to.equal("h1");
  });

  it("filters by hookId", async () => {
    await insert({ hookRunId: "r1", hookId: "h1" });
    await insert({ hookRunId: "r2", hookId: "h2" });
    const result = await model.query({ hookId: "h1", limit: 10, offset: 0 });
    expect(result.rows.length).to.equal(1);
  });

  it("filters by status and eventName", async () => {
    await insert({
      hookRunId: "r1",
      hookId: "h1",
      status: "blocked",
      eventName: "PreToolUse",
    });
    await insert({
      hookRunId: "r2",
      hookId: "h2",
      status: "success",
      eventName: "PostToolUse",
    });
    const blocked = await model.query({
      status: "blocked",
      limit: 10,
      offset: 0,
    });
    expect(blocked.rows.length).to.equal(1);
    const post = await model.query({
      eventName: "PostToolUse",
      limit: 10,
      offset: 0,
    });
    expect(post.rows.length).to.equal(1);
  });

  it("paginates with offset", async () => {
    for (let i = 0; i < 5; i++) {
      await insert({ hookRunId: `r${i}`, hookId: `h${i}` });
    }
    const page = await model.query({ limit: 2, offset: 2 });
    expect(page.rows.length).to.equal(2);
    expect(page.total).to.equal(5);
  });

  it("orders by timestamp descending", async () => {
    const early = new Date("2026-01-01T00:00:00Z");
    const late = new Date("2026-06-01T00:00:00Z");
    await insert({ hookRunId: "r1", hookId: "h1", timestamp: early });
    await insert({ hookRunId: "r2", hookId: "h2", timestamp: late });
    const result = await model.query({ limit: 10, offset: 0 });
    expect(result.rows[0].hookId).to.equal("h2");
  });

  it("throws when constructed in a worker process", () => {
    const previous = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "test-worker";
    try {
      expect(() => new HookAuditModel("")).to.throw(/worker process/);
    } finally {
      if (previous === undefined) delete process.env.WORKER_TYPE;
      else process.env.WORKER_TYPE = previous;
    }
  });
});
