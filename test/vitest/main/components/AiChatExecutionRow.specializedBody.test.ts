/**
 * Specialized-result body suppression (R8 P3, PRD §13.3).
 *
 * A specialized card (skill install, outbound batch, generated-image batch)
 * renders as its OWN transcript surface beside the execution group — the
 * group row must keep its identity (status, label, Activity detail) but
 * suppress the generic SemanticToolResult body, or the same result renders
 * twice.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatExecutionRow from "@/views/components/aiChatWorkspace/AiChatExecutionRow.vue";
import {
  buildToolExecutionGroups,
  hasSpecializedSurface,
  isBatchToolCard,
  isSkillInstallResult,
  type ToolExecutionView,
} from "@/views/components/aiChatWorkspace/toolExecutionProjection";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      workspaceChat: {
        execution: { runningTool: "Running {tool}" },
        status: { completed: "Completed" },
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
});

function toolCall(id: string, toolName: string): ChatV2MessageView {
  return {
    id: `call-${id}`,
    conversationId: "v2-c",
    role: "assistant",
    content: "",
    timestamp: new Date(0).toISOString(),
    messageType: MessageType.TOOL_CALL,
    metadata: {
      source: "chat-v2",
      toolCallId: id,
      toolName,
      toolArguments: {},
    },
  } as unknown as ChatV2MessageView;
}

function toolResult(
  id: string,
  toolName: string,
  toolResult: Record<string, unknown>
): ChatV2MessageView {
  return {
    id: `result-${id}`,
    conversationId: "v2-c",
    role: "tool",
    content: "result",
    timestamp: new Date(1).toISOString(),
    messageType: MessageType.TOOL_RESULT,
    metadata: {
      source: "chat-v2",
      toolCallId: id,
      toolName,
      toolResult,
      toolResultStatus: "success",
    },
  } as unknown as ChatV2MessageView;
}

function mountRow(execution: ToolExecutionView) {
  return mount(AiChatExecutionRow, {
    global: {
      plugins: [i18n],
      stubs: {
        WorkspaceStatusIndicator: true,
        SemanticToolResult: {
          template: '<div data-testid="semantic-body-stub" />',
        },
        AiChatExecutionDetail: {
          props: ["execution"],
          template: '<div data-testid="execution-detail-stub" />',
        },
      },
    },
    props: { execution, withDetails: true },
  });
}

describe("specialized-result body suppression (R8 P3)", () => {
  it("flags a skill-install result as specialized in the projection", () => {
    const skillResult = toolResult("tc-skill", "skill_install_wordpress", {
      sessionId: "install-session-1",
    });
    expect(isSkillInstallResult(skillResult)).toBe(true);
    expect(hasSpecializedSurface(skillResult)).toBe(true);

    const groups = buildToolExecutionGroups([
      toolCall("tc-skill", "skill_install_wordpress"),
      skillResult,
    ]);
    expect(groups[0].executions[0].hasSpecializedCard).toBe(true);
  });

  it("flags an outbound-batch result as specialized", () => {
    const batchResult = toolResult("tc-batch", "draft_outbound_email_batch", {
      batchId: 42,
    });
    expect(hasSpecializedSurface(batchResult)).toBe(true);
    const groups = buildToolExecutionGroups([
      toolCall("tc-batch", "draft_outbound_email_batch"),
      batchResult,
    ]);
    expect(groups[0].executions[0].hasSpecializedCard).toBe(true);
  });

  it("flags a generated-image batch card as specialized", () => {
    const imageResult = toolResult("tc-img", "process_artifact_batch", {
      images: [{ id: "img-1" }],
    });
    expect(isBatchToolCard(imageResult)).toBe(true);
    expect(hasSpecializedSurface(imageResult)).toBe(true);
  });

  it("does NOT flag an ordinary tool result as specialized", () => {
    const plain = toolResult("tc-plain", "send_email", { ok: true });
    expect(hasSpecializedSurface(plain)).toBe(false);
    const groups = buildToolExecutionGroups([
      toolCall("tc-plain", "send_email"),
      plain,
    ]);
    expect(groups[0].executions[0].hasSpecializedCard).toBe(false);
  });

  it("suppresses the generic body but keeps identity and Activity detail", () => {
    const groups = buildToolExecutionGroups([
      toolCall("tc-skill", "skill_install_wordpress"),
      toolResult("tc-skill", "skill_install_wordpress", {
        sessionId: "install-session-1",
      }),
    ]);
    const wrapper = mountRow(groups[0].executions[0]);

    // Generic body suppressed…
    expect(wrapper.find('[data-testid="semantic-body-stub"]').exists()).toBe(
      false
    );
    // …execution identity kept (status row + label render)…
    expect(
      wrapper.find('[data-testid="workspace-execution-row-completed"]').exists()
    ).toBe(true);
    // …Activity detail kept.
    expect(wrapper.find('[data-testid="execution-detail-stub"]').exists()).toBe(
      true
    );
  });

  it("keeps the generic body for an ordinary result", () => {
    const groups = buildToolExecutionGroups([
      toolCall("tc-plain", "send_email"),
      toolResult("tc-plain", "send_email", { ok: true }),
    ]);
    const wrapper = mountRow(groups[0].executions[0]);
    expect(wrapper.find('[data-testid="semantic-body-stub"]').exists()).toBe(
      true
    );
  });
});
