import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import PortableMemoryConflictDialog from "@/views/components/aiChatV2/PortableMemoryConflictDialog.vue";
import { portableWorkspaceMemoryApi } from "@/views/api/portableWorkspaceMemory";
import PortableMemoryDiagnosticsDialog from "@/views/components/aiChatV2/PortableMemoryDiagnosticsDialog.vue";

vi.mock("@/views/api/portableWorkspaceMemory", () => ({
  portableWorkspaceMemoryApi: {
    conflictsList: vi.fn(),
    resolveConflict: vi.fn(),
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
  messages: { en: { portableMemory: {} } },
});

const stubs = {
  VDialog: { template: "<div role='dialog'><slot /></div>" },
  VCard: { template: "<div><slot /></div>" },
  VCardTitle: { template: "<div><slot /></div>" },
  VCardText: { template: "<div><slot /></div>" },
  VCardActions: { template: "<div><slot /></div>" },
  VAlert: { template: "<div role='alert'><slot /></div>" },
  VRadioGroup: { template: "<div role='radiogroup'><slot /></div>" },
  VRadio: { props: ["label", "value"], template: "<div role='radio'>{{ label }}<slot /></div>" },
  VTextField: true,
  VTextarea: true,
  VSelect: true,
  VChip: { template: "<span><slot /></span>" },
  VBtn: { template: "<button><slot /></button>" },
  VSpacer: true,
};

describe("Accessibility (PRD §16.7)", () => {
  it("conflict dialog state is not communicated by color alone", async () => {
    vi.mocked(portableWorkspaceMemoryApi.conflictsList).mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          memoryId: "wmem-x",
          relativePath: ".aifetchly/memory/wmem-x.md",
          message: "concurrent edit detected",
          currentFileContent: "# External\n\nbody",
          currentFileParseable: true,
        },
      ],
    } as never);
    const wrapper = mount(PortableMemoryConflictDialog, {
      props: { open: true, conversationId: "conv-1", memoryId: "wmem-x" },
      global: { plugins: [i18n], stubs },
    });
    await flushPromises();
    const text = wrapper.text();
    // The conflict warning is text, not just color (PRD §16.7).
    expect(text).toContain("edited externally");
    // Both versions are labeled with text.
    expect(text).toContain("AiFetchly projection");
    expect(text).toContain("Current file");
    // Actions have text labels.
    expect(text).toContain("Use file version");
    expect(text).toContain("Use AiFetchly version");
    expect(text).toContain("Merge manually");
  });

  it("diagnostics dialog uses text labels for severity, not color alone", async () => {
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
      ],
    } as never);
    const wrapper = mount(PortableMemoryDiagnosticsDialog, {
      props: { open: true, conversationId: "conv-1" },
      global: { plugins: [i18n], stubs },
    });
    await flushPromises();
    const text = wrapper.text();
    // The diagnostic code + message appear as text (not just chip color).
    expect(text).toContain("memory-secret-rejected");
    expect(text).toContain("content looks like a credential");
    // "not recoverable" is a text chip, not just a color.
    expect(text.toLowerCase()).toContain("not recoverable");
  });

  it("conflict dialog buttons are keyboard-focusable (native <button> elements)", async () => {
    vi.mocked(portableWorkspaceMemoryApi.conflictsList).mockResolvedValue({
      status: true,
      msg: "",
      data: [
        {
          memoryId: "wmem-x",
          relativePath: ".aifetchly/memory/wmem-x.md",
          message: "concurrent edit",
          currentFileContent: "# T\n\nbody",
          currentFileParseable: true,
        },
      ],
    } as never);
    const wrapper = mount(PortableMemoryConflictDialog, {
      props: { open: true, conversationId: "conv-1", memoryId: "wmem-x" },
      global: { plugins: [i18n], stubs },
    });
    await flushPromises();
    const buttons = wrapper.findAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    // Every button has non-empty text content (accessible name).
    for (const btn of buttons) {
      expect(btn.text().trim().length).toBeGreaterThan(0);
    }
  });
});
