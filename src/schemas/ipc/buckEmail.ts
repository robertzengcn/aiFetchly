import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import {
  itemSearchParamSchema,
  sortBySchema,
} from "@/schemas/ipc/_shared/pagination";

/**
 * IPC 入参 schema: BUCKEMAILTASKLIST
 * 复用 itemSearchParamSchema（page/size 可选，handler 内 fallback 默认值）。
 */
export const buckEmailTaskListInputSchema = itemSearchParamSchema;

/**
 * IPC 入参 schema: BUCKEMAILTASKSENDLOG
 *
 * 原 BuckEmailTasklogQueryType extends ItemSearchparam，加上必填的 TaskId。
 * 原 handler 用 Object.prototype.hasOwnProperty 检查 TaskId 缺失即返回 false；
 * 这里改成 strictObject + TaskId 必填，schema 自动拒绝缺失。
 */
export const buckEmailTaskSendLogInputSchema = lazySchema(() =>
  z.strictObject({
    TaskId: z.number().int().positive(),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    where: z.string().optional(),
    search: z.string().optional(),
    sortby: sortBySchema().optional(),
  })
);

export type BuckEmailTaskSendLogInput = z.infer<
  ReturnType<typeof buckEmailTaskSendLogInputSchema>
>;

/**
 * IPC 入参 schema: UNIFIED_EMAIL_SEND_LOG
 *
 * Unified send-log view — aggregates legacy bulk-task sends with authorized
 * outbound sends. Same shape as buckEmailTaskSendLogInputSchema minus the
 * required TaskId (this view spans all tasks + all authorized batches).
 */
export const unifiedEmailSendLogInputSchema = lazySchema(() =>
  z.strictObject({
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    where: z.string().optional(),
    search: z.string().optional(),
    sortby: sortBySchema().optional(),
  })
);

export type UnifiedEmailSendLogInput = z.infer<
  ReturnType<typeof unifiedEmailSendLogInputSchema>
>;

/**
 * IPC input schema: UNIFIED_EMAIL_SEND_LOG_DETAIL
 *
 * Detail lookup for one unified send-log row. The row's stable identity is
 * the (source, id) pair — id alone is not globally unique across the two
 * halves (legacy emailmarketing_send_log vs authorized delivery outcomes).
 */
export const unifiedEmailSendLogDetailInputSchema = lazySchema(() =>
  z.strictObject({
    source: z.enum(["legacy", "authorized"]),
    id: z.number().int().positive(),
  })
);

export type UnifiedEmailSendLogDetailInput = z.infer<
  ReturnType<typeof unifiedEmailSendLogDetailInputSchema>
>;
