import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * EmailMarketingSendLogEntity 写入边界 schema。
 *
 * 对齐 src/entity/EmailMarketingSendLog.entity.ts 的 @Column 列：
 *  - task_id / status: integer（必填）
 *  - receiver/title/content/log/record_time: text（必填字符串）
 *  - email_service_id: integer（可空；FR-014 身份元数据）
 *  - from_address/smtp_username/reply_to: text（可空；非机密身份值）
 */
export const emailMarketingSendLogWriteSchema = lazySchema(() =>
  z.object({
    task_id: z.number().int(),
    status: z.number().int(),
    receiver: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    log: z.string().nullable().optional(),
    record_time: z.string().nullable().optional(),
    email_service_id: z.number().int().nullable().optional(),
    from_address: z.string().max(320).nullable().optional(),
    smtp_username: z.string().max(255).nullable().optional(),
    reply_to: z.string().max(320).nullable().optional(),
  })
);
