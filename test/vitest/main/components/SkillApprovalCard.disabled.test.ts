import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import SkillApprovalCard from "@/views/components/aiChat/SkillApprovalCard.vue";

type WindowWithApi = Window & {
  api?: {
    invoke: (channel: string, data?: unknown) => Promise<unknown>;
  };
};

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      skills: {
        approval_title: "Permission required",
        shell_approval_title: "Shell permission required",
        approval_description: "This tool requires permission.",
        shell_approval_description: "This shell command requires permission.",
        approval_deny: "Deny",
        approval_allow_once: "Allow Once",
        approval_always_allow: "Always Allow",
        approval_always_allow_session: "Always Allow (This Session)",
      },
    },
  },
});

function mountCard(props: { disabled?: boolean; loading?: boolean } = {}) {
  return mount(SkillApprovalCard, {
    props: {
      toolName: "scrape_urls_from_search_engine",
      permissionCategory: "network",
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        VIcon: true,
        VChip: { template: "<span><slot /></span>" },
        VBtn: {
          props: ["disabled", "loading"],
          emits: ["click"],
          template:
            "<button :disabled=\"disabled\" :data-loading=\"loading ? 'true' : 'false'\" @click=\"$emit('click')\"><slot /></button>",
        },
      },
    },
  });
}

describe("SkillApprovalCard disabled state", () => {
  beforeEach(() => {
    Object.defineProperty(window, "api", {
      value: { invoke: vi.fn().mockResolvedValue({ status: true }) },
      configurable: true,
    });
  });

  it("does not grant or emit when disabled", async () => {
    const wrapper = mountCard({ disabled: true });
    await wrapper.findAll("button")[2].trigger("click");
    await flushPromises();

    const invoke = (window as WindowWithApi).api?.invoke;
    expect(invoke).not.toHaveBeenCalled();
    expect(wrapper.emitted("grant")).toBeUndefined();
  });

  it("grants and emits when enabled", async () => {
    const wrapper = mountCard();
    await wrapper.findAll("button")[2].trigger("click");
    await flushPromises();

    const invoke = (window as WindowWithApi).api?.invoke;
    expect(invoke).toHaveBeenCalledWith("skill:grant-permission", {
      skillName: "scrape_urls_from_search_engine",
      persistent: true,
    });
    expect(wrapper.emitted("grant")?.[0]).toEqual([{ persistent: true }]);
  });

  it("shows loading and blocks duplicate grant while parent resume is pending", async () => {
    const wrapper = mountCard({ loading: true });
    const alwaysAllowButton = wrapper.findAll("button")[2];

    expect(alwaysAllowButton.attributes("data-loading")).toBe("true");
    await alwaysAllowButton.trigger("click");
    await flushPromises();

    const invoke = (window as WindowWithApi).api?.invoke;
    expect(invoke).not.toHaveBeenCalled();
    expect(wrapper.emitted("grant")).toBeUndefined();
  });
});
