import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import InsightsHome from "@/views/pages/insights/index.vue";

const { push } = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push }),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      route: {
        email_service: "Email Service",
        email_receive: "Received Emails",
        ai_auto_replies: "AI Auto Replies",
        proxy: "Proxy",
        tool_account_list: "Tool Account List",
      },
      insights: {
        title: "Insights",
        subtitle: "Review business signals.",
        email_service_description: "Configure email services.",
        email_receive_description: "View inbound emails.",
        email_reply_description: "Review AI replies.",
        proxy_description: "Manage proxies.",
        tool_account_description: "Manage tool accounts.",
      },
    },
  },
});

beforeEach(() => {
  push.mockClear();
});

function mountPage() {
  return mount(InsightsHome, {
    global: {
      plugins: [i18n],
      stubs: {
        AppPageShell: {
          template: '<div data-testid="app-page-shell"><slot /></div>',
        },
        "v-card": {
          template:
            '<div class="v-card-stub"><slot /></div>',
        },
        "v-icon": true,
      },
    },
  });
}

describe("InsightsHome card list", () => {
  it("renders a card grid by default (not a row list)", () => {
    const wrapper = mountPage();
    expect(wrapper.find(".insights-grid").exists()).toBe(true);
    expect(wrapper.find(".landing-section").exists()).toBe(false);
    expect(wrapper.find(".landing-row").exists()).toBe(false);
  });

  it("renders one card per destination with title and description", () => {
    const wrapper = mountPage();
    const cards = wrapper.findAll(".insight-card");
    expect(cards.length).toBe(5);
    expect(wrapper.text()).toContain("Email Service");
    expect(wrapper.text()).toContain("Received Emails");
    expect(wrapper.text()).toContain("AI Auto Replies");
    expect(wrapper.text()).toContain("Proxy");
    expect(wrapper.text()).toContain("Tool Account List");
  });

  it("navigates to the destination when a card is clicked", async () => {
    const wrapper = mountPage();
    const cards = wrapper.findAll(".insight-card");
    await cards[0].trigger("click");
    expect(push).toHaveBeenCalledWith("/emailmarketing/emailservice/list");
  });

  it("navigates via keyboard Enter on a focused card", async () => {
    const wrapper = mountPage();
    const cards = wrapper.findAll(".insight-card");
    await cards[3].trigger("keydown.enter");
    expect(push).toHaveBeenCalledWith("/proxy/list");
  });
});
