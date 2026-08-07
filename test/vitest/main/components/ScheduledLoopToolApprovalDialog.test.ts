import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ScheduledLoopToolApprovalDialog from "@/views/components/aiChatV2/ScheduledLoopToolApprovalDialog.vue";
import { listAvailableAiMessageTaskTools } from "@/views/api/aiMessageTask";
import type { SchedulableAiToolSummary } from "@/entityTypes/aiMessageTaskTypes";

vi.mock("@/views/api/aiMessageTask", () => ({
  listAvailableAiMessageTaskTools: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

const TOOLS: SchedulableAiToolSummary[] = [
  {
    name: "list_email_inboxes",
    description: "List inboxes",
    permissionCategory: "automation",
    source: "built-in",
    requiresConfirmation: false,
    schedulable: true,
    autoApproveAllowed: true,
    riskLevel: "low",
  },
  {
    name: "proxy_check",
    description: "Network check",
    permissionCategory: "automation",
    source: "built-in",
    requiresConfirmation: false,
    schedulable: true,
    autoApproveAllowed: true,
    riskLevel: "medium",
  },
  {
    name: "file_write",
    description: "Write a file",
    permissionCategory: "filesystem",
    source: "built-in",
    requiresConfirmation: true,
    schedulable: true,
    autoApproveAllowed: true,
    riskLevel: "high",
  },
  {
    name: "send_email_reply",
    description: "Send email",
    permissionCategory: "automation",
    source: "built-in",
    requiresConfirmation: true,
    schedulable: true,
    autoApproveAllowed: true,
    riskLevel: "high",
  },
  {
    name: "fetch_unread_emails",
    description: "Fetch unread emails",
    permissionCategory: "automation",
    source: "built-in",
    requiresConfirmation: false,
    schedulable: true,
    autoApproveAllowed: true,
    riskLevel: "low",
  },
];

function mountDialog(props: { rawCommand?: string; prompt?: string } = {}) {
  return mount(ScheduledLoopToolApprovalDialog, {
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: "<div><slot /></div>",
        },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VDivider: true,
        VBtn: {
          inheritAttrs: false,
          emits: ["click"],
          template:
            '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
        },
        VIcon: true,
        VSpacer: true,
        VAlert: { template: "<div><slot /></div>" },
        VProgressLinear: true,
        VSwitch: { template: "<div />" },
        VSelect: { template: "<div />" },
        VCheckbox: { template: "<div />" },
        VTextField: { template: "<div />" },
      },
    },
    props: {
      modelValue: true,
      rawCommand: props.rawCommand ?? "/loop 1m summarize status",
      prompt: props.prompt,
    },
  });
}

type Exposed = {
  toolsEnabled: boolean;
  allowSkills: boolean;
  allowMcp: boolean;
  allowSubagents: boolean;
  selectedAutomation: string[];
  pendingHighImpact: Record<string, boolean>;
  confirmInput: Record<string, string>;
  confirmedHighImpact: () => string[];
};

function vmOf(wrapper: ReturnType<typeof mountDialog>): Exposed {
  return wrapper.vm as unknown as Exposed;
}

describe("ScheduledLoopToolApprovalDialog (3-tier)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("categorizes tools by risk level", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(TOOLS);
    const wrapper = mountDialog();
    await flushPromises();
    const vm = vmOf(wrapper);
    expect(listAvailableAiMessageTaskTools).toHaveBeenCalled();
    expect(vm.confirmInput).toBeDefined();
  });

  it("defaults extended capabilities and built-in tools to enabled", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(TOOLS);
    const wrapper = mountDialog();
    await flushPromises();
    const vm = vmOf(wrapper);
    expect(vm.toolsEnabled).toBe(true);
    expect(vm.allowSkills).toBe(true);
    expect(vm.allowMcp).toBe(true);
    expect(vm.allowSubagents).toBe(true);
  });

  it("emits extended capability flags on confirm", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(TOOLS);
    const wrapper = mountDialog();
    await flushPromises();
    const vm = vmOf(wrapper);
    vm.toolsEnabled = false;
    vm.allowSkills = true;
    vm.allowMcp = false;
    vm.allowSubagents = true;
    await wrapper
      .find('[data-testid="scheduled-loop-approval-confirm"]')
      .trigger("click");
    const payload = wrapper.emitted("confirm")![0][0] as {
      allowedTools: string[];
      autoApproveTools: boolean;
      allowSkills: boolean;
      allowMcp: boolean;
      allowSubagents: boolean;
    };
    expect(payload.autoApproveTools).toBe(false);
    expect(payload.allowSkills).toBe(true);
    expect(payload.allowMcp).toBe(false);
    expect(payload.allowSubagents).toBe(true);
  });

  it("auto-approves read-only tools when enabled, even with no explicit selection", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(TOOLS);
    const wrapper = mountDialog();
    await flushPromises();
    const vm = vmOf(wrapper);
    vm.toolsEnabled = true;
    await wrapper
      .find('[data-testid="scheduled-loop-approval-confirm"]')
      .trigger("click");
    const payload = wrapper.emitted("confirm")![0][0] as {
      allowedTools: string[];
      autoApproveTools: boolean;
    };
    expect(payload.autoApproveTools).toBe(true);
    expect(payload.allowedTools).toEqual([]);
  });

  it("pre-enables unattended tools for inbox-check prompts (unread fetch is read-only)", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(TOOLS);
    const wrapper = mountDialog({
      rawCommand: "/loop 1m check whether there is new email in my emaibox",
      prompt: "check whether there is new email in my emaibox",
    });
    await flushPromises();
    const vm = vmOf(wrapper);
    expect(vm.toolsEnabled).toBe(true);
    expect(vm.selectedAutomation).not.toContain("fetch_unread_emails");
    await wrapper
      .find('[data-testid="scheduled-loop-approval-confirm"]')
      .trigger("click");
    const payload = wrapper.emitted("confirm")![0][0] as {
      allowedTools: string[];
      autoApproveTools: boolean;
      allowSkills: boolean;
    };
    expect(payload.autoApproveTools).toBe(true);
    expect(payload.allowedTools).toEqual([]);
    expect(payload.allowSkills).toBe(true);
  });

  it("does NOT confirm a high-impact tool until its exact name is typed", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(TOOLS);
    const wrapper = mountDialog();
    await flushPromises();
    const vm = vmOf(wrapper);
    vm.toolsEnabled = true;
    vm.pendingHighImpact.file_write = true;
    vm.confirmInput.file_write = "file_write_typo";
    expect(vm.confirmedHighImpact()).toEqual([]);
    vm.confirmInput.file_write = "file_write";
    expect(vm.confirmedHighImpact()).toEqual(["file_write"]);
    vm.selectedAutomation = ["proxy_check"];
    await wrapper
      .find('[data-testid="scheduled-loop-approval-confirm"]')
      .trigger("click");
    const payload = wrapper.emitted("confirm")![0][0] as {
      allowedTools: string[];
    };
    expect(payload.allowedTools).toContain("file_write");
    expect(payload.allowedTools).toContain("proxy_check");
  });

  it("emits cancel and closes when the close button is used", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue([]);
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .find('[data-testid="scheduled-loop-approval-cancel"]')
      .trigger("click");
    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });
});
