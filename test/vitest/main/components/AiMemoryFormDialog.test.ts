import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiMemoryFormDialog from "@/views/pages/systemsetting/components/AiMemoryFormDialog.vue";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/views/api/aiUserMemory", () => ({
  aiUserMemoryApi: {
    create: (...a: unknown[]) => createMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiMemory: {
        dialog_title_create: "New",
        dialog_title_edit: "Edit",
        field_type: "Type",
        field_title: "Title",
        field_content: "Content",
        field_status: "Status",
        field_confidence: "Confidence",
        field_source: "Source",
        button_save: "Save",
        button_cancel: "Cancel",
        err_title_required: "need title",
        err_content_required: "need content",
        type_preference: "Preference",
        type_fact: "Fact",
        status_active: "Active",
        source_manual: "Manual",
      },
    },
  },
});

function mountDialog(props: Record<string, unknown>) {
  return mount(AiMemoryFormDialog, {
    props: { modelValue: true, mode: "create", memory: null, ...props },
    global: { plugins: [i18n], stubs: { VIcon: true } },
  });
}

function baseView(): AIUserMemoryView {
  return {
    id: 1,
    memoryId: "mem-1",
    type: "fact",
    title: "T",
    content: "C",
    status: "active",
    confidence: 80,
    sourceKind: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("AiMemoryFormDialog", () => {
  beforeEach(() => {
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("creates a memory in create mode", async () => {
    createMock.mockResolvedValue({ status: true, msg: "", data: baseView() });
    const w = mountDialog({ mode: "create" });
    w.vm.form.title = "My title";
    w.vm.form.content = "My content";
    w.vm.form.type = "fact";
    await w.vm.submit();
    expect(createMock).toHaveBeenCalledWith({
      type: "fact",
      title: "My title",
      content: "My content",
      confidence: 100,
    });
    expect(w.emitted("saved")).toHaveLength(1);
  });

  it("updates a memory in edit mode", async () => {
    updateMock.mockResolvedValue({ status: true, msg: "", data: baseView() });
    const w = mountDialog({ mode: "edit", memory: baseView() });
    w.vm.form.title = "Changed";
    await w.vm.submit();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: "mem-1",
        title: "Changed",
        status: "active",
      })
    );
    expect(w.emitted("saved")).toHaveLength(1);
  });

  it("does not submit when the title is empty", async () => {
    const w = mountDialog({ mode: "create" });
    w.vm.form.content = "content only";
    await w.vm.submit();
    expect(createMock).not.toHaveBeenCalled();
    expect(w.emitted("saved")).toBeUndefined();
  });
});
