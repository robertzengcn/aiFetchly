# AI Chat V2 — Goal & Loop Commands (`/goal`, `/loop`) Manual Test

| Metadata | Value |
|---|---|
| Version | 1.0 |
| Created | 2026-07-31 |
| Feature | AI Chat V2 Goal & Loop |
| PRD | `docs/prd/ai-chat-goal-loop-prd.md` |
| Technical design | `docs/prd/ai-chat-goal-loop-technical-design.md` |
| Status legend | ✅ wired & manually testable now · ⚠️ needs a QA helper to reach the state · 🧪 covered by automated tests only (not yet wired into the running app) |

## 1. Prerequisites

### 1.1 Environment

- [ ] AiFetchly dev server running (`yarn dev`)
- [ ] Application initialized with `yarn init`
- [ ] Logged in with an AI-enabled account (`USER_AI_ENABLED === 'true'`)
- [ ] AI Chat V2 view open (`src/views/components/aiChatV2/AiChatV2.vue`)
- [ ] At least one conversation created in AI Chat V2
- [ ] Renderer DevTools open for console inspection
- [ ] Browser DevTools for the renderer available to check `window.api` (see §3)

### 1.2 What you are testing

The `/goal` and `/loop` commands give an AI Chat V2 conversation a durable goal
contract and a bounded loop toward it. Key files:

| Layer | File |
|---|---|
| Types | `src/entityTypes/aiChatGoalTypes.ts` |
| Entities | `src/entity/AIChatGoal.entity.ts`, `AIChatGoalRun.entity.ts`, `AIChatGoalEvidence.entity.ts` |
| Models | `src/model/AIChatGoal.model.ts`, `AIChatGoalRun.model.ts`, `AIChatGoalEvidence.model.ts` |
| Module | `src/modules/AIChatGoalModule.ts` |
| IPC | `src/main-process/communication/ai-chat-goal-ipc.ts` |
| Controller | `src/service/aiChatGoal/AIChatGoalLoopService.ts` |
| Evidence & verification | `src/service/aiChatGoal/GoalEvidenceCollector.ts`, `GoalVerificationService.ts`, `GoalLlmVerifierService.ts`, `GitGoalRevisionProvider.ts`, `goalRedaction.ts` |
| Renderer | `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/utils/aiGoalCommand.ts`, `src/views/api/aiChatGoal.ts` |

## 2. Implementation status map — read this first

The PRD is implemented in layers. Some layers are fully wired into the running
app; the loop *controller and verifier* are built and unit-tested but are **not
yet called from the main-process IPC path**. This table tells you which manual
tests you can run today and which are gated.

| PRD requirement | Status | Where to verify |
|---|---|---|
| `/goal <objective>` creates a durable goal | ✅ | Manual §4 |
| `/goal` enters Plan Mode + submits plan prompt | ✅ | Manual §4.4 |
| Goal persisted across restart | ✅ | Manual §5.1 |
| One active goal per conversation, replace rule | ✅ | Manual §4.7 |
| `/loop` validates bounds and requires an active goal | ✅ | Manual §6 |
| `/loop` creates a run and sets goal to `running` | ⚠️ | Manual §6.7 (needs §3 helper) |
| Stop → goal `cancelled` | ⚠️ | Manual §7 |
| AI-enable gate on every goal/loop IPC handler | ✅ | Manual §8 |
| i18n for goal/loop UI strings | ✅ | Manual §9 |
| Plan approval promotes goal `draft → active` (design §4.4) | ❌ not wired | see §10.1 known gap |
| Bounded iteration engine (`AIChatGoalLoopService`) | 🧪 | `test/vitest/main/service/AIChatGoalLoopService.test.ts` |
| Deterministic verification (command/file/manual) | 🧪 | `test/vitest/utilitycode/GoalVerificationService.test.ts` |
| Independent LLM verifier + schema validation | 🧪 | `test/vitest/utilitycode/GoalLlmVerifierService.test.ts` |
| Evidence collectors + redaction | 🧪 | `test/vitest/utilitycode/GoalEvidenceCollector.test.ts`, `goalRedaction.test.ts` |
| Source-revision freshness | 🧪 | `test/vitest/utilitycode/GitGoalRevisionProvider.test.ts` |
| `goal_state`/`goal_evidence`/`goal_verification` stream events | 🧪 | types exist; not emitted by production stream yet |

## 3. QA helper: activate a goal for `/loop` tests

The loop engine and the `draft → active` transition on plan approval are not
wired yet, so a freshly-created goal stays `draft` and `/loop` refuses it
(`An active, approved goal is required before starting a loop.`). To manually
test loop **start / running badge / stop**, temporarily promote the goal to
`active` from the main-process DevTools:

1. Start the app with main-process debugging enabled:
   ```
   npx electron-forge start -- --inspect=9229
   ```
   Then open `chrome://inspect` → *Remote Target* → the `aiFetchly` main process.
2. In the main-process console, run:
   ```js
   const { AIChatGoalModule } = require("@/modules/AIChatGoalModule");
   const module = new AIChatGoalModule();
   (async () => {
     const goal = await module.getActiveGoal(/* conversationId */ "CONV_ID");
     console.log(goal && goal.goalId, goal && goal.status);
     if (goal) await module.transitionGoalStatus(goal.goalId, "active");
   })();
   ```
   Replace `CONV_ID` with the active conversation id (available in the renderer
   DevTools: `window.api` is not needed — read it from the conversation history
   dialog or the AI Chat V2 URL/state).

If you cannot attach the main-process debugger, skip §6.7–§7 and rely on the
automated tests in §12; everything else in this document is reachable from the UI.

---

## 4. `/goal` Command — creation and Plan Mode entry

### 4.1 Create a goal (happy path) ✅

1. In AI Chat V2, pick a conversation. Send:

```
/goal Build a Facebook campaign scraper and verify it works
```

**Expected:**
- The typed `/goal …` message stays visible in the chat history.
- The AI switches to Plan Mode and streams a planning prompt that begins with
  "Plan how to accomplish this goal: …".
- A goal badge appears in the header (`mdi-flag`, label `draft`) with the
  objective text.

| Test ID | Action | Expected |
|---|---|---|
| 4.1.1 | Send `/goal <objective>` | Header shows a goal chip with the objective + status label |
| 4.1.2 | Read the badge status | `draft` (default grey/flag chip) |
| 4.1.3 | Look at the streaming prompt | Mode switches to Plan; prompt contains "Plan how to accomplish this goal: <objective>" |
| 4.1.4 | Check chat history | The original `/goal …` line is visible, not rewritten |

### 4.2 Empty objective ✅

| Test ID | Action | Expected |
|---|---|---|
| 4.2.1 | Send `  /goal  ` (no text) | Error shown: "Please provide a goal objective. Usage: /goal <objective>" |
| 4.2.2 | Send ` /goal ` with only whitespace | Same error; no goal created (badge does not appear) |

### 4.3 Case-insensitivity and multi-line objectives ✅

| Test ID | Action | Expected |
|---|---|---|
| 4.3.1 | Send `/GOAL Write a README` | Treated as a goal (case-insensitive) |
| 4.3.2 | Send `/goal  Refactor module A\n then module B` | Objective captures the whole multi-line text |

### 4.4 Plan Mode → approval lifecycle ✅

After 4.1, the assistant runs the existing Plan Mode workflow.

| Test ID | Action | Expected |
|---|---|---|
| 4.4.1 | If ambiguous, model asks questions | Question card (`AskUserQuestion`) renders; answering continues planning |
| 4.4.2 | Model submits a plan | Plan approval card with title, steps, Approve / Request Changes / Reject |
| 4.4.3 | The plan proposes acceptance criteria | Plan body references criteria and how each will be verified (command / file / manual) |
| 4.4.4 | Click **Approve** | Plan → Approved; assistant begins executing the plan |
| 4.4.5 | Click **Reject** or **Request Changes** on a fresh goal | Returns to draft planning; a new plan version is generated |

> **Known gap (see §10.1):** approving the plan does **not** yet promote the
> goal to `active`. The badge will still read `draft` after approval.

### 4.5 Duplicate goal rejection ✅

| Test ID | Action | Expected |
|---|---|---|
| 4.5.1 | Send a second `/goal Different objective` in the **same** conversation while the first is non-terminal | Error: "Could not create the goal." (IPC denies; a module-level "An active goal already exists for this conversation." is logged) |
| 4.5.2 | Check the header | The first goal is still the active badge; no second goal |

### 4.6 Per-conversation isolation ✅

| Test ID | Action | Expected |
|---|---|---|
| 4.6.1 | New conversation (A) → `/goal Goal A` | Badge shows "Goal A" |
| 4.6.2 | New conversation (B) → `/goal Goal B` | Badge shows "Goal B" |
| 4.6.3 | Switch A ↔ B | Each conversation shows only its own goal |

---

## 5. Goal persistence ✅

### 5.1 Survives application restart

| Test ID | Action | Expected |
|---|---|---|
| 5.1.1 | Create a goal (§4.1), then fully quit and relaunch the app | Re-open the same conversation → the goal badge reappears with the same objective and status |
| 5.1.2 | After restart, send `/goal` again in the same conversation | Still rejected as duplicate (goal was not lost) |

### 5.2 Terminal goals free the conversation

| Test ID | Action | Expected |
|---|---|---|
| 5.2.1 | Get a goal into `cancelled` (via §7 if possible, otherwise skip) | A new `/goal …` in that conversation now succeeds |

---

## 6. `/loop` Command — validation and bounds ✅ (start state ⚠️)

### 6.1 No active goal

| Test ID | Action | Expected |
|---|---|---|
| 6.1.1 | In a conversation with **no** goal, send `/loop 5` | Error: "Set a goal first with /goal <objective>." |

### 6.2 Missing / invalid iteration count (frontend validation)

| Test ID | Action | Expected |
|---|---|---|
| 6.2.1 | Send `/loop` (no count) | Error: "Please provide an iteration count." |
| 6.2.2 | Send `/loop 0` | Error: "Iteration count must be between 1 and 10." |
| 6.2.3 | Send `/loop 11` | Error: "Iteration count must be between 1 and 10." |
| 6.2.4 | Send `/loop 100` | Same bounds error (max 10) |
| 6.2.5 | Send `/loop abc` | Not treated as a loop — falls through to the ordinary slash/chat path (no error, no run created) |
| 6.2.6 | Send `/loop 5 extra` | Same as 6.2.5 (trailing text invalidates the parse) |
| 6.2.7 | Send `/loop -1` | Same as 6.2.5 (negative not parsed) |

### 6.3 Requires an approved (active) goal

| Test ID | Action | Expected |
|---|---|---|
| 6.3.1 | After `/goal …` only (goal still `draft`), send `/loop 5` | Error: "Could not start the loop." The main process denies with "An active, approved goal is required before starting a loop." |
| 6.3.2 | Confirm no run was created | `ai_chat_goal_runs` has no new `running` row (see §5.3 for how to inspect) |

### 6.4 Start a loop on an active goal ⚠️ (needs §3 helper)

Use the §3 helper to promote the goal to `active`, then:

| Test ID | Action | Expected |
|---|---|---|
| 6.4.1 | Send `/loop 5` | A run is created; goal transitions to `running`; badge turns primary (`mdi-autorenew`, label `running`) |
| 6.4.2 | Badge actions | A **Stop** button (`mdi-stop`, aria-label "Stop loop") appears next to the badge |
| 6.4.3 | Loop count | Header does not show iteration progress yet (iteration engine not wired; see §10) |
| 6.4.4 | Send `/loop 3` again while running | Second start rejected ("A loop run is already active…"); error "Could not start the loop." |
| 6.4.5 | Direct IPC clamp (renderer console): `window.api.invoke('ai-chat-v2:goal-loop-start', { conversationId, goalId, maxIterations: 99 })` | Succeeds; run is created with `maxIterations` **clamped to 10** |

---

## 7. Stop / cancellation ⚠️ (needs an active/running goal — §3)

| Test ID | Action | Expected |
|---|---|---|
| 7.1 | While the loop badge is `running`, click the badge **Stop** button | Goal transitions to `cancelled`; badge turns grey (`mdi-cancel`, label `cancelled`); the Stop button disappears |
| 7.2 | `ai_chat_goal_runs` after stop | The run row shows `status = cancelled`, `cancelled = true`, `terminalReason = user_stop` |
| 7.3 | Click Stop when no loop is running | No-op: returns `{ cancelled: false }`, nothing changes in the UI |
| 7.4 | After cancellation, send `/goal …` in the same conversation | Allowed again (previous goal is terminal) |

---

## 8. AI enablement gate ✅

Every goal/loop IPC handler (`goal-create`, `goal-get`, `goal-loop-start`,
`goal-loop-stop`) checks `USER_AI_ENABLED === 'true'` **before** parsing request
data or doing any work.

| Test ID | Action | Expected |
|---|---|---|
| 8.1 | Set `USER_AI_ENABLED` to `"false"` (Settings or DevTools), then send `/goal Test` | Error "Could not create the goal."; main process returns "AI functionality is only available to subscribers."; **no** goal row created |
| 8.2 | Send `/loop 5` with AI disabled | Error "Could not start the loop."; no run created |
| 8.3 | Re-enable AI (`"true"`) and repeat 8.1 | Goal creation succeeds again |

---

## 9. Internationalization ✅

The `goalLoop` key group exists in all six language files
(`en`, `zh`, `es`, `fr`, `de`, `ja`).

| Test ID | Language | Expected badge label (running) | Expected bounds error |
|---|---|---|---|
| 9.1 | English | `running` | "Iteration count must be between 1 and 10." |
| 9.2 | Chinese (zh) | `运行中` | "迭代次数必须在 1 到 10 之间。" |
| 9.3 | Spanish (es) | Spanish equivalent of `running` | Spanish equivalent of the bounds message |
| 9.4 | French (fr) | French equivalent of `running` | French equivalent of the bounds message |
| 9.5 | German (de) | German equivalent of `running` | German equivalent of the bounds message |
| 9.6 | Japanese (ja) | Japanese equivalent of `running` | Japanese equivalent of the bounds message |

| Test ID | Action | Expected |
|---|---|---|
| 9.7 | Switch language, create a goal, trigger each status | Badge labels (`complete`/`blocked`/`needs input`/`failed`/`cancelled`) render in the selected language |
| 9.8 | Verify no English fallback leaks | No raw `aiChatV2.goalLoop.*` keys visible; every string has a translation |

---

## 10. Verification engine and loop controller — scenario catalogue

These behaviors are implemented in the service layer and **covered by automated
tests**, but the loop engine is not yet invoked by the main-process IPC path.
They are listed here so you can manually verify them once the wiring lands
(track in §10.1), and to document the intended contract.

### 10.1 Known gaps / not yet wired

| Gap | Impact | PRD ref |
|---|---|---|
| Plan approval does not promote goal `draft → active` | `/loop` after `/goal`+approve is currently refused | design §4.4 |
| `AIChatGoalLoopService` not called by `handleLoopStart` | No maker iterations run in the app; `/loop` only creates a run and sets `running` | FR-4 |
| Evidence collectors / deterministic verifier / LLM verifier not invoked by main process | No evidence rows, no verification, no `complete`/`blocked` via the app UI | FR-5 |
| `goal_state`/`goal_evidence`/`goal_verification` stream events not emitted | Renderer handler exists but receives nothing; no criterion/verdict UI | FR-7 |
| No criterion-level or evidence-summary UI | Only the header badge is present | FR-7 |
| `AI_CHAT_V2_STREAM_STOP` does not notify the loop service | Stop currently cancels the run via `cancelActiveRun` IPC only | design §5.3 |

### 10.2 Intended behaviors (verify after wiring — automated tests already cover these)

| Test ID | Scenario | Expected (contract) | Covered by |
|---|---|---|---|
| 10.2.1 | Maker model replies "the goal is complete" with **no** evidence | Goal stays incomplete (`not_satisfied`) — a text claim is never evidence | `AIChatGoalLoopService.test.ts`, `GoalVerificationService.test.ts` |
| 10.2.2 | A passing command/file test run **before** the last source change | Rejected as `stale evidence` — freshness gate | `GoalVerificationService.test.ts`, `GitGoalRevisionProvider.test.ts` |
| 10.2.3 | Required command exits non-zero | `not_satisfied`; an LLM verifier cannot override it | `GoalVerificationService.test.ts` |
| 10.2.4 | LLM verifier returns `passed: true` with **no** `evidenceRefs` | Verdict rejected (`passed: false`) | `GoalLlmVerifierService.test.ts` |
| 10.2.5 | Same failure fingerprint for 3 iterations | Goal → `blocked` with `repeated_failure_threshold` | `AIChatGoalLoopService.test.ts` |
| 10.2.6 | Maker pauses for permission / plan approval / question | Goal → `needs_user_input` | `AIChatGoalLoopService.test.ts` |
| 10.2.7 | Criteria never satisfy and iteration limit reached | Run ends; goal returns to `active`, reason `max_iterations_reached` | `AIChatGoalLoopService.test.ts` |
| 10.2.8 | User presses Stop mid-loop | Goal → `cancelled`, reason `user_stop` | `AIChatGoalLoopService.test.ts` |
| 10.2.9 | Maker turn fails unrecoverably | Goal → `failed`, reason `maker_turn_failed` | `AIChatGoalLoopService.test.ts` |
| 10.2.10 | Secret-shaped output (API key, JWT, bearer token) in evidence | Redacted to `[REDACTED]` before persistence/LLM | `goalRedaction.test.ts` |
| 10.2.11 | File criterion path escapes the workspace | Collector rejects; failure fingerprint recorded | `GoalEvidenceCollector.test.ts` |
| 10.2.12 | All required criteria pass with fresh evidence | Goal → `complete`, reason `all_criteria_satisfied` | `AIChatGoalLoopService.test.ts` |

---

## 11. Regression — existing AI Chat V2 behavior

| Test ID | Action | Expected |
|---|---|---|
| 11.1 | Normal chat message (no `/goal`, no `/loop`) | Unchanged behavior; no goal badge, no run |
| 11.2 | Other slash commands still dispatch (e.g. `/help` if implemented) | Unchanged |
| 11.3 | Plan Mode entered manually (not via `/goal`) | Unchanged; no goal created |
| 11.4 | Conversation switched while a loop badge is `running` | No crash; per-conversation goal state isolated |

---

## 12. Automated test reference

```bash
# Command parsing (utility)
npx vitest run test/vitest/utilitycode/aiGoalCommand.test.ts

# Evidence, redaction, verification, LLM verifier, git revision
npx vitest run test/vitest/utilitycode/GoalEvidenceCollector.test.ts
npx vitest run test/vitest/utilitycode/goalRedaction.test.ts
npx vitest run test/vitest/utilitycode/GoalVerificationService.test.ts
npx vitest run test/vitest/utilitycode/GoalLlmVerifierService.test.ts
npx vitest run test/vitest/utilitycode/GitGoalRevisionProvider.test.ts

# Loop controller + persistence + IPC
npx vitest run test/vitest/main/service/AIChatGoalLoopService.test.ts
npx vitest run test/vitest/main/modules/AIChatGoalModule.test.ts
npx vitest run test/vitest/main/ipc/ai-chat-goal-ipc.test.ts

# Full suites
npx vitest run test/vitest/main/
yarn test
```

| Test file | Coverage |
|---|---|
| `aiGoalCommand.test.ts` | `/goal` objective required, `/loop` bounds, dispatch classification |
| `AIChatGoalModule.test.ts` | draft creation, empty objective, criteria required, duplicate/replace, legal transitions |
| `AIChatGoalLoopService.test.ts` | max iterations, runtime, cancellation, repeated-failure blocking, pause paths, concurrent-start guard |
| `GoalEvidenceCollector.test.ts` | command/file/manual collection, workspace jail, failure signatures |
| `GoalVerificationService.test.ts` | deterministic pass/fail, stale-evidence rejection, LLM-cannot-override-failed-criterion, verdict precedence |
| `GoalLlmVerifierService.test.ts` | schema validation, invalid JSON/unknown ids/no-evidence-ref rejection |
| `GitGoalRevisionProvider.test.ts` | git HEAD+status fingerprint, non-git content-hash fallback |
| `goalRedaction.test.ts` | secret patterns redacted, keys kept visible |
| `ai-chat-goal-ipc.test.ts` | AI gate before work, clamp, active-goal enforcement, stop |

---

## 13. Test pass criteria

- [ ] `/goal <objective>` creates a visible, durable goal and enters Plan Mode
- [ ] `/goal` with no objective is rejected with a clear message
- [ ] A second `/goal` in the same conversation is rejected (until terminal)
- [ ] Goals are isolated per conversation and survive restart
- [ ] `/loop` without a goal, without a count, or with an out-of-range count is rejected
- [ ] `/loop` on a `draft` goal is refused (active goal required)
- [ ] `/loop` on an `active` goal creates a run, sets `running`, shows Stop
- [ ] Stop cancels the run and goal (`cancelled`, `user_stop`)
- [ ] All goal/loop IPC handlers honor the AI-enablement gate before any work
- [ ] All `goalLoop` UI strings are translated in en/zh/es/fr/de/ja
- [ ] Maker declarations, stale evidence, and evidence-free LLM verdicts can never complete a goal (automated)
- [ ] All automated tests in §12 pass

## 14. Smoke test order (if short on time)

Run in order — together they prove the wired feature end-to-end:

1. **§4.1** — create a goal (badge + Plan Mode)
2. **§4.5** — duplicate goal rejection
3. **§5.1** — restart persistence
4. **§6.1 / §6.2** — loop validation errors
5. **§6.3** — loop refused on draft goal (documents current wiring)
6. **§8.1** — AI-disabled rejection
7. **§9.1** — English badge label sanity
