# Workspace capability parity — re-audit R4 and remaining TODO

Audit date: 2026-10-21. Reviewed HEAD: `5df878d38`, branch `workspace-v2-capability-parity`, worktree `workspace-parity`.

Authorities: [worktree PRD](./ai-chat-workspace-v2-capability-parity-prd.md), [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md), [previous R3 report](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21-r3.md), and [earlier reproduced R01–R06](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21.md).

**Verdict: not complete.** The previous fixes are implemented and their normal suites pass. This incremental re-audit reproduced **four remaining bugs** in actual renderer stores/recorder code using controlled transport/media dependencies. Release certification also remains incomplete. These findings include pre-existing problems exposed by broader boundary checks; they are not all regressions introduced by the latest commits.

No application fixes were made. Only this report is intended for commit. The pre-existing untracked `...audit-todo-2026-10-20.md` was preserved.

## Verification on this revision

| Check | Result |
| --- | --- |
| `yarn test:components` | **159 files / 1,312 tests passed** before inserting audit fixtures. |
| Targeted main-process tests, command below | **17 files / 156 tests passed**. |
| `yarn typecheck` | Passed, 23.42 seconds. |
| `yarn vue-typecheck` | Passed, 39.35 seconds. |
| Focused store reproductions | **3 failed assertions**: cross-selection history, history window eviction, batched image resolution. |
| Focused recorder reproduction | **1 failed assertion**: acquired tracks remain open after recorder construction fails. |
| Full Electron E2E, full module/main suites, live speech/browser, manual accessibility, production soak | Not performed in this audit. Historical green runs do not certify the new HEAD. |

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

The duplicate internal TypeScript gate was skipped for that command; standalone typechecks are recorded separately. Logs are `/tmp/parity-r4-{components,main,typecheck,vue,repro-components,repro-recorder}.log`.

Temporary reproductions were copied from the existing identity/recorder test harnesses, then removed from the worktree. Copies remain locally at `/tmp/auditR4.test.ts` and `/tmp/auditR4Recorder.test.ts`; these temporary artifacts are not committed or permanent regression coverage. To repeat, copy the first under `test/vitest/main/components/store/` and the second under `test/vitest/main/`, then run:

```sh
yarn test:components auditR4 -t AUDIT_R4
AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run \
  test/vitest/main/auditR4Recorder.test.ts -t AUDIT_R4
```

The four failures are assertions about production state, not compilation or setup errors. Filtered-out tests in these runs are not release skips. Media and IPC are controlled dependencies; no live microphone or provider was involved.

## Prior fixes checked

| Earlier finding | Current assessment |
| --- | --- |
| R01: mutable voice owner | Captured owner is now passed into `stillOwnsComposition`; the ownership component suite passes. Original finding addressed. |
| R02: dispose during microphone acquisition | Acquisition generation invalidates late streams; recorder tests pass. Original reproduction addressed. New failure path is R4-02 below. |
| R03 / D01: pending-to-run identity and steer/cancel | Source IDs now ride detail events; exact identity is preferred; pending cancellation/application retires unbound rows; generated-image steering is rejected without dropping references. Store/component/module regression suites pass. Do not reopen the original FIFO defect without a new reproduction. |
| R04: cleanup required mounted center | Consumer now lives in `composerDrafts`; route absence alone no longer removes it. Its batched watcher still loses intermediate resolutions: R4-03. |
| R05: attachment retry identity | Renderer includes file bytes; main compares SHA-256 request digests and cleans redundant staged references. Identity/model/module tests pass. |
| R06: repeated cumulative telemetry | Realm/sequence tracking and aggregate deltas replace repeated summation; metrics tests pass. |
| G01 / D02: journey measurement begins late | `onComposerSend` stamps before command routing and threads the epoch through preflight/encoding to main. Delayed-encoding component coverage and IPC timing tests pass. Original gap addressed. |
| V01–V03: certification | Still open; see release checklist below. |

## Bugs and required fixes

### R4-01 — P1: an in-flight history request inserts conversation A's content into conversation B

- [x] Guard history-page application with captured conversation **and selection generation**, including cursor, `hasOlder`, and loading-state mutations.
  Fixed with permanent regression suites in `test/vitest/main/components/store/selectedConversation.historyWindow.test.ts` (A→B, A→B→A, route deselection, delayed rejection while a newer page is in flight, valid same-generation paging). `loadOlder` now snapshots the immutable selection generation plus a monotonic attempt id; every post-await mutation (messages, cursor, `hasOlder`, eviction) applies only while the attempt is still current, the selection handshake invalidates in-flight attempts and owns a fresh `loadingOlder` state (including `loadSelection(null)`), and a stale `finally` never clears a newer attempt's flag.
- **Requirements:** FR-LIF-002/004, FR-HIS-001/004; selected-conversation isolation and technical design §17 bounded paging.
- **Location:** `src/views/store/selectedConversation.ts:984–1004`. `loadOlder()` captures A for the request but, after awaiting `loadHistoryPage`, writes to the shared presenter/cursor without rechecking selection. In contrast, `loadSelection()` at :894 uses a generation guard.
- **Reproduce:** Select A with an older-page cursor. Start Load older and hold its IPC reply. Switch to B and complete B's snapshot. Resolve A's page with message `private-a`.
- **Observed:** B's current `store.messages` contains `private-a`. The focused expectation `store.messages.some(m => m.id === 'private-a') === false` fails with `true`. A's page also overwrites B's paging cursor and flags.
- **Impact:** Private content is visibly mixed across conversations. This demonstrates renderer isolation failure, not a server-side authorization bypass. Later page requests may use the wrong cursor, and A's `finally` can interfere with B's loading state.
- **Fix detail:** Give each load an immutable selection/request token. Discard all stale results and make loading ownership token-specific. Reset/invalidate the old pagination operation on selection change without letting its eventual `finally` clear a newer operation's flag.
- **Done when:** Permanent tests cover A→B, A→B→A, route deselection, delayed rejection and a new B page in flight. Assert messages, cursor, availability and loading state all belong to the current generation; valid same-generation paging still works.

### R4-02 — P1: recorder initialization failure leaves an acquired microphone stream open

- [x] Make post-acquisition recorder setup exception-safe and release tracks/timers/state on every failed initialization stage.
  Fixed in `src/views/components/aiChatV2/voice/BrowserVoiceRecorder.ts`: the whole post-acquisition setup (MIME probing, recorder construction, callback wiring, state arming, `recorder.start()`) now runs as a guarded transaction — any failure releases the stream's tracks, detaches the half-constructed recorder's callbacks, clears the armed timer, resets state/chunks/selection and re-propagates the ORIGINAL error; a generation guard keeps a superseded failure from tearing down a newer session. Permanent coverage added to `test/vitest/main/browserVoiceRecorder.test.ts` (probe throw, constructor throw, start throw with armed timer, retry after failure, ambient dispose is a no-op, original error propagation); the existing late-acquisition regression (audit R02) is retained. The composer catch (`AiChatV2Composer.vue`) needs no extra dispose: after rollback the recorder holds no resources.
- **Requirements:** FR-VOI-003/010, PRD §18 failure handling and §19 resource lifetime.
- **Location:** `src/views/components/aiChatV2/voice/BrowserVoiceRecorder.ts:145–182`: `this.stream` is adopted before MIME probing, recorder construction and `recorder.start()`, with no rollback catch. `AiChatV2Composer.vue:1078–1098` catches `start()` failure and shows a notice but does not dispose the recorder.
- **Reproduce:** Let `getUserMedia` return a stream with a track; inject a recorder factory that throws `unsupported recording device`. Await rejected `start()` and inspect track-stop count before explicitly disposing the test recorder.
- **Observed:** Track-stop count is **0**, expected **1**. The test disposes afterward so it does not leak its fake resource. At constructor failure no max-duration timer has been armed, so the stream has no automatic timeout cleanup.
- **Impact:** The UI displays a failed recording while the microphone stream remains acquired until later disposal. A retry can replace the stored stream reference before releasing the previous one. The later `recorder.start()` exception path also lacks rollback; that additional stage was source-traced, not separately reproduced here.
- **Fix detail:** Use a guarded acquisition/setup transaction: release the adopted stream on failure, detach callbacks, clear any timer, reset recorder/state/chunks and propagate a classified error. Preserve generation checks so one failed start cannot stop a newer session.
- **Done when:** Cover MIME probing, constructor and start exceptions, failed start then retry, normal success, and concurrent dispose. Assert each stale/failed stream is stopped once, no timer survives, and the next recording can start normally. Retain the existing late-acquisition regression.

### R4-03 — P2: the app-scoped image cleanup watcher loses intermediate run resolutions

- [x] Consume every resolution using an explicit queue or immediate idempotent dispatch; do not treat one asynchronously watched “last event” ref as an event queue.
  Fixed with the immediate synchronous dispatch option: the selection store now publishes each resolution through a registry (`subscribeResolvedReferenceRuns`) in publish order, synchronously at the publish site, in addition to updating the ref (kept for readers/assertions). The composerDrafts cleaner attaches through that registry instead of the batched watcher, so a burst is consumed one resolution at a time; unregistered/unknown ordinals remain no-ops and the D01 acceptance-replay re-publish (`republishResolvedRun`) keeps converging after the snapshot is stored. The resolved-resolution history map is bounded (256, FIFO). Permanent coverage in `test/vitest/main/components/store/composerDrafts.resolutions.test.ts`: two-run burst, complete+failed+cancelled mixed burst, cross-conversation burst, replay-before-registration, duplicate detail/summary terminals consuming once.
- **Requirements:** FR-IMG-002/015, FR-LIF-004, AD-005; exact accepted-reference lifetime.
- **Location:** `src/views/store/composerDrafts.ts:190–213` watches `lastResolvedReferenceRun` with Vue's default batched flush. `selectedConversation.ts:578` replaces that single ref for each resolution. Synchronous early-fact replay and `republishResolvedRun()` are also supported paths in the same store.
- **Reproduce:** Accept run-one with image-one and run-two with image-two. Register their distinct clear snapshots. Deliver their successful summary terminals synchronously, then flush Vue updates.
- **Observed:** Only image-two is removed; image-one remains. Expected `[]`, received `[{ messageId: 'image-one', imageIndex: 0 }]`. Both terminal facts were sent through the real store summary callback and resolved by run identity.
- **Boundary:** This reproduces a same-flush burst at the store boundary. It does not claim separately scheduled Electron messages always coalesce or that a physical runtime burst was observed. The current contract is still lossy whenever replay/dispatch publishes more than one resolution before the watcher runs.
- **Impact:** A successfully consumed image remains selected and its cleanup record remains pending, so a future instruction can unintentionally reuse it. Moving the watcher to app lifetime fixed unmounting but not event delivery semantics.
- **Fix detail:** An explicit resolution queue/direct app-scoped consumer is preferable. A synchronous watcher can address this batching case but must also preserve the existing acceptance-before-snapshot replay handling and idempotency. Bound and retire retained resolution history after safe consumption.
- **Done when:** Test multiple completions in one flush, different conversations, completion mixed with cancel/error, replay before snapshot registration, remount and duplicate detail/summary terminals. Every successful snapshot is consumed once; failed/cancelled references and newer selections remain.

### R4-04 — P2: “Load older” discards the requested page once the transcript reaches 200 rows

- [x] Make transcript window eviction aware of paging direction and preserve the server's exhausted-history state.
  Fixed: `workspaceStreamPresenter.trimToWindow` is direction-aware (`retain: "newest"` keeps streaming semantics; the loadOlder eviction uses `retain: "oldest"` so the just-requested older range survives a full window — the 200-row bound is preserved and the newest end stays recoverable through the live stream and the selection snapshot reseed, the way back to the live tail). `hasOlder` always reflects the server's page verdict (the unconditional `= true` after eviction was removed — completed together with R4-01's guard commit). Permanent coverage in `test/vitest/main/components/store/selectedConversation.historyWindow.test.ts`: full-window retention with `nextBefore: null`/`hasOlder: false`, backward paging across more than 200 rows with cursor-continuity assertions and reseeded tail return, empty/duplicate pages with cursor advancement, and streamed rows arriving during history view staying appended and navigable.
- **Requirements:** FR-HIS-001/005, PRD §19 bounded transcript, technical design §17.
- **Location:** `selectedConversation.ts:994–1010` prepends older rows, calls `evictBeyondWindow()`, then unconditionally sets `hasOlder = true`. `src/views/utils/workspaceStreamPresenter.ts:812–816` prepends correctly, but :855–857 retains only the **last** 200 rows. The center's Load older control is at `AiChatCenterSurface.vue:115–122`.
- **Reproduce:** Seed a full 200-row current window and a valid older cursor. Return a page containing one previously unseen older message, with `nextBefore: null` and `hasOlder: false`.
- **Observed:** The requested older message is absent immediately after `loadOlder()`; the focused retention assertion fails. Source also shows that the backend's `hasOlder: false` is overwritten with true. The test's later flag assertion is not reached because its retention assertion fails first.
- **Impact:** Once full, the transcript cannot navigate further backward: newly fetched history is immediately evicted while the cursor advances past it. At exhaustion the UI can leave Load older visible even though a null cursor makes further clicks do nothing.
- **Fix detail:** When paging backward, retain the requested older range and evict the opposite end while preserving scroll position and a way back to the live tail. Do not remove the 200-row bound. Track whether older history actually exists rather than setting true after every trim.
- **Done when:** Page backward across more than 200 messages, verify newly loaded content remains navigable and no cursor gaps occur, then return to the live tail. Test exhausted history below and at capacity, empty/duplicate pages and new streamed rows while viewing history. The control disappears or disables accurately at exhaustion.

## Remaining release / implementation evidence

### V01 — Successful voice path

- [ ] Add/run the default-route record → successful transcription → merge draft → auto-send → spoken-response journey with a deterministic runtime stand-in; document a separate configured real-runtime check.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts:7–10` explicitly describes absent speech runtime/models. It exercises setup/failure/cancel, not successful speech. No new success E2E was added by the reviewed updates.
- **Done when:** One accepted send, correct origin draft/attachments, configured speech policy, safe selection changes, and retained draft on failure are observed. Clearly label mocked versus real speech evidence. FR-VOI-001–010; PRD §17.8/22/23.

### V02 — Accessibility, authenticated browser and final regression

- [ ] Record keyboard completion and focus enter/trap/return for queue, plans, permissions, email review, reporting, images, workspace and voice controls.
- [ ] Record one-time announcements, inactive-conversation focus isolation, reduced motion, narrow widths and 200% scaling; name platform and assistive technology.
- [ ] Exercise an authenticated managed-browser start → handoff/approval → verify → resume → stop, including expiry, stale actions and route return. Separate deterministic fixture coverage from live-account certification.
- [ ] After the four fixes, rerun typechecks, components, affected main/module tests and full Electron E2E; document all failures/skips. Verify all six locale keys for any new UI copy.
- **Evidence:** The previous report's manual/real-runtime gaps remain; the new commits address D01/D02 and tests, not certification records. Current unit gates above are fresh, but full E2E and manual checks were not rerun. Existing automated accessibility coverage is a subset. Requirements: A11Y-001–010, FR-BRW-001–006, PRD §22/28.

### V03 — Soak and sign-off

- [ ] Attach the technical design's rolling 14-day soak: at least 500 accepted submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejects, and exercised restart recovery ≥99%.
- [ ] Record no open severity-1/2 parity defects and zero confirmed duplicate delivery, duplicate continuation, cross-conversation event or authorization-bypass incidents; obtain required owner sign-offs.
- [ ] Keep V2 functional until the separately approved rollback-removal decision; extend low-volume soak as specified in the technical design.
- **Evidence:** No new soak/sign-off artifact was identified in the changes reviewed. R4-01/R4-02 must be fixed before declaring high-severity parity defects closed. These are release gates, not tasks that a source-only review can certify. See design AD-009 and PRD §21/24/28.

## Requirement coverage disposition

This is an incremental audit of the updated worktree plus adjacent failure paths, not a fresh manual certification of every acceptance case. “Present” means previously mapped reachable implementation remains; normal suites were rerun but not every external integration. The worktree's owner-approved architecture deferral remains valid; missing proposed extraction filenames alone are not new blockers.

| Requirement family | Current disposition / remaining work |
| --- | --- |
| FR-SUB-001–009 | Payload/acceptance/retry identity present; prior byte-identity and journey fixes covered by passing tests. Final E2E pending. |
| FR-CMD-001–009 | Shared routing/goal/loop/skill paths present; command interception preserved. Final regression pending. |
| FR-QUE-001–014 | Durable queue and source identity fixes present; targeted tests pass. No new queue execution defect reproduced. |
| FR-PLN-001–009 | Strict decisions and continuation present; IPC tests pass. Final E2E pending. |
| FR-PER-001–008 | Permission/parked continuation surfaces present; final runtime/accessibility checks pending. |
| FR-OUT-001–010 | Frozen authorization and dedicated review present; final delivery regression and safety certification pending. |
| FR-IMG-001–015 | Tray/batch/chooser/retry/save present; D01 addressed, R4-03 remains. |
| FR-RPT-001–009 | Single-output/conversation reporting present; R4-01 contaminates the visible transcript and must be corrected before isolation certification. No report-data leak was separately reproduced. |
| FR-VOI-001–010 | Original owner/acquisition fixes present; R4-02 and V01 remain. |
| FR-WSP-001–010 | Workspace/trust/watcher/memory surfaces present; platform/runtime certification pending. |
| FR-REC-001–008 | Recovery/retry/compaction presentation present; final recovery exercise pending. |
| FR-LIF-001–006 | Selected detail generation guards present; older-page async path bypasses them (R4-01); image consumer loses bursts (R4-03). |
| FR-SKL-001–006 | Installation/approval/prompt-skill paths present; final integration checks pending. |
| FR-BRW-001–006 | Managed-browser surfaces present; V02 authenticated journey pending. |
| FR-HIS-001–005 | History/chips/opaque references present; ordinary paging has R4-01/R4-04. |
| FR-INT-001–005 | Shared integrations present; final cross-feature regression pending. |
| PRD §14/18/19 security, failures, resources | R4-01 isolation, R4-02 microphone lifetime and R4-04 bounded navigation remain. This is not a comprehensive security certification. |
| A11Y-001–010 and localization | Automated baseline passes; V02 manual certification and final six-language verification remain. |
| PRD §20 observability | Prior cumulative-count and late-click findings addressed; passing targeted tests. No new telemetry defect reproduced here. |
| PRD §21–28 / technical design exit gates | V01–V03 remain; Definition of Done is not met. |

## Recommended order

1. Fix R4-01 and R4-02 with permanent regression tests.
2. Fix R4-03 and R4-04 without weakening identity or bounded-memory requirements.
3. Complete V01/V02 on the final revision.
4. Collect V03 evidence before declaring parity complete or removing the rollback route.
