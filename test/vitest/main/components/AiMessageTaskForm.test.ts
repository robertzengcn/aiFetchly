import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiMessageTaskForm from "@/views/pages/schedule/widgets/AiMessageTaskForm.vue";

const apiMocks = vi.hoisted(() => ({
  listAvailableAiMessageTaskTools: vi.fn(),
  getOpenAIChatModels: vi.fn(),
  pickFolder: vi.fn(),
}));

vi.mock("@/views/api/aiMessageTask", () => ({
  listAvailableAiMessageTaskTools: () =>
    apiMocks.listAvailableAiMessageTaskTools(),
}));

vi.mock("@/views/api/aiChatV2", () => ({
  subscribeCompactionProgress: vi.fn().mockReturnValue(() => undefined),
  unsubscribeCompactionProgress: vi.fn(),
  getCompactionStatus: vi.fn().mockResolvedValue(null),
  startCompaction: vi.fn().mockResolvedValue({ started: true }),
  cancelCompaction: vi.fn().mockResolvedValue(false),
  subscribeAutoCompacted: vi.fn(),
  unsubscribeAutoCompacted: vi.fn(),
  denyChatV2ToolPermission: vi.fn().mockResolvedValue({ ok: true }),
  steerChatV2PendingMessage: vi.fn(),
  cancelChatV2PendingMessage: vi.fn(),
  resumeChatV2PendingQueue: vi.fn().mockResolvedValue(true),
  subscribeChatV2PendingEvents: vi.fn().mockReturnValue(() => undefined),
  listChatV2PendingMessages: vi.fn().mockResolvedValue([]),
  getChatV2History: vi.fn().mockResolvedValue({ messages: [] }),
  getChatV2Conversations: vi.fn().mockResolvedValue([]),
  getOpenAIChatModels: () => apiMocks.getOpenAIChatModels(),
}));

vi.mock("@/views/api/workspace", () => ({
  pickFolder: () => apiMocks.pickFolder(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

function mountForm(workspacePath = ""): ReturnType<typeof mount> {
  return mount(AiMessageTaskForm, {
    props: {
      initialTaskData: {
        name: "Nightly recap",
        message: "Summarize the folder",
        workspace_path: workspacePath,
      },
    },
    global: {
      plugins: [i18n],
      stubs: {
        VContainer: { template: "<div><slot /></div>" },
        VRow: { template: "<div><slot /></div>" },
        VCol: { template: "<div><slot /></div>" },
        VTextField: {
          props: ["modelValue", "label"],
          template:
            '<div><input class="workspace-path" :aria-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /><button type="button" class="pick-folder" @click="$emit(\'click:append-inner\')">Pick</button></div>',
        },
        VTextarea: { template: "<textarea />" },
        VSelect: { template: "<div />" },
        VSwitch: { template: "<div />" },
        VAlert: { template: "<div><slot /></div>" },
        VExpansionPanels: { template: "<div><slot /></div>" },
        VExpansionPanel: { template: "<div><slot /></div>" },
        VExpansionPanelTitle: { template: "<div><slot /></div>" },
        VExpansionPanelText: { template: "<div><slot /></div>" },
        VIcon: { template: "<span />" },
        AiChatV2ModelSelector: { template: "<div />" },
      },
    },
  });
}

function mountFormWithTools(): ReturnType<typeof mount> {
  return mount(AiMessageTaskForm, {
    props: {
      initialTaskData: {
        name: "Nightly recap",
        message: "Summarize the folder",
        allowed_tools_json: JSON.stringify(["file_read", "file_write"]),
      },
    },
    global: {
      plugins: [i18n],
      stubs: {
        VContainer: { template: "<div><slot /></div>" },
        VRow: { template: "<div><slot /></div>" },
        VCol: { template: "<div><slot /></div>" },
        VTextField: { template: "<input />" },
        VTextarea: { template: "<textarea />" },
        VSelect: {
          props: {
            modelValue: { type: Array, default: () => [] },
          },
          emits: ["update:modelValue"],
          methods: {
            chipItem(name: string): {
              raw: { name: string; riskLevel: string };
              title: string;
            } {
              return {
                raw: { name, riskLevel: "low" },
                title: name,
              };
            },
            chipProps(name: string): {
              "onClick:close": (event: Event) => void;
            } {
              return {
                "onClick:close": (event: Event): void => {
                  event.preventDefault();
                  const current = Array.isArray(this.modelValue)
                    ? [...this.modelValue]
                    : [];
                  this.$emit(
                    "update:modelValue",
                    current.filter((tool: string) => tool !== name)
                  );
                },
              };
            },
          },
          template: `
            <div class="tool-select">
              <template v-for="name in modelValue" :key="name">
                <slot name="chip" :item="chipItem(name)" :props="chipProps(name)" />
              </template>
            </div>
          `,
        },
        VSwitch: { template: "<div />" },
        VAlert: { template: "<div><slot /></div>" },
        VExpansionPanels: { template: "<div><slot /></div>" },
        VExpansionPanel: { template: "<div><slot /></div>" },
        VExpansionPanelTitle: { template: "<div><slot /></div>" },
        VExpansionPanelText: { template: "<div><slot /></div>" },
        VIcon: { template: "<span />" },
        VListItem: { template: "<div><slot /></div>" },
        VListItemSubtitle: { template: "<div><slot /></div>" },
        VChip: {
          inheritAttrs: false,
          template:
            '<button type="button" class="tool-chip" @click="close"><slot /></button>',
          methods: {
            close(event: Event): void {
              const attrs = this.$attrs as Record<string, unknown>;
              const handler = attrs["onClick:close"];
              if (typeof handler === "function") {
                (handler as (event: Event) => void)(event);
              }
            },
          },
        },
        AiChatV2ModelSelector: { template: "<div />" },
      },
    },
  });
}

describe("AiMessageTaskForm allowed tools", () => {
  beforeEach(() => {
    apiMocks.listAvailableAiMessageTaskTools.mockResolvedValue([
      {
        name: "file_read",
        schedulable: true,
        riskLevel: "low",
        description: "Read",
      },
      {
        name: "file_write",
        schedulable: true,
        riskLevel: "high",
        description: "Write",
      },
    ]);
    apiMocks.getOpenAIChatModels.mockResolvedValue({
      data: [],
      default_model: "auto",
    });
  });

  it("emits the shorter allow list when a tool chip is closed", async () => {
    const wrapper = mountFormWithTools();
    await flushPromises();

    const chips = wrapper.findAll("button.tool-chip");
    const writeChip = chips.find((chip) => chip.text() === "file_write");
    expect(writeChip).toBeTruthy();
    await writeChip?.trigger("click");
    await flushPromises();

    const emitted = wrapper.emitted("change") ?? [];
    const last = emitted[emitted.length - 1]?.[0] as
      | { allowedTools?: string[] }
      | undefined;
    expect(last?.allowedTools).toEqual(["file_read"]);
  });
});

describe("AiMessageTaskForm workspace path", () => {
  beforeEach(() => {
    apiMocks.listAvailableAiMessageTaskTools.mockResolvedValue([]);
    apiMocks.getOpenAIChatModels.mockResolvedValue({
      data: [],
      default_model: "auto",
    });
    apiMocks.pickFolder.mockReset();
  });

  it("emits the saved workspace path with the rest of the AI message form", async () => {
    const wrapper = mountForm("/tmp/scheduled-workspace");
    await flushPromises();

    const input = wrapper.get(
      'input[aria-label="schedule.ai_message_task_workspace_path"]'
    );
    expect((input.element as HTMLInputElement).value).toBe(
      "/tmp/scheduled-workspace"
    );

    const emitted = wrapper.emitted("change") ?? [];
    const last = emitted[emitted.length - 1]?.[0] as
      | { workspacePath?: string }
      | undefined;
    expect(last?.workspacePath).toBe("/tmp/scheduled-workspace");
  });

  it("writes a picked folder into the workspace path field", async () => {
    apiMocks.pickFolder.mockResolvedValue("/Users/me/project");
    const wrapper = mountForm();
    await flushPromises();

    const pickButtons = wrapper.findAll("button.pick-folder");
    await pickButtons[1].trigger("click");
    await flushPromises();
    const input = wrapper.get(
      'input[aria-label="schedule.ai_message_task_workspace_path"]'
    );

    expect((input.element as HTMLInputElement).value).toBe("/Users/me/project");
  });
});
