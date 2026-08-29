import { describe, expect, it, beforeEach } from "vitest";
import {
  AIChatPendingMessageModel,
  AIChatPendingModelError,
} from "@/model/AIChatPendingMessage.model";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-pending-message-model");

function makeRow(params: {
  pendingMessageId: string;
  clientRequestId: string;
  conversationId?: string;
  content?: string;
  status?: "queued" | "paused";
}) {
  return {
    pendingMessageId: params.pendingMessageId,
    clientRequestId: params.clientRequestId,
    conversationId: params.conversationId ?? "v2-conv-1",
    userMessageId: `user-pending-${params.pendingMessageId}`,
    content: params.content ?? `hello ${params.pendingMessageId}`,
    modelContent: params.content ?? `hello ${params.pendingMessageId}`,
    status: params.status ?? ("queued" as const),
  };
}

function makeMessageModel(): AIChatMessageModel {
  return new AIChatMessageModel(tmpDir);
}

async function seedMessage(params: {
  messageId: string;
  conversationId: string;
}): Promise<void> {
  const entity = new AIChatMessageEntity();
  entity.messageId = params.messageId;
  entity.conversationId = params.conversationId;
  entity.role = "user";
  entity.content = "delivered";
  entity.timestamp = new Date();
  entity.messageType = MessageType.MESSAGE;
  await makeMessageModel().saveMessage(entity);
}

beforeEach(async () => {
  await SqliteDb.destroyInstance();
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
});

describe("AIChatPendingMessageModel", () => {
  it("creates rows and reuses them idempotently by clientRequestId", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const first = await model.create(
      makeRow({ pendingMessageId: "pm-1", clientRequestId: "cr-1" })
    );
    const again = await model.create(
      makeRow({ pendingMessageId: "pm-1", clientRequestId: "cr-1" })
    );
    expect(again.id).toBe(first.id);

    await expect(
      model.create(
        makeRow({
          pendingMessageId: "pm-2",
          clientRequestId: "cr-1",
          content: "different content",
        })
      )
    ).rejects.toBeInstanceOf(AIChatPendingModelError);
  });

  it("lists rows FIFO by primary key", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    for (const id of ["pm-b", "pm-a", "pm-c"]) {
      await model.create(makeRow({ pendingMessageId: id, clientRequestId: id }));
    }
    const rows = await model.listByConversation("v2-conv-1");
    expect(rows.map((r) => r.pendingMessageId)).toEqual([
      "pm-b",
      "pm-a",
      "pm-c",
    ]);
  });

  it("claimOldestForDispatch claims exactly the oldest queued row once", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-1", clientRequestId: "c1" }));
    await model.create(makeRow({ pendingMessageId: "pm-2", clientRequestId: "c2" }));

    const first = await model.claimOldestForDispatch("v2-conv-1");
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.row.pendingMessageId).toBe("pm-1");
      expect(first.row.status).toBe("dispatching");
      expect(first.row.claimToken).toBeTruthy();
      expect(first.row.attemptCount).toBe(1);
    }

    // The second claim takes the NEXT row (pm-2), not pm-1.
    const second = await model.claimOldestForDispatch("v2-conv-1");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.row.pendingMessageId).toBe("pm-2");
    }

    const drained = await model.claimOldestForDispatch("v2-conv-1");
    expect(drained.ok).toBe(false);
  });

  it("claimForSteering moves queued→steering with target id and blocks repeats", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-s", clientRequestId: "cs" }));

    const claimed = await model.claimForSteering("pm-s", "assistant-1");
    expect(claimed.ok).toBe(true);
    if (claimed.ok) {
      expect(claimed.row.status).toBe("steering");
      expect(claimed.row.targetAssistantMessageId).toBe("assistant-1");
    }

    const repeat = await model.claimForSteering("pm-s", "assistant-2");
    expect(repeat.ok).toBe(false);
    if (!repeat.ok) {
      expect(repeat.code).toBe("PENDING_NOT_CLAIMABLE");
    }
  });

  it("restoreSteeringToQueued only honors the owning claim token", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-r", clientRequestId: "cr" }));
    const claimed = await model.claimForSteering("pm-r", "assistant-1");
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const wrongToken = await model.restoreSteeringToQueued("pm-r", "deadbeef");
    expect(wrongToken).toBe(false);

    const rightToken = await model.restoreSteeringToQueued(
      "pm-r",
      claimed.row.claimToken!
    );
    expect(rightToken).toBe(true);
    const restored = await model.getByPendingMessageId("pm-r");
    expect(restored?.status).toBe("queued");
  });

  it("promoteDispatchToUserMessage inserts the user row and marks sent atomically", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-d", clientRequestId: "cd" }));
    const claimed = await model.claimOldestForDispatch("v2-conv-1");
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const userRow = await model.promoteDispatchToUserMessage({
      pendingMessageId: "pm-d",
      claimToken: claimed.row.claimToken!,
    });
    expect(userRow.messageId).toBe("user-pending-pm-d");
    expect(userRow.conversationId).toBe("v2-conv-1");
    expect(userRow.role).toBe("user");

    const pending = await model.getByPendingMessageId("pm-d");
    expect(pending?.status).toBe("sent");
    expect(pending?.sentMessageId).toBe("user-pending-pm-d");
    expect(pending?.terminalAt).toBeInstanceOf(Date);

    // Promotion is idempotent-safe: replaying with the same (now stale)
    // claim token throws instead of duplicating.
    await expect(
      model.promoteDispatchToUserMessage({
        pendingMessageId: "pm-d",
        claimToken: claimed.row.claimToken!,
      })
    ).rejects.toBeInstanceOf(AIChatPendingModelError);

    const delivered = await makeMessageModel().getMessageByConversationAndMessageId(
      "v2-conv-1",
      "user-pending-pm-d"
    );
    expect(delivered).not.toBeNull();
  });

  it("promoteSteeringToUserMessage marks applied with boundary and target", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-t", clientRequestId: "ct" }));
    const claimed = await model.claimForSteering("pm-t", "assistant-9");
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const userRow = await model.promoteSteeringToUserMessage({
      pendingMessageId: "pm-t",
      claimToken: claimed.row.claimToken!,
      boundary: "after_tool",
      targetAssistantMessageId: "assistant-9",
    });
    expect(userRow.messageId).toBe("user-pending-pm-t");

    const pending = await model.getByPendingMessageId("pm-t");
    expect(pending?.status).toBe("applied");
    expect(pending?.steeringBoundary).toBe("after_tool");
    expect(pending?.targetAssistantMessageId).toBe("assistant-9");
  });

  it("pauseConversationQueued / resumeConversation toggle states in order", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-p1", clientRequestId: "p1" }));
    await model.create(makeRow({ pendingMessageId: "pm-p2", clientRequestId: "p2" }));

    const paused = await model.pauseConversationQueued("v2-conv-1", "user_stopped");
    expect(paused).toBe(2);

    const resumed = await model.resumeConversation("v2-conv-1");
    expect(resumed).toBe(2);

    const rows = await model.listByConversation("v2-conv-1");
    expect(rows.every((r) => r.status === "queued")).toBe(true);
  });

  it("cancelQueued only cancels queued/paused rows", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-x", clientRequestId: "cx" }));

    const cancelled = await model.cancelQueued("pm-x");
    expect(cancelled.ok).toBe(true);

    const again = await model.cancelQueued("pm-x");
    expect(again.ok).toBe(false);

    const missing = await model.cancelQueued("nope");
    expect(missing.ok).toBe(false);
  });

  it("recoverOnStartup reconciles each non-terminal state", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();

    // (a) dispatched + delivered row exists → sent
    await model.create(makeRow({ pendingMessageId: "pm-a", clientRequestId: "ra" }));
    const claimedA = await model.claimOldestForDispatch("v2-conv-1");
    expect(claimedA.ok).toBe(true);
    await seedMessage({
      messageId: "user-pending-pm-a",
      conversationId: "v2-conv-1",
    });

    // (b) dispatched but transcript row missing → paused(recovered_dispatch)
    await model.create(makeRow({ pendingMessageId: "pm-b", clientRequestId: "rb" }));
    await model.claimOldestForDispatch("v2-conv-1");

    // (c) steering never applied → paused(recovered_steering)
    await model.create(makeRow({ pendingMessageId: "pm-c", clientRequestId: "rc" }));
    await model.claimForSteering("pm-c", "assistant-old");

    // (d) plain queued → paused(recovered_after_restart)
    await model.create(makeRow({ pendingMessageId: "pm-d", clientRequestId: "rd" }));

    const counts = await model.recoverOnStartup();
    expect(counts.recoveredToSent).toBe(1);
    expect(counts.pausedDispatching).toBe(1);
    expect(counts.pausedSteering).toBe(1);
    expect(counts.pausedQueued).toBe(1);

    const a = await model.getByPendingMessageId("pm-a");
    expect(a?.status).toBe("sent");
    const b = await model.getByPendingMessageId("pm-b");
    expect(b?.status).toBe("paused");
    expect(b?.recoveryReason).toBe("recovered_dispatch");
    const c = await model.getByPendingMessageId("pm-c");
    expect(c?.status).toBe("paused");
    expect(c?.recoveryReason).toBe("recovered_steering");
    const d = await model.getByPendingMessageId("pm-d");
    expect(d?.status).toBe("paused");
    expect(d?.recoveryReason).toBe("recovered_after_restart");
  });

  it("recovers steering rows to applied when the user row exists", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-s9", clientRequestId: "rs" }));
    await model.claimForSteering("pm-s9", "assistant-old");
    await seedMessage({
      messageId: "user-pending-pm-s9",
      conversationId: "v2-conv-1",
    });

    const counts = await model.recoverOnStartup();
    expect(counts.recoveredToApplied).toBe(1);
    const row = await model.getByPendingMessageId("pm-s9");
    expect(row?.status).toBe("applied");
  });

  it("deleteByConversation scopes deletion", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(
      makeRow({
        pendingMessageId: "pm-z1",
        clientRequestId: "z1",
        conversationId: "v2-keep",
      })
    );
    await model.create(
      makeRow({
        pendingMessageId: "pm-z2",
        clientRequestId: "z2",
        conversationId: "v2-drop",
      })
    );
    const deleted = await model.deleteByConversation("v2-drop");
    expect(deleted).toBe(1);
    const keep = await model.listByConversation("v2-keep");
    expect(keep.length).toBe(1);
  });

  it("countNonTerminalByConversation counts only non-terminal rows", async () => {
    const model = new AIChatPendingMessageModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.create(makeRow({ pendingMessageId: "pm-n1", clientRequestId: "n1" }));
    await model.create(makeRow({ pendingMessageId: "pm-n2", clientRequestId: "n2" }));
    await model.cancelQueued("pm-n2");

    const count = await model.countNonTerminalByConversation("v2-conv-1");
    expect(count).toBe(1);
  });
});
