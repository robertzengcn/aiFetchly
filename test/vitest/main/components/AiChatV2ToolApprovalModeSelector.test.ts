import { describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2ToolApprovalModeSelector from "@/views/components/aiChatV2/AiChatV2ToolApprovalModeSelector.vue";
import type { ChatToolApprovalMode } from "@/entityTypes/aiChatV2Types";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        tool_approval_mode_label: "Tool Approval",
        tool_approval_mode_ask: "Ask for approval",
        tool_approval_mode_ask_desc: "Ask before tools that need permission.",
        tool_approval_mode_auto: "Approve for me",
        tool_approval_mode_auto_desc: "Automatically approve trusted tools.",
        tool_approval_mode_full: "Full access",
        tool_approval_mode_full_desc: "Run registered tools without prompts.",
        tool_approval_mode_full_confirm_title: "Enable Full Access?",
        tool_approval_mode_full_confirm_text:
          "Registered tools will run without approval prompts in this chat.",
        tool_approval_mode_full_enable: "Enable Full Access",
        tool_approval_mode_full_cancel: "Cancel",
      },
    },
  },
});

function mountSelector(props: {
  modelValue: ChatToolApprovalMode;
  compact?: boolean;
}): VueWrapper {
  return mount(AiChatV2ToolApprovalModeSelector, {
    props,
    global: {
      plugins: [i18n],
      stubs: {
        VSelect: {
          name: "VSelect",
          props: [
            "modelValue",
            "items",
            "variant",
            "prependInnerIcon",
            "ariaLabel",
            "listProps",
          ],
          emits: ["update:modelValue"],
          template: `
            <div class="stub-select" :aria-label="ariaLabel" :data-variant="variant" :data-icon="prependInnerIcon">
              <span>{{ items.find((item) => item.value === modelValue)?.title }}</span>
              <slot name="prepend-item" />
              <button v-for="item in items" :key="item.value" @click="$emit('update:modelValue', item.value)">
                {{ item.title }}
                <slot name="item" :item="{ raw: item }" :props="{}" />
              </button>
            </div>`,
        },
        VDialog: {
          props: ["modelValue"],
          template: '<div v-if="modelValue" role="dialog"><slot /></div>',
        },
        VBtn: { template: '<button><slot /></button>' },
        VListItem: { template: '<div><slot name="subtitle" /><slot /></div>' },
        VIcon: true,
        VDivider: true,
        VCard: { template: '<div><slot /></div>' },
        VCardTitle: { template: '<div><slot /></div>' },
        VCardText: { template: '<div><slot /></div>' },
        VCardActions: { template: '<div><slot /></div>' },
        VSpacer: true,
      },
    },
  });
}

describe("AiChatV2ToolApprovalModeSelector", () => {
  it("shows the selected policy and explains the available modes in the compact control", () => {
    const wrapper = mountSelector({ modelValue: "ask_for_approval", compact: true });
    const select = wrapper.get('[data-testid="chat-permission-selector"]');
    expect(select.attributes("aria-label")).toBe("Tool Approval");
    expect(select.attributes("data-icon")).toBe("mdi-shield-outline");
    expect(select.text()).toContain("Ask before tools that need permission.");
    expect(select.text()).toContain("Automatically approve trusted tools.");
    expect(select.text()).toContain("Run registered tools without prompts.");
  });

  it("requires explicit confirmation before enabling Full access", async () => {
    const wrapper = mountSelector({ modelValue: "ask_for_approval", compact: true });
    const select = wrapper.get('[data-testid="chat-permission-selector"]');
    const fullAccess = select
      .findAll("button")
      .find((button) => button.text().includes("Full access"));
    expect(fullAccess).toBeDefined();
    await fullAccess?.trigger("click");
    const dialog = wrapper.get('[role="dialog"]');
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await dialog.get("button:first-of-type").trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await fullAccess?.trigger("click");
    await wrapper.get('[role="dialog"] button:last-of-type').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["full_access"]]);
  });

  it("keeps the legacy selector outlined", () => {
    const wrapper = mountSelector({ modelValue: "ask_for_approval" });
    expect(wrapper.get(".stub-select").attributes("data-variant")).toBe("outlined");
  });

  it("allows safety descriptions to wrap only in the compact menu", () => {
    const compact = mountSelector({ modelValue: "ask_for_approval", compact: true });
    const legacy = mountSelector({ modelValue: "ask_for_approval" });
    expect(compact.getComponent({ name: "VSelect" }).props("listProps")).toEqual({
      lines: false,
    });
    expect(legacy.getComponent({ name: "VSelect" }).props("listProps")).toBeUndefined();
  });
});
