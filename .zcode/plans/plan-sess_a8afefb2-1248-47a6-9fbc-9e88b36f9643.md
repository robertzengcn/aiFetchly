# Fix: AI Chat 上下文自动压缩不生效

## 诊断（已确认的根本原因）

用户观察正确——**自动压缩实际上从未生效**，原因有三层：

1. **真正能缩减上下文的操作只有手动入口。** `runFullCompact()`（生成 compact 边界 → `AIChatContextAssembler` 在下一次组装 prompt 时裁剪边界之前的历史）只被手动按钮的 IPC handler 调用（`ai-chat-v2-ipc.ts:1154`），没有任何自动触发点。

2. **现有的"自动"机制不缩减上下文。** 每轮完成后 `AIChatQueryEngine.ts:1438` 会触发 `enqueueSessionMemoryUpdate`，但它只写一个 advisory 摘要，注入时是**追加**一条 system 消息（`AIChatContextAssembler.ts:326-331`），从不裁剪历史——反而让上下文更大。

3. **阈值分母 bug。** session-memory 门限用硬编码 `DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000`（阈值 102,400 tokens），而 UI 徽章用模型**真实** context window。对于 window < 128k 的模型，徽章到 100% 时后端门限永远不会打开（每轮日志 "threshold gate" 跳过）。真实 window 在后端可用（`AIChatModelCatalogService.getContextWindow`）但从未接入 compact agent。

（另有设计过但从未接线的 `drain_context`/`reactive_compact` 恢复层属于死代码，不在本次范围内。）

## 修复方案：后端自动 full-compact（对齐代码中 "Mirrors Claude Code's autocompact layer" 的既有设计意图）

选择后端触发而非前端自动点按钮，因为 scheduled loop / goal loop 在主进程无渲染器参与地运行，前端触发会漏掉这些场景；且每轮完成处已有现成 hook 点。

### 1. `src/service/AIChatCompactAgentService.ts` — 新增自动压缩
- `AIChatCompactAgentDeps` 增加两个可选依赖：
  - `getContextWindow?: (model?: string) => Promise<number>`
  - `onAutoCompacted?: (summary: AIChatCompactSummaryView) => void`
- 新常量 `AUTO_COMPACT_THRESHOLD_FRACTION = 0.8`（与 UI 徽章 ≥80% 显示压缩按钮一致）。
- 新方法 `enqueueAutoCompact(input): Promise<boolean>`（是否执行了压缩）：
  - 复用现有守卫：`v2-` 前缀、isEnabled、共享 `inFlight` 去重。
  - 用 `deps.getContextWindow?.(model) ?? 128_000` 解析**真实** window。
  - 门限：`promptTokens >= 0.8 × window`，低于则返回 false。
  - 防循环守卫：若已有 active full compact 且其边界已覆盖最新消息（无新内容），跳过。
  - 通过后调用现有 `runFullCompact()`，成功后触发 `onAutoCompacted(summary)`，返回 true；永不抛错（catch + log）。
- 修复 `shouldAttemptSessionMemoryUpdate` 门限分母：用解析出的真实 window（deps 未提供时回退 128k，现有测试不受影响）。

### 2. `src/service/AIChatQueryEngine.ts`（completed 分支，~1438 行）
- 先调 `enqueueAutoCompact`；仅当**未**执行压缩时才回退调 `enqueueSessionMemoryUpdate`（避免对同一批消息做两次 LLM 调用）。fire-and-forget + catch，与现有模式一致。

### 3. 通知渲染进程（让徽章立即下降）
- `src/config/channellist.ts`：新增 `AI_CHAT_V2_AUTO_COMPACTED = "ai-chat-v2:auto-compacted"`。
- `src/entityTypes/aiChatV2Types.ts`：新增 `ChatV2AutoCompactedEvent { conversationId; outputTokenEstimate; model?; occurredAt }`。
- `src/service/AIChatConversationUpdateBroadcaster.ts`：新增 `emitAutoCompacted(event)`（复用现有广播模式）。

### 4. 主进程接线 `src/main-process/communication/ai-chat-v2-ipc.ts`（`getCompactAgent`，~168 行）
- `getContextWindow` 接共享的 `AIChatModelCatalogService` 实例。
- `onAutoCompacted` → `AIChatConversationUpdateBroadcaster.getInstance().emitAutoCompacted(...)`。

### 5. Preload + 前端 API
- `src/preload.ts`：将新 channel 加入 receive/removeListener 白名单（3 处列表）。
- `src/views/api/aiChatV2.ts`：新增 `subscribeAutoCompacted` / `unsubscribeAutoCompacted`（仿照 `aiChatScheduledLoop.ts` 的订阅模式）。

### 6. `src/views/components/aiChatV2/AiChatV2.vue`
- `onMounted`（~4513 行处，与 `subscribeConversationUpdated` 并列）订阅、`onBeforeUnmount`（~4544 行处）退订。
- 处理函数：仅当 `event.conversationId === activeConversationId` 时，`streamingEstimatedTokens = outputTokenEstimate`、`lastUsage = null`、更新 `activeModel`、显示现有 `compactNotice` snackbar。
- **复用现有 i18n key `aiChatV2.compact_completed`**，无需改动 6 个语言文件。

### 7. 测试 `test/vitest/main/service/AIChatCompactAgentService.test.ts`
新增用例：
- promptTokens ≥ 80% × 真实 window（mock `getContextWindow` 返回 8192，tokens 7000）→ `runFullCompact` 执行、`onAutoCompacted` 触发、返回 true。
- 低于阈值 → 不压缩、返回 false。
- 已有 compact 边界覆盖最新消息 → 跳过。
- `completeChat` 抛错 → 不向外抛。
- session-memory 门限在提供真实 window 时用真实分母。

## 验证
- 运行 compact agent vitest 测试文件。
- `yarn vue-check` 验证 Vue/TS 类型。

## 提交
按 AGENTS.md 规则以 `fix: ...` 提交。