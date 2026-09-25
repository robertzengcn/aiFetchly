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
