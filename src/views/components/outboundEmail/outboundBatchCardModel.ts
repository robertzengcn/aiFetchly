import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";

/**
 * Card model for the outbound-email batch summary (§18). When the
 * draft_outbound_email_batch tool succeeds, its returned batch_id surfaces a
 * review card inline in the chat result so the user can review/approve/send
 * or see the direct-send outcome. Shared by the legacy message renderer
 * (AiChatV2Message) and the chat-first workspace transcript so both surfaces
 * derive identical cards from the same tool-result metadata.
 */
export interface OutboundBatchCardModel {
  readonly batchId: number;
  readonly mode: string;
  readonly recipientCount: number;
  readonly batchStatus: string;
  readonly reasonCode: string;
  readonly sentCount: number;
}

/** True when the message is a draft_outbound_email_batch result with a batch. */
export function isOutboundBatchResultMessage(
  message: ChatV2MessageView
): boolean {
  return (
    message.messageType === MessageType.TOOL_RESULT &&
    String(message.metadata?.toolName || "") === "draft_outbound_email_batch" &&
    typeof message.metadata?.toolResult?.batchId === "number"
  );
}

/** Derive the card model from the tool-result message metadata (§18). */
export function deriveOutboundBatchCardModel(
  message: ChatV2MessageView
): OutboundBatchCardModel | null {
  if (
    String(message.metadata?.toolName || "") !== "draft_outbound_email_batch"
  ) {
    return null;
  }
  const toolResult = message.metadata?.toolResult ?? {};
  const batchId = toolResult.batchId;
  if (typeof batchId !== "number") return null;
  return {
    batchId,
    mode:
      typeof toolResult.mode === "string"
        ? (toolResult.mode as string)
        : "review_first",
    recipientCount:
      typeof toolResult.draftCount === "number"
        ? (toolResult.draftCount as number)
        : 0,
    batchStatus:
      typeof toolResult.batchStatus === "string"
        ? (toolResult.batchStatus as string)
        : "draft_ready",
    reasonCode:
      typeof toolResult.reasonCode === "string"
        ? (toolResult.reasonCode as string)
        : "explicit_review_instruction",
    sentCount:
      typeof toolResult.sentCount === "number"
        ? (toolResult.sentCount as number)
        : 0,
  };
}
