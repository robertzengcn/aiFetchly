import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortableMemoryEnableDialog from "@/views/components/aiChatV2/PortableMemoryEnableDialog.vue";
import {
  portableWorkspaceMemoryApi,
} from "@/views/api/portableWorkspaceMemory";

vi.mock("@/views/api/portableWorkspaceMemory", () => ({
  portableWorkspaceMemoryApi: {
    enablePreview: vi.fn(),
    enable: vi.fn(),
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

function mountDialog(props: { open?: boolean; conversationId?: string }) {
  return mount(PortableMemoryEnableDialog, {
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
        VAlert: { template: "<div><slot /></div>" },
        VRadioGroup: { template: "<div><slot /></div>" },
        VRadio: { template: "<div><slot /></div>" },
        VSelect: true,
        VCheckbox: { template: "<label><slot /></label>" },
        VBtn: { template: "<button><slot /></button>" },
        VIcon: true,
        VSpacer: true,
      },
    },
  });
}

function previewData(overrides: Record<string, unknown> = {}) {
  return {
    identityState: "missing",
    existingRecordCount: 0,
    memoryDirectoryPresent: false,
    plannedFiles: [
      ".aifetchly/workspace.json",
      ".aifetchly/memory/README.md",
      ".aifetchly/memory/INDEX.md",
    ],
    gitTrackingState: "untracked",
    bridges: [
      {
        target: "AGENTS.md",
        preview: {
          target: "AGENTS.md",
          exists: false,
          action: "create",
          unifiedDiff: "+bridge",
        },
      },
      {
        target: "CLAUDE.md",
        preview: {
          target: "CLAUDE.md",
          exists: false,
          action: "create",
          unifiedDiff: "+bridge",
        },
      },
    ],
    ...overrides,
  };
}

describe("PortableMemoryEnableDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(portableWorkspaceMemoryApi.enablePreview).mockResolvedValue({
      status: true,
      msg: "",
      data: previewData(),
    } as never);
    vi.mocked(portableWorkspaceMemoryApi.enable).mockResolvedValue({
      status: true,
      msg: "",
      data: { enabled: true },
    } as never);
  });

  it("loads and renders the preview's planned files", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    expect(portableWorkspaceMemoryApi.enablePreview).toHaveBeenCalledWith(
      "conv-1"
    );
    const text = wrapper.text();
    expect(text).toContain(".aifetchly/workspace.json");
    expect(text).toContain(".aifetchly/memory/README.md");
  });

  it("renders the loading state before the preview resolves", async () => {
    let resolvePreview: (v: unknown) => void = () => undefined;
    vi.mocked(portableWorkspaceMemoryApi.enablePreview).mockReturnValue(
      new Promise((r) => (resolvePreview = r)) as never
    );
    const wrapper = mountDialog({});
    expect(wrapper.text()).not.toContain(".aifetchly/workspace.json");
    resolvePreview({ status: true, msg: "", data: previewData() });
    await flushPromises();
    expect(wrapper.text()).toContain(".aifetchly/workspace.json");
  });

  it("surfaces a failed preview as an error without the confirm button", async () => {
    vi.mocked(portableWorkspaceMemoryApi.enablePreview).mockResolvedValue({
      status: false,
      msg: "Choose an approved workspace before using portable memory.",
      data: undefined,
    } as never);
    const wrapper = mountDialog({});
    await flushPromises();
    expect(wrapper.text()).toContain("approved workspace");
    const enableBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Enable");
    expect(enableBtn?.attributes("disabled")).toBeDefined();
  });

  it("blocks enable when the identity file is invalid", async () => {
    vi.mocked(portableWorkspaceMemoryApi.enablePreview).mockResolvedValue({
      status: true,
      msg: "",
      data: previewData({ identityState: "invalid" }),
    } as never);
    const wrapper = mountDialog({});
    await flushPromises();
    const enableBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Enable");
    expect(enableBtn?.attributes("disabled")).toBeDefined();
  });

  it("emits enabled after a successful confirm with chosen options", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as {
      visibility: string;
      importPolicy: string;
      exportScope: string;
    };
    vm.visibility = "team";
    vm.importPolicy = "review-all";
    vm.exportScope = "active";
    const enableBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Enable");
    await enableBtn?.trigger("click");
    await flushPromises();
    expect(portableWorkspaceMemoryApi.enable).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        defaultStorageMode: "portable-team",
        importPolicy: "review-all",
        exportScope: "active",
        visibility: "team",
        installBridges: [],
      })
    );
    expect(wrapper.emitted("enabled")).toHaveLength(1);
  });

  it("emits cancel from the cancel button", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const cancelBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "Cancel");
    await cancelBtn?.trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("shows the team warning only for team visibility", async () => {
    const wrapper = mountDialog({});
    await flushPromises();
    const vm = wrapper.vm as unknown as { visibility: string };
    expect(wrapper.text()).not.toContain("Git history");
    vm.visibility = "team";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("Git history");
  });
});
