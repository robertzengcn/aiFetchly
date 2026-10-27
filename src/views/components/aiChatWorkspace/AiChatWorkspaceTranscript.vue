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
    <!-- Queued (pending) rows: user bubbles in creation order, visually
         distinct; they deliver later through the queue drain. -->
    <AiChatV2PendingMessage
      v-for="pending in pendingMessages"
      :key="`pending-${pending.pendingMessageId}`"
      :view="pending"
      :runtime-status="pendingRuntimeStatus"
      @steer="(id: string) => emit('steer-pending', id)"
      @cancel="(id: string) => emit('cancel-pending', id)"
      @resume="(id: string) => emit('resume-pending', id)"
    />

    <template v-for="item in projectedItems" :key="item.key">
      <!-- User messages render normally. data-message-id anchors history
           navigation (FR-HIS-001 scroll-to-source). -->
      <AiChatV2Message
        v-if="item.kind === 'user-message'"
        :message="item.message"
        :show-reasoning="false"
        :data-message-id="item.message.id"
        @use-generated-image="(ref) => emit('use-generated-image', ref)"
        @edit-generated-image="(ref) => emit('edit-generated-image', ref)"
        @save-generated-image="(ref) => emit('save-generated-image', ref)"
        @stop-batch="emit('stop-batch')"
        @retry-generated-image-batch="(p) => emit('retry-generated-image-batch', p)"
      />

      <!-- Assistant messages render normally (content + reasoning). -->
      <AiChatV2Message
        v-else-if="item.kind === 'assistant-message'"
        :message="item.message"
        :status="streamStatusForMessage(item.message)"
        :show-reasoning="showReasoning"
        :data-message-id="item.message.id"
        :reported="reportedMessageIds?.has(item.message.id) === true"
        @use-generated-image="(ref) => emit('use-generated-image', ref)"
        @edit-generated-image="(ref) => emit('edit-generated-image', ref)"
        @save-generated-image="(ref) => emit('save-generated-image', ref)"
        @stop-batch="emit('stop-batch')"
        @retry-generated-image-batch="(p) => emit('retry-generated-image-batch', p)"
        @report="(d) => emit('report', d)"
      />

      <!-- Execution groups: one compact section per assistant response. -->
      <AiChatExecutionGroup
        v-else-if="item.kind === 'execution-group'"
        :group="item.group"
        @reopen-artifact="emit('reopen-artifact', $event)"
        @use-generated-image="(ref) => emit('use-generated-image', ref)"
      />

      <!-- Legacy unpaired tool rows: compact receipts. -->
      <AiChatExecutionRow
        v-else-if="item.kind === 'legacy-receipt'"
        :execution="item.execution"
      />

      <!-- Permission prompt (FR-047, design §15.5): interactive approval
           card for a gated tool parked mid-execution. -->
      <AiChatV2Message
        v-else-if="item.kind === 'permission-prompt'"
        :message="item.message"
        :show-reasoning="false"
        @grant-permission="
          (msg, payload) => emit('grant-permission', msg, payload)
        "
        @deny-permission="(msg) => emit('deny-permission', msg)"
        @stop-batch="emit('stop-batch')"
        @retry-generated-image-batch="(p) => emit('retry-generated-image-batch', p)"
      />

      <!-- Outbound-email batch (§18): the review/approve/send card IS the
           authorization surface (AD-003) — interactive, never a collapsed
           execution receipt. -->
      <AiChatOutboundBatchReviewCard
        v-else-if="item.kind === 'outbound-batch'"
        :message="item.message"
      />

      <!-- Skill installation (FR-SKL-001): the shared install card with plan
           approval, dependencies, credentials, retry and cancel — mounted
           through AiChatV2Message so the exact SkillInstallCard branch
           (session identity + conversation binding) renders. -->
      <AiChatV2Message
        v-else-if="item.kind === 'skill-install'"
        :message="item.message"
        :show-reasoning="false"
        @stop-batch="emit('stop-batch')"
        @retry-generated-image-batch="(p) => emit('retry-generated-image-batch', p)"
      />

      <!-- Generated-image batch (T3/D2, FR-IMG-010..012): live progress,
           Stop (keeps completed outputs), and Retry-failed — mounted through
           AiChatV2Message so the exact batch-card branch renders with its
           events, never a collapsed execution receipt. -->
      <AiChatV2Message
        v-else-if="item.kind === 'batch-card'"
        :message="item.message"
        :show-reasoning="false"
        :status="streamStatusForMessage(item.message)"
        @stop-batch="emit('stop-batch')"
        @retry-generated-image-batch="(p) => emit('retry-generated-image-batch', p)"
      />

      <!-- Plan lifecycle surfaces: decision/receipt only, never the full doc. -->
      <AiChatPlanDecisionCard
        v-else-if="item.kind === 'plan-decision'"
        :plan="item.plan"
        :disabled="planDecisionInFlight"
        :error="planDecisionError"
        @approve="onPlanApprove"
        @request-changes="onPlanRequestChanges()"
        @review-full-plan="openActivity"
        @discard="emit('discard')"
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
        :submit-error="props.planSubmitError"
        @submit="onPlanAnswer"
      />
    </template>
    <AiChatV2StreamStatus
      v-if="streamStatus === 'error' && errorMessage"
      status="error"
      :error-message="errorMessage"
      data-testid="workspace-transcript-error"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  AIChatPendingMessageView,
  ChatV2GeneratedImageReference,
  ChatV2MessageView,
} from "@/entityTypes/aiChatV2Types";
import AiChatV2Message from "@/views/components/aiChatV2/AiChatV2Message.vue";
import AiChatV2PendingMessage from "@/views/components/aiChatV2/AiChatV2PendingMessage.vue";
import AiChatV2StreamStatus from "@/views/components/aiChatV2/AiChatV2StreamStatus.vue";
import AiChatExecutionGroup from "@/views/components/aiChatWorkspace/AiChatExecutionGroup.vue";
import AiChatOutboundBatchReviewCard from "@/views/components/aiChatWorkspace/AiChatOutboundBatchReviewCard.vue";
import AiChatExecutionRow from "@/views/components/aiChatWorkspace/AiChatExecutionRow.vue";
import AiChatPlanDecisionCard from "@/views/components/aiChatWorkspace/AiChatPlanDecisionCard.vue";
import AiChatPlanReceipt from "@/views/components/aiChatWorkspace/AiChatPlanReceipt.vue";
import AiChatPlanQuestionFlow from "@/views/components/aiChatWorkspace/AiChatPlanQuestionFlow.vue";
import {
  buildToolExecutionGroups,
  isBatchToolCard,
  isPlanModeUiToolName,
  isSkillInstallResult,
  type ToolExecutionGroupView,
  type ToolExecutionView,
} from "@/views/components/aiChatWorkspace/toolExecutionProjection";
import {
  selectPlanPresentation,
  isReceiptSurface,
  isPinnedSurface,
} from "@/views/components/aiChatWorkspace/planPresentationProjection";
import type {
  PlanPresentationView,
} from "@/views/components/aiChatWorkspace/planPresentationProjection";
import type { AIChatPlanQuestionView } from "@/entityTypes/aiChatPlanTypes";
import type { MessageType } from "@/entityTypes/commonType";
import { isOutboundBatchResultMessage } from "@/views/components/outboundEmail/outboundBatchCardModel";
import type { ReportableOutputDescriptor } from "@/views/components/aiContentReport/reportableOutput";

const props = defineProps<{
  messages: readonly ChatV2MessageView[];
  activeAssistantMessageId: string | null;
  streamStatus: "idle" | "streaming" | "cancelled" | "error";
  errorMessage?: string;
  showReasoning?: boolean;
  /** FR-059: submission error for the active plan-question flow. */
  planSubmitError?: string | null;
  /** FR-PLN-003: decision actions lock while their request is in flight. */
  planDecisionInFlight?: boolean;
  /** FR-PLN-005: safe retry error for a decision that did not take effect. */
  planDecisionError?: string | null;
  /** Queued rows from the durable pending-message queue (PRD §7). */
  pendingMessages?: readonly AIChatPendingMessageView[];
  /**
   * FR-RPT-009: session-only reported output ids (parent-owned) so reportable
   * tiles stay visibly marked for the current renderer session.
   */
  reportedMessageIds?: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  (e: "approve-plan"): void;
  (e: "request-plan-changes", feedback: string): void;
  (e: "submit-plan-answers", answers: unknown[]): void;
  (e: "open-activity"): void;
  /** FR-056: discard/reject from the decision card overflow. */
  (e: "discard"): void;
  /** FR-030: reopen a persisted artifact from the transcript. */
  (e: "reopen-artifact", artifactId: string): void;
  /** Permission card forwarded from AiChatV2Message (design §15.5). */
  (
    e: "grant-permission",
    message: ChatV2MessageView,
    payload: { persistent: boolean }
  ): void;
  (e: "deny-permission", message: ChatV2MessageView): void;
  /**
   * Generated-image reference actions forwarded from AiChatV2Message tiles
   * (Use as reference / Edit) so the composer tray can attach them.
   */
  (
    e: "use-generated-image",
    reference: ChatV2GeneratedImageReference
  ): void;
  (
    e: "edit-generated-image",
    reference: ChatV2GeneratedImageReference
  ): void;
  (e: "steer-pending", pendingMessageId: string): void;
  (e: "cancel-pending", pendingMessageId: string): void;
  (e: "resume-pending", conversationId: string): void;
  /** FR-RPT-001/002: per-output report action from a reportable tile. */
  (e: "report", descriptor: ReportableOutputDescriptor): void;
  /** FR-IMG-013: save one generated image to the trusted workspace. */
  (
    e: "save-generated-image",
    reference: ChatV2GeneratedImageReference
  ): void;
  /** FR-IMG-012: stop a running generated-image batch. */
  (e: "stop-batch"): void;
  /** FR-IMG-011: retry only the eligible failed batch references. */
  (
    e: "retry-generated-image-batch",
    payload: {
      references: ChatV2GeneratedImageReference[];
      instruction: string;
    }
  ): void;
}>();

type ProjectedItem =
  | { kind: "user-message"; key: string; message: ChatV2MessageView }
  | { kind: "assistant-message"; key: string; message: ChatV2MessageView }
  | { kind: "execution-group"; key: string; group: ToolExecutionGroupView }
  | { kind: "legacy-receipt"; key: string; execution: ToolExecutionView }
  | { kind: "plan-decision"; key: string; plan: PlanPresentationView }
  | { kind: "plan-receipt"; key: string; plan: PlanPresentationView }
  | { kind: "plan-question"; key: string; question: AIChatPlanQuestionView }
  | { kind: "permission-prompt"; key: string; message: ChatV2MessageView }
  | { kind: "outbound-batch"; key: string; message: ChatV2MessageView }
  | { kind: "skill-install"; key: string; message: ChatV2MessageView }
  | { kind: "batch-card"; key: string; message: ChatV2MessageView };

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
  // Whether any plan-bearing message exists (guards the surface selection).
  let sawPlanMessage = false;
  // Projected position of the LATEST plan-state row — the chronological
  // anchor where a resolved receipt returns to message history (PRD §12.4).
  let receiptAnchor = -1;
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
        // in this group, surfacing gated-tool permission prompts hidden among
        // them as interactive cards after the group (design §15.5).
        result.push({
          kind: "execution-group",
          key: group.key,
          group,
        });
        // The anchor tool message itself can carry an interactive surface
        // (a solo batch result owns a legacy group) — check it too.
        if (isOutboundBatchResultMessage(msg)) {
          result.push({
            kind: "outbound-batch",
            key: `outbound-batch-${msg.id}`,
            message: msg,
          });
        }
        // FR-SKL-001: installation results render the shared install card
        // (approvals, dependencies, credentials) outside the collapsed group.
        if (isSkillInstallResult(messages[i])) {
          result.push({
            kind: "skill-install",
            key: `skill-install-${messages[i].id}`,
            message: messages[i],
          });
        }
        // T4/D1 (audit): an ANCHOR message can itself be a permission prompt
        // (a failed-resume restored row, or a historical prompt whose paired
        // call sits outside the mounted window) — surface it too, mirroring
        // the in-loop branch, or the decision card silently disappears.
        if (isPermissionPrompt(messages[i])) {
          result.push({
            kind: "permission-prompt",
            key: `permission-${messages[i].id}`,
            message: messages[i],
          });
        }
        // T3/D2 (audit): generated-image batch cards carry live progress,
        // Stop, and Retry — they must not collapse into a generic receipt.
        if (isBatchToolCard(messages[i])) {
          result.push({
            kind: "batch-card",
            key: `batch-card-${messages[i].id}`,
            message: messages[i],
          });
        }
        // Skip all consecutive tool messages.
        i += 1;
        while (
          i < messages.length &&
          (messages[i].messageType === ("tool_call" as MessageType) ||
            messages[i].messageType === ("tool_result" as MessageType))
        ) {
          if (isPermissionPrompt(messages[i])) {
            result.push({
              kind: "permission-prompt",
              key: `permission-${messages[i].id}`,
              message: messages[i],
            });
          }
          // The outbound batch card is the review/approve/send authorization
          // surface (§18, AD-003) — surface it beside the group, not inside
          // the collapsed receipt.
          if (isOutboundBatchResultMessage(messages[i])) {
            result.push({
              kind: "outbound-batch",
              key: `outbound-batch-${messages[i].id}`,
              message: messages[i],
            });
          }
          if (isSkillInstallResult(messages[i])) {
            result.push({
              kind: "skill-install",
              key: `skill-install-${messages[i].id}`,
              message: messages[i],
            });
          }
          if (isBatchToolCard(messages[i])) {
            result.push({
              kind: "batch-card",
              key: `batch-card-${messages[i].id}`,
              message: messages[i],
            });
          }
          i += 1;
        }
      } else if (isPermissionPrompt(msg)) {
        // Unpaired gated tool result: the interactive card IS the surface —
        // a compact receipt would hide the approval decision from the user.
        result.push({
          kind: "permission-prompt",
          key: `permission-${msg.id}`,
          message: msg,
        });
        i += 1;
      } else if (isSkillInstallResult(msg)) {
        // FR-SKL-001: unpaired (historical) installation result — the
        // interactive install card IS the surface, never a collapsed receipt.
        result.push({
          kind: "skill-install",
          key: `skill-install-${msg.id}`,
          message: msg,
        });
        i += 1;
      } else if (isBatchToolCard(msg)) {
        // T3/D2: an unpaired (live or historical) batch card — progress,
        // Stop, and Retry stay interactive, never a collapsed receipt.
        result.push({
          kind: "batch-card",
          key: `batch-card-${msg.id}`,
          message: msg,
        });
        i += 1;
      } else if (isOutboundBatchResultMessage(msg)) {
        // Unpaired outbound batch result: same rule — the review card IS the
        // authorization surface, never a collapsed receipt.
        result.push({
          kind: "outbound-batch",
          key: `outbound-batch-${msg.id}`,
          message: msg,
        });
        i += 1;
      } else if (
        msg.messageType === ("tool_call" as MessageType) &&
        isPlanModeUiToolName(msg.metadata?.toolName)
      ) {
        // Plan-mode UI tool calls (EnterPlanMode, AskUserQuestion,
        // SubmitPlanForApproval) have no execution receipt — their state
        // renders through the plan decision/receipt/question surfaces
        // (FR-052). A legacy receipt here would show a bogus completed row.
        i += 1;
        continue;
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

    // Plan metadata rows never render themselves; the single lifecycle
    // surface for the latest plan is placed after the walk below (FR-052).
    if (msg.metadata?.planEventType || msg.metadata?.planStateView) {
      sawPlanMessage = true;
      if (msg.metadata?.planStateView?.planId) {
        // The latest plan-state row anchors a resolved receipt in history.
        receiptAnchor = result.length;
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

  // ONE lifecycle surface for the latest plan (FR-052), placed AFTER the
  // walk: plan events routinely occur mid-turn (EnterPlanMode publishes a
  // plan_state row before the research executions, and per R07/FR-025 the
  // run continues after plan_submitted), so the first plan row's position
  // is a stale anchor that buries the card between executed groups.
  // - Unresolved decisions (approval/question) pin at the very bottom of
  //   the transcript, immediately above the composer (PRD §12.4, FR-058).
  // - Resolved transitions return to history at the transition position.
  const plan = sawPlanMessage ? selectPlanPresentation(messages) : null;
  if (plan) {
    if (isPinnedSurface(plan.surface)) {
      if (plan.surface === "approval") {
        result.push({
          kind: "plan-decision",
          key: `plan-decision-${plan.planId}-${plan.version}`,
          plan,
        });
      } else if (plan.pendingQuestion) {
        result.push({
          kind: "plan-question",
          key: `plan-question-${plan.pendingQuestion.questionId}`,
          question: plan.pendingQuestion,
        });
      }
    } else if (isReceiptSurface(plan.surface)) {
      result.splice(receiptAnchor === -1 ? result.length : receiptAnchor, 0, {
        kind: "plan-receipt",
        key: `plan-receipt-${plan.planId}-${plan.version}`,
        plan,
      });
    }
    // Drafting/executing/completed-without-receipt: skip — the run strip
    // and Activity own those states (FR-062: no duplicate surfaces).
  }

  return result;
});

/**
 * Map the transcript stream status onto the pending bubble's runtime-status
 * contract (running/idle only — awaiting_* states arrive via the store).
 */
const pendingRuntimeStatus = computed<"idle" | "running" | undefined>(() =>
  props.streamStatus === "streaming" ? "running" : "idle"
);

function streamStatusForMessage(
  message: ChatV2MessageView
): "idle" | "streaming" | "cancelled" | "error" | undefined {
  if (props.activeAssistantMessageId === message.id) {
    return props.streamStatus;
  }
  return undefined;
}

/**
 * A gated tool result parked on the permission card (design §15.5).
 * (isSkillInstallResult / isBatchToolCard live in the shared projection
 * module so the specialized-card flag on execution rows cannot drift.)
 */
function isPermissionPrompt(message: ChatV2MessageView): boolean {
  return (
    message.messageType === ("tool_result" as MessageType) &&
    message.metadata?.toolResult?.needsPermissionPrompt === true
  );
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
