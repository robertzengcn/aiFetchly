import { z } from "zod/v4";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";

/**
 * Send-time validation for the selected-context transport (technical-design
 * §13.3). The renderer may send OPAQUE ARCHIVE REFERENCES ONLY — never passage
 * text. References are opaque base64url payloads, so this schema bounds their
 * shape/size and uniqueness; the backend re-resolves each one against the
 * current epoch and revision and rejects anything that cannot fit.
 */

export const HISTORY_SELECTION_SOURCE_ID_MAX_LENGTH = 1024;

export const aiChatHistorySelectionIdsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(HISTORY_SELECTION_SOURCE_ID_MAX_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/, "historySelectionIds entries must be opaque base64url ids")
  )
  .max(
    AI_CHAT_RECOVERABLE_DEFAULTS.selectionMaxCount,
    "too many history selections"
  )
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "historySelectionIds must not contain duplicates",
  });

export type AiChatHistorySelectionIds = z.infer<
  typeof aiChatHistorySelectionIdsSchema
>;

export const HISTORY_SUBMISSION_ID_MAX_LENGTH = 128;

export const aiChatHistorySubmissionIdSchema = z
  .string()
  .min(1)
  .max(HISTORY_SUBMISSION_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, "submissionId must be an opaque token");

export type AiChatHistorySubmissionId = z.infer<
  typeof aiChatHistorySubmissionIdSchema
>;
