import { describe, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";

/**
 * Component test for the "running" badge on TOOL_CALL messages.
 *
 * These tests verify the conditional rendering in AiChatV2Message.vue that
 * was added to surface `tool_progress` streaming events to the user. The
 * badge lives inside the TOOL_CALL branch of the template and only renders
 * when `message.metadata.toolProgress` is truthy.
 *
 * The component uses `useI18n()` directly (real vue-i18n plugin required,
 * NOT a `$t` mock), and references Vuetify components (`v-icon`,
 * `v-progress-linear`). Without the Vuetify plugin registered, these render
 * as unresolved custom elements with their kebab-case tag names — Vuetify's
 * runtime is what applies the `.v-progress-linear` etc. classes, so the
 * Vuetify components used by this branch are stubbed explicitly.
 *
 * NOTE: This file MUST be run with the dedicated workspace config
 * `test/vitest/main/components/vitest.config.mjs` (which sets
 * `environment: 'happy-dom'`). Running it under the default
 * `vite.main.config.mjs` will fail because the default node environment
 * has no DOM.
 */

// Minimal i18n instance so useI18n() inside the component resolves.
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      aiChatV2: {
        tool_call_title: "Tool Call",
        tool_name: "Tool",
        tool_running: "Running...",
        tool_arguments: "Arguments",
      },
    },
  },
});

/**
 * Build a minimal TOOL_CALL message that exercises the TOOL_CALL branch of
 * the template. `toolProgress` is added per-test as needed.
 *
 * ChatV2MessageView is a large union; the fields set here are exactly what
 * the TOOL_CALL template branch reads. The `as unknown as ChatV2MessageView`
 * cast is acceptable because constructing the full union is not worth the
 * noise for a unit test.
 */
function makeBaseMessage(): ChatV2MessageView {
  return {
    id: "m1",
    conversationId: "c1",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    messageType: MessageType.TOOL_CALL,
    metadata: {
      source: "chat-v2",
      toolCallId: "tc1",
      toolName: "run_subagent",
      toolArguments: {},
    },
  } as unknown as ChatV2MessageView;
}

/**
 * Mount AiChatV2Message with the i18n plugin installed and the conditional
 * sub-components stubbed out. The stubbed components are only rendered in
 * the TOOL_RESULT / plan-card / streaming-status branches, none of which
 * are exercised by these tests — stubbing keeps the mount hermetic.
 */
function mountWith(message: ChatV2MessageView) {
  return mount(AiChatV2Message, {
    props: { message },
    global: {
      plugins: [i18n],
      stubs: {
        SkillApprovalCard: true,
        AiChatV2StreamStatus: true,
        AiChatV2PlanApprovalCard: true,
        VIcon: true,
        VProgressLinear: {
          template: "<div class=\"v-progress-linear\" />",
        },
      },
    },
  });
}

describe("AiChatV2Message tool progress badge", () => {
  it("renders spinner and message when toolProgress metadata is present", async () => {
    const base = makeBaseMessage();
    base.metadata!.toolProgress = {
      phase: "running",
      message: "Subagent running...",
      progress: null,
      partialCount: null,
      expectedCount: null,
      updatedAt: Date.now(),
    };
    const wrapper = mountWith(base);
    await flushPromises();
    // The badge renders the toolProgress.message verbatim.
    expect(wrapper.text()).toContain("Subagent running...");
    // And the badge container itself is present.
    expect(wrapper.find(".tool-progress-badge").exists()).toBe(true);
  });

  it("does not render progress badge when toolProgress is absent", async () => {
    const wrapper = mountWith(makeBaseMessage());
    await flushPromises();
    expect(wrapper.find(".tool-progress-badge").exists()).toBe(false);
  });

  it("renders progress bar and count when progress and counts are set", async () => {
    const base = makeBaseMessage();
    base.metadata!.toolProgress = {
      phase: "extracting",
      message: "Extracting",
      progress: 0.42,
      partialCount: 4,
      expectedCount: 10,
      updatedAt: Date.now(),
    };
    const wrapper = mountWith(base);
    await flushPromises();
    const bar = wrapper.find(".v-progress-linear");
    expect(bar.exists()).toBe(true);
    // The count text "(4/10)" is rendered inside the badge.
    expect(wrapper.text()).toContain("4/10");
  });
});
