import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiMemoryPage from "@/views/pages/systemsetting/aiMemory.vue";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";

// vi.mock factories are hoisted above top-level const, so we use vi.hoisted
// to make `api` available to both the hoisted factory and the test body.
const { api } = vi.hoisted(() => ({
  api: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("@/views/api/aiUserMemory", () => ({ aiUserMemoryApi: api }));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiMemory: {} } },
});

function mountPage() {
  return mount(AiMemoryPage, {
    global: { plugins: [i18n], stubs: { VIcon: true } },
  });
}

const mem: AIUserMemoryView = {
  id: 1,
  memoryId: "m1",
  type: "fact",
  title: "T",
  content: "C",
  status: "active",
  confidence: 90,
  createdAt: "x",
  updatedAt: "x",
};

describe("AiMemoryPage actions", () => {
  beforeEach(() => {
    api.list.mockReset();
    api.create.mockReset();
    api.update.mockReset();
    api.archive.mockReset();
    api.delete.mockReset();
    api.list.mockResolvedValue({ status: true, msg: "", data: [] });
  });

  it("opens the create dialog", async () => {
    const w = mountPage();
    await flushPromises();
    w.vm.openCreate();
    expect(w.vm.dialogMode).toBe("create");
    expect(w.vm.dialogVisible).toBe(true);
  });

  it("archives a memory then refreshes", async () => {
    api.archive.mockResolvedValue({ status: true, msg: "", data: null });
    const w = mountPage();
    await flushPromises();
    const before = api.list.mock.calls.length;
    await w.vm.handleArchive(mem);
    expect(api.archive).toHaveBeenCalledWith("m1");
    expect(api.list.mock.calls.length).toBeGreaterThan(before);
  });

  it("deletes a memory then refreshes", async () => {
    api.delete.mockResolvedValue({ status: true, msg: "", data: 1 });
    const w = mountPage();
    await flushPromises();
    const before = api.list.mock.calls.length;
    await w.vm.handleDelete(mem);
    expect(api.delete).toHaveBeenCalledWith("m1");
    expect(api.list.mock.calls.length).toBeGreaterThan(before);
  });
});
