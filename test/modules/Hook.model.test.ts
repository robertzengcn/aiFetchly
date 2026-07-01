import { expect } from "chai";
import { HookModel } from "@/model/Hook.model";
import { HookConfigEntity } from "@/entity/HookConfig.entity";

describe("HookModel", () => {
  let model: HookModel;

  beforeEach(() => {
    model = new HookModel("");
  });

  afterEach(async () => {
    await model.deleteAll();
  });

  it("creates and reads a hook by id", async () => {
    const row = await model.create({
      id: "user-test-1",
      eventName: "PreToolUse",
      matcher: "shell_execute",
      hookType: "command",
      command: "node ./check.js",
      cwd: null,
      timeoutMs: 5000,
      failureMode: "warn",
      statusMessage: null,
      envAllowlist: null,
      source: "user",
      enabled: false,
      trusted: false,
    });

    expect(row.id).to.equal("user-test-1");
    const fetched = await model.findById("user-test-1");
    expect(fetched?.command).to.equal("node ./check.js");
    expect(fetched?.enabled).to.equal(false);
  });

  it("lists hooks filtered by source", async () => {
    await model.create({
      id: "u1",
      eventName: "PreToolUse",
      hookType: "command",
      command: "a",
      timeoutMs: 5000,
      failureMode: "warn",
      source: "user",
      enabled: false,
      trusted: false,
    });
    const rows = await model.listBySource("user");
    expect(rows.length).to.equal(1);
    expect(rows[0].id).to.equal("u1");
  });

  it("updates fields via patch", async () => {
    await model.create({
      id: "u2",
      eventName: "Stop",
      hookType: "command",
      command: "old",
      timeoutMs: 5000,
      failureMode: "warn",
      source: "user",
      enabled: false,
      trusted: false,
    });
    const updated = await model.update("u2", { command: "new", enabled: true });
    expect(updated.command).to.equal("new");
    expect(updated.enabled).to.equal(true);
  });

  it("deletes by id", async () => {
    await model.create({
      id: "u3",
      eventName: "Stop",
      hookType: "command",
      command: "x",
      timeoutMs: 5000,
      failureMode: "warn",
      source: "user",
      enabled: false,
      trusted: false,
    });
    await model.deleteById("u3");
    const fetched = await model.findById("u3");
    expect(fetched).to.equal(null);
  });

  it("listAll returns every hook regardless of source", async () => {
    await model.create({
      id: "u-a",
      eventName: "PreToolUse",
      hookType: "command",
      command: "a",
      timeoutMs: 5000,
      failureMode: "warn",
      source: "user",
      enabled: false,
      trusted: false,
    });
    await model.create({
      id: "u-b",
      eventName: "Stop",
      hookType: "command",
      command: "b",
      timeoutMs: 5000,
      failureMode: "warn",
      source: "user",
      enabled: false,
      trusted: false,
    });
    const all = await model.listAll();
    expect(all.length).to.equal(2);
  });

  it("updateRunStatus sets lastRunStatus and lastRunAt", async () => {
    await model.create({
      id: "u-status",
      eventName: "PreToolUse",
      hookType: "command",
      command: "x",
      timeoutMs: 5000,
      failureMode: "warn",
      source: "user",
      enabled: false,
      trusted: false,
    });
    const at = new Date("2026-07-01T12:00:00Z");
    await model.updateRunStatus("u-status", "blocked", at);
    const fetched = await model.findById("u-status");
    expect(fetched?.lastRunStatus).to.equal("blocked");
    expect(fetched?.lastRunAt?.toISOString()).to.equal(at.toISOString());
  });

  it("throws when constructed in a worker process", () => {
    const previous = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "test-worker";
    try {
      expect(() => new HookModel("")).to.throw(/worker process/);
    } finally {
      if (previous === undefined) delete process.env.WORKER_TYPE;
      else process.env.WORKER_TYPE = previous;
    }
  });
});
