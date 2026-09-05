import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortableMemoryDiagnosticsDialog from "@/views/components/aiChatV2/PortableMemoryDiagnosticsDialog.vue";
import WorkspaceMemoryEditorDialog from "@/views/components/aiChatV2/WorkspaceMemoryEditorDialog.vue";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";

vi.mock("@/views/api/portableWorkspaceMemory", () => ({
  portableWorkspaceMemoryApi: {
    diagnostics: vi.fn(),
    rescan: vi.fn(),
    onChanged: vi.fn(() => () => undefined),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { portableMemory: {}, workspaceMemory: {} } },
});

function mountDiagnostics(props: { open?: boolean; conversationId?: string }) {
  return mount(PortableMemoryDiagnosticsDialog, {
    props: {
      open: props.open ?? true,
      conversationId: props.conversationId ?? "conv-1",
    },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VChip: { template: "<span><slot /></span>" },
        VBtn: { template: "<button><slot /></button>" },
        VSpacer: true,
      },
    },
  });
}

function mountEditor(props: {
  modelValue?: boolean;
  memory?: unknown;
  expectedHash?: string | null;
  allowStorageChoice?: boolean;
}) {
  return mount(WorkspaceMemoryEditorDialog, {
    props: {
      modelValue: props.modelValue ?? true,
      memory: (props.memory ?? null) as never,
      defaultType: "decision",
      expectedHash: props.expectedHash ?? null,
      allowStorageChoice: props.allowStorageChoice ?? false,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VSelect: true,
        VTextField: true,
        VTextarea: true,
        VSlider: true,
        VRadioGroup: { template: "<div><slot /></div>" },
        VRadio: { template: "<div><slot /></div>" },
        VBtn: { template: "<button><slot /></button>" },
        VSpacer: true,
      },
    },
  });
}

describe("PortableMemoryDiagnosticsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portableWorkspaceMemoryApi.diagnostics).mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          code: "memory-secret-rejected",
          relativePath: ".aifetchly/memory/wmem-x.md",
          message: "content looks like a credential",
          recoverable: false,
        },
        {
          code: "memory-conflict",
          relativePath: ".aifetchly/memory/wmem-y.md",
          message: "concurrent edit",
          recoverable: true,
        },
      ],
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.rescan).mockResolvedValue({
      status: true,
      msg: "",
      data: null,
    } as never);
  });

  it("loads and renders per-file diagnostics with relative paths", async () => {
    const wrapper = mountDiagnostics({});
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain(".aifetchly/memory/wmem-x.md");
    expect(text).toContain("content looks like a credential");
    expect(text).toContain("not recoverable");
    expect(text).toContain(".aifetchly/memory/wmem-y.md");
  });

  it("shows an empty state when there are no diagnostics", async () => {
    vi.mocked(portableWorkspaceMemoryApi.diagnostics).mockResolvedValue({
      status: true,
      msg: "",
      data: [],
    } as never);
    const wrapper = mountDiagnostics({});
    await flushPromises();
    expect(wrapper.text()).toContain("No diagnostics");
  });

  it("triggers a rescan and refreshes diagnostics on the Rescan button", async () => {
    const wrapper = mountDiagnostics({});
    await flushPromises();
    vi.mocked(portableWorkspaceMemoryApi.diagnostics).mockClear();
    const rescanBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Rescan");
    await rescanBtn?.trigger("click");
    await flushPromises();
    expect(portableWorkspaceMemoryApi.rescan).toHaveBeenCalledWith("conv-1");
    expect(portableWorkspaceMemoryApi.diagnostics).toHaveBeenCalled();
    expect(wrapper.emitted("rescanned")).toHaveLength(1);
  });
});

describe("WorkspaceMemoryEditorDialog — expectedHash + storage (FR-038)", () => {
  it("forwards expectedHash on save when editing a portable record", async () => {
    const memory = {
      id: 1,
      memoryId: "wmem-018f2f70-7d3d-7cc0-a07f-1d36e59c2ef1",
      workspaceKey: "ws_x",
      workspaceRoot: "/r",
      type: "decision",
      title: "T",
      content: "C",
      status: "active",
      confidence: 90,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const wrapper = mountEditor({
      memory,
      expectedHash: "a".repeat(64),
      allowStorageChoice: true,
    });
    const vm = wrapper.vm as unknown as { onSave: () => void };
    vm.onSave();
    await flushPromises();
    const emitted = wrapper.emitted("save");
    expect(emitted).toHaveLength(1);
    const result = emitted?.[0]?.[0] as { expectedHash?: string };
    expect(result.expectedHash).toBe("a".repeat(64));
  });

  it("omits expectedHash when none was provided", async () => {
    const wrapper = mountEditor({ allowStorageChoice: false });
    const vm = wrapper.vm as unknown as { onSave: () => void };
    vm.onSave();
    await flushPromises();
    const result = wrapper.emitted("save")?.[0]?.[0] as {
      expectedHash?: string;
    };
    expect(result.expectedHash).toBeUndefined();
  });

  it("emits portable-local storageMode by default when allowStorageChoice is true", async () => {
    const wrapper = mountEditor({ allowStorageChoice: true });
    const vm = wrapper.vm as unknown as {
      form: { storageMode: string; visibility: string };
      onSave: () => void;
    };
    expect(vm.form.storageMode).toBe("portable-local");
    expect(vm.form.visibility).toBe("local");
    vm.onSave();
    await flushPromises();
    const result = wrapper.emitted("save")?.[0]?.[0] as {
      visibility?: string;
      storageMode?: string;
    };
    expect(result.storageMode).toBe("portable-local");
    expect(result.visibility).toBe("local");
  });

  it("emits visibility and storageMode when allowStorageChoice is true", async () => {
    const wrapper = mountEditor({ allowStorageChoice: true });
    const vm = wrapper.vm as unknown as {
      form: { storageMode: string; visibility: string };
      onSave: () => void;
    };
    vm.form.storageMode = "portable-team";
    vm.form.visibility = "team";
    await wrapper.vm.$nextTick();
    vm.onSave();
    await flushPromises();
    const result = wrapper.emitted("save")?.[0]?.[0] as {
      visibility?: string;
      storageMode?: string;
    };
    expect(result.visibility).toBe("team");
    expect(result.storageMode).toBe("portable-team");
  });
});
