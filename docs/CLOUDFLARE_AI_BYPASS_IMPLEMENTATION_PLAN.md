# Cloudflare AI Bypass – Implementation Plan

**Status: Implemented.** This plan implements AI-assisted Cloudflare bypass using the existing observe-execute flow: when Cloudflare is detected, the client runs an observe-execute loop with a Cloudflare-specific goal before falling back to pause/notify.

---

## Overview

| Phase | Scope | Key files |
|-------|--------|-----------|
| 1 | Add `wait` action + optional `max_iterations` | aifetchserver (scrape_assist), YellowPagesScraper.ts |
| 2 | Cloudflare-specific prompts on server | aifetchserver/services/scrape_assist.py |
| 3 | Use observe-execute in Cloudflare handling | YellowPagesScraper.ts (handleCloudflareWithRetry, handleCloudflareDetection) |

---

## Phase 1: Add "wait" Action and Optional max_iterations

### 1.1 Server (aifetchserver)

**File:** `aifetchserver/services/scrape_assist.py`

- Add `"wait"` to `SAFE_ACTION_TYPES` (line ~26):
  ```python
  SAFE_ACTION_TYPES = {"click", "type", "waitForSelector", "pressKey", "scroll", "navigate", "wait"}
  ```
- In `_build_observe_system_prompt`, extend the "Allowed types" sentence to include `wait`.
- Add optional `max_iterations` to `observe_and_plan` (e.g. from `ObserveData` or a new request field). If present, use it instead of `MAX_ITERATIONS` for the cap; otherwise keep `MAX_ITERATIONS = 3`.

**File:** `aifetchserver/schemas/scrape_assist.py`

- In `ObserveData` (or equivalent request schema), add optional field: `max_iterations: int | None = None`.
- In `ExecutableAction` / docs: document `wait` with optional `value` (seconds to wait, e.g. 2–30). No selector required.

**Validation for `wait` in `_validate_observe_action`:**

- Allow `type == "wait"` without selector.
- Parse `value` as optional number of seconds (default e.g. 5); clamp to 1–60.

### 1.2 Client (aiFetchly)

**File:** `src/childprocess/YellowPagesScraper.ts`

- In `executeAction()`, add a `case "wait"`: use `action.value` (seconds) or a default (e.g. 5), then `await this.sleep(ms)`.
- When calling observe-execute for Cloudflare (Phase 3), pass a higher max iterations (e.g. 5–8) via the existing request payload if the API supports it; otherwise rely on a new constant for Cloudflare-only loops (see Phase 3).

---

## Phase 2: Cloudflare-Specific Prompts (Server)

**File:** `aifetchserver/services/scrape_assist.py`

- Add a parameter to `_build_observe_system_prompt`, e.g. `cloudflare_context: bool = False`.
- When `cloudflare_context` is True, append a Cloudflare-specific paragraph, for example:

  - The page is behind Cloudflare (challenge/interstitial).
  - Goal: get past the challenge so the real page loads (e.g. click "Verify you are human", wait for redirect, avoid aggressive actions).
  - Prefer safe actions: wait (2–15s), single click on visible challenge button, then wait again. Avoid rapid or repeated clicks.

- Where `observe_and_plan` is invoked for Cloudflare (see Phase 3), the caller will need to pass a flag so that the request is built with `cloudflare_context=True`. That may require adding a field to the observe request schema (e.g. `goal_context: str | None = None` with value `"cloudflare"`) and setting `cloudflare_context = (data.goal_context == "cloudflare")` when building the system prompt.

---

## Phase 3: Integrate Observe-Execute into Cloudflare Handling (Client)

### 3.1 New helper: attemptAiCloudflareBypass

**File:** `src/childprocess/YellowPagesScraper.ts`

- Add a private method `attemptAiCloudflareBypass(): Promise<boolean>` that:
  1. Captures current page state (HTML, optional screenshot, URL).
  2. Calls `observeExecuteLoop()` with:
     - `goal`: e.g. "Get past the Cloudflare challenge so the real page loads. Prefer waiting and a single click on the challenge/verify button if visible."
     - `pageUrl`: current page URL.
     - Optionally pass a higher max iterations (e.g. 5–8) for this flow only (constant or param).
  3. If the result is success and `status === "goal_achieved"`, run `detectCloudflareProtection()` again; return true if no longer blocked, false otherwise.
  4. If result is give_up or max iterations, return false.

- Ensure `observeExecuteLoop` (or the request builder) can pass a flag/context so the server uses the Cloudflare-specific system prompt (Phase 2). This may require extending the payload sent in `requestAiSupport` for `observe_execute` (e.g. `goalContext: "cloudflare"`).

### 3.2 handleCloudflareWithRetry

**File:** `src/childprocess/YellowPagesScraper.ts` (around line 5568)

- In the retry loop, when `isBlocked` is true:
  1. **First**, call `attemptAiCloudflareBypass()`. If it returns true, return true from `handleCloudflareWithRetry` and continue scraping.
  2. If AI bypass fails, **then** call `handleCloudflareDetection()` (notify parent + pause guidance).
  3. Then run `waitForCloudflareChallenge()` as today.
  4. If still not resolved and attempt < maxRetries, refresh and retry as now.

So the order becomes: detect → try AI bypass → if failed, notify + wait for challenge → optional refresh/retry.

### 3.3 handleCloudflareDetection (optional refactor)

**File:** `src/childprocess/YellowPagesScraper.ts` (around line 4941)

- Currently: detect → notify parent → pause.
- **Option A (minimal):** Leave as is. Only `handleCloudflareWithRetry` uses AI bypass; other call sites keep current behavior (detect → notify → pause).
- **Option B (consistent):** When Cloudflare is detected, first call `attemptAiCloudflareBypass()`. If it succeeds, return without notifying/pausing. If it fails, then notify and pause as today. This makes every detection site try AI once before pausing.

Recommendation: Start with **Option A** (only use AI bypass inside `handleCloudflareWithRetry`). Add Option B later if you want every detection path to try AI first.

---

## Phase 4: Optional Enhancements

- **ObserveResponse** (server): Add optional `challenge_type: str | None` for future use (e.g. "cloudflare_turnstile", "cloudflare_challenge").
- **Random delays / stealth:** After executing actions in the Cloudflare flow, add short random delays (e.g. 1–3 s) between actions to mimic human behavior; make configurable so it can be tuned or disabled.

---

## Implementation Order

1. **Phase 1** – Add `wait` and optional `max_iterations` (server + client). Ensures the loop can wait and, for Cloudflare, run more iterations.
2. **Phase 2** – Add Cloudflare-specific prompt and request context (server). Ensures the model gets clear instructions for challenge pages.
3. **Phase 3** – Implement `attemptAiCloudflareBypass` and integrate into `handleCloudflareWithRetry` (client). No change to `handleCloudflareDetection` initially (Option A).
4. **Phase 4** – Optional: `challenge_type`, random delays, or refactoring `handleCloudflareDetection` (Option B).

---

## Testing

- **Unit (server):** Assert `"wait"` is in `SAFE_ACTION_TYPES` and that a valid `wait` action is accepted; assert `max_iterations` is respected when provided.
- **Unit (client):** Mock `requestAiSupport` and assert that when observe-execute returns `goal_achieved`, `attemptAiCloudflareBypass` returns true after re-checking Cloudflare.
- **Integration:** Run a flow that hits a Cloudflare-protected page and confirm either AI bypass succeeds or the fallback (notify + pause) still works.

---

## Files to Touch (Summary)

| Repo | File | Changes |
|------|------|--------|
| aifetchserver | `aifetchserver/services/scrape_assist.py` | SAFE_ACTION_TYPES + "wait", _build_observe_system_prompt (wait + cloudflare_context), observe_and_plan max_iterations, _validate_observe_action for "wait" |
| aifetchserver | `aifetchserver/schemas/scrape_assist.py` | ObserveData.max_iterations (optional), ObserveData.goal_context (optional), ExecutableAction docs for "wait" |
| aiFetchly | `src/childprocess/YellowPagesScraper.ts` | executeAction "wait", observeExecuteLoop/request support for max_iterations + goal_context, attemptAiCloudflareBypass(), handleCloudflareWithRetry() call AI bypass first |
