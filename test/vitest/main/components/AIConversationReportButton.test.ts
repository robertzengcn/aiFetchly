import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiConversationReport: {
        action: "Report conversation",
        actionAriaLabel: "Report this conversation",
        unavailable: "Reporting unavailable",
      },
    },
  },
});

// Vuetify is not registered in the component-test config, so stub the
// components the button uses. VBtn renders a real <button> that honours
// `disabled` and forwards `title`/`aria-label`; VIcon is an inline stub.
const VBtn = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    title: { type: String, default: undefined },
    ariaLabel: { type: String, default: undefined },
  },
  setup(_, { attrs, slots }) {
    return { attrs, slots };
  },
  template: `<button :disabled="disabled" :title="title" :aria-label="ariaLabel" data-testid="report-conversation"><slot /></button>`,
});
const VIcon = { template: "<i />" };

function mountButton(props: Record<string, unknown> = {}) {
  return mount(AIConversationReportButton, {
    props: { enabled: true, ...props },
    global: {
      plugins: [i18n],
      stubs: { VBtn, VIcon },
    },
  });
}

describe("AIConversationReportButton", () => {
  it("renders the action text and has data-testid", () => {
    const w = mountButton();
    const btn = w.find('[data-testid="report-conversation"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Report conversation");
  });

  it("renders icon-only (no action text) in compact mode", () => {
    const w = mountButton({ compact: true });
    const btn = w.find('[data-testid="report-conversation"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).not.toContain("Report conversation");
    // Accessible name is preserved via aria-label even without visible text.
    expect((btn.element as HTMLButtonElement).getAttribute("aria-label")).toBe(
      "Report this conversation"
    );
  });

  it("emits open when clicked and enabled", async () => {
    const w = mountButton({ enabled: true });
    await w.find('[data-testid="report-conversation"]').trigger("click");
    expect(w.emitted("open")).toBeTruthy();
  });

  it("does not emit open when disabled", async () => {
    const w = mountButton({
      enabled: false,
      disabledReason: "Reporting unavailable",
    });
    const btn = w.find('[data-testid="report-conversation"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger("click");
    expect(w.emitted("open")).toBeFalsy();
  });

  it("shows the unavailable reason as the title when disabled", () => {
    const w = mountButton({
      enabled: false,
      disabledReason: "Reporting unavailable",
    });
    expect(
      (
        w.find('[data-testid="report-conversation"]')
          .element as HTMLButtonElement
      ).title
    ).toContain("Reporting unavailable");
  });

  // FR-1.3, §9.1: when there are zero reportable AI outputs the surface
  // disables the button (enabled=false) and passes the noEligibleOutputs
  // copy as the disabled reason — the button must surface it as the title.
  it("surfaces the no-eligible-outputs reason as the title when enabled=false with that reason", () => {
    const reason =
      "There are no reportable AI outputs in this conversation yet.";
    const w = mountButton({ enabled: false, disabledReason: reason });
    const el = w.find('[data-testid="report-conversation"]')
      .element as HTMLButtonElement;
    expect(el.disabled).toBe(true);
    expect(el.title).toContain(reason);
  });
});
