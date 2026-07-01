import { ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { ZodType } from "zod";
import { log } from "@/modules/Logger";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { formatZodValidationError } from "@/utils/zodErrors";
import type { CommonMessage } from "@/entityTypes/commonType";

/**
 * 注册带 schema 校验的 IPC handler。
 *
 * - 入参经 schema.safeParse；失败立即返回 status:false，handler 不执行
 * - handler 内抛错被捕获并写入 envelope.msg
 * - 输出严格符合 CommonMessage<T>，与前端既有契约零改动兼容
 *
 * schema 必须由 lazySchema 包裹，以利用 zodToJsonSchema 的 WeakMap 缓存。
 */
export function registerValidatedHandler<TInput, TOutput>(
  channel: string,
  schema: () => ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>
): void {
  ipcMain.handle(channel, async (event, raw) => {
    const parsed = schema().safeParse(raw);
    if (!parsed.success) {
      const msg = formatZodValidationError(channel, parsed.error);
      log.warn(`[${channel}] validation failed: ${msg}`);
      return { status: false, msg, data: null } satisfies CommonMessage<null>;
    }

    try {
      const data = await handler(parsed.data, event);
      return { status: true, msg: "ok", data } satisfies CommonMessage<TOutput>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.error(`[${channel}] handler error: ${msg}`);
      return { status: false, msg, data: null } satisfies CommonMessage<null>;
    }
  });
}

/**
 * AI 功能专用 wrapper。
 *
 * 强制顺序（对齐 CLAUDE.md 规则）：
 *   1. 先查 USER_AI_ENABLED —— 关闭时直接返回，避免无谓的 parse / API 调用
 *   2. 再 schema.safeParse 入参
 *   3. 最后执行业务
 *
 * Worker/child process 不得使用此函数（无 Electron Token 上下文）。
 */
export function registerAiValidatedHandler<TInput, TOutput>(
  channel: string,
  schema: () => ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>
): void {
  ipcMain.handle(channel, async (event, raw) => {
    // 1. AI 开关检查 — FAIL-CLOSED: if Token service is unreachable
    //    (DB not initialized, encrypted store corrupted), block the request
    //    rather than letting it through. A broken feature gate should never
    //    silently enable paid features.
    try {
      const aiEnabled = new Token().getValue(USER_AI_ENABLED);
      if (aiEnabled !== "true") {
        return {
          status: false,
          msg: "AI feature is not enabled",
          data: null,
        } satisfies CommonMessage<null>;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Token service error";
      log.error(`[${channel}] AI-enabled check failed (fail-closed): ${msg}`);
      return {
        status: false,
        msg: "Unable to verify AI feature status. Please try again.",
        data: null,
      } satisfies CommonMessage<null>;
    }

    // 2. schema 校验
    const parsed = schema().safeParse(raw);
    if (!parsed.success) {
      const msg = formatZodValidationError(channel, parsed.error);
      log.warn(`[${channel}] validation failed: ${msg}`);
      return { status: false, msg, data: null } satisfies CommonMessage<null>;
    }

    // 3. 业务执行
    try {
      const data = await handler(parsed.data, event);
      return { status: true, msg: "ok", data } satisfies CommonMessage<TOutput>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.error(`[${channel}] AI handler error: ${msg}`);
      return { status: false, msg, data: null } satisfies CommonMessage<null>;
    }
  });
}
