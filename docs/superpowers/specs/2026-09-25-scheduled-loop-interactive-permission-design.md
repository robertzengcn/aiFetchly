# Scheduled Loop Interactive Permission — Design

**Date:** 2026-09-25
**Status:** Approved (Approach A)
**Supersedes behavior in:** PRD §FR-16, technical-design §15 (fail-closed unattended allowlist)

## 1. Problem

When the AI calls a high-impact function tool (`file_write`, `file_edit`, `send_email_reply`, `start_email_send_task`, `create_email_reply_draft`, `get_email_message`) during a scheduled-loop run, and the tool was not pre-added to the task's `allowedTools` at loop-creation time, the run returns a hard error:

```
{"success":false,"executionTimeMs":0,"error":"Tool \"file_write\" is a high-impact tool and must be explicitly added to the task's allowed tools list.","blocked_by_scheduled_policy":true}
```

This is incorrect from the user's perspective: the scheduled run should **pause and ask the user** via a permission card (the same card the interactive path already shows), send a notification, and wait for the user to grant or deny — not fail closed.

## 2. Root Cause

The scheduled loop runs on a dedicated engine (`AIChatQueryEngineFactory.createScheduled`) deliberately built to fail-closed for unattended execution. Two layers enforce it:

1. **Catalog filter** — `toolFilter: (name) => isToolAllowed(name, policy)` hides non-allowlisted tools from the model's advertised catalog (`AIChatQueryEngineFactory.ts:64,96`).
2. **Execution backstop** — `executeScheduledTool` revalidates the tool against `canAutoApproveScheduledTool`; when denied it returns `blockedToolResult` (a hard `ToolExecutionResult` with `blocked_by_scheduled_policy: true`) at `AIChatQueryEngineFactory.ts:114-137`.

The interactive permission-card flow uses a completely different mechanism that the scheduled engine never wires into:
- `SkillExecutor` returns `needsPermissionPrompt: true` (`SkillExecutor.ts:544-576`).
- The loop detects it via `isPermissionPromptResult` (`AIChatQueryLoop.ts:865`) and returns `paused_for_permission`.
- The engine parks the turn in `pendingPermissions` (`AIChatQueryEngine.ts:2056-2068`) until `resumeToolAfterPermission` is called.

The scheduled engine is a separate instance with no IPC route to its `resumeToolAfterPermission`, and its 10-minute runtime timeout (`SCHEDULED_LOOP_RUN_TIMEOUT_MS`) would kill any pause. So inverting the boundary requires wiring the scheduled engine into the pause/notify/resume path.

## 3. Goal & Non-Goals

**Goal:** When the AI calls a gated high-impact/automation tool during a scheduled run, the run pauses, notifies the user, shows a permission card, and resumes on grant or continues-on-deny. Applies to both the chat-bound path (`runChatScheduledLoop`) and the cron path (`executeRunLoop`).

**Non-goals:**
- Changing behavior for permanently-blocked tools (`shell_execute`, `mark_email_processed`) — these stay hard-fail.
- Changing the catalog filter (the model still won't *see* gated tools, but if it calls one anyway — steered by content or hallucination — it now pauses instead of erroring).
- Pre-approving tools; the existing `allowedTools` pre-approval path is unchanged.
- Building a parallel permission UI; the existing card is reused.

## 4. User Decision (confirmed)

- **Unattended fallback:** Send an OS notification and **wait** for the user to handle it.
- **Backstop timeout:** **1 hour**. If no grant/deny arrives within 1 hour, auto-deny, notify, and continue the run without the tool.

## 5. Design

### 5.1 Policy — `ScheduledAiToolPolicy.ts`

Add a 4th outcome to `ScheduledToolDecision`:

```typescript
export interface ScheduledToolDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
  readonly requiresInteractivePermission?: boolean; // NEW
}
```

`canAutoApproveScheduledTool` gains a new branch: when the tool is high-impact or automation, **not** permanently blocked, and **not** in the task's `allowedTools`, return:

```typescript
{
  allowed: false,
  requiresInteractivePermission: true,
  reason: `Tool "${toolName}" is a ${tier} tool requiring permission. Pausing the scheduled run to ask the user.`,
  riskLevel: "high",
}
```

Permanently-blocked tools (`SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS`) and non-schedulable tools keep the current hard-fail (`requiresInteractivePermission` false/absent). Allowlisted high-impact tools keep `allowed: true` (auto-approve, no prompt — unchanged).

### 5.2 Factory executor — `AIChatQueryEngineFactory.ts`

`executeScheduledTool` changes: when the decision has `requiresInteractivePermission: true`, return a **synthesized permission-prompt result** instead of `blockedToolResult`:

```typescript
return {
  tool_call_id: context.toolCallId ?? name,
  tool_name: name,
  success: false,
  result: {
    error: "Permission required",
    needsPermissionPrompt: true,
    permissionCategory: skill?.permissionCategory,
    ...(skill?.buildPermissionPreview
      ? (() => {
          const preview = skill.buildPermissionPreview(args);
          return preview ? { permissionPreview: preview } : {};
        })()
      : {}),
  },
  execution_time_ms: 0,
};
```

This mirrors `SkillExecutor.ts:544-576` so the loop's `isPermissionPromptResult` detection fires and the turn pauses. `blockedToolResult` is retained **only** for permanently-blocked / non-schedulable tools.

### 5.3 Runner — `ScheduledAiMessageRunner.ts`

Two new constants in `aiChatScheduledLoopConfig.ts`:

```typescript
export const SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS = 60 * 60 * 1000; // 1 hour
```

Runner changes (both `runChatScheduledLoop` and `executeRunLoop`):

1. **Register the engine in a new `ScheduledLoopEngineRegistry`** (singleton, mirrors `ScheduledLoopRunRegistry`) keyed by `conversationId → { engine, runId, scheduleId }`, before `engine.submitMessage`. Cleared in the `finally` block of each path.
2. **Sink forwarder** detects a `tool_result` event whose `toolResult.needsPermissionPrompt === true`:
   - Suspend the runtime timeout (`clearTimeout(timeoutHandle)`).
   - Fire an OS notification via `showNotification(title, body)` from `src/modules/lib/function.ts:137`.
   - Broadcast `ChatV2ConversationUpdatedEvent` with new reason `scheduled_turn_permission_requested` (identifiers only — the renderer reloads the persisted tool_result to render the card).
   - Start a **permission backstop timer** (`SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS`). On fire: synthesize a deny, resume the loop, notify "permission auto-denied after 1 hour".
3. On terminal finalize, clear the backstop timer (in the existing `finally`).

### 5.4 Engine — `AIChatQueryEngine.ts`

The scheduled engine instance is constructed per-run by the factory, so `pendingPermissions` works the same as interactive. Add:

- `denyToolPermission({ toolId, conversationId }): Promise<ResumeTurnResult>` — synthesizes a denied `tool_result` (content `"Permission denied. The tool will not be executed."`), pushes it to `conversationMessages`, and re-enters the loop from `pending.nextRound` (deny-and-continue). The interactive path only has grant + stop-conversation; this new method lets the scheduled run continue after a deny.

### 5.5 Registry + IPC routing

**New:** `ScheduledLoopEngineRegistry` (`src/service/ScheduledLoopEngineRegistry.ts`) — singleton, `register/unregister/getByConversation`. Returns the live scheduled engine instance + `runId` for a conversation.

**IPC — `ai-chat-v2-ipc.ts` `handleResumeToolAfterPermission` (existing channel `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION`):**
- Check `ScheduledLoopEngineRegistry.getByConversation(conversationId)` first.
- If a scheduled engine is registered AND has a pending permission for that conversation → call `engine.resumeToolAfterPermission(...)` (grant path, already exists) on the scheduled engine, clear the backstop timer, return.
- Else → fall through to the interactive singleton (current behavior).

**New IPC — `AI_CHAT_V2_DENY_TOOL_PERMISSION` (new channel in `channellist.ts`):**
- Look up the scheduled engine via the registry; call `engine.denyToolPermission(...)`; clear the backstop timer; return `{ ok: true }`.
- If no scheduled engine has a pending permission for that conversation, fall back to `stopChatV2Stream` (interactive deny, current behavior).

### 5.6 Renderer — `AiChatV2.vue`

1. **Conversation-updated handler:** handle `scheduled_turn_permission_requested` reason → reload history for that conversation (the card renders from the persisted `needsPermissionPrompt` tool_result) + fire an in-app notification via the existing preload notification bridge.
2. **Permission card grant** → existing `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION` invoke (now routed to the scheduled engine by the IPC change). No component logic change.
3. **Permission card deny** → new `AI_CHAT_V2_DENY_TOOL_PERMISSION` invoke. `handleSkillPermissionDeny` gains a branch: if the message's `conversationId` has a registered scheduled engine (or a metadata flag marking it scheduled), call deny-IPC; else fall back to `stopChatV2Stream` (current behavior).

### 5.7 Type changes — `aiChatScheduledLoopTypes.ts`

Extend `ChatV2ConversationUpdatedEvent.reason` union with `"scheduled_turn_permission_requested"`.

## 6. Data Flow

```
Model calls file_write (not in allowedTools)
  → AIChatQueryLoop.executeTool
  → AIChatQueryEngineFactory.executeScheduledTool
  → canAutoApproveScheduledTool → { allowed:false, requiresInteractivePermission:true }
  → returns needsPermissionPrompt result
  → loop emits tool_result (needsPermissionPrompt) + returns paused_for_permission
  → engine parks turn in pendingPermissions
  → ScheduledLoopEventSink.forwarder sees tool_result.needsPermissionPrompt
  → runner: clearTimeout(runtime timeout) + showNotification + broadcast scheduled_turn_permission_requested + start 1h backstop
  → renderer reloads history → permission card renders

User grants:
  → AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION
  → IPC routes via ScheduledLoopEngineRegistry → scheduled engine.resumeToolAfterPermission
  → runner clears backstop → engine re-executes tool (skipPermissionCheck) → loop continues
  → runner finalize (completed)

User denies:
  → AI_CHAT_V2_DENY_TOOL_PERMISSION
  → scheduled engine.denyToolPermission → synthesized denied tool_result → loop continues from nextRound
  → runner finalize (completed, tool denied)

1 hour passes with no response:
  → backstop fires → runner calls engine.denyToolPermission → loop continues + notify "auto-denied"
```

## 7. Security Considerations

- The catalog filter stays — the model still cannot *see* gated tools. The new path only triggers when the model calls a gated tool anyway (prompt-injection-steered or hallucinated), which is exactly when a human should intervene.
- Permanently-blocked tools (`shell_execute`, `mark_email_processed`) remain hard-fail; no interactive escape hatch.
- The 1-hour backstop prevents an unbounded conversation-lock hold.
- The deny-and-continue path gives the model a "tool denied" result so the run can proceed without the tool (and the next occurrence can retry) — strictly safer than the current hard-error-and-die.

## 8. Testing (TDD, per CLAUDE.md)

1. **`ScheduledAiToolPolicy.test.ts`** — `requiresInteractivePermission` is `true` for gated high-impact/automation tools not in `allowedTools`; `false` (absent) for permanently-blocked and for allowlisted tools. Existing assertions updated where they expected the old `high-impact` reason text.
2. **New `AIChatQueryEngineFactory` test** — gated tool call returns `needsPermissionPrompt: true`; always-blocked tool still returns `blocked_by_scheduled_policy`.
3. **New `ScheduledAiMessageRunner` test** — on permission pause: runtime timeout suspended, `showNotification` called, `scheduled_turn_permission_requested` broadcast emitted, backstop started; grant resumes + clears backstop; deny continues run; backstop expiry auto-denies + notifies.
4. **IPC test (`ai-chat-scheduled-loop-ipc.test.ts` / `ai-chat-v2-ipc`)** — resume routes to scheduled engine when registered; deny calls `denyToolPermission`; falls to interactive when not registered.
5. **Component test (`test/vitest/main/components/`)** — permission card renders for a scheduled permission-requested conversation-updated; grant calls `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION`; deny calls `AI_CHAT_V2_DENY_TOOL_PERMISSION`.

## 9. Files Touched

| File | Change |
|---|---|
| `src/service/ScheduledAiToolPolicy.ts` | Add `requiresInteractivePermission` to decision + branch |
| `src/service/AIChatQueryEngineFactory.ts` | Synthesize permission result for gated tools |
| `src/service/AIChatQueryEngine.ts` | Add `denyToolPermission` method |
| `src/service/ScheduledAiMessageRunner.ts` | Suspend timeout, notify, broadcast, backstop, register engine |
| `src/service/ScheduledLoopEngineRegistry.ts` | NEW singleton registry |
| `src/config/aiChatScheduledLoopConfig.ts` | `SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS` |
| `src/config/channellist.ts` | `AI_CHAT_V2_DENY_TOOL_PERMISSION` channel |
| `src/entityTypes/aiChatScheduledLoopTypes.ts` | extend `reason` union |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | resume routing + deny handler |
| `src/preload.ts` | expose deny channel |
| `src/views/api/aiChatV2.ts` (or api layer) | deny invoke helper |
| `src/views/components/aiChatV2/AiChatV2.vue` | handle `scheduled_turn_permission_requested` + deny branch |
| tests (§8) | TDD per file |

## 10. Out of Scope

- macOS Notification Center / Windows toast API integration beyond `showNotification`. The existing `new Notification(...)` path is used as-is.
- Telemetry on permission-grant rates.
- Bulk pre-approval UX improvements.
