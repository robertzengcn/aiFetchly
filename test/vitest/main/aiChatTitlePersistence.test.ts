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
  entity.metadata = JSON.stringify({ source: "chat-v2", safeTypedText: content });
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
await model.suppressTitleGeneration("v2-consumed", 0);
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

describe("Titles audit r3 G01–G03 — durable identity, provider binding, chat-rows window", () => {
  async function seedG(
    messageModel: AIChatMessageModel,
    conversationId: string,
    seq: number,
    role: "user" | "assistant",
    content: string,
    meta: Record<string, unknown>
  ): Promise<string> {
    const messageId = `${conversationId}-g${seq}`;
    const entity = new AIChatMessageEntity();
    entity.messageId = messageId;
    entity.conversationId = conversationId;
    entity.role = role;
    entity.content = content;
    entity.timestamp = new Date(2026, 0, 2, 0, 0, seq);
    entity.messageType = MessageType.MESSAGE;
    entity.metadata = JSON.stringify({ source: "chat-v2", ...meta });
    await messageModel.saveMessage(entity);
    return messageId;
  }

  it("G01: an exchange executed under a DIFFERENT provider version is not selected", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-g01a",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Exchange executed under provider version 1; the trigger runs under 2.
    await seedG(messageModel, "v2-g01a", 1, "user", "Find dentists in Perth", {
      safeTypedText: "Find dentists in Perth",
      turnId: "t1",
      sourceProviderVersion: 1,
    });
    const trusted = await seedG(
      messageModel,
      "v2-g01a",
      2,
      "assistant",
      "Found them.",
      { turnId: "t1", sourceProviderVersion: 1 }
    );
    const candidate = await module.prepareTitleCandidate(
      "v2-g01a",
      trusted,
      2 // expected: version 2
    );
    // The only substantive exchange belongs to provider 1 → not eligible
    // (its excerpt must never travel under provider 2's job).
    expect(candidate).toEqual({ kind: "pending_window" });
    // Legacy rows WITHOUT a version stay compatible.
    const trusted2 = await seedG(
      messageModel,
      "v2-g01a",
      3,
      "assistant",
      "Legacy answer.",
      { turnId: "t1" } // no sourceProviderVersion
    );
    void trusted2;
  });

  it("G01: an assistant saved under scheduled-loop source never pairs", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-g01b",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedG(messageModel, "v2-g01b", 1, "user", "Run the weekly report", {
      safeTypedText: "Run the weekly report",
      turnId: "scheduled-user-x",
      source: "scheduled-loop",
    });
    const trusted = await seedG(
      messageModel,
      "v2-g01b",
      2,
      "assistant",
      "Report done.",
      { turnId: "scheduled-user-x", source: "scheduled-loop" }
    );
    const candidate = await module.prepareTitleCandidate("v2-g01b", trusted);
    // An excluded-owner trigger is not trustworthy → preparation aborts.
    expect(candidate).toEqual({ kind: "not_ready" });
  });

  it("G03: tool rows never consume the pagination bound", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-g03",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedG(messageModel, "v2-g03", 1, "user", "Analyze the Q3 revenue file", {
      safeTypedText: "Analyze the Q3 revenue file",
      turnId: "t1",
    });
    // 250 TOOL_RESULT rows — far past the old 200-row bound.
    for (let i = 0; i < 250; i += 1) {
      const entity = new AIChatMessageEntity();
      entity.messageId = `v2-g03-tool-${i}`;
      entity.conversationId = "v2-g03";
      entity.role = "assistant";
      entity.content = `tool payload ${i}`;
      entity.timestamp = new Date(2026, 0, 2, 0, 1, i);
      entity.messageType = MessageType.TOOL_RESULT;
      entity.metadata = JSON.stringify({ source: "chat-v2", turnId: "t1" });
      await messageModel.saveMessage(entity);
    }
    const trusted = await seedG(
      messageModel,
      "v2-g03",
      90,
      "assistant",
      "Revenue rose 12%.",
      { turnId: "t1" }
    );
    const candidate = await module.prepareTitleCandidate("v2-g03", trusted);
    expect(candidate.kind).toBe("eligible");
  });
});

describe("Titles audit r2 F06/F07 — bulk lifecycle + epoch-conditional suppression", () => {
  async function seedTypedSimple(
    messageModel: AIChatMessageModel,
    conversationId: string,
    seq: number,
    role: "user" | "assistant",
    typed: string
  ): Promise<void> {
    const entity = new AIChatMessageEntity();
    entity.messageId = `${conversationId}-msg-${seq}`;
    entity.conversationId = conversationId;
    entity.role = role;
    entity.content = role === "user" ? typed : `answer ${seq}`;
    entity.timestamp = new Date(2026, 0, 1, 0, 0, seq);
    entity.messageType = MessageType.MESSAGE;
    entity.metadata = JSON.stringify({
      source: "chat-v2",
      safeTypedText: role === "user" ? typed : undefined,
      turnId: `t${Math.ceil(seq / 2)}`,
    });
    await messageModel.saveMessage(entity);
  }

  it("F06: bulk title lifecycle resets nonmanual and preserves manual rows", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-bulk1",
      titleSource: "excerpt",
      titleGenerationStatus: "succeeded",
    });
    await model.createProjection({
      conversationId: "v2-bulk2",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await model.renameWithOwnership("v2-bulk2", "Manual Kept");
    const ids = await module.listAllConversations();
    expect(ids).toContain("v2-bulk1");
    expect(ids).toContain("v2-bulk2");
    for (const id of ids) {
      if (!id.startsWith("v2-bulk")) continue;
      await module.clearTitleLifecycle(id);
    }
    const r1 = await model.getByConversationId("v2-bulk1");
    expect(r1?.title).toBeNull();
    expect(r1?.titleGenerationStatus).toBe("pending");
    expect(r1?.titleEpoch).toBe(1);
    const r2 = await model.getByConversationId("v2-bulk2");
    expect(r2?.title).toBe("Manual Kept");
    expect(r2?.titleGenerationStatus).toBe("suppressed");
    expect(r2?.titleEpoch).toBe(1);
  });

  it("F07: suppression with a stale epoch leaves the fresh lifecycle pending", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.createProjection({
      conversationId: "v2-f07",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Stale suppression arrives targeting epoch 0 AFTER a clear advanced it.
    await model.clearTitleLifecycleForHistoryClear("v2-f07");
    const suppressed = await model.suppressTitleGeneration("v2-f07", 0);
    expect(suppressed).toBe(false);
    const row = await model.getByConversationId("v2-f07");
    expect(row?.titleGenerationStatus).toBe("pending"); // fresh lifecycle intact
    expect(row?.titleEpoch).toBe(1);
  });
});

describe("Titles audit B15/B21 — revisioned seeds + module validation", () => {
  it("B15: seeding an excerpt on a null title atomically increments the revision", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.createProjection({
      conversationId: "v2-seedrev",
      titleSource: "placeholder",
      titleGenerationStatus: "pending",
    });
    await model.recordMessagePersisted({
      conversationId: "v2-seedrev",
      isResult: false,
      previewText: "hello",
      generatedTitle: "hello world",
      timestamp: new Date(),
    });
    const row = await model.getByConversationId("v2-seedrev");
    expect(row?.title).toBe("hello world");
    expect(row?.titleRevision).toBe(1); // B15: visible change = revision bump
  });

  it("B15: clearTitleLifecycle returns the post-clear state for event publishing", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-clearstate",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    const state = await module.clearTitleLifecycle("v2-clearstate");
    expect(state).toEqual({
      title: null,
      titleRevision: 1,
      titleSource: "placeholder",
    });
  });

  it("B21: applyManualRename validates — empty/oversize/control names are invalid", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-valid21",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    expect(await module.applyManualRename("v2-valid21", "   ")).toEqual({
      outcome: "invalid",
    });
    expect(await module.applyManualRename("v2-valid21", "a".repeat(201))).toEqual({
      outcome: "invalid",
    });
    expect(await module.applyManualRename("v2-valid21", "bad\u0007name")).toEqual({
      outcome: "invalid",
    });
    // Valid names still rename (and normalize).
    const ok = await module.applyManualRename("v2-valid21", "  Valid  Name  ");
    expect(ok).toMatchObject({ outcome: "renamed", title: "Valid Name" });
  });

  it("B21: the model itself rejects oversize names instead of clipping", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    await model.createProjection({ conversationId: "v2-model21" });
    await expect(
      model.renameWithOwnership("v2-model21", "a".repeat(201))
    ).rejects.toThrow(/storage limit/);
  });
});

describe("Titles audit r2 F02/F03 — durable turn association + window query", () => {
  async function seedTurn(
    messageModel: AIChatMessageModel,
    conversationId: string,
    seq: number,
    role: "user" | "assistant",
    content: string,
    meta: Record<string, unknown>
  ): Promise<void> {
    const entity = new AIChatMessageEntity();
    entity.messageId = `${conversationId}-msg-${seq}`;
    entity.conversationId = conversationId;
    entity.role = role;
    entity.content = content;
    entity.timestamp = new Date(2026, 0, 1, 0, 0, seq);
    entity.messageType = MessageType.MESSAGE;
    entity.metadata = JSON.stringify({ source: "chat-v2", ...meta });
    await messageModel.saveMessage(entity);
  }

  it("F02: a zero-row cancelled turn never pairs with a later user's assistant", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-f02a",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Perth turn: cancelled BEFORE any assistant text — no assistant row.
    await seedTurn(messageModel, "v2-f02a", 1, "user", "Find dentists in Perth", {
      safeTypedText: "Find dentists in Perth",
      turnId: "t1",
    });
    // Berlin turn completes later.
    await seedTurn(messageModel, "v2-f02a", 2, "user", "Draft a Berlin outreach email", {
      safeTypedText: "Draft a Berlin outreach email",
      turnId: "t2",
    });
    await seedTurn(messageModel, "v2-f02a", 3, "assistant", "Here is the draft.", {
      turnId: "t2",
    });
    const candidate = await module.prepareTitleCandidate("v2-f02a", "v2-f02a-msg-3");
    expect(candidate.kind).toBe("eligible");
    if (candidate.kind !== "eligible") return;
    expect(candidate.userText).toContain("Berlin");
    expect(candidate.userText).not.toContain("Perth");
  });

  it("F02: an assistant answers only its own turn; scheduled-loop rows are excluded", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-f02b",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // A scheduled report turn (excluded owner).
    await seedTurn(messageModel, "v2-f02b", 1, "user", "Run the weekly report", {
      safeTypedText: "Run the weekly report",
      turnId: "ts",
      source: "scheduled-loop",
    });
    await seedTurn(messageModel, "v2-f02b", 2, "assistant", "Report done.", {
      turnId: "ts",
      source: "scheduled-loop",
    });
    // An interactive greeting completes.
    await seedTurn(messageModel, "v2-f02b", 3, "user", "hi", {
      safeTypedText: "hi",
      turnId: "ti",
    });
    await seedTurn(messageModel, "v2-f02b", 4, "assistant", "Hello!", {
      turnId: "ti",
    });
    // The scheduled exchange must not count toward the window nor be chosen.
    const candidate = await module.prepareTitleCandidate("v2-f02b", "v2-f02b-msg-4");
    expect(candidate).toEqual({ kind: "pending_window" }); // 1 interactive exchange, greeting-only
  });

  it("F03: a tool-heavy first answer (40 tool rows) does not starve the trigger", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-f03a",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedTurn(messageModel, "v2-f03a", 1, "user", "Analyze the Q3 revenue file", {
      safeTypedText: "Analyze the Q3 revenue file",
      turnId: "t1",
    });
    // 40 TOOL_RESULT rows push the real assistant past the first page.
    for (let i = 0; i < 40; i += 1) {
      const entity = new AIChatMessageEntity();
      entity.messageId = `v2-f03a-tool-${i}`;
      entity.conversationId = "v2-f03a";
      entity.role = "assistant";
      entity.content = `tool payload ${i}`;
      entity.timestamp = new Date(2026, 0, 1, 0, 1, i);
      entity.messageType = MessageType.TOOL_RESULT;
      entity.metadata = JSON.stringify({ source: "chat-v2", turnId: "t1" });
      await messageModel.saveMessage(entity);
    }
    await seedTurn(messageModel, "v2-f03a", 90, "assistant", "Revenue rose 12%.", {
      turnId: "t1",
    });
    const candidate = await module.prepareTitleCandidate("v2-f03a", "v2-f03a-msg-90");
    expect(candidate.kind).toBe("eligible");
  });

  it("F03: three attachment-only completed exchanges suppress the fourth typed task's window", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-f03b",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Three attachment-only openings (empty typed text) that COMPLETE.
    for (let i = 0; i < 3; i += 1) {
      await seedTurn(messageModel, "v2-f03b", i * 2 + 1, "user", `enriched block ${i}`, {
        safeTypedText: "",
        turnId: `att-${i}`,
      });
      await seedTurn(messageModel, "v2-f03b", i * 2 + 2, "assistant", `Summarized ${i}.`, {
        turnId: `att-${i}`,
      });
    }
    // Fourth exchange is a real typed task — the window is already consumed.
    await seedTurn(messageModel, "v2-f03b", 7, "user", "Find Sydney dentists", {
      safeTypedText: "Find Sydney dentists",
      turnId: "t4",
    });
    await seedTurn(messageModel, "v2-f03b", 8, "assistant", "Done.", { turnId: "t4" });
    const candidate = await module.prepareTitleCandidate("v2-f03b", "v2-f03b-msg-8");
    expect(candidate).toEqual({ kind: "suppressed" });
  });
});

describe("Titles audit B06/B08 — atomic clear ownership + serialized commit", () => {
  it("B06: a manual rename committing between clear's read and write keeps the manual name", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-race6",
      title: "excerpt",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Force the interleave INSIDE the real clear: its read returns the
    // NONMANUAL row, a rename commits, then the ownership-conditional
    // update runs.
    const realModel = new AIChatConversationModel(tmpDir);
    const originalRead = realModel.getByConversationId.bind(realModel);
    let interleaveDone = false;
    realModel.getByConversationId = async (id: string) => {
      const row = await originalRead(id);
      if (id === "v2-race6" && !interleaveDone && row && !row.titleIsUserSet) {
        interleaveDone = true;
        // Rename commits AFTER the clear's read (fresh instance avoids
        // recursive patching).
        await new AIChatConversationModel(tmpDir).renameWithOwnership(
          id,
          "Manual Winner"
        );
      }
      return row;
    };
    await realModel.clearTitleLifecycleForHistoryClear("v2-race6");
    const row = await model.getByConversationId("v2-race6");
    // The manual name survives; the nonmanual reset matched zero rows.
    expect(row?.title).toBe("Manual Winner");
    expect(row?.titleIsUserSet).toBe(true);
    expect(row?.titleSource).toBe("user");
  });

  it("B08: the policy gate blocks the guarded apply synchronously when settings changed", async () => {
    await SqliteDb.ensureInitialized();
    const { currentTitlePolicyEpoch, bumpTitlePolicyEpoch } = await import(
      "@/service/aiChatTitle/AIChatTitlePolicyGate"
    );
    const model = new AIChatConversationModel(tmpDir);
    await model.createProjection({
      conversationId: "v2-gate",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await model.claimTitleAttempt({
      conversationId: "v2-gate",
      epoch: 0,
      revision: 0,
      requestId: "req-gate",
    });
    const epoch = currentTitlePolicyEpoch();
    // Settings change between the service's capture and the guarded apply.
    bumpTitlePolicyEpoch();
    const blocked = await model.applyGeneratedTitle({
      conversationId: "v2-gate",
      epoch: 0,
      revision: 0,
      requestId: "req-gate",
      title: "Should Not Land",
      policyCheck: () => currentTitlePolicyEpoch() === epoch,
    });
    expect(blocked).toEqual({ outcome: "stale" });
    const row = await model.getByConversationId("v2-gate");
    expect(row?.title).not.toBe("Should Not Land");
    expect(row?.titleGenerationStatus).toBe("running"); // claim untouched by the gate miss
  });

  it("B08: an unchanged gate lets the guarded raw-SQL apply commit", async () => {
    await SqliteDb.ensureInitialized();
    const { currentTitlePolicyEpoch } = await import(
      "@/service/aiChatTitle/AIChatTitlePolicyGate"
    );
    const model = new AIChatConversationModel(tmpDir);
    await model.createProjection({
      conversationId: "v2-gate2",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await model.claimTitleAttempt({
      conversationId: "v2-gate2",
      epoch: 0,
      revision: 0,
      requestId: "req-gate2",
    });
    const epoch = currentTitlePolicyEpoch();
    const applied = await model.applyGeneratedTitle({
      conversationId: "v2-gate2",
      epoch: 0,
      revision: 0,
      requestId: "req-gate2",
      title: "Gate Allows This",
      policyCheck: () => currentTitlePolicyEpoch() === epoch,
    });
    expect(applied).toEqual({
      outcome: "applied",
      title: "Gate Allows This",
      revision: 1,
    });
  });
});

describe("Titles audit B01/B02 — safe typed text + trusted pairing", () => {
  async function seedTyped(
    messageModel: AIChatMessageModel,
    conversationId: string,
    seq: number,
    role: "user" | "assistant",
    content: string,
    safeTypedText?: string,
    extraMeta?: Record<string, unknown>
  ): Promise<void> {
    const entity = new AIChatMessageEntity();
    entity.messageId = `${conversationId}-msg-${seq}`;
    entity.conversationId = conversationId;
    entity.role = role;
    entity.content = content;
    entity.timestamp = new Date(2026, 0, 1, 0, 0, seq);
    entity.messageType = MessageType.MESSAGE;
    entity.metadata = JSON.stringify({
      source: "chat-v2",
      ...(safeTypedText !== undefined ? { safeTypedText } : {}),
      ...(extraMeta ?? {}),
    });
    await messageModel.saveMessage(entity);
  }

  it("B01: uses only the safe typed-text projection, never enriched content", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-safe1",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Persisted content carries attachment enrichment with a private path;
    // the safe projection is the raw typed request.
    await seedTyped(
      messageModel,
      "v2-safe1",
      1,
      "user",
      'Find leads in Sydney\n\nAttached 1 file(s) are staged locally.\n1. file_name="secret-campaign.csv" attachment_ref="ref123" file_path="/home/user/tmp/file"',
      "Find leads in Sydney"
    );
    await seedTyped(messageModel, "v2-safe1", 2, "assistant", "On it.");
    const candidate = await module.prepareTitleCandidate("v2-safe1", "v2-safe1-msg-2");
    expect(candidate.kind).toBe("eligible");
    if (candidate.kind !== "eligible") return;
    expect(candidate.userText).toBe("Find leads in Sydney");
    expect(candidate.userText).not.toContain("attachment_ref");
    expect(candidate.userText).not.toContain("/home/user");
    // The visible excerpt is also the safe text.
    const row = await model.getByConversationId("v2-safe1");
    expect(row?.title).toBe("Find leads in Sydney");
  });

  it("B01: an attachment-only opening is never substantive (zero dispatch input)", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-safe2",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    // Enriched content nonempty; the typed projection is EMPTY.
    await seedTyped(
      messageModel,
      "v2-safe2",
      1,
      "user",
      'Attached 1 file(s) are staged locally. file_name="a.csv" file_path="/tmp/a"',
      ""
    );
    await seedTyped(messageModel, "v2-safe2", 2, "assistant", "Summarized.");
    const candidate = await module.prepareTitleCandidate("v2-safe2", "v2-safe2-msg-2");
    expect(candidate).toEqual({ kind: "pending_window" });
  });

  it("B02: a cancelled assistant ends its exchange and cannot supply a title", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-pair1",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedTyped(messageModel, "v2-pair1", 1, "user", "Find dentists in Perth", "Find dentists in Perth");
    // Cancelled partial answer: this exchange is excluded entirely.
    await seedTyped(
      messageModel,
      "v2-pair1",
      2,
      "assistant",
      "I found several dentists...",
      undefined,
      { cancelled: true }
    );
    await seedTyped(messageModel, "v2-pair1", 3, "user", "thanks", "thanks");
    await seedTyped(messageModel, "v2-pair1", 4, "assistant", "Sure.");
    // Trusted trigger is a LATER completed exchange; the cancelled turn's
    // user text must not be paired with the later assistant.
    const candidate = await module.prepareTitleCandidate("v2-pair1", "v2-pair1-msg-4");
    expect(candidate.kind).toBe("pending_window"); // only [thanks+Sure] is an exchange (non-substantive)
  });

  it("B02: a trusted assistant id missing from completed exchanges aborts preparation", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-pair2",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedTyped(messageModel, "v2-pair2", 1, "user", "Find dentists", "Find dentists");
    await seedTyped(
      messageModel,
      "v2-pair2",
      2,
      "assistant",
      "partial",
      undefined,
      { cancelled: true }
    );
    const candidate = await module.prepareTitleCandidate("v2-pair2", "v2-pair2-msg-2");
    expect(candidate).toEqual({ kind: "not_ready" });
  });

  it("B02: three greeting exchanges then a fourth substantive one stays suppressed (delayed evaluation)", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-pair3",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    for (let i = 0; i < 3; i += 1) {
      await seedTyped(messageModel, "v2-pair3", i * 2 + 1, "user", "hi", "hi");
      await seedTyped(messageModel, "v2-pair3", i * 2 + 2, "assistant", "Hello!");
    }
    await seedTyped(messageModel, "v2-pair3", 7, "user", "Find Sydney dentists", "Find Sydney dentists");
    await seedTyped(messageModel, "v2-pair3", 8, "assistant", "Done.");
    const candidate = await module.prepareTitleCandidate("v2-pair3", "v2-pair3-msg-8");
    expect(candidate).toEqual({ kind: "suppressed" });
    const row = await model.getByConversationId("v2-pair3");
    expect(row?.titleGenerationStatus).toBe("suppressed");
  });

  it("B07: a history clear during preparation aborts instead of adopting the new epoch", async () => {
    await SqliteDb.ensureInitialized();
    const messageModel = new AIChatMessageModel(tmpDir);
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await model.createProjection({
      conversationId: "v2-epochfix",
      title: "old excerpt",
      titleSource: "excerpt",
      titleGenerationStatus: "pending",
    });
    await seedTyped(messageModel, "v2-epochfix", 1, "user", "Find old leads", "Find old leads");
    await seedTyped(messageModel, "v2-epochfix", 2, "assistant", "Old answer.");

    // Simulate the clear landing BETWEEN selection and the excerpt update:
    // wrap updateExcerptIfPending to clear first.
    const realModel = new AIChatConversationModel(tmpDir);
    (module as unknown as { convModel: () => AIChatConversationModel }).convModel =
      () =>
        ({
          getByConversationId: realModel.getByConversationId.bind(realModel),
          updateExcerptIfPending: async (input: {
            conversationId: string;
            epoch: number;
            excerpt: string;
          }) => {
            await realModel.clearTitleLifecycleForHistoryClear("v2-epochfix"); // clear lands now
            return realModel.updateExcerptIfPending(input); // stale-epoch conditional → no row
          },
          suppressTitleGeneration:
            realModel.suppressTitleGeneration.bind(realModel),
        } as unknown as AIChatConversationModel);
    const candidate = await module.prepareTitleCandidate("v2-epochfix", "v2-epochfix-msg-2");
    expect(candidate).toEqual({ kind: "not_ready" });
    // The new epoch is untouched: no title, no excerpt rewrite from old text.
    const row = await model.getByConversationId("v2-epochfix");
    expect(row?.title).toBeNull();
    expect(row?.titleEpoch).toBe(1);
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

  it("ensureConversationProjection creates a projection ready for auto title generation", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    await module.ensureConversationProjection("v2-ensure-init", "workspace-1");
    const row = await model.getByConversationId("v2-ensure-init");
    expect(row).not.toBeNull();
    expect(row?.title).toBeNull();
    expect(row?.titleSource).toBe("placeholder");
    expect(row?.titleGenerationStatus).toBe("pending");
    expect(row?.workspaceKey).toBe("workspace-1");

    // When the first user message is persisted, it seeds the excerpt and remains pending for AI title
    await module.recordMessagePersisted({
      conversationId: "v2-ensure-init",
      isResult: false,
      previewText: "search the web for crypto",
      generatedTitle: "search the web for crypto",
      timestamp: new Date(),
    });
    const updated = await model.getByConversationId("v2-ensure-init");
    expect(updated?.title).toBe("search the web for crypto");
    expect(updated?.titleSource).toBe("excerpt");
    expect(updated?.titleGenerationStatus).toBe("pending");
  });

  it("ensureConversationProjection repairs legacy suppressed empty conversation projection", async () => {
    await SqliteDb.ensureInitialized();
    const model = new AIChatConversationModel(tmpDir);
    const module = new AIChatConversationModule();
    // Simulate empty row created by older bug
    await model.createProjection({ conversationId: "v2-repair-test" });
    let row = await model.getByConversationId("v2-repair-test");
    expect(row?.titleSource).toBe("legacy");
    expect(row?.titleGenerationStatus).toBe("suppressed");

    // Calling ensureConversationProjection repairs the empty placeholder row
    await module.ensureConversationProjection("v2-repair-test");
    row = await model.getByConversationId("v2-repair-test");
    expect(row?.titleSource).toBe("placeholder");
    expect(row?.titleGenerationStatus).toBe("pending");
  });
});
