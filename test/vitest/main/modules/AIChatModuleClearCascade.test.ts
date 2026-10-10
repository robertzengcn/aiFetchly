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

// I8: the clear path must evict the cached tool-result wiring for the cleared
// conversation so the long-lived main process does not retain a CachedWiring
// (ToolResultModule + DB-connection refs) for a conversation whose messages are
// gone. The eviction runs AFTER the successful delete; an aborted clear (fence
// failure) must NOT evict — the conversation still exists and its wiring may be
// reused.
const clearWiringMock = vi.fn();
vi.mock("@/service/agentTools/toolResultContext", () => ({
  clearToolResultContextCache: (
    ...args: unknown[]
  ): void => {
    clearWiringMock(...args);
  },
}));

import { AIChatModule } from "@/modules/AIChatModule";

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
    clearWiringMock.mockClear();
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

describe("AIChatModule clear-path wiring cache eviction (I8)", () => {
  beforeEach(() => {
    invalidateMock.mockResolvedValue(undefined);
    invalidateMock.mockClear();
    deleteByConversation.mockClear();
    deleteConversation.mockClear();
    getAllConversations.mockClear();
    getAllConversations.mockResolvedValue(["conv-a", "conv-b"]);
    clearWiringMock.mockClear();
  });

  it("clearConversation evicts the cached tool-result wiring for the cleared conversation after the delete", async () => {
    const m = new AIChatModule();
    await m.clearConversation("conv-x");

    // Eviction targets ONLY the cleared conversation (not a full reset).
    expect(clearWiringMock).toHaveBeenCalledWith("conv-x");
    expect(clearWiringMock).toHaveBeenCalledTimes(1);
    // Eviction runs AFTER the delete (call order) — the wiring may be reused
    // during the delete path, so it must not be dropped before the delete lands.
    const deleteOrder = deleteConversation.mock.invocationCallOrder[0];
    const evictOrder = clearWiringMock.mock.invocationCallOrder[0];
    expect(evictOrder).toBeGreaterThan(deleteOrder);
  });

  it("clearConversation does NOT evict the wiring when the fence fails (conversation still live)", async () => {
    invalidateMock.mockRejectedValue(new Error("sqlite busy"));
    const m = new AIChatModule();

    await expect(m.clearConversation("conv-x")).rejects.toMatchObject({
      name: "RecoverableHistoryError",
    });
    // The clear aborted — the conversation still exists, its wiring may still
    // serve in-flight retrievals, so it must NOT be evicted.
    expect(clearWiringMock).not.toHaveBeenCalled();
  });

  it("clearAllHistory evicts the wiring for every successfully cleared conversation", async () => {
    const m = new AIChatModule();
    await m.clearAllHistory();

    // One eviction per cleared conversation, targeting each by id.
    expect(clearWiringMock).toHaveBeenCalledWith("conv-a");
    expect(clearWiringMock).toHaveBeenCalledWith("conv-b");
    expect(clearWiringMock).toHaveBeenCalledTimes(2);
  });

  it("clearAllHistory does NOT evict the wiring for a conversation whose fence failed", async () => {
    // First conversation's fence fails, second succeeds.
    invalidateMock
      .mockRejectedValueOnce(new Error("sqlite busy"))
      .mockResolvedValueOnce(undefined);
    const m = new AIChatModule();

    await m.clearAllHistory();

    // Only the conversation that was actually cleared (conv-b) is evicted.
    expect(clearWiringMock).not.toHaveBeenCalledWith("conv-a");
    expect(clearWiringMock).toHaveBeenCalledWith("conv-b");
    expect(clearWiringMock).toHaveBeenCalledTimes(1);
  });
});
