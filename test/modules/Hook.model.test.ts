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
    await model.create({ id: "u1", eventName: "PreToolUse", hookType: "command", command: "a", timeoutMs: 5000, failureMode: "warn", source: "user", enabled: false, trusted: false });
    const rows = await model.listBySource("user");
    expect(rows.length).to.equal(1);
    expect(rows[0].id).to.equal("u1");
  });

  it("updates fields via patch", async () => {
    await model.create({ id: "u2", eventName: "Stop", hookType: "command", command: "old", timeoutMs: 5000, failureMode: "warn", source: "user", enabled: false, trusted: false });
    const updated = await model.update("u2", { command: "new", enabled: true });
    expect(updated.command).to.equal("new");
    expect(updated.enabled).to.equal(true);
  });

  it("deletes by id", async () => {
    await model.create({ id: "u3", eventName: "Stop", hookType: "command", command: "x", timeoutMs: 5000, failureMode: "warn", source: "user", enabled: false, trusted: false });
    await model.deleteById("u3");
    const fetched = await model.findById("u3");
    expect(fetched).to.equal(null);
  });

  it("throws when constructed in a worker process", () => {
    const previous = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = "/tmp/worker";
    try {
      expect(() => new HookModel("")).to.throw(/worker process/);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous;
    }
  });
});
