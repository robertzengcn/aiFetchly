# PRD：AiFetchly 全栈类型校验基础设施（Zod Schema）

| 字段 | 内容 |
|------|------|
| 文档版本 | v1.0 |
| 创建日期 | 2026-06-27 |
| 负责人 | TBD |
| 状态 | Draft |
| 关联参考 | [Claude Code Zod Schema 实践](../../../../github/claude-code/docs/zod-schema-usage.md) |

---

## 1. 背景与现状

### 1.1 项目现状
AiFetchly 是一个 Electron + Vue 3 + TypeScript 应用，存在大量跨边界的数据流动：

- **IPC 边界**（30+ IPC handler 文件）：renderer ↔ main process
- **跨进程边界**：main process ↔ worker/child process（contact-extraction、yellowPages、websiteContentScraper、googleProxyCheck）
- **配置边界**：用户设置、技能配置、MCP server 配置、keybindings
- **外部数据边界**：远端后端 API 响应、Puppeteer 抓取结果、AI server SSE 流
- **持久化边界**：SQLite（TypeORM entity）读写

### 1.2 当前痛点
当前项目对以上边界的校验极其薄弱：

1. **IPC handler 不校验入参**：renderer 传来的 `data` 多以 `unknown`/`any` 接收后直接解构使用，类型错误只能在运行时炸出 `Cannot read properties of undefined`。
2. **Worker 消息无契约**：worker ↔ main 的 IPC 消息靠口头约定，字段缺失/类型漂移长期存在（CLAUDE.md 已记录 worker 误访问数据库引发的崩溃）。
3. **配置加载无防御**：用户 settings.json、技能 manifest、插件配置解析失败时缺友好错误，依赖 `.catch(() => undefined)` 默默吞错。
4. **AI 工具参数校验不完整**：仅 5 个文件用了 zod（`ScheduleAiTools`、`EmailMarketingAiTools`、`shellTypes`、`emailMarketingAiTypes`、`scheduleAiToolTypes`），且未与 JSON Schema 转换打通，LLM 收到的 schema 质量参差。
5. **`any` 泛滥**：catch 块、API 返回值、entityTypes 中大量 `any`，违背项目 CLAUDE.md「禁止 any」规则。
6. **TypeORM entity 与外部数据耦合**：API 响应直接进 entity，字段不一致时静默写入脏数据。

### 1.3 对标对象
Claude Code 内部用 **Zod v4** 覆盖 100+ 文件，作为统一的类型校验基础设施。其核心模式（`lazySchema`、`zodToJsonSchema`、`semanticNumber`/`semanticBoolean`、`.safeParse` + `formatZodError`、`.catch()` 优雅降级）值得借鉴。详见参考文档。

---

## 2. 目标与非目标

### 2.1 目标（Goals）
1. **统一校验语言**：所有外部边界统一使用 Zod schema 作为单一事实源（Single Source of Truth），TS 类型由 `z.infer<>` 派生。
2. **Fail-Fast**：IPC 入参、worker 消息、配置文件、外部 API 响应在边界处即校验，错误信息面向用户/LLM 可读。
3. **打通 LLM 工具契约**：所有 AI 工具的 input/output schema 可经 `zodToJsonSchema` 转换喂给 Anthropic/OpenAI function calling。
4. **降级可用**：非关键路径（如设置解析）使用 `.catch()` 优雅降级，保证应用启动可用。
5. **消除 `any`**：在 IPC handler、entityTypes、service 层用 `unknown` + schema parse 替代。

### 2.2 非目标（Non-Goals）
1. **不重写 TypeORM**：entity 内部结构保留 TypeORM 装饰器；仅在 entity 与外部数据交换处加 schema 守卫。
2. **不替换 Vue props 校验**：组件 props 已有 Vue 原生校验，本次不引入 zod 到 template 层。
3. **不一次性铺开**：分阶段迁移，避免大爆炸式重构。优先 IPC + AI 工具 + 配置。
4. **不引入运行时校验到热路径**：如 Puppeteer 抓取的内层 DOM 解析不走 zod（性能敏感），仅在最终结果落库前校验。

---

## 3. 需求

### 3.1 功能需求

#### FR-1 基础设施层
| ID | 需求 | 优先级 |
|----|------|--------|
| FR-1.1 | 引入 `lazySchema` 工具函数（延迟构造 + 引用恒等），路径 `src/utils/lazySchema.ts` | P0 |
| FR-1.2 | 实现 `zodToJsonSchema` 转换 + `WeakMap` 缓存，供 LLM function calling 使用 | P0 |
| FR-1.3 | 实现 `semanticNumber` / `semanticBoolean` 预处理包装器（兼容 AI 输出的字符串数字、"true"/"false"） | P1 |
| FR-1.4 | 实现 `formatZodValidationError(handlerName, error)` —— 生成面向开发者的 IPC 错误信息（缺失/多余/类型不符三类） | P0 |
| FR-1.5 | 实现 `formatZodError(scope, error)` —— 生成面向用户的配置加载错误信息（中文/多语言） | P1 |
| FR-1.6 | 升级 `zod` 至 v4（`zod/v4`），与 Claude Code 对齐 | P1 |

#### FR-2 IPC 边界校验
| ID | 需求 | 优先级 |
|----|------|--------|
| FR-2.1 | 每个 IPC handler 必须定义 `lazySchema(() => z.strictObject({...}))` 作为入参契约 | P0 |
| FR-2.2 | 提供 `registerValidatedHandler(channel, schema, handler)` 包装函数，自动 `safeParse` 入参；失败直接返回 `{ status: false, msg: formatZodValidationError(...) }` | P0 |
| FR-2.3 | AI 功能 handler 必须先校验 `USER_AI_ENABLED`（已有规则），再 schema 校验，再执行业务 | P0 |
| FR-2.4 | handler 返回值统一 envelope：`{ status: boolean, msg?: string, data?: T }`，并对 T 定义 output schema | P1 |

#### FR-3 跨进程（Worker）消息契约
| ID | 需求 | 优先级 |
|----|------|--------|
| FR-3.1 | 为每种 worker 消息定义 discriminated union schema（`type` 字段区分） | P0 |
| FR-3.2 | main process 接收 worker 消息前 `safeParse`，非法消息丢弃 + 日志告警 | P0 |
| FR-3.3 | worker 接收 main 的指令同样校验，避免指令字段漂移 | P1 |
| FR-3.4 | worker 仍不得直连数据库（既有架构规则），schema 不绕过此约束 | P0（既有） |

#### FR-4 配置校验
| ID | 需求 | 优先级 |
|----|------|--------|
| FR-4.1 | 用户 settings.json 使用 `SettingsSchema().strict().safeParse`，失败调用 `formatZodError` | P1 |
| FR-4.2 | 技能 manifest、MCP server 配置、插件配置使用 zod schema，非关键字段用 `.catch()` 降级 | P1 |
| FR-4.3 | 远端后端 API 响应定义 ResponseSchema，校验通过才进入 model 层 | P1 |

#### FR-5 AI 工具契约
| ID | 需求 | 优先级 |
|----|------|--------|
| FR-5.1 | 所有 AI tool（`ScheduleAiTools`、`EmailMarketingAiTools`、shell、file tools 等）统一定义 input/output schema | P0 |
| FR-5.2 | schema 经 `zodToJsonSchema` 转换后注入 function calling 的 parameters 字段 | P0 |
| FR-5.3 | 工具调用返回前对 output 做 `safeParse`，失败时返回结构化错误，不抛裸异常给 LLM | P1 |
| FR-5.4 | 多路分支工具用 `z.discriminatedUnion`（如 fileRead 的 text/image/notebook/pdf） | P2 |

#### FR-6 持久化守卫
| ID | 需求 | 优先级 |
|----|------|--------|
| FR-6.1 | 外部数据写入 entity 前（如抓取结果、API 同步），用 schema 过滤未知字段 + 校验类型 | P2 |
| FR-6.2 | Model 层提供 `parseAndStrip(payload, schema)` helper：拒绝非法 + 删除未声明字段 | P2 |

### 3.2 非功能需求

| ID | 需求 |
|----|------|
| NFR-1 | **性能**：`zodToJsonSchema` 必须带缓存（依赖 `lazySchema` 引用恒等），避免每次 API 调用重复转换 |
| NFR-2 | **兼容性**：保留对现有 IPC channel 名与返回 envelope 的兼容，不破坏前端调用 |
| NFR-3 | **可观测性**：所有 parse 失败必须 `logForDebugging` 记录 scope + 原始值 + zod issues |
| NFR-4 | **i18n**：`formatZodError` 输出需支持项目 6 种语言（en/zh/es/fr/de/ja） |
| NFR-5 | **测试覆盖**：新增 utils（lazySchema/zodToJsonSchema/semanticNumber/校验 wrapper）单测覆盖率 ≥ 80% |
| NFR-6 | **无 `any`**：新增代码不得引入 `any`（对齐项目规则） |

---

## 4. 架构设计

### 4.1 总体分层

```
┌──────────────────────────────────────────────┐
│  Renderer (Vue 3)                            │
│  └─ api/*.ts 调用 invoke(channel, payload)   │
└────────────────┬─────────────────────────────┘
                 │  IPC payload（schema 校验）
                 ▼
┌──────────────────────────────────────────────┐
│  Main Process                                │
│  ┌────────────────────────────────────────┐  │
│  │ registerValidatedHandler(              │  │
│  │   channel, InputSchema, handler)       │  │
│  └──────────────┬─────────────────────────┘  │
│                 ▼                             │
│  ┌────────────────────────────────────────┐  │
│  │ Module 层（业务逻辑，已有）            │  │
│  └──────────────┬─────────────────────────┘  │
│                 ▼                             │
│  ┌────────────────────────────────────────┐  │
│  │ Model 层（DB 访问，已有）              │  │
│  └────────────────────────────────────────┘  │
└────────────┬───────────────┬──────────────────┘
             │               │ worker message（schema 校验）
             ▼               ▼
        SQLite         ┌──────────────────┐
                        │ Worker Process   │
                        │ (无 DB 访问)     │
                        └──────────────────┘
```

### 4.2 核心模式（借鉴 Claude Code）

#### 4.2.1 `lazySchema`
```typescript
// src/utils/lazySchema.ts
export function lazySchema<T>(factory: () => T): () => T {
  let cached: T | undefined
  return () => (cached ??= factory())
}
```
- 解决 schema 跨模块循环依赖
- 缓存后引用恒等 → 使 `zodToJsonSchema` 的 WeakMap 缓存生效

#### 4.2.2 IPC handler wrapper
```typescript
// src/main-process/communication/_shared/registerValidatedHandler.ts
type Envelope<T> = { status: true; data: T } | { status: false; msg: string }

export function registerValidatedHandler<I, O>(
  channel: string,
  inputSchema: () => z.ZodType<I>,
  handler: (input: I, event: IpcMainInvokeEvent) => Promise<O>,
): void {
  ipcMain.handle(channel, async (event, raw) => {
    const parsed = inputSchema().safeParse(raw)
    if (!parsed.success) {
      return { status: false, msg: formatZodValidationError(channel, parsed.error) } satisfies Envelope<never>
    }
    try {
      const data = await handler(parsed.data, event)
      return { status: true, data } satisfies Envelope<O>
    } catch (e) {
      logForDebugging(`[${channel}] handler error`, { level: 'error', error: e })
      return { status: false, msg: e instanceof Error ? e.message : 'Unknown error' }
    }
  })
}
```

#### 4.2.3 Worker 消息 discriminated union
```typescript
// src/childprocess/contact-extraction/messages.ts
const WorkerOutboundSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('extraction-progress'), resultId: z.string(), status: z.enum(['running','completed','failed']), data: z.unknown() }),
  z.object({ type: z.literal('log'), level: z.enum(['info','warn','error']), message: z.string() }),
])
```

#### 4.2.4 配置降级
```typescript
const SettingsSchema = lazySchema(() =>
  z.strictObject({
    aiEnabled: z.enum(['true','false']).catch('false'),
    language: z.enum(['en','zh','es','fr','de','ja']).catch('en'),
    // 非关键 → 降级
  }).partial(),
)
```

### 4.3 文件组织

```
src/
├── utils/
│   ├── lazySchema.ts                  (新增)
│   ├── zodToJsonSchema.ts             (新增)
│   ├── semanticNumber.ts              (新增)
│   ├── semanticBoolean.ts             (新增)
│   └── zodErrors.ts                   (新增：formatZodValidationError / formatZodError)
├── schemas/
│   ├── ipc/                           (新增：每类 IPC 入参 schema)
│   │   ├── aiChat.ts
│   │   ├── contactExtraction.ts
│   │   └── ...
│   ├── worker/                        (新增：worker 消息契约)
│   │   ├── contactExtraction.ts
│   │   ├── yellowPages.ts
│   │   └── ...
│   ├── config/                        (新增：配置 schema)
│   │   ├── settings.ts
│   │   ├── skillManifest.ts
│   │   └── mcpServer.ts
│   └── api/                           (新增：外部 API 响应 schema)
│       └── ...
└── main-process/communication/
    └── _shared/registerValidatedHandler.ts  (新增)
```

---

## 5. 验收标准

### 5.1 功能验收
- [ ] 所有新增/修改的 IPC handler 经过 `registerValidatedHandler` 注册
- [ ] 4 类 worker 消息均有 discriminated union schema，main 端 `safeParse`
- [ ] settings.json 损坏字段不再导致白屏，显示具体错误（i18n）
- [ ] LLM function calling 收到的 JSON Schema 由 `zodToJsonSchema` 统一生成
- [ ] 单元测试覆盖：lazySchema、zodToJsonSchema 缓存命中、semanticNumber 边界值、wrapper 的 parse 失败/成功路径

### 5.2 质量指标
| 指标 | 目标 |
|------|------|
| 新增 utils 测试覆盖率 | ≥ 80% |
| 新增代码 `any` 数量 | 0 |
| IPC handler 违反「直连 DB」规则数 | 0（不变） |
| parse 失败时的错误消息可读性 | 人工 review 通过 |

### 5.3 回归验收
- [ ] `yarn dev` 正常启动
- [ ] `yarn test` 全绿
- [ ] contact-extraction worker 端到端跑通
- [ ] AI chat + keyword generation 流程正常

---

## 6. 迁移计划（分阶段）

### Phase 1：基础设施（基础）
1. 升级 zod 到 v4（评估破坏面）
2. 实现 `utils/lazySchema.ts`、`utils/zodToJsonSchema.ts`、`utils/zodErrors.ts`、`semanticNumber`、`semanticBoolean`
3. 单元测试
4. 提交若干原子 commit（feat: utils 逐个）

### Phase 2：IPC wrapper + 试点
1. 实现 `registerValidatedHandler`
2. 选取 2-3 个典型 handler 试点（建议：`ai-chat-ipc`、`contactExtraction-ipc`、`language-ipc`）
3. 评估前端是否需要适配 envelope（保持兼容）
4. 扩展到全部 30+ IPC handler（可拆多个 PR）

### Phase 3：Worker 消息契约
1. 为 4 类 worker 定义 outbound/inbound schema
2. main 端 worker message handler 接入 `safeParse`
3. worker 端 process.on('message') 接入 inbound 校验

### Phase 4：配置 + AI 工具
1. 用户 settings 校验 + 降级
2. 技能 manifest、MCP server 配置校验
3. AI 工具 schema 收敛 + `zodToJsonSchema` 接 function calling
4. 多路分支工具迁移到 `z.discriminatedUnion`

### Phase 5：外部 API 响应 + entity 守卫
1. 后端 API ResponseSchema
2. Model 层 `parseAndStrip` helper
3. 抓取结果落库前过滤

---

## 7. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| zod v3 → v4 破坏性变更（`.superRefine` → `.check`、issue 结构变化） | 中 | 先用 `zod/v4` 子路径增量迁移，旧文件保留 v3；新增代码一律 v4 |
| IPC envelope 变化破坏前端 | 中 | wrapper 保持与现有返回结构兼容（多数已是 `{status,msg,data}`） |
| Schema 性能影响（高频 IPC） | 低 | schema 在 lazySchema 缓存；parse 在边界一次性开销小 |
| 迁移工作量被低估（30+ IPC × N 字段） | 高 | 分阶段、分 PR；旧 handler 短期内允许「裸 handler」共存 |
| 多语言错误消息维护成本 | 中 | 错误码化（如 `error.missing_param`）+ 翻译表，避免硬编码字符串 |

---

## 8. 度量

迁移完成后跟踪以下指标（30 天）：
- 运行时「undefined is not / cannot read property」类崩溃数下降比例
- IPC handler 缺参/错参类 bug 报告下降比例
- AI function calling 参数被 LLM 误填导致的重试下降比例

---

## 9. 开放问题

1. 是否需要在 renderer 端（Vue）也接入 zod 校验调用入参？（默认：否，保持 IPC 单点校验）
2. zod v4 升级是否与当前 TypeScript 5.1 兼容？需 spike。
3. 是否引入 `zod-to-ts` 反向生成类型？默认：否，统一用 `z.infer<>`。
4. MCP server 配置 schema 是否需要与官方 MCP spec 对齐？需确认。

---

## 附录 A：Claude Code 可借鉴模式速查

| 模式 | 用途 | 对应需求 |
|------|------|----------|
| `lazySchema` | 延迟构造 + 引用恒等 | FR-1.1 |
| `zodToJsonSchema` + WeakMap | LLM schema 转换缓存 | FR-1.2, FR-5.2 |
| `semanticNumber/Boolean` | 兼容 LLM 字符串输出 | FR-1.3 |
| `z.discriminatedUnion` | 多分支消息/工具输出 | FR-3.1, FR-5.4 |
| `z.strictObject` | 拒绝多余字段（防 LLM/抓取注入） | FR-2.1 |
| `z.partialRecord` | 事件 → matcher 映射 | FR-4.1 |
| `.catch(ctx => default)` | 优雅降级 | FR-4.2 |
| `.check(ctx => ...)` | v4 自定义校验（替 superRefine） | FR-4.1 |
| `formatZodValidationError` | 工具调用错误 → LLM 可读 | FR-1.4 |
| `formatZodError` | 配置错误 → 用户可读 | FR-1.5 |
| 特性标志条件展开 | 编译期 dead code elimination | FR-5（可选） |
