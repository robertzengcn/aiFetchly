# WS-6 R6.2 — V1 AI Chat Retirement Parity Checklist

**Decision required:** delete `AiChatBox.vue` (v1, 3,697 lines) + `ai-chat-ipc.ts`
+ `api/aiChat.ts` + `api/aiChatWithRAG.ts`, and remove v1 wiring from
`layout.vue`. This forces v2 (AiChatV2.vue) for all users (the `aiChatV2Enabled`
flag currently defaults to `true`; retiring v1 means removing the flag fallback).

## Feature parity: v2 is a strict superset of v1

| Feature | v1 (AiChatBox) | v2 (AiChatV2) | Notes |
|---|---|---|---|
| Chat streaming | ✅ streamChatMessage | ✅ (via AiChatV2Composer) | |
| Chat history | ✅ getChatHistory | ✅ | |
| Conversations | ✅ getConversations | ✅ | |
| Tool calls (result/function_call) | 4 refs (basic) | 25 refs (full) | v2 is richer |
| Skill approval | ✅ SkillApprovalCard | ✅ SkillApprovalCard | same component |
| MCP tools | ✅ MCPToolManager | ✅ MCPToolManager | same component |
| File operations | ✅ FileOperationBadge | ✅ FileOperationBadge | same component |
| AI navigation | ✅ handleAiNavigationToolResult | ✅ (in v2) | |
| Slash commands | ✅ AI_CHAT_SLASH_COMMANDS | ✅ dispatchSlashCommand | |
| Attachments | ✅ | ✅ | |
| **Plan mode** | ❌ | ✅ PlanApprovalCard + PlanStatusBadge + QuestionCard | v2-only |
| **Workspaces** | ❌ | ✅ WorkspaceBadge + MemoryPanel + RequiredCard | v2-only |
| **Agent tasks** | ❌ | ✅ AgentTaskListDialog | v2-only |
| **Mode selector** | ❌ | ✅ AiChatV2ModeSelector | v2-only |
| **Model selector** | ❌ | ✅ AiChatV2ModelSelector | v2-only |
| **Tool approval mode** | ❌ | ✅ AiChatV2ToolApprovalModeSelector | v2-only |

## i18n parity

- v1 uses 24 `t()` keys in AiChatBox.vue (all in one file).
- v2 uses 7 in AiChatV2.vue BUT distributes the rest across its 12+ child
  components (AiChatV2Composer, AiChatV2Messages, etc.) — total v2 i18n
  coverage is HIGHER than v1 (v2 has more UI surface).
- Both use the same i18n infrastructure (`useI18n` from `vue-i18n`).
- v2-only features (plan mode, workspaces, agents) have their own i18n keys
  already added to all 6 language files (en/zh/es/fr/de/ja).

## IPC channel separation

- v1: `AI_CHAT_*` channels (handlers in `ai-chat-ipc.ts`, registered separately).
- v2: `AI_CHAT_V2_*` channels (handlers in `ai-chat-v2-ipc.ts`, registered separately).
- Both are registered in `communication/index.ts` (lines 79-80).
- Retiring v1 means deleting `registerAiChatIpcHandlers()` + the v1 IPC file.

## Risk assessment

- **Low risk**: v2 defaults to enabled (`aiChatV2Enabled !== 'false'`). Most
  users are already on v2.
- **Edge case**: users who explicitly set `aiChatV2Enabled = false` (opted out
  of v2) would lose chat after retirement. This is the product decision: force
  v2 for everyone.
- **Migration path**: if any v1-specific edge case surfaces, v1 can be restored
  from git (the deletion is revertible).

## Recommended retirement steps (once approved)

1. Remove `<AiChatBox>` render + `aiChatV2Enabled` flag logic from `layout.vue`.
2. Delete `src/views/components/aiChat/AiChatBox.vue`.
3. Delete `src/main-process/communication/ai-chat-ipc.ts`.
4. Delete `src/views/api/aiChat.ts` + `src/views/api/aiChatWithRAG.ts`.
5. Remove `registerAiChatIpcHandlers()` from `communication/index.ts`.
6. Verify no remaining importers of the deleted files.
7. Test: chat works end-to-end via v2 (send message, tool call, slash command).
