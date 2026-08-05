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

const READ_ONLY_TOOLS: SchedulableAiToolSummary[] = [
  {
    name: "list_email_inboxes",
    description: "List email inboxes",
    permissionCategory: "automation",
    source: "built-in",
    requiresConfirmation: false,
    schedulable: true,
    autoApproveAllowed: true,
    riskLevel: "low",
  },
  {
    name: "send_email_reply",
    description: "Send email",
    permissionCategory: "automation",
    source: "built-in",
    requiresConfirmation: true,
    schedulable: false,
    autoApproveAllowed: false,
    blockedReason: "blocked",
    riskLevel: "blocked",
  },
];

// The VSelect stub mirrors its `items` prop into a DOM attribute so the test
// can assert the filtered catalog without findComponent (unreliable under the
// component-test happy-dom config).
function mountDialog() {
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
        VSelect: {
          props: ["modelValue", "items"],
          emits: ["update:modelValue"],
          template:
            '<div data-testid="tool-select" :data-tool-names="(items||[]).map((i)=>i.name).join(\'|\')" />',
        },
        VSwitch: {
          props: ["modelValue", "disabled"],
          emits: ["update:modelValue"],
          template: "<div />",
        },
        VList: { template: "<div><slot /></div>" },
        VListItem: { template: "<div><slot /></div>" },
        VListItemSubtitle: { template: "<div><slot /></div>" },
      },
    },
    props: { modelValue: true, rawCommand: "/loop 1m check email" },
  });
}

describe("ScheduledLoopToolApprovalDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only exposes tools the policy marks schedulable", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(
      READ_ONLY_TOOLS
    );
    const wrapper = mountDialog();
    await flushPromises();
    const names = wrapper
      .find('[data-testid="tool-select"]')
      .attributes("data-tool-names");
    expect(names).toBe("list_email_inboxes");
  });

  it("emits an empty allowed-tools payload when nothing is approved", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(
      READ_ONLY_TOOLS
    );
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .find('[data-testid="scheduled-loop-approval-confirm"]')
      .trigger("click");
    const confirmEvents = wrapper.emitted("confirm");
    expect(confirmEvents).toBeTruthy();
    const payload = confirmEvents![0][0] as {
      allowedTools: string[];
      autoApproveTools: boolean;
    };
    expect(payload.allowedTools).toEqual([]);
    expect(payload.autoApproveTools).toBe(false);
  });

  it("emits the selected tools and auto-approve when the user approves", async () => {
    vi.mocked(listAvailableAiMessageTaskTools).mockResolvedValue(
      READ_ONLY_TOOLS
    );
    const wrapper = mountDialog();
    await flushPromises();
    // Drive the exposed reactive state (the dialog exposes these for tests).
    const vm = wrapper.vm as unknown as {
      selectedTools: string[];
      autoApprove: boolean;
    };
    vm.selectedTools = ["list_email_inboxes"];
    vm.autoApprove = true;
    await wrapper
      .find('[data-testid="scheduled-loop-approval-confirm"]')
      .trigger("click");
    const confirmEvents = wrapper.emitted("confirm");
    expect(confirmEvents).toBeTruthy();
    const payload = confirmEvents![0][0] as {
      allowedTools: string[];
      autoApproveTools: boolean;
    };
    expect(payload.allowedTools).toEqual(["list_email_inboxes"]);
    expect(payload.autoApproveTools).toBe(true);
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
