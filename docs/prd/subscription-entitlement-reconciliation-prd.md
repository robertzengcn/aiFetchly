# Subscription Entitlement Reconciliation - Product Requirements Document

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Proposed |
| Created | 2026-08-26 |
| Owner | AiFetchly engineering |
| Product areas | Desktop billing entitlement, WebSocket notifications, user session |
| Related code | `src/modules/WebSocketClient.ts`, `src/controller/UserController.ts`, `src/modules/tokenRefresh.ts`, `src/views/layout/layout.vue`, `src/main-process/communication/userIpc.ts`, marketing `GET /api/user/info`, marketing `utils/websocket_push.go` |
| Technical design | `docs/prd/subscription-entitlement-reconciliation-technical-design.md` |
| Related investigation | Desktop missed `subscription_activated` because the WebSocket never connected; backend still logged "Successfully sent" |

## 1. Summary

After a user buys or changes a subscription on the marketing site (Paddle checkout in an external browser), the desktop app must show the new plan and unlock hosted AI features even when the real-time WebSocket notify never arrives.

Today the only post-login path that writes live Kill Bill plans into local storage is the WebSocket `subscription_activated` / `subscription_updated` / `subscription_cancelled` handler. That push is best-effort: the marketing hub is in-memory, `PushNotification` succeeds with zero connected clients, and the desktop may be disconnected (expired access token, sleep, Docker/proxy, laptop lid). If the notify is dropped, `USERPLANS` and `USER_AI_ENABLED` stay stale until the user logs in again. Restarting the app does not help.

This PRD makes `GET /api/user/info` the source of truth for entitlement. WebSocket remains a fast hint. The desktop must reconcile from the API at startup, after returning from pricing, on token refresh, on WebSocket connect, and once when a gated feature is blocked. The chrome (plan label, Upgrade button, AI gates) must update from that reconciliation without requiring a remount or re-login.

## 2. Problem

### 2.1 WebSocket notify is treated as the write path

Purchase flow today:

1. User clicks Upgrade in the desktop chrome.
2. Desktop opens `{VITE_LOGIN_URL}/pricing-plan` in an external browser.
3. User pays in Paddle. Marketing syncs Kill Bill and emits `paddle.subscription.killbill_synced`.
4. `PurchaseNotificationObserver` calls `utils.PushNotification(accountId, "subscription_activated", ...)`.
5. If a WebSocket client is registered for that user, the desktop runs `UserController.updateUserInfo()`, which calls `GET /api/user/info` and writes `USERPLANS` / `USER_AI_ENABLED`.

If step 5 never happens, the desktop keeps the previous Community cache. Hosted AI stays gated. The header still shows Upgrade.

### 2.2 Local cache is the only thing the UI and AI gates read

| Consumer | What it reads | Live Kill Bill? |
| --- | --- | --- |
| `QUERY_USER_INFO` / `GetloginUserInfo()` | `UserController.getUserInfo()` from Token store | No |
| Layout plan label and Upgrade button | Same local IPC, once on `onMounted` | No |
| Hosted AI IPC handlers | `USER_AI_ENABLED` | No |
| Route `beforeEach` `UserModule.GetUserInfo()` | Same local IPC | No |

`GET /api/user/info` already returns Kill Bill plans. `updateUserInfo()` already persists them. Almost nothing calls it after login except the WebSocket handler (and login completion).

`checklogin()` hits `/api/user/info` but does not persist `USERPLANS` / `USER_AI_ENABLED`.

### 2.3 Access JWT does not carry the plan

Access tokens are short-lived identity credentials (~1 hour). Plan state lives in Kill Bill, exposed by `/api/user/info`. A new access token is not required for entitlement to take effect. A new `updateUserInfo()` call is.

### 2.4 Even a successful notify can look like a failure in the UI

`WebSocketClient` already forwards `user_info_updated` to the renderer. `layout.vue` does not listen. After a successful notify, AI flags in Token storage can update while the header still shows Community / Upgrade until the layout remounts.

### 2.5 Kill Bill can lag the checkout return

The notify is emitted on `paddle.subscription.killbill_synced`, not on the raw Paddle created event. If the user returns to the app before Kill Bill sync finishes, a single `GET /api/user/info` can still return Community. Reconciliation after pricing must retry for a short window.

## 3. Goals

1. Entitlement on the desktop always comes from `GET /api/user/info`, not from "did the WebSocket arrive."
2. After a successful paid checkout, the desktop shows the new plan and unlocks hosted AI without requiring sign-out / sign-in.
3. Missed, delayed, or dropped WebSocket notifies must be recovered automatically.
4. The header plan label, Upgrade button, and AI-gated UI update as soon as local entitlement changes.
5. Reconciliation must be cheap: event-driven plus light retries, not a tight poll loop.
6. WebSocket remains the fast path when it works. It must not be the only path.
7. User-facing copy for plan refresh / upgrade success must be translated in all supported languages.

## 4. Non-Goals

1. Do not put subscription plan claims into the access JWT in this release.
2. Do not require the user to re-login after purchase.
3. Do not poll `/api/user/info` on a 30–60 second interval for every logged-in session.
4. Do not build a full billing history UI in the desktop app in this release.
5. Do not change Paddle / Kill Bill sync itself.
6. Do not make WebSocket delivery durable (Redis/DB queue) in v1. That is a later backend enhancement.
7. Do not have worker processes call `/api/user/info` or write Token store. Workers keep using `WORKER_AI_ENABLED` / tokens supplied by main.
8. Do not add database entities for entitlement cache. Token store remains the local cache.
9. Do not treat a failed notify as a failed payment. Payment success is Kill Bill state; the desktop only has a cache lag problem.

## 5. Users

### 5.1 Paying customer

Opens Upgrade from the desktop, pays in the browser, comes back expecting Plus/Pro AI to work immediately.

### 5.2 Existing subscriber who already paid while the app was asleep or disconnected

Relaunches or focuses the app later and expects the plan to match the website.

### 5.3 Community / free user who did not pay

Must not be unlocked by a stale or failed reconciliation. Failed GET must not invent a paid plan.

## 6. Product Principles

1. **Pull is correctness. Push is speed.** WebSocket may trigger a refresh. Only `/api/user/info` may write entitlement.
2. **Reconcile at natural seams.** Startup, return from pricing, token refresh, socket connect, and a blocked gated action. Not a heartbeat.
3. **Retry through the Kill Bill lag window.** One GET after checkout is not enough.
4. **One writer.** `UserController.updateUserInfo()` remains the only function that persists `USERPLANS` and `USER_AI_ENABLED` from remote plans.
5. **UI follows the cache.** Any successful write must notify the renderer so chrome and AI panels update without navigation.

## 7. Source of Truth

```text
Paddle checkout
  -> marketing webhook
  -> Kill Bill subscription
  -> GET /api/user/info { plans[] }
  -> UserController.updateUserInfo()
  -> Token: USERPLANS, USER_AI_ENABLED
  -> renderer user_info_updated
  -> layout + AI gates
```

WebSocket `subscription_*` and `payment_failed` notifications are hints that must call the same `updateUserInfo()` path. They must not write plan fields from the notify payload alone. The payload can be used for toast copy (activated / cancelled / payment failed), but plan names and AI enablement come from `/api/user/info`.

## 8. User Journeys

### 8.1 Happy path with WebSocket

1. User is logged in on Community.
2. User clicks Upgrade. Pricing opens in the system browser.
3. User completes Paddle checkout.
4. Desktop is connected. Notify arrives. `updateUserInfo()` runs.
5. Header shows the paid plan. Upgrade hides. Hosted AI unlocks. Optional success toast.

### 8.2 Notify dropped, user returns to the app

1. Same checkout.
2. Desktop was disconnected; hub dropped the notify.
3. User focuses the desktop window (or the pricing retry loop is already running).
4. Desktop pulls `/api/user/info`, retries if still Community during the lag window, then updates cache and UI.
5. Same end state as 8.1. No re-login.

### 8.3 User paid last night, opens the app today

1. Startup waits for a valid access token (existing token-refresh-before-WebSocket behavior).
2. Startup calls `updateUserInfo()` once.
3. Cache and chrome match Kill Bill.

### 8.4 User paid, immediately clicks AI Chat

1. Cache still Community (notify missed, focus not yet fired).
2. Opening a hosted-AI surface triggers one reconciliation.
3. If the server now reports an AI plan, unlock and continue. If not, keep the existing subscription-required message.

### 8.5 Payment failed

1. `payment_failed` notify or a later GET still shows Community / past_due according to `/api/user/info`.
2. Do not unlock AI. Show a non-blocking message if a notify arrived. Entitlement still follows the GET.

## 9. Functional Requirements

### FR-1 Single reconciliation API

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Add a main-process reconciliation entry point (module method, not IPC-owned DB logic) that calls `UserController.updateUserInfo()`, compares previous vs new `USERPLANS` / `USER_AI_ENABLED`, and emits `user_info_updated` to the renderer when either changes. | P0 |
| FR-1.2 | Deduplicate in-flight reconciles. Concurrent triggers (focus + pricing retry + token refresh) must share one `GET /api/user/info`. | P0 |
| FR-1.3 | On GET failure (network, 5xx), keep the existing local cache. Do not clear a paid plan to Community. | P0 |
| FR-1.4 | On GET success with empty/missing plans, keep current behavior: persist default Community and `USER_AI_ENABLED=false`. | P0 |
| FR-1.5 | Do not persist plan fields from the WebSocket notify payload. Always refresh via FR-1.1. | P0 |
| FR-1.6 | Log previous plan names, new plan names, `aiEnabled`, and the trigger (`startup`, `focus`, `pricing`, `token_refresh`, `ws_connect`, `ws_notify`, `gated_feature`). Do not log tokens. | P0 |

### FR-2 Startup reconciliation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | After a logged-in user has a valid access token (after the existing startup token refresh), call FR-1.1 once before or immediately after WebSocket init. | P0 |
| FR-2.2 | Login completion (`completeDesktopLogin`) already calls `updateUserInfo()`. It must also emit `user_info_updated` through FR-1.1 so the first layout paint is not the only UI update path. | P1 |

### FR-3 Return-from-pricing reconciliation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | `openPricingPlan()` must record `pricingOpenedAt` in main-process memory (not a new DB entity). | P0 |
| FR-3.2 | While `pricingOpenedAt` is within a configurable window (default 15 minutes), window `focus` must trigger FR-1.1. | P0 |
| FR-3.3 | After `openPricingPlan()`, start a short retry loop even without focus: default 5 attempts over ~20 seconds (for example 0s, 3s, 6s, 10s, 20s). Stop early when an active paid plan is observed. | P0 |
| FR-3.4 | If the user was already on a paid plan, skip the aggressive retry loop. A single reconcile on focus is enough. | P1 |
| FR-3.5 | Opening pricing must not block the renderer on the retry loop. | P0 |

### FR-4 Focus reconciliation for stale free plans

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | On main-window focus, if local plans are all free/Community, call FR-1.1 at most once per cooldown (default 60 seconds) to catch purchases started outside the in-app Upgrade button. | P0 |
| FR-4.2 | On main-window focus, if local plans already include an active paid plan, do not pull on every focus. Startup, token refresh, and WS connect still apply. | P1 |

### FR-5 Token-refresh and WebSocket-connect reconciliation

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | After a successful access-token refresh (`TokenRefreshService.onRefreshSuccess`), call FR-1.1. | P0 |
| FR-5.2 | When the WebSocket reaches `connected` (welcome / client id assigned), call FR-1.1. This recovers notifies missed while disconnected. | P0 |
| FR-5.3 | Existing `subscription_activated`, `subscription_updated`, `subscription_cancelled`, and `payment_failed` handlers must call FR-1.1 instead of a one-off `updateUserInfo()` that does not notify layout. | P0 |

### FR-6 Lazy reconciliation on gated features

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | When a hosted-AI surface is opened or an IPC handler would return "AI not enabled" because `USER_AI_ENABLED !== "true"`, run FR-1.1 once, then re-read the flag before showing the subscription-required error. | P0 |
| FR-6.2 | Apply FR-6.1 to at least: AI Chat V2 open, Knowledge Library gated actions, and any IPC that currently fails closed on `USER_AI_ENABLED`. | P0 |
| FR-6.3 | If a hosted AI HTTP call returns 402 / payment-required, run FR-1.1 once. If still unauthorized, keep the existing quota/subscription error. Do not loop. | P1 |
| FR-6.4 | At most one lazy reconcile per cooldown (default 30 seconds) per process, so a user mashing Chat cannot stampede `/api/user/info`. | P0 |

### FR-7 Renderer entitlement updates

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | Layout (and any view that shows plan or `aiEnabled`) must subscribe to `user_info_updated` / equivalent IPC and refresh `currentPlans`, Upgrade visibility, and AI-enabled UI. | P0 |
| FR-7.2 | When reconciliation upgrades Community → paid, show a success toast (i18n). | P0 |
| FR-7.3 | When reconciliation moves paid → cancelled/free, update chrome and gated UI; show a non-blocking info toast. | P1 |
| FR-7.4 | Do not navigate the user away from their current page solely because plans changed. | P0 |
| FR-7.5 | `QUERY_USER_INFO` may stay a local read. After FR-1.1, that local read must already reflect Kill Bill. | P0 |

### FR-8 Logging and diagnostics

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-8.1 | Desktop must log WebSocket connect/skip/retry as today, plus each FR-1.1 trigger and outcome. | P0 |
| FR-8.2 | Marketing `PushNotification` must log connected-client count and warn when delivering to zero clients (already proposed; keep in this release if not shipped). | P1 |
| FR-8.3 | "Successfully sent" on the backend must not be the support definition of "desktop received it." Desktop logs and `/api/user/info` are. | P0 |

## 10. UX Requirements

1. No extra "Refresh subscription" button is required in v1 if FR-3, FR-4, and FR-6 work. A manual refresh control on the account/plan chrome is allowed as P2.
2. Toasts must use `t()` with English fallbacks and keys in `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`.
3. Do not show a spinner that blocks the whole app during reconcile. A quiet header refresh is enough. Gated-feature lazy refresh may show the existing loading state of that feature for one extra GET.
4. Upgrade remains an external-browser checkout. This PRD does not embed Paddle.js in Electron.

Suggested copy (English source):

- Success: "Your subscription is active. Hosted AI features are unlocked."
- Still processing: no toast on every retry; optional P2 "Confirming your subscription…" after the second pricing retry.
- Unchanged Community after the pricing window: keep Upgrade visible; do not claim payment failed (the user may have closed checkout).

## 11. Technical Architecture (product constraints)

Implementation belongs in a follow-up technical design. This PRD constrains it as follows.

### 11.1 Layers

- **Model/Module:** none new for billing rows. Reuse `UserController.updateUserInfo()` and `RemoteSource.GetUserInfo()`.
- **Main process:** a small `SubscriptionEntitlementService` (name flexible) owned by main, called from `background.ts`, `tokenRefresh` listeners, `WebSocketClient`, pricing/focus hooks, and gated IPC.
- **IPC:** renderer may invoke a `user:refresh-entitlement` channel for tests and optional manual refresh. The channel must call the module, never TypeORM.
- **Renderer:** layout listens; AI panels read updated `aiEnabled` from the event or a follow-up `QUERY_USER_INFO`.

### 11.2 Zod / IPC

If a new IPC payload is added, validate it with `zod/v4` on the receiving side. `user_info_updated` payload should include `reason`, `plans`, and `aiEnabled` with explicit types (no `any`).

### 11.3 AI enable check

IPC handlers that already check `USER_AI_ENABLED` first must, under FR-6, reconcile then re-check. They must not skip the enable check. Local-provider chat remains independent of hosted entitlement (`USER_LOCAL_AI_ENABLED`).

### 11.4 Workers

Contact-extraction / AI workers must not call `/api/user/info`. If a worker is spawned after entitlement changes, main passes the updated `WORKER_AI_ENABLED` / auth token as it does today. Long-running workers started before the purchase may keep the old flag until the next spawn; P1 can document restart-on-entitlement-change if a worker is AI-gated.

## 12. Development Roadmap

### Phase 1 — MVP (ship this)

Make a missed notify invisible to the paying user.

1. FR-1 reconciliation helper with in-flight dedupe and renderer event.
2. FR-2 startup pull after token refresh.
3. FR-3 pricing-open retry + focus-in-window.
4. FR-5.1 / FR-5.2 token-refresh and WS-connect pull.
5. FR-5.3 route existing WS notify through the helper.
6. FR-7 layout (and primary AI chrome) listen + success toast + i18n.
7. Tests for dedupe, cache-keep-on-GET-failure, Community→paid event, pricing retry stop-on-paid.

### Phase 2 — Gated-feature recovery

1. FR-6 lazy reconcile on hosted-AI blocked paths and 402.
2. Broader UI surfaces that cache `aiEnabled` on mount (email template, yellow pages, knowledge library).

### Phase 3 — Backend durability (optional)

Not required for desktop correctness if Phase 1 ships.

1. Persist undelivered notifies; flush on next WebSocket register.
2. Include `plans` or `plan_updated_at` on the WebSocket welcome message so the client can skip a redundant GET when hashes match (optimization only).
3. Replace "Successfully sent" with "delivered to N clients" as the operator-facing log.

### Phase 4 — Nice to have

1. Manual "Refresh plan" in account chrome.
2. "Confirming your subscription…" during pricing retries.
3. Restart AI-gated workers when `USER_AI_ENABLED` flips true.

## 13. Logical Dependency Chain

1. FR-1 helper (everything else calls it).
2. Renderer event + layout listener (otherwise pulls look like no-ops).
3. Startup + pricing/focus (covers the actual checkout journey).
4. Token refresh + WS connect (covers overnight / disconnected).
5. Existing WS notify wired to the helper (keeps the fast path).
6. Lazy gated-feature refresh (covers impatient click on Chat).
7. Backend durable notify last.

## 14. Success Metrics

| Metric | Target |
| --- | --- |
| User completes Paddle checkout, returns to focused desktop, WebSocket down | Paid plan and AI unlock within 20 seconds without re-login |
| User restarts app after an overnight purchase | Correct plan on first window, no Upgrade button if paid |
| User paid, notify delivered | Same unlock; toast once; no double GET storm |
| GET `/api/user/info` per logged-in hour in a quiet session | On the order of startup + token refresh (~1–2), not dozens |
| False unlock (Community user gains AI without paid Kill Bill plan) | Zero |

## 15. Test Plan

### Automated

1. Unit: reconciliation dedupe; failure preserves paid cache; empty plans → Community.
2. Unit: pricing retry stops when `hasActiveAiPlan` becomes true.
3. Unit: focus cooldown; paid users skip FR-4 pull.
4. Unit: `onRefreshSuccess` and WS `connected` invoke the helper.
5. Unit: WS notify does not write `USERPLANS` from payload.
6. Vitest IPC: `user:refresh-entitlement` validates payload and calls module.
7. Renderer: layout updates Upgrade visibility on `user_info_updated`.

### Manual

1. Community user, Upgrade, pay, WebSocket connected → unlock + toast.
2. Community user, disconnect WebSocket (or expired token before the recent reconnect fix), pay, focus app → unlock within retry window.
3. Pay while app quit; launch app → unlock at startup.
4. Pay, immediately open AI Chat before focus retry completes → lazy unlock or one extra GET then Chat works.
5. Airplane mode GET failure after a paid cache → stay paid.
6. Cancel subscription (if testable) → chrome returns to Upgrade; AI gates close.
7. Switch UI language; toast strings translated.

## 16. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Kill Bill lag: first GET after checkout still Community | FR-3 retry window; FR-6 lazy retry on Chat |
| Extra `/api/user/info` load | Dedupe, cooldowns, no sub-minute global poll |
| Focus storms when user alt-tabs | 60s cooldown on FR-4; pricing window is the aggressive path |
| Stale worker `WORKER_AI_ENABLED` | Document; Phase 4 restart; new workers get current flag |
| Treating GET failure as "no plan" | FR-1.3 keep cache |
| User closes Paddle without paying, retries still run | Stop after window; no failure toast claiming payment failed |
| `hasActiveAiPlan` mismatch with Kill Bill plan names | Reuse existing `UserController.hasActiveAiPlan`; add a test if new plan ids appear |

## 17. Open Questions

1. Exact paid-plan detector: keep `hasActiveAiPlan` as the unlock predicate, or also treat any non-Community `status=active` plan as paid for chrome?
2. Should past_due still show AI until Kill Bill marks inactive? Follow `/api/user/info` + existing `hasActiveAiPlan` unless billing says otherwise.
3. Is 15 minutes the right `pricingOpenedAt` window for slow bank 3DS?
4. Should welcome-message `plans` land in Phase 1 as an optional payload, or wait for Phase 3?

## 18. Appendix

### Current write vs read

- **Write live plans:** `UserController.updateUserInfo()` ← `RemoteSource.GetUserInfo()` ← `GET /api/user/info` ← Kill Bill.
- **Write on notify:** `WebSocketClient.refreshUserInfoOnSubscriptionChange` (same GET, but layout often misses the event).
- **Read:** `getUserInfo()`, `QUERY_USER_INFO`, `USER_AI_ENABLED`.

### Related defaults

- Access token TTL: 3600s.
- Refresh token TTL: 2592000s.
- TokenRefresh proactive window: 5 minutes.
- Notify types: `subscription_activated`, `subscription_updated`, `subscription_cancelled`, `payment_failed`.

### Out of scope companion work

The earlier desktop fix (reconnect WebSocket after access-token refresh) remains necessary so the fast path works. This PRD assumes that fix ships or is already on the branch. Reconciliation is what makes the product correct when the fast path still fails.
