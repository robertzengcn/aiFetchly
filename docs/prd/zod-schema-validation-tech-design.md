# 技术设计：AiFetchly 全栈 Zod Schema 校验基础设施

| 字段 | 内容 |
|------|------|
| 文档版本 | v1.0 |
| 创建日期 | 2026-06-28 |
| 关联 PRD | [zod-schema-validation.md](./zod-schema-validation.md) |
| 关联参考 | [Claude Code Zod 实践](../../../../github/claude-code/docs/zod-schema-usage.md) |

本文档是 PRD 的工程实现细则。所有代码示例与 aiFetchly 当前代码结构对齐，可直接作为落地参考。

---

## 目录
1. [总体策略](#1-总体策略)
2. [依赖与版本策略](#2-依赖与版本策略)
3. [基础设施层实现](#3-基础设施层实现)
4. [IPC 校验 Wrapper](#4-ipc-校验-wrapper)
5. [Worker 消息契约](#5-worker-消息契约)
6. [配置校验](#6-配置校验)
7. [AI 工具 Schema](#7-ai-工具-schema)
8. [错误格式化与 i18n](#8-错误格式化与-i18n)
9. [迁移模式（Before / After）](#9-迁移模式before--after)
10. [测试策略](#10-测试策略)
11. [性能考量](#11-性能考量)
12. [zod v3 → v4 迁移参考](#12-zod-v3--v4-迁移参考)
13. [文件级迁移清单](#13-文件级迁移清单)

---

## 1. 总体策略

### 1.1 校验放位置的唯一原则
**在边界处校验一次，业务层信任校验结果。** 不在 Module/Model 内重复 parse，避免双层成本与维护漂移。

```
┌─ 边界（parse） ─┐   ┌─ 业务（trust） ─┐   ┌─ 持久化（trust） ─┐
│ IPC handler    │ → │ Module         │ → │ Model            │
│ worker msg     │   │ Controller     │   │ TypeORM entity   │
│ config load    │   │                │   │                  │
│ API response   │   │                │   │                  │
└────────────────┘   └────────────────┘   └──────────────────┘
```

### 1.2 与既有架构规则的兼容
项目 CLAUDE.md 已确立的硬约束，本设计**不绕过**：
- IPC handler 不直连 DB → wrapper 只调 Module
- Worker 不访问 DB → worker schema 仅描述 IPC 消息，不描述 DB 行
- 三层 Model/Module/IPC → schema 与之一一映射，不引入第 4 层

---

## 2. 依赖与版本策略

### 2.1 当前状态
```json
"zod": "^3.24.0"
```
项目中 zod 仅出现在 5 个文件，破坏面可控。

### 2.2 升级路径（推荐：双版本并存）
```
zod@3.24.0  ←  保留，旧文件继续用
zod/v4      ←  新增代码统一从此入口导入
```

**package.json 不必立即升 major**。zod v4 通过 `zod/v4` 子路径可与 v3 并存（Claude Code 即如此）。新代码一律：

```typescript
import { z } from 'zod/v4'
```

### 2.3 TypeScript 版本检查
项目当前 `typescript@^5.1.3`。zod v4 要求 TS ≥ 4.5，满足。但 v4 部分类型推导依赖 TS 5.3+ 的 `satisfies` 增强，建议升级到 `typescript@^5.4`（与 Claude Code 对齐）。

### 2.4 配套依赖
| 包 | 用途 | 必需性 |
|----|------|-------|
| `zod` (内置 v4 子路径) | schema 定义 | 已装 |
| 无新增运行时依赖 | — | — |

**不需要**引入 `zod-to-json-schema` 第三方库 —— zod v4 原生 `toJSONSchema()` 已够用。

---

## 3. 基础设施层实现

### 3.1 `src/utils/lazySchema.ts`

```typescript
/**
 * 延迟构造 Schema，首次调用后缓存。
 *
 * 设计目的：
 * 1. 解决 schema 跨模块循环依赖（factory 在首次调用时才执行）
 * 2. 保证引用恒等 —— 同一 lazySchema 多次调用返回同一 ZodType 实例，
 *    使 WeakMap 缓存（zodToJsonSchema）生效
 */
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}
```

**用法**：
```typescript
const inputSchema = lazySchema(() =>
  z.strictObject({ resultIds: z.array(z.number().int().positive()) }),
)
type Input = ReturnType<typeof inputSchema> // 推导出 ZodType
```

### 3.2 `src/utils/zodToJsonSchema.ts`

```typescript
import { toJSONSchema } from 'zod/v4'
import type { ZodTypeAny } from 'zod/v4'
import type { JsonSchema7Type } from 'json-schema-typed' // 或本地定义最小类型

// WeakMap 依赖 lazySchema 提供的引用恒等
const cache = new WeakMap<ZodTypeAny, JsonSchema7Type>()

/**
 * 将 Zod schema 转 JSON Schema，供 LLM function calling 使用。
 * 缓存命中是关键优化：每次 AI 调用会转换 60-250 次。
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema7Type {
  const hit = cache.get(schema)
  if (hit) return hit
  const result = toJSONSchema(schema) as JsonSchema7Type
  cache.set(schema, result)
  return result
}
```

### 3.3 `src/utils/semanticNumber.ts`

解决 LLM 输出 `"123"` 字符串、但 schema 期望 number 的问题。**不用 `z.coerce.number()`**（会把 `""`→0、`null`→0 掩盖 bug）。

```typescript
import { z } from 'zod/v4'

/**
 * 仅当输入是纯数字字符串时转为 number，否则原样透传给内部 schema 报错。
 */
export function semanticNumber<T extends z.ZodType>(inner: T = z.number() as unknown as T) {
  return z.preprocess((v: unknown) => {
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return v
  }, inner)
}
```

### 3.4 `src/utils/semanticBoolean.ts`

`z.coerce.boolean()` 会把 `"false"` 当 truthy → true，是个常见坑。

```typescript
import { z } from 'zod/v4'

/**
 * 仅在输入恰好是 "true"/"false" 字符串时转换，否则原样透传。
 */
export function semanticBoolean<T extends z.ZodType>(inner: T = z.boolean() as unknown as T) {
  return z.preprocess(
    (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v),
    inner,
  )
}
```

### 3.5 文件清单
```
src/utils/
├── lazySchema.ts          (新增，~6 行)
├── zodToJsonSchema.ts     (新增，~18 行)
├── semanticNumber.ts      (新增，~12 行)
├── semanticBoolean.ts     (新增，~8 行)
└── zodErrors.ts           (见 §8)
```

---

## 4. IPC 校验 Wrapper

### 4.1 设计目标
- 自动 `safeParse` 入参，失败时返回统一 envelope
- 自动 try/catch handler 内异常
- 自动 `logForDebugging` 记录所有失败
- 与现有 `CommonMessage<T>` envelope 完全兼容（不破坏前端）

### 4.2 `src/main-process/communication/_shared/registerValidatedHandler.ts`

```typescript
import { ipcMain, IpcMainInvokeEvent, ipcMain as _ } from 'electron'
import { z } from 'zod/v4'
import { log } from '@/modules/Logger'
import { formatZodValidationError } from '@/utils/zodErrors'
import type { CommonMessage } from '@/entityTypes/commonType'

type AnyInputSchema = z.ZodType<{ [k: string]: unknown }>

/**
 * 注册带 schema 校验的 IPC handler。
 *
 * - 入参经 schema.safeParse；失败立即返回 status:false
 * - handler 内抛错被捕获并写入 envelope.msg
 * - 返回值结构严格遵守 CommonMessage<T>，前端零改动
 */
export function registerValidatedHandler<TOutput>(
  channel: string,
  schema: () => AnyInputSchema,
  handler: (input: z.infer<AnyInputSchema>, event: IpcMainInvokeEvent) => Promise<TOutput>,
): void

export function registerValidatedHandler<TInput, TOutput>(
  channel: string,
  schema: () => z.ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>,
): void

export function registerValidatedHandler<TInput, TOutput>(
  channel: string,
  schema: () => z.ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>,
): void {
  ipcMain.handle(channel, async (event, raw) => {
    const parseResult = schema().safeParse(raw)
    if (!parseResult.success) {
      const msg = formatZodValidationError(channel, parseResult.error)
      log(`[${channel}] validation failed: ${msg}`, 'warn')
      return {
        status: false,
        msg,
        data: null,
      } satisfies CommonMessage<null>
    }

    try {
      const data = await handler(parseResult.data, event)
      return { status: true, msg: 'ok', data } satisfies CommonMessage<TOutput>
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log(`[${channel}] handler error: ${msg}`, 'error')
      return { status: false, msg, data: null } satisfies CommonMessage<null>
    }
  })
}

/**
 * 变体：针对 AI 功能 handler，强制校验 USER_AI_ENABLED 在 schema 之前。
 */
export function registerAiValidatedHandler<TInput, TOutput>(
  channel: string,
  schema: () => z.ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput>,
): void {
  ipcMain.handle(channel, async (event, raw) => {
    // 1. AI 开关检查（CLAUDE.md 强制规则）
    const aiEnabled = Token.getInstance().getValue(USER_AI_ENABLED)
    if (aiEnabled !== 'true') {
      return {
        status: false,
        msg: 'AI feature is not enabled',
        data: null,
      }
    }

    // 2. schema 校验
    const parseResult = schema().safeParse(raw)
    if (!parseResult.success) {
      const msg = formatZodValidationError(channel, parseResult.error)
      log(`[${channel}] validation failed: ${msg}`, 'warn')
      return { status: false, msg, data: null }
    }

    // 3. 业务执行
    try {
      const data = await handler(parseResult.data, event)
      return { status: true, msg: 'ok', data }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      log(`[${channel}] AI handler error: ${msg}`, 'error')
      return { status: false, msg, data: null }
    }
  })
}
```

### 4.3 envelope 兼容性

现有前端约定（`CommonMessage<T>`）：
```typescript
interface CommonMessage<T> {
  status: boolean
  msg: string
  data: T
}
```
wrapper 输出 100% 符合此结构 → **前端零改动**。

---

## 5. Worker 消息契约

### 5.1 现状问题
当前 `contactExtraction-ipc.ts` 第 29-34 行：
```typescript
interface WorkerMessage {
  type: 'worker-ready' | 'extraction-progress' | 'worker-log' | 'extract-contact-url-result'
  level?: 'info' | 'error' | 'warn' | 'debug'
  args?: unknown[]
  [key: string]: unknown   // ← 完全开放的索引签名，类型守卫失效
}
```
→ 字段漂移无保护，依赖人工记忆。

### 5.2 重构：`src/schemas/worker/contactExtraction.ts`

```typescript
import { z } from 'zod/v4'
import { lazySchema } from '@/utils/lazySchema'

export const ContactExtractionWorkerOutboundSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('worker-ready'),
    }),
    z.object({
      type: z.literal('extraction-progress'),
      resultId: z.number().int().positive(),
      status: z.enum(['running', 'completed', 'failed']),
      progress: z.number().min(0).max(100).optional(),
      data: z.unknown().optional(),
    }),
    z.object({
      type: z.literal('worker-log'),
      level: z.enum(['info', 'warn', 'error', 'debug']),
      args: z.array(z.unknown()),
    }),
    z.object({
      type: z.literal('extract-contact-url-result'),
      requestId: z.string(),
      results: z.array(
        z.object({
          url: z.string(),
          success: z.boolean(),
          data: z.object({
            emails: z.array(z.string()).optional(),
            phones: z.array(z.string()).optional(),
            address: z.string().nullable().optional(),
            socialLinks: z.array(z.string()).nullable().optional(),
          }).optional(),
          error: z.string().optional(),
        }),
      ),
    }),
  ]),
)

export type ContactExtractionWorkerOutbound = z.infer<
  ReturnType<typeof ContactExtractionWorkerOutboundSchema>
>

// Main → Worker 指令
export const ContactExtractionWorkerInboundSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('extract-contact'), resultIds: z.array(z.number().int().positive()) }),
    z.object({ type: z.literal('extract-contact-urls'), requestId: z.string(), urls: z.array(z.string().url()) }),
    z.object({ type: z.literal('shutdown') }),
  ]),
)
```

### 5.3 Main 端消费

```typescript
// contactExtraction-ipc.ts 内
worker.on('message', (raw: unknown) => {
  const parsed = ContactExtractionWorkerOutboundSchema().safeParse(raw)
  if (!parsed.success) {
    log(`[contactExtraction-worker] dropped malformed message: ${parsed.error.message}`, 'warn')
    return // 丢弃非法消息
  }

  const msg = parsed.data
  switch (msg.type) {
    case 'worker-ready':     /* ... */
    case 'extraction-progress':
      // 这里 TS 已经窄化，data 字段类型确定
      handleWorkerProgress(msg.resultId, msg.status, msg.data)
      break
    case 'worker-log':       /* ... */
    case 'extract-contact-url-result': /* ... */
  }
})
```

### 5.4 Worker 端对称校验
```typescript
// ContactExtractionWorker.ts 内
process.on('message', (raw: unknown) => {
  const parsed = ContactExtractionWorkerInboundSchema().safeParse(raw)
  if (!parsed.success) {
    logToMain('warn', `Dropped invalid inbound: ${parsed.error.message}`)
    return
  }
  // dispatch(parsed.data)
})
```

### 5.5 其他 3 类 worker 同模式
| Worker | Schema 文件 |
|--------|------------|
| `yellowPagesScraper.ts` | `src/schemas/worker/yellowPages.ts` |
| `websiteContentScraper.ts` | `src/schemas/worker/websiteContent.ts` |
| `googleProxyCheck.ts` | `src/schemas/worker/googleProxy.ts` |

---

## 6. 配置校验

### 6.1 用户 settings

```typescript
// src/schemas/config/settings.ts
import { z } from 'zod/v4'
import { lazySchema } from '@/utils/lazySchema'

export const SUPPORTED_LANGUAGES = ['en', 'zh', 'es', 'fr', 'de', 'ja'] as const

export const UserSettingsSchema = lazySchema(() =>
  z.strictObject({
    language: z.enum(SUPPORTED_LANGUAGES).catch('en'),
    aiEnabled: z.enum(['true', 'false']).catch('false'),

    // 非关键设置 → 失败时降级
    theme: z.enum(['light', 'dark', 'system']).catch('system'),
    windowBounds: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }).catch({ x: 100, y: 100, width: 1280, height: 800 }),
  }).partial(),
)

export type UserSettings = z.infer<ReturnType<typeof UserSettingsSchema>>
```

**加载流程**：
```typescript
const raw = loadSettingsJson()  // 可能损坏
const parsed = UserSettingsSchema().safeParse(raw)
if (!parsed.success) {
  // 不阻塞启动，仅提示
  showSettingsErrorToast(formatZodError('settings', parsed.error, i18n.locale))
  // 用全默认值继续
  return UserSettingsSchema().parse({})
}
return parsed.data
```

### 6.2 技能 manifest
```typescript
export const SkillManifestSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    entry: z.string(),
    permissions: z.array(z.enum(['read', 'write', 'network', 'shell'])).default([]),

    // 可选 → 降级为 undefined
    description: z.string().catch(undefined).optional(),
    dependencies: z.array(z.string()).catch([]).default([]),
  }),
)
```

### 6.3 MCP server 配置
```typescript
export const McpServerConfigSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1),
    transport: z.discriminatedUnion('type', [
      z.object({ type: z.literal('stdio'), command: z.string(), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).default({}) }),
      z.object({ type: z.literal('sse'),    url: z.string().url() }),
      z.object({ type: z.literal('http'),   url: z.string().url() }),
    ]),
    enabled: z.boolean().default(true),
  }),
)
```

---

## 7. AI 工具 Schema

### 7.1 现状
`emailMarketingAiTypes.ts` 用 `z.coerce.number()`、`.superRefine()` —— v3 风格，需迁移。

### 7.2 统一模式

```typescript
// src/schemas/aiTools/bulkEmail.ts
import { z } from 'zod/v4'
import { lazySchema } from '@/utils/lazySchema'
import { semanticNumber } from '@/utils/semanticNumber'

const idSchema = semanticNumber(z.number().int().positive())

export const bulkEmailTaskInputSchema = lazySchema(() => {
  const base = z.strictObject({
    email_search_task_id: idSchema.optional(),
    emails: z.array(z.union([z.string().email(), z.object({ address: z.string().email(), title: z.string().optional() })])).min(1).optional(),
    template_ids: z.array(idSchema).optional(),
    email_subject: z.string().trim().min(1).max(500).optional(),
    email_html_content: z.string().trim().min(1).max(50000).optional(),
    filter_ids: z.array(idSchema).default([]),
    service_ids: z.array(idSchema).min(1),
    not_duplicate: z.boolean().default(true),
  })

  // v4 用 .check 替代 v3 的 .superRefine
  return base.check((ctx) => {
    const d = ctx.value
    const hasSearchTask = d.email_search_task_id !== undefined && d.email_search_task_id > 0
    const hasEmails = d.emails !== undefined && d.emails.length > 0

    if (hasSearchTask === hasEmails) {
      ctx.issues.push({
        code: 'custom',
        message: 'Provide exactly one of email_search_task_id or emails',
        path: ['email_search_task_id'],
        input: d.email_search_task_id,
      })
    }
  })
})
```

### 7.3 注入 LLM function calling

```typescript
// src/service/aiToolsRegistry.ts
import { zodToJsonSchema } from '@/utils/zodToJsonSchema'
import { bulkEmailTaskInputSchema } from '@/schemas/aiTools/bulkEmail'

export function getBulkEmailToolForLLM() {
  return {
    type: 'function' as const,
    function: {
      name: 'bulk_email_task',
      description: 'Send bulk emails',
      parameters: zodToJsonSchema(bulkEmailTaskInputSchema()),
    },
  }
}
```

### 7.4 多路分支输出（fileRead 等）

```typescript
const fileReadOutputSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'),     file: z.object({ path: z.string(), content: z.string() }) }),
    z.object({ type: z.literal('image'),    file: z.object({ path: z.string(), mediaType: z.string(), data: z.string() }) }),
    z.object({ type: z.literal('notebook'), file: z.object({ path: z.string(), cells: z.array(z.unknown()) }) }),
    z.object({ type: z.literal('pdf'),      file: z.object({ path: z.string(), pages: z.number() }) }),
  ]),
)
```

---

## 8. 错误格式化与 i18n

### 8.1 `src/utils/zodErrors.ts`

```typescript
import type { ZodError } from 'zod/v4'
import type { CommonMessage } from '@/entityTypes/commonType'

/**
 * 面向开发者/LLM 的错误信息（IPC handler 用）。
 * 输出英文，机器可读。
 */
export function formatZodValidationError(scope: string, error: ZodError): string {
  const missing = error.issues.filter(
    (i) => i.code === 'invalid_type' && i.message.includes('received undefined'),
  )
  const unexpected = error.issues.filter((i) => i.code === 'unrecognized_keys')
  const mismatch = error.issues.filter(
    (i) => i.code === 'invalid_type' && !i.message.includes('received undefined'),
  )

  const parts: string[] = []
  if (missing.length)    parts.push(`Missing required params: ${missing.map(m => pathStr(m.path)).join(', ')}`)
  if (unexpected.length) parts.push(`Unexpected params: ${unexpected.flatMap(u => (u as { keys: string[] }).keys).join(', ')}`)
  if (mismatch.length)   parts.push(`Type mismatch: ${mismatch.map(m => `${pathStr(m.path)} (${m.message})`).join('; ')}`)

  return `[${scope}] ${parts.join(' | ') || error.message}`
}

function pathStr(p: (string | number)[]): string {
  return p.length ? p.join('.') : '<root>'
}

/**
 * 面向用户的错误信息（配置加载用）。
 * 支持多语言。
 */
export function formatZodError(scope: string, error: ZodError, locale: string = 'en'): string {
  // 实现查表 + i18n 模板
  // 返回 "Settings field 'language' must be one of: en, zh, es, fr, de, ja"
  // ... 见 §8.2
}
```

### 8.2 i18n 错误码表

```typescript
// src/utils/zodErrorMessages.ts
const ERROR_CODE_MESSAGES = {
  invalid_type: {
    en: 'Field "{field}" expected {expected}, got {received}',
    zh: '字段 "{field}" 期望 {expected}，实际 {received}',
    es: 'El campo "{field}" esperaba {expected}, recibió {received}',
    fr: 'Le champ "{field}" attendait {expected}, a reçu {received}',
    de: 'Feld "{field}" erwartet {expected}, erhalten {received}',
    ja: 'フィールド "{field}" は {expected} を期待しましたが {received} でした',
  },
  unrecognized_keys: { /* ... 同上 6 语言 */ },
  invalid_enum_value: { /* ... */ },
  too_small: { /* ... */ },
  too_big: { /* ... */ },
} as const
```

---

## 9. 迁移模式（Before / After）

### 9.1 IPC handler：`language-ipc.ts`

**Before**（现状，~100 行，手写 JSON.parse + typeof）：
```typescript
ipcMain.handle(LANGUAGE_PREFERENCE_UPDATE, async (event, jsonData: unknown) => {
  try {
    let parsedData: { language: string }
    try {
      parsedData = JSON.parse(jsonData as string)
    } catch {
      return { status: false, msg: 'Invalid JSON data received', data: false }
    }
    const { language } = parsedData
    if (!language || typeof language !== 'string') {
      return { status: false, msg: 'Invalid language parameter', data: false }
    }
    const ctrl = new SystemSettingController()
    await ctrl.ensureConnection()
    const success = await ctrl.updateLanguagePreference(language)
    return { status: success, msg: success ? 'OK' : 'Failed', data: success }
  } catch (error) {
    return { status: false, msg: (error as Error).message, data: false }
  }
})
```

**After**（~15 行业务）：
```typescript
// src/schemas/ipc/language.ts
export const updateLanguageInputSchema = lazySchema(() =>
  z.strictObject({
    language: z.enum(['en', 'zh', 'es', 'fr', 'de', 'ja']),
  }),
)

// language-ipc.ts
registerValidatedHandler(
  LANGUAGE_PERENCE_UPDATE,
  updateLanguageInputSchema,
  async (input) => {
    const ctrl = new SystemSettingController()
    await ctrl.ensureConnection()
    const success = await ctrl.updateLanguagePreference(input.language)
    if (!success) throw new Error('Failed to update language preference')
    return success
  },
)
```

**收益**：
- 行数减 80%
- 业务逻辑外露，错误处理集中
- enum 校验取代 `typeof string`，自动拒绝 `'xx'` 非法语言码

### 9.2 Worker 消息：`contactExtraction-ipc.ts`

**Before**：
```typescript
worker.on('message', (msg: WorkerMessage) => {
  // msg.type 走 switch，但 msg.data 是 unknown，每处再断言
  if (msg.type === 'extraction-progress') {
    handleWorkerProgress((msg as any).resultId, (msg as any).status, (msg as any).data)
  }
})
```

**After**：见 §5.3 —— TS 在 switch 分支内自动窄化，**无 `as any`**。

### 9.3 AI 工具：`emailMarketingAiTypes.ts`

**Before**（zod v3）：
```typescript
const idSchema = z.coerce.number().int().positive()
// ...
export const bulkEmailTaskInputSchema = bulkEmailBaseSchema.superRefine((data, ctx) => {
  ctx.addIssue({ code: z.ZodIssueCode.custom, ... })
})
```

**After**（zod v4）：见 §7.2 —— `semanticNumber` 替 `coerce.number`，`.check` 替 `.superRefine`。

---

## 10. 测试策略

### 10.1 测试分层

| 层 | 工具 | 位置 |
|---|---|---|
| utils 单测 | vitest | `test/vitest/utilitycode/zod*.test.ts` |
| IPC wrapper 单测 | vitest | `test/vitest/main/registerValidatedHandler.test.ts` |
| Schema 契约测试 | vitest | `test/vitest/utilitycode/schemas/*.test.ts` |
| Worker 集成 | vitest | `test/vitest/main/worker-messages.test.ts` |

### 10.2 示例：`lazySchema.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { lazySchema } from '@/utils/lazySchema'
import { z } from 'zod/v4'

describe('lazySchema', () => {
  it('caches the factory result (reference identity)', () => {
    let calls = 0
    const s = lazySchema(() => { calls++; return z.string() })
    const a = s()
    const b = s()
    expect(a).toBe(b)         // 同一引用
    expect(calls).toBe(1)     // factory 只执行一次
  })

  it('defers factory execution until first call', () => {
    let executed = false
    const s = lazySchema(() => { executed = true; return z.string() })
    expect(executed).toBe(false)
    s()
    expect(executed).toBe(true)
  })
})
```

### 10.3 示例：`zodToJsonSchema` 缓存测试

```typescript
it('returns cached result for same schema reference', () => {
  const s = lazySchema(() => z.strictObject({ a: z.string() }))
  const j1 = zodToJsonSchema(s())
  const j2 = zodToJsonSchema(s())
  expect(j1).toBe(j2)  // WeakMap 命中，引用相同
})
```

### 10.4 示例：semanticNumber 边界

```typescript
it.each([
  ['123', 123],
  ['-5', -5],
  ['1.5', 1.5],
])('converts numeric string %s to number', (input, expected) => {
  expect(semanticNumber().parse(input)).toBe(expected)
})

it.each([
  ['', undefined],        // 空字符串不转换，留给内部 schema 报错
  ['abc', 'abc'],         // 非数字原样透传
  [null, null],           // null 原样透传（不像 z.coerce 转 0）
])('does NOT convert %s', (input, expected) => {
  expect(semanticNumber(z.any()).parse(input)).toBe(expected)
})
```

### 10.5 示例：IPC wrapper

```typescript
describe('registerValidatedHandler', () => {
  it('returns status:false with formatted message on invalid input', async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }))
    let called = false
    registerValidatedHandler('test:ch', schema, async () => { called = true; return 'ok' })

    const result = await simulateIpcInvoke('test:ch', { x: 'not-a-number' })
    expect(result.status).toBe(false)
    expect(result.msg).toMatch(/Type mismatch/)
    expect(called).toBe(false)
  })

  it('catches handler exceptions and wraps them in envelope', async () => {
    const schema = lazySchema(() => z.strictObject({ x: z.number() }))
    registerValidatedHandler('test:ch2', schema, async () => { throw new Error('boom') })

    const result = await simulateIpcInvoke('test:ch2', { x: 1 })
    expect(result.status).toBe(false)
    expect(result.msg).toBe('boom')
  })
})
```

### 10.6 覆盖率门槛
所有新增 utils 文件覆盖率 **≥ 80%**（对齐项目 testing.md 规则）。

---

## 11. 性能考量

### 11.1 parse 开销
zod v4 `safeParse` 在小对象（<20 字段）上约 **5-20 μs**。IPC 调用本身有 Electron 序列化开销（毫秒级），parse 开销可忽略。

### 11.2 zodToJsonSchema 缓存
未缓存时每次 AI 调用 60-250 次转换，每次 100-500 μs → 总耗时 30-125 ms。缓存后稳定为 **1 次** 转换 + N 次 WeakMap 查询（~纳秒）。

### 11.3 不要在热路径加 schema
- Puppeteer 抓取过程中的 DOM 解析：**不加**
- 每条抓取结果落库前：**可选加**（用 `.passthrough()` 或 stripped schema，避免 O(N) 字段过滤影响批量写入）

### 11.4 WeakMap 而非 Map
`WeakMap` 键弱引用，schema 被 GC 时缓存条目自动清理。**前提是 schema 引用恒等**（由 lazySchema 保证）。若直接 `z.object({...})` 内联，每次新建引用 → 缓存失效 → 内存泄漏风险（Map 累积）。这就是 `lazySchema` 的关键意义。

---

## 12. zod v3 → v4 迁移参考

| v3 写法 | v4 写法 | 备注 |
|---------|---------|------|
| `z.ZodIssueCode.custom` | 字面量 `'custom'` | v4 issue code 用字符串字面量 |
| `.superRefine((val, ctx) => ctx.addIssue(...))` | `.check((ctx) => { ctx.issues.push(...) })` | API 重命名 |
| `.refine` | `.refine`（保留） | 不变 |
| `z.object({}).nonstrict()` | `z.object({})` | v4 object 默认非严格 |
| `z.object({}).strict()` | `z.strictObject({})` | v4 用专门函数 |
| `z.record(valueSchema)` | `z.record(keySchema, valueSchema)` | v4 强制双参数 |
| `error.issues` 中的 `message` | 不变 | issue 结构对齐 |
| `error.format()` | 不变 | API 兼容 |
| `z.coerce.number()` | `semanticNumber(z.number())` | 自定义包装（非 zod 原生） |
| `z.discriminatedUnion('type', [...])` | 同 v4 | API 兼容 |
| `z.partialRecord(keyEnum, valueSchema)` | 同 v4 | v4 原生支持 |

### 12.1 自动迁移脚本（可选）
```bash
npx zod-upgrade  # 官方 codemod，处理大多数破坏性变更
```
运行后人工 review `.superRefine` → `.check` 的转换。

---

## 13. 文件级迁移清单

### 13.1 新增文件
```
src/utils/lazySchema.ts
src/utils/zodToJsonSchema.ts
src/utils/semanticNumber.ts
src/utils/semanticBoolean.ts
src/utils/zodErrors.ts
src/utils/zodErrorMessages.ts

src/main-process/communication/_shared/registerValidatedHandler.ts

src/schemas/ipc/language.ts
src/schemas/ipc/contactExtraction.ts
src/schemas/ipc/aiChat.ts
src/schemas/ipc/emailMarketing.ts
# ... 每个 IPC handler 一个

src/schemas/worker/contactExtraction.ts
src/schemas/worker/yellowPages.ts
src/schemas/worker/websiteContent.ts
src/schemas/worker/googleProxy.ts

src/schemas/config/settings.ts
src/schemas/config/skillManifest.ts
src/schemas/config/mcpServer.ts

src/schemas/aiTools/bulkEmail.ts
src/schemas/aiTools/schedule.ts
src/schemas/aiTools/shell.ts
# ...
```

### 13.2 改造文件（按优先级）

**P0 — IPC handler（30 个）**：每个 handler 文件按 §9.1 模式改造。
```
src/main-process/communication/language-ipc.ts          ← 试点 1
src/main-process/communication/contactExtraction-ipc.ts ← 试点 2
src/main-process/communication/ai-chat-ipc.ts           ← 试点 3
# 其余 handler 分批迁移，每个一个原子 commit
```

**P0 — Worker 消息**：
```
src/main-process/communication/contactExtraction-ipc.ts (worker.on('message'))
src/childprocess/contact-extraction/ContactExtractionWorker.ts (process.on('message'))
src/childprocess/yellowPagesScraper.ts
src/childprocess/websiteContentScraper.ts
src/childprocess/googleProxyCheck.ts
```

**P1 — AI 工具 schema v3→v4 迁移**：
```
src/service/ScheduleAiTools.ts
src/service/EmailMarketingAiTools.ts
src/entityTypes/emailMarketingAiTypes.ts
src/entityTypes/scheduleAiToolTypes.ts
src/entityTypes/shellTypes.ts
```

**P1 — 配置加载**：
```
src/config/usersetting.ts           ← UserSettingsSchema
src/config/skillsRegistry.ts        ← SkillManifestSchema
（MCP 配置加载点）
```

### 13.3 Commit 粒度建议

按 CLAUDE.md「按功能单元自动提交」规则：
1. `feat: add lazySchema utility` （+ 测试）
2. `feat: add zodToJsonSchema with WeakMap cache`（+ 测试）
3. `feat: add semanticNumber/semanticBoolean preprocessors`（+ 测试）
4. `feat: add zod error formatters`
5. `feat: add registerValidatedHandler IPC wrapper`
6. `refactor: migrate language-ipc to validated handler`
7. `refactor: migrate contactExtraction worker messages to discriminated union`
8. ... 每个 IPC 一个 commit
9. `refactor: upgrade zod v3 ai tool schemas to v4`
10. `feat: add UserSettingsSchema with graceful degradation`

每个 commit 应当：
- 单独可编译（`yarn tsc` 通过）
- 单独可测（相关单测绿）
- 不破坏现有 envelope 兼容

---

## 附录 A：决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| zod 版本 | 双版本并存（v3 + v4 子路径） | 破坏面最小 |
| 缓存策略 | WeakMap + lazySchema | 引用恒等自动 GC |
| IPC wrapper 形式 | 高阶函数 `registerValidatedHandler` | 不依赖装饰器，TS 5.1 兼容 |
| 错误信息语言 | 开发层英文 + 用户层 i18n | 区分受众 |
| 配置失败策略 | `.catch()` 降级 + toast 提示 | 不阻塞启动 |
| 是否引入 `json-schema-typed` | 可选 | 也可本地最小定义 |

## 附录 B：与 Claude Code 的差异

| 维度 | Claude Code | AiFetchly（本设计） |
|------|-------------|---------------------|
| 工具数量 | ~40 LLM 工具 | 当前 5 个 AI 工具，逐步增长 |
| IPC 模型 | 内部 SDK 协议 | Electron `ipcMain.handle` |
| 配置来源 | 文件 + MDM 托管 | 本地 settings.json |
| 多语言 | 单语 | 6 语言（en/zh/es/fr/de/ja） |
| LLM 协议 | Anthropic 原生 | OpenAI 兼容 + Anthropic（双轨） |
| schema 缓存 | WeakMap | WeakMap（同模式） |
