import { describe, expect, it, vi, beforeEach } from "vitest";

const memDelete = vi.fn().mockResolvedValue(2);
const memDeleteAll = vi.fn().mockResolvedValue(5);
const compactDelete = vi.fn().mockResolvedValue(1);
const compactDeleteAll = vi.fn().mockResolvedValue(3);
const chatClear = vi.fn().mockResolvedValue(1);
const tombstoneMock = vi.fn().mockResolvedValue(undefined);
const invalidateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: class {
    deleteByConversation(...args: unknown[]): Promise<unknown> {
      return (memDelete as (...a: unknown[]) => Promise<unknown>)(...args);
    }
    deleteAllV2(...args: unknown[]): Promise<unknown> {
      return (memDeleteAll as (...a: unknown[]) => Promise<unknown>)(...args);
    }
  },
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: class {
    deleteByConversation(...args: unknown[]): Promise<unknown> {
      return (compactDelete as (...a: unknown[]) => Promise<unknown>)(...args);
    }
    deleteAllV2(...args: unknown[]): Promise<unknown> {
      return (compactDeleteAll as (...a: unknown[]) => Promise<unknown>)(...args);
    }
  },
}));
// Keep the rest of the AIChatV2Module surface stubbed so no DB is touched.
vi.mock("@/modules/AIChatModule", () => ({
  AIChatModule: class {
    clearConversation(...args: unknown[]): Promise<unknown> {
      return (chatClear as (...a: unknown[]) => Promise<unknown>)(...args);
    }
    getConversationsWithMetadata(): Promise<unknown[]> {
      return Promise.resolve([]);
    }
  },
}));
vi.mock("@/model/AIChatArchiveState.model", () => ({
  AIChatArchiveStateModel: class {
    tombstone(...args: unknown[]): Promise<unknown> {
      return (tombstoneMock as (...a: unknown[]) => Promise<unknown>)(...args);
    }
  },
}));
vi.mock("@/modules/AIChatCompactionModule", () => ({
  AIChatCompactionModule: class {
    invalidateConversation(...args: unknown[]): Promise<unknown> {
      return (invalidateMock as (...a: unknown[]) => Promise<unknown>)(...args);
    }
  },
}));
vi.mock("@/service/AIChatArchiveAppendCoupler", () => ({
  AIChatArchiveAppendCoupler: class {
    appendV2Message(): Promise<unknown> {
      return Promise.resolve(undefined);
    }
  },
}));
vi.mock("@/modules/AIArtifactModule", () => ({
  AIArtifactModule: class {
    deleteByConversation(): Promise<number> {
      return Promise.resolve(0);
    }
  },
}));
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): undefined {
      return undefined;
    }
  },
}));

import { AIChatV2Module } from "@/modules/AIChatV2Module";

describe("AIChatV2Module compact clear cascade", () => {
  beforeEach(() => {
    // Reset only this file's fn mocks (calls, not implementations).
    // NOTE: never vi.clearAllMocks() here — it breaks the constructable
    // `new Token()` mock from the factory above.
    for (const m of [
      memDelete,
      memDeleteAll,
      compactDelete,
      compactDeleteAll,
      chatClear,
      tombstoneMock,
      invalidateMock,
    ]) {
      m.mockClear();
    }
    // Restore the success defaults (fail-closed tests override per-case).
    tombstoneMock.mockResolvedValue(undefined);
    invalidateMock.mockResolvedValue(undefined);
    chatClear.mockResolvedValue(1);
    memDelete.mockResolvedValue(2);
    compactDelete.mockResolvedValue(1);
  });

  it("clearConversation also clears compact + session memory", async () => {
    const m = new AIChatV2Module();
    await m.clearConversation("v2-x");
    expect(tombstoneMock).toHaveBeenCalledWith("v2-x");
    expect(invalidateMock).toHaveBeenCalledWith("v2-x");
    expect(chatClear).toHaveBeenCalledWith("v2-x");
    expect(memDelete).toHaveBeenCalledWith("v2-x");
    expect(compactDelete).toHaveBeenCalledWith("v2-x");
  });

  it("clearAllV2History also clears all compact + session memory", async () => {
    const m = new AIChatV2Module();
    await m.clearAllV2History();
    expect(memDeleteAll).toHaveBeenCalled();
    expect(compactDeleteAll).toHaveBeenCalled();
  });

  it("aborts the clear when the archive tombstone fails (C-3/AC-13)", async () => {
    // Tombstone fails twice (initial + one retry): no messages deleted.
    tombstoneMock.mockRejectedValue(new Error("storage hiccup"));
    const m = new AIChatV2Module();
    await expect(m.clearConversation("v2-x")).rejects.toMatchObject({
      code: "COMPACTION_CONTEXT_REJECTED",
    });
    expect(chatClear).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("aborts the clear when compaction invalidate fails (C-3/AC-13)", async () => {
    invalidateMock.mockRejectedValue(new Error("storage hiccup"));
    const m = new AIChatV2Module();
    await expect(m.clearConversation("v2-x")).rejects.toMatchObject({
      code: "COMPACTION_CONTEXT_REJECTED",
    });
    expect(chatClear).not.toHaveBeenCalled();
  });
});
