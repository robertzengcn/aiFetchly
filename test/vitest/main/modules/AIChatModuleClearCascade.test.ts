/**
 * C1 regression: v1 `AIChatModule.clearConversation` / `clearAllHistory` must
 * invalidate the preserved-tool-output scope BEFORE deleting messages, mirroring
 * `AIChatV2Module.clearConversation`. A failed fence must abort the clear (or
 * skip that conversation in the bulk path) — a successful delete with a stale
 * epoch reopens the resurrection window where cleared conversations' captured
 * artifacts stay readable.
 *
 * Run: npx vitest --config vite.main.config.mjs run test/vitest/main/modules/AIChatModuleClearCascade.test.ts
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const invalidateMock = vi.fn().mockResolvedValue(undefined);
const deleteByConversation = vi.fn().mockResolvedValue(undefined);
const deleteAllAttachments = vi.fn().mockResolvedValue(undefined);
const deleteConversation = vi.fn().mockResolvedValue(1);
const deleteAllMessages = vi.fn().mockResolvedValue(3);
const getAllConversations = vi.fn().mockResolvedValue(["conv-a", "conv-b"]);

vi.mock("@/modules/ToolResultModule", () => ({
  ToolResultModule: class {
    invalidateScope(
      ...args: unknown[]
    ): Promise<unknown> {
      return (invalidateMock as (...a: unknown[]) => Promise<unknown>)(...args);
    }
  },
}));
vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: class {
    deleteByConversation(
      ...args: unknown[]
    ): Promise<unknown> {
      return (deleteByConversation as (...a: unknown[]) => Promise<unknown>)(
        ...args
      );
    }
    deleteAll(
      ...args: unknown[]
    ): Promise<unknown> {
      return (deleteAllAttachments as (...a: unknown[]) => Promise<unknown>)(
        ...args
      );
    }
  },
}));
vi.mock("@/model/AIChatMessage.model", () => ({
  AIChatMessageModel: class {
    deleteConversation(
      ...args: unknown[]
    ): Promise<unknown> {
      return (deleteConversation as (...a: unknown[]) => Promise<unknown>)(
        ...args
      );
    }
    deleteAllMessages(
      ...args: unknown[]
    ): Promise<unknown> {
      return (deleteAllMessages as (...a: unknown[]) => Promise<unknown>)(
        ...args
      );
    }
    getAllConversations(
      ...args: unknown[]
    ): Promise<unknown> {
      return (getAllConversations as (...a: unknown[]) => Promise<unknown>)(
        ...args
      );
    }
  },
}));
// BaseModule constructor touches Token/SqliteDb; stub it to a no-op so no DB is opened.
vi.mock("@/modules/baseModule", () => ({
  BaseModule: class {
    protected dbpath = "";
  },
}));

import { AIChatModule } from "@/modules/AIChatModule";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";

describe("AIChatModule clear-path tool-output fence (C1)", () => {
  beforeEach(() => {
    invalidateMock.mockResolvedValue(undefined);
    invalidateMock.mockClear();
    deleteByConversation.mockClear();
    deleteAllAttachments.mockClear();
    deleteConversation.mockClear();
    deleteAllMessages.mockClear();
    getAllConversations.mockClear();
    getAllConversations.mockResolvedValue(["conv-a", "conv-b"]);
  });

  it("clearConversation invalidates the tool-output scope before deleting messages", async () => {
    const m = new AIChatModule();
    await m.clearConversation("conv-x");

    expect(invalidateMock).toHaveBeenCalledWith("default", "conv-x");
    expect(deleteByConversation).toHaveBeenCalledWith("conv-x");
    expect(deleteConversation).toHaveBeenCalledWith("conv-x");
    // Fence ran before the delete (call order).
    const invalidateOrder = invalidateMock.mock.invocationCallOrder[0];
    const deleteOrder = deleteConversation.mock.invocationCallOrder[0];
    expect(invalidateOrder).toBeLessThan(deleteOrder);
  });

  it("clearConversation aborts the clear when invalidateScope fails (no delete runs)", async () => {
    invalidateMock.mockRejectedValue(new Error("sqlite busy"));
    const m = new AIChatModule();

    await expect(m.clearConversation("conv-x")).rejects.toMatchObject({
      name: "RecoverableHistoryError",
      code: "COMPACTION_CONTEXT_REJECTED",
    });
    // A failed fence must not be followed by a delete.
    expect(deleteByConversation).not.toHaveBeenCalled();
    expect(deleteConversation).not.toHaveBeenCalled();
  });

  it("clearAllHistory invalidates every conversation's scope before deleting its messages", async () => {
    const m = new AIChatModule();
    await m.clearAllHistory();

    expect(invalidateMock).toHaveBeenCalledWith("default", "conv-a");
    expect(invalidateMock).toHaveBeenCalledWith("default", "conv-b");
    expect(deleteConversation).toHaveBeenCalledWith("conv-a");
    expect(deleteConversation).toHaveBeenCalledWith("conv-b");
    // The legacy deleteAllMessages path is no longer used (per-conversation delete).
    expect(deleteAllMessages).not.toHaveBeenCalled();
  });

  it("clearAllHistory skips a conversation whose fence fails (no delete for it, others proceed)", async () => {
    // First conversation's fence fails, second succeeds.
    invalidateMock
      .mockRejectedValueOnce(new Error("sqlite busy"))
      .mockResolvedValueOnce(undefined);
    const m = new AIChatModule();

    await m.clearAllHistory();

    // First conversation (conv-a): fence failed → NOT deleted.
    expect(deleteConversation).not.toHaveBeenCalledWith("conv-a");
    // Second conversation (conv-b): fence succeeded → deleted.
    expect(deleteConversation).toHaveBeenCalledWith("conv-b");
  });
});
