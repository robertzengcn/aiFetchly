import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortableMemoryConflictDialog from "@/views/components/aiChatV2/PortableMemoryConflictDialog.vue";
import {
  portableWorkspaceMemoryApi,
} from "@/views/api/portableWorkspaceMemory";

vi.mock("@/views/api/portableWorkspaceMemory", () => ({
  portableWorkspaceMemoryApi: {
    conflictsList: vi.fn(),
    resolveConflict: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { portableMemory: {} } },
});

function mountDialog(props: {
  open?: boolean;
  conversationId?: string;
  memoryId?: string | null;
}) {
  return mount(PortableMemoryConflictDialog, {
    props: {
      open: props.open ?? true,
      conversationId: props.conversationId ?? "conv-1",
      memoryId: props.memoryId ?? "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
    },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VAlert: { template: "<div><slot /></div>" },
        VRadioGroup: { template: "<div><slot /></div>" },
        VRadio: { template: "<div><slot /></div>" },
        VTextField: true,
        VTextarea: true,
        VSelect: true,
        VBtn: { template: "<button><slot /></button>" },
        VSpacer: true,
      },
    },
  });
}

const DOC_ID = "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1";

const conflict = {
  memoryId: DOC_ID,
  relativePath: `.aifetchly/memory/${DOC_ID}.md`,
  lastValidHash: "a".repeat(64),
  observedHash: "b".repeat(64),
  message: "concurrent edit detected",
  currentFileContent: `---\nschema: aifetchly.memory/v1\nid: ${DOC_ID}\ntype: decision\nstatus: active\nconfidence: 80\nvisibility: local\ncreatedAt: "2026-08-22T08:00:00.000Z"\nupdatedAt: "2026-08-22T09:00:00.000Z"\ncreatedBy: external-agent\n---\n\n# External title\n\nExternal body content.`,
  currentFileParseable: true,
};

describe("PortableMemoryConflictDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portableWorkspaceMemoryApi.conflictsList).mockResolvedValue({
      status: true,
      msg: "",
      data: [conflict],
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.resolveConflict).mockResolvedValue({
      status: true,
      msg: "",
      data: null,
    } as never);
  });

  it("loads and renders the relative path + both versions", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain(conflict.relativePath);
    expect(text).toContain("concurrent edit detected");
    expect(text).toContain("External title");
    expect(text).toContain("External body content.");
  });

  it("seeds the merge editor from the file content", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      mergeTitle: string;
      mergeContent: string;
    };
    expect(vm.mergeTitle).toBe("External title");
    expect(vm.mergeContent).toContain("External body content.");
  });

  it("shows an empty state when no conflict matches", async () => {
    vi.mocked(portableWorkspaceMemoryApi.conflictsList).mockResolvedValue({
      status: true,
      msg: "",
      data: [],
    } as never);
    const wrapper = mountDialog({});
    await flushPromises();
    expect(wrapper.text()).toContain("No conflict found.");
    const resolveBtn = wrapper.findAll("button").find((b) => b.text() === "Resolve");
    expect(resolveBtn?.attributes("disabled")).toBeDefined();
  });

  it("resolves with use-file and emits resolved", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as { action: string };
    vm.action = "use-file";
    const resolveBtn = wrapper.findAll("button").find((b) => b.text() === "Resolve");
    await resolveBtn?.trigger("click");
    await flushPromises();
    expect(portableWorkspaceMemoryApi.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        memoryId: DOC_ID,
        action: "use-file",
      })
    );
    expect(wrapper.emitted("resolved")).toHaveLength(1);
  });

  it("requires a valid mergedDocument for the merge action", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      action: string;
      mergeTitle: string;
      mergeContent: string;
    };
    vm.action = "merge";
    vm.mergeTitle = "";
    await wrapper.vm.$nextTick();
    const resolveBtn = wrapper.findAll("button").find((b) => b.text() === "Resolve");
    expect(resolveBtn?.attributes("disabled")).toBeDefined();

    vm.mergeTitle = "Merged title";
    vm.mergeContent = "Merged body.";
    await wrapper.vm.$nextTick();
    expect(resolveBtn?.attributes("disabled")).toBeUndefined();
  });

  it("sends the merged document for the merge action", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      action: string;
      mergeTitle: string;
      mergeContent: string;
      mergeType: string;
      mergeStatus: string;
      mergeVisibility: string;
      mergeConfidence: number;
    };
    vm.action = "merge";
    vm.mergeTitle = "Merged";
    vm.mergeContent = "Body.";
    vm.mergeType = "warning";
    vm.mergeStatus = "active";
    vm.mergeVisibility = "team";
    vm.mergeConfidence = 75;
    await wrapper.vm.$nextTick();
    const resolveBtn = wrapper.findAll("button").find((b) => b.text() === "Resolve");
    await resolveBtn?.trigger("click");
    await flushPromises();
    expect(portableWorkspaceMemoryApi.resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "merge",
        mergedDocument: expect.objectContaining({
          title: "Merged",
          type: "warning",
          visibility: "team",
          confidence: 75,
        }),
      })
    );
  });
});
