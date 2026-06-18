# Feature Specification: AI Chat Auto Plan Mode Entry

**Feature Branch**: `openai-chat-v2` (worktree)
**Created**: 2026-06-18
**Status**: Approved
**Input**: User description: "Currently the agent in AI chat cannot auto enter plan mode. Update it so the agent can auto enter plan mode when it encounters a complex or multi-step task, but not for simple tasks. Reference: claude-code/docs/plan-mode.md."

## Overview

aiFetchly's AI Chat v2 already supports Plan Mode (see `specs/001-ai-chat-plan-mode/spec.md`), but it is currently only activated by an explicit UI toggle (`request.mode === "plan"`) or by an existing plan state in the database. The agent itself has no way to escalate a complex task into Plan Mode and no knowledge that Plan Mode exists when running in default chat mode.

This feature adds **model-initiated auto-entry** into Plan Mode, mirroring Claude Code's `EnterPlanMode` tool pattern (`src/tools/EnterPlanModeTool/` in the Claude Code reference). The default chat system prompt is enriched with criteria for when to call the new tool, and a new `EnterPlanMode` tool is registered in chat mode. When the model judges the task is complex or touches high-impact marketing actions, it calls `EnterPlanMode`; the loop silently switches into Plan Mode mid-stream and the model continues with the existing plan-mode workflow (Understand → Explore → Clarify → Design → Submit).

## Goals

- Let the agent autonomously escalate complex or risky tasks into Plan Mode without requiring the user to toggle a UI control.
- Keep simple tasks fast: a one-line lookup or single-shot content generation must never trigger Plan Mode.
- Preserve all existing Plan Mode guarantees (tool gating, approval gate, persistence) once the agent enters Plan Mode.
- Give users a global escape hatch to disable auto-entry if they find it noisy.
- Fit cleanly into the existing `AIChatQueryLoop` round-based architecture without adding new long-running processes.

## Non-Goals

- This feature does not add a heuristic pre-classifier of message complexity.
- This feature does not add an `ExitPlanMode` escape-hatch tool. Once in Plan Mode, the model uses the existing `SubmitPlanForApproval` workflow.
- This feature does not change the per-conversation UI toggle for Plan Mode; the toggle remains the explicit path.
- This feature does not extend Plan Mode to non-interactive flows (scheduled AI tasks). The interactive chat session remains the only surface.
- This feature does not add A/B testing or analytics infrastructure.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Trigger mechanism | Model-initiated `EnterPlanMode` tool call |
| Transition UX | Silent switch with Plan Mode indicator; no approval dialog for the mode switch itself |
| Trigger stance | Aggressive, marketing-domain adapted (mirror Claude Code's external-user prompt) |
| Plan-mode termination | Keep existing 2-tool gate: `AskUserQuestion` + `SubmitPlanForApproval` |
| User control | Global setting `USER_AI_AUTO_PLAN = 'true' \| 'false'`, default `'true'` |
| Mid-stream switch mechanics | Tool-result-driven transition with mid-transcript `system` role reminder (Approach A) |

## Architecture

### Approach: Tool-driven transition with mid-transcript system reminder

The `EnterPlanMode` tool call is handled inside `AIChatQueryLoop`'s tool dispatcher. On call, the loop:

1. Persists plan state via `AIChatPlanModule.ensurePlanForConversation()` (idempotent).
2. Mutates its in-flight state: marks the turn as plan-mode-active, swaps the tool registry for subsequent rounds to include `AskUserQuestion` and `SubmitPlanForApproval`, and emits a `plan_state` stream event so the UI lights up its indicator.
3. Appends a `system`-role message to the transcript with the plan-mode workflow reminder and current plan state block.
4. Returns a tool result to the model describing the transition and the next steps.

The next LLM round runs against the same `messages` array (now containing the system reminder) with plan tools available.

**Why a system message and not a rewritten top-of-transcript system prompt?** The top-of-transcript system prompt is built once by `AIChatContextAssembler` before the loop starts. Mutating it mid-run would require re-assembling the entire context (memory, session, history). A mid-transcript `system` role message achieves the same behavioral override and is exactly the pattern Claude Code uses (`src/utils/messages.ts:3207` in the reference doc). The OpenAI Chat Completions API permits `role: "system"` messages anywhere in the messages array.

### Components & Touchpoints

**New files:**

- `src/service/EnterPlanModeTool.ts` — defines the `EnterPlanMode` `ToolFunction` and the executor function that creates plan state. Pure module-level code; delegates DB work to `AIChatPlanModule`.
- `src/service/ChatModePromptSection.ts` — builds the auto-plan-awareness block appended to the default chat system prompt when auto-entry is enabled.

**Modified files:**

- `src/config/usersetting.ts` — add `USER_AI_AUTO_PLAN` token constant alongside the existing `USER_AI_ENABLED`.
- `src/modules/AIChatV2Module.ts` — replace the literal `V2_DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant."` with a `getDefaultSystemPrompt()` method that appends the auto-plan section when `Token.getValue(USER_AI_AUTO_PLAN) === 'true'`.
- `src/service/AIChatQueryEngine.ts` — register `EnterPlanMode` in chat mode when auto-plan is enabled; pass a `loopContext` callback so the loop can mutate the tool set after an `EnterPlanMode` call.
- `src/service/AIChatQueryLoop.ts` — add `EnterPlanMode` dispatch handling in the tool-execution phase: persist plan state, swap tools, inject system reminder, emit `plan_state` event.
- `src/service/PlanModeToolPolicy.ts` — add `EnterPlanMode` to `PLAN_TOOL_NAMES` so it is always permitted when registered, and treat it as a `plan_tool` category.
- `src/main-process/communication/ai-chat-v2-ipc.ts` (and any AI IPC handler that touches the v2 stream) — enforce the AI-enable check before resolving `EnterPlanMode` calls; gate tool registration on `USER_AI_AUTO_PLAN`.
- `src/views/components/aiChatV2/AiChatV2.vue` (or existing plan indicator host) — wire the existing `plan_state` stream event to the existing Plan Mode indicator so it lights up mid-turn. (No new component; the indicator already exists from `001-ai-chat-plan-mode`.)

## EnterPlanMode Tool Definition

```typescript
{
  type: "function",
  name: "EnterPlanMode",
  description:
    "Transition this conversation into Plan Mode when the user's request is " +
    "complex, multi-step, or touches high-impact marketing actions. Plan Mode " +
    "lets you clarify requirements, design a structured plan, and get user " +
    "approval BEFORE executing actions like sending emails, posting to social " +
    "platforms, modifying campaigns, scraping at scale, or automating accounts. " +
    "Do NOT call this for: simple lookups, single-shot Q&A, one-line asset " +
    "generation, or reading existing data. The switch is silent — the user " +
    "will see a Plan Mode indicator. After calling, immediately begin the " +
    "plan-mode workflow (Understand, Explore, Clarify, Design, Submit).",
  parameters: {
    type: "object",
    properties: {
      rationale: {
        type: "string",
        description:
          "One sentence explaining why this task warrants planning. May be shown to the user."
      },
      objective: {
        type: "string",
        description: "Restated objective for the plan, <=500 chars.",
        maxLength: 500
      }
    },
    required: ["rationale"]
  }
}
```

### Execution Semantics

| Context | Behavior |
|---|---|
| Auto-plan disabled (`USER_AI_AUTO_PLAN !== 'true'`) | Tool not registered. If somehow invoked, return error tool result. |
| AI disabled (`USER_AI_ENABLED !== 'true'`) | Tool not registered. Existing AI-enable IPC check already gates the stream. |
| Conversation has no plan | Create plan via `AIChatPlanModule.ensurePlanForConversation()`, status `draft`. Emit `plan_state` event. |
| Conversation has an active draft / awaiting_question / awaiting_approval plan | Idempotent — return "already in plan mode" tool result, no new state. Still swap tools and inject reminder. |
| Conversation has an approved plan | Return error: "Plan already approved; cannot re-enter." Stay in chat mode. |
| Conversation has a completed / cancelled / rejected plan | Create a NEW plan (new `planId`) so history is preserved. |
| Malformed args (missing rationale) | Schema validation returns error; loop continues. |

### Tool Result to Model (success)

```
Plan mode is now active for this conversation (planId: <id>).
Continue with the plan-mode workflow:
1. Understand — restate the objective
2. Explore — use read-only tools if needed
3. Clarify — call AskUserQuestion for user-only info
4. Design — produce a structured plan
5. Submit — call SubmitPlanForApproval

A system reminder with the full plan-mode instructions follows.
```

## Mid-Stream Mode Switch Mechanics

When the loop's tool dispatcher observes an `EnterPlanMode` tool call in round N, it performs the following before round N+1:

1. **Persist plan state** via `AIChatPlanModule`. Emit a `plan_state` stream event so the frontend `AiChatV2PlanStatusBadge` lights up immediately.
2. **Swap the tool registry** for subsequent rounds: add `AskUserQuestion` + `SubmitPlanForApproval` to the local `allOpenAITools` array. This is a local mutation of the loop's tool set; it does not affect other concurrent turns.
3. **Inject a system-role reminder** into the messages array:
   ```
   [system] Plan mode is now active. Follow the plan-mode workflow:
   Understand → Explore → Clarify → Design → Submit.
   High-impact tools (email, social posting, campaign mutation, shell,
   filesystem writes, bulk scraping) are BLOCKED until the user approves
   the plan via SubmitPlanForApproval.
   Current plan state: <status block from buildPlanStateBlock()>
   ```
4. **Return the tool result** (see above) so the model continues with full context.

### Resume Paths

The existing resume paths in `AIChatQueryEngine` (`resumeToolAfterPermission`, `answerPlanQuestion`) already re-enter the loop with a fresh `loopInput` and already include plan tools when `planContext` is set. No change needed. If a turn is paused mid-transition, the pending state recovers naturally because the plan state is persisted in SQLite before the loop continues; on resume, `getPlanState(conversationId)` returns the active plan and the engine rebuilds `planContext`.

## Default Chat System Prompt Enrichment

Currently the default chat system prompt is the literal `"You are a helpful assistant."`.

When `USER_AI_AUTO_PLAN === 'true'`, `getDefaultSystemPrompt()` appends:

```
# Auto Plan Mode

You have access to an EnterPlanMode tool. Call it when the user's request is
complex or touches high-impact actions. This is an aiFetchly marketing
automation product — Plan Mode is the safest path for anything that could
contact leads, modify campaigns, post to social platforms, schedule
automation, or scrape at scale.

Enter Plan Mode for ANY of:
- Marketing campaign, outreach, or lead generation work
- Email automation, social posting, or scheduled tasks
- Multi-step workflows spanning multiple tools
- Multiple valid approaches to the same goal
- Behavior-affecting changes to campaigns, contacts, or accounts
- Unclear requirements where a wrong guess wastes effort
- Scraping at scale or contact extraction

Do NOT enter Plan Mode for:
- Simple lookups ("how many contacts do I have?")
- Single-shot content generation (one email subject line, one social post)
- Reading or summarizing existing data
- One-line clarifications or factual Q&A
- Tasks the user explicitly asked to do immediately without planning

The switch is silent — the user sees a Plan Mode indicator. After calling
EnterPlanMode, immediately continue with the plan-mode workflow. Do not ask
permission to enter; the tool call IS the entry. If unsure, lean toward
planning: a wasted plan is cheaper than a wrongly-sent email blast.
```

When `USER_AI_AUTO_PLAN !== 'true'` (or unset): no `EnterPlanMode` tool registered, no section appended. The existing explicit UI toggle path (`request.mode === "plan"`) is untouched.

## Edge Cases & Failure Modes

| Case | Handling |
|---|---|
| Model calls `EnterPlanMode` while already in plan mode | Tool not registered in plan mode; if somehow invoked, return error result. |
| Model calls `EnterPlanMode` then immediately `SubmitPlanForApproval` without clarifying | Allowed. The model judged no clarification was needed. |
| Model calls `EnterPlanMode` then keeps chatting without using plan tools | Allowed. The system reminder strongly encourages the workflow. The turn is not force-terminated. |
| Model calls `EnterPlanMode` with malformed `rationale` / `objective` | Schema validation error returned as tool result; loop continues. |
| App crashes after plan state created but before system reminder injected | On reload, `getPlanState()` returns the active plan; UI indicator shows; next user message naturally enters plan-mode flow. |
| Model enters plan mode mid-tool-batch (calls `EnterPlanMode` alongside another tool in the same round) | Process the other tool first, then `EnterPlanMode`. Plan tools become available in the NEXT round. |
| User sends a new message while model is mid-plan-transition | Existing abort logic in `submitMessage` cancels the prior `AbortController`. No special handling needed. |
| `USER_AI_AUTO_PLAN` toggled off mid-session | Next `submitMessage` call reads the current token value; tool is not registered and prompt is not enriched until re-enabled. |
| AI access disabled mid-call | Existing AI-enable IPC check fails the stream before the loop starts. |

## Testing Strategy

Following the project's Mocha/Vitest split:

### Unit Tests (Vitest, `test/vitest/main/service/`)

- `EnterPlanModeTool.test.ts` — tool definition, schema validation, idempotency cases (no plan → creates; draft plan → idempotent; approved plan → error; completed plan → new planId).
- `AIChatQueryEngine.auto-plan.test.ts` — full round-trip: model emits `EnterPlanMode` → plan state created → system reminder injected → round 2 has plan tools available → model calls `AskUserQuestion`.
- `PlanModeToolPolicy.test.ts` — `EnterPlanMode` is in `PLAN_TOOL_NAMES`; correctly classified as `plan_tool` category.

### Unit Tests (Mocha, `test/modules/`)

- `AIChatPlanModule.auto-enter.test.ts` — idempotency for existing draft plan; new `planId` for completed plan; rejection when an approved plan already exists.

### IPC Integration Tests (`test/vitest/main/ipc/`)

- `ai-chat-v2-auto-plan.test.ts` — when `USER_AI_AUTO_PLAN === 'false'`, `EnterPlanMode` is not in the tool registry and the default system prompt does not include the auto-plan section; when `=== 'true'`, both are present.

### Coverage Target

80%+ on new code (per project testing rule). Tests must cover the idempotency matrix and the disabled-setting code path.

## Security & Compliance

- `EnterPlanMode` is a pure coordination tool: it does not execute side effects beyond creating SQLite plan state via `AIChatPlanModule`. It does NOT bypass the plan-mode tool gate; it activates it.
- All `EnterPlanMode` IPC paths inherit the existing AI-enable check (`Token.getValue(USER_AI_ENABLED)`).
- The tool result and system reminder are treated as untrusted context by the model — consistent with the existing prompt-injection hardening in `PlanModePromptBuilder.ts:44`.
- No new external API calls, no new filesystem writes, no new shell commands.

## Internationalization

No new user-facing text is introduced by the backend. The only UI surface is the existing Plan Mode indicator (already translated by `001-ai-chat-plan-mode`). If the frontend adds a transient "Entering plan mode…" system bubble using the `rationale` field, that bubble must use `t()` with English fallback and must be translated into all six supported languages (`en`, `zh`, `es`, `fr`, `de`, `ja`). This is deferred to the implementation plan if the frontend work turns out to be more than a one-line reactive update.

## Open Questions (deferred to implementation)

- Should the `rationale` field be rendered as a chat bubble in the v1 UI, or just logged for debugging? Lean: log for v1, render in v2 if users find the silent switch confusing.
- Should we add a per-conversation opt-out toggle in the UI (in addition to the global setting)? Lean: defer until users ask for it.

## Success Criteria

- **SC-001**: When `USER_AI_AUTO_PLAN === 'true'` and the model receives a complex marketing request, the model calls `EnterPlanMode` and the conversation transitions into Plan Mode with a visible indicator in 100% of tested flows.
- **SC-002**: When `USER_AI_AUTO_PLAN === 'true'` and the model receives a simple lookup or single-shot generation request, the model does NOT call `EnterPlanMode` in >=90% of sampled interactions.
- **SC-003**: When `USER_AI_AUTO_PLAN === 'false'`, the `EnterPlanMode` tool is not registered and the default system prompt has no auto-plan section in 100% of tests.
- **SC-004**: After auto-entry, all existing Plan Mode guarantees (tool gating, AskUserQuestion, SubmitPlanForApproval, persistence across restart) continue to hold in 100% of tests.
- **SC-005**: An already-approved plan rejects `EnterPlanMode` calls in 100% of tests.
- **SC-006**: New code has >=80% test coverage.

## Dependencies

- Existing `AIChatPlanModule` and the plan entities from `001-ai-chat-plan-mode`.
- Existing `AIChatQueryLoop` round-based architecture.
- Existing `PlanModeToolRegistry`, `PlanModePromptBuilder`, `PlanModeToolPolicy`.
- Existing `Token` service in `src/config/usersetting.ts`.
- Existing Vue chat components from `001-ai-chat-plan-mode` (no new components required).

## Reference

- Claude Code plan-mode documentation: `claude-code/docs/plan-mode.md` (reference architecture).
- Existing Plan Mode spec: `specs/001-ai-chat-plan-mode/spec.md`.
- Existing Plan Mode technical design: `specs/001-ai-chat-plan-mode/technical-design.md`.
- Existing Plan Mode implementation plan: `docs/superpowers/plans/2026-06-14-ai-chat-plan-mode.md`.
