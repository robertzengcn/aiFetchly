import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import AiChatVoiceTtsModelInstallDialog from "@/views/components/aiChatV2/AiChatVoiceTtsModelInstallDialog.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      common: { cancel: "Cancel" },
      aiChatV2: {
        voice: {
          enable_spoken_responses: "Enable spoken responses",
          tts_model_missing:
            "Spoken responses need a speech model. Install it to enable.",
          install_tts_model: "Install speech model",
          installing_model: "Installing...",
          open_model_settings: "Open settings",
        },
      },
    },
  },
});

/**
 * Mount dialog with the same stub style used across the chat component
 * tests (VDialog stub renders its slot so the v-card is reachable).
 */
function mountDialog(props: Record<string, unknown> = { open: true }) {
  return mount(AiChatVoiceTtsModelInstallDialog, {
    props: props as never,
    global: {
      plugins: [i18n],
      stubs: {
        VDialog: { template: "<div data-testid='dialog'><slot /></div>" },
        VCard: { template: "<div><slot /></div>" },
        VCardTitle: { template: "<div><slot /></div>" },
        VCardText: { template: "<div><slot /></div>" },
        VCardActions: { template: "<div><slot /></div>" },
        VAlert: { template: "<div role='alert'><slot /></div>" },
        VIcon: { template: "<span><slot /></span>" },
        VSpacer: true,
        VProgressCircular: true,
        VBtn: {
          emits: ["click"],
          template:
            "<button v-bind=\"$attrs\" @click=\"$emit('click', $event)\"><slot /></button>",
        },
      },
    },
  });
}

describe("AiChatVoiceTtsModelInstallDialog", () => {
  it("renders the speech-model notice and install affordance when open", () => {
    const wrapper = mountDialog({ open: true });

    expect(wrapper.text()).toContain(
      "Spoken responses need a speech model. Install it to enable."
    );
    expect(wrapper.text()).toContain("Install speech model");
    expect(wrapper.find('[data-testid="tts-install-confirm"]').exists()).toBe(
      true
    );
    expect(wrapper.find('[data-testid="tts-install-cancel"]').exists()).toBe(
      true
    );
  });

  it("emits confirm when the install button is clicked", async () => {
    const wrapper = mountDialog({ open: true });

    await wrapper.find('[data-testid="tts-install-confirm"]').trigger("click");

    expect(wrapper.emitted("confirm")).toHaveLength(1);
  });

  it("emits update:modelValue false when cancelled", async () => {
    const wrapper = mountDialog({ open: true });

    await wrapper.find('[data-testid="tts-install-cancel"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
  });

  it("emits open-settings from the settings link", async () => {
    const wrapper = mountDialog({ open: true });

    await wrapper.find('[data-testid="tts-install-settings"]').trigger("click");

    expect(wrapper.emitted("open-settings")).toHaveLength(1);
  });

  it("disables actions while installing and renders the localized error", () => {
    const wrapper = mountDialog({
      open: true,
      installing: true,
      error: "Speech model installation failed.",
    });

    expect(wrapper.text()).toContain("Speech model installation failed.");
    expect(
      wrapper
        .find('[data-testid="tts-install-confirm"]')
        .attributes("disabled")
    ).toBeDefined();
    expect(
      wrapper
        .find('[data-testid="tts-install-cancel"]')
        .attributes("disabled")
    ).toBeDefined();
    expect(
      wrapper
        .find('[data-testid="tts-install-settings"]')
        .attributes("disabled")
    ).toBeDefined();
  });
});
