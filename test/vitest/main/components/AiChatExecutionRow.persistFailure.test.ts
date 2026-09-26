// test/vitest/main/components/AiChatExecutionRow.persistFailure.test.ts
//
// Stage A2 (generator-streaming PRD FR-006/017, AC-02): a required
// persistence failure renders the tool card as failed with the localized
// "not run / result not saved" reason — never running, never success.
import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatExecutionRow from "@/views/components/aiChatWorkspace/AiChatExecutionRow.vue";
import {
  buildToolExecutionGroups,
  type ToolExecutionView,
} from "@/views/components/aiChatWorkspace/toolExecutionProjection";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        execution: {
          runningTool: "Running {tool}",
          toolPersistFailure: {
            toolCallNotSaved: "Tool not run: it could not be saved.",
            toolResultNotSaved: "Tool ran but its result could not be saved.",
          },
        },
        status: {
          failed: "Failed",
        },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

function toolCallMessage(
  persistFailure?: "tool_call_persist_failed" | "tool_result_persist_failed"
): ChatV2MessageView {
  return {
    id: "msg-call-1",
    conversationId: "v2-c",
    role: "assistant",
    content: "",
    timestamp: new Date(0).toISOString(),
    messageType: MessageType.TOOL_CALL,
    metadata: {
      source: "chat-v2",
      toolCallId: "tc-1",
      toolName: "send_email",
      toolArguments: { to: "a@b.c" },
      ...(persistFailure ? { toolPersistFailure: persistFailure } : {}),
    },
  };
}

function mountRow(execution: ToolExecutionView) {
  return mount(AiChatExecutionRow, {
    global: {
      plugins: [i18n],
      stubs: {
        WorkspaceStatusIndicator: true,
        SemanticToolResult: true,
        AiChatExecutionDetail: true,
      },
    },
    props: { execution },
  });
}

describe("AiChatExecutionRow persistence-failure states (Stage A2, FR-006)", () => {
  it("projection marks a tool_call row failed when the call could not be saved", () => {
    const groups = buildToolExecutionGroups([toolCallMessage("tool_call_persist_failed")]);
    expect(groups).toHaveLength(1);
    const exec = groups[0].executions[0];
    expect(exec.status).toBe("failed");
    expect(exec.isError).toBe(true);
    expect(exec.persistFailure).toBe("tool_call_persist_failed");
  });

  it("projection marks a tool card result-not-saved when the result write failed", () => {
    const groups = buildToolExecutionGroups([toolCallMessage("tool_result_persist_failed")]);
    const exec = groups[0].executions[0];
    expect(exec.status).toBe("failed");
    expect(exec.persistFailure).toBe("tool_result_persist_failed");
  });

  it("projection keeps a normal tool_call row running (no false failures)", () => {
    const groups = buildToolExecutionGroups([toolCallMessage()]);
    const exec = groups[0].executions[0];
    expect(exec.status).toBe("running");
    expect(exec.persistFailure).toBeUndefined();
  });

  it("renders the localized not-run failure and never running or success", () => {
    const groups = buildToolExecutionGroups([toolCallMessage("tool_call_persist_failed")]);
    const wrapper = mountRow(groups[0].executions[0]);
    const label = wrapper.find('[data-testid="workspace-execution-persist-failure"]');
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe("Tool not run: it could not be saved.");
    expect(wrapper.find('[data-testid="workspace-execution-row-running"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="workspace-execution-row-completed"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="workspace-execution-row-failed"]').exists()).toBe(true);
  });

  it("renders the localized result-not-saved failure", () => {
    const groups = buildToolExecutionGroups([toolCallMessage("tool_result_persist_failed")]);
    const wrapper = mountRow(groups[0].executions[0]);
    const label = wrapper.find('[data-testid="workspace-execution-persist-failure"]');
    expect(label.text()).toBe("Tool ran but its result could not be saved.");
  });
});
