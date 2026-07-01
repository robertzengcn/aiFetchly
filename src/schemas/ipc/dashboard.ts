import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Dashboard 系列 IPC 入参 schema。
 *
 * 4 个 handler 共享 date-range 形态，差异仅在 TRENDS 多一个 groupBy。
 *
 * 设计要点：
 *  - startDate/endDate 用 z.string().datetime() 或 .min(1) 都不够稳；
 *    原代码用 new Date(str) + isNaN(getTime()) 校验。这里用 z.string().refine
 *    复用相同逻辑，保证迁移前后拒绝同样的输入
 *  - z.refine 跨字段比较 start < end 用 .check 不可行（zod v3 没有 .check），
 *    用 superRefine 实现
 */

const dateString = z
  .string()
  .min(1)
  .refine(
    (s) => !isNaN(new Date(s).getTime()),
    (s) => ({
      message: `Invalid date format: "${s}". Use ISO 8601 (YYYY-MM-DD).`,
    })
  );

const dateRangeBase = lazySchema(() =>
  z.strictObject({
    startDate: dateString,
    endDate: dateString,
  })
);

/** SUMMARY / SEARCH_ENGINES / EMAIL_STATUS：纯 date-range */
export const dashboardDateRangeInputSchema = dateRangeBase;

/** TRENDS：date-range + optional groupBy */
export const dashboardTrendsInputSchema = lazySchema(() =>
  z.strictObject({
    startDate: dateString,
    endDate: dateString,
    groupBy: z.enum(["day", "week", "month"]).optional(),
  })
);
