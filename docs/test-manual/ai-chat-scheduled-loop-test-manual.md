# AI Chat V2 — Scheduled Loop (`/loop <interval> <prompt>`) Manual Test

| Metadata | Value |
|---|---|
| Version | 1.0 |
| Created | 2026-08-04 |
| Feature | AI Chat V2 Scheduled Loop (`/loop every 5m -- …`) |
| PRD | `docs/prd/ai-chat-scheduled-loop-prd.md` |
| Technical design | `docs/prd/ai-chat-scheduled-loop-technical-design.md` |
| Status legend | ✅ wired & manually testable now · ⚠️ needs a QA helper / timing to reach the state · 🧪 covered by automated tests only (not practical by hand) |

## 1. Prerequisites

### 1.1 Environment

- [ ] AiFetchly dev server running (`yarn dev`)
- [ ] Application initialized with `yarn init`
- [ ] Logged in with an AI-enabled account (`USER_AI_ENABLED === 'true'`)
- [ ] AI Chat V2 view open (`src/views/components/aiChatV2/AiChatV2.vue`)
- [ ] Renderer DevTools open for console inspection
- [ ] Main-process DevTools available (needed only for the §4 DB helper)
- [ ] A short-interval loop can actually run: minimum interval is **1 minute**, and the scheduler polls **every 30 seconds**, so plan ~2–3 minutes per occurrence test

> **Timing note:** the shortest allowed interval is `1m`. Most "does the occurrence run?" tests below use `/loop every 1m --times 2 -- …` so the loop terminates itself and you do not need to clean up. First run is scheduled at `createdAt + interval`; the scheduler claims due occurrences every ~30 s, so the first run lands within ~30–90 s of creation.

### 1.2 What you are testing

The `/loop <duration> <prompt>` command turns AI Chat V2 into a persistent,
interval-based scheduled loop that stays in the **exact same conversation** where
it was typed. Key files:

| Layer | File |
|---|---|
| Parser (pure) | `src/service/slashCommands/AiChatLoopCommandParser.ts` |
| Bounds / cadence math | `src/config/aiChatScheduledLoopConfig.ts` |
| Types | `src/entityTypes/aiChatScheduledLoopTypes.ts` |
| Module | `src/modules/AIChatScheduledLoopModule.ts` |
| IPC | `src/main-process/communication/ai-chat-scheduled-loop-ipc.ts` |
| Scheduler | `src/modules/BackgroundScheduler.ts` (`processIntervalTasks`) |
| Runner | `src/service/ScheduledAiMessageRunner.ts` (`runChatScheduledLoop`) |
| Turn mutex | `src/service/AIChatConversationTurnCoordinator.ts` |
| Broadcast | `src/service/AIChatConversationUpdateBroadcaster.ts`, `ScheduledLoopEventSink.ts` |
| Models | `src/model/ScheduleTask.model.ts`, `AiMessageTask.model.ts`, `AiMessageTaskRun.model.ts` |
| Renderer | `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/api/aiChatScheduledLoop.ts` |

## 2. Implementation status map — read this first

All layers are wired into the running app. The table maps PRD requirements to the
manual section where you can verify them today.

| PRD requirement | Status | Where to verify |
|---|---|---|
| `/loop <maxIterations>` stays a goal loop (backward compat) | ✅ | Manual §5.2 |
| Duration parsing (`5m`, `2h`, canonical `every`, `--times`, `--for`) | ✅ | Manual §5 |
| Invalid `/loop` returns a typed error, never ordinary chat | ✅ | Manual §5.3 |
| Create in existing conversation; no new chat per run | ✅ | Manual §6.1 |
| New-chat command creates one durable `v2-*` conversation | ✅ | Manual §6.2 |
| Confirmation row shows interval + limits + next run | ✅ | Manual §6.3 |
| One active scheduled loop per conversation | ✅ | Manual §8 |
| Same-conversation transcript: user + assistant turns persist in the originating chat | ✅ | Manual §7 |
| No conversation-list entry per occurrence | ✅ | Manual §7.4 |
| Renderer refresh after durable persistence; other conversation not replaced | ✅ | Manual §9 |
| Live scheduled token bubble (origin conversation open, idle) | ✅ | Manual §9.3 |
| Pause / resume / stop / status, idempotent + conversation-scoped | ✅ | Manual §10 |
| Interactive priority; no concurrent turns in one conversation | ⚠️ | Manual §11 (needs a >1-min interactive turn) |
| Coalescing / overlap prevention | 🧪 | Manual §11.3; automated §16 |
| Restart / sleep recovery: at most one catch-up | ⚠️ | Manual §12 (needs app restart) |
| Lifetime / run-count expiry | ⚠️ | Manual §13 (`--for` with a short bound) |
| Repeated-failure → schedule failed | 🧪 | Manual §13.3; automated §16 |
| AI enablement gate before creation and every run | ✅ | Manual §14 |
| Tool policy: task-scoped, no interactive prompt, no auto-approve | ⚠️ | Manual §15 |
| Clear-conversation confirmation stops the loop | ✅ | Manual §16 (`/clear`) |
| Conversation deletion / orphan pause | ⚠️ | Manual §16.3 (orphan pause via DB helper) |
| i18n in all six locales | ✅ | Manual §17 |
| Idempotent message IDs / duplicate-run prevention | 🧪 | Manual §7.6; automated §18 |

## 3. Quick vocabulary

- **Schedule**: one persistent interval record in `schedule_task` (trigger `interval`).
- **Run / occurrence**: one execution (`ai_message_task_run`), created by the scheduler claim.
- **Catch-up run**: a run claimed after the app was closed/slept past its slot (`catch_up = true`). At most one per restart (misfire policy `run_once`).
- **Coalescing**: if a run is still active when the next slot comes due, the due slot is skipped and a `coalesced_occurrence_count` counter increments — never two overlapping runs.
- **Anchor cadence**: occurrences are due at `createdAt + n * interval` (no drift).

## 4. QA helper: inspect the database / force a state

Use this to verify same-conversation IDs, run rows, message IDs, and status fields
that are not shown in the UI.

1. Start the app with main-process debugging:
   ```
   npx electron-forge start -- --inspect=9229
   ```
   Then open `chrome://inspect` → *Remote Target* → the `aiFetchly` main process.

2. In the main-process console, run a snippet like:
   ```js
   const { SqliteDb } = require("@/config/SqliteDb");
   const { Token } = require("@/modules/token");
   const { USERSDBPATH } = require("@/config/usersetting");
   (async () => {
     const dbpath = new Token().getValue(USERSDBPATH);
     const conn = SqliteDb.getInstance(dbpath).connection;
     const runs = await conn.query(`SELECT id, schedule_id, conversation_id, occurrence, status, catch_up, user_message_id, assistant_message_id, error_code FROM ai_message_task_run ORDER BY id DESC LIMIT 10`);
     console.log(JSON.stringify(runs, null, 2));
   })();
   ```
   Replace the table/query as needed. Useful tables:
   - `schedule_task` — look for `trigger_type = 'interval'`, `status`, `next_run_time`, `claimed_execution_count`, `coalesced_occurrence_count`, `consecutive_failure_count`, `terminal_reason`, `source_conversation_id`.
   - `ai_message_task_run` — occurrence rows (`catch_up`, `scheduled_for`, `status`, `user_message_id`, `assistant_message_id`, `error_code`).
   - `ai_chat_messages` — scheduled user/assistant rows; every row for a scheduled loop must share the **same** `v2-*` `conversation_id`.

   If you cannot attach the main-process debugger, you can open the SQLite file
   (`scraper.db` under the resolved `USERSDBPATH`) with the `sqlite3` CLI instead.

3. To accelerate a run-count/lifetime test without waiting, you can shrink limits
   from the UI instead (prefer `--times 2`), or directly UPDATE a schedule row via
   the helper above (e.g. set `next_run_time` to the past) and wait one scheduler
   poll (~30 s).

---

## 5. Command classification and validation ✅

The parser runs in the renderer **before** any IPC, so these are instant and work
even while AI is disabled. Expected error text is localized; English fallbacks
are shown below.

### 5.1 Happy-path classification

| Test ID | Send | Expected |
|---|---|---|
| 5.1.1 | `/loop every 1m --times 2 -- check deployment 218` | Accepted; confirmation row "Scheduled every 1 minute. Maximum 2 runs or 24 hours. Next run: …" |
| 5.1.2 | `/loop every 2h -- summarize new campaign replies` | Accepted; "Scheduled every 2 hours. Maximum 24 runs or 24 hours. Next run: …" (defaults apply) |
| 5.1.3 | `/loop every 30m --times 6 --for 3h -- check the import` | Accepted; "Maximum 6 runs or 3 hours." |
| 5.1.4 | `/loop 5m check if deployment finished` | Shorthand accepted; same confirmation as 5.1.1 but default 24 runs |
| 5.1.5 | `/loop 5M CHECK DEPLOYMENT` | Accepted; unit case-insensitive, normalized to 5 minutes |
| 5.1.6 | `/loop EVERY 5m -- check` | Accepted; `EVERY` case-insensitive |
| 5.1.7 | `/loop 5m check the times table for deployment 218` | Accepted — prompt may contain the words `times`, `for`, and digits without being parsed as flags (shorthand has no flag parsing) |
| 5.1.8 | `/loop every 5m -- summarize replies for today -- and tomorrow` | Accepted; only the **first** standalone `--` is the separator; prompt keeps the rest |

### 5.2 Backward-compatible goal loop

| Test ID | Send | Expected |
|---|---|---|
| 5.2.1 | `/loop 5` | Treated as an immediate goal-loop iteration count (requires an active goal), **not** a scheduled loop; no schedule chip, no confirmation row |
| 5.2.2 | `/loop` (bare) | Treated as a goal-loop command with default iterations (see goal-loop test manual); not a scheduled loop |
| 5.2.3 | `/loop 5 extra` | Not a scheduled loop; validation error (trailing text after a numeric count is invalid) |

### 5.3 Rejected inputs (must show a localized parser error, no schedule created)

| Test ID | Send | Expected error (English fallback) |
|---|---|---|
| 5.3.1 | `/loop 0m check deployment` | "The interval must be between 1 minute and 24 hours." |
| 5.3.2 | `/loop -5m check deployment` | "The interval must be between 1 minute and 24 hours." |
| 5.3.3 | `/loop 1.5h check deployment` | "The interval must be between 1 minute and 24 hours." |
| 5.3.4 | `/loop 5 minutes check deployment` | "The /loop command could not be parsed." |
| 5.3.5 | `/loop 5m` (no prompt) | "A prompt is required for a scheduled loop." |
| 5.3.6 | `/loop 5d check deployment` | "The interval must be between 1 minute and 24 hours." |
| 5.3.7 | `/loop 25h check deployment` | "The interval must be between 1 minute and 24 hours." |
| 5.3.8 | `/loop every 5m` (no `--`) | "The /loop command could not be parsed." |
| 5.3.9 | `/loop every 5m --` (empty prompt) | "A prompt is required for a scheduled loop." |
| 5.3.10 | `/loop every 5m --times 101 -- check` | "The run count or lifetime limit is invalid." |
| 5.3.11 | `/loop every 5m --times 0 -- check` | "The run count or lifetime limit is invalid." |
| 5.3.12 | `/loop every 5m --times abc -- check` | "The run count or lifetime limit is invalid." |
| 5.3.13 | `/loop every 1h --for 8d -- check` | "The run count or lifetime limit is invalid." |
| 5.3.14 | `/loop every 1h --for 45s -- check` | "The run count or lifetime limit is invalid." |
| 5.3.15 | `/loop every 5m --bogus flag -- check` | "The /loop command could not be parsed." |

| Test ID | Action | Expected |
|---|---|---|
| 5.3.16 | After any 5.3.x rejection | No schedule chip appears; no confirmation row; the error renders as a message error, and **no ordinary chat/AI call** is made |
| 5.3.17 | Send `/loop 5m` followed by newline inside the prompt: `/loop 1m check import\n then report failures` | Accepted; the stored prompt preserves the newline |

---

## 6. Schedule creation ✅

### 6.1 Create in an existing conversation (happy path)

Use a conversation that already has a couple of messages.

| Test ID | Action | Expected |
|---|---|---|
| 6.1.1 | Send `/loop every 1m --times 2 -- check deployment 218` | The typed `/loop …` line stays visible **in the same conversation** |
| 6.1.2 | Confirmation row | An assistant row appears: "Scheduled every 1 minute. Maximum 2 runs or 24 hours. Next run: <HH:MM>." |
| 6.1.3 | Header chip | A `mdi-clock-outline` chip appears next to the goal chip labeled **active**, with Pause and Stop icon buttons |
| 6.1.4 | Conversation list | Exactly **one** conversation entry — the current one. No new entry was created |
| 6.1.5 | No immediate run | The confirmation does **not** claim a run has executed yet; no assistant answer about deployment yet |
| 6.1.6 | Next run time | The confirmation timestamp is `now + 1 minute` (± 30 s for the poll) |

### 6.2 Create from a new chat

| Test ID | Action | Expected |
|---|---|---|
| 6.2.1 | Start a **new** conversation (empty), send `/loop 1m --times 1 -- say hi` | A `v2-*` conversation is created and becomes active; one conversation-list entry |
| 6.2.2 | Reopen the chat later | The `/loop …` command + confirmation are visible (the conversation was durable from the moment of creation) |
| 6.2.3 | Conversation list again | Still exactly one entry — no `ai-msg-*` fallback conversation ever appears |

### 6.3 Default limits are shown

| Test ID | Action | Expected |
|---|---|---|
| 6.3.1 | Send `/loop 1h summarize replies` (shorthand, no flags) | Confirmation: "Scheduled every 1 hour. Maximum 24 runs or 24 hours. Next run: …" (defaults 24 runs / 24 h) |

---

## 7. Scheduled turns in the transcript ✅

### 7.1 First occurrence runs on time

| Test ID | Action | Expected |
|---|---|---|
| 7.1.1 | With the 1-minute loop from §6.1 still active and the chat **open**, wait for the due time | Within ~30–90 s a **scheduled user message** appears: the prompt text itself ("check deployment 218") |
| 7.1.2 | Followed by | The **assistant response** to that prompt appears in the **same conversation**, after the scheduled user message |
| 7.1.3 | Header chip during the run | Chip label flips to **running** (primary color) while the occurrence executes |
| 7.1.4 | Header chip after the run | Back to **active**; claimed count has incremented (visible in the chip tooltip/data only via §4 helper) |
| 7.1.5 | Stored content | The scheduled user message content is **the prompt itself**, not the `/loop …` command text (DB check: `ai_chat_messages` content column) |

### 7.2 Second occurrence includes prior history

| Test ID | Action | Expected |
|---|---|---|
| 7.2.1 | Wait for run 2 (loop bound to `--times 2`) | The second scheduled user message and its assistant response appear in the same conversation, **after** run 1's rows — ordering is sequential |
| 7.2.2 | Ask a follow-up referencing run 1 | The assistant can reference run 1's answer (context was assembled from the same transcript), e.g. type a normal message like "what did you say last time?" |

### 7.3 Interactive messages interleave correctly

| Test ID | Action | Expected |
|---|---|---|
| 7.3.1 | After run 1, send a normal interactive message before run 2 | The interactive turn appears in normal order; run 2 still lands afterwards and its transcript includes your interactive message |

### 7.4 No new conversation per occurrence

| Test ID | Action | Expected |
|---|---|---|
| 7.4.1 | Watch the conversation list across two scheduled runs | Still one entry for this conversation; preview/timestamp update but **no** new rows |

### 7.5 Same-conversation invariant (DB)

| Test ID | Action | Expected |
|---|---|---|
| 7.5.1 | Run the §4 helper after at least one occurrence | `ai_message_task_run.conversation_id`, the run's `user_message_id`/`assistant_message_id` rows in `ai_chat_messages`, and `schedule_task.source_conversation_id` all equal the same `v2-*` ID |
| 7.5.2 | Run IDs link | The run row's `user_message_id` and `assistant_message_id` columns are non-null and match the chat message rows for that conversation |

### 7.6 No duplicate user turns (idempotency)

| Test ID | Action | Expected |
|---|---|---|
| 7.6.1 | After several occurrences | Exactly one scheduled user message and one assistant message **per occurrence** — no duplicated turns for the same run (DB check: count rows per `runId` metadata) |

---

## 8. One active loop per conversation + cross-conversation isolation ✅

| Test ID | Action | Expected |
|---|---|---|
| 8.1 | While a loop is **active** in conversation A, send `/loop 5m another task` in **A** | Error: "This conversation already has an active scheduled loop." No second schedule; chip unchanged |
| 8.2 | Send `/loop 1m --times 1 -- another task` in a **different** conversation B | Allowed; both loops run independently |
| 8.3 | Control in B does not affect A | Stop the B loop; A's chip stays active and keeps running |

---

## 9. Renderer delivery ✅

### 9.1 Completion refresh while the origin conversation is open

| Test ID | Action | Expected |
|---|---|---|
| 9.1.1 | Keep conversation A open and idle; let a scheduled occurrence complete | The completed scheduled turn appears in the transcript without a manual refresh; chip status refreshes |

### 9.2 Another conversation stays put

| Test ID | Action | Expected |
|---|---|---|
| 9.2.1 | Open conversation B (different from the loop's A), then let A's occurrence complete | The app does **not** navigate away from B; B's transcript is unchanged |
| 9.2.2 | Conversation list | A's entry shows an updated preview timestamp/message |
| 9.2.3 | Switch back to A | All scheduled turns are present (database was authoritative even if you missed the live event) |

### 9.3 Live scheduled token bubble

| Test ID | Action | Expected |
|---|---|---|
| 9.3.1 | With A open **and no interactive stream running**, wait for a scheduled occurrence | A temporary assistant bubble with a clock icon + "running" label streams tokens live while the scheduled run executes |
| 9.3.2 | When the occurrence completes | The live bubble is replaced by the persisted assistant message (no duplication) |
| 9.3.3 | With B open while A's run executes | **No** tokens stream into B (strict routing by conversation) |

### 9.4 No merge into an interactive bubble

| Test ID | Action | Expected |
|---|---|---|
| 9.4.1 | Start a long interactive turn in A, and while it is still streaming, let a scheduled occurrence complete | The scheduled result does **not** append to the interactive assistant bubble; it appears as its own message after the interactive turn ends |
| 9.4.2 | While streaming | The live scheduled bubble is suppressed (only one active bubble at a time) |

---

## 10. Control operations ✅

### 10.1 Status

| Test ID | Action | Expected |
|---|---|---|
| 10.1.1 | With an active loop, send `/loop status` | The chip reflects the current schedule state (active / paused / running); no AI call is made; no new assistant content |
| 10.1.2 | Conversation with no loop, send `/loop status` | No error; no chip appears |

### 10.2 Pause

| Test ID | Action | Expected |
|---|---|---|
| 10.2.1 | With an active 1-minute loop, click the chip **Pause** (or send `/loop pause`) | Chip flips to **paused** (warning color); Pause button is replaced by a Resume button; Stop stays |
| 10.2.2 | Wait past the next due time | **No** scheduled run executes while paused (verify no new transcript turn after the pause moment) |
| 10.2.3 | Send `/loop pause` again while paused | Idempotent — no error, state unchanged |

### 10.3 Resume

| Test ID | Action | Expected |
|---|---|---|
| 10.3.1 | Click **Resume** (or send `/loop resume`) | Chip flips back to **active**; `next_run_time` is recomputed to `now + interval` (not an immediate replay of missed occurrences) |
| 10.3.2 | Wait one interval | Exactly **one** new occurrence runs — the missed ones are not replayed as a burst |
| 10.3.3 | Send `/loop resume` again while active | Idempotent — no error |

### 10.4 Stop

| Test ID | Action | Expected |
|---|---|---|
| 10.4.1 | With an active loop, click the chip **Stop** (or send `/loop stop`) | Chip flips to **stopped** (grey); Pause/Resume/Stop buttons disappear |
| 10.4.2 | Wait past the next due time | No further runs; history of prior runs is preserved in the transcript |
| 10.4.3 | Send `/loop stop` again | Idempotent — no error |
| 10.4.4 | Create a new loop in the same conversation after stop | Allowed (terminal state frees the conversation) |

### 10.5 Stop current run (not the schedule)

| Test ID | Action | Expected |
|---|---|---|
| 10.5.1 | While a scheduled occurrence is **running** (chip shows running), stop just the current run | The active occurrence is aborted; the schedule remains active and later occurrences still run |
| 10.5.2 | DB check | The aborted run row shows a terminal status (`cancelled`/failed with `RUN_INTERRUPTED`) |
| 10.5.3 | No run currently running, invoke stop-run | No-op (`cancelled: false`), no error |

---

## 11. Concurrency: interactive turns have priority ⚠️

### 11.1 Scheduled occurrence deferred while an interactive turn owns the conversation

This needs an interactive turn longer than the interval + the 30-second lock wait,
or a turn you can keep alive (e.g. a tool-permission prompt that stays open).

| Test ID | Action | Expected |
|---|---|---|
| 11.1.1 | Create `/loop every 1m --times 5 -- …`, then immediately start a **long interactive** message in the same conversation and keep it running past the occurrence's due time | No concurrent execution — the scheduled run waits; the interactive turn completes without interruption |
| 11.1.2 | DB check after the deferred slot | The run row for the deferred slot is `waiting_for_conversation` / failed with `CONVERSATION_BUSY` (never `completed` concurrently with the interactive turn); `coalesced_occurrence_count` may increment |
| 11.1.3 | Interactive turn never aborted | The scheduled turn does **not** abort or discard the interactive transcript |

### 11.2 Different conversations run concurrently

| Test ID | Action | Expected |
|---|---|---|
| 11.2.1 | Create a 1-minute loop in conversation A and another in B | Both run independently and can overlap; each transcript stays internally ordered |

### 11.3 Long-running occurrence does not overlap itself 🧪

| Test ID | Action | Expected |
|---|---|---|
| 11.3.1 | With a very short interval (1m) and a prompt that makes the model answer slowly, wait two slots | No two occurrences ever execute at the same time; `coalesced_occurrence_count` increases instead of a second overlapping run (DB check) |

---

## 12. Restart and sleep recovery ⚠️ (needs app restarts)

### 12.1 Restart with no missed occurrence

| Test ID | Action | Expected |
|---|---|---|
| 12.1.1 | Create `/loop every 1m --times 5 -- …`, let one run complete, then fully quit and relaunch **within the same minute** | The schedule resumes; `next_run_time` is preserved; no immediate catch-up run |
| 12.1.2 | Reopen the conversation | The `/loop` command, confirmation, and run-1 turns are all present |

### 12.2 Restart after missed occurrences → exactly one catch-up

| Test ID | Action | Expected |
|---|---|---|
| 12.2.1 | Create `/loop every 1m --times 10 -- …`, let one run complete, quit the app, wait **3+ minutes** (2+ missed slots), relaunch | At most **one** catch-up run executes shortly after startup (within ~30 s), not one run per missed slot |
| 12.2.2 | DB check | The catch-up run row has `catch_up = true`; later slots continue on the original cadence (no accumulated drift/duplicates) |

### 12.3 Sleep

| Test ID | Action | Expected |
|---|---|---|
| 12.3.1 | Suspend the OS past 1+ slots and wake the app | At most one catch-up run; no duplicate message rows (idempotency keys `scheduled-loop:<scheduleId>:<occurrence>` prevent duplicates) |

### 12.4 Stale interrupted runs are recovered

| Test ID | Action | Expected |
|---|---|---|
| 12.4.1 | Kill the app (no clean shutdown) while a scheduled run is `running`, then relaunch | The stale `running` row is marked interrupted (`RUN_INTERRUPTED`); the schedule continues cleanly; no permanently-locked conversation |

### 12.5 Expired while offline → no run

| Test ID | Action | Expected |
|---|---|---|
| 12.5.1 | Create `/loop every 1m --for 3m -- …`, let one run complete, quit before 3 minutes, relaunch after the lifetime elapsed | No catch-up run; the schedule is `expired` (chip grey, reason `SCHEDULE_EXPIRED`), and no occurrence ever executes |

---

## 13. Limits and automatic stopping ⚠️

### 13.1 Execution-count bound

| Test ID | Action | Expected |
|---|---|---|
| 13.1.1 | Create `/loop every 1m --times 2 -- …` and wait through both runs | Exactly 2 occurrences execute; after the 2nd, the chip flips to **expired** (reason `MAX_RUNS_REACHED`); no 3rd run |
| 13.1.2 | Wait another minute | Still no further runs |

### 13.2 Lifetime bound (whichever is reached first)

| Test ID | Action | Expected |
|---|---|---|
| 13.2.1 | Create `/loop every 1m --for 3m --times 100 -- …` | The schedule expires after ~3 minutes (`SCHEDULE_EXPIRED`) well before the run-count bound |
| 13.2.2 | Create `/loop every 1m --times 2 --for 8h -- …` | Stops at 2 runs (`MAX_RUNS_REACHED`) well before the lifetime bound |

### 13.3 Repeated failures → schedule failed 🧪

| Test ID | Action | Expected |
|---|---|---|
| 13.3.1 | Force consecutive run failures (e.g. disable AI mid-schedule — §14) for **3 consecutive** occurrences | Schedule flips to **failed** (red chip, reason `REPEATED_RUN_FAILURE`) and stops |

---

## 14. AI enablement gate ✅

Every create/get/pause/resume/stop/stop-run handler checks
`USER_AI_ENABLED === 'true'` **before** parsing or doing work (FR-17).

| Test ID | Action | Expected |
|---|---|---|
| 14.1 | Set `USER_AI_ENABLED` to `"false"` (Settings or DevTools), then send `/loop 5m check deployment` | Error "AI functionality is only available to subscribers."; **no** schedule chip, **no** task/schedule rows (DB check) |
| 14.2 | With AI disabled, send `/loop pause` on an existing loop | Same AI-disabled error; schedule state unchanged |
| 14.3 | Re-enable AI (`"true"`) and repeat §6.1 | Creation succeeds again |
| 14.4 | While a loop is active, disable AI and let the next occurrence fire | The run fails with `AI_DISABLED`; it does **not** call the AI API; history/chat stays consistent (DB check: failed run row with `error_code = AI_DISABLED`) |

---

## 15. Tool policy (unattended safety) ⚠️

Scheduled loops create tasks with an **empty allowlist** (`allowedTools: []`) and
`autoApproveTools: false`. No interactive permission dialog can be shown.

| Test ID | Action | Expected |
|---|---|---|
| 15.1 | Create a loop whose prompt asks the model to use a tool, e.g. `/loop 1m --times 1 -- use the file_read tool to list /tmp and report the filenames` | **No** permission card/dialog appears (unattended execution) |
| 15.2 | Outcome | Either the run completes **without** executing tools, or the run is blocked with `BLOCKED_BY_POLICY` and the schedule pauses — never an interactive prompt |
| 15.3 | DB check | Any blocked tool call is recorded (`blockedToolCalls` / `BLOCKED_BY_POLICY`) and no high-impact tool executed |

---

## 16. Clear conversation with an active schedule ✅ (FR-14 partial)

### 16.1 Clear requires confirmation

| Test ID | Action | Expected |
|---|---|---|
| 16.1.1 | Create an active loop (§6.1), then send `/clear` in the same conversation | A confirmation dialog appears: "This conversation has an active scheduled loop. Clearing will also stop the loop. Continue?" |
| 16.1.2 | Click **Cancel** | Nothing cleared; the schedule keeps running and the transcript is intact |
| 16.1.3 | Send `/clear` again and click **OK** | The schedule is stopped first, then history is cleared; chip goes to **stopped**; no further occurrences fire |

### 16.2 Clear without a schedule

| Test ID | Action | Expected |
|---|---|---|
| 16.2.1 | In a conversation with no loop, send `/clear` | Clears normally; no extra confirmation |

### 16.3 Orphan pause when the conversation disappears 🧪

| Test ID | Action | Expected |
|---|---|---|
| 16.3.1 | Using the §4 helper, delete the loop's conversation rows (or point `source_conversation_id` at a missing ID), then restart the app | On startup recovery the schedule is paused with `CONVERSATION_NOT_FOUND`; the scheduler never recreates the conversation |

---

## 17. Internationalization ✅

The `aiChatV2.scheduledLoop` key group (status labels, controls, parser errors,
clear confirmation) exists in all six language files.

| Test ID | Language | Expected "active" chip label | Expected invalid-interval error |
|---|---|---|---|
| 17.1 | English | `active` | "The interval must be between 1 minute and 24 hours." |
| 17.2 | Chinese (zh) | Chinese equivalent | Chinese equivalent |
| 17.3 | Spanish (es) | Spanish equivalent | Spanish equivalent |
| 17.4 | French (fr) | French equivalent | French equivalent |
| 17.5 | German (de) | German equivalent | German equivalent |
| 17.6 | Japanese (ja) | Japanese equivalent | Japanese equivalent |

| Test ID | Action | Expected |
|---|---|---|
| 17.7 | Switch to each language, then trigger paused/running/expired/failed/stopped and every parser error | All labels/errors render in the selected language |
| 17.8 | No raw keys leak | No literal `aiChatV2.scheduledLoop.*` text visible anywhere in the UI |

---

## 18. Regression — existing AI Chat V2 behavior

| Test ID | Action | Expected |
|---|---|---|
| 18.1 | Normal chat message (no `/loop`) | Unchanged behavior; no schedule chip, no run |
| 18.2 | `/goal <objective>` | Still enters Plan Mode + goal badge; unaffected by scheduled loops |
| 18.3 | `/loop 5` with an active goal | Still starts a goal loop (immediate iterations), not a schedule |
| 18.4 | Goal-loop Stop (badge) | Only stops the goal loop, never a scheduled loop |
| 18.5 | Other slash commands (`/help`, `/clear`, `/agents`, …) | Unchanged dispatch |
| 18.6 | Conversation switch while a scheduled run is `running` | No crash; per-conversation loop state isolated |
| 18.7 | Existing schedule-UI AI message tasks | Unchanged; a chat-created loop is a separate `chat_scheduled_loop` task and is not silently migrated |

---

## 19. Automated test reference

```bash
# Parser + bounds/cadence math
npx vitest run test/vitest/utilitycode/AiChatLoopCommandParser.test.ts
npx vitest run test/vitest/utilitycode/aiChatScheduledLoopConfig.test.ts

# Module + persistence + conversation binding
npx vitest run test/vitest/main/modules/AIChatScheduledLoopModule.test.ts
npx vitest run test/vitest/main/modules/AIChatV2Module.scheduledMessage.test.ts

# Interval scheduler + claim/coalesce/catch-up
npx vitest run test/vitest/main/modules/BackgroundScheduler.interval.test.ts
npx vitest run test/vitest/main/modules/ScheduleTaskModel.interval.test.ts

# Runner through AIChatQueryEngine + same-conversation turns
npx vitest run test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts

# Turn coordinator (priority, coalesce, restart leases)
npx vitest run test/vitest/main/service/AIChatConversationTurnCoordinator.test.ts

# IPC handlers (AI gate, decoders, error mapping)
npx vitest run test/vitest/main/ipc/ai-chat-scheduled-loop-ipc.test.ts

# i18n key parity
npx vitest run test/vitest/main/i18nKeysPresent.test.ts

# Full suites
npx vitest run test/vitest/main/
yarn test
```

| Test file | Coverage |
|---|---|
| `AiChatLoopCommandParser.test.ts` | goal vs scheduled vs control classification, shorthand/canonical, case, separators, rejected intervals/limits/prompts |
| `aiChatScheduledLoopConfig.test.ts` | bounds, clamps, checked overflow, cadence/`nextFutureOccurrence` math |
| `AIChatScheduledLoopModule.test.ts` | create binds `v2-*` id, one-loop-per-conversation, compensation, pause/resume/stop idempotency, status view |
| `AIChatV2Module.scheduledMessage.test.ts` | scheduled user/assistant rows persist in the originating conversation with trusted metadata |
| `BackgroundScheduler.interval.test.ts` | interval poll, claim-then-run wiring, startup recovery of stale runs + orphans |
| `ScheduleTaskModel.interval.test.ts` | atomic claim, expiry (`SCHEDULE_EXPIRED`/`MAX_RUNS_REACHED`), coalescing, catch-up, resume next-run math |
| `ScheduledAiMessageRunner.chatLoop.test.ts` | query-engine execution, same-conversation invariant, run↔message linkage, AI gate, terminal mapping |
| `AIChatConversationTurnCoordinator.test.ts` | per-conversation mutex, interactive priority, coalesce, release on success/error/timeout/abort |
| `ai-chat-scheduled-loop-ipc.test.ts` | AI gate before work, payload validation, error-code mapping, conversation-scoped control |
| `i18nKeysPresent.test.ts` | all six locales contain every key |

---

## 20. Test pass criteria

- [ ] `/loop <maxIterations>` (bare integer) still runs the goal loop
- [ ] `/loop 5m <prompt>` creates a bounded schedule and shows a confirmation row with limits + next run
- [ ] Invalid intervals/limits/prompts produce localized errors and never create a schedule
- [ ] The loop is bound to the exact originating `v2-*` conversation (no `ai-msg-*`, no new chat per run)
- [ ] Every occurrence persists a scheduled user message + assistant response in the same conversation
- [ ] Subsequent occurrences include prior scheduled + interactive history
- [ ] Exactly one conversation-list entry per loop
- [ ] The open origin conversation refreshes after durable persistence; another open conversation is not replaced
- [ ] Pause / resume / stop / status are idempotent and conversation-scoped
- [ ] Interactive and scheduled turns never execute concurrently in one conversation
- [ ] Restart/sleep recovery produces at most one catch-up run; expired-while-offline produces none
- [ ] Run-count and lifetime bounds stop the schedule at the first reached limit
- [ ] Every create/control handler honors the AI-enablement gate before any work
- [ ] Scheduled runs never show an interactive permission dialog and never auto-approve tools
- [ ] Clearing a conversation with an active loop requires confirmation and stops the loop
- [ ] All `aiChatV2.scheduledLoop.*` strings are translated in en/zh/es/fr/de/ja
- [ ] All automated tests in §19 pass

## 21. Smoke test order (if short on time)

Run in order — together they prove the feature end-to-end:

1. **§5.1.1** — create `--times 2` loop, read confirmation + chip (active)
2. **§5.3.1** — rejected interval shows a localized error, no schedule
3. **§7.1** — wait for run 1 to land in the same conversation
4. **§7.2** — run 2 lands, then a follow-up references run-1 context
5. **§8.1** — duplicate loop in the same conversation rejected
6. **§10.2–10.4** — pause → resume → stop (stop first, then re-test with a fresh loop if needed)
7. **§13.1** — `--times 2` ends as **expired**, no 3rd run
8. **§14.1** — AI-disabled creation rejected
9. **§17.1** — English chip label sanity
