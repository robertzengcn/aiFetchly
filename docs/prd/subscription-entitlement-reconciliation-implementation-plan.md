# Implementation Plan — Subscription Entitlement Reconciliation (Phase 1 MVP + Phase 2 helper)

Source: `docs/prd/subscription-entitlement-reconciliation-prd.md` + `…-technical-design.md`.

## Scope decision

**Implement Phase 1 (MVP — ship this) completely**, plus the empty-plans-in-pricing-window guard (the design doc explicitly recommends including it in Phase 1) and the Phase 2 `ensureHostedAiEnabled()` helper wired into the central `registerAiValidatedHandler` chokepoint (the design permits landing the helper in Phase 1).

**Out of scope for this PR** (explicit Phase 2 follow-ups): sweeping every inline `isAiEnabled()`/`isAIEnabled()` gate across workspace/user-memory/yellow-pages/knowledge-library views; 402-retry mapper; Phase 3 backend durability. These are documented as separate phases in the PRD roadmap §12.

## Verified integration facts (from actual code, not doc assumptions)

- `UserController.updateUserInfo()` (`src/controller/UserController.ts:464`) is the **only** writer of `USERPLANS`/`USER_AI_ENABLED`. It has the empty-plans→Community path (lines 503-512). `hasActiveAiPlan`/`isAiEnabledPlan` are **private** (lines 89/110) → expose as public `plansEnableAi()`.
- `WebSocketClient.ts`: `case "connected"` (line 314) stores `clientId` → wire `ws_connect` here. `refreshUserInfoOnSubscriptionChange` (line 391) is the one-off path → replace its body. It forwards `user_info_updated` on `websocket:event` (line 450); layout doesn't listen → add dedicated `USER_INFO_UPDATED` channel.
- **`TokenRefreshService` has NO listener API** (`onRefreshSuccess` does not exist). Success branch is `performAutoRefreshCheck` lines 305-312. → Add a small static listener registry `onRefreshSuccess(cb)` and fire it there. (Deviation from the doc's assumption, necessary for reality.)
- `userIpc.ts`: exports `registerUserIpcHandlers(winProvider)` (line 165); already calls `UserController.setMainWindowProvider`. → Register new handlers + focus + token-refresh listener here.
- `preload.ts`: `contextBridge.exposeInMainWorld("api", {...})` with explicit channel-string allowlists for `invoke`/`receive`/`send`/`invokeOneWay`. → Add 3 channels to the relevant allowlists.
- `background.ts` boot: `initializeWebSocketConnection(win)` at line 1261, `TokenRefreshService.startAutoRefresh()` at 1270. → Startup reconcile at ~1266 (logged-in user already has a valid access token; WS `connected` coalesces).
- `desktopLoginCompletion.ts`: `completeDesktopLogin` (line 102) calls `updateUserInfo()` at 155 → route through `reconcile("login")` (FR-2.2, P1).
- `layout.vue`: `openPricingPlan` at 397 uses `window.open`; `onMounted` at 630 reads `GetloginUserInfo()`; `currentPlans` ref at 275; `showUpgradePlan` computed at 332; plan helpers at 346/351/356.
- `lazySchema` helper lives at `src/utils/lazySchema.ts`. Some existing schema files import `z` from bare `"zod"`; **CLAUDE.md mandates `zod/v4`** → all new schemas use `import { z } from "zod/v4"`.
- `AiFeatureGate.ts`: `isAiEnabled()` exists → Phase 2 adds `ensureHostedAiEnabled()`.

## File-by-file plan

### New files

1. **`src/entityTypes/subscriptionEntitlementTypes.ts`** — `EntitlementTrigger` union, `EntitlementSnapshot`, `EntitlementReconcileResult`, `UserInfoUpdatedEvent`, `ReconcileOptions`. Type-only (no main-process imports).

2. **`src/schemas/ipc/subscriptionEntitlement.ts`** — Zod v4 schemas: `entitlementTriggerSchema`, `userPlanSchema`, `userInfoUpdatedEventSchema`, `refreshEntitlementInputSchema`, `openPricingPlanInputSchema`. Use `lazySchema` from `@/utils/lazySchema`. Export inferred types.

3. **`src/service/SubscriptionEntitlementService.ts`** — Singleton main-process service. API per design §14: `getInstance()`/`resetInstance()` (tests), `setMainWindow()`, `reconcile(trigger, opts?)`, `markPricingOpened()`, `onMainWindowFocus()`, `clearPricingRetries()`. Implements dedupe, cooldowns, snapshot compare, broadcast, pricing retry timers, empty-plans-in-pricing-window guard. Config constants from design §6.1. **Never imports `WebSocketClient` or `TokenRefreshService`** (avoid cycles; callers invoke the service).

4. **`src/views/utils/subscriptionEntitlement.ts`** — Renderer composable `useEntitlement()` owning the `USER_INFO_UPDATED` IPC subscription, applying plans, and centralizing toast rules (success on free→paid; info on paid→free). Reusable so other views (Phase 2) can subscribe without duplicating toast logic.

5. **`test/vitest/main/subscriptionEntitlementService.test.ts`** — unit tests per design §12.1 (dedupe, failure-keeps-cache, empty-plans in/out of pricing window, Community→Plus broadcast, Plus→Plus no-send, focus cooldown, paid-skip-focus, gated cooldown, ws_connect coalesce, pricing retry stop-on-paid, ws_notify doesn't write payload).

6. **`test/vitest/main/subscriptionEntitlementIpc.test.ts`** — Zod reject on bad trigger; `USER_OPEN_PRICING_PLAN` calls `markPricingOpened`; preload allowlist includes new channels.

### Modified files

7. **`src/config/channellist.ts`** — add `USER_REFRESH_ENTITLEMENT = "user:refresh-entitlement"`, `USER_OPEN_PRICING_PLAN = "user:open-pricing-plan"`, `USER_INFO_UPDATED = "user:info:updated"`. (`QUERY_USER_INFO` already exists.)

8. **`src/controller/UserController.ts`** — add public `plansEnableAi(plans: UserPlan[]): boolean` (move body of private `hasActiveAiPlan`); keep `hasActiveAiPlan` as a private alias calling `plansEnableAi` (or delete + update the one internal call site at line 497). No behavior change.

9. **`src/main-process/communication/userIpc.ts`** — register `USER_REFRESH_ENTITLEMENT` (Zod-validate input, call `service.reconcile(trigger)`, return result) and `USER_OPEN_PRICING_PLAN` (call `service.markPricingOpened()`, return `{opened, url}`). Wire `win.on("focus", ...)` → `service.onMainWindowFocus()` (guard first 2s after ready-to-show). Register the `TokenRefreshService.onRefreshSuccess` listener once → `service.reconcile("token_refresh")`. Call `service.setMainWindow(win)` in `registerUserIpcHandlers`.

10. **`src/preload.ts`** — add `USER_REFRESH_ENTITLEMENT`, `USER_OPEN_PRICING_PLAN` to the `invoke` allowlist; add `USER_INFO_UPDATED` to the `receive` allowlist.

11. **`src/background.ts`** — after `initializeWebSocketConnection(win)` (line 1266) call `SubscriptionEntitlementService.getInstance().reconcile("startup")` (fire-and-forget with `.catch(log)`; logged-in user already has a valid access token; WS `connected` coalesces via `STARTUP_CONNECT_COALESCE_MS`).

12. **`src/modules/WebSocketClient.ts`** — in `case "connected"` (after clientId stored): `void SubscriptionEntitlementService.getInstance().reconcile("ws_connect")`. Replace `refreshUserInfoOnSubscriptionChange` body with `void service.reconcile("ws_notify", { force: true, notificationType })`. Stop forwarding the synthetic `user_info_updated` on `websocket:event` (keep raw `notification` passthrough). Service import is static (service never imports WS → no cycle).

13. **`src/modules/tokenRefresh.ts`** — add static listener registry: `private static _refreshSuccessListeners = new Set<(data: TokenRefreshData) => void>()`; `static onRefreshSuccess(cb): () => void` (returns unsubscribe); fire all listeners in the success branch (lines 305-312) after `_consecutiveFailures = 0`. No sign-out path changes.

14. **`src/modules/desktopLoginCompletion.ts`** — replace the `updateUserInfo()` call (line 155) with `await SubscriptionEntitlementService.getInstance().reconcile("login")` so the first layout paint can receive `USER_INFO_UPDATED`. Keep the local `getUserInfo()` read for the immediate return value (both paths).

15. **`src/views/layout/layout.vue`** — `openPricingPlan()` → call `window.api.invoke(USER_OPEN_PRICING_PLAN)` instead of `window.open` (main records `pricingOpenedAt` + opens URL + starts retry loop). Subscribe to `USER_INFO_UPDATED` via `useEntitlement()` composable; extract `applyPlans()` from current `onMounted` plan logic; on `changed && aiEnabled && wasFree` show success toast (`t('subscriptionEntitlement.unlocked')`); on `changed && !aiEnabled && wasPaid` show info toast. **Do not** `router.push` on plan change. Keep `onMounted` `GetloginUserInfo()` for first paint.

16. **`src/views/lang/{en,zh,es,fr,de,ja}.ts`** — add `subscriptionEntitlement.unlocked` + `subscriptionEntitlement.cancelled` keys (English source from PRD §10: "Your subscription is active. Hosted AI features are unlocked." / cancelled info copy). All 6 languages.

17. **`src/service/AiFeatureGate.ts`** — add `ensureHostedAiEnabled(): Promise<boolean>` (returns true immediately if `isAiEnabled()`; else `await reconcile("gated_feature")` then re-read `isAiEnabled()`).

18. **`src/main-process/communication/_shared/registerValidatedHandler.ts`** — in the AI-gate step, replace `isAiEnabled()` check with `await ensureHostedAiEnabled()` (only triggers a GET when currently disabled; fail-closed otherwise). Single chokepoint — wiring it here covers every `registerAiValidatedHandler`-wrapped IPC at once without a per-handler sweep.

## Implementation order (matches PRD §13 logical chain)

1. Types (`subscriptionEntitlementTypes.ts`) + Zod schemas (`schemas/ipc/subscriptionEntitlement.ts`).
2. `UserController.plansEnableAi` public helper.
3. `SubscriptionEntitlementService` + unit tests (FR-1, dedupe, cooldowns, broadcast, pricing retry, empty-plans guard).
4. Channels (`channellist.ts`) + preload allowlist.
5. `userIpc.ts` handlers + focus + token-refresh listener.
6. `background.ts` startup reconcile.
7. `WebSocketClient.ts` connect + notify rewire.
8. `tokenRefresh.ts` `onRefreshSuccess` registry.
9. `desktopLoginCompletion.ts` login reconcile.
10. `layout.vue` pricing-via-IPC + `useEntitlement` listener + i18n keys (en/zh/es/fr/de/ja).
11. `AiFeatureGate.ensureHostedAiEnabled` + `registerValidatedHandler` wire (Phase 2 chokepoint).
12. IPC test file.
13. Run `yarn tsc` + `yarn testmain` until green; commit per logical unit (per CLAUDE.md auto-commit rule).

## Commit plan (one commit per logical unit)

1. `feat: add subscription entitlement types and Zod IPC schemas`
2. `feat: expose UserController.plansEnableAi for shared AI-plan detection`
3. `feat: add SubscriptionEntitlementService with dedupe, cooldowns, and pricing retry`
4. `feat: add entitlement reconciliation IPC channels and preload allowlist`
5. `feat: wire entitlement reconciliation into userIpc, focus, and token refresh`
6. `feat: reconcile entitlement at startup after WebSocket init`
7. `refactor: route WebSocket connect and subscription notify through entitlement service`
8. `feat: add TokenRefreshService onRefreshSuccess listener registry`
9. `refactor: route desktop login completion through entitlement reconcile`
10. `feat: layout subscribes to user:info:updated with i18n toasts`
11. `feat: add ensureHostedAiEnabled lazy gate in registerAiValidatedHandler`
12. `test: add subscription entitlement IPC and service tests`

## Tests to keep green

- `yarn tsc` (type-check; the vitest globalSetup gate runs this)
- `yarn testmain` (new vitest files + existing main-process tests)
- Existing WS / token-refresh tests must still pass after rewiring.

## Risks / deviations from the doc

- **`onRefreshSuccess` didn't exist** → adding a minimal listener registry to `TokenRefreshService` (deviation, documented in commit message).
- **Boot order**: doc assumed refresh→reconcile→WS; reality has `startAutoRefresh` after WS. Startup reconcile placed after WS init; relies on the logged-in user's existing valid access token. WS `connected` then coalesces.
- **No `retryConnectIfDisconnected`** companion method exists — out of scope (the PRD says that fix is assumed present or shipping separately; not part of this PR).
- `zod/v4` used for all new schemas (CLAUDE.md mandate), even though some existing schema files import bare `zod`.
