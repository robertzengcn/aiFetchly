import { describe, expect, it, beforeEach } from "vitest";
import { AIChatConversationModel } from "@/model/AIChatConversation.model";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-conv-projection");

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

describe("AIChatConversationModel projection", () => {
  it("creates a projection and derives unread from timestamps", async () => {
    const model = new AIChatConversationModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const created = await model.createProjection({
      conversationId: "v2-conv-1",
      preview: "hello",
    });
    expect(created.conversationId).toBe("v2-conv-1");
    // No result yet -> not unread.
    expect(AIChatConversationModel.isUnread(created)).toBe(false);

    const updated = await model.recordMessagePersisted({
      conversationId: "v2-conv-1",
      isResult: true,
      previewText: "assistant answer",
      timestamp: new Date("2026-08-19T10:00:00Z"),
    });
    // Result with no read marker -> unread.
    expect(AIChatConversationModel.isUnread(updated)).toBe(true);
    expect(updated.messageCount).toBe(1);
    expect(updated.preview).toBe("assistant answer");
  });

  it("markRead is monotonic — a stale renderer cannot rewind it", async () => {
    const model = new AIChatConversationModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const t1 = new Date("2026-08-19T10:00:00Z");
    const t2 = new Date("2026-08-19T11:00:00Z");
    await model.createProjection({ conversationId: "v2-conv-2" });
    await model.recordMessagePersisted({
      conversationId: "v2-conv-2",
      isResult: true,
      previewText: "r1",
      timestamp: t2,
    });

    await model.markRead("v2-conv-2", t2);
    // Stale older marker must not move lastReadAt backward.
    const after = await model.markRead("v2-conv-2", t1);
    expect(after?.lastReadAt?.toISOString()).toBe(t2.toISOString());
    // Read marker at result time -> no longer unread.
    expect(AIChatConversationModel.isUnread(after!)).toBe(false);
  });

  it("rename sets a user title that generated titles never overwrite", async () => {
    const model = new AIChatConversationModel(tmpDir);
    await SqliteDb.ensureInitialized();

    await model.createProjection({ conversationId: "v2-conv-3" });
    await model.rename("v2-conv-3", "My custom name");
    const updated = await model.recordMessagePersisted({
      conversationId: "v2-conv-3",
      isResult: false,
      previewText: "next",
      generatedTitle: "auto title",
      timestamp: new Date(),
    });
    expect(updated.title).toBe("My custom name");
    expect(updated.titleIsUserSet).toBe(true);

    // Generated title lands once when no title exists.
    await model.createProjection({ conversationId: "v2-conv-4" });
    const gen = await model.recordMessagePersisted({
      conversationId: "v2-conv-4",
      isResult: false,
      previewText: "x",
      generatedTitle: "first exchange title",
      timestamp: new Date(),
    });
    expect(gen.title).toBe("first exchange title");
    expect(gen.titleIsUserSet).toBe(false);
  });

  it("bounds preview and title lengths", async () => {
    const model = new AIChatConversationModel(tmpDir);
    await SqliteDb.ensureInitialized();
    const long = "a".repeat(2000);
    const created = await model.createProjection({
      conversationId: "v2-conv-5",
      preview: long,
      title: long,
    });
    expect(created.preview.length).toBeLessThanOrEqual(300);
  });

  it("rejects worker-process access", async () => {
    const model = new AIChatConversationModel(tmpDir);
    const prev = process.env.WORKER_TYPE;
    process.env.WORKER_TYPE = "contact-extraction";
    try {
      await expect(model.listAll()).rejects.toThrow(/worker process/i);
    } finally {
      if (prev === undefined) delete process.env.WORKER_TYPE;
      else process.env.WORKER_TYPE = prev;
    }
  });
});

describe("AIChatConversationModule.effectiveRuntime / attentionFor", () => {
  it("prefers live runtime, then durable active run, then idle", () => {
    const none = () => null;
    expect(
      AIChatConversationModule.effectiveRuntime("c1", none, null).runtimeStatus
    ).toBe("idle");

    expect(
      AIChatConversationModule.effectiveRuntime("c2", none, {
        runId: "run-1",
        status: "running",
      })
    ).toEqual({ runtimeStatus: "running", activeRunId: "run-1" });

    expect(
      AIChatConversationModule.effectiveRuntime(
        "c3",
        () => ({ runtimeStatus: "awaiting_user", activeRunId: "run-2" }),
        { runId: "run-1", status: "running" }
      )
    ).toEqual({ runtimeStatus: "awaiting_user", activeRunId: "run-2" });
  });

  it("maps statuses to attention flags without color dependence", () => {
    expect(AIChatConversationModule.attentionFor("awaiting_permission", false)).toBe(
      "permission"
    );
    expect(AIChatConversationModule.attentionFor("awaiting_user", false)).toBe(
      "user_input"
    );
    expect(AIChatConversationModule.attentionFor("failed", true)).toBe("failure");
    expect(AIChatConversationModule.attentionFor("failed", false)).toBe("none");
    expect(AIChatConversationModule.attentionFor("running", false)).toBe("none");
    expect(AIChatConversationModule.attentionFor("completed", true)).toBe("none");
  });
});
