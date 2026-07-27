# AI Chat V2 Goal and Loop Commands PRD

## Overview

AiFetchly should support `/goal` and `/loop` commands in AI Chat V2 to let users define a durable objective and optionally ask the agent to continue bounded autonomous work toward that objective.

The implementation should reuse the existing AI Chat V2 slash-command, Plan Mode, and query-loop infrastructure rather than placing command semantics directly in `src/views/components/aiChatV2/AiChatV2.vue`.

## Problem

Users can currently chat with the AI assistant, use slash commands, and enter Plan Mode, but there is no explicit product-level concept of:

- a persistent goal for a conversation;
- goal status such as active, complete, blocked, or cancelled;
- bounded repeated execution toward an approved goal;
- safe stop conditions for autonomous continuation.

Without these concepts, users must manually prompt the agent turn by turn, and any attempt to simulate looping behavior risks token waste, unclear state, and unsafe automation.

## Goals

- Add a `/goal` command that captures a user objective and starts the existing planning workflow.
- Add a `/loop` command that continues work toward the active goal with explicit bounds.
- Keep `AiChatV2.vue` as a thin UI and stream orchestration layer.
- Store durable goal state in backend Model/Module layers.
- Reuse `AIChatQueryEngine`, `AIChatQueryLoop`, Plan Mode, and the existing slash-command dispatcher.
- Provide clear stop conditions for safety and predictability.

## Non-Goals

- Do not implement an infinite autonomous agent loop.
- Do not add database access directly to IPC handlers or Vue components.
- Do not create a second planning system parallel to existing Plan Mode.
- Do not bypass existing tool approval, Plan Mode approval, AI enablement, or workspace safety checks.

## User Experience

### `/goal`

Example:

```text
/goal Build a Facebook campaign scraper and verify it works
```

Expected behavior:

1. The command captures the objective as the active goal for the conversation.
2. The chat enters Plan Mode or sends an equivalent Plan Mode prompt.
3. The assistant clarifies requirements when needed.
4. The assistant submits a plan for approval using the existing Plan Mode approval flow.
5. The goal remains associated with the conversation until completed, blocked, or cancelled.

### `/loop`

Example:

```text
/loop 5
```

Expected behavior:

1. The command requires an active goal.
2. The command continues the active goal for at most the specified number of iterations.
3. Each iteration uses the existing AI Chat V2 engine.
4. The loop stops when work is complete, blocked, unsafe, awaiting user input, or the iteration limit is reached.

Recommended MVP syntax:

```text
/loop <maxIterations>
```

Later syntax may support:

```text
/loop until done
/loop 30m
```

## Functional Requirements

### FR-1: Slash command registration

Register `/goal` and `/loop` as built-in slash commands in:

- `src/service/slashCommands/builtinSlashCommands.ts`
- `src/service/slashCommands/SlashCommandDispatcher.ts`

The Vue component should continue to call the existing slash-command dispatch path.

### FR-2: `/goal` command behavior

The `/goal` command must:

- require non-empty objective text;
- create or update active goal state for the conversation;
- trigger Plan Mode;
- submit an expanded prompt through the existing chat stream path or call a backend goal service that does so;
- preserve the user-visible command in chat history.

### FR-3: Goal persistence

Goal state should be persisted using the repository’s three-layer architecture.

Suggested files:

```text
src/entity/AIChatGoal.ts
src/model/AIChatGoal.model.ts
src/modules/AIChatGoalModule.ts
src/service/AIChatGoalLoopService.ts
```

Goal state should include:

- goal ID;
- conversation ID;
- objective;
- status: `active`, `complete`, `blocked`, `cancelled`;
- current iteration count;
- max iteration count for active loop runs;
- latest status message;
- timestamps.

### FR-4: `/loop` command behavior

The `/loop` command must:

- require an active goal;
- require a bounded max iteration count for MVP;
- reject invalid or unsafe bounds;
- run repeated turns through the existing `AIChatQueryEngine`;
- stop on all required stop conditions;
- surface progress in the conversation.

### FR-5: Stop conditions

Loop execution must stop when any of the following happens:

- user presses Stop;
- max iteration count is reached;
- max runtime is reached, if runtime limits are implemented;
- tool permission is required;
- plan approval is required;
- `AskUserQuestion` is emitted;
- an unrecoverable error occurs;
- the same failure repeats enough times to classify the goal as blocked;
- the assistant marks the goal complete;
- the active conversation changes or is unavailable.

### FR-6: Frontend display

`AiChatV2.vue` may add UI for:

- active goal badge;
- loop running status;
- loop iteration count;
- loop stopped/completed/blocked message.

However, command semantics and persistence must remain outside the Vue component.

### FR-7: Internationalization

Any new user-facing UI text must be added to all supported language files:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

## Technical Design Guidance

### Keep `AiChatV2.vue` thin

The current component already dispatches slash commands before normal streaming. Preserve that design.

The component should not:

- parse `/goal` or `/loop` directly beyond existing slash-command routing;
- own durable loop state;
- directly call database APIs;
- implement autonomous execution logic.

### Reuse Plan Mode

`/goal` should reuse the existing Plan Mode stack:

- `EnterPlanMode`;
- `AskUserQuestion`;
- `SubmitPlanForApproval`;
- plan approval/rejection/change-request UI;
- plan tool policy.

This avoids duplicate planning state and preserves existing safety boundaries.

### Reuse AIChatQueryLoop

`/loop` should orchestrate repeated calls to existing AI Chat V2 services, not create another model/tool loop.

The loop service should repeatedly send a continuation prompt similar to:

```text
Continue working toward the active goal. Report whether the goal is complete, blocked, or requires user input.
```

The backend should inspect emitted events/results to decide whether to continue or stop.

### Avoid protocol changes for MVP

For MVP, prefer implementing `/goal` as slash-command expansion into a Plan Mode prompt and `/loop` as a backend local command/service.

Only extend `ChatV2StreamRequest` later if necessary, for example:

```ts
goalId?: string;
loopPolicy?: {
  enabled: boolean;
  maxIterations: number;
  stopOnApprovalRequired: boolean;
  stopOnError: boolean;
};
```

## Safety Requirements

- AI enablement checks must remain in the AI Chat V2 IPC stream handler before request parsing.
- Tool approval mode must continue to apply.
- Plan Mode must continue blocking high-impact tools until approval.
- Workspace and file-tool safety boundaries must continue to apply.
- The loop must be cancellable.
- The loop must never be unbounded.
- Repeated failure must become `blocked`, not infinite retry.

## Suggested Implementation Order

1. Add `/goal` and `/loop` built-in command definitions.
2. Implement `/goal` as a prompt command that enters Plan Mode.
3. Add goal persistence through Entity, Model, and Module layers.
4. Add `/loop <maxIterations>` validation and local command handling.
5. Implement `AIChatGoalLoopService` using existing `AIChatQueryEngine`.
6. Add UI indicators for active goal and loop progress.
7. Add tests for command dispatch, goal persistence, loop stop conditions, and cancellation.
8. Update all translation files for new UI text.

## Acceptance Criteria

- Typing `/goal <objective>` creates or updates an active conversation goal.
- `/goal <objective>` starts the existing Plan Mode workflow.
- Typing `/loop 5` with an active goal performs at most five continuation iterations.
- `/loop` refuses to run without an active goal.
- `/loop` refuses unbounded or invalid iteration counts.
- Loop execution stops on permission prompts, plan approval, user questions, errors, cancellation, completion, and blocked state.
- `AiChatV2.vue` remains a UI/stream orchestration layer and does not contain database or loop orchestration logic.
- Database access follows Entity → Model → Module architecture.
- New user-facing UI text has translations in all supported language files.

## Open Questions

- Should `/goal` replace the current active goal or require explicit confirmation when one is already active?
- Should `/loop` continue only approved plans, or should it also help refine draft plans?
- What is the maximum allowed iteration count for MVP?
- Should loop runs be visible in the existing Agent Task List dialog?
- Should goal completion be model-declared, user-confirmed, or both?
