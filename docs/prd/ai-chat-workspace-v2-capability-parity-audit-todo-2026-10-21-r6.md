# Workspace capability parity — re-audit R6 and remaining TODO

Audit date: 2026-10-21. Reviewed HEAD: `982b482e3`, branch `workspace-v2-capability-parity`, worktree `workspace-parity`.

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md), [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md), and [R5 audit and subsequent fix record](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21-r5.md).

**Verdict: not complete.** The original R5 reproductions are addressed, but three new focused checks reproduce three remaining defects in runtime hydration and active-answer retention. Release evidence V01–V03 remains incomplete; V04 records a fresh Electron test-harness failure and dev-server errors. This is an incremental review of the latest changes and adjacent lifecycle behavior, not a claim that every line of the application has been exhaustively audited.

No application code was changed. Only this new report is intended for commit. The pre-existing untracked `...audit-todo-2026-10-20.md` was preserved.

## Fix round 2026-10-21 (same day) — R6-01/02/03 repaired, V04 harness repaired; V01–V03 untouched

Agent-completable findings from this audit were fixed and committed on this branch same-day:

| Audit item | Outcome | Commit |
| --- | --- | --- |
| R6-01 authoritative runtime hydration | Fixed: presenter `hydrateRuntime()` + store defer/replay during selection | `f00671596` |
| R6-02 resumed answer pinning/observation | Fixed: ensure/append adopt existing rows, register accumulator, pin restored actionable rows | `f00671596` |
| R6-03 live-direction pin-aware bound | Fixed: multi-pass trim (none → pinned → protected → any) preserved by a turn-level accumulator | `f00671596` |
| Permanent regressions for R6-01/02/03 | Added: 15 tests in `test/vitest/main/components/store/selectedConversation.r6ActiveAnswer.test.ts` + updated audit-R05 reselection test to corrected behavior (test-only change) | `f00671596` + `f4286d6f9` |
| V04 E2E network guard / dev-server / assertions | Fixed: guard trusts exactly `aifetchly-generated-image://local/`; `assertImagesDecoded` (polling) + `assertIconFontsServed` wired into all generated-image specs; scoped `server.fs.allow` for the resolved `@mdi/font/fonts` | `57e6dc3e8` |
| V04 full-suite rerun blocker (NEW, discovered while closing V04) | Fixed: the persistent-shell startup specs hardcoded 1280-wide normal bounds; `computeInitialBounds` is adaptive by design (`min(1280, workArea − 96)`, design §14.3). Expectations now derive from the observed work area | `8ef7091bf` |
| V01–V03 release/certification evidence | **Still open — not agent-completable** (journey recording, manual accessibility/at checks, authenticated live-browser cycle, 14-day soak + production/safety/desktop/QA sign-offs) | — |

Gates on the final revision (post-fix): `yarn test:components` **162 files / 1,352 tests passed** (includes the 15 new regressions); targeted main suite **17 files / 160 tests passed**; `yarn typecheck` and `yarn vue-typecheck` passed; full Electron E2E under canonical CI geometry `xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" yarn playwright test` **176 passed / 0 failed / 3 skipped** (the 3 skips are the `AIFETCHLY_E2E_LIVE_AI=1`-gated run-preservation scenarios) in 25.7 minutes; all 14 `ai-chat-generated-image-*` specs pass isolated with the new decode/font assertions active. Full-suite logs: `/tmp/parity-v04-{run,full,full2,geo}.log` + `/tmp/parity-v04-full2/console.log`.

## Verification on this revision

| Check | Result |
| --- | --- |
| `yarn test:components` | **161 files / 1,337 tests passed** before adding temporary audit checks. |
| Targeted main-process tests, command below | **17 files / 160 tests passed**. |
| `yarn typecheck` | Passed, 27.66 seconds. |
| `yarn vue-typecheck` | Passed, 47.20 seconds. |
| Focused store checks: `yarn test:components auditR6 -t AUDIT_R6` | **Three assertions failed**, one per finding below; 18 inherited tests were filtered out. |
| Attempted full Electron suite: `xvfb-run -a yarn test:e2e` | Build succeeded; full run interrupted after a failure to isolate it. Five tests completed: 4 passed / 1 failed; the sixth was in progress. The 179-test suite did not complete. See V04. |
| Fresh isolated Electron retry | **1 passed**; original broad-run failure did not repeat with a fresh server. See V04. |
| Full module/main suite, live speech/browser-account certification, manual accessibility and production soak | Not performed in this audit. |

Targeted main command:

```sh
AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run \
  test/vitest/main/aiChatWorkspace \
  test/vitest/main/browserVoiceRecorder.test.ts \
  test/vitest/main/aiChatPlanDecisionIpc.test.ts \
  test/vitest/main/aiChatRendererMetricsIpc.test.ts \
  test/vitest/main/model/AIChatPendingMessage.model.test.ts \
  test/vitest/main/modules/AIChatPendingMessageModule.test.ts
```

The duplicate internal typecheck was skipped for that command; standalone checks are recorded separately. Logs: `/tmp/parity-r6-{components,main,typecheck,vue,repro,e2e,e2e-isolated,e2e-isolated-fresh}.log`.

The focused tests use actual store/presenter logic with controlled transport responses and detail events. They were copied from the existing `selectedConversation.historyWindow.test.ts` harness. The temporary file was removed from the worktree and retained locally at `/tmp/auditR6.test.ts`. To repeat, copy it to `test/vitest/main/components/store/auditR6.test.ts` and run the focused command above. Token checks wait 80 ms, beyond the presenter's 50 ms flush. These are state/content assertion failures, not setup or type errors. Temporary artifacts are not committed regression coverage; add permanent tests with the fixes.

## Previous fix reconciliation

| Previous issue | Current implementation and assessment |
| --- | --- |
| R5-01: freshly started response evicted by backward paging | New rows are pinned; backward trimming skips pinned rows; a missing final row is materialized from `fullContent`. Original tests pass. Existing hydrated rows never acquire that pin (R6-02), and live-direction trimming ignores pins (R6-03). |
| R5-02: live growth exceeds 200 rows | `syncFromPresenter()` now trims live growth and re-arms paging. Count-bound tests pass. Preserving the count is insufficient if active content is lost; see R6-03. |
| R5-03: old cursor reused while new snapshot loads | Cursor/availability reset immediately; `loadOlder()` refuses while loading. Original delayed/failed/deselection tests pass. No new cursor-initialization defect established. |
| R4 recorder rollback, resolution dispatch and stale-page guards | Implementations remain and normal regression suites pass. No new defect established in those fixes here. |
| Earlier retry/source identity, voice ownership, telemetry and click timing | Implementations remain; relevant normal suites pass. No new regression established in this pass. |
| V01–V03 | Still require the evidence listed below; code-fix checkboxes alone do not close them. |

## Bugs and implementation tasks

### R6-01 — P1: selection hydration immediately overwrites the authoritative runtime state

- [x] Hydrate the presenter and selected store from one authoritative runtime snapshot, preserving status and active run identity across subsequent synchronizations. *(Fixed commit `f00671596`.)*
- **Fix and verification (2026-10-21):** The presenter gained the explicit runtime hydration surface `hydrateRuntime({ runtimeStatus, activeRunId })` (protobuf-mapped statuses only; `streamStatus` returns to `streaming` only for `running`). `loadSelection()` no longer assigns the refs beside `syncFromPresenter()`: it hydrates from the SAME authoritative snapshot; detail events that arrive during the snapshot await are deferred and replayed after seed + hydration + sync, so an older snapshot can never overwrite newer terminal/live facts (superseded/error/deselection paths discard the buffer). Permanent coverage: runtime/waiting snapshot mapping, no-anchor hydration events, history paging without reset, token-during-load survival, snapshot terminal beats replayed events, A→B→A re-selection (`selectedConversation.r6ActiveAnswer.test.ts`), plus the updated reselection assertions in `AiChatCenterSurface.test.ts`. All gates pass on the final revision (counts in the fix-round table above).
- **Requirements:** FR-LIF-004, FR-REC-001/008, FR-LIF-005 presentation guards; technical design §9.3 selected state reconstruction.
- **Location:** `src/views/store/selectedConversation.ts:1038–1044` seeds history, assigns `snapshot.runtimeStatus` and `snapshot.activeRunId`, then calls `syncFromPresenter()`. That function at :338–341 overwrites those assignments from presenter state. `src/views/utils/workspaceStreamPresenter.ts:851–866` seeds history as idle; the presenter was disposed at selection start and its active run is null.
- **Reproduce:** Resolve the selected-conversation snapshot with a persisted row, `runtimeStatus: 'running'` and `activeRunId: 'live-run'`. Await `loadSelection()` without emitting any new stream event.
- **Observed:** Selected state is **`{ status: 'idle', run: null }`**, expected **`{ status: 'running', run: 'live-run' }`**. The snapshot was accepted successfully, so this is not a stale-generation rejection.
- **Impact:** Returning to a running conversation initially presents it as idle until another event repairs the projection. If the engine is quiet or waiting, the incorrect state can persist. The header/run strip and composer consume this store; its `isBusy` is false for this reproduced state, so busy-dependent UI affordances can be misleading. This test does not establish that authoritative main-process mutation guards are bypassed.
- **Fix detail:** Add explicit runtime hydration to the presenter or establish a separate canonical runtime store that projection synchronization cannot overwrite. Merely moving the two assignments below `syncFromPresenter()` fixes one moment but may allow the next history/row mutation to reset them again. Reconcile events that arrive during snapshot loading so an older snapshot cannot overwrite newer terminal/live facts.
- **Done when:** Test running, queued, awaiting permission/user, terminal and idle snapshots; verify run ID, status, busy policy, Stop/run-strip presentation and safe clear/delete affordances as appropriate for each state. Then load history or mutate presentation without new engine events and assert the authoritative runtime remains intact. Include a route/reselection E2E scenario with a deliberately quiet running/waiting engine.

### R6-02 — P2: a resumed answer loaded from history is never pinned and still loses its prefix on paging

- [x] Register existing hydrated active rows as protected when they resume, independently of whether a new row is appended. *(Fixed commit `f00671596`.)*
- **Fix and verification (2026-10-21):** Runtime ownership and pin registration now have paths disjoint from append/dedup: `ensureAssistantView()` ADOPTS an existing hydrated row (pins while streaming, registers the row as the active-turn accumulator baseline when identity is deduplicated/owned), `appendDelta` accumulates observed content at event time, `flushNow` treats the accumulator as the source of truth, and error/cancel/complete terminals re-materialize evicted accumulated content before clearing. Restored actionable rows (permission prompts, plan/question rows) are pinned during hydration independently of live status. Permanent coverage: after-selection + after-paging resume ("saved prefix suffix"), adopted reasoning metadata, error/cancel/complete retention, restored permission-prompt pinning, quiet-page + mid-run token ordering.
- **Requirements:** FR-HIS-001/005, FR-LIF-004, FR-REC-008; PRD §19 and design §17 bounded paging without destroying active projection.
- **Location:** `workspaceStreamPresenter.ts:851–866` clears pins on history seed. `ensureAssistantView()` at :308–324 routes an existing message through `appendMessage()`, but its duplicate-row guard at :260 returns **before** pin registration at :265–266. Subsequent calls can also return from `ensureAssistantView()` early. Thus resuming tokens does not protect that hydrated row.
- **Reproduce:** Seed 199 ordinary rows plus the assistant `live-answer` with content `saved `. Resume a token `prefix ` and flush; verify content is `saved prefix `. Fetch one older row, then receive token `suffix` and flush.
- **Observed:** Final displayed content is **`suffix`**, expected **`saved prefix suffix`**. The intermediate assertion confirms the persisted prefix and resumed token were present before paging. Backward eviction removes the unpinned answer; the next token creates an empty replacement.
- **Impact:** The original R5 case works for newly appended answer rows, but the same loss remains after reload/reselection. This establishes renderer content loss, not deletion of the persisted database message. A later complete event carrying full content may repair the row; an error/cancel or ongoing stream need not do so.
- **Fix detail:** Give runtime ownership and pin registration a path separate from append/deduplication. Restore or infer active row ownership from the snapshot/live event; protect reasoning and relevant actionable rows too. Coordinate with R6-01 so hydration has reliable active-run identity.
- **Done when:** Preserve saved text plus resumed deltas after selection, paging, multiple deltas, error/cancel and complete. Test both a resumed `start` and a first mid-run token, reasoning, and restored waiting/action rows. Retain the 200-row mounted bound rather than accumulating unlimited protected history.

### R6-03 — P2: live-direction trimming ignores pins and can destroy an active answer during a long turn

- [x] Preserve active answer accumulation separately from evictable rendered rows, with a bounded presentation strategy when one turn itself exceeds the window. *(Fixed commit `f00671596`.)*
- **Fix and verification (2026-10-21):** `trimToWindow(200, { retain })` is now direction-aware and multi-pass, classifying every row (unprotected → pinned non-critical receipts → pinned actionable → answer/content-bearing accumulator rows), evicting in working order per direction, and always honoring the 200-row bound; over-pinning is harmless because the compaction pass still evicts non-critical pinned rows, and the accumulator preserves the logical turn content independent of the mounted rows. Permanent coverage: 100 tool pairs + 398-row live growth with the bound asserted throughout, permission prompt reachability in either direction, paging during the long turn, cancellation with ≥99-row recovery, and content re-materialization from the accumulator on terminals.
- **Requirements:** FR-HIS-001/005; PRD §19 and design §17; correct active response presentation under tool-heavy execution.
- **Location:** `selectedConversation.ts:328–329` calls `trimToWindow(200, { retain: 'newest' })` on overflow. `workspaceStreamPresenter.ts:922–927` implements that branch with a plain tail slice and does not consult `pinnedRowIds`. Pin-aware trimming exists only in the backward-history branch.
- **Reproduce:** Start an answer and emit `prefix `. Emit 100 distinct tool-call/tool-result pairs in that same run, creating 200 additional rows. Confirm the window is still at most 200. Resume the assistant with token `suffix` and flush.
- **Observed:** The answer contains **`suffix`**, expected **`prefix suffix`**. The oldest active answer was removed by live trimming even though it had been pinned. The test passes the size-bound assertion and fails content preservation.
- **Boundary:** This is a renderer stress case for a long run; it does not claim every provider produces 100 tool calls or that this frequency was observed in production. The current event/presenter path accepts the sequence and has no content-preserving strategy at this boundary.
- **Impact:** The new memory bound is enforced by sacrificing active text after sufficient same-turn growth. Simply retaining every pinned row would instead violate the 200-row bound. The existing “tool-heavy” regression uses one tool call/result pair, which never reaches this conflict.
- **Fix detail:** Separate logical active message state from the mounted window or compact completed tool receipts while preserving current response and actionable decisions. Define overflow behavior for more than 200 active-turn rows explicitly; both bounded rendering and correct accumulated content must hold. Bound/retire pin bookkeeping as well.
- **Done when:** Run beyond 200 rows within one active turn, verify full text/reasoning survives continued deltas and terminals, keep actionable permission/plan controls reachable, and assert the mounted bound throughout. Test paging during the long run, cancellation/error, and recovery of evicted settled history.

## Remaining release and certification work

### V01 — Successful default-route voice journey

- [ ] Record the full record → successful transcription → merge draft → auto-send → spoken-response journey with a deterministic runtime stand-in, plus a separately labelled configured real-runtime check.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts` still documents missing runtime/models. Positive unit/component coverage is not the whole successful default-route journey. The latest five commits do not add a successful voice E2E.
- **Done when:** One accepted send, correct conversation/draft/file ownership, configured playback policy, selection/Stop handling and draft preservation on failure are observed. State which parts are mocked. FR-VOI-001–010; PRD §17.8/22/23.

### V02 — Accessibility, authenticated browser and final regression

- [ ] Record critical keyboard paths, focus entry/trap/return, one-time announcements and inactive-conversation focus isolation.
- [ ] Record narrow/200% layouts, reduced motion, platform and assistive technology. Existing automated accessibility checks remain a subset.
- [ ] Exercise authenticated managed-browser start → handoff/approval → verify → resume → stop, including expiry, stale actions and route return; distinguish fixtures from live-account certification.
- [ ] After fixes, repeat affected gates and full Electron E2E on the final revision; explain failures/skips and confirm six-language parity for changed UI copy. Preserve the fresh results above as evidence for this reviewed revision only.
- **Requirements:** A11Y-001–010, FR-BRW-001–006, PRD §22/28. No new manual/live-account certification artifact was identified in the reviewed changes.

### V03 — Soak and owner sign-off

- [ ] Complete design AD-009's rolling 14-day default-route soak: ≥500 accepted submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejections, and restart recovery ≥99% for exercised cases.
- [ ] Close severity-1/2 parity defects; record zero confirmed duplicate delivery, duplicate continuation, cross-conversation event or authorization-bypass incidents; obtain product, safety, desktop and QA sign-off.
- [ ] Keep working Chat V2 rollback until the separate removal decision; extend low-volume soak as specified.
- **Evidence:** No new soak/sign-off artifact appears in the reviewed changes. Automated gate counts cannot substitute for these release conditions. PRD §21/24/28 and design AD-009.

### V04 — Intermittent Electron gate failure and worktree dev-server errors

- [x] Correct the Electron test network guard's classification of trusted generated-image requests, add decoded-image assertions, and rerun the generated-image specs and full suite. *(Fixed commit `57e6dc3e8`; new blocker found during the rerun fixed in `8ef7091bf`.)*
- **Fix and verification (2026-10-21):** The renderer route guard now recognizes exactly the trusted local scheme/authority prefix `aifetchly-generated-image://local/` (the app's own `protocol.handle` handler serves only existence- and path-validated files under the redirected userData root) — no blanket `origin === null` allowance; every other non-loopback origin is still aborted and recorded. `test/e2e/support/assertions.ts` gained `assertImagesDecoded` (polls every `<img>` in scope to finish decoding — counts alone kept passing against empty tiles; images that merely have not started their lazy load settle rather than fail) and `assertIconFontsServed` (reads the @font-face srcs the renderer document actually references and fetches them through the page path; each must return 200). Both are wired into all three generated-image specs at every tile-assertion site. `vite.render.config.mjs` now resolves the realpath of `@mdi/font/fonts` (the worktree's node_modules is a symlink into the primary checkout) and allows exactly that directory plus the project root, so materialdesignicons-webfont requests succeed instead of being blocked with "outside of Vite serving allow list" and rendering tofu.
- **New blocker found while rerunning the full suite (and fixed, `8ef7091bf`):** the persistent-shell startup specs (`workspace-shell.test.ts:31`, `workspace-shell-gaps.test.ts:233`) hardcoded 1280-wide expected normal bounds. `computeInitialBounds` is adaptive by design (design §14.3: `min(1280, workArea.width − 2×48)`, floored at the 960x640 practical minimum), so on any 1280-wide X server the deterministic first-launch rectangle is 1184 wide and the tests always failed. The geometry feature and these specs exist only on this unmerged branch — they never ran on GitHub CI, so the incompatibility was never caught there. The specs now derive the expected bounds from the observed work area in the same evaluate call, keeping a deterministic contract on every display size.
- **Reruns:** all 14 `ai-chat-generated-image-*` specs pass with fresh renderer servers (4.1m); the full Electron suite passes under the canonical CI geometry (`xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" yarn playwright test`, 176 passed / 0 failed / 3 skipped, 25.7m; zero unexpected violations recorded by either network guard). The earlier bare `xvfb-run -a` run (non-canonical geometry) is superseded by the 1280x960x24 run; its only failures were the two geometry specs above. Logs under `/tmp/parity-v04-*/`.
- **Observed gate failure:** The broad run's first case, `ai-chat-generated-image-batch-live.test.ts:172` (R-1: no-workspace four-image batch), failed teardown with `renderer attempted disallowed external requests`. The recorded URLs use **`aifetchly-generated-image://local/...`**, with URL origin `null`; they are the application's local image protocol, not evidence of a real external-network leak.
- **Observed harness path:** `test/e2e/fixtures/electronApp.ts:312–330` permits only loopback hostnames, classifies intercepted requests with protocol host `local` as external, and aborts them. `test/e2e/support/assertions.ts:65–73` fails on the recorded requests. The generated-image spec currently counts tile wrappers, which does not establish that their images decoded successfully.
- **Isolated check:** `xvfb-run -a yarn playwright test test/e2e/specs/ai-chat-generated-image-batch-live.test.ts --grep 'R-1:' --output /tmp/parity-r6-isolated-fresh-results` **passed: 1 test, 27.9 seconds** with a fresh server. The immediate first retry had `ERR_CONNECTION_REFUSED` during the interrupted server's shutdown and is not counted as a product defect. The original teardown failure is therefore **intermittent**, not a consistently reproduced application failure. Investigate why the protocol requests reach the route guard in the failing run; do not dismiss the trace solely because the retry passed.
- **Fix constraints:** Recognize only the intended trusted local scheme/authority, leaving arbitrary external traffic blocked. Do not blanket-allow `origin === 'null'`, since unrelated opaque origins share that string. Assert image loading/decoding as well as card counts. The broad run passed R-2 through R-5 before interruption; these passes do not override the R-1 gate failure or certify the rest of the suite.
- [ ] Resolve the worktree dev-server's blocked icon-font paths and verify icon rendering in the Electron test environment. *(Fixed commit `57e6dc3e8` — scoped `server.fs.allow` for the resolved `@mdi/font/fonts` realpath; `assertIconFontsServed` verifies the actual font requests return 200 rather than suppressing a warning.)*
- **Observed warning:** Vite repeatedly reports `materialdesignicons-webfont.woff2`, `.woff` and `.ttf` under the primary checkout's `node_modules/@mdi/font/fonts/` as outside its serving allow list. `vite.render.config.mjs:26–29` sets port/strictPort but has no explicit filesystem allow configuration for that resolved dependency location.
- **Scope:** This warning is environment/dev-serving evidence, not a confirmed packaged-app defect. Ensure dependency resolution and narrowly scoped serving permissions agree; verify actual font requests succeed rather than suppressing the warning. No separate visual font certification was performed.
- **Artifacts:** Broad-run trace and error context are under `test-results/playwright/specs-ai-chat-generated-im-22732-nd-durable-re-homed-outputs/`; the first isolated attempt's artifacts are under `/tmp/parity-r6-isolated-results/`; the fresh passing run used `/tmp/parity-r6-isolated-fresh-results/`. Preserve relevant traces with the fix/re-run. PRD §22/28 requires a passing E2E gate.

## Requirement coverage disposition

All functional families remain mapped below. “Retained” identifies the previously mapped implementation and fresh normal regression coverage where applicable, not certification of every external/manual acceptance case. The worktree's owner-approved extraction deferral still applies; proposed filenames alone are not missing capabilities.

| Requirement family | Current assessment / remaining work |
| --- | --- |
| FR-SUB-001–009 | Payload/acceptance/retry identity retained; normal tests pass. Runtime/busy presentation under R6-01 fixed (`f00671596`, hydrateRuntime + defer/replay). |
| FR-CMD-001–009 | Shared command, goal, loop and skill routing retained; final-state integration certification pending. |
| FR-QUE-001–014 | Durable queue/source identity retained; targeted tests pass. Hydrated queued/running presentation covered by R6-01 fixtures (`f00671596`). |
| FR-PLN-001–009 | Strict decision/continuation path retained; preserve waiting/runtime and actionable projection in R6 fixes. |
| FR-PER-001–008 | Permission/parked continuation surfaces retained; restored waiting-state correctness and V02 remain. |
| FR-OUT-001–010 | Frozen authorization/dedicated review retained; final safety/runtime evidence pending. |
| FR-IMG-001–015 | Synchronous app-scoped reference resolution retained; normal component tests pass. |
| FR-RPT-001–009 | Per-output/conversation reporting retained; no new reporting defect reproduced. |
| FR-VOI-001–010 | Prior ownership/acquisition rollback fixes retained; normal tests pass; V01 remains. |
| FR-WSP-001–010 | Workspace/trust/watcher/memory paths retained; runtime/busy affordances restored by R6-01 (`f00671596`); platform certification pending. |
| FR-REC-001–008 | Recovery/retry/compaction surfaces retained; runtime hydration and resumed answer preservation fixed (R6-01/02, `f00671596`). |
| FR-LIF-001–006 | Cursor isolation fixed; authoritative runtime hydration fixed (`f00671596`). |
| FR-SKL-001–006 | Installation/approval/invocation retained; final integration and accessibility evidence pending. |
| FR-BRW-001–006 | Managed-browser surfaces retained; V02 authenticated lifecycle pending. |
| FR-HIS-001–005 | Backward retention/cursor guards/count bound present; hydrated and long-turn active content fixed (R6-02/03, `f00671596`). |
| FR-INT-001–005 | Shared integrations retained; final cross-feature certification pending. |
| PRD §14/18/19 security/failure/resources | No full security certification performed. The new findings concern runtime state and renderer content, not a demonstrated authorization bypass or durable DB loss. |
| A11Y-001–010 / localization | Automated baseline passes; V02 manual and final locale evidence remain. |
| PRD §20 observability | Prior timing/count fixes retained; targeted tests pass. No new metric defect reproduced. |
| PRD §21–28 / design exit gates | V01–V03 remain; V04 tracks observed gate/environment errors. Definition of Done is not met. |

## Suggested order

1. ~~Fix R6-01 authoritative runtime hydration.~~ Done, `f00671596`.
2. ~~Address R6-02/R6-03 together...~~ Done, `f00671596`.
3. ~~Add permanent regressions for all three reproductions, repair V04...~~ Done (regressions + V04 `57e6dc3e8`/`8ef7091bf`); V01/V02 remain open.
4. Collect V03 before declaring parity complete or removing rollback.
