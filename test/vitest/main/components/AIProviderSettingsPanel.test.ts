import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIProviderSettingsPanel from "@/views/components/settings/AIProviderSettingsPanel.vue";
import { getAIProviderSettings } from "@/views/api/aiProvider";

vi.mock("@/views/api/aiProvider", () => ({
  getAIProviderSettings: vi.fn(),
  saveAIProviderSettings: vi.fn(),
  refreshLocalAIModels: vi.fn(),
  testLocalAIProvider: vi.fn(),
  clearLocalAIProviderApiKey: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { aiProvider: {} } },
});

function mountPanel() {
  return mount(AIProviderSettingsPanel, {
    global: {
      plugins: [i18n],
      stubs: {
        VRadioGroup: { template: "<div><slot /></div>" },
        VRadio: true,
        VAlert: { template: "<div><slot /></div>" },
        VRow: { template: "<div><slot /></div>" },
        VCol: { template: "<div><slot /></div>" },
        VSelect: true,
        VTextField: true,
        VCombobox: true,
        VBtn: { template: "<button><slot /></button>" },
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        AIProviderCapabilityBadges: true,
      },
    },
  });
}

describe("AIProviderSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAIProviderSettings).mockResolvedValue({
      mode: "local",
      hostedAIEnabled: false,
      localAIEnabled: true,
      localProvider: {
        preset: "ollama",
        name: "Custom Name",
        baseUrl: "http://custom.local/v1",
        defaultModel: "llama3.1",
        apiKeyConfigured: false,
      },
    });
  });

  it("preset selection fills that preset's editable defaults even when fields already have values", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      onPresetChange: (preset: string) => void;
      name: string;
      baseUrl: string;
      capabilities: unknown;
      lastTestStatus: string;
      lastTestMessage: string;
    };
    expect(vm.name).toBe("Custom Name");
    expect(vm.baseUrl).toBe("http://custom.local/v1");
    vm.capabilities = {
      modelsEndpoint: "supported",
      chat: "supported",
      streaming: "supported",
      tools: "supported",
      vision: "unknown",
    };
    vm.lastTestStatus = "passed";
    vm.lastTestMessage = "Connection test passed.";

    vm.onPresetChange("openai");
    await flushPromises();

    expect(vm.name).toBe("OpenAI");
    expect(vm.baseUrl).toBe("https://api.openai.com/v1");
    expect(vm.capabilities).toBeNull();
    expect(vm.lastTestStatus).toBe("untested");
    expect(vm.lastTestMessage).toBe("");
  });
});
