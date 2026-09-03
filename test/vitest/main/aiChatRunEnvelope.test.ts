import { describe, expect, it, beforeEach } from "vitest";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-run-envelope");

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("AIChatRunModel compare-and-set transitions", () => {
  it("walks the happy path queued → running → completed with revision bumps", async () => {
    const model = new AIChatRunModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const run = await model.createRun({
      conversationId: "v2-run-conv",
      owner: "interactive",
    });
    expect(run.status).toBe("queued");
    expect(run.revision).toBe(0);

    const started = await model.transition(run.runId, "running", ["queued"]);
    expect(started.status).toBe("running");
    expect(started.revision).toBe(1);
    expect(started.startedAt).not.toBeNull();

    const done = await model.transition(
      run.runId,
      "completed",
      ["queued", "running", "awaiting_permission", "awaiting_user"],
      { assistantMessageId: "assistant-1" }
    );
    expect(done.status).toBe("completed");
    expect(done.revision).toBe(2);
    expect(done.finishedAt).not.toBeNull();
    expect(done.assistantMessageId).toBe("assistant-1");
  });

  it("terminal states are immutable — late events conflict, duplicates no-op", async () => {
    const model = new AIChatRunModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const run = await model.createRun({
      conversationId: "v2-run-conv2",
      owner: "interactive",
    });
    await model.transition(run.runId, "running", ["queued"]);
    await model.transition(run.runId, "cancelled", [
      "queued",
      "running",
      "awaiting_permission",
      "awaiting_user",
    ]);

    // A late non-terminal event after terminal must fail.
    await expect(
      model.transition(run.runId, "running", ["queued"])
    ).rejects.toThrow(/conflict/i);
    // Repeating the SAME terminal event is an idempotent no-op.
    const again = await model.transition(run.runId, "cancelled", [
      "queued",
      "running",
    ]);
    expect(again.status).toBe("cancelled");
  });

  it("rejects transitions from unexpected source states", async () => {
    const model = new AIChatRunModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const run = await model.createRun({
      conversationId: "v2-run-conv3",
      owner: "interactive",
    });
    // queued -> awaiting_permission is not in the allowed source set here.
    await expect(
      model.transition(run.runId, "awaiting_permission", ["running"])
    ).rejects.toThrow(/conflict/i);
  });

  it("waiting transitions stamp waitingAt and return to running", async () => {
    const model = new AIChatRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const run = await model.createRun({
      conversationId: "v2-run-conv4",
      owner: "interactive",
    });
    await model.transition(run.runId, "running", ["queued"]);
    const waiting = await model.transition(run.runId, "awaiting_permission", [
      "queued",
      "running",
    ]);
    expect(waiting.waitingAt).not.toBeNull();
    const resumed = await model.transition(run.runId, "running", [
      "queued",
      "awaiting_permission",
      "awaiting_user",
    ]);
    expect(resumed.status).toBe("running");
  });

  it("bounds error summaries and lists active runs for reconciliation", async () => {
    const model = new AIChatRunModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const run = await model.createRun({
      conversationId: "v2-run-conv5",
      owner: "interactive",
    });
    await model.transition(run.runId, "failed", [
      "queued",
      "running",
      "awaiting_permission",
      "awaiting_user",
    ], {
      errorCode: "provider_error",
      errorSummary: "x".repeat(2000),
    });
    const stored = await model.getByRunId(run.runId);
    expect(stored?.errorSummary?.length).toBeLessThanOrEqual(500);

    const activeRun = await model.createRun({
      conversationId: "v2-run-conv5b",
      owner: "scheduled",
      sourceId: "17",
    });
    const actives = await model.listAllActive();
    expect(actives.some((r) => r.runId === activeRun.runId)).toBe(true);

    const interrupted = await model.markInterrupted(
      activeRun.runId,
      "app restart"
    );
    expect(interrupted?.status).toBe("interrupted");
    expect(interrupted?.errorCode).toBe("process_loss");
    // Reconciled run is no longer reported active.
    const after = await model.listAllActive();
    expect(after.some((r) => r.runId === activeRun.runId)).toBe(false);
  });

  it("rejects worker-process access", async () => {
    const model = new AIChatRunModel(tmpDir);
    const prev = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "google-proxy-check";
    try {
      await expect(model.listAllActive()).rejects.toThrow(/worker process/i);
    } finally {
      if (prev === undefined) delete process.env.WORKER_TYPE;
      else process.env.WORKER_TYPE = prev;
    }
  });
});
