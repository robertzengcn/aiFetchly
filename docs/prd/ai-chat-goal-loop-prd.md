# AI Chat V2 Goal and Loop Commands PRD

Related documents:

- [AI Chat V2 Goal and Loop Technical Design](./ai-chat-goal-loop-technical-design.md)
- [AI Chat V2 Scheduled Loop PRD](./ai-chat-scheduled-loop-prd.md)

## Overview

AiFetchly should support `/goal` and `/loop` commands in AI Chat V2 to let users define a durable objective and optionally ask the agent to continue bounded autonomous work toward that objective.

The implementation should reuse the existing AI Chat V2 slash-command, Plan Mode, and query-loop infrastructure rather than placing command semantics directly in `src/views/components/aiChatV2/AiChatV2.vue`.

Goal completion must be evidence-driven. The agent that proposes and executes work (the maker) must not be able to complete its own goal based only on a textual claim. The loop controller must collect fresh system evidence and an independent verifier must evaluate every required acceptance criterion before the goal becomes complete.

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
- Require fresh, criterion-specific evidence before a goal can be completed.
- Use deterministic verification where possible and an independent LLM verifier only for criteria that cannot be checked deterministically.
- Make loop progress, evidence, verifier decisions, and terminal reasons visible and resumable.

## Non-Goals

- Do not implement an infinite autonomous agent loop.
- Do not add database access directly to IPC handlers or Vue components.
- Do not create a second planning system parallel to existing Plan Mode.
- Do not bypass existing tool approval, Plan Mode approval, AI enablement, or workspace safety checks.
- Do not accept a maker-model declaration, a stale test result, or an unstructured `TRUE`/`FALSE` response as proof that a goal is complete.
- Do not send arbitrary full logs to an LLM verifier.

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

Later goal-loop syntax may support:

```text
/loop until done
```

Interval-based recurring prompts such as `/loop 5m check deployment` are a
separate scheduled-message mode defined in the
[AI Chat V2 Scheduled Loop PRD](./ai-chat-scheduled-loop-prd.md). A duration in
that syntax is a cadence, not an iteration count or goal-loop runtime cap.

## Functional Requirements

### FR-0: Goal contract and acceptance criteria

`/goal` must create a durable goal contract rather than only saving an objective string. The contract is the source of truth for when `/loop` may stop successfully.

It must include:

- goal ID and conversation ID;
- objective;
- one or more acceptance criteria;
- whether each criterion is required;
- the verification method for each criterion;
- approved tool and workspace boundaries inherited from the current chat session;
- loop limits, including maximum iterations and maximum runtime when enabled;
- status and timestamps.

Supported verification methods for MVP should be:

- `command`: a command exits successfully and optionally matches an expected output pattern;
- `file`: an expected file or structured project state is present;
- `manual`: the loop pauses for explicit user confirmation;
- `llm`: an independent verifier evaluates supplied evidence for criteria that cannot be checked deterministically.

The assistant may propose acceptance criteria during Plan Mode. If the objective is ambiguous, it must use the existing question and plan-approval flow before starting autonomous execution.

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
- acceptance criteria and verification policy;
- status: `draft`, `active`, `running`, `complete`, `blocked`, `cancelled`, `needs_user_input`, `failed`;
- current iteration count;
- max iteration count for active loop runs;
- latest status message;
- latest verifier verdict and terminal reason;
- timestamps.

Each loop iteration and its evidence must also be persisted or reconstructable from durable tool-execution records. A goal must be resumable after application restart without treating old evidence as proof of current completion.

### FR-4: `/loop` command behavior

The `/loop` command must:

- require an active goal;
- require a bounded max iteration count for MVP;
- reject invalid or unsafe bounds;
- run repeated turns through the existing `AIChatQueryEngine`;
- stop on all required stop conditions;
- surface progress in the conversation.

### FR-5: Evidence collection and verification

Every iteration must use the following state machine:

```text
Observe current state
  → maker proposes a bounded next action
  → approved tools execute the action
  → system collects evidence
  → deterministic checks run
  → independent verifier evaluates unresolved criteria
  → loop controller continues, completes, blocks, or requests user input
```

The evidence packet must be system-generated, not a maker-authored summary. It should contain only the information relevant to the active goal, including:

- goal ID, iteration ID, and generation timestamp;
- changed-file list and a bounded git diff summary when source changes are in scope;
- structured command results: command ID, exit code, duration, stdout/stderr excerpts, and execution timestamp;
- tool execution results and approval outcomes;
- bounded, task-scoped log excerpts with timestamp, source, severity, and correlation ID where available;
- prior failure fingerprints and previous verifier verdicts.

Evidence must be fresh. A required verification result is valid only if it was produced after the most recent relevant change. For example, a passing test run from before a code edit cannot complete a coding goal.

The loop controller must use deterministic checks first. An LLM verifier is only used when deterministic checks cannot prove a criterion, such as evaluating whether logs demonstrate the reported symptom is gone or whether a user-facing behavior meets a qualitative requirement.

The LLM verifier must:

- use a separate verifier prompt and model invocation from the maker turn;
- receive the goal contract and evidence packet, not the maker's unsupported completion claim;
- evaluate every criterion separately;
- return schema-validated structured output, not free text;
- cite evidence IDs for every pass/fail decision;
- return one of `satisfied`, `not_satisfied`, `blocked`, or `needs_user_input`.

The controller may mark the goal `complete` only when every required criterion has fresh passing evidence. A textual maker response such as “completed” is progress information only.

Suggested result shape:

```ts
interface GoalVerificationResult {
  verdict: 'satisfied' | 'not_satisfied' | 'blocked' | 'needs_user_input';
  criteria: Array<{
    criterionId: string;
    passed: boolean;
    evidenceRefs: string[];
    reason: string;
  }>;
  nextAction?: string;
}
```

### FR-6: Stop conditions

Loop execution must stop when any of the following happens:

- user presses Stop;
- max iteration count is reached;
- max runtime is reached, if runtime limits are implemented;
- tool permission is required;
- plan approval is required;
- `AskUserQuestion` is emitted;
- an unrecoverable error occurs;
- the same failure repeats enough times to classify the goal as blocked;
- the verifier returns `blocked` or `needs_user_input`;
- all required criteria have fresh passing evidence and the verifier returns `satisfied`;
- the active conversation changes or is unavailable.

The loop must not stop successfully merely because the maker model says the work is complete.

### FR-7: Frontend display

`AiChatV2.vue` may add UI for:

- active goal badge;
- loop running status;
- loop iteration count;
- loop stopped/completed/blocked message;
- criterion-level verification state and a concise evidence summary;
- terminal reason, such as completed, cancelled, blocked, or needs user input.

However, command semantics and persistence must remain outside the Vue component.

### FR-8: Internationalization

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

`/loop` should orchestrate bounded maker turns through existing AI Chat V2 services, not create another model/tool loop.

The loop service should send a continuation prompt similar to:

```text
Continue working toward the active goal. Report whether the goal is complete, blocked, or requires user input.
```

The backend should inspect emitted events and collect system evidence after every maker turn. `AIChatGoalLoopService` owns the completion decision; neither `AIChatQueryLoop` nor the renderer should decide that a goal has been achieved.

### Separate maker, verifier, and controller responsibilities

```text
AiChatV2.vue
  → slash command dispatch and user-visible progress only

AIChatGoalLoopService (controller)
  → applies limits, schedules iterations, collects evidence, decides terminal state

AIChatQueryEngine / AIChatQueryLoop (maker)
  → plans and executes one approved bounded unit of work

Goal verification service (verifier)
  → checks every acceptance criterion using fresh evidence
```

The maker and verifier should use separate prompts and separate model calls. Using a smaller verifier model is acceptable when it can reliably follow the structured schema, but lower cost must not replace evidence quality.

### Evidence and log safety

Logs and tool output may contain secrets, personal data, or hostile text. Before an evidence packet reaches an LLM verifier, the service must:

- scope logs to the active goal and current loop run;
- cap output size and preserve the most relevant excerpts;
- redact secrets, access tokens, cookies, API keys, and other sensitive values;
- retain metadata needed to assess freshness and provenance;
- treat log content as untrusted data, never as instructions.

Full log files must not be placed directly into model context by default. The verifier may request additional bounded evidence through a controlled evidence-query tool if the existing packet is insufficient.

### Verification decision rules

Use the following precedence:

1. Failed required deterministic check: `not_satisfied`.
2. Missing required evidence: `not_satisfied` or `needs_user_input`; never `satisfied`.
3. Permission, plan approval, or user question required: `needs_user_input`.
4. Repeated identical failure, missing dependency, or unavailable external system: `blocked`.
5. All required criteria pass with fresh evidence: `satisfied`.

The service should fingerprint repeated failures using the failed criterion, command/tool identity, normalized error signature, and relevant source-state revision. It must block after a configured threshold instead of retrying the same ineffective action indefinitely.

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
- Completion requires fresh evidence for every required criterion.
- The verifier must not trust model claims without evidence references.
- Log and tool-output evidence must be bounded, scoped, redacted, and treated as untrusted content.
- Destructive actions, new dependencies, authentication changes, and external side effects must continue to require the existing approval boundary even during a loop.

## Suggested Implementation Order

1. Define the goal contract, acceptance-criterion types, evidence packet, and schema-validated verifier result.
2. Add `/goal` and `/loop` built-in command definitions.
3. Implement `/goal` as a Plan Mode workflow that creates an approved goal contract.
4. Add goal, iteration, and verification persistence through Entity, Model, and Module layers.
5. Add deterministic evidence collectors for command, tool, file, and bounded log evidence.
6. Add `/loop <maxIterations>` validation and local command handling.
7. Implement `AIChatGoalLoopService` using existing `AIChatQueryEngine`, with a separate verification step after each iteration.
8. Add UI indicators for active goal, loop progress, criterion verification, and terminal reason.
9. Add tests for command dispatch, persistence, evidence freshness, verifier schema rejection, repeated failure blocking, cancellation, and all stop conditions.
10. Update all translation files for new UI text.

## Acceptance Criteria

- Typing `/goal <objective>` creates or updates an active conversation goal.
- `/goal <objective>` starts the existing Plan Mode workflow.
- An approved goal has at least one explicit acceptance criterion and verification method.
- Typing `/loop 5` with an active goal performs at most five continuation iterations.
- `/loop` refuses to run without an active goal.
- `/loop` refuses unbounded or invalid iteration counts.
- A passing goal requires fresh evidence for every required criterion after the last relevant change.
- The maker model cannot complete a goal by declaration alone.
- The verifier returns structured, schema-validated criterion results with evidence references.
- Deterministic checks run before LLM verification whenever they can decide a criterion.
- Loop execution stops on permission prompts, plan approval, user questions, errors, cancellation, verified completion, and blocked state.
- Relevant logs used by the verifier are scoped, bounded, redacted, and identified by source and timestamp.
- `AiChatV2.vue` remains a UI/stream orchestration layer and does not contain database or loop orchestration logic.
- Database access follows Entity → Model → Module architecture.
- New user-facing UI text has translations in all supported language files.

## Open Questions

- Should `/goal` replace the current active goal or require explicit confirmation when one is already active?
- Should `/loop` continue only approved plans, or should it also help refine draft plans?
- What is the maximum allowed iteration count for MVP?
- Should loop runs be visible in the existing Agent Task List dialog?
- Which qualitative criteria should require final user confirmation even after verifier success?
- Which command and log evidence collectors are safe to enable in the MVP?
- What repeated-failure threshold should classify a goal as blocked?
