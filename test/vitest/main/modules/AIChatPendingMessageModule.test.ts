import { describe, expect, it, vi, beforeEach } from "vitest";

const attachmentSave = vi.fn().mockResolvedValue(undefined);
const attachmentDeleteByMessageId = vi.fn().mockResolvedValue(1);
const attachmentGetByMessageId = vi.fn().mockResolvedValue([]);
const attachmentDeleteByConversation = vi.fn().mockResolvedValue(0);

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    createConversationIfNeeded: (existing?: string) =>
      existing && existing.startsWith("v2-") ? existing : "v2-created",
  })),
}));
vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn().mockImplementation(() => ({
    saveUploadedFiles: attachmentSave,
    deleteByMessageId: attachmentDeleteByMessageId,
    deleteByConversation: attachmentDeleteByConversation,
    getByMessageId: attachmentGetByMessageId,
  })),
}));

import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import {
  AIChatPendingMessagePreparationService,
  type AIChatPendingPreparedContent,
} from "@/service/AIChatPendingMessagePreparationService";
import { SqliteDb } from "@/config/SqliteDb";
import { resolveTestDbPath } from "@/config/testDbPath";
import fs from "node:fs";
import path from "node:path";

function fakePrep(
  override: Partial<AIChatPendingPreparedContent> = {}
): AIChatPendingMessagePreparationService {
  const fixed = { ...override };
  return {
    prepare: vi.fn(
      async (input: { request: { message: string } }) =>
        ({
          displayContent: input.request.message,
          modelContent: input.request.message,
          attachmentMetadata: undefined,
          messageMetadata: { source: "chat-v2" },
          imageAttachments: [],
          ...fixed,
        } as AIChatPendingPreparedContent)
    ),
  } as unknown as AIChatPendingMessagePreparationService;
}

function makeModule(
  override?: Partial<AIChatPendingPreparedContent>
): AIChatPendingMessageModule {
  return new AIChatPendingMessageModule(fakePrep(override));
}

beforeEach(async () => {
  vi.clearAllMocks();
  await SqliteDb.destroyInstance();
  const dir = resolveTestDbPath();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("scraper.db")) {
        try {
          fs.unlinkSync(path.join(dir, f));
        } catch {
          // ignore
        }
      }
    }
  }
});

describe("AIChatPendingMessageModule.createPendingMessage", () => {
  it("creates a queued row with deterministic ids", async () => {
    const module = makeModule();
    const result = await module.createPendingMessage({
      clientRequestId: "cr-1",
      request: { message: "hello", conversationId: "v2-c1" },
    });
    expect(result.conversationId).toBe("v2-c1");
    expect(result.status).toBe("queued");
    expect(result.pendingMessageId).toMatch(/^pending-/);
    const views = await module.listViews("v2-c1");
    expect(views.length).toBe(1);
    expect(views[0].content).toBe("hello");
    expect(views[0].sequence).toBeGreaterThan(0);
  });

  it("creates a v2 conversation id when none was supplied", async () => {
    const module = makeModule();
    const result = await module.createPendingMessage({
      clientRequestId: "cr-new",
      request: { message: "hello" },
    });
    expect(result.conversationId).toBe("v2-created");
  });

  it("rejects empty messages", async () => {
    const module = makeModule();
    await expect(
      module.createPendingMessage({
        clientRequestId: "cr-empty",
        request: { message: "" },
      })
    ).rejects.toMatchObject({ code: "EMPTY_MESSAGE" });
  });

  it("rejects content over the 32k limit", async () => {
    const module = makeModule();
    await expect(
      module.createPendingMessage({
        clientRequestId: "cr-long",
        request: { message: "x".repeat(32_001) },
      })
    ).rejects.toMatchObject({ code: "CONTENT_TOO_LONG" });
  });

  it("enforces the 20-message queue cap", async () => {
    const module = makeModule();
    for (let i = 0; i < 20; i += 1) {
      await module.createPendingMessage({
        clientRequestId: `cr-cap-${i}`,
        request: { message: `m${i}`, conversationId: "v2-cap" },
      });
    }
    await expect(
      module.createPendingMessage({
        clientRequestId: "cr-cap-overflow",
        request: { message: "one too many", conversationId: "v2-cap" },
      })
    ).rejects.toMatchObject({ code: "QUEUE_LIMIT_REACHED" });
  });

  it("persists image bytes and removes them when the row insert fails", async () => {
    const module = makeModule({
      imageAttachments: [
        {
          fileName: "a.png",
          mimeType: "image/png",
          sizeBytes: 3,
          contentBase64: "aGk=",
        },
      ],
    });
    // Seed a conflicting row for the SAME clientRequestId so create() throws
    // IDEMPOTENCY_CONFLICT after bytes were written.
    const seeder = makeModule({
      imageAttachments: [
        {
          fileName: "a.png",
          mimeType: "image/png",
          sizeBytes: 3,
          contentBase64: "aGk=",
        },
      ],
    });
    await seeder.createPendingMessage({
      clientRequestId: "cr-conflict",
      request: { message: "first", conversationId: "v2-conf" },
    });
    attachmentSave.mockClear();
    attachmentDeleteByMessageId.mockClear();

    await expect(
      module.createPendingMessage({
        clientRequestId: "cr-conflict",
        request: { message: "different", conversationId: "v2-conf" },
      })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(attachmentSave).toHaveBeenCalled();
    expect(attachmentDeleteByMessageId).toHaveBeenCalled();
  });
});

describe("AIChatPendingMessageModule views", () => {
  it("sanitizes rows: no modelContent, claimToken, or request options", async () => {
    const module = makeModule();
    await module.createPendingMessage({
      clientRequestId: "cr-view",
      request: { message: "secret-ish", conversationId: "v2-view" },
    });
    const views = await module.listViews("v2-view");
    const raw = JSON.stringify(views[0]);
    expect(raw).not.toContain("claimToken");
    expect(raw).not.toContain("modelContent");
    expect(raw).not.toContain("requestOptions");
    expect("modelContent" in views[0]).toBe(false);
  });

  it("computes canSteer only for queued text-only rows while running", async () => {
    const module = makeModule();
    await module.createPendingMessage({
      clientRequestId: "cr-steer",
      request: { message: "redirect", conversationId: "v2-steer" },
    });
    const whileRunning = await module.listViews("v2-steer", "running");
    expect(whileRunning[0].canSteer).toBe(true);
    const whileIdle = await module.listViews("v2-steer", "idle");
    expect(whileIdle[0].canSteer).toBe(false);
    const whileAwaiting = await module.listViews(
      "v2-steer",
      "awaiting_permission"
    );
    expect(whileAwaiting[0].canSteer).toBe(false);
  });

  it("attachments disable steering", async () => {
    const module = makeModule({
      attachmentMetadata: [
        {
          fileName: "doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          kind: "document",
        },
      ],
    });
    await module.createPendingMessage({
      clientRequestId: "cr-att",
      request: { message: "with file", conversationId: "v2-att" },
    });
    const views = await module.listViews("v2-att", "running");
    expect(views[0].canSteer).toBe(false);
    expect(views[0].attachmentMetadata?.length).toBe(1);
  });
});

describe("AIChatPendingMessageModule cancel/clear/steer-claim", () => {
  it("cancelPending removes the row from the queue and its bytes", async () => {
    const module = makeModule({
      imageAttachments: [
        {
          fileName: "x.png",
          mimeType: "image/png",
          sizeBytes: 3,
          contentBase64: "aGk=",
        },
      ],
    });
    const created = await module.createPendingMessage({
      clientRequestId: "cr-cancel",
      request: { message: "bye", conversationId: "v2-cancel" },
    });
    attachmentDeleteByMessageId.mockClear();

    const view = await module.cancelPending({
      conversationId: "v2-cancel",
      pendingMessageId: created.pendingMessageId,
    });
    expect(view.status).toBe("cancelled");
    expect(attachmentDeleteByMessageId).toHaveBeenCalledWith(
      `user-pending-${created.pendingMessageId}`
    );
  });

  it("cancelPending rejects a conversation mismatch", async () => {
    const module = makeModule();
    const created = await module.createPendingMessage({
      clientRequestId: "cr-mismatch",
      request: { message: "hi", conversationId: "v2-a" },
    });
    await expect(
      module.cancelPending({
        conversationId: "v2-b",
        pendingMessageId: created.pendingMessageId,
      })
    ).rejects.toMatchObject({ code: "CONVERSATION_MISMATCH" });
  });

  it("claimForSteering rejects messages with attachments", async () => {
    const module = makeModule({
      attachmentMetadata: [
        {
          fileName: "y.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          kind: "document",
        },
      ],
    });
    const created = await module.createPendingMessage({
      clientRequestId: "cr-steer-att",
      request: { message: "hi", conversationId: "v2-sa" },
    });
    await expect(
      module.claimForSteering({
        conversationId: "v2-sa",
        pendingMessageId: created.pendingMessageId,
        targetAssistantMessageId: "assistant-1",
      })
    ).rejects.toMatchObject({ code: "ATTACHMENTS_NOT_STEERABLE" });
  });

  it("clearConversation deletes rows and staged bytes", async () => {
    const module = makeModule();
    await module.createPendingMessage({
      clientRequestId: "cr-clear-1",
      request: { message: "a", conversationId: "v2-clear" },
    });
    await module.createPendingMessage({
      clientRequestId: "cr-clear-2",
      request: { message: "b", conversationId: "v2-clear" },
    });
    const deleted = await module.clearConversation("v2-clear");
    expect(deleted).toBe(2);
    const views = await module.listViews("v2-clear");
    expect(views.length).toBe(0);
  });
});
