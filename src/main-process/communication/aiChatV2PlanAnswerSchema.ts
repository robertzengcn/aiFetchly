import { z } from "zod/v4";

/**
 * Zod schema for a single user-supplied plan-question answer, validated at the
 * IPC boundary (project rule: every cross-process payload is validated with
 * Zod on the receiving side). Mirrors {@link AskUserQuestionAnswer} from
 * `src/entityTypes/aiChatPlanTypes.ts`.
 *
 * The length caps matter: `customText` / `answer` free text is persisted into
 * `answersJson` (SQLite TEXT) and serialized into the AI tool message, so an
 * unbounded paste would bloat storage and inflate token usage.
 */
export const AskUserQuestionAnswerSchema = z.object({
  question: z.string().min(1).max(2000),
  answer: z.union([
    z.string().max(2000),
    z.array(z.string().max(2000)).max(100),
  ]),
  customText: z.string().max(2000).optional(),
});

/** Full answers array sent to the `answer-question` IPC channel. */
export const AnswerPlanQuestionAnswersSchema = z
  .array(AskUserQuestionAnswerSchema)
  .max(20);

export type ValidatedAskUserQuestionAnswer = z.infer<
  typeof AskUserQuestionAnswerSchema
>;
