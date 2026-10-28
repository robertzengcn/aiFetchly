import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { AIChatConversationModel } from "@/model/AIChatConversation.model";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

const tmpDir = path.join(os.tmpdir(), "aifetchly-chat-title-persist");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

async function seedConversation(
  model: AIChatConversationModel,
  conversationId: string
): Promise<void> {
  await model.createProjection({
    conversationId,
    title: "Hello there friend",
    titleSource: "excerpt",
    titleGenerationStatus: "pending",
  });
}

async function seedUserMessage(
  messageModel: AIChatMessageModel,
  conversationId: string,
  content: string,
  seq: number
): Promise<void> {
  const entity = new AIChatMessageEntity();
  entity.messageId = `${conversationId}-msg-${seq}`;
  entity.conversationId = conversationId;
  entity.role = "user";
  entity.content = content;
  entity.timestamp = new Date(2026, 0, 1, 0, 0, seq);
  entity.messageType = MessageType.MESSAGE;
  entity.metadata = JSON.stringify({ source: "chat-v2" });
  await messageModel.saveMessage(entity);
}

async function seedAssistantMessage(
  messageModel: AIChatMessageModel,
  conversationId: string,
  content: string,
  seq: number
): Promise<void> {
  const entity = new AIChatMessageEntity();
  entity.messageId = `${conversationId}-msg-${seq}`;
  entity.conversationId = conversationId;
  entity.role = "assistant";
  entity.content = content;
  entity.timestamp = new Date(2026, 0, 1, 0, 0, seq);
  entity.messageType = MessageType.MESSAGE;
  entity.metadata = JSON.stringify({ source: "chat-v2" });
  await messageModel.saveMessage(entity);
}

describe("AIChatTitle persistence (model)", () => {
  it("claimTitleAttempt wins once and loses for a concurrent duplicate", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-claim");
    const first = await model.claimTitleAttempt({
      conversationId: "v2-claim",
      epoch: 0,
      revision: 0,
      requestId: "req-1",
    });
    const second = await model.claimTitleAttempt({
      conversationId: "v2-claim",
      epoch: 0,
      revision: 0,
      requestId: "req-2",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    const row = await model.getByConversationId("v2-claim");
    expect(row?.titleGenerationStatus).toBe("running");
    expect(row?.titleAttemptCount).toBe(1);
    expect(row?.titleRequestId).toBe("req-1");
  });

  it("claimTitleAttempt rejects stale epoch/revision, user rename, non-pending status, consumed attempts, and missing rows", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-epoch");
    expect(
      await model.claimTitleAttempt({
        conversationId: "v2-epoch",
        epoch: 1,
        revision: 0,
        requestId: "r",
      })
    ).toBe(false);

    await seedConversation(model, "v2-rev");
    await model.updateExcerptIfPending({
      conversationId: "v2-rev",
      epoch: 0,
      excerpt: "bumped",
    });
    const revRow = await model.getByConversationId("v2-rev");
    expect(
      await model.claimTitleAttempt({
        conversationId: "v2-rev",
        epoch: 0,
        revision: 0, // revision moved to 1 by the excerpt bump
        requestId: "r",
      })
    ).toBe(false);

    await seedConversation(model, "v2-user");
    await model.renameWithOwnership("v2-user", "My name");
    expect(
      await model.claimTitleAttempt({
        conversationId: "v2-user",
        epoch: 0,
        revision: 1,
        requestId: "r",
      })
    ).toBe(false);

    await seedConversation(model, "v2-consumed");
    await model.suppressTitleGeneration("v2-consumed");
    expect(
      await model.claimTitleAttempt({
        conversationId: "v2-consumed",
        epoch: 0,
        revision: 0,
        requestId: "r",
      })
    ).toBe(false);

    expect(
      await model.claimTitleAttempt({
        conversationId: "v2-missing",
        epoch: 0,
        revision: 0,
        requestId: "r",
      })
    ).toBe(false);
  });

  it("claimTitleAttempt rejects an archived conversation", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-archived");
    const row = await model.getByConversationId("v2-archived");
    await model.repository.update(
      { id: row!.id },
      { archivedAt: new Date() }
    );
    expect(
      await model.claimTitleAttempt({
        conversationId: "v2-archived",
        epoch: 0,
        revision: 0,
        requestId: "r",
      })
    ).toBe(false);
  });

  it("applyGeneratedTitle commits only for the live claim and reports stale after rename", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-apply");
    await model.claimTitleAttempt({
      conversationId: "v2-apply",
      epoch: 0,
      revision: 0,
      requestId: "req-a",
    });
    const applied = await model.applyGeneratedTitle({
      conversationId: "v2-apply",
      epoch: 0,
      revision: 0,
      requestId: "req-a",
      title: "Sydney Dentist Outreach",
    });
    expect(applied).toEqual({
      outcome: "applied",
      title: "Sydney Dentist Outreach",
      revision: 1,
    });
    const row = await model.getByConversationId("v2-apply");
    expect(row?.titleSource).toBe("ai");
    expect(row?.titleGenerationStatus).toBe("succeeded");

    // A late claim result after a manual rename must be stale.
    await seedConversation(model, "v2-apply2");
    await model.claimTitleAttempt({
      conversationId: "v2-apply2",
      epoch: 0,
      revision: 0,
      requestId: "req-b",
    });
    await model.renameWithOwnership("v2-apply2", "Manual");
    const stale = await model.applyGeneratedTitle({
      conversationId: "v2-apply2",
      epoch: 0,
      revision: 0,
      requestId: "req-b",
      title: "Late AI Title",
    });
    expect(stale).toEqual({ outcome: "stale" });
    const row2 = await model.getByConversationId("v2-apply2");
    expect(row2?.title).toBe("Manual");
    expect(row2?.titleSource).toBe("user");
  });

  it("applyGeneratedTitle reports missing for a deleted conversation", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const missing = await model.applyGeneratedTitle({
      conversationId: "v2-gone",
      epoch: 0,
      revision: 0,
      requestId: "req-c",
      title: "Nope",
    });
    expect(missing).toEqual({ outcome: "missing" });
  });

  it("renameWithOwnership sets user ownership, suppresses generation, bumps revision, and clears claim state", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-rename");
    await model.claimTitleAttempt({
      conversationId: "v2-rename",
      epoch: 0,
      revision: 0,
      requestId: "req-d",
    });
    const renamed = await model.renameWithOwnership("v2-rename", "Kept Name");
    expect(renamed?.title).toBe("Kept Name");
    expect(renamed?.titleIsUserSet).toBe(true);
    expect(renamed?.titleSource).toBe("user");
    expect(renamed?.titleGenerationStatus).toBe("suppressed");
    expect(renamed?.titleRevision).toBe(1);
    expect(renamed?.titleRequestId).toBeNull();
    expect(renamed?.titleAttemptCount).toBe(1); // attempt stays consumed
  });

  it("renameWithOwnership returns null for a missing conversation", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    expect(await model.renameWithOwnership("v2-nope", "X")).toBeNull();
  });

  it("updateExcerptIfPending replaces placeholder/excerpt titles only while pending and nonmanual", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-exc");
    await model.updateExcerptIfPending({
      conversationId: "v2-exc",
      epoch: 0,
      excerpt: "Better excerpt",
    });
    let row = await model.getByConversationId("v2-exc");
    expect(row?.title).toBe("Better excerpt");
    expect(row?.titleSource).toBe("excerpt");

    // Frozen once a claim starts.
    await model.claimTitleAttempt({
      conversationId: "v2-exc",
      epoch: 0,
      revision: 1,
      requestId: "req-e",
    });
    await model.updateExcerptIfPending({
      conversationId: "v2-exc",
      epoch: 0,
      excerpt: "Should not land",
    });
    row = await model.getByConversationId("v2-exc");
    expect(row?.title).toBe("Better excerpt");
  });

  it("updateExcerptIfPending never touches a manual title", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-exc2");
    await model.renameWithOwnership("v2-exc2", "Manual");
    await model.updateExcerptIfPending({
      conversationId: "v2-exc2",
      epoch: 0,
      excerpt: "Sneaky",
    });
    const row = await model.getByConversationId("v2-exc2");
    expect(row?.title).toBe("Manual");
  });

  it("recordMessagePersisted no longer restores a stale title after rename (no full-row saves)", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.recordMessagePersisted({
      conversationId: "v2-msg",
      isResult: false,
      previewText: "first message",
      generatedTitle: "first message",
      timestamp: new Date(),
    });
    await model.renameWithOwnership("v2-msg", "Manual Name");
    await model.recordMessagePersisted({
      conversationId: "v2-msg",
      isResult: false,
      previewText: "second message",
      generatedTitle: "second message",
      timestamp: new Date(),
    });
    const row = await model.getByConversationId("v2-msg");
    expect(row?.title).toBe("Manual Name");
    expect(row?.titleSource).toBe("user");
    expect(row?.messageCount).toBe(1); // second call increments once
  });

  it("recordMessagePersisted seeds a sanitized excerpt with pending lifecycle on create", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.recordMessagePersisted({
      conversationId: "v2-seed",
      isResult: false,
      previewText: "please email a@b.co about dentists",
      generatedTitle: "please email a@b.co about dentists in Sydney",
      timestamp: new Date(),
    });
    const row = await model.getByConversationId("v2-seed");
    expect(row?.title).toBe("please email [email] about dentists in Sydney");
    expect(row?.titleSource).toBe("excerpt");
    expect(row?.titleGenerationStatus).toBe("pending");
  });

  it("recordMessagePersisted does not seed titles on legacy rows (upgrade safety)", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.createProjection({ conversationId: "v2-legacy" });
    await model.recordMessagePersisted({
      conversationId: "v2-legacy",
      isResult: false,
      previewText: "new message",
      generatedTitle: "new message",
      timestamp: new Date(),
    });
    const row = await model.getByConversationId("v2-legacy");
    expect(row?.title).toBeNull();
    expect(row?.titleSource).toBe("legacy");
    expect(row?.titleGenerationStatus).toBe("suppressed");
  });

  it("markRead does not overwrite title columns after a concurrent rename", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-read");
    await model.renameWithOwnership("v2-read", "Manual");
    const updated = await model.markRead("v2-read", new Date());
    expect(updated?.title).toBe("Manual");
    expect(updated?.titleSource).toBe("user");
    expect(updated?.lastReadAt).not.toBeNull();
  });

  it("clearTitleLifecycleForHistoryClear resets nonmanual titles to a fresh pending epoch", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-clear");
    await model.clearTitleLifecycleForHistoryClear("v2-clear");
    const row = await model.getByConversationId("v2-clear");
    expect(row?.title).toBeNull();
    expect(row?.titleSource).toBe("placeholder");
    expect(row?.titleGenerationStatus).toBe("pending");
    expect(row?.titleAttemptCount).toBe(0);
    expect(row?.titleEpoch).toBe(1);
    expect(row?.titleRevision).toBe(1);
  });

  it("clearTitleLifecycleForHistoryClear keeps a manual title but advances the epoch", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-clear2");
    await model.renameWithOwnership("v2-clear2", "Kept");
    await model.clearTitleLifecycleForHistoryClear("v2-clear2");
    const row = await model.getByConversationId("v2-clear2");
    expect(row?.title).toBe("Kept");
    expect(row?.titleSource).toBe("user");
    expect(row?.titleGenerationStatus).toBe("suppressed");
    expect(row?.titleEpoch).toBe(1);
  });

  it("reconcileInterruptedTitleClaims marks running claims failed(interrupted)", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await seedConversation(model, "v2-int");
    await seedConversation(model, "v2-int2");
    await model.claimTitleAttempt({
      conversationId: "v2-int",
      epoch: 0,
      revision: 0,
      requestId: "r1",
    });
    const count = await model.reconcileInterruptedTitleClaims();
    expect(count).toBe(1);
    const row = await model.getByConversationId("v2-int");
    expect(row?.titleGenerationStatus).toBe("failed");
    expect(row?.titleFailureCode).toBe("interrupted");
  });

  it("repairLegacyUserTitles promotes legacy user-set rows to source=user (idempotent)", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.repository.query(
      `INSERT INTO ai_chat_conversations
         (conversationId, title, titleIsUserSet, preview, messageCount, titleSource, titleRevision, titleEpoch, titleGenerationStatus, titleAttemptCount, updatedAt)
       VALUES
         ('v2-olduser', 'Old manual', 1, '', 0, 'legacy', 0, 0, 'suppressed', 0, CURRENT_TIMESTAMP)`
    );
    const first = await model.repairLegacyUserTitles();
    expect(first).toBe(1);
    const second = await model.repairLegacyUserTitles();
    expect(second).toBe(0);
    const row = await model.getByConversationId("v2-olduser");
    expect(row?.titleSource).toBe("user");
  });

  it("createProjection defaults classify pre-existing producers as legacy/suppressed", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const row = await model.createProjection({ conversationId: "v2-default" });
    expect(row.titleSource).toBe("legacy");
    expect(row.titleGenerationStatus).toBe("suppressed");
  });
});

describe("AIChatTitle persistence (message pairing input)", () => {
  it("message models seed and query rows used for candidate evaluation", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    await seedUserMessage(messageModel, "v2-pair", "帮我找悉尼的牙医", 1);
    await seedAssistantMessage(messageModel, "v2-pair", "Sure — here is a plan.", 2);
    const page = await messageModel.getMessagesByConversation("v2-pair", 10);
    expect(page.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("AIChatTitle module policy", () => {
  it("prepareTitleCandidate returns pending_window for greeting-only exchanges under three", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedConversation(model, "v2-win1");
    await seedUserMessage(messageModel, "v2-win1", "hi", 1);
    await seedAssistantMessage(messageModel, "v2-win1", "Hello! How can I help?", 2);
    const candidate = await module.prepareTitleCandidate("v2-win1");
    expect(candidate).toEqual({ kind: "pending_window" });
  });

  it("prepareTitleCandidate suppresses after three non-substantive exchanges with zero model calls", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedConversation(model, "v2-win2");
    for (let i = 0; i < 3; i += 1) {
      await seedUserMessage(messageModel, "v2-win2", i === 0 ? "Hi!" : "thanks", i * 2 + 1);
      await seedAssistantMessage(messageModel, "v2-win2", "Sure thing.", i * 2 + 2);
    }
    const candidate = await module.prepareTitleCandidate("v2-win2");
    expect(candidate).toEqual({ kind: "suppressed" });
    const row = await model.getByConversationId("v2-win2");
    expect(row?.titleGenerationStatus).toBe("suppressed");
  });

  it("prepareTitleCandidate picks the earliest substantive exchange and refreshes the greeting excerpt", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-win3",
      title: "hi",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedUserMessage(messageModel, "v2-win3", "你好", 1);
    await seedAssistantMessage(messageModel, "v2-win3", "你好！有什么可以帮你？", 2);
    await seedUserMessage(messageModel, "v2-win3", "帮我找悉尼的牙医", 3);
    await seedAssistantMessage(messageModel, "v2-win3", "好的，我来帮你查找。", 4);
    const candidate = await module.prepareTitleCandidate("v2-win3");
    expect(candidate.kind).toBe("eligible");
    if (candidate.kind !== "eligible") return;
    expect(candidate.userText).toContain("悉尼的牙医");
    expect(candidate.epoch).toBe(0);
    const row = await model.getByConversationId("v2-win3");
    expect(row?.title).toBe("帮我找悉尼的牙医"); // excerpt refreshed
  });

  it("prepareTitleCandidate reports not_ready for manual ownership and missing rows", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedConversation(model, "v2-win4");
    await model.renameWithOwnership("v2-win4", "Manual");
    expect(await module.prepareTitleCandidate("v2-win4")).toEqual({
      kind: "not_ready",
    });
    expect(await module.prepareTitleCandidate("v2-none")).toEqual({
      kind: "not_ready",
    });
  });

  it("applyManualRename returns authoritative state or missing", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedConversation(model, "v2-mr");
    const renamed = await module.applyManualRename("v2-mr", "  Kept  ");
    expect(renamed.outcome).toBe("renamed");
    if (renamed.outcome !== "renamed") return;
    expect(renamed.titleRevision).toBe(1);
    const missing = await module.applyManualRename("v2-none", "X");
    expect(missing).toEqual({ outcome: "missing" });
  });

  it("duplicateConversation copies manual ownership and suppresses nonmanual duplicates", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedUserMessage(messageModel, "v2-dup1", "hello world", 1);
    await module.recordMessagePersisted({
      conversationId: "v2-dup1",
      isResult: false,
      previewText: "hello world",
      generatedTitle: "hello world",
      timestamp: new Date(),
    });
    await model.renameWithOwnership("v2-dup1", "Manual Original");

    const duplicateId = await module.duplicateConversation("v2-dup1");
    expect(duplicateId).not.toBeNull();
    const copy = await model.getByConversationId(duplicateId!);
    expect(copy?.title).toBe("Manual Original");
    expect(copy?.titleIsUserSet).toBe(true);
    expect(copy?.titleSource).toBe("user");
    expect(copy?.titleGenerationStatus).toBe("suppressed");

    // Nonmanual duplicate becomes legacy/suppressed.
    await seedUserMessage(messageModel, "v2-dup2", "second", 1);
    await module.recordMessagePersisted({
      conversationId: "v2-dup2",
      isResult: false,
      previewText: "second",
      generatedTitle: "second",
      timestamp: new Date(),
    });
    const duplicate2 = await module.duplicateConversation("v2-dup2");
    const copy2 = await model.getByConversationId(duplicate2!);
    expect(copy2?.title).toBe("second");
    expect(copy2?.titleIsUserSet).toBe(false);
    expect(copy2?.titleSource).toBe("legacy");
    expect(copy2?.titleGenerationStatus).toBe("suppressed");
  });

  it("clearTitleLifecycle restarts pending for nonmanual and retains manual names", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedConversation(model, "v2-cl1");
    await module.clearTitleLifecycle("v2-cl1");
    let row = await model.getByConversationId("v2-cl1");
    expect(row?.titleGenerationStatus).toBe("pending");
    expect(row?.titleEpoch).toBe(1);

    await seedConversation(model, "v2-cl2");
    await model.renameWithOwnership("v2-cl2", "Kept");
    await module.clearTitleLifecycle("v2-cl2");
    row = await model.getByConversationId("v2-cl2");
    expect(row?.title).toBe("Kept");
    expect(row?.titleGenerationStatus).toBe("suppressed");
  });

  it("reconcileTitleStateOnStartup interrupts running claims and repairs legacy user rows", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await seedConversation(model, "v2-st1");
    await model.claimTitleAttempt({
      conversationId: "v2-st1",
      epoch: 0,
      revision: 0,
      requestId: "r",
    });
    await model.repository.query(
      `INSERT INTO ai_chat_conversations
         (conversationId, title, titleIsUserSet, preview, messageCount, titleSource, titleRevision, titleEpoch, titleGenerationStatus, titleAttemptCount, updatedAt)
       VALUES ('v2-st2', 'Old', 1, '', 0, 'legacy', 0, 0, 'suppressed', 0, CURRENT_TIMESTAMP)`
    );
    const result = await module.reconcileTitleStateOnStartup();
    expect(result).toEqual({ interrupted: 1, repaired: 1 });
  });
});
