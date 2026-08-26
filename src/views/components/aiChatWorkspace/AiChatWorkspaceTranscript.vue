<template>
  <!--
    Workspace transcript (FR-042..050, FR-052, FR-055, FR-056, FR-062):
    Projects the selected conversation's messages through the workspace
    execution-group and plan-presentation projections instead of rendering
    each message as a standalone legacy card. One evolving row per tool-call
    identity; plan decisions are lifecycle-specific; no generic Tool Call/
    Tool Result cards; no nested plan-document scroller; no duplicate
    plan-status surfaces.
  -->
  <div class="workspace-transcript" data-testid="workspace-transcript">
    <template v-for="item in projectedItems" :key="item.key">
      <!-- User messages render normally. -->
      <AiChatV2Message
        v-if="item.kind === 'user-message'"
        :message="item.message"
        :show-reasoning="false"
      />

      <!-- Assistant messages render normally (content + reasoning). -->
      <AiChatV2Message
        v-else-if="item.kind === 'assistant-message'"
        :message="item.message"
        :status="streamStatusForMessage(item.message)"
        :show-reasoning="showReasoning"
      />

      <!-- Execution groups: one compact section per assistant response. -->
      <AiChatExecutionGroup
        v-else-if="item.kind === 'execution-group'"
        :group="item.group"
      />

      <!-- Legacy unpaired tool rows: compact receipts. -->
      <AiChatExecutionRow
        v-else-if="item.kind === 'legacy-receipt'"
        :execution="item.execution"
      />

      <!-- Plan lifecycle surfaces: decision/receipt only, never the full doc. -->
      <AiChatPlanDecisionCard
        v-else-if="item.kind === 'plan-decision'"
        :plan="item.plan"
        @approve="onPlanApprove"
        @request-changes="onPlanRequestChanges()"
        @review-full-plan="openActivity"
      />
      <AiChatPlanReceipt
        v-else-if="item.kind === 'plan-receipt'"
        :plan="item.plan"
        @open-activity="openActivity"
      />

      <!-- Pinned plan question flow (FR-058: stays when inspector closed). -->
      <AiChatPlanQuestionFlow
        v-else-if="item.kind === 'plan-question'"
        :question="item.question"
        @submit="onPlanAnswer"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import AiChatExecutionGroup from "@/views/components/aiChatWorkspace/AiChatExecutionGroup.vue";
import AiChatExecutionRow from "@/views/components/aiChatWorkspace/AiChatExecutionRow.vue";
import AiChatPlanDecisionCard from "@/views/components/aiChatWorkspace/AiChatPlanDecisionCard.vue";
import AiChatPlanReceipt from "@/views/components/aiChatWorkspace/AiChatPlanReceipt.vue";
import AiChatPlanQuestionFlow from "@/views/components/aiChatWorkspace/AiChatPlanQuestionFlow.vue";
import {
  buildToolExecutionGroups,
  type ToolExecutionGroupView,
  type ToolExecutionView,
} from "@/views/components/aiChatWorkspace/toolExecutionProjection";
import {
  selectPlanPresentation,
  isReceiptSurface,
} from "@/views/components/aiChatWorkspace/planPresentationProjection";
import type {
  PlanPresentationView,
} from "@/views/components/aiChatWorkspace/planPresentationProjection";
import type { AIChatPlanQuestionView } from "@/entityTypes/aiChatPlanTypes";
import type { MessageType } from "@/entityTypes/commonType";

const props = defineProps<{
  messages: readonly ChatV2MessageView[];
  activeAssistantMessageId: string | null;
  streamStatus: "idle" | "streaming" | "cancelled" | "error";
  errorMessage?: string;
  showReasoning?: boolean;
  /** FR-059: submission error for the active plan-question flow. */
  planSubmitError?: string | null;
}>();

const emit = defineEmits<{
  (e: "approve-plan"): void;
  (e: "request-plan-changes", feedback: string): void;
  (e: "submit-plan-answers", answers: unknown[]): void;
  (e: "open-activity"): void;
}>();

type ProjectedItem =
  | { kind: "user-message"; key: string; message: ChatV2MessageView }
  | { kind: "assistant-message"; key: string; message: ChatV2MessageView }
  | { kind: "execution-group"; key: string; group: ToolExecutionGroupView }
  | { kind: "legacy-receipt"; key: string; execution: ToolExecutionView }
  | { kind: "plan-decision"; key: string; plan: PlanPresentationView }
  | { kind: "plan-receipt"; key: string; plan: PlanPresentationView }
  | { kind: "plan-question"; key: string; question: AIChatPlanQuestionView };

/**
 * Project the raw message list into the workspace transcript:
 * - User/assistant content messages render as before
 * - Tool calls+results are PAIRED into execution groups (FR-042..044)
 * - Unpaired legacy tool rows become compact receipts (FR-050)
 * - Plan metadata renders only as lifecycle-specific decision/receipt (FR-052)
 * - No generic Tool Call/Tool Result cards (FR-043)
 * - No nested plan-document scroller (FR-055)
 */
const projectedItems = computed<ProjectedItem[]>(() => {
  const messages = props.messages;
  const result: ProjectedItem[] = [];
  // FR-052: only one plan lifecycle surface per transcript (latest plan).
  let planSurfaceRendered = false;

  // Build execution groups from all tool messages.
  const groups = buildToolExecutionGroups(messages);
  const groupByFirstMessageId = new Map<string, ToolExecutionGroupView>();
  const receiptKeys = new Set<string>();
  for (const group of groups) {
    // Find the message id of the first execution in this group to place it.
    const firstExec = group.executions[0];
    if (firstExec) {
      groupByFirstMessageId.set(firstExec.key, group);
    }
    for (const exec of group.executions) {
      receiptKeys.add(exec.key);
    }
  }

  // Walk messages in order; replace tool sequences with groups.
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];

    if (msg.messageType === ("tool_call" as MessageType) ||
        msg.messageType === ("tool_result" as MessageType)) {
      // Find the group that owns this tool sequence.
      const toolCallId = msg.metadata?.toolCallId;
      const group = groups.find((g) =>
        g.executions.some(
          (e) =>
            e.toolCallId === toolCallId ||
            e.key === `exec-${toolCallId}` ||
            e.key === `legacy-result-${msg.id}` ||
            e.key === `legacy-call-${msg.id}`
        )
      );
      if (group && group.executions.length > 0) {
        // One group per assistant response. Skip ahead past all tool messages
        // in this group.
        result.push({
          kind: "execution-group",
          key: group.key,
          group,
        });
        // Skip all consecutive tool messages.
        i += 1;
        while (
          i < messages.length &&
          (messages[i].messageType === ("tool_call" as MessageType) ||
            messages[i].messageType === ("tool_result" as MessageType))
        ) {
          i += 1;
        }
      } else {
        // Legacy unpaired receipt.
        result.push({
          kind: "legacy-receipt",
          key: `legacy-${msg.id}`,
          execution: {
            key: `legacy-${msg.id}`,
            assistantMessageId: null,
            toolCallId: msg.metadata?.toolCallId ?? null,
            toolName: msg.metadata?.toolName ?? "",
            status:
              msg.messageType === ("tool_result" as MessageType)
                ? msg.metadata?.toolResultStatus === "error"
                  ? "failed"
                  : "completed"
                : "completed",
            outputKind: "summary",
            isError: msg.metadata?.toolResultStatus === "error",
            isLegacyUnpaired: true,
            summary: msg.metadata?.toolResultSummary ?? msg.content,
          },
        });
        i += 1;
      }
      continue;
    }

    // Plan metadata: render only ONE lifecycle-specific surface for the latest
    // plan (FR-052). The loop calls selectPlanPresentation once per
    // plan-bearing message, so deduplicate by skipping all plan messages
    // after the first one that produced a surface.
    if (msg.metadata?.planEventType || msg.metadata?.planStateView) {
      if (planSurfaceRendered) {
        // Skip duplicate plan metadata — only the latest plan gets a surface.
        i += 1;
        continue;
      }
      const plan = selectPlanPresentation(messages);
      if (plan) {
        planSurfaceRendered = true; // mark so no subsequent plan message duplicates
        if (plan.surface === "approval") {
          result.push({
            kind: "plan-decision",
            key: `plan-decision-${plan.planId}-${plan.version}`,
            plan,
          });
        } else if (isReceiptSurface(plan.surface)) {
          result.push({
            kind: "plan-receipt",
            key: `plan-receipt-${plan.planId}-${plan.version}`,
            plan,
          });
        } else if (plan.surface === "question" && plan.pendingQuestion) {
          result.push({
            kind: "plan-question",
            key: `plan-question-${plan.pendingQuestion.questionId}`,
            question: plan.pendingQuestion,
          });
        }
        // Drafting/executing/completed-without-receipt: skip — the run strip
        // and Activity own those states (FR-062: no duplicate surfaces).
      }
      i += 1;
      continue;
    }

    // Regular message.
    if (msg.role === "user") {
      result.push({ kind: "user-message", key: msg.id, message: msg });
    } else {
      result.push({ kind: "assistant-message", key: msg.id, message: msg });
    }
    i += 1;
  }

  return result;
});

function streamStatusForMessage(
  message: ChatV2MessageView
): "idle" | "streaming" | "cancelled" | "error" | undefined {
  if (props.activeAssistantMessageId === message.id) {
    return props.streamStatus;
  }
  return undefined;
}

function onPlanApprove(): void {
  emit("approve-plan");
}

function onPlanRequestChanges(): void {
  emit("request-plan-changes", "");
}

function onPlanAnswer(answers: unknown[]): void {
  emit("submit-plan-answers", answers);
}

function openActivity(): void {
  emit("open-activity");
}
</script>

<style scoped>
.workspace-transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
}
</style>
