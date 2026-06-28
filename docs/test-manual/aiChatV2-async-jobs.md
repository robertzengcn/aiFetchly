# Manual Test: AI Chat V2 Async Tool Jobs

**Date added:** 2026-06-27
**Covers:** async tool job polling fix + running badge UI

## Setup

1. Start the dev server.
2. Open the AI Chat V2 view.
3. Ensure AI is enabled (`USER_AI_ENABLED === 'true'`).
4. Have at least one social account configured for scraping tests.

## Test 1: Lead Researcher subagent (`run_subagent` — always async)

**Prompt:**

    Research Acme Corp (a fintech SMB) and report its business summary with
    source URLs.

**Expected:**
- Model calls `run_subagent`.
- Tool_call card shows a running badge: spinner + "Background job started (job_id: ...)".
- Badge updates over the next 30-90 seconds as the subagent progresses.
- When the subagent finishes, the badge clears and the card shows the real result.
- The model continues the conversation, citing the subagent's findings (not the raw `{async:true,job_id}` envelope).

**Fail indicators:**
- Card shows "Poll with check_tool_job_status(job_id) every 15-30s." (placeholder leaked)
- Chat hangs with no progress for >2 minutes.
- Model ends its turn without referencing the subagent's output.

## Test 2: `extract_contact_info` with 8+ URLs

Provide a list of 8+ URLs in the prompt.

**Expected:**
- Tool_call card shows running badge.
- Progress count (X/Y) updates as URLs are processed.
- On completion, card shows aggregated contact info; model summarizes.

## Test 3: Stop mid-job

1. Send Test 1's prompt.
2. While the running badge is visible, click Stop.

**Expected:**
- Chat stops within ~100ms (not 15s).
- Tool job is cancelled in the registry.
- No orphaned `{async:true,job_id}` message remains in the UI.

## Test 4: 30-minute timeout (mocked)

Hard to test live. Either:
- (a) Temporarily set `ASYNC_POLL_MAX_MS = 30_000;` in `AIChatQueryLoop.ts`, stub the subagent to never complete, send Test 1's prompt, expect a timeout error message after 30s. Restore the constant afterward.
- (b) Trust the unit-test coverage from `AIChatQueryLoopAsyncPoll.test.ts`.

## Regression

Run the full Vitest suite:

    yarn vitest run test/vitest/main/

Expected: no new failures vs. baseline.
