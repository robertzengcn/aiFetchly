# Puppeteer-Managed Social Browser (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the PRD's **P0 foundation** (docs/prd/puppeteer-managed-social-browser-prd.md §18 P0, FR-P0-001..019): a visible, Puppeteer-controlled headed Chrome bound to one Tool Account, launched from one disposable Electron utility process, with encrypted-cookie handoff, same-context manual login handoff, structured AI browser tools, cache subsystem, settings, and supervisor cleanup.

**Architecture:** Electron main process owns accounts/leases/cookie decrypt+persist/permissions/worker lifecycle (Model+Module layers only). One `utilityProcess` per session under `src/childprocess/managed-browser/` owns Puppeteer + Chrome. Renderer/LLM see only sanitized status/observations via Zod-validated IPC and typed tools. Full contracts live in the technical design (`docs/prd/puppeteer-managed-social-browser-technical-design.md`) — this plan maps them onto concrete files; **design section references (§N) are authoritative contracts**.

**Tech Stack:** TypeScript 5, Electron 43 `utilityProcess`, Puppeteer 25 + puppeteer-extra + stealth 2.11, Zod 3.24 (`import { z } from "zod"`), Vue 3 + Vuetify, Vitest (utilitycode/main/components configs).

**Worktree:** `.claude/worktrees/managed-social-browser` (branch `worktree-managed-social-browser`, based on local dev `393efaa4`). `node_modules` symlinked from main checkout.

## In scope (design Phases A + B + C-core)

- Phases A, B, C of design §27 (contracts, authenticated runtime, structured LLM control incl. P0 action set, screenshot, handoff/resume, stop).
- FR-P0-016 CAPTCHA: ChallengeDetector + main-process `CaptchaResolutionPolicy` that (without provider config) always decides `manual_handoff`.
- Cache: scope/path/lock/clear/maintenance-worker + settings UI (FR-CACHE-001..014 core paths).

## Deferred (recorded, not implemented this pass)

- Phase C.5 provider network calls (`CaptchaProviderService` external HTTP), Phase D page-context scripts (`browser_evaluate_script`), Phase E platform expansion beyond the YouTube adapter, P2 persistent profiles, multi-tab control, E2E full suite (spec scaffold only if time).

## Baseline facts (verified 2026-09-03)

- `AccountSessionService.getDecryptedSnapshot(accountId) → {cookies: NormalizedCookie[], status}`; `persistSnapshot(input)` throws `CookieServiceError("NO_ALLOWED_COOKIES")` on empty (never replaces valid snapshot) — `worker_refresh` source already modeled (`src/schemas/accountCookies.ts`).
- `PlatformSessionManifest`: YouTube = platformId 2, domains youtube.com/google.com/accounts.google.com; `makeDomainMatcher(platformId)` for suffix-exact matching.
- Worker schema convention: `lazySchema(() => z.discriminatedUnion("type",[...]))` + `parseWorkerMessage` (safeParse-drop) in `src/schemas/worker/_shared.ts`.
- Worker client convention: `SkillWorkerClient.ts` (`utilityProcess.fork`, `resolvePackagedWorkerPath`, pending-request map, runtime crash handlers).
- Worker build: `vite.<name>.config.mjs` (rollup input → `dist/childprocess/<Name>.js`, cjs, ssr) + `forge.config.js` `packagerConfig.build` entry.
- Settings: `settinggroupInit` groups (`SystemSettingGroupdf`), read via `SystemSettingModule.getSettingValue(key)` → `string | null`.
- AI gate: `Token().getValue(USER_AI_ENABLED)` from `@/config/usersetting`; `registerValidatedHandler` in `src/main-process/communication/_shared/`.
- Test commands: `yarn vitest run --config vite.utilityCode.config.mjs <path>` / `--config vite.main.config.mjs <path>`; one-shot type check `npx tsc --noEmit`; components `yarn test:components`.

## Tasks

### Task 1: Shared types + centralized config (design §6, §25)

**Files:**
- Create `src/entityTypes/managedBrowserTypes.ts` — every type in design §6 (ManagedBrowserSessionState, BrowserRiskClass, BrowserExecutableDescriptor, SafeManagedBrowserStatus, BrowserChatNoticeType, SafeBrowserChatNotice, EffectiveManagedBrowserSettings, SafeManagedBrowserCacheStatus/ClearResult) **plus** transport-independent types referenced by worker schemas: BrowserLaunchPolicy (§11.1), WorkerProxyConfig (§12.1), WorkerBrowserStoragePolicy (§13.4), ManagedBrowserProcessIdentity (§8.5), FingerprintSelfTestEvidence (§11.2), BrowserObservation/BrowserElementSummary/BrowserNotice (§14.1), ManagedBrowserErrorCode union (§23). No cookie-bearing renderer type.
- Create `src/config/managedBrowser.ts` — `MANAGED_BROWSER_PROTOCOL_VERSION=1`; timing table (§8.4: ready 10s, launch+selftest 30s, cookie apply 15s, verify 45s, action 15s, navigation 45s, observe 10s, graceful stop 5s, +2s kill, heartbeat 5s/3-miss, handoff 10min); message size caps (2 MiB / 8 MiB screenshot); observation budgets (§14.1: 120 elements, 12k chars text, 200/name, 100/value, 64 KiB); action limits (§15.1: 25/program, 100 total steps, 240s, 200 items, 256 KiB extract, 3 consecutive failures); denied launch flags (§2.2 item 7 + PRD §12.6); cache defaults (500 MiB global, clamp 100..2048, 200 MiB/account, 30d retention); enabled stealth evasion allowlist; release flag `MANAGED_BROWSER_ENABLED` following `src/config/featureFlags.ts` pattern; setting key constants (`managed-browser-enabled`, `managed-browser-cache-enabled`, `managed-browser-cache-max-size-mb`, `managed-browser-cache-clear-on-exit`).
- Test `test/vitest/utilitycode/managedBrowser/managedBrowserConfig.test.ts`: defaults (browser/cache enabled, 500 MB), clamp bounds, denied flag list contains the 8 PRD flags, heartbeat math (15s threshold), protocol version.
- Run: `yarn vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/managedBrowser/`
- Commit: `feat: add managed-browser shared types and centralized config`

### Task 2: Worker / IPC / tool Zod schemas (design §8, §22.1, §15)

**Files:**
- Create `src/schemas/worker/managedBrowser.ts`:
  - Inbound (main→worker) `managedBrowserInboundSchema`: START_SESSION (protocolVersion, sessionId, requestId, sequence, executable descriptor, launchPolicy, storagePolicy, platform def incl. domain suffixes, proxy, cookies: normalizedCookieSchema[]) / OBSERVE / RUN_ACTIONS (P0 action program) / CAPTURE_SCREENSHOT / BEGIN_HANDOFF / RESUME_HANDOFF / VERIFY_MANUAL_LOGIN / CANCEL_REQUEST / STOP_SESSION. All with sessionId+requestId+sequence.
  - Outbound (worker→main) `managedBrowserOutboundSchema`: WORKER_READY, WORKER_HEARTBEAT (seq, state, lagBucket, ts), SESSION_STATE_CHANGED, SESSION_READY (appliedCount/rejectedCount, authentication assessment), LOGIN_REQUIRED, OBSERVATION_RESULT, ACTION_PROGRESS, ACTION_RESULT, SCREENSHOT_RESULT (base64 ≤8 MiB), HANDOFF_REQUIRED (reasonCode), CHALLENGE_DETECTED (challengeId, origin, evidence codes), REFRESHED_COOKIES (cookies only here), SESSION_STOPPED, WORKER_ERROR (code, safe message).
  - Strict objects; reject unknown fields; `MAX_MESSAGE_BYTES` guard helper `isWithinWorkerMessageLimit()`.
- Create `src/schemas/ipc/managedBrowser.ts`: request schemas for the design §22.1 channels (start/status/handoff/verify-manual-login/resume/stop/get-effective-settings/get-cache-status/clear-cache incl. confirmationId + activeSessionDecision enum) and event payload schemas (status-changed/progress/approval-required/chat-notice/cache-progress).
- Create `src/schemas/aiTools/managedBrowser.ts`: tool argument schemas for the 10 P0 tools (names per design §15 table).
- Tests `test/vitest/utilitycode/managedBrowser/managedBrowserSchemas.test.ts`: strict-mode rejects unknown fields; START_SESSION requires cookies array of normalized cookies; malformed messages fail safeParse; screenshot oversize rejected by byte-limit helper; IPC clear-cache rejects any `path` field; action program enforces 25-action/depth-3 limits.
- Run: utilityCode vitest.
- Commit: `feat: add managed-browser worker, IPC, and AI tool schemas`

### Task 3: Executable resolver + fingerprint policy (design §10, §11)

**Files:**
- Create `src/childprocess/managed-browser/BrowserExecutableResolver.ts` — pure class, injected `{existsSync, realpath, statSync?}` + env paths; parse `<major>.<minor>.<build>.<patch>` from version string (`parseChromeVersion` exported pure fn); resolution order: configured `chrome_path` setting → puppeteer-managed cache dir (`puppeteer.executablePath()`-equivalent candidate) → platform known paths (win: Program Files Google/Chrome + Chrome for Testing cache; mac: /Applications; linux: /usr/bin/google-chrome|chromium + ~/.cache/puppeteer) → `browser_dependency_missing`; descriptor `{path, source, product:"chrome", version, majorVersion, architecture}`; path safety: reject symlink-escaping/non-file. No download ever.
- Create `src/childprocess/managed-browser/BrowserFingerprintPolicy.ts` — `buildDefaultLaunchPolicy(opts)` (headless:false, userAgentOverride:null, locale/timezone from validated inputs, viewport 1365x768 in 1400x900 window, no unsafe flags); `validateFingerprint({executableDescriptor, launchPolicy, evidence}) → {result:"pass"|"fail", reasonCodes[]}` implementing §11.2 fail conditions (UA-major mismatch, locale contradiction, timezone mismatch, viewport > screen, denied flag present, launched-version ≠ resolved); `composeLaunchArgs(launchPolicy, extras) → string[]` + `findDeniedLaunchFlag(args)`.
- Tests `test/vitest/utilitycode/managedBrowser/browserFingerprint.test.ts` + `browserExecutableResolver.test.ts`: native UA default passes; override major ≠ executable major fails with `fingerprint_mismatch`; Chrome 136 UA with 118 pool value fails (FR-FP-005); each denied flag detected; version parsing incl. dev-channel strings; resolution order with fake fs.
- Run + Commit: `feat: add managed-browser executable resolver and fingerprint policy`

### Task 4: Settings rows + settings module (design §7.4)

**Files:**
- Modify `src/config/settinggroupInit.ts`: new `managed_browser_group` with 4 items (enabled "1", cache-enabled "1", cache-max-size-mb "500" type input, clear-on-exit "0") + exported key constants.
- Create `src/modules/ManagedBrowserSettingsModule.ts` (extends BaseModule, uses SystemSettingModule internally or SystemSettingModel via its own model? — follow SystemSettingModule usage: instantiate `new SystemSettingModule()` and read values; module composes, never raw repo): `getEffectiveSettings(): Promise<EffectiveManagedBrowserSettings>` = release flag AND user toggle → browserEnabled + disabledReasonCode; cacheEnabled; cacheMaxBytes clamped 100..2048 MiB; clearCacheOnExit. `setPreference(key, value)` validated.
- Tests `test/vitest/main/managedBrowser/managedBrowserSettings.test.ts`: defaults when rows missing; invalid size clamps; release-flag off → browserEnabled false with reason while stored value unchanged (FR-SETTING-002).
- Commit: `feat: add managed-browser system settings group and module`

### Task 5: Account lease service (design §7.2)

**Files:**
- Create `src/service/ManagedBrowserLeaseService.ts` — in-memory singleton; `acquire(accountId, {sessionId, ownerConversationId}) → {ok, leaseToken, existing?}`; same-conversation repeat returns active session info; different owner → `account_in_use`; `release(accountId, sessionId, leaseToken)` idempotent; global limit 1 (`global_limit_reached`); `releaseAll()` for before-quit; `getActive()`.
- Tests `test/vitest/utilitycode/managedBrowser/managedBrowserLease.test.ts`: acquire/collision/reuse/release-idempotency/crash-release/global-limit.
- Commit: `feat: add managed-browser account lease service`

### Task 6: Worker runtime pure core (design §9, §12.2, §13.1, §14, §18 detection)

**Files (all Electron/Puppeteer-import-free; types only where needed):**
- `src/childprocess/managed-browser/cookieTransfer.ts` — `toPuppeteerCookies(normalized: NormalizedCookie[])` per §13.1 table (sameSite mapping incl. unspecified→omit, hostOnly→url construction, expirationDate→expires, session cookie omit) + `countApplicationResults(applied, rejected)` count-only shape.
- `src/childprocess/managed-browser/NavigationPolicy.ts` — `evaluateNavigationTarget(url, {platformOrigins, allowLoopbackFixtures})` → allow/deny+reason: scheme allowlist (https always; http loopback only in fixture mode), deny file/data/javascript/blob/chrome/devtools; hostname literal checks (loopback 127.0.0.0/8, ::1, 0.0.0.0, private 10/172.16/192.168, 169.254 link-local, 169.254.169.254 metadata); `sanitizeUrlForReport(url)` (strip credentials, query, fragment → origin+path).
- `src/childprocess/managed-browser/ManagedBrowserRuntime.ts` — state machine per §9: `transition(event)` with guard table (actions only in ready/running; scripts N/A P0; stop idempotent; stale-session reject), `assertCommandAllowed(cmd)`, emits transitions via callback.
- `src/childprocess/managed-browser/ResultSanitizer.ts` — `sanitizeObservation`, `redactSecrets(obj)` (drop keys cookie/authorization/token/password/session/credential variants; secret-pattern string redaction), `truncateToBudget` per budgets, `isLikelySecretValue`.
- `src/childprocess/managed-browser/ChallengeDetector.ts` — pure heuristics over sanitized page signals (`detectChallengeFromSignals({url, title, visibleTextSample, inputTypes}) → {kind, evidenceCodes} | null`): captcha/robot text patterns, otp/password/recovery classification for handoff reasons; no network, no provider data.
- Tests under `test/vitest/utilitycode/managedBrowser/`: cookie mapping table cases (host-only, sameSite variants, expiry, malformed one does not block others); navigation policy matrix incl. prompt-injection URL attempts; state-machine guard matrix; sanitizer canaries (planted secret strings removed); challenge classification (login-flow challenges → handoff reason `challenge_login_sensitive`).
- Commits: `feat: add managed-browser cookie transfer and navigation policy` ; `feat: add managed-browser runtime state machine and result sanitizer`

### Task 7: Worker entry + observation/actions + client + supervisor (design §8.4-8.5, §14-15, §21)

**Files:**
- `src/childprocess/managed-browser/adapters/PlatformBrowserAdapter.ts` (interface per §21) + `adapters/YouTubeBrowserAdapter.ts` — allowedOrigins/loginOrigins from manifest platformId 2, verificationUrl, `assessAuthentication(page)` using URL/selector presence signals (avatar/account button, absence of sign-in CTA; Google login redirect), `detectChallenge`, `identifySensitiveFields` (password/otp/autofill selectors), `readiness` (domcontentloaded + appraised selector). Page-typed methods take a minimal structural `AdapterPageLike` (url(), evaluate()) so tests can fake.
- `src/childprocess/managed-browser/BrowserObservationService.ts` — build BrowserObservation from a live page via injected evaluation fn: interactive elements (role/name/state → refs), visible text budget, notices, `@eN [role] "name"` compact rendering for tool results.
- `src/childprocess/managed-browser/PageReferenceRegistry.ts` — ref↔handle map, revision-bound, cap 200, 60s expiry, role/name fingerprint compare, dispose on revision change.
- `src/childprocess/managed-browser/BrowserActionExecutor.ts` — P0 actions (navigate/click/fill/select/press_key/scroll/wait_for/extract) with limits, per-step revision revalidation, consecutive-failure stop (3), cancellation checks, effect_unknown marking.
- `src/childprocess/managed-browser/index.ts` — utilityProcess entry: parentPort messages → safeParse inbound union → runtime; launch `puppeteer-extra` + stealth (allowlisted evasions) headed with temp userDataDir + optional disk-cache dir; fingerprint self-test on about:blank before platform nav; heartbeat interval 5s; process identity report; cookie apply → verify → SESSION_READY/LOGIN_REQUIRED; REFRESHED_COOKIES private send; idempotent cleanup (browser.close → profile rm).
- `src/service/ManagedBrowserWorkerClient.ts` — per-session fork (resolvePackagedWorkerPath pattern, `ManagedBrowser.js` candidates), request correlation, per-op timeouts from config, last-seq tracking, malformed counter→`worker_protocol_violation`, REFRESHED_COOKIES routed to private callback only, single memoized `cleanup(cause)`.
- `src/service/ManagedBrowserSupervisor.ts` — registry of clients; heartbeat watchdog (15s unresponsive), exit/error/disconnect → one cleanup path; `shutdownAll(deadline)` for before-quit; `verifyProcessIdentity` before any kill of orphan Chrome.
- Modify `src/background.ts`: in existing `before-quit` handler call `managedBrowserSupervisor.shutdownAll(...)` alongside existing bounded worker shutdown (join, don't add a second handler).
- Create `vite.managedBrowserWorker.config.mjs` (copy skillWorker shape; input `src/childprocess/managed-browser/index.ts` → `dist/childprocess/ManagedBrowser.js`; externals + puppeteer deps resolved) + register in `forge.config.js` build list.
- Tests: `test/vitest/utilitycode/managedBrowser/` for observation/reference-registry/action-limits with fake page objects; `test/vitest/main/managedBrowser/managedBrowserWorkerClient.test.ts` + `managedBrowserSupervisor.test.ts` with injected fake UtilityProcess/event emitter (heartbeat miss → cleanup, late heartbeat ignored, exit → lease release callback, shutdownAll deadline).
- Commits: `feat: add managed-browser observation, reference registry, and action executor` ; `feat: add managed-browser worker entry with puppeteer runtime` ; `feat: add managed-browser worker client, supervisor, and build wiring`

### Task 8: ManagedBrowserModule + cookie bridge + chat notices + captcha policy (design §7.1, §13.2-13.3, §18.2-18.3)

**Files:**
- `src/modules/ManagedBrowserModule.ts` — the only app-level entry (IPC + tools call it): start() implementing the 15-step order §7.1 (release flag → settings → [AI path: USER_AI_ENABLED] → account via SocialAccountModule → manifest+proxy → lease → executable → temp profile/cache paths (cache scope svc) → worker client fork → WORKER_READY → getDecryptedSnapshot → domain re-filter via makeDomainMatcher → START_SESSION send → zero cookie refs → await ready/login_required/handoff/failure with timeouts → safe status). observe/runActions/screenshot/beginHandoff/verifyManualLogin/resume/stop/getStatus; `handleRefreshedCookies` → `persistSnapshot({source:"worker_refresh", partitionPath: await getOrCreatePartition(accountId)})` with empty/failed refresh never overwriting (NO_ALLOWED_COOKIES caught → sessionSaved:false notice); every failure after lease → supervisor cleanup.
- `src/service/BrowserChatNoticePublisher.ts` — `publish(input)` with dedup key `conversationId/sessionId/type/transitionNonce`; safe allow-listed args only (labels, counts, sessionSaved, reasonCodes); notice lifecycle mapping (login_required → user_login_in_progress → login_verifying → login_verified/failed → task_resuming); emits through a `ChatNoticeSink` interface so tests fake it; production sink = renderer event `managed-browser:on-chat-notice` (+ persistence hook if a clean existing API is found; otherwise renderer-side handling in Task 10 — record decision in code comment).
- `src/service/CaptchaResolutionPolicy.ts` — pure `decide(ctx): CaptchaResolutionDecision` per §18.3 checks 1-9; in P0 the provider branch is unreachable without `2captcha-authorized-domains` consent state (which we do not add), so all outputs are `manual_handoff` with distinct reasonCodes; page/LLM data can't influence inputs.
- Tests `test/vitest/main/managedBrowser/`: start-order test with injected fakes (settings off → reject BEFORE account lookup/decrypt/worker; ai disabled on AI path → `ai_disabled` first); refresh-empty preserves snapshot (fake AccountSessionService); notice dedup + lifecycle order; captcha policy matrix (login/payment/unknown flows → handoff; suffix-exact domain logic).
- Commits: `feat: add managed-browser module orchestration with cookie bridge` ; `feat: add browser chat notice publisher and captcha resolution policy`

### Task 9: Cache subsystem (design §13.4-13.10)

**Files:**
- `src/service/ManagedBrowserCacheScopeService.ts` — injectable Electron `app.getPath("cache")` resolver + `UserSecretKeyService`-based HMAC scope token (`managed-browser-cache:v1:<accountId>` → hex 24 chars); namespace `chrome-<major>-<platform>-<arch>-schema-1`; `deriveScopePaths(accountId, chromeMajor)` with full §13.5 validation ladder (canonical resolve, reject root/home/tmp roots, generated segments only, `..`/ separators/nulls/ADS rejected, symlink inspection per component, containment re-check); key-unavailable → cache disabled with reason, never readable identifier.
- `src/modules/ManagedBrowserCacheModule.ts` — active-scope registry tied to lease (CACHE_OPENED/RELEASED messages); `getStatus(scope)` via maintenance worker scan; `clearCache(input)` per §13.8 (validate confirmation → derive path → active decision (stop_and_clear via supervisor / defer / skip / cancel) → atomic rename to `deleting/<opId>` inside root → maintenance worker delete → SafeManagedBrowserCacheClearResult); `queueAccountRemoval`; clear-on-exit queueing; idempotent empty → `{state:"empty", approximateDeletedBytes:0}`.
- `src/childprocess/managed-browser-cache/index.ts` + `ManagedBrowserCacheMaintenanceWorker.ts` + `CachePathValidator.ts` + `CacheEvictionPlanner.ts` — Zod union SCAN_SCOPE/SCAN_ALL/DELETE_QUEUED_SCOPE/PLAN_EVICTION/CANCEL_BEFORE_DELETE/SHUTDOWN; bounded scan (entry/depth/bytes/wall-time limits); active-scope skip list; own link/root validation; LRU-inactive eviction plan (500 MiB global, 200/account, 30d).
- `vite.managedBrowserCacheWorker.config.mjs` → `dist/childprocess/ManagedBrowserCacheWorker.js` + forge registration.
- Worker client for maintenance worker: `src/service/ManagedBrowserCacheWorkerClient.ts` (singleton, fork-on-demand, timeout, retryable failure preserving deletion queue).
- Tests: scope path security (traversal/symlink/root/planted-outside-file untouched), clear idempotency + deferral when active, deletion-queue recovery after simulated interruption, eviction ordering, maintenance message validation.
- Commits: `feat: add managed-browser cache scope service and module` ; `feat: add managed-browser cache maintenance worker`

### Task 10: IPC + preload + UI + i18n (design §22)

**Files:**
- `src/main-process/communication/managed-browser-ipc.ts` — every AI-facing channel checks `Token`/`USER_AI_ENABLED` FIRST (before parse); `registerValidatedHandler` with ipc schemas; events to renderer via `webContents.send` (status-changed, progress, approval-required, chat-notice, cache-progress); no DB access.
- Modify `src/preload.ts` — add `managedBrowser*` methods (list/start/status/handoff/verifyManualLogin/resume/stop/approve/extendHandoff/getEffectiveSettings/getCacheStatus/clearCache) with channel whitelist arrays + `on*` subscribe/unsubscribe helpers (memory: missing validChannels = silent no-op trap).
- `src/views/components/aiChatV2/ManagedBrowserSessionCard.vue` — account/platform/state/origin/proxy-badge/elapsed; controls Pause AI / Take over / Resume AI / Stop browser; handoff controls (I've finished logging in / Continue task / Extend time / Cancel task); non-color state indicator; data-testids.
- `src/views/components/aiChatV2/ManagedBrowserHandoffDialog.vue` — reason, countdown, extend; receipt action.
- Settings panel `src/views/components/systemSetting/ManagedBrowserSettingsPanel.vue` (or follow existing settings page structure — locate during implementation): browser toggle, cache toggle, size display + last clear, clear selected/all with confirmation dialog (scope+size+preserved-login copy, active-session choice), clear-on-exit toggle.
- Wire card into AiChatV2 workspace area (follow existing session-card mounting pattern found in aiChatV2 components).
- i18n: `managedBrowser.*` keys in `src/views/lang/{en,zh,es,fr,de,ja}.ts` — all user-facing strings incl. notices (login_required…), settings, confirmations, completions.
- Component tests `test/vitest/main/components/ManagedBrowserSessionCard.test.ts` (+ HandoffDialog, SettingsPanel): states matrix, controls emit correct IPC via mocked api, i18n key parity across 6 langs, keyboard/accessible labels, long account names.
- Commits: `feat: add managed-browser IPC handlers and preload bridge` ; `feat: add managed-browser session UI with six-language i18n`

### Task 11: Risk classifier + AI tools (design §15, §17)

**Files:**
- `src/service/BrowserActionRiskClassifier.ts` — deterministic `classify(actionCtx) → BrowserRiskClass` + approval requirement (read/reversible_write session-level; consequential_write always-confirm incl. publish/send/delete/follow/upload/submit descriptors; credential_or_security → handoff; local_data_delete; privileged_script reserved). LLM assertions cannot lower.
- `src/service/ManagedBrowserAiToolService.ts` — tool executors: USER_AI_ENABLED check inside; session gate; route to ManagedBrowserModule; async job creation for multi-step run_actions via `ToolJobRegistry` (`getDefaultToolJobRegistry()`); progress events rate-limited; sanitized results prefixed with untrusted-content notice.
- Modify `src/config/skillsRegistry.ts` — register the 10 tools (permissionCategory "automation", requiresConfirmation per risk); investigate + follow the existing deferred/contextual catalog mechanism (AI tool search) so they load on browser-ish intent (see ai-tool-list-management feature); add capability blurb to `BuiltInToolCapabilitiesPromptSection` if that's the existing prompt section service.
- Tests: classifier matrix incl. full_access cannot bypass; tool service gating (ai disabled → `ai_disabled`, browser disabled → `managed_browser_disabled` with settings route); catalog registration test.
- Commit: `feat: register managed-browser AI tools with risk classification`

### Task 12: Final gates + memory

- `npx tsc --noEmit` (fix all new errors; pre-existing dev baseline = 0 at 393efaa4)
- `yarn vue-check` one-shot equivalent (`npx vue-tsc --noEmit` — check script name)
- `yarn testmain run` + `yarn test:components` green
- Optional: `test/e2e/specs/managedBrowser.test.ts` scaffold (fake account + local fixture; skip heavy paths)
- Update memory file `managed-social-browser-status.md` + MEMORY.md pointer.
- Final report.

## Self-review

- Spec coverage vs PRD P0 list: FR-P0-001..007 → Tasks 3,6,7,8; 008 → 7,11; 009 → 10; 010 → 7 (client/supervisor cleanup); 011 → 7 (YouTube adapter); 012 → 8,10,11 (AI gate at three layers); 013 → 8 (login handoff flow) + 10 (UI); 014 → 8 (notice publisher); 015 → 7 (utility process + heartbeat); 016 → 6 (detector) + 8 (policy, manual default); 017 → 4; 018 → 9 + 7 (storage policy); 019 → 9 + 10. Gaps: none in P0 scope; deferred items listed above.
- Placeholder scan: tasks reference design §s for full contracts (docs are in-repo and authoritative); all file paths, commands, and commit messages concrete.
- Type consistency: names locked in Tasks 1-2 and reused (SafeManagedBrowserStatus, BrowserObservation, lease/session ids as strings `mb_<random>`); resolver returns BrowserExecutableDescriptor used by START_SESSION schema (Task 2) — define schema fields to match Task 1 types exactly.
