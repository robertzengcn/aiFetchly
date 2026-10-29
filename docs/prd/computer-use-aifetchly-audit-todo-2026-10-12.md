# Computer Use implementation audit and remaining TODO

Date: 2026-10-12  
Audited worktree: `/home/robertzeng/project/aiFetchly/.claude/worktrees/computer-use`  
Audited commit: `679c8545c06cc35ceb3451bc4d4fdd22413ee7ee` (clean before audit)

## Verdict and scope

**No: the PRD and technical design are not fully implemented.** This worktree contains useful foundations and tests, but production Computer Use sessions cannot start. `src/main-process/communication/index.ts:166` installs stub dependencies: no windows or sessions, constant `not_installed` readiness, and unconditional `backend_unavailable` on start. No production constructor call connects the supervisor, grounding client, or MCP session pool. The existing host implementation plan explicitly records dropped work; those deferrals do not satisfy the PRD.

Sources of truth were the two user-specified files under `/home/robertzeng/project/aiFetchly/docs/prd/`. Their contents match the worktree copies byte-for-byte:

- [Product requirements v1.4](computer-use-aifetchly-prd.md)
- [Technical design v1.4](computer-use-aifetchly-technical-design.md)
- Context only: [host implementation plan](computer-use-host-implementation-plan.md)

This audit reviews host implementation and integration, not the contents of an external plugin or Hub repository. Plugin packaging/model exports and Hub distribution remain external acceptance dependencies. macOS is Phase 3; offline bundles and multi-display support are later scope, not Phase 1 defects. No Windows, Excel, GPU, or packaged macOS execution was available in this Linux audit.

Severity: **P0** must be fixed before enabling desktop input; **P1** blocks the relevant functional milestone; **P2** is correctness/coverage work before qualification. P0 findings below are latent in the supervisor because the production entry remains disabled; they are not claims of currently reachable desktop control.

Evidence labels: **Reproduced** = exercised directly against current code with fake adapters; **Static** = demonstrated by the source path; **Missing** = required production path/artifact not found. Tests passing is not equivalent to native or product acceptance.

## Verification performed

- Source/registration/call-site review across supervisor, safety, grants, worker/adapters, MCP transport/pool/tool service, runtime installation, schemas, preload, UI, translations, build wiring, and tests.
- Ran the following focused suite with its normal global TypeScript gate, without bypassing type checking:

```sh
yarn vitest run --config vite.main.config.mjs \
  test/vitest/main/service/computerUse \
  test/vitest/main/service/localAiRuntime/LocalAiRuntimeCatalogV2.test.ts \
  test/vitest/main/service/MCPSessionPool.test.ts \
  test/vitest/main/modules/mcp \
  test/vitest/main/MCPClientConnectTimeout.test.ts \
  test/vitest/main/MCPTimeoutError.test.ts
```

**Result: 11 files, 132 tests passed; TypeScript gate passed.** This was not the full repository test suite. No UI was changed, and no Computer Use component/E2E suite exists to validate the missing surface.

An isolated temporary Node/ts-node reproduction (no source changes) reported:

```text
session ID accepted by IPC: false
consequential without approval/observation/verification: outcome=succeeded
adapter input calls after stop during safety: 1
pause during verification: session_state_invalid
state after stop then late verification: READY
TSV with embedded newline: "Alice\n=1+1"
extra readback row accepted: true
```

The reproduction constructs `ComputerUseSupervisor` with an injected adapter, registers an accessibility target without observing, and uses deferred promises to stop during safety checks/verification. These cases should become committed regression tests when fixed. Only this audit document is changed by the audit.

## A. Defects in existing implementation

### A01 — P0: Stop can finish before a pending action dispatches

- [x] **Reproduced.** `src/service/computerUse/ComputerUseSupervisor.ts:382–420`: grant validation precedes the awaited safety check. After that await, the code unconditionally sets `EXECUTING` and calls the adapter, without rechecking state, generation, lease, grant, or target freshness.
- Reproduce: defer `preDispatchCheck`; dispatch; await `stopSession`; resolve safety with `{ allowed: true }`. The adapter receives one input call after stop completed. The later outcome check cannot undo this input.
- Fix: bind immutable dispatch context to the original generation, revalidate after every asynchronous pre-dispatch operation, and atomically refuse dispatch after revocation. Bound adapter cancellation and prevent queued work from crossing the stop boundary.
- Acceptance: stop at every await boundary; zero input after acknowledgment, including queued actions, slow integrity checks, and expired grants. Requirements: CU-SESSION-04/06/08/13, design §10.4.

### A02 — P0: Late completion revives stopped sessions; Pause rejects active work

- [x] **Reproduced/Static.** `ComputerUseSupervisor.ts:190–250, 426–464`: Pause accepts only `READY`/`PAUSED`. It rejects `OBSERVING`, `AWAITING_AUTHORIZATION`, `EXECUTING`, and `VERIFYING`. Verification completion unconditionally writes `READY`; observation and dispatch catch paths can write `PAUSED` after stop.
- Reproduce: defer `adapter.verify`, stop the session, resolve verification. Summary becomes `READY` even though stop released the desktop lease. Pause during verification returns `session_state_invalid`.
- Fix: make stop terminal for that session generation; guard success and error continuations; invalidate authority on pause/handoff; support takeover during active operations. Do not let a late callback revive an old owner.
- Acceptance: lifecycle interleavings cover observation, safety, input, verification, pause/handoff, stop, and a subsequent competing session. CU-SESSION-02/04–06.

### A03 — P0: Grants are minted without a permission decision

- [x] **Reproduced.** `ComputerUseSupervisor.ts:369–380` calls `authorization.mint` for every request. `ComputerUseActionAuthorization.ts:67` records the supplied class without checking current-task permission. `requiresExplicitAuthorization` exists but has no enforcing call in dispatch.
- A consequential request with no user approval dispatches successfully. Grant hashing protects request identity; it does not establish authority to save, send, delete, share, overwrite, or pay.
- Fix: implement host-owned task authority, trusted action classification, approval challenges and revocation, distinct capture/input/debug/image-routing grants, and deny-by-default behavior. Never accept a model's classification or observed text as permission.
- Acceptance: final-action and overwrite tests remain blocked until a matching current-task approval; changed action/target/observation invalidates approval. CU-PERM-02–05/07, W-1 stop point.

### A04 — P0: Target handles do not enforce observation or window scope

- [x] **Reproduced/Static.** `ComputerUseSupervisor.ts:258–318, 358–420`; `ComputerUseTargetStore.ts:47`; `ComputerUseSafetyService.ts:109–167`.
- Accessibility targets can be minted without an actual observation and with arbitrary points/regions. The supervisor does not compare `request.observationId` with the stored target, nor require the latest observation. Caller-supplied `request.point` overrides the target point in safety checks and is passed unchanged to the adapter. Targets are reusable after actions until TTL expiry. Store records have no session identity; generations restart at 1 for each session.
- Fix: store session/window/observation fingerprints and transforms; validate finite, in-bounds points/regions; derive executor coordinates only from the host target; invalidate used observations and handles on state changes; enforce one action per observation. Reject target creation for inactive sessions and late results from a previous session.
- Acceptance: foreign-session handles, fabricated observations, point overrides, NaN, moved windows, display changes, repeated handles, and stale results never dispatch. CU-VISION-04/05, CU-PERM-03/07, design §9–11.

### A05 — P0: Required safety checks are optional or incomplete

- [x] **Static.** `ComputerUseSupervisor.ts:60–93, 101–159` allows startup without safety or a stop controller and only checks that a listed window exists. It does not call `assertHostNotElevated`, reject elevated/own targets at selection, or verify single-display support.
- `ComputerUseSafetyService.ts:109` skips integrity checks when PID is null; keyboard checks only reject AiFetchly focus, not another app's focus. Pointer checks reject rectangles belonging to AiFetchly but do not prove the selected target owns the window at the point. `ComputerUseElevationService` caches process integrity; no production observation path clears that cache.
- Fix: make release-critical controls mandatory in production composition, refuse unknown target identity, validate foreground/window-at-point ownership immediately before input, and enforce integrity at selection and dispatch.
- Acceptance: own windows, null/unknown PID, host elevation, elevated target, other foreground apps, occluded targets, and unsupported displays all fail closed. CU-SESSION-08–12, design §10.5.

### A06 — P1: Stop has unbounded cleanup and incomplete lifecycle ownership

- [x] **Static.** `ComputerUseSupervisor.ts:115–143, 163–186`: stop awaits adapter disposal without a deadline or forced termination. There is no grounding-worker cancellation, held-key/button release, or clipboard restoration. A thrown hotkey `register` occurs outside startup cleanup and can leak the desktop lease; an unregister failure can prevent stop from releasing it.
- Fix: guaranteed revocation plus bounded cleanup in `finally`, forced process-tree shutdown, worker kill, input release, clipboard restoration, and cleanup for every startup failure. Wire sleep/resume, lock, target closure, disconnect, display change, and app quit.
- Acceptance: hung disposal still completes within the measured budget; injected register/unregister failures leave no lease/hotkey/process; no automatic input replay. CU-SESSION-03–06/08/13.

### A07 — P1: Supervisor IDs are rejected by its IPC control schemas

- [x] **Reproduced.** `ComputerUseSupervisor.ts:103` produces `cus_<uuid>`, but `src/schemas/ipc/computerUse.ts:15` validates the complete session ID as a plain UUID.
- Fix: use one shared session-ID contract for generation, start result, Stop, Pause, Resume, and UI calls.
- Acceptance: round-trip the actual default start result through every control schema; reject malformed IDs. CU-SESSION-04, design §9.

### A08 — P1: Successful input is reported without verification; rejected actions can wedge the session

- [x] **Reproduced/Static.** `ComputerUseSupervisor.ts:382–411, 445–478`: missing `adapter.verify` produces `succeeded`; safety denial leaves state at `AWAITING_AUTHORIZATION`, where neither dispatch nor Pause works. Post-input errors are generic `failed` rather than necessarily uncertain. Early failure/rejection/cancellation outcomes are not appended to the action log.
- Fix: explicit verified/uncertain outcomes; state cleanup for every branch; preserve all attempt records; classify post-dispatch timeout/crash as `execution_uncertain` and require fresh observation before retry.
- Acceptance: absent verification never proves task completion; denial is recoverable; uncertain actions are not automatically repeated. CU-VISION-06/07, design §9.3/10.4/13.4.

### A09 — P1: Electron grounding transport does not match the actual API

- [x] **Static, checked against installed Electron types and existing worker patterns.** `src/childprocess/computer-use/GroundingWorker.ts:198` passes the parent-port message event directly to `server.handle`; other utility workers unwrap `event.data`. The switch therefore sees no `type` for real parent-port events.
- `ComputerUseGroundingClient.ts:20–22, 117–124` passes an `ArrayBuffer` in the transfer list. Installed `node_modules/electron/electron.d.ts:15877` declares `MessagePortMain[]` for `UtilityProcess.postMessage`, not Web Worker `Transferable[]`.
- Fix: use Electron's event envelope and supported payload/port transport, with runtime schema validation on both sides. Do not claim zero-copy image transfer through an unsupported API.
- Acceptance: launch the packaged worker through real `utilityProcess.fork`; load, ground with an image, cancel, unload, malformed-message rejection, and exit all work. Direct calls to `GroundingWorkerServer.handle` do not cover this boundary. CU-VISION-09/12, design §5.6.

### A10 — P1: Worker replies are not correlated with the pending request

- [x] **Static.** `ComputerUseGroundingClient.ts:103–141, 168–232, 268`: only one generic pending reply is tracked; results/errors are not matched against request key and observation. Cancel/timeout clears that slot without ensuring the old inference has stopped. A late response for A can resolve/reject a newly submitted B. Old worker exit callbacks can also affect a newly loaded worker.
- Fix: correlate worker instance, session, generation, request key, and observation; validate outbound shapes; enforce a watchdog kill after timeout/cancel; prevent concurrent native runs and stale callbacks. Clean pending state when `postMessage` throws.
- Acceptance: cancel A/start B/late A, timeout A/start B, old-worker exit after reload, invalid payloads, and hung ONNX runs cannot poison B or mint a target. CU-VISION-05/09/12/14.

### A11 — P1: GUI-Actor adapter is not an executable reference inference implementation

- [ ] **Static.** `src/childprocess/computer-use/grounding/GuiActorOnnxAdapter.ts:149–232`: load creates decoder and pointer sessions but never creates/runs the required vision encoder. Ground invokes only the pointer graph with raw `ArrayBuffer` and text string; there is no tensor construction/tokenization, normalized/patchified image pipeline, decoder prefill, or applied crop/resize corresponding to the recorded geometry.
- Fix: implement design §5.2–5.4 against a pinned, reviewed graph/tokenizer contract and golden tensors. Validate graph input/output metadata; release partially created sessions if provider initialization fails. Keep readiness unavailable until inference/probes pass.
- Acceptance: actual model inference under Electron/ONNX reproduces all pipeline stages and crop/resize fixtures on qualified providers. Producer exports are an external dependency, but the host adapter implementation remains host work. CU-VISION-02/04/08–10/12.

### A12 — P1: Grounding ambiguity and region mapping are incorrect

- [ ] **Static.** `GuiActorOnnxAdapter.ts:decodePointerOutputs` fabricates a second score at half the first and uses the whole-grid centroid, rather than detecting separate competing peaks. With the default ambiguity ratio 0.85, that manufactured runner-up cannot identify two equally plausible controls. Zero-signal output becomes `output_invalid`, and `roundedScore || 0.5` replaces a low rounded score with 0.5.
- `ComputerUseSupervisor.ts:308–312` maps the point to capture pixels but sizes the region in model pixels, omitting inverse resize/padding/crop mapping.
- Fix: calibrated model-specific candidate extraction/absence handling, finite tensor/dimension validation, exact region transforms, and no arbitrary score fallback.
- Acceptance: separated equal peaks return ambiguous; absent targets never create a handle; point and region agree under anisotropic resize, padding, and crops. CU-VISION-04/07/08/11/15.

### A13 — P1: Install-set consent is not bound to the installed bytes

- [x] **Static.** `src/modules/LocalAiRuntimeModule.ts:615–625` stores `identityHash`, but `installSet` and `runModelPipeline` re-fetch entries and compare only runtime version (`:679–692`, `:805–812`). The stored hash is never used to reject a same-version artifact replacement.
- Fix: consume a one-use offer bound to exact selected IDs/versions/hashes, target and configuration; compare identity before any download. Reject altered native SHA/model manifest SHA and concurrently replayed consent.
- Acceptance: same version with changed hash fails before network download; cancellation/expiry/replay cases pass. CU-INST-06/13, design §7.8.

### A14 — P1: Install-set selection uses incompatible catalog paths

- [x] **Static.** `LocalAiRuntimeModule.ts:563–601, 677–692, 732–762`: native/model v2 selection takes the first matching ID/kind without platform, architecture, Electron ABI, app-version, provider, or adapter compatibility checks. Install then obtains native entries from the existing v1 `catalog.getCatalog()` even though consent was prepared from v2. The intended v1 catalog has no grounding runtime.
- Fix: complete v2 fetch/cache and compatibility selection end to end; use the consented v2 entry throughout; validate model adapter/contract/processing and provider compatibility before offering installation; skip identical healthy runtime installs.
- Acceptance: shuffled cross-platform catalogs select correctly; incompatible configurations fail with a reason; runtime+model installation works from v2 alone and leaves v1 publishing unchanged. CU-INST-02/04/09/12/15/18, CU-VISION-13.

### A15 — P1: Model activation ignores current-version leases and model health

- [x] **Static.** `LocalAiRuntimeModule.ts:855–891` only tests whether the incoming version is leased, then flips `active.json` even if the old version has live users. No full model health probe runs. `deferActivation` exists in the coordinator but has no production caller. Neither the supervisor nor grounding client acquires runtime/model leases.
- The model pipeline deletes an existing same-version directory before replacing it, risking the working installation on failed repair. Pruning skips active/leased versions but not pending activation; release does not trigger model pruning. Pending activations are in memory only.
- Fix: pin both resources in session and worker; stage/probe before activation; defer while any current version is used; preserve working bytes on repair failure; persist/reconcile pending activation; prune on lease release and protect pending versions; remove associated partials deliberately.
- Acceptance: hold old-version leases, install update, restart/stop/release, inject probe/rename failure, then remove/repair. Active resources remain valid until safe activation. CU-INST-08/09/16/17, CU-VISION-14.

### A16 — P1: Interrupted downloads discard already completed files

- [x] **Static.** `LocalAiRuntimeFileSetDownloadService.ts:452–466` renames each verified `.part` into staging; `LocalAiRuntimeModule.ts:893–894` deletes staging on failure. If shard A finishes and B fails, retry must download A again because its cached part was moved and then deleted. Restart creates another operation directory without a completed-file reuse mechanism.
- Fix: durable content-addressed verified files or resumable operation state; retain completed files across network failure, cancellation, and restart, with integrity rechecks before reuse.
- Acceptance: finish A, interrupt B, restart and resume; A transfers zero bytes and only missing/corrupt files download. CU-INST-14.

### A17 — P2: Downloader timeout and range validation are incomplete

- [x] **Static.** `LocalAiRuntimeFileSetDownloadService.ts:309–331, 469–547, 652`: only the Content-Range total is checked, not its start/end. The idle watchdog starts during body streaming, not while waiting for response headers or downloading the whole manifest; manifest `arrayBuffer()` is unbounded until complete. Shared `pendingResponse` can be overwritten by concurrent model downloads.
- Fix: per-request response ownership, exact Content-Range validation, bounded manifest streaming, header/body deadlines, redirect-body cleanup, and actionable stalled error propagation. Include aggregate disk preflight for the consented install set.
- Acceptance: stalled headers/manifest, oversized manifest, wrong range start/end, concurrent downloads, and insufficient disk fail promptly without cross-contamination or activation. CU-INST-07/14/18.

### A18 — P1: MCP session reuse is unintegrated and pool lifecycle is unsafe

- [x] **Static.** `src/service/MCPSessionPool.ts:94–123` has no pending-acquisition map: simultaneous identical acquires create multiple clients and overwrite the stored one. Idle timers start on acquisition with no borrower count, so active unpinned work can be disconnected. Existing entries are reused without a liveness check; disposal during connect can still insert a late session.
- `src/service/MCPToolService.ts:238, 604, 708` still creates and disconnects clients per operation; no production `new MCPSessionPool` call was found.
- Fix: integrate reuse with owned lifecycle/trust revocation; deduplicate connects, ref-count borrowers, evict dead clients, prevent post-disposal insertion, and isolate pinned Computer Use owners from generic MCP callers.
- Acceptance: sequential and concurrent reuse, long calls exceeding idle timeout, server death, trust/config changes, stop, and disposal during connect. D-19, CU-SESSION-03, design §4.2.

### A19 — P1: MCP shutdown/content preservation still fall short of the design

- [x] **Static.** `src/modules/mcp/SupervisedStdioTransport.ts:doClose/killChild` only signals the direct child. Owned-process registration supports application shutdown, but transport close does not itself invoke tree termination for session stop. Default escalation can also exceed the Computer Use forced-stop target.
- `src/modules/MCPClient.ts:425–493` preserves selected block fields but drops `resource_link` content and annotations/metadata rather than preserving the complete MCP content union.
- Fix: explicit per-session process-tree termination with bounded force escalation and complete validated content preservation; route sensitive image blocks through the host image policy instead of generic tool persistence/errors.
- Acceptance: a backend spawning a child cannot leave it running after session close; real stdio integration covers handshake, Unicode chunking, cancellation, death, all block types, and cleanup. D-19, CU-SESSION-03/04, design §4.1/10.4.

### A20 — P1: Excel TSV breaks cell boundaries and verification misses row-count errors

- [x] **Reproduced/Static.** `src/service/computerUse/excel/ExcelLeadListPlanner.ts:179–204` joins values without escaping/rejecting tabs, CR, LF, or quotes. A name `Alice\n=1+1` produces a second row starting with an unguarded formula marker. Exact Excel execution is not claimed here; the structural TSV and formula-guard bypass are demonstrated.
- `:220–258` checks only expected rows/defined fields, so an extra unexpected row is accepted. Text-format header patterns (`:140`) are English-only; a Chinese postal header with short leading-zero values is not protected by the long-digit fallback. Mapping's substring pass can also guess a semantic match without confirmation.
- Fix: defined Excel-safe cell serialization/validation before guarding formulas, strict row/column/count verification and cell-value normalization, Chinese phone/postal/ID detection, and explicit ambiguity confirmation. Validate 500×15 limits and duplicate/invalid column assignments.
- Acceptance: tabs/newlines/quotes, all formula prefixes, Chinese leading zeros, long IDs, extra/missing rows and ambiguous headers are covered; verify clipboard apostrophe/readback behavior in native Excel. W1-3–7, design §6.3.

### A21 — P1: Settings endpoint reports success but discards changes

- [x] **Static.** `src/main-process/communication/index.ts:189–194` installs `read: () => DEFAULT_COMPUTER_USE_SETTINGS` and `write: () => undefined`; `computer-use-ipc.ts:164–176` returns updated settings as if saved. The next read immediately returns defaults, even before restart.
- Fix: persist validated settings using the intended host store; enforce compatible installed model selection only between sessions; separate consent from merely setting visual/debug booleans; support visual mode revocation from the next observation. Explain unsupported readiness instead of always `not_installed`.
- Acceptance: set/get/restart round trips; live model changes rejected; image-provider changes require fresh consent. CU-VISION-13/14/16, CU-PLAN-01–03/07.

### A22 — P2: Safety metrics are not a native measurement harness

- [ ] **Static/Missing.** `ComputerUseMeasurementService.ts:constructor` defaults to `Date.now()` despite declaring a monotonic clock. There are no production dispatch/revocation hooks or native probe runs; clock changes can corrupt timing.
- Fix: a monotonic host clock plus calibrated native input/probe timestamps; wire stop acknowledgment, last-input, control-strip latency, worker exit, and observation/grounding spans.
- Acceptance: at least 50 native runs per safety metric, distribution and last-input evidence, not only mocked timestamp arithmetic. CU-SESSION-13, PRD §8/design §10.5.5.

## B. Missing feature and integration tasks

### B01 — P1: Connect the Windows vertical slice and public host tools

- [ ] Replace stub IPC dependencies with a single authoritative composed supervisor, real window enumeration/observation/private input adapter, installed-plugin compatibility checks, shared desktop lease, safety/hotkey services, grounding lifecycle and clipboard cleanup.
- [ ] Implement public capabilities/session/observe/find/act/verify/handoff routing in the host; prefer reliable accessibility and use grounding only when needed. Filter discovery **and invocation** of private upstream tools, including attempts through generic MCP execution. No shell/registry/broad process/filesystem capabilities on this path.
- [ ] Consume pinned schema/fixture artifacts by digest with generated/validated contracts; normalize stage, retry classification, correlation ID and safe error messages. Handwritten local types alone do not prove producer conformance.
- Evidence: stub registration cited above; no production supervisor/grounding/pool construction or Computer Use adapter registry. Design §3–4/6/8–10; D-01/02/04–07/10–13/18–20/23/26.
- Done when: a supported clean Windows machine installs the qualified plugin, selects Excel, executes an authorized observation/action/verification cycle, and stops with all safety controls active. No dependency resolution/download during session handshake.

### B02 — P1: Build the complete UI and renderer API

- [ ] Target picker excluding own/elevated windows; active target identity; non-focusable always-on-top control strip with current step/mode, Pause/Take over/Stop and shortcut; target border/preview.
- [ ] Create control-strip window/preload/build entry, capture exclusion and actual pixel masking fallback. The existing `stripMaskRect` only computes geometry; it does not mask image bytes.
- [ ] Computer Use settings, hotkey configuration/registration recovery, model list/selection/readiness, debug settings, actionable errors, and local AI components grouping/install-set consent with combined sizes.
- [ ] Add renderer API/channel wiring, all six translations, component tests and Playwright critical-flow tests. Translation keys exist in all six locales but no consuming Computer Use components were found.
- Evidence: `src/views` has Computer Use locale keys only; planned component/control-strip files are absent. PRD §7, CU-SESSION-01/04/08–10, CU-INST-01/07/12/13.
- Done when: `yarn test:components` passes and end-to-end selection/install/consent/start/pause/handoff/stop/recovery flows work in packaged builds.

### B03 — P1: Implement planner image privacy and consent routing

- [ ] Add the host planner-image service and provider/model capability checks. Default structured-text-only mode; explicit provider/model-named consent for target-window images; bounded crops/sizes; visible mode per step; revoke on the next observation.
- [ ] Suppress screenshots during login/password/verification/handoff; keep image bytes out of ordinary tool JSON, chat persistence, hooks, logs, errors and telemetry. Add local-only leak tests and consent-change tests.
- [ ] Explain that accessibility text/cell contents can still go to the remote planner in local-only mode; remote grounding remains unauthorized regardless of planner image consent.
- Evidence: no `ComputerUsePlannerImageService` or integration path; settings flags/types alone do not provide routing. CU-PLAN-01–08, CU-VISION-03/16, CU-PERM-02/05/07/08, D-15/16.

### B04 — P1: Finish local-runtime consumption and release tooling

- [ ] Wire v2 catalog fetch/cache/source selection into production, model-kind resolution, install-set schemas/channels/preload/API, file-set downloader and readiness. Current `local-ai-runtime-ipc.ts` composition does not inject `getCatalogV2`/`fileSetDownload` or expose install-set operations.
- [ ] Implement disposable grounding probes: Electron binding plus `add.onnx`, qualified model fixture inference, full verification before activation, repair/status/remove/update/reconciliation, and graceful idle-worker disposal/session deferral.
- [ ] Extend release workflow to build qualified native ONNX packages, include notices, verify ABI/providers, pin model manifests in a reviewed lock, publish both catalogs, and run the previous-app v1 consumer compatibility test. Grounding additions to the release workflow/lock were not found.
- [ ] Fix A13–A17, validate memory/disk/compatibility/license metadata before offers, and show independent code/runtime/model identities and sizes.
- Done when: production UI installs, repairs, updates and removes both components with one bound consent, preserves live versions and resumable downloads, and older apps still install embedding/voice. CU-INST-02–09/12–18, D-14/17/21/24/25.

### B05 — P1: Complete interchangeable grounding, selection and readiness

- [ ] Finish A09–A12; validate request/result schemas, required files, adapter/architecture/contract versions, preprocessing/calibration identity, resources and provider qualification. Add built-in host selection/compatibility service and reject live changes.
- [ ] Record selected **model ID/version/hash** in addition to adapter/runtime/provider identity. Current `GroundingModelIdentity`/adapter identity does not fully identify model bytes for exact replay.
- [ ] Consume held-out absence/ambiguity/parity fixtures, with the GUI-Actor implementation and second test adapter running a common contract suite. No silent model/provider substitution mid-session, remote fallback or arbitrary downloaded executable adapter.
- Done when: installed qualified model selection, load/ground/cancel/unload, switching between sessions, CPU/provider fallback-at-load, crops and exact evidence identities pass consumer/native tests. CU-VISION-01/02/04/07–16, D-03/06/08/09/17/26/27.

### B06 — P1: Execute W-1, rather than only preparing strings

- [ ] Connect lead sources/chat to existing-open-workbook selection; confirm workbook/sheet; read grid headers/used range/first empty row; ask column questions; set Text format before paste; confirm nonempty overwrites; paste and restore clipboard; format header/table/filter/autofit/duplicate highlighting; read back row count and samples.
- [ ] Offer direct export when a new file is sufficient. Enforce 500 rows/15 columns/one sheet; hand off Protected View, Enable Editing, sign-in, read-only/protected/unsupported workflows; explicitly authorize Save/Save As/Share/Close/Delete/Remove Duplicates.
- [ ] Wire clipboard cleanup on all outcomes, disclose text-only restoration, and handle overlapping paste attempts without losing the original saved clipboard. The clipboard helper currently has no production caller and permits replacing its pending saved handle.
- [ ] Fix A20 and qualify Excel 365 Current Channel/2021, English/Chinese, local/co-authored workbooks, 100%/150% scale using versioned fixtures.
- Evidence: `excel/ExcelLeadListPlanner.ts` and clipboard helper are pure utilities with unit tests, not a workflow runner. PRD §3.1; design §6.3/14.5.

### B07 — P1: Persist session/action summaries through Module and Model layers

- [ ] Add the planned Computer Use Module, models/entities/migrations as needed, and main-process persistence of complete safe summaries/outcomes. Preserve failed/rejected/uncertain attempts and stage/correlation metadata.
- [ ] Keep worker/plugin code database-free and keep sensitive images/native handles/credentials out of ordinary records. Use Token/USERSDBPATH and existing architecture.
- Evidence: current supervisor only has an in-memory bounded action log; `ComputerUseModule` and corresponding persistence were explicitly dropped in the plan. CU-SESSION-07, CU-VISION-01/15, design §3.2/9.2/13.

### B08 — P1 for Phase 2: Implement diagnostics, locate-only and offline replay

- [ ] Separate read-only locate/step-through/replay paths from input backend loading; overlay predictions without input; re-observe stale step-through targets.
- [ ] Add versioned trace storage/viewer showing capture, exact model input, candidates, transforms, mapped regions, after-state, identities and optional heatmaps; meaningful failure classification.
- [ ] Opt-in local retention/cap/cleanup, redaction and reviewed export; failure labeling into fixtures; identical-evidence configuration comparisons with latency/memory/region hits and exact replay compatibility checks.
- Evidence: no trace service, replay CLI/consumer or Computer Use debug viewer found. CU-DEBUG-01–08, CU-PERM-08, CU-VISION-15, design §13. Plugin replay tooling may be an input; host review/viewer/privacy integration remains required.

### B09 — Phase 3: Integrate and qualify the selected macOS backend

- [ ] Consume the plugin's chosen signed/notarized native helper privately; implement discovery/invocation allowlists, TCC permission readiness/revocation, Retina transforms, target scope and lifecycle controls.
- [ ] If Ghost is selected, verify patched atomic-action policy and no implicit vision/CDP/recipe/learning fallback. Do not add Python/MLX sidecars; use host grounding.
- [ ] Qualify packaged clean install/update, permission attribution, CJK, blocked MCP calls, long typing/drag stop and whole-tree cleanup on Apple Silicon; add CoreML/CPU runtime qualification.
- Evidence: no platform-specific host implementation found. CU-MAC-02/04/05, D-04/12/28; plugin CU-MAC-01/03 are prerequisites, not missing source files to implement here.

### B10 — P1: Supply release evidence and regression coverage

- [ ] Add regression tests for A01–A22, particularly real IPC/schema round trips, Electron worker transport, production composition, install-set hash binding and active-version update behavior. Existing fake-adapter tests do not establish these boundaries.
- [ ] Complete packaged worker verification and actual stop/input probe instrumentation. Run native safety gates (hotkey hidden/minimized/full-screen, strip exclusion/masking/focus, own/elevated windows, host elevation, lock/sleep/display changes).
- [ ] Run versioned W-1 benchmark arms: accessibility-only, grounder-only, combined, visual planner, and baseline comparisons. Preserve hardware/OS/app/model/artifact identity, held-out separation, success/mismatch/handoff/unauthorized-action counts, cost, cold/warm latency and RAM/VRAM.
- [ ] Publish measured qualification/compatibility and release SLOs against PRD §8; do not claim Phases 0–4 complete from unit tests. Resolve technical-design §17 decisions with evidence: Windows delivery, Mac winner, model configuration/providers/reference hardware/memory, calibrated thresholds, image policy/providers, stop hotkey, model hosting, backend extensions, debug retention/cap. GUI-Actor-3B stays blocked unless separately licensed/qualified.
- External dependencies: pinned Windows package/environment + integrity/window-at-point primitives; plugin contracts/Excel fixtures/model exports/parity/license/health data; Hub listing/install plan and later platform-aware native resources. Their source was not audited here.

## C. Requirement-by-requirement coverage

Statuses describe implementation/acceptance in this worktree, not whether a helper class exists. **Partial** means some code exists but acceptance is not met; **Missing** means no complete host path; **Boundary present** is a narrow invariant, not release qualification. Every host-owned CU requirement in PRD §6 is listed below (73 IDs). Each row points to actionable work above.

| Requirement | Status / remaining acceptance | TODO |
| --- | --- | --- |
| CU-INST-01 | Missing: qualified listing/compatibility/activation integration | B01, B02, B10 |
| CU-INST-02 | Partial: generic delivery and v2 schema, incorrect v2 selection | A14, B04 |
| CU-INST-03 | Partial: resource identities/types, no qualified end-to-end delivery | B04, B10 |
| CU-INST-04 | Partial: optional flag, no working opt-in install/readiness | B02, B04 |
| CU-INST-05 | Unverified: clean-machine Windows provisioning | B01, B10 |
| CU-INST-06 | Partial: hash checks exist, consent/install identity gap | A13, B04 |
| CU-INST-07 | Partial: download progress/cancel, incomplete integration/timeouts | A17, B02, B04 |
| CU-INST-08 | Partial: ref-count coordinator, no session/model integration | A15, B04 |
| CU-INST-09 | Partial: existing native pipeline, unsafe model update/repair | A15, B04 |
| CU-INST-10 | Deferred by PRD: offline bundle option, not Phase 1 blocker | Future separately approved scope; qualify complete resource closure |
| CU-INST-12 | Missing production grounding components management | B02, B04 |
| CU-INST-13 | Partial offer logic; hash binding/UI/IPC missing | A13, A14, B02, B04 |
| CU-INST-14 | Partial per-file resume; completed shards lost on failure | A16, A17 |
| CU-INST-15 | Partial v2 parsing/cache paths; no dual publication/old-app proof | B04, B10 |
| CU-INST-16 | Partial lease/defer primitives; activation bypasses them | A15 |
| CU-INST-17 | Partial pruning; pending/lease-release/partial-file cleanup gaps | A15, B04 |
| CU-INST-18 | Partial RAM and per-download disk checks; no qualified full offer | A14, A17, B04, B10 |
| CU-SESSION-01 | Missing actual target selection and visible session | B01, B02 |
| CU-SESSION-02 | Partial lease helper; terminal-state/ownership gaps | A02, A06, B01 |
| CU-SESSION-03 | Partial SDK/pool/worker; no persistent production composition | A18, A19, B01 |
| CU-SESSION-04 | Partial controls; post-stop input and pause defects | A01, A02, A06, A07, B02 |
| CU-SESSION-05 | Missing input/focus event integration; unsafe focus checks | A02, A05, B01 |
| CU-SESSION-06 | Partial generation helper; lifecycle invalidation missing | A02, A04, A06, A10 |
| CU-SESSION-07 | Boundary present: new grounding worker has no DB access; persistence missing | B07 |
| CU-SESSION-08 | Partial hotkey service; optional/unwired and no native proof | A05, A06, B02, B10 |
| CU-SESSION-09 | Missing strip/overlay/capture masking integration | B02 |
| CU-SESSION-10 | Partial rectangle/filter helpers; no enforced target ownership | A04, A05, B02 |
| CU-SESSION-11 | Partial integrity service; no selection enforcement, null-PID gap | A05 |
| CU-SESSION-12 | Partial host-elevation helper, not invoked at start | A05 |
| CU-SESSION-13 | Partial metrics helper, no measured native safety results | A22, B10 |
| CU-VISION-01 | Partial interfaces; no complete traced observe/ground/act/verify loop | A08, B01, B07 |
| CU-VISION-02 | Partial shared handles; no accessibility-first live resolution | A11, B01, B05 |
| CU-VISION-03 | No active image path; privacy not established end to end | B03 |
| CU-VISION-04 | Partial transform math; inference/region mismatch | A11, A12 |
| CU-VISION-05 | Partial TTL/generation; scope/correlation/freshness gaps | A01, A04, A10 |
| CU-VISION-06 | Incorrect success without verification | A08, B06 |
| CU-VISION-07 | Partial typed outcomes; no qualified absence/ambiguity/recovery | A08, A12, B05 |
| CU-VISION-08 | Partial crop geometry; pixels not processed accordingly | A11, A12 |
| CU-VISION-09 | Partial timeout/kill primitives, no enforced watchdog/bounds | A06, A09, A10, B05 |
| CU-VISION-10 | Partial provider-load scaffolding, no qualified ONNX inference | A11, B04, B05 |
| CU-VISION-11 | Unqualified and incorrect competing-candidate interpretation | A12, B05 |
| CU-VISION-12 | Partial adapter/test interfaces; no pinned producer contract parity | A09–A12, B01, B05 |
| CU-VISION-13 | Missing installed healthy compatible selection/readiness | A14, A21, B05 |
| CU-VISION-14 | Partial config/generation; missing selection lock/version leases | A04, A10, A15, A21, B05 |
| CU-VISION-15 | Partial identity fields; missing full model identity/traces/viewer | A12, B05, B08 |
| CU-VISION-16 | No remote grounder implemented; unavailable-model/consent integration incomplete | A21, B03, B05 |
| CU-PLAN-01 | Default off exists; consent/control strip missing | A21, B02, B03 |
| CU-PLAN-02 | Missing provider/model-named consent | B03 |
| CU-PLAN-03 | Missing image-capability gating | B03 |
| CU-PLAN-04 | Missing bounded target-only image routing | B03 |
| CU-PLAN-05 | Missing sensitive-state screenshot suppression | B03 |
| CU-PLAN-06 | Missing transient image lifecycle and leak tests | B03 |
| CU-PLAN-07 | Settings writes discarded; no live routing revocation | A21, B03 |
| CU-PLAN-08 | Missing step-level image routing trace | B03, B08 |
| CU-PERM-01 | Present on registered session IPC via registerAiValidatedHandler; add round-trip tests | B10 |
| CU-PERM-02 | Missing separate enforced permissions/revocation UI | A03, B02, B03 |
| CU-PERM-03 | Partial host grant store, no authorization policy | A03, A04 |
| CU-PERM-04 | Incorrect automatic consequential grants | A03, B06 |
| CU-PERM-05 | Missing credential/challenge detection and integrated handoff | A02, B01, B03, B06 |
| CU-PERM-06 | Missing private desktop adapter discovery/invocation allowlist | B01, B09 |
| CU-PERM-07 | No enforcing task-authority boundary; TSV structural issue | A03, A04, A20, B03 |
| CU-PERM-08 | Missing opt-in evidence storage/reviewed export | B08 |
| CU-DEBUG-01 | Missing locate-only overlay with input exclusion | B08 |
| CU-DEBUG-02 | Missing step-through mode | B08 |
| CU-DEBUG-03 | Missing host offline replay path without control backend | B08 |
| CU-DEBUG-04 | Missing visual step viewer | B08 |
| CU-DEBUG-05 | Missing versioned diagnostic bundle lifecycle | B05, B08 |
| CU-DEBUG-06 | Missing failure-label-to-fixture workflow | B08, B10 |
| CU-DEBUG-07 | Missing same-evidence configuration comparisons | B08, B10 |
| CU-DEBUG-08 | No debug uploader found; evidence/telemetry separation not integration-tested | B03, B08 |
| CU-MAC-02 | Missing Phase 3 private helper integration/allowlists | B09 |
| CU-MAC-04 | Missing Phase 3 native geometry/scope qualification | B09 |
| CU-MAC-05 | Missing Phase 3 packaged permissions/cancellation evidence | B09, B10 |

Producer-owned CU-INST-11 and CU-MAC-01/03 are deliberately excluded from the 73 host IDs; verify their release evidence through B04/B09/B10. No second production grounder is required for Phase 2. Windows ARM, Intel Mac, Linux desktop control, multi-display/mixed-DPI qualification, vendor-specific model tiers, remote grounding and offline bundles are not silently added to current release scope.

## D. Completion order

1. Fix A01–A08 and A03/A04 authority/scope enforcement before enabling any real desktop input; add deterministic regressions.
2. Complete B01/B02/B03/B06/B07 for the Windows accessibility vertical slice, with private backend handoff and real native stop/Excel evidence. Local vision need not block Phase 1.
3. Fix the grounding/runtime/MCP defects and complete B04/B05/B08 for Phase 2; require actual Electron/model/provider tests before marking vision ready.
4. Complete B09 for Phase 3, then clean-machine/update/repair/compatibility and SLO gates in B10 for release hardening.
5. Keep later/deferred scope separate. Close a checkbox only with the cited acceptance evidence, not because an interface, stub, translation key, or isolated helper exists.

## E. Remediation status (2026-10-13)

Fixed in this pass (see git log on computer-use-integration):

| Item | Status | Commit |
| --- | --- | --- |
| A01-A08 | FIXED | b98f43b8 |
| A09-A10 | FIXED | 9f477b0d |
| A13, A14, A16 | FIXED | d9a9d251 |
| A15, A17 | PARTIALLY FIXED (noted above) | d9a9d251 |
| A18 | FIXED | ced6ba00 |
| A19 | PARTIALLY FIXED (noted above) | ced6ba00 |
| A20 | FIXED | 2f70dc82 |
| A21 | PARTIALLY FIXED (noted above) | 2f70dc82 |

**Still open (P1):** A11 (executable GUI-Actor inference pipeline — needs
pinned graph/tokenizer contract), A12 remainder (calibrated candidate
extraction from the pointer tensor; region mapping already fixed), A15/A17
remainders (model health probe, session-side leases, header deadline), A19
remainder (session-stop tree-kill wiring), A21 remainder (selection lock +
consent coupling). All B-section items remain open; B01 (Windows backend)
and B09 (macOS) are external-plugin-gated, B10 needs real hardware.
