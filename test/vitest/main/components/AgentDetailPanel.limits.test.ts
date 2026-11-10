import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import AgentDetailPanel from "@/views/components/agents/AgentDetailPanel.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      subagents: {
        field_max_tool_calls: "Max tool calls",
        field_max_continue_calls: "Max continue calls",
        field_unlimited: "Unlimited",
        field_id: "ID",
        field_display_name: "Display name",
        column_description: "Description",
        column_mode: "Mode",
        column_model: "Default model",
        field_max_runtime_seconds: "Max runtime (seconds)",
        field_system_prompt: "System prompt",
        field_tools: "Allowed tools",
        field_output_schema: "Output schema",
        field_warnings: "Warnings",
        field_no_warnings: "No warnings",
        field_enabled: "Enabled",
        field_source_file: "Source file",
        field_component_path: "Component path",
        field_last_updated: "Last updated",
        field_created_at: "Created",
        source_plugin: "Plugin",
        status_active: "Active",
        status_disabled: "Disabled",
        readonly_plugin_hint: "Plugin agents are read-only.",
        delete_confirm: "Delete",
        button_cancel: "Cancel",
        edit_title: "Edit",
      },
    },
  },
});

const slotStub = defineComponent({
  template: "<div><slot /></div>",
});

const VDialog = defineComponent({
  props: { modelValue: { type: Boolean, default: false } },
  template: `<div v-if="modelValue"><slot /></div>`,
});

function pluginAgent(
  limits: Pick<AgentDefinitionView, "maxToolCalls" | "maxContinueCalls">
): AgentDefinitionView {
  return {
    id: "claude-blog:blog-researcher",
    name: "blog-researcher",
    description: "Research specialist",
    version: 1,
    systemPrompt: "Find sources.",
    allowedTools: ["WebSearch", "WebFetch"],
    mode: "specialist",
    maxRuntimeMs: 300000,
    outputSchema: {},
    status: "active",
    source: "plugin",
    pluginName: "claude-blog",
    health: "healthy",
    manifest: {},
    ...limits,
  };
}

function mountPanel(agent: AgentDefinitionView) {
  return mount(AgentDetailPanel, {
    props: { agent },
    global: {
      plugins: [i18n],
      stubs: {
        "v-dialog": VDialog,
        "v-card": slotStub,
        "v-card-title": slotStub,
        "v-card-text": slotStub,
        "v-card-actions": slotStub,
        "v-btn": slotStub,
        "v-icon": slotStub,
        "v-divider": slotStub,
        "v-chip": slotStub,
        "v-list": slotStub,
        "v-list-item": slotStub,
        "v-list-item-subtitle": slotStub,
        "v-switch": slotStub,
        "v-spacer": slotStub,
      },
    },
  });
}

describe("AgentDetailPanel limits", () => {
  it("shows Unlimited when a plugin agent omits both caps", () => {
    const wrapper = mountPanel(
      pluginAgent({ maxToolCalls: null, maxContinueCalls: null })
    );
    expect(wrapper.get("[data-testid='agent-max-tool-calls']").text()).toBe(
      "Unlimited"
    );
    expect(
      wrapper.get("[data-testid='agent-max-continue-calls']").text()
    ).toBe("Unlimited");
  });

  it("shows an authored tool-call cap", () => {
    const wrapper = mountPanel(
      pluginAgent({ maxToolCalls: 12, maxContinueCalls: null })
    );
    expect(wrapper.get("[data-testid='agent-max-tool-calls']").text()).toBe(
      "12"
    );
    expect(
      wrapper.get("[data-testid='agent-max-continue-calls']").text()
    ).toBe("Unlimited");
  });
});
