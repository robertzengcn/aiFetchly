import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatExecutionRow from "@/views/components/aiChatWorkspace/AiChatExecutionRow.vue";
import { buildToolExecutionGroups } from "@/views/components/aiChatWorkspace/toolExecutionProjection";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        execution: {
          runningTool: "Running {tool}",
          details: "Details",
          failureReason: "Error",
          arguments: "Arguments",
        },
        status: { failed: "Failed" },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

const REASON =
  "Agent claude-blog:blog-researcher exceeded max tool calls (8).";

function failedSubagentMessages(): ChatV2MessageView[] {
  return [
    {
      id: "call-1",
      conversationId: "v2-c",
      role: "assistant",
      content: "",
      timestamp: new Date(0).toISOString(),
      messageType: MessageType.TOOL_CALL,
      metadata: {
        source: "chat-v2",
        toolCallId: "tc-sub",
        toolName: "run_subagent",
        toolArguments: { agentId: "claude-blog:blog-researcher" },
      },
    },
    {
      id: "result-1",
      conversationId: "v2-c",
      role: "assistant",
      content: "",
      timestamp: new Date(1).toISOString(),
      messageType: MessageType.TOOL_RESULT,
      metadata: {
        source: "chat-v2",
        toolCallId: "tc-sub",
        toolName: "run_subagent",
        toolResult: { success: false, error: REASON },
        toolResultStatus: "error",
        success: false,
      },
    },
  ];
}

describe("AiChatExecutionRow subagent failure reason", () => {
  it("shows the agent error on the row and in expanded details", () => {
    const execution = buildToolExecutionGroups(failedSubagentMessages())[0]
      ?.executions[0];
    expect(execution).toBeDefined();
    const wrapper = mount(AiChatExecutionRow, {
      global: {
        plugins: [i18n],
        stubs: { "v-icon": true, WorkspaceStatusIndicator: true },
      },
      props: { execution: execution!, withDetails: true },
    });

    expect(
      wrapper.get('[data-testid="workspace-execution-failure-reason"]').text()
    ).toBe(REASON);
    expect(
      wrapper.get('[data-testid="workspace-execution-detail-summary"]').text()
    ).toBe(REASON);
    expect(wrapper.text()).toContain("Error");
  });
});
