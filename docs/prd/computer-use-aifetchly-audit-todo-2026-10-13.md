# Computer Use requirements audit and TODO — 2026-10-13

## Verdict

**The PRD and technical design are not fully implemented. Errors remain in the current code.** Production Computer Use cannot start: `src/main-process/communication/index.ts:166` registers empty session/window lists, constant platform-based readiness, and an unconditional `backend_unavailable` start handler. The supervisor, worker and runtime helpers are foundations, not a functioning Windows Excel workflow.

This report supersedes the **current completion assessment** in [the October 12 audit](computer-use-aifetchly-audit-todo-2026-10-12.md), including its October 13 remediation table. Several fixes are real, but blanket claims that A01–A08/A09–A10/A18 are fully fixed are not supported by the current code. Keep the earlier report as historical evidence; use the open tasks below for remaining work.

- Worktree: `/home/robertzeng/project/aiFetchly/.claude/worktrees/computer-use`.
- Audited HEAD: `ced5e5ca9e01da7169067f16191a5b475780d1e8`; clean before this audit.
- Sources: the user-specified `/home/robertzeng/project/aiFetchly/docs/prd/computer-use-aifetchly-prd.md` and `computer-use-aifetchly-technical-design.md`, both v1.4. SHA-256 comparison confirms they match the worktree copies byte-for-byte. Relative links: [PRD](computer-use-aifetchly-prd.md), [technical design](computer-use-aifetchly-technical-design.md).
- Scope: host code, production wiring, tests and release artifacts in this worktree. External plugin/Hub implementations were not inspected. Linux environment: no Windows/Excel/GPU or packaged macOS qualification was possible.
- No application code was changed. Only this audit document is committed.

**Priority:** P0 = fix before enabling native input; P1 = blocks the affected milestone; P2 = correctness/qualification work. P0 defects are latent in the unwired supervisor/safety path, not a claim that the shipped stub currently controls a desktop.

**Evidence:** Reproduced = direct execution against current classes using fake adapters; Static = source demonstrates the issue; Missing = no complete production implementation found. Unit tests do not establish native safety or workflow success.

## Verification and confirmed improvements

Ran with the normal global TypeScript gate:

```sh
yarn vitest run --config vite.main.config.mjs \
  test/vitest/main/service/computerUse \
  test/vitest/main/service/localAiRuntime \
  test/vitest/main/service/MCPSessionPool.test.ts \
  test/vitest/main/modules/mcp \
  test/vitest/main/MCPClientConnectTimeout.test.ts \
  test/vitest/main/MCPTimeoutError.test.ts
```

**23 files / 263 tests passed; TypeScript reported zero errors.** This is a focused suite, not the entire repository suite. No Computer Use component or E2E test surface was found. No UI change was made in this audit.

Improvements present since the previous audit include session-ID schema compatibility, stop-generation checks, mandatory injected safety/hotkey controllers, consequential-class approval storage, session-bound target handles, missing-verifier uncertainty, Electron parent-port event unwrapping, request-key correlation, persisted settings, TSV cell sanitization/strict row counts, one-use install consent/hash comparisons, native v2 target filtering, and MCP concurrent-connect deduplication. These do not close the integration or residual defects below.

Temporary Node/ts-node probes outside the repository produced:

```text
pause during safety: input calls=1, state=READY
input throws: outcome=failed, state=EXECUTING
same observation re-minted after action: input calls=2
target/grant expire during safety: outcome=succeeded, input calls=1
keyboard with known foreign foreground: allowed=true
elevated target at selection: allowed=true
NaN image/crop geometry passes request validation: true
two equal separated peaks: {"point":0.5,"scores":[0.5,0.25],"outcome":"resolved"}
malformed mismatched result accepted: {"requestKey":"r","generation":999,"observationId":"wrong"}
```

These probes exercise logic only; they inject no OS input. Reproduction recipes and required permanent regressions follow.

## A. Errors remaining in existing code

### F01 — P0 — Pause/handoff does not revoke a pending dispatch

- [ ] **Reproduced.** `src/service/computerUse/ComputerUseSupervisor.ts:267` invalidates stored grants/targets but does not increment the generation or clear the observation. After awaited safety, `:665` checks `isRevoked` (`:785`), which recognizes only changed generation or STOPPING/STOPPED. PAUSED/HANDOFF passes; dispatch overwrites it with EXECUTING and eventually READY.
- Reproduce: start/observe/mint target; defer `preDispatchCheck`; dispatch; await `pauseSession`; resolve safety as allowed. One input call occurs after Pause and the session returns READY. The same path applies to handoff. Stop itself now increments generation and passes the existing stop regression.
- Fix: revoke authority on pause/handoff and guard every continuation against its immutable generation and expected state; revalidate the grant after safety. Do not revive paused sessions.
- Acceptance: pause/takeover/human-input/focus-change at observation, safety, execution and verification await boundaries; no subsequent input; state remains paused/handoff until explicit resume and fresh observation. CU-SESSION-04–06, design §10.2–10.4.

### F02 — P0 — Foreground and native target scope are not enforced

- [ ] **Reproduced/Static.** `ComputerUseSafetyService.ts:165` compares a foreground window ID with `generation.toString()` and calls `knownForeignForeground`, which always returns false (`:214`). Thus a known different app and an unknown foreground both allow typing. Pointer checks only exclude own-window rectangles; they do not establish selected-window ownership at the execution point.
- `preStartCheck` (`:99`) checks host elevation and optional own-process membership, but never target integrity. An elevated target is accepted at selection. `ComputerUseElevationService` caching also needs observation/lifecycle invalidation in production. Single-display enforcement is absent.
- Fix: bind immutable session target identity to safety; require target foreground for keyboard input and window-at-point ownership for pointer input; fail closed on unknown scope; check target integrity at selection and before dispatch; refresh PID/integrity/geometry and reject own windows/elevated host/unsupported displays.
- Acceptance: other-app focus, occlusion, PID reuse, unknown identity, own prompts, elevated target/host, moved target and display change all refuse input. CU-SESSION-05/06/10–12, CU-VISION-05, design §10.5/11.

### F03 — P0 — Expired authority survives asynchronous safety checks

- [ ] **Reproduced.** In `ComputerUseSupervisor.dispatchNow`, target resolution and grant/approval validation occur before `await safety.preDispatchCheck`. The final guard at `:665` checks generation/stop only. Advance the injected clock beyond target/grant expiry inside the safety callback: input still succeeds.
- Fix: immediately before input revalidate lease ownership, current observation and target expiry, approval/grant lifetime, target identity and expected state. Never dispatch with coordinates validated before an unbounded await.
- Acceptance: expiration, approval revocation and target invalidation during slow integrity/focus checks cause zero input. CU-VISION-05, CU-PERM-03/04, design §10.3.

### F04 — P0 — One action per observation and capture geometry are incomplete

- [ ] **Reproduced/Static.** `invalidateObservationTargets` (`ComputerUseSupervisor.ts:822`) deletes handles without clearing `currentObservationId`; registration can mint another handle for the consumed observation. Two actions succeed using one observation if a new handle is minted between them.
- `observe` keeps only the ID and checks generation, not the complete target/foreground/display/expiry metadata. Registration grants a fresh 10-second TTL from registration time, independent of capture expiry. `assertPointInWindow` (`:840`) compares capture-pixel points against the window's original desktop bounds: a target at desktop x=1000 can reject a valid local capture x=100. Moved-window/capture-scale identity is not retained for dispatch.
- Fix: store immutable observation metadata/transforms; consume the observation atomically; forbid registration while paused/stopped or after consumption; cap handle lifetime by observation expiry; validate capture-local points against capture dimensions and then transform into current executor coordinates. Bind identity to session as well as generation.
- Acceptance: re-mint-after-action, old capture, different target/display, moved/non-origin/DPI-scaled window and malformed region cases fail or map correctly; every second action requires a new observation. CU-VISION-04/05/08, design §9.2/10.2/11.

### F05 — P1 — Input exceptions wedge the session and misreport uncertainty

- [ ] **Reproduced.** `ComputerUseSupervisor.ts:676–687`: on `dispatchInput` rejection, cleanup calls `restoreDispatchableState`, but that helper (`:804`) only changes AWAITING_AUTHORIZATION; the actual state is EXECUTING. Result is generic `failed`, state remains EXECUTING, and further observation/dispatch is refused until user recovery.
- A verifier exception similarly yields `failed` (`:753`) even though input already occurred. The action record loses meaningful dispatch timing in the error case.
- Fix: state/generation-owned error transitions from EXECUTING/VERIFYING; use `execution_uncertain` whenever input may have happened; require new observation and never automatically retry. Preserve attempt/stage/correlation/timing safely.
- Acceptance: throw before injection, after injection, during verification and after stop; no wedged state, no false certainty, no duplicate input. CU-VISION-06/07, design §9.3/10.4/13.4.

### F06 — P0 — Approval class is caller-controlled; full permission policy is missing

- [ ] **Static.** `ComputerUseSupervisor.dispatch(sessionId, request, actionClass)` accepts its class from the caller; `ComputerUseTaskAuthority.assertDispatchAllowed` allows `within_task`/`read_only` unconditionally. Current-task approval storage prevents an explicitly labeled consequential action, but no trusted classifier binds a Save/Delete/overwrite gesture to the actual task. `approveTask` is a public helper without a real user approval flow. Class-wide approvals are broad.
- Fix: implement trusted host policy against the user's task, selected target and semantic action; do not rely on model/plugin labels. Scope approvals to the intended operation and current observation/request; separate capture, input, debug and planner-image grants and revocation. Add credential/challenge handoff.
- Acceptance: Save/Share/close/Delete/overwrite/payment cannot bypass approval by using `within_task`, a hotkey or observed instructions. Permission revocation and prompt-injection fixtures never expand authority. CU-PERM-02–07, W-1 stop point, design §10.3/12.

### F07 — P0 — Stop cleanup is not a complete, idempotent process shutdown

- [ ] **Static.** `ComputerUseSupervisor.stopSession:224` races adapter disposal with 2 seconds but does not force-kill afterward, cancel/kill grounding, release held inputs or restore clipboard. It then awaits hotkey unregister without a deadline. Calling Stop again on an already stopped session invokes shared adapter disposal again, potentially affecting a newer session on the same supervisor.
- `SupervisedStdioTransport.killChild` kills the direct child; owner registration is not proof of session-stop process-tree reaping. `forceClose` is not wired into the supervisor stop path. No host hooks connect sleep/resume, lock, disconnect, target closure, human input, display changes or app quit to session invalidation.
- Fix: make stop idempotent and per-session; separate immediate acknowledgment from bounded cleanup; cancel queues, release keys/buttons/clipboard, terminate the owned adapter tree and grounding worker with deadlines before relinquishing ownership. Wire lifecycle signals.
- Acceptance: hung disposal/unregister, stop during typing/drag/inference/load, duplicate Stop and stop-old-session-after-new-start; no surviving input/processes or cross-session cleanup. Measure ≤250 ms acknowledgment and ≤1 s forced inference termination provisionally. CU-SESSION-02–06/08/13, design §10.4.

### F08 — P1 — Grounding boundary validates only an envelope, not request identity/results

- [ ] **Reproduced/Static.** `ComputerUseGroundingClient.parseOutboundMessage` accepts any object payload. Pending entries track request key/worker ID but not expected observation/generation/model identity. A result with matching request key, generation 999, wrong observation and no candidates/transform resolves successfully. Empty loaded payload also resolves. `validateGroundRequest` in `grounding/GroundingModelAdapter.ts` accepts NaN dimensions/crops because comparisons do not reject NaN.
- Worker inbound validation likewise checks only object existence; result validation omits parts of the transform, outcome enum, crop/capability identity and region bounds. Supervisor target creation does not provide the full missing boundary validation.
- Fix: shared runtime schemas at host and worker boundaries, exact session/generation/observation/request/model correlation, finite bounded geometry/image sizes, expected loaded capability/provider/identity and error normalization. Unknown adapter IDs must use own-property lookup rather than inherited object keys in the registry.
- Acceptance: wrong IDs, wrong identities, NaN/Infinity, malformed loaded/result/error messages, unsupported crops and unknown/inherited adapter names fail with typed errors and cannot create handles. CU-VISION-05/09/12–15, design §5.9.2.

### F09 — P1 — Cancel permits another native inference before the old one stops

- [ ] **Static.** `ComputerUseGroundingClient.cancel` immediately removes its pending reply; `GroundingWorkerServer.handle(cancel)` clears `inFlight` although GUI-Actor's `cancel` is a no-op. Another ground call is accepted while the previous ONNX run may still execute. The old cancel watchdog then kills that worker, including the newer request. An old worker-side exception unconditionally clears `inFlight`, potentially discarding the newer result.
- Fix: quarantine/terminate the cancelling worker before accepting another request; keep busy ownership until actual termination or confirmed cancellation; generation-scoped watchdogs and run tokens; clean up when cancel/postMessage throws. Reset session generation ownership correctly across worker reloads.
- Acceptance: cancel A/start B/late A success or error; timeout/reload/old exit; no overlapping native runs, no poisoning or killing B, and forced-stop budget met. CU-VISION-09/14, CU-SESSION-04.

### F10 — P1 — GUI-Actor cannot execute the specified inference pipeline

- [ ] **Static; previous A11 remains open.** `GuiActorOnnxAdapter.ts:159` creates decoder and pointer sessions but no vision encoder session. `ground:218` runs only the pointer graph with an ArrayBuffer and plain text; no tokenizer, tensor creation, vision encoding, decoder prefill or actual crop/resize/normalization matches the reported geometry. Decoder is never run. Partial provider-initialization failures leak already-created sessions.
- The strict `groundingModelManifestSchema` (`src/schemas/localAiRuntime.ts:637`) rejects `graphInputs`/`pointerOutput`/`attentionOutput`, while the adapter expects those fields in the same manifest. The host intake and inference contract must be reconciled.
- Fix: accept a pinned producer graph/tokenizer/processing contract; implement the actual TypeScript/ONNX pipeline and full tensor metadata validation; release all partially initialized resources. Do not expose readiness until real inference/probes pass.
- Acceptance: actual Electron ONNX inference with golden intermediate tensors, cropped images, DirectML/CPU and later CoreML; parity/resource reports for immutable artifacts. CU-VISION-02/04/08–10/12, design §5.2–5.5/7.7.

### F11 — P0 for autonomous vision — Ambiguity decoder invents certainty

- [ ] **Reproduced; previous A12 only partly fixed.** `GuiActorOnnxAdapter.decodePointerOutputs:296` averages the whole grid and manufactures a runner-up at half the top score. Grid `[1,0,0,1]` with dimensions `[1,4]` produces point x=0.5 (between targets), scores 0.5/0.25 and `resolved` at the default 0.85 ambiguity ratio. It does not identify the two equally strong peaks. Zero signal throws `output_invalid`; a rounded zero score is replaced with 0.5.
- Fix: model-specific candidate extraction and held-out absence/ambiguity calibration; no invented confidence fallback; tensor dimension/value checks; typed not-found/ambiguous outcomes. Capture-region scaling has improved since A12, but the decoder is unchanged.
- Acceptance: equal separated peaks yield ambiguity; absent controls yield no handle/input; low signal never becomes artificial confidence; native region-hit validation. CU-VISION-07/11/15, PRD §8 hard absent-target gate.

### F12 — P1 — Model offers still skip compatibility; activation reports success too early

- [ ] **Static.** `LocalAiRuntimeModule.selectModelV2:789` chooses the first matching ID, unlike the corrected native selection. It does not filter model app-version/adapter/architecture/contract/processing/provider compatibility. `prepareInstallSet` checks memory/runtime version but not those model constraints. No skip of identical healthy runtime installs is present in `installSet`.
- `installSet:712` always reports `activated: true`, even when `runModelPipeline:942` merely records deferred activation. There is no full grounding health probe before the active pointer flips. Deferred callbacks are memory-only, not restart-reconciled or operation-locked; session/worker leases are not acquired by Computer Use. Immediate replacement removes backup before manifest/pointer writes; deferred replacement deletes the destination without equivalent rollback. Pruning after deferred activation/lease release is incomplete.
- Fix: compatible qualified selection before consent; honest prepared/pending/active status; session plus worker leases on both resources; staged full probes; atomic activation and rollback through all failure points; persistent pending activation/reconciliation; protect pending versions and prune/remove owned partials safely.
- Acceptance: incompatible shuffled catalogs, held old-version leases, failed probe/write/rename, crash between activation steps, concurrent remove/repair/new lease and deferred completion all preserve the working version and report accurate readiness. CU-INST-02/08/09/13/16–18, CU-VISION-13/14, design §7.8.

### F13 — P1 — Completed downloads are not durable across an app crash

- [ ] **Static; previous A16 closure is too broad.** `LocalAiRuntimeFileSetDownloadService.finalizePart` moves each verified part into an operation staging directory. Recovery back to the hash cache exists only inside `runModelPipeline`'s catch (`LocalAiRuntimeModule.ts:987`). Killing the app bypasses that catch; the next install uses a new operation ID and does not find the already-completed file. Recovery itself re-fetches a catalog and chooses the first model, rather than the original operation's entry.
- Disk preflight subtracts existing part sizes without reserving space for corrupt cached files or a server ignoring Range, so it can underestimate required space on retry.
- Fix: durable verified-file cache or persisted operation manifest reused across restarts, bound to the original entry. Revalidate retained bytes and budget repair/restart disk needs. Preserve valid completed files on cancellation and crash.
- Acceptance: finish shard A, interrupt B with network drop AND process kill, restart; A transfers zero bytes; corrupt only A and redownload only A. Test changed catalogs and insufficient disk on full restart. CU-INST-14/18, design §7.5/14.3.1.

### F14 — P1 — Manifest download still lacks a streaming size cap and idle/header deadline

- [ ] **Static; previous A17 partially fixed.** `LocalAiRuntimeFileSetDownloadService.openWithPolicy` waits on fetch headers without its own deadline. `fetchWholeFile` checks optional Content-Length, then calls `response.arrayBuffer()` before checking actual length: chunked or falsely short responses can allocate beyond the catalog limit, and stalled manifest bodies have no idle timer. Weight-body idle cancellation is normalized from AbortError without preserving the intended stall reason.
- Fix: bounded streaming manifest reads with an immediate byte cap, header and body-idle deadlines, cancellation and distinct stall errors; close redirect response bodies. Keep the corrected exact Content-Range checks and per-call response ownership.
- Acceptance: missing/false Content-Length, overlong stream, stalled headers/manifest/weights, cancellation and redirect limits terminate predictably without excessive memory. CU-INST-07/14/18.

### F15 — P1 — MCP pool still has lifecycle races and is not used in production

- [ ] **Static.** `MCPSessionPool.ts:169` checks pinned state before awaiting `acquire`; simultaneous first pins both pass and then set `pinned=true`. `invalidateServer`/`remove` only evict completed sessions, allowing a connection already pending to be inserted afterward. Release callbacks address a pool key, not the borrowed instance, and are not idempotent: double release can close another borrower's live client, or releasing an evicted instance can decrement its replacement.
- `src/service/MCPToolService.ts:238` still creates `new MCPClient`; calls disconnect after invocation. No production pool constructor was found, so persistent reuse has not shipped as design §4 requires.
- Fix: atomic exclusive pinning, instance-bound one-shot release handles, invalidation generations covering pending connections, dead-client eviction and real pool composition. Wire trust/version revocation and stop tree cleanup.
- Acceptance: concurrent initial pins, invalidate/remove during connect, double release, stale handle after replacement, disconnect/reconnect and repeated production tool calls. CU-SESSION-03, D-19, design §4.1–4.2.

### F16 — P1 — Settings persistence is fixed, but model locking and consent are absent

- [ ] **Static.** `computer-use-ipc.ts` SETTINGS_SET merges/persists settings without checking `deps.listSessions()`, installed-model compatibility, image-capable planner or provider/model-bound consent. Thus selection changes during active/paused/handoff sessions are not refused. Current readiness in `communication/index.ts` is still a constant, not computed from installed resources.
- Fix: between-session validated model selection returning `desktop_busy` while any session exists; independent explicit planner-image consent/capability gating and immediate off revocation; actual runtime/model readiness; validate hotkey registration conflicts in the session flow.
- Acceptance: active/paused/handoff selection rejected; incompatible/missing models explained; provider changes invalidate image consent; mode-off applies at next observation. CU-VISION-13/14/16, CU-PLAN-01–03/07.

### F17 — P2 — Metrics do not yet measure native safety

- [ ] **Static/Missing; previous A22 remains open.** `ComputerUseMeasurementService` declares a monotonic clock but defaults to `Date.now()`. It has no production dispatch/revocation/native input instrumentation. Its helper unit tests are not stop latency, last-input, strip visibility or worker-exit measurements.
- Fix: a monotonic clock and correlated native instrumentation; record at least 50 runs per safety metric on reference devices; report actual p50/p95/max and hard-gate violations, with artifact/hardware identity.
- Acceptance: clock adjustments cannot corrupt timing; real hidden/minimized/full-screen hotkey, drag/typing/hang and worker-kill cases meet documented gates. CU-SESSION-13, PRD §8, design §10.5.5/14.3.

## B. Missing implementation and acceptance tasks

### T01 — P1 / Phase 0–1 — Compose the real Windows session and host tools

- [ ] Replace the stub composition at `src/main-process/communication/index.ts:166` with one authoritative supervisor, shared lease, real target discovery/observation/private atomic input backend, safety/hotkey, worker and clipboard lifecycle. Readiness must reflect installed qualified plugin resources and actual capabilities.
- [ ] Implement host public capabilities/start/stop/observe/find/act/verify/handoff/resume tools and accessibility-first fallback. Pin producer schemas/fixtures by digest and validate/generate compatible consumers. Add safe stage/retry/correlation/readiness errors.
- [ ] Enforce first-party adapter discovery AND invocation allowlists; block generic MCP access to private desktop primitives, shell/registry/broad filesystem/process tools. Provision pinned Windows-MCP without Python/uv/global PATH/admin prerequisites; do no dependency resolution during handshake.
- [ ] Complete MCP production pooling and transport lifecycle (F15/F07). Confirm each safety fix before enabling input.
- Done when: real installed Windows backend can run repeated authorized actions through the same session, competing chats receive `desktop_busy`, all controls work, and native stop/scope tests pass. Plugin packaging/Hub listing are external inputs; host wiring remains host work.

### T02 — P1 / Phase 1–2 — Deliver UI, renderer API, preload and tests

- [ ] Add Computer Use renderer API and preload/channel exposure; target picker with workbook/sheet confirmation; session visibility, actionable errors and recovery.
- [ ] Add non-focusable always-on-top strip showing target, step, status, planner mode, shortcut and Pause/Take over/Stop; target border/preview; window/preload/build entry. Exclude strip from capture and implement actual pixel masking fallback (current `stripMaskRect` only calculates geometry).
- [ ] Add settings for vision, installed qualified model selector, readiness, hotkey, debug retention and visual planner consent. Add Local AI components Computer Use grouping and single runtime+model consent with combined bytes/disk, progress/cancel/resume/repair/update/remove.
- [ ] Use all six languages (`en/zh/es/fr/de/ja`) for every new UI string. Existing translation keys alone are not UI. Add component tests alongside changes and run `yarn test:components`; add and run critical Playwright E2E flows.
- Evidence: no Computer Use components/pages/API were found; no strip window exists. Done when the user can perform the complete session/control/install flow without developer tools, with focus/capture native checks.

### T03 — P1 / Phase 1 — Implement planner image privacy and permissions

- [ ] Implement planner-image service: local-only structured text by default; opt-in named provider/model consent and image capability check; bounded target-window crops; separate capture/input/debug/image permissions and revocation.
- [ ] Suppress images during login/password/verification/handoff; transient attachment lifecycle; no image bytes in ordinary tool JSON/chat history/hooks/logs/telemetry/errors. Add leak assertions at every consumer/storage boundary.
- [ ] Explain that accessibility/cell text may still reach the remote planner; image consent never authorizes a remote grounder. Record actual mode/image send per step; off takes effect at next observation.
- Done when: local-only, opt-in, sensitive-state and mid-session toggle tests pass end to end. No current production image path exists, so privacy has not been qualified merely by absence of uploads.

### T04 — P1 / Phase 2 — Finish local runtime installation and release tooling

- [ ] Production `createLocalAiRuntimeModule` in `local-ai-runtime-ipc.ts` supplies neither `getCatalogV2` nor `fileSetDownload`, and does not expose install-set handlers. Add v2 source/cache/consumer wiring, IPC schemas/channels/preload/API, file-set install lifecycle and computed readiness.
- [ ] Implement disposable grounding runtime/model probe workers (Electron binding + `add.onnx`; actual qualified model fixture with bounded timeout), health/status/repair/update/remove and grounding-aware idle-worker disposal.
- [ ] Fix F12–F14 and acquire session/worker/probe leases. Publish v1 embedding/voice-only catalog plus v2 grounding entries; add qualified native packages/notices/ABI/provider checks, reviewed immutable model lock and old-app consumer compatibility test to release tooling.
- Done when: clean machine installs only matching resources after one consent; interrupted/tampered/update/repair/remove scenarios pass; existing v1 consumers remain functional. Model export/parity/license evidence is plugin-owned input.

### T05 — P1 / Phase 2 — Complete local grounding, selection and qualification

- [ ] Implement real inference and calibrated outputs (F08–F11), built-in registry and test-only second adapter; keep test adapter unavailable as a production selectable model.
- [ ] Implement selection/readiness services; compatible installed/healthy/qualified configs only, immutable complete model/runtime/adapter/processing/provider identities and leases for the session, no silent substitute, crop and memory/provider fallback handling.
- [ ] Run the same contract suite against GUI-Actor and test adapter, real Electron worker load/ground/cancel/unload/reload, golden tensors and native benchmarks. Handwritten interfaces or the synthetic adapter do not prove GUI-Actor parity.
- Done when: held-out absence/ambiguity, malformed/stale results, resource limits and switching tests pass; no second production model is required.

### T06 — P1 / Phase 1 — Implement and qualify W-1 Excel execution

- [ ] W1-1: select user's existing open workbook/sheet; offer direct export for new-file-only tasks.
- [ ] W1-2: bounded UI Automation header/used-range read and first-empty-row discovery.
- [ ] W1-3: map fields to existing columns; ask all unmatched/ambiguous mappings, preserving formulas/template conventions.
- [ ] W1-4: actually set Text format on phone/postal/ID columns before paste; preserve leading zeros and long IDs.
- [ ] W1-5: inspect whole destination for nonempty cells; require overwrite approval; save/write/restore clipboard text on success/error/stop and warn about losing non-text formats; safe TSV/formula handling.
- [ ] W1-6: bold header, table/filter, autofit and duplicate-email highlighting; authorize each native step.
- [ ] W1-7: read back row count and sampled values against source; surface all mismatches; never equate injected input with completion. Stop before Save/Save As/Share/close/delete/Remove Duplicates unless current-task authorization covers it.
- [ ] Hand off Protected View/Enable Editing/sign-in; explain unsupported protected sheets/macros/Power Query/pivots; bound 500 rows × 15 columns on one sheet.
- Evidence: `ExcelLeadListPlanner.ts` and clipboard service are helpers only; no workflow runner invokes the native sequence. Done when versioned fixtures pass on Microsoft 365 Current Channel and Excel 2021, English/Simplified Chinese, local and desktop-open OneDrive/SharePoint workbooks, 100%/150% scale. Zero injected mismatches may remain after verification.

### T07 — P1 / Phase 1–2 — Persist safe sessions/actions and diagnostics

- [ ] Add Computer Use Module/Model persistence and entities/migrations if needed using Token/USERSDBPATH; store safe session summaries and all action outcomes, including rejected/failed/uncertain attempts and stage/correlation metadata. Keep workers/plugin database-free.
- [ ] Implement trace service with full immutable model/backend/runtime/provider/processing/calibration and transform identities. Keep raw screenshots/native handles/grants/credentials out of ordinary tool/chat records.
- Evidence: supervisor only retains an in-memory bounded action log; no `ComputerUseModule` or Computer Use persistence implementation was found. Done when restart/history tests preserve safe outcomes without replaying uncertain input.

### T08 — P1 / Phase 2 — Deliver locate-only, step-through, replay and evidence review

- [ ] Locate-only predictions/overlay with no input; step-through confirmation before each action and re-observation of stale targets; offline replay without loading a control backend.
- [ ] Visual viewer for original capture, exact model input, candidates/regions, mapped point, after-state and optional genuine heatmap; distinguish grounding/transform/focus/stale/input/verification failures.
- [ ] Opt-in local debug retention/cap/cleanup and reviewed redacted export; versioned bundles and exact-replay compatibility; failure labels into fixtures; identical-evidence configuration comparisons with region hits/timing/memory/failure type. No automated evidence uploads/training.
- Evidence: no host trace/viewer/replay implementation found. Done when no-input invariants, review/export/leak tests and deterministic replay/labeling tests pass. Plugin replay/eval tools are inputs, not a replacement for host integration.

### T09 — Phase 3 — Implement macOS consumer integration

- [ ] Consume selected signed/notarized private helper and compatibility/permission readiness; host discovery/invocation allowlists, TCC denial/revocation, Retina/capture transforms, foreground/point ownership and stop cleanup.
- [ ] If Ghost wins the producer spike, require pinned patched atomic actions, no vision/MLX/Python sidecar or implicit CDP/recipes/learning; force AX/action failures to prove no fallback escapes supervision.
- [ ] Qualify Apple Silicon packaged install/update/permission attribution, CJK, captures, long typing/drag, blocked MCP calls, process-tree cleanup and CoreML/CPU provider behavior.
- Done when CU-MAC-02/04/05 pass integrated tests and producer CU-MAC-01/03 evidence is accepted. This is later Phase 3 scope, not a Windows MVP regression.

### T10 — P1 / Phases 0–4 — Produce release evidence and close decisions

- [ ] Add permanent deterministic regressions for F01–F17, production-composition tests, real Electron worker boundary tests and native safety instrumentation (F17).
- [ ] Consume pinned plugin contracts/fixtures, Windows backend/locks/integrity/window-at-point tools, model exports/license/parity/health/calibration evidence; verify Hub listing/install plans and later target-aware native resources. Do not assume external artifacts exist because host types exist.
- [ ] Run clean-machine and update/repair matrix, packaged worker verification, no-developer-tools installation and old-app v1 compatibility. Run native stop/hotkey/strip/own/elevated-window/lock/sleep/display gates.
- [ ] Run versioned W-1 accessibility-only, grounder-only, combined, visual-planner and baseline arms; synthetic/consented fixtures, held-out separation, absent/ambiguous cases, mismatch/handoff/unauthorized-action counts, cost, RAM/VRAM, cold/warm timing and task success.
- [ ] Publish qualified artifact combination/platform/app/provider matrix and measured SLOs. Resolve Windows delivery, Mac spike, model quantization/pixel budget/providers/hardware/minimum memory, calibrated thresholds, visual image limits/providers, stop-hotkey default, model hosting and debug retention/cap from evidence.
- Done when PRD §8 hard gates pass and provisional metrics are measured/replaced. Phase 5 offline bundles, multi-display/mixed-DPI expansion, vendor providers and extra model tiers require separate approval/qualification; they are not silently added to MVP scope.

## C. Requirement-by-requirement status

“Partial” means implementation exists but acceptance is unmet. “Missing” means no complete host path was found. “Unverified” needs external/native evidence. All 73 host-owned CU IDs in PRD §6 are mapped below; workflow and UI prose requirements are also covered by T02/T06. Producer-owned CU-INST-11 and CU-MAC-01/03 are tracked as external prerequisites in T04/T09/T10.

| Requirement | Current status / outstanding work | TODO |
| --- | --- | --- |
| CU-INST-01 | Missing qualified listing/current-machine activation integration | T01, T02, T10 |
| CU-INST-02 | Partial native v2 selection; model compatibility/production resolution absent | F12, T04 |
| CU-INST-03 | Partial identities; independent real artifact delivery/update reuse unverified | T04, T10 |
| CU-INST-04 | Partial optional setting; no user install/readiness flow | T02, T04 |
| CU-INST-05 | Unverified clean-machine Windows provisioning without Python/uv | T01, T10 |
| CU-INST-06 | Partial hash/one-use consent checks; producer pinning/qualified activation incomplete | F12, T04, T10 |
| CU-INST-07 | Partial progress/cancel helpers; UI/integration and timeout gaps | F14, T02, T04 |
| CU-INST-08 | Partial ref-count coordinator; no Computer Use lease integration | F12, T04, T05 |
| CU-INST-09 | Partial staged updates; probe/rollback/deferred activation gaps | F12, T04 |
| CU-INST-10 | Explicitly deferred offline bundles (Phase 5) | T10; separate qualification |
| CU-INST-12 | Missing production grounding component management | T02, T04 |
| CU-INST-13 | Partial consent/hash helpers; combined UI/IPC/install path missing | F12, T02, T04 |
| CU-INST-14 | Partial per-file resume; crash loses completed staging reuse | F13, F14 |
| CU-INST-15 | Partial v2 schema; dual publication/previous-app proof missing | T04, T10 |
| CU-INST-16 | Partial deferred callback/leases; no session pinning/probe/restart reconciliation | F12, T04, T05 |
| CU-INST-17 | Partial pruning; deferred/lease-release/partial-file lifecycle incomplete | F12, F13, T04 |
| CU-INST-18 | Partial RAM/disk checks; compatibility/resource/retry qualification missing | F12, F13, T04, T10 |
| CU-SESSION-01 | Missing actual identified target/session UI and backend | T01, T02 |
| CU-SESSION-02 | Partial lease; no shared production owner, idempotent teardown pending | F07, T01 |
| CU-SESSION-03 | Partial pool/worker; production still creates/disconnects MCP per call | F09, F15, T01 |
| CU-SESSION-04 | Partial stop/pause helpers; Pause bypass and cleanup gaps | F01, F07, T02 |
| CU-SESSION-05 | Missing human/focus hooks; foreground check ineffective | F01, F02, T01 |
| CU-SESSION-06 | Partial generation logic; lifecycle/observation invalidation incomplete | F01, F04, F07, F09 |
| CU-SESSION-07 | Worker DB separation present; host persistence missing | T07 |
| CU-SESSION-08 | Partial hotkey service; production registration/recovery/native proof absent | F07, T01, T02, T10 |
| CU-SESSION-09 | Missing control strip/border/capture exclusion and masking | T02 |
| CU-SESSION-10 | Partial own-window helpers; no picker/point ownership integration | F02, T01, T02 |
| CU-SESSION-11 | Partial integrity helper; elevated selection accepted | F02, T01, T10 |
| CU-SESSION-12 | Host-elevation pre-start helper present; production/native proof missing | F02, T01, T10 |
| CU-SESSION-13 | Partial metrics helper; no monotonic native measurements | F17, T10 |
| CU-VISION-01 | Partial separated interfaces; no complete traced pipeline | T01, T05, T07 |
| CU-VISION-02 | Partial shared target helpers; no real AX-first/inference path | F10, T01, T05 |
| CU-VISION-03 | No active image path; end-to-end local-only privacy unverified | T03, T10 |
| CU-VISION-04 | Partial transform math; capture/window and actual preprocessing gaps | F04, F10, T05 |
| CU-VISION-05 | Partial session handles; expiry/consumption/scope/boundary defects | F02, F03, F04, F08 |
| CU-VISION-06 | Missing verifier now uncertain; post-input error handling still wrong | F05, T06 |
| CU-VISION-07 | Typed failures exist; ambiguity/absence/recovery not qualified | F05, F11, T05 |
| CU-VISION-08 | Partial crop transform helpers; no corresponding pixel processing | F04, F10, T05 |
| CU-VISION-09 | Partial timeout/kill client; cancellation permits overlapping work | F07, F08, F09, T05 |
| CU-VISION-10 | Partial ONNX loader/provider scaffolding; real inference/qualification absent | F10, T04, T05 |
| CU-VISION-11 | Incorrect competing-peak interpretation; calibration absent | F11, T05 |
| CU-VISION-12 | Partial adapter/test interfaces; full contracts/parity/boundaries absent | F08, F10, T05 |
| CU-VISION-13 | Missing qualified installed-model selection/readiness | F12, F16, T05 |
| CU-VISION-14 | Partial generation/identity; selection lock/leases/cancel isolation missing | F09, F12, F16, T05 |
| CU-VISION-15 | Partial identity fields; complete model/evidence/trace path missing | F08, T05, T07, T08 |
| CU-VISION-16 | No remote grounder present; selection/no-substitution/consent path unqualified | F16, T03, T05 |
| CU-PLAN-01 | Default off setting present; explicit consent/indicator missing | F16, T02, T03 |
| CU-PLAN-02 | Missing provider/model-named screenshot consent | T03 |
| CU-PLAN-03 | Missing image-capable model gating | F16, T03 |
| CU-PLAN-04 | Missing bounded target-window image routing | T03 |
| CU-PLAN-05 | Missing sensitive-state/handoff image suppression | T03 |
| CU-PLAN-06 | Missing transient image path and persistence/hook/log leak tests | T03, T10 |
| CU-PLAN-07 | Settings persist; no live next-observation routing revocation | F16, T03 |
| CU-PLAN-08 | Missing per-step mode/image-send trace | T03, T07 |
| CU-PERM-01 | AI gate present on registered session IPC; verify all future tool/IPC paths | T01, T10 |
| CU-PERM-02 | Missing separate enforced capture/input/debug/image permissions | F06, T02, T03 |
| CU-PERM-03 | Partial host grant/approval stores; policy/final validation incomplete | F03, F06 |
| CU-PERM-04 | Consequential label denied without approval; trusted classification absent | F06, T06 |
| CU-PERM-05 | Missing integrated credential/challenge handoff | F01, F06, T03, T06 |
| CU-PERM-06 | Missing private adapter discovery/invocation allowlist integration | T01, T09 |
| CU-PERM-07 | TSV sanitization improved; trusted observed-text/task boundary incomplete | F06, T03, T06 |
| CU-PERM-08 | Missing opt-in retained evidence/reviewed export | T08 |
| CU-DEBUG-01 | Missing locate-only overlay and no-input route | T08 |
| CU-DEBUG-02 | Missing step-through action confirmation mode | T08 |
| CU-DEBUG-03 | Missing host offline replay without input backend | T08 |
| CU-DEBUG-04 | Missing capture/model-input/candidates/after-state viewer | T08 |
| CU-DEBUG-05 | Missing complete versioned bundle lifecycle | T05, T07, T08 |
| CU-DEBUG-06 | Missing failure labeling to regression fixtures | T08, T10 |
| CU-DEBUG-07 | Missing same-evidence model/configuration comparisons | T08, T10 |
| CU-DEBUG-08 | No uploader found; evidence/telemetry separation not qualified | T03, T08, T10 |
| CU-MAC-02 | Missing private helper consumer/allowlists (Phase 3) | T09 |
| CU-MAC-04 | Missing native Mac geometry/scope qualification (Phase 3) | T09 |
| CU-MAC-05 | Missing packaged permission/cancellation evidence (Phase 3) | T09, T10 |

## D. Milestone and completion order

| Milestone | Current assessment | Required work |
| --- | --- | --- |
| Phase 0 foundations | Partial; no complete acceptance evidence | MCP integration, schema conformance, real ONNX/provider and measurement evidence |
| Phase 1 Windows MVP | Incomplete; production session start disabled | F01–F07/F15/F16, T01–T03/T06/T07/T10 |
| Phase 2 local vision | Incomplete; inference/installation/UI/debug paths missing | F08–F14/F16, T04/T05/T08 plus native qualification |
| Phase 3 macOS | Missing host platform integration; producer decision external | T09 and accepted producer/Hub evidence |
| Phase 4 hardening/GA | Unverified/not met | T10 after working earlier phases |
| Phase 5 expansion | Explicitly deferred, not a current implementation defect | Separately approved scope and qualification |

1. Close native-input P0s with committed regressions before wiring an enabled control path. Repair false “fixed” assessments when closing related historical items.
2. Build the Windows accessibility W-1 slice with visible control/permissions and verified stop behavior. Local vision is not a prerequisite for Phase 1.
3. Complete runtime delivery, actual local grounding and diagnostic tools, then qualify Phase 2 with real immutable artifacts.
4. Complete Mac consumer integration and joint release hardening when producer/Hub handoffs exist.
5. Close a TODO only with its stated acceptance evidence. A helper, interface, comment, translation key or passing mock test does not establish the corresponding user-facing requirement.

## E. Remediation record (2026-10-14)

Code defects F01–F17 are addressed on `computer-use-integration` (see §E in the
2026-10-12 audit for the earlier A-series). T-series items remain open — they
are whole-feature builds (Windows backend composition, UI, planner-image
routing, release tooling, W-1 native execution, persistence, diagnostics,
macOS, native qualification), most gated on external plugin/Hub artifacts or
real hardware, and are not claimable from this Linux worktree.

| Item | Status | Commit |
| --- | --- | --- |
| F01 pause/handoff revocation | FIXED (generation bump + guards; regressions) | see log |
| F02 foreground/scope enforcement | PARTIALLY FIXED — target-foreground required for keyboard (fail closed on unknown), elevated targets refused at selection; window-at-point pointer ownership still needs the real adapter (T01) | — |
| F03 post-safety revalidation | FIXED (lease, observation currency+expiry, target, grant revalidated with fresh clock) | — |
| F04 observation consumption/geometry | PARTIALLY FIXED — atomic consumption blocks re-minting, TTL capped by observation expiry, capture-space bounds; capture→executor transform identity at dispatch lands with the real adapter | — |
| F05 input/verifier error transitions | FIXED (execution_uncertain both paths; EXECUTING unwedged) | — |
| F06 trusted classification | PARTIALLY FIXED — host gesture classifier (Ctrl+S/W/P, Delete, Alt+F4, destructive prefixes, drags) overrides caller labels; full task-scoped policy + credential handoff remain (T01/T03/T06) | — |
| F07 stop idempotency | PARTIALLY FIXED — idempotent, per-session stop; grounding-kill/clipboard/lifecycle-signal hooks land with the composed backend (T01) | — |
| F08 boundary identity/validation | FIXED (identity correlation, strict shapes, NaN-proof requests, own-property registry) | — |
| F09 cancel quarantine | FIXED (client quarantined until fresh worker; worker keeps busy slot) | — |
| F10 inference pipeline | PARTIALLY FIXED — manifest schema now accepts the graph contract; the executable ONNX pipeline remains plugin-gated | — |
| F11 ambiguity decoder | FIXED (local-peak detection, real scores, zero-signal ⇒ target_not_found) | — |
| F12 model compatibility/status | PARTIALLY FIXED — compatible model selection, identical-runtime skip, honest deferred status; health probes + persistent pending reconciliation remain (T04) | — |
| F13 crash-durable parts | FIXED (hard-linked cache survives kills; dropped only after activation) | — |
| F14 manifest streaming/deadlines | FIXED (capped streaming read, header deadline, distinct stall errors) | — |
| F15 pool races | FIXED (atomic pinning, invalidation generations, one-shot instance-bound releases) | — |
| F16 selection lock | PARTIALLY FIXED — model change refused while any session exists; image-consent coupling remains (T03) | — |
| F17 monotonic clock | PARTIALLY FIXED — performance.now default; native instrumentation needs real hardware (T10) | — |

Focused suites: 23 files / 276 tests passed; tsc clean. Component suite
unaffected. The production composition (§B T01) still starts fail-closed
(`backend_unavailable`) — that is intentional until a qualified Windows
backend exists.
