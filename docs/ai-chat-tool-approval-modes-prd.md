# AI Chat Tool Approval Modes - Product Requirements Document

## 1. Executive Summary

### 1.1 Overview

AiFetchly AI Chat V2 currently pauses whenever the assistant requests a tool whose permission category requires user approval. The user must click an approval card before the tool can run. This is safe, but it creates too much friction when the user intentionally wants the assistant to work through a sequence of trusted tool calls.

Add a compact approval-mode selector at the bottom of the AI chat panel. The selector lets the user choose how much permission friction they want for the current chat context:

- `Ask for approval`
- `Approve for me`
- `Full access`

The feature must reduce repeated approval clicks without turning tool execution into an unbounded bypass. The UI can collect the user's preference, but the main process must enforce it before any tool runs.

### 1.2 Goals

- Let users control tool approval behavior from the bottom of the AI Chat V2 panel.
- Keep `Ask for approval` as the default mode.
- Allow lower-friction tool execution when the user explicitly selects `Approve for me` or `Full access`.
- Keep tool validation, allowlists, plan-mode gates, shell safeguards, dependency-install approval, audit logging, and cancellation behavior intact.
- Store and apply the selected mode through a typed main-process policy, not only renderer state.
- Make the active mode visible while a tool is running or waiting for permission.
- Add tests for policy decisions, IPC updates, stream/resume behavior, and UI state.

### 1.3 Non-Goals

- Do not remove inline approval cards. They are still needed in `Ask for approval` mode and for blocked high-risk actions.
- Do not let the renderer bypass main-process permission checks.
- Do not persistently grant all skill permissions through `SkillPermissionService.grantPermission()` when the user selects a chat mode.
- Do not weaken tool argument validation, destructive shell command blocking, shell rate limiting, workspace restrictions, or plan approval rules.
- Do not auto-approve system dependency installs. Dependency installation must remain an explicit user decision.
- Do not change scheduled/background AI task permissions in this feature.

## 2. Problem Statement

The current chat flow is safe but repetitive:

1. The user asks the assistant to perform work.
2. The model requests a permission-required tool.
3. The main process emits a tool result with `needsPermissionPrompt: true`.
4. The renderer shows an approval card.
5. The user clicks allow.
6. The app resumes the paused tool call.
7. The pattern repeats for every permission-required tool.

This is acceptable for occasional tool use. It is poor for workflows such as research, campaign preparation, lead collection, workspace file edits, or multi-step automation where the user already intends to let the assistant proceed.

The desired behavior is explicit user control over approval strictness, shown close to the composer because that is where the user gives the assistant operating instructions.

## 3. Users And Use Cases

### 3.1 Primary Users

- Users who want maximum control and want to review every permission-required tool.
- Users who trust the current conversation and want the assistant to continue through ordinary tool calls.
- Power users who intentionally want the assistant to run all available registered tools in the current chat context with minimal interruption.

### 3.2 Core Use Cases

1. A user keeps the default `Ask for approval` mode and manually approves each permission-required tool.
2. A user selects `Approve for me` before asking the assistant to research leads, so network and automation tools can proceed without repeated clicks.
3. A user selects `Full access` for a trusted local workspace task, so filesystem, automation, network, and shell-category tools can run after validation without approval cards.
4. A tool needs to install a missing system dependency. The app still prompts for explicit install approval regardless of the selected chat approval mode.
5. A tool call violates a hard policy, such as an unknown tool, disallowed plan-mode action, invalid arguments, destructive shell command, or workspace boundary. The app blocks it regardless of mode.

## 4. Approval Mode Semantics

### 4.1 Mode Definitions

| Mode | User Meaning | Runtime Behavior |
| --- | --- | --- |
| `ask_for_approval` | Ask before permission-required tools run. | Existing behavior. `SkillExecutor` returns `needsPermissionPrompt` for unknown non-pure permissions. The renderer shows approval cards and resumes only after user action. |
| `approve_for_me` | Continue ordinary trusted tool calls in this chat. | Main process auto-approves registered non-shell tools that pass validation and policy checks. Shell tools and dependency installs still prompt. No persistent global permission grant is written. |
| `full_access` | Let this chat run all registered tools with minimal interruption. | Main process auto-approves registered tools, including shell-category tools, after validation and hard safety checks. Dependency installs still prompt. No destructive-command block, rate limit, workspace guard, plan gate, or allowlist is disabled. |

### 4.2 Required Guardrails

All modes must continue to enforce:

- Tool must exist in `SkillRegistry` or the relevant approved tool registry.
- Tool arguments must pass existing validation before execution.
- Plan mode must still block high-impact tools until plan approval.
- Workspace-scoped file tools must remain inside approved workspace boundaries.
- Shell commands must still pass denylist validation and rate limiting.
- System dependency install prompts must still require explicit user approval.
- Tool loop limit must still stop runaway model/tool cycles.
- AI enable gating must still happen at the start of AI IPC handlers using `Token` and `USER_AI_ENABLED`.
- Tool results sent back to the model must remain sanitized.

### 4.3 Persistence Rules

Recommended first release:

- Store selected approval mode per AI Chat V2 conversation.
- Default new conversations to `ask_for_approval`.
- Persist mode locally so switching conversations restores the selected mode.
- Do not apply a conversation's mode to legacy chat or scheduled/background tasks.
- Do not persist `full_access` across app restarts unless the user explicitly reselects it. On app startup, downgrade any stored `full_access` conversation mode to `ask_for_approval` or `approve_for_me`.

Rationale: `approve_for_me` is a productivity preference. `full_access` is a high-risk operating state and should be treated like a session consent.

## 5. User Experience Requirements

### 5.1 Placement

Add the selector in the bottom AI Chat V2 panel, near the composer and model/mode controls:

- It must be visible without opening settings.
- It must remain compact on narrow widths.
- It must not shift the message list height while streaming.
- It should be disabled only while the main process is applying a mode update.

Recommended UI control:

- Vuetify segmented control or compact menu-backed selector.
- Use a shield/key icon to signal permission behavior.
- Show the active label and tooltip text for each mode.

### 5.2 Labels And Helper Text

User-facing labels:

- `Ask for approval`
- `Approve for me`
- `Full access`

Recommended descriptions:

- `Ask for approval`: "Ask before tools that need permission."
- `Approve for me`: "Auto-approve trusted non-shell tools in this chat."
- `Full access`: "Auto-approve registered tools in this chat. Safety blocks still apply."

All labels, tooltips, warnings, snackbars, and errors must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

### 5.3 Mode Change Confirmation

Changing from `ask_for_approval` to `approve_for_me` should be immediate but visible.

Changing to `full_access` should show a one-time confirmation for the current app session:

- The dialog must state that registered tools can run without approval prompts in this chat.
- It must state that dependency installs and hard safety blocks still require intervention.
- It must offer `Cancel` and `Enable full access`.

### 5.4 Permission Prompt Behavior

When a tool pauses for approval:

- In `ask_for_approval`, keep the current inline approval card.
- In `approve_for_me`, only show cards for shell tools, dependency installs, and policy-blocked actions that need explicit user action.
- In `full_access`, do not show ordinary skill approval cards after policy passes. Show dependency-install prompts and blocked-action messages as needed.

### 5.5 Status Feedback

Tool blocks should include enough context to explain why automation did or did not happen:

- `Auto-approved by chat mode`
- `Waiting for approval`
- `Blocked by safety policy`
- `Dependency install requires approval`

## 6. Functional Requirements

### FR-001 Approval Mode Type

Add a shared type:

```typescript
export type ChatToolApprovalMode =
  | "ask_for_approval"
  | "approve_for_me"
  | "full_access";
```

Recommended location:

- `src/entityTypes/aiChatV2Types.ts`

### FR-002 Renderer Selector

Update `src/views/components/aiChatV2/AiChatV2.vue` or a new child component such as `AiChatV2ToolApprovalModeSelector.vue` to:

- Render the selected approval mode at the bottom of the chat panel.
- Load the active conversation's mode.
- Call a typed renderer API when the mode changes.
- Show a confirmation before enabling `full_access`.
- Reset or reload mode when `activeConversationId` changes.

### FR-003 Renderer API

Add typed API methods in `src/views/api/aiChatV2.ts`:

```typescript
export async function getChatV2ToolApprovalMode(
  conversationId: string
): Promise<ChatToolApprovalMode>;

export async function setChatV2ToolApprovalMode(
  conversationId: string,
  mode: ChatToolApprovalMode
): Promise<ChatToolApprovalMode>;
```

### FR-004 IPC Channels

Add new channels in the AI Chat V2 IPC namespace:

- `AI_CHAT_V2_GET_TOOL_APPROVAL_MODE`
- `AI_CHAT_V2_SET_TOOL_APPROVAL_MODE`

The handlers in `src/main-process/communication/ai-chat-v2-ipc.ts` must:

- Check `USER_AI_ENABLED` before doing AI-related work if the handler can affect AI execution.
- Validate `conversationId` and `mode`.
- Call a Module/service method rather than directly accessing the database.
- Return the standard `{ status, msg, data }` shape used by existing handlers.

### FR-005 Main-Process Policy Service

Add a service such as `AIChatToolApprovalPolicyService` that decides whether a tool permission prompt should be auto-approved.

Recommended decision input:

```typescript
interface ChatToolApprovalPolicyInput {
  readonly conversationId: string;
  readonly mode: ChatToolApprovalMode;
  readonly toolName: string;
  readonly permissionCategory: SkillPermissionCategory;
  readonly isPlanApproved: boolean;
  readonly isDependencyInstall: boolean;
}
```

Recommended decision output:

```typescript
interface ChatToolApprovalPolicyDecision {
  readonly autoApprove: boolean;
  readonly reason: string;
}
```

The policy service must not grant global permission tokens as a side effect. It should return a decision used by the execution path for the current chat turn.

### FR-006 Tool Execution Integration

Integrate the policy before returning `needsPermissionPrompt`.

Candidate locations:

- `src/service/AIChatQueryLoop.ts`, before or around the call to `SkillExecutor.execute()`
- `src/service/SkillExecutor.ts`, through a new execution context option
- `src/service/AIChatQueryEngine.ts`, for resume handling and pending permission state

Recommended implementation:

1. Keep `SkillExecutor` as the central permission-aware executor.
2. Add a typed execution context option such as `permissionOverride`.
3. Let AI Chat V2 compute the override from the conversation approval mode.
4. Pass `skipPermissionCheck: true` only when the policy service returns `autoApprove: true`.
5. Record the policy reason in emitted tool metadata and audit logs.

This keeps `SkillPermissionService` behavior intact for legacy chat, scheduled tasks, and manual skill execution.

### FR-007 Pending Permission Resume

If a tool pauses in `ask_for_approval` and the user changes mode to `approve_for_me` or `full_access`, the app should not silently resume the already-paused tool. The user must still click the existing approval card or resend the request.

Rationale: mode changes should affect future tool decisions. Silent resume can surprise the user because the original prompt was already presented as requiring action.

### FR-008 Conversation Persistence

Preferred persistence:

- Add nullable metadata on the existing AI Chat V2 conversation/session record if one exists.
- If the current model has no conversation metadata table, store a small local settings record through the existing Token service with a namespaced key:
  - `AI_CHAT_V2_TOOL_APPROVAL_MODE_<conversationId>`

Use a Module/service abstraction either way. Do not access Token or TypeORM directly from the renderer.

### FR-009 Auditability

Every auto-approved tool call must include audit metadata:

- selected mode
- tool name
- permission category
- auto-approval reason
- timestamp
- conversation id

Existing tool execution logs can be extended. If no suitable audit record exists for a tool path, emit structured logs from the main process and include metadata in persisted tool-result messages.

### FR-010 Reset Behavior

Required reset behavior:

- New conversation: `ask_for_approval`.
- App restart: downgrade `full_access` to a safer mode.
- User signs out or AI is disabled: reset active mode state to `ask_for_approval`.
- Explicit denied permission in `SkillPermissionService`: continue to deny unless `full_access` is selected and product explicitly decides it can override previous denies.

Recommendation: explicit `denied` permissions should continue to block in all modes until revoked from settings. The user made a durable deny decision, and a chat selector should not silently reverse it.

## 7. Technical Design

### 7.1 Current Components To Reuse

- `src/views/components/aiChatV2/AiChatV2.vue`: bottom panel, stream state, permission grant/deny handlers.
- `src/views/components/aiChat/AiChatBox.vue`: legacy reference only.
- `src/views/components/aiChat/SkillApprovalCard.vue`: existing approval card used by messages.
- `src/views/api/aiChatV2.ts`: renderer API wrapper.
- `src/main-process/communication/ai-chat-v2-ipc.ts`: AI Chat V2 IPC handlers.
- `src/service/AIChatQueryLoop.ts`: OpenAI tool loop and paused permission result.
- `src/service/AIChatQueryEngine.ts`: active turn state and `resumeToolAfterPermission`.
- `src/service/SkillExecutor.ts`: validation, permission checks, shell checks, audit logging.
- `src/service/SkillPermissionService.ts`: existing persistent/session skill grants.

### 7.2 Proposed Data Flow

```text
User selects mode in bottom chat panel
  -> renderer calls setChatV2ToolApprovalMode(conversationId, mode)
  -> ai-chat-v2 IPC validates input and AI enable state
  -> module/service persists mode for conversation
  -> renderer updates selector state

Model requests a tool
  -> AIChatQueryLoop validates tool and plan policy
  -> AIChatToolApprovalPolicyService evaluates conversation mode
  -> SkillExecutor runs with normal permission check or scoped override
  -> tool result event includes permission or auto-approval metadata
  -> renderer shows result, prompt, or blocked message
```

### 7.3 Permission Override Rules

The scoped override should be narrow:

```typescript
interface SkillExecutionPermissionOverride {
  readonly source: "ai-chat-v2-approval-mode";
  readonly mode: ChatToolApprovalMode;
  readonly reason: string;
}
```

`SkillExecutor` can then skip the normal prompt only when:

- the override is present,
- the tool is known,
- arguments are valid,
- category-specific hard checks still pass,
- explicit denial policy allows the override.

Do not reuse `SkillPermissionService.grantPermission(skillName, true)` for this flow. That would convert a chat preference into a global skill permission.

### 7.4 Plan Mode Interaction

Plan mode already blocks high-impact tools before plan approval. Approval modes must not bypass that.

Rules:

- Before plan approval: high-impact tools remain blocked.
- After plan approval: approval mode controls whether additional per-tool permission prompts appear.
- Plan approval and tool approval mode are separate controls and should remain visually distinct.

### 7.5 Shell Tool Interaction

Shell is the highest-risk existing permission category.

Rules:

- `ask_for_approval`: prompt per shell command, existing behavior.
- `approve_for_me`: continue prompting for shell.
- `full_access`: may auto-approve shell only after shell validation, denylist checks, command preview construction, and rate-limit checks.
- Shell execution audit must record that `full_access` auto-approved the command.

### 7.6 Dependency Install Interaction

System dependency installation remains out of scope for auto-approval.

Rules:

- Missing dependency detection can still run.
- Install recommendation can still be shown.
- User must click explicit install approval.
- `full_access` must not install packages automatically.

## 8. Security And Trust Requirements

- Default mode must be `ask_for_approval`.
- The selector must be visible whenever a non-default mode is active.
- The renderer must not pass `skipPermissionCheck` directly.
- The main process must compute auto-approval from persisted mode and current execution context.
- Explicit user denies should not be overwritten by mode changes.
- Unknown tools must never run.
- All auto-approved executions must be auditable.
- Full access must be easy to turn off.
- Full access must not survive silently across app restarts.

## 9. Testing Requirements

### 9.1 Unit Tests

Add tests for the policy service:

- default mode asks for approval for non-pure tools.
- `approve_for_me` auto-approves network, automation, and filesystem if allowed by product decision.
- `approve_for_me` does not auto-approve shell.
- `full_access` auto-approves shell only after hard checks remain enabled.
- dependency installs are never auto-approved.
- explicit denied permissions remain denied.
- unknown tools remain blocked.

### 9.2 IPC Tests

Extend `test/vitest/main/ipc/ai-chat-v2-ipc.test.ts`:

- get/set approval mode success path.
- invalid mode rejected.
- missing/invalid conversation id rejected.
- AI disabled returns failure before applying execution-affecting mode changes.
- stream with `approve_for_me` does not emit a permission prompt for eligible tools.
- stream with `ask_for_approval` keeps existing pause/resume behavior.

### 9.3 Service Tests

Extend existing AI Chat Query Loop and Skill Executor tests:

- auto-approved eligible tool continues the loop without `paused_for_permission`.
- shell still pauses under `approve_for_me`.
- full access shell path still invokes shell validation and rate limiter.
- blocked plan-mode tool stays blocked regardless of mode.

### 9.4 UI Tests

Add or extend component tests:

- selector renders in the bottom panel.
- changing mode calls the renderer API.
- `full_access` confirmation appears.
- active mode updates after conversation switch.
- labels come from i18n keys.

Relevant existing test areas:

- `test/vitest/main/components/AiChatV2.workspace.test.ts`
- `test/vitest/utilitycode/aiChatV2PanelLayout.test.ts`
- `test/vitest/main/components/AiChatV2Message.toolProgress.test.ts`

## 10. Rollout Plan

### Phase 1: Policy And UI Skeleton

- Add type, selector UI, i18n keys, IPC get/set handlers, and persistence.
- Keep runtime behavior unchanged.
- Verify the selector is visible and mode state survives conversation switches.

### Phase 2: Runtime Auto-Approval

- Add main-process policy service.
- Integrate scoped permission override into AI Chat V2 tool execution.
- Add tests for `approve_for_me`.
- Keep shell prompting.

### Phase 3: Full Access

- Add full access confirmation.
- Add full access runtime behavior for shell-category tools.
- Verify shell denylist, rate limit, audit, cancellation, and dependency-install prompts still work.

### Phase 4: Polish And Audit

- Add status badges for auto-approved tools.
- Add settings/reset affordance if needed.
- Review logs and persisted message metadata for support/debugging.

## 11. Open Questions

- Should `approve_for_me` include filesystem write/edit tools, or should filesystem mutation require `full_access`?
- Should mode be persisted per conversation, globally as a user preference, or session-only?
- Should explicit `denied` skill permissions override `full_access`? Recommendation: yes, denied remains denied.
- Should full access downgrade to `approve_for_me` or `ask_for_approval` on app restart? Recommendation: downgrade to `ask_for_approval`.
- Should the selector be hidden when no tools are available, or always shown to teach the user that tool permission mode exists?

## 12. Success Metrics

- Users can complete multi-tool AI chat workflows with fewer manual approval clicks.
- `Ask for approval` behavior remains unchanged by default.
- No auto-approved tool bypasses validation, plan approval, workspace restrictions, shell safeguards, dependency-install approval, or audit logging.
- Tests cover all three modes at policy, IPC, service, and UI levels.
