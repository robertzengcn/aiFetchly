import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiMemoryPage from "@/views/pages/systemsetting/aiMemory.vue";

const listMock = vi.fn();
vi.mock("@/views/api/aiUserMemory", () => ({
  aiUserMemoryApi: { list: (...a: unknown[]) => listMock(...a) },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiMemory: { title: "Memories" }, system_settings: {} } },
});

function mountPage() {
  return mount(AiMemoryPage, {
    global: { plugins: [i18n], stubs: { VIcon: true } },
  });
}

describe("AiMemoryPage load", () => {
  beforeEach(() => listMock.mockReset());

  it("loads active memories on mount with default filters", async () => {
    listMock.mockResolvedValue({ status: true, msg: "", data: [] });
    mountPage();
    await flushPromises();
    expect(listMock).toHaveBeenCalledWith({
      status: "active",
      limit: 200,
      offset: 0,
    });
  });

  it("exposes loaded memories", async () => {
    listMock.mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          id: 1,
          memoryId: "m1",
          type: "fact",
          title: "T",
          content: "C",
          status: "active",
          confidence: 90,
          createdAt: "x",
          updatedAt: "x",
        },
      ],
    });
    const w = mountPage();
    await flushPromises();
    expect((w.vm.memories as unknown[]).length).toBe(1);
  });
});
