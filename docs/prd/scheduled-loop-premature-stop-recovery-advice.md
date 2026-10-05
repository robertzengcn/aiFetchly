# Scheduled-Loop Premature `finish_reason=stop` Recovery — Fix Recommendation

> Status: **Analysis + recommendation. No code changed.**
> Date: 2026-09-27
> Related: `docs/prd/ai-chat-goal-loop-technical-design.md`, `docs/prd/ai-chat-query-engine-prd.md`

## 1. Problem (recap)

Scheduled AI loops (`source: scheduled-loop`, model `agnes-3.0-flash`) end the turn with
`finish_reason: "stop"` and `tool_calls: null` while the model clearly intended to keep
working — content trails off mid-intent (e.g. "Let me try the direct tool name approach:").
The user's requirement stays unsolved because the client treats `stop` as terminal.

## 2. Root cause (two compounding layers)

### Layer 1 — the upstream model genuinely emits `stop`; the server faithfully forwards it

The server (`aifetchserver`) is a **faithful proxy**, not an inventor of `stop`:

- `api/openai_compatible.py:3388-3442` — streaming passthrough forwards every raw upstream
  chunk **verbatim** (`yield raw_chunk`). It does not rewrite `finish_reason`.
- `api/openai_compatible.py:3432-3434` — only *records* `last_finish_reason` from upstream.
- `api/openai_compatible.py:3444-3449` — the **only** place the server invents a
  `finish_reason` is when the upstream stream ended **without any terminal chunk**
  (`forwarded_terminal_chunk == False`). Even then it infers `"tool_calls"` if tool-call
  deltas were seen, else `"stop"`. Fallback for malformed upstreams, not the active path here.
- `api/openai_compatible.py:2815` — the `_STREAM_FINISH_REASONS` whitelist clamps
  **unknown** values to `"stop"`; `"stop"` itself passes through unchanged.
- Non-streaming path (`llm_base.py:444-473`, `openai_adapter.py:296`) —
  `finish_reason=sdk_choice.finish_reason`, faithful passthrough, defaulting to `"stop"`
  only when upstream returned `None`.

The `"model": "auto"` in the failing example confirms `agnes-3.0-flash` is served through
an **aggregator/gateway** (`_normalize_model_name` at `openai_compatible.py:546-550` treats
`"auto"` as "omit model"; the echoed `"model":"auto"` is the gateway parroting the request).
That gateway's underlying model is the one emitting the premature `stop`. **The server is
not the defect.**

### Layer 2 — the client's recovery for "stop-with-text-after-tools" is gated off for scheduled loops

The client (`aiFetchly`) has the right recovery for this symptom — `goalTextStop`
(`AIChatQueryLoop.ts:1975-2019`):

```ts
const goalTextStop =
  input.goalAutoContinue === true &&   // <-- the gate
  !planContext &&
  executedToolRound &&
  lastFailedTool === null &&
  accumulator.state.fullContent.trim().length > 0;
```

It nudges the model back to work with `GOAL_TEXT_STOP_CONTINUATION_PROMPT` — but **only when
`input.goalAutoContinue === true`**.

`goalAutoContinue` is resolved in `AIChatQueryEngine.shouldAutoContinueGoal`
(`AIChatQueryEngine.ts:360-374`):

```ts
const goal = await new AIChatGoalModule().getActiveGoal(conversationId);
return goal !== null;
```

Returns `true` **only if an active goal record exists** for the conversation. Goals are
created **exclusively** from the interactive `/goal` flow in `AiChatV2.vue`
(`createGoal` at line 4035, `startGoalLoop` at line 1588). `ScheduledAiMessageRunner.ts`
has **zero** references to `createGoal`, `startGoalLoop`, `AIChatGoalModule`, or
`goalAutoContinue`. The scheduled runner dispatches through `AIChatQueryEngine.submitMessage`
(`ScheduledAiMessageRunner.ts:463, 916`), so it hits `shouldAutoContinueGoal`, resolves
`goalAutoContinue=false`, and the `goalTextStop` branch is dead code for every
scheduled-loop turn.

The remaining recovery layer, `emptyAfterTools` (`AIChatQueryLoop.ts:1909-1964`), only fires
when `fullContent.trim().length === 0` — i.e. a *truly empty* stop. The failing case has
**text**, so `emptyAfterTools` does not fire either.

**Net effect:** model emits a premature `stop` with non-empty text and no tool_calls → no
recovery layer matches → turn ends → requirement left unsolved.

### Why earlier rows recovered

Rows 4741 and 4763 in the pasted history showed `finishReason:"stop"` but the conversation
*continued*. Those either had empty content (triggering `emptyAfterTools`) or were interactive
turns with an active goal (triggering `goalTextStop`). The failing row is the specific
combination: **scheduled-loop + non-empty text + no tool_calls** — the one shape no recovery
layer covers.

## 3. `goalAutoContinue` behavioral surface (verified — only 2 consumers)

This matters because it bounds the fix:

1. **`goalTextStop` gate** (`AIChatQueryLoop.ts:1975`) — the recovery nudge for "stop with
   text, no tool_calls, after tools ran." *This is the bug.*
2. **Round-cap prompt selection** (`AIChatQueryLoop.ts:1343`) — picks
   `GOAL_TOOL_ROUND_CAP_CONTINUATION_PROMPT` vs `TOOL_ROUND_CAP_CONTINUATION_PROMPT` when the
   per-cycle tool cap is hit. The two prompts are nearly identical ("goal is not finished"
   vs "task is not finished"). For a scheduled loop, the "task" variant is arguably more
   accurate anyway.

So the fix does not need to touch the round-cap branch — leaving it on the non-goal prompt is
fine for scheduled loops. Only the `goalTextStop` gate needs to broaden.

## 4. The two real options

- **Option A — Broaden the `goalTextStop` gate so scheduled loops also recover.**
  Localized to `AIChatQueryLoop.ts`.
- **Option B — Have `ScheduledAiMessageRunner` create an ephemeral goal so the existing
  `goalAutoContinue` path engages.** Touches goal lifecycle.

## 5. Recommendation: Option A (minimal version)

### Why A over B

B (ephemeral goal) sounds "clean" because it reuses the existing gate, but it's the wrong
kind of clean. Goals carry real accounting — status transitions
(`AIChatGoalModule.transitionGoalStatus` enforces a legal-transition state machine at
line 152-174), `iterationCount`, `latestVerdict`, `terminalReason`,
`sourceRevisionFingerprint`, `loopLimits`. Dropping an ephemeral goal record into a
scheduled-loop turn means either (a) faking all that accounting and risking the state
machine rejecting transitions, or (b) polluting the goals table with rows that have no real
objective/criteria. The goal system is a *user-facing feature* (`/goal`,
`AiChatV2.vue:4035`), not a recovery primitive. Using it as a backdoor flag for
scheduled-loop recovery couples two unrelated concerns and creates a new failure surface
(goal-lookup errors, stale active goals blocking real `/goal` use).

A is a ~5-line change to one predicate. B is a multi-file change to a stateful lifecycle.

### Why minimal A

Change the `goalTextStop` predicate from `goalAutoContinue === true` to
`goalAutoContinue === true || scheduledContext !== undefined` — i.e. "either there's an
active goal, OR this is a scheduled-loop turn." A scheduled loop is, by definition, an
autonomous task that should keep working past a premature text-only stop — exactly the
symptom `goalTextStop` was built for. The `scheduledContext` is already in scope at every
`goalAutoContinue` resolution site (`AIChatQueryEngine.ts:849`, destructured from `input`),
so plumbing it into `loopInput` is trivial.

The continuation budget (`MAX_GOAL_TEXT_STOP_CONTINUATIONS = 3`) and the
reset-on-productive-round behavior already exist and are well-reasoned (the comment at
`AIChatQueryLoop.ts:1261-1272` explicitly bounds the stall risk via the tool-round cap +
round-cap continuation budget). Reusing that budget for scheduled loops inherits all those
guarantees for free — a stalled scheduled loop still terminates via the existing backstops.

### Why A is safe for the interactive `/goal` path

Broadening a `||` only adds behavior for scheduled loops; the existing
`goalAutoContinue === true` branch is untouched. No regression risk to the `/goal` feature.

## 6. The one thing to watch (both options share this)

The `GOAL_TEXT_STOP_CONTINUATION_PROMPT` says *"Do not stop until the goal's completion
conditions are met."* For a scheduled loop there's no formal "goal" with completion
conditions — the turn ends when the model stops calling tools. The prompt should either be
generalized, or a separate `SCHEDULED_TEXT_STOP_CONTINUATION_PROMPT` added. The existing
prompt mostly works (it says "call the next tool"), but the phrase "goal's completion
conditions" is slightly misleading for scheduled loops. **This is a one-line copy with
adjusted wording, not a structural change.** Add the separate prompt constant — keeps the
`/goal` wording stable.

## 7. Concrete change preview

```ts
// AIChatQueryLoop.ts — the gate (line ~1975)
const goalTextStop =
  (input.goalAutoContinue === true || input.scheduledContext !== undefined) &&
  !planContext &&
  executedToolRound &&
  lastFailedTool === null &&
  accumulator.state.fullContent.trim().length > 0;

// the prompt selection (line ~2003)
content: input.goalAutoContinue
  ? GOAL_TEXT_STOP_CONTINUATION_PROMPT
  : SCHEDULED_TEXT_STOP_CONTINUATION_PROMPT,
```

Plus:

1. Add `scheduledContext?: AIChatScheduledTurnContext` to the `loopInput` shape and thread
   it from `AIChatQueryEngine.ts` (the value is already destructured at line 849; just add
   it to the 4 `loopInput` literals at lines 1393, 1690, 1841, 1999).
2. Add the `SCHEDULED_TEXT_STOP_CONTINUATION_PROMPT` constant near line 163.
3. Log/recovery-status label: the `console.log` at line 2015 and the `recovery_status` event
   at line 2005 already say "goal text stop" — generalize the message to "text stop after
   tools" so logs don't lie for scheduled loops.

## 8. Tests required (per CLAUDE.md UI/rule + TDD)

- New/extended test in `test/vitest/main/` for the query loop, asserting: scheduled-loop
  turn with text-only stop after tools → recovery fires within budget → turn continues.
- Existing `goalTextStop` tests (if any) must stay green for the `goalAutoContinue` path.
- `yarn testmain` must pass clean (the vitest `tsc --noEmit` gate runs at startup).

## 9. Honest limitations of this fix

- It treats the **symptom on the client**. The **upstream model** (`agnes-3.0-flash` behind
  the `auto`-echoing gateway) is the actual emitter of premature `stop`. If possible, also
  investigate on the aggregator side whether `max_tokens` / output-token budget is cutting
  the generation short (a `length`→`stop` clamp would look exactly like this) or whether the
  model genuinely thinks it's done. The client fix makes aiFetchly resilient; it doesn't
  make the model better.
- It adds up to 3 extra LLM round-trips per scheduled-loop turn when the model text-stops.
  Bounded and rare, but real cost.

## 10. Evidence index

| Claim | Location |
|---|---|
| Server forwards raw chunks verbatim | `aifetchserver/api/openai_compatible.py:3442` |
| Server only invents stop when no terminal chunk | `aifetchserver/api/openai_compatible.py:3444-3449` |
| Whitelist clamps unknown→stop, not stop→stop | `aifetchserver/api/openai_compatible.py:2779-2815` |
| `"auto"` treated as omitted model (gateway echo) | `aifetchserver/api/openai_compatible.py:546-550` |
| `goalTextStop` gated on `goalAutoContinue===true` | `aiFetchly/src/service/AIChatQueryLoop.ts:1975-1980` |
| `goalAutoContinue` requires active goal record | `aiFetchly/src/service/AIChatQueryEngine.ts:360-374` |
| Goals created only in interactive `/goal` UI | `aiFetchly/src/views/components/aiChatV2/AiChatV2.vue:4035, 1588` |
| Scheduled runner never touches goals | `aiFetchly/src/service/ScheduledAiMessageRunner.ts` (zero matches) |
| Scheduled runner dispatches via engine | `aiFetchly/src/service/ScheduledAiMessageRunner.ts:463, 916` |
| `emptyAfterTools` requires empty content | `aiFetchly/src/service/AIChatQueryLoop.ts:1909-1912` |
| `goalAutoContinue` has only 2 consumers in loop | `aiFetchly/src/service/AIChatQueryLoop.ts:1343, 1976` |
| `scheduledContext` in scope at engine | `aiFetchly/src/service/AIChatQueryEngine.ts:849` |

## 11. Net

Option A, minimal version — broaden the `goalTextStop` gate with
`|| scheduledContext !== undefined`, add a scheduled-specific prompt, thread
`scheduledContext` into `loopInput`. ~5 lines of logic + 1 prompt constant + 1 type field.
Low blast radius, no goal-lifecycle coupling, inherits the existing stall backstops.
