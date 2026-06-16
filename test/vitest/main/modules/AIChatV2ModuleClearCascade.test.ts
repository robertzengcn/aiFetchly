import { describe, expect, it, vi } from "vitest";

const memDelete = vi.fn().mockResolvedValue(2);
const memDeleteAll = vi.fn().mockResolvedValue(5);
const compactDelete = vi.fn().mockResolvedValue(1);
const compactDeleteAll = vi.fn().mockResolvedValue(3);

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    deleteByConversation: memDelete,
    deleteAllV2: memDeleteAll,
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    deleteByConversation: compactDelete,
    deleteAllV2: compactDeleteAll,
  })),
}));
// Keep the rest of the AIChatV2Module surface stubbed so no DB is touched.
vi.mock("@/modules/AIChatModule", () => ({
  AIChatModule: vi.fn().mockImplementation(() => ({
    clearConversation: vi.fn().mockResolvedValue(1),
    getConversationsWithMetadata: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

import { AIChatV2Module } from "@/modules/AIChatV2Module";

describe("AIChatV2Module compact clear cascade", () => {
  it("clearConversation also clears compact + session memory", async () => {
    const m = new AIChatV2Module();
    await m.clearConversation("v2-x");
    expect(memDelete).toHaveBeenCalledWith("v2-x");
    expect(compactDelete).toHaveBeenCalledWith("v2-x");
  });

  it("clearAllV2History also clears all compact + session memory", async () => {
    const m = new AIChatV2Module();
    await m.clearAllV2History();
    expect(memDeleteAll).toHaveBeenCalled();
    expect(compactDeleteAll).toHaveBeenCalled();
  });
});
