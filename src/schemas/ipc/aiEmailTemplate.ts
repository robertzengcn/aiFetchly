import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * IPC 入参 schema: AI_EMAIL_TEMPLATE_VALIDATE
 *
 * 注意：VALIDATE 是本地变量校验（validateAIOutputVariables），不调 LLM，
 * 原代码也未做 USER_AI_ENABLED 检查。保持原行为，handler 用普通
 * registerValidatedHandler（非 AI 版）。
 *
 * GENERATE_STREAM handler 仍是 ipcMain.on 流式推送，不在本 schema 覆盖范围。
 */
export const aiEmailTemplateValidateInputSchema = lazySchema(() =>
  z.strictObject({
    title: z.string(),
    content: z.string(),
  }),
)

export type AiEmailTemplateValidateInput = z.infer<
  ReturnType<typeof aiEmailTemplateValidateInputSchema>
>
