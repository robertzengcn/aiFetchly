import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatVoiceRuntimeInstallDialog from "@/views/components/aiChatV2/AiChatVoiceRuntimeInstallDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        voice: {
          runtime_install_title: "Install local voice runtime?",
          runtime_install_message:
            "Voice input needs the local voice runtime and Whisper Base voice model.",
          runtime_install_confirm: "Download and install",
        },
      },
      common: { cancel: "Cancel" },
    },
  },
});

/** Vuetify is not installed in tests — stub the v-* primitives. */
const stubs = {
  "v-dialog": { template: '<div class="stub-dialog"><slot /></div>' },
  "v-card": { template: '<div class="stub-card"><slot /></div>' },
  "v-card-title": { template: '<div class="stub-title"><slot /></div>' },
  "v-card-text": { template: '<div class="stub-text"><slot /></div>' },
  "v-card-actions": { template: '<div class="stub-actions"><slot /></div>' },
  "v-alert": {
    template: '<div class="stub-alert" role="alert"><slot /></div>',
  },
  // Plain button: parent listeners (click) and attrs (data-testid) reach the
  // root element through fallthrough — no explicit re-emit needed.
  "v-btn": { template: '<button class="stub-btn"><slot /></button>' },
  "v-icon": true,
  "v-spacer": { template: "<div />" },
  "v-progress-circular": true,
  "v-progress-linear": true,
};

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AiChatVoiceRuntimeInstallDialog, {
    global: { plugins: [i18n], stubs },
    props,
  });
}

describe("AiChatVoiceRuntimeInstallDialog (chat-first shell design §11.1)", () => {
  it("renders the install copy and size text", () => {
    const wrapper = mountDialog({ open: true, sizeText: "Runtime: 4.0 KB" });
    expect(wrapper.text()).toContain("Install local voice runtime?");
    expect(wrapper.text()).toContain(
      "Voice input needs the local voice runtime"
    );
    expect(wrapper.text()).toContain("Runtime: 4.0 KB");
  });

  it("shows install errors as alerts", () => {
    const wrapper = mountDialog({ open: true, error: "download failed" });
    expect(wrapper.get(".stub-alert").text()).toContain("download failed");
  });

  it("emits confirm from the primary action", async () => {
    const wrapper = mountDialog({ open: true });
    await wrapper
      .get('[data-testid="voice-runtime-install-confirm"]')
      .trigger("click");
    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("emits update:modelValue false from cancel", async () => {
    const wrapper = mountDialog({ open: true });
    await wrapper
      .get('[data-testid="voice-runtime-install-cancel"]')
      .trigger("click");
    const events = wrapper.emitted("update:modelValue");
    expect(events).toEqual([[false]]);
  });

  it("renders progress text while installing", () => {
    const wrapper = mountDialog({
      open: true,
      installing: true,
      progressText: "Downloading Whisper Base... 42%",
      percent: 42,
    });
    expect(wrapper.text()).toContain("Downloading Whisper Base... 42%");
  });
});
