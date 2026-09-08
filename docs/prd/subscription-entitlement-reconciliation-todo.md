# Subscription Entitlement Reconciliation — Open TODO

| Field | Value |
| --- | --- |
| Status | Open leftovers after worktree implementation |
| Created | 2026-08-27 |
| Source PRD | `docs/prd/subscription-entitlement-reconciliation-prd.md` |
| Technical design | `docs/prd/subscription-entitlement-reconciliation-technical-design.md` |
| Audited worktree | `/Users/cengjianze/project/aiFetchly/.claude/worktrees/subscription-entitlement-reconciliation` |
| Audited branch | `worktree-subscription-entitlement-reconciliation` |
| Audited HEAD | `095875a3` (`feat: convert inline AI gates to lazy ensureHostedAiEnabled`) |

Phase 1 MVP (FR-1–5, FR-7 chrome, pricing-window guard, i18n) is implemented in that worktree. This file lists only **unfinished** work: remaining FRs, design deviations, leftover fail-closed gates, test gaps, and explicitly deferred phases.

Priority:

- **Must-do** — blocks “all requirements implemented” for the shipping MVP / Phase 2 PRD items still open
- **Should-do** — design or test coverage the PRD/tech design asked for, product mostly works without it
- **Later** — Phase 3 / Phase 4 / P2 nice-to-haves; do not treat as MVP blockers

---

## Must-do

### TODO-1 — FR-6.3: reconcile once on hosted 402 / payment-required

- **Priority:** P1 (PRD FR-6.3)
- **Why incomplete:** `AIChatErrorMapper` / `AIChatRecoveryClassifier` still classify HTTP 402 (`Payment Required`, quota strings). They never call `SubscriptionEntitlementService.reconcile("gated_feature")` and never retry the request once. A user who paid while a hosted call was in flight can keep seeing a quota/subscription error until some other trigger (focus, Chat open, token refresh) runs.
- **Where:** `src/service/AIChatErrorMapper.ts`, `src/service/AIChatRecoveryClassifier.ts`, hosted HTTP / query-loop error path
- **Done when:** On 402, run one `gated_feature` reconcile (respect 30s cooldown). If `USER_AI_ENABLED` is now true, retry the call once. If still unauthorized, keep the existing error. Do not loop.

### TODO-2 — FR-6.2 leftover fail-closed gates (no lazy reconcile)

`ensureHostedAiEnabled()` is wired in `registerAiValidatedHandler`, Chat V2 `canUseChat`, and several IPC files from the FR-6.2 sweep. These paths still read `USER_AI_ENABLED` and fail closed **without** a reconcile, so “pay then immediately use this surface” can still show the old subscription-required message.

| Path | Why it still matters |
| --- | --- |
| `src/main-process/communication/ai-email-template-ipc.ts` (`AI_EMAIL_TEMPLATE_GENERATE_STREAM`) | Streaming handler is not `registerAiValidatedHandler`; checks Token directly |
| `src/main-process/communication/ai-chat-ipc.ts` (`AI_CHAT_STREAM`) | V1 stream path; same pattern |
| `src/service/KnowledgeLibraryAiTools.ts` | Tool-layer `isAiEnabled()`; PRD names Knowledge Library gated actions |
| `src/modules/EmailAiEnrichmentHandler.ts` | Module gate, not the IPC wrapper |
| `src/modules/YellowPagesAiSupportHandler.ts` | Module gate |
| `src/service/emailReply/EmailReplyDraftGenerationService.ts` | Service-level fail-closed |
| `src/service/ScheduledAiMessageRunner.ts` | Background runner fail-closed |

- **Done when:** Each hosted-only fail-closed check uses `ensureHostedAiEnabled()` (or equivalent) when the gate is currently off, then re-reads. Local-provider chat must stay independent (`USER_LOCAL_AI_ENABLED`).

### TODO-3 — FR-7.1: views that snapshot `aiEnabled` on mount

- **Priority:** P0 for “any view that shows plan or `aiEnabled`”; listed as Phase 2 in the tech design
- **Why incomplete:** Only `layout.vue` subscribes via `useEntitlement()`. These pages still copy `userInfo.aiEnabled` once on mount, so chrome can unlock while the open page stays gated until remount:
  - `src/views/pages/emailmarketing/template/templatedetail.vue`
  - `src/views/pages/yellowpages/create.vue`
  - `src/views/pages/emailextraction/index.vue`
- **Done when:** Each view listens to `USER_INFO_UPDATED` (reuse `useEntitlement()`) or re-reads `QUERY_USER_INFO` on that event, and updates gated controls without navigation.

### TODO-4 — FR-2.1 / design §7.1: startup order + WS reconnect companion

- **Priority:** P0 (FR-2.1 assumes a valid access token before reconcile; PRD §18 assumes WS retry-after-refresh already shipped)
- **Why incomplete:** Worktree boot order is WebSocket init → fire-and-forget `reconcile("startup")` → `TokenRefreshService.startAutoRefresh()`. Design order is: refresh access token → reconcile → connect WebSocket.
- **Why it hurts:** If the access JWT is expired at launch, startup GET can fail and keep a stale Community cache. `retryConnectIfDisconnected` / `hasActiveSocket` are **not** in this worktree, so the socket skipped on expired JWT is not retried after refresh. Entitlement then depends on later focus / gated miss / next hourly refresh.
- **Where:** `src/background.ts` logged-in boot path; `src/main-process/communication/websocket-ipc.ts`; `src/modules/WebSocketClient.ts`; `src/modules/tokenRefresh.ts`
- **Done when:**
  1. `performAutoRefreshCheck()` runs before startup reconcile and before WS connect.
  2. After a successful token refresh, disconnected WS retries (`onRefreshSuccess` → `retryConnectIfDisconnected`).

---

## Should-do

### TODO-5 — FR-1.6: log previous plan names

- **Why incomplete:** Success logs `trigger`, `changed`, `aiEnabled`, and **new** `planNames`. They do not log the previous plan names the PRD asked for.
- **Where:** `SubscriptionEntitlementService.doReconcile` ok/fail log lines
- **Done when:** Logs include previous vs new plan names + `aiEnabled` + trigger. Still no tokens.

### TODO-6 — Design §6.3 / §9: `failReason: "auth"` and skip when no access token

- **Why incomplete:** Every `updateUserInfo()` throw is `failReason: "network"`. There is no `"auth"` branch for 401 after HttpClient refresh. There is no explicit “no access token → skip reconcile, keep cache” before the GET.
- **Why it is should-do:** Cache is already kept on throw, so paid users are not wiped. Operators cannot tell auth skip vs network from logs.
- **Done when:** No token → skip + log, cache untouched. 401 after refresh attempt → `failReason: "auth"`, no sign-out.

### TODO-7 — Tests the PRD / design listed that are still missing

Service tests in the worktree cover dedupe, GET-failure keeps cache, Community→Plus broadcast, focus/gated cooldowns, `ws_connect` coalesce, pricing-window Community restore, pricing retry stop-on-paid, and `ws_notify` not writing payload.

Still missing vs design §12 and PRD §15:

| Missing case | Reason |
| --- | --- |
| GET empty plans **outside** the pricing window → Community persisted | Design §12.1; only the in-window restore case is tested |
| WebSocket client: notify path calls entitlement service, not `updateUserInfo` directly | Design §12.3 |
| `TokenRefreshService.onRefreshSuccess` invokes entitlement on success, not on refresh failure | Design §12.4 |
| Layout / `useEntitlement`: Upgrade visibility + toast on `USER_INFO_UPDATED` | Design §12.5 / PRD renderer test |
| Preload allowlist includes the three new channels (string/static guard) | Design §12.2; IPC tests register handlers but do not assert preload source |

### TODO-8 — Copy PRD + technical design into the worktree (docs)

- **Why incomplete:** The worktree only has an untracked `subscription-entitlement-reconciliation-implementation-plan.md`. PRD and technical design live in the main checkout `docs/prd/`. Reviewers working only in the worktree cannot see the source requirements.
- **Done when:** Both requirement docs are present on the feature branch / worktree (commit or copy), or the branch is based on a commit that already contains them.

---

## Later (explicitly out of MVP)

Do not block the Phase 1 ship on these. Tracked so they are not forgotten.

### TODO-9 — FR-8.2: marketing `PushNotification` client-count log (Phase 3 / P1)

- **Why incomplete:** Desktop worktree does not change the Go marketing server. Backend can still log send success with zero WebSocket clients.
- **Where:** marketing `utils/websocket_push.go`, `utils/websocket_hub.go`
- **Done when:** Log connected-client count; warn on 0. “Successfully sent” is not the support definition of desktop delivery (FR-8.3).

### TODO-10 — Phase 3 durable notify

- Persist undelivered notifies; flush on next WebSocket register.
- Optional welcome-message `plans` / `plan_updated_at` so the client can skip a redundant GET.

### TODO-11 — Phase 4 nice-to-haves

| Item | Reason it was skipped |
| --- | --- |
| Manual “Refresh plan” in account chrome | PRD P2; not required if FR-3/4/6 work |
| “Confirming your subscription…” toast after the second pricing retry | PRD P2; current retries are silent by design |
| Restart AI-gated workers when `USER_AI_ENABLED` flips false→true | Phase 4; new workers already get `WORKER_AI_ENABLED` at spawn |

---

## Already done (do not re-open)

Listed so this file is not used as a full backlog of the feature.

- FR-1.1–1.5 reconciliation service, in-flight dedupe, GET-failure keeps cache, WS payload not written
- FR-2.2 login completion via `reconcile("login")`
- FR-3 pricing open / retry / focus-in-window / skip-if-paid / non-blocking IPC
- FR-4 focus cooldown and paid skip
- FR-5.1–5.3 token-refresh listener, WS connect, WS notify routed through the service
- FR-6.1 / FR-6.4 `ensureHostedAiEnabled` + 30s cooldown + `registerAiValidatedHandler`
- FR-6.2 for Chat V2 open and IPC that uses `registerAiValidatedHandler` (plus workspace / user-memory / chat-goal / scheduled-loop sweep)
- FR-7 layout listener, success/cancel toasts, six-language i18n, no navigation on plan change
- Empty-plans-in-pricing-window cache restore
- Workers do not call `/api/user/info`

---

## Suggested order

1. TODO-4 (startup token refresh + WS retry) — otherwise overnight / expired-JWT users still miss the fast path
2. TODO-1 (402 once) and TODO-2 (remaining fail-closed gates) — impatient Chat / template / knowledge-library after checkout
3. TODO-3 (mount-cached views) — header unlocked but page still greyed out
4. TODO-5, TODO-6, TODO-7 — logging, auth skip, tests
5. TODO-8 docs on the branch
6. TODO-9–11 only if scheduling Phase 3 / 4
