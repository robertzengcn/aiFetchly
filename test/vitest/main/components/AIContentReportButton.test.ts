import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent } from "vue";
import AIContentReportButton from "@/views/components/aiContentReport/AIContentReportButton.vue";
import type { ReportableOutputDescriptor } from "@/views/components/aiContentReport/reportableOutput";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiContentReport: {
        action: "Report AI output",
        actionAriaLabel: "Report this AI-generated output",
        reported: "Reported",
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
  template: `<button :disabled="disabled" :title="title" :aria-label="ariaLabel" data-testid="ai-content-report-btn"><slot /></button>`,
});
const VIcon = { template: "<i />" };

const descriptor: ReportableOutputDescriptor = {
  surface: "chat-v2",
  contentType: "text",
  text: "Hello",
  images: [],
  context: {
    conversationId: "c1",
    messageId: "m1",
  },
} as unknown as ReportableOutputDescriptor;

function mountButton(props: Record<string, unknown> = {}) {
  return mount(AIContentReportButton, {
    props: { descriptor, ...props },
    global: {
      plugins: [i18n],
      stubs: { VBtn, VIcon },
    },
  });
}

describe("AIContentReportButton", () => {
  it("renders the action text by default", () => {
    const w = mountButton();
    const btn = w.find('[data-testid="ai-content-report-btn"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Report AI output");
  });

  it("renders icon-only (no action text) in compact mode", () => {
    const w = mountButton({ compact: true });
    const btn = w.find('[data-testid="ai-content-report-btn"]');
    expect(btn.exists()).toBe(true);
    // Compact mode hides the visible label — only the icon shows.
    expect(btn.text()).not.toContain("Report AI output");
    // Accessible name is preserved via aria-label even without visible text.
    expect((btn.element as HTMLButtonElement).getAttribute("aria-label")).toBe(
      "Report this AI-generated output"
    );
  });

  it("shows the reported label after submission in text mode", () => {
    const w = mountButton({ reported: true });
    expect(w.find('[data-testid="ai-content-report-btn"]').text()).toContain(
      "Reported"
    );
  });

  it("disables the button after submission", () => {
    const w = mountButton({ reported: true });
    expect(
      (
        w.find('[data-testid="ai-content-report-btn"]')
          .element as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("emits report with the descriptor when clicked", async () => {
    const w = mountButton();
    await w.find('[data-testid="ai-content-report-btn"]').trigger("click");
    const emitted = w.emitted("report");
    expect(emitted).toBeTruthy();
    // Vue wraps emitted args in an array per event; the descriptor is the
    // first (and only) argument of the first emission.
    expect(emitted![0][0]).toStrictEqual(descriptor);
  });

  it("does not emit report when already reported", async () => {
    const w = mountButton({ reported: true });
    await w.find('[data-testid="ai-content-report-btn"]').trigger("click");
    expect(w.emitted("report")).toBeFalsy();
  });
});
