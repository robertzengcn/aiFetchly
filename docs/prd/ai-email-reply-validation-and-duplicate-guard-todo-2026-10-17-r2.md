# Email reply validation and duplicate guard — October 17 re-audit, round 2

## Verdict and scope

**The full PRD cannot yet be accepted.** The previously reported C01/C02 races are fixed in their reviewed paths, the normal focused backend suite is now green, and the PRD explicitly defines the bounded unknown-model fallback and commit-to-certainty exception. One retained correctness finding remains: unrelated whole-entity message saves can erase newer sticky reply evidence. Live provider/rollout acceptance also remains open.

- Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-reply-validation-phase1`.
- Reviewed source HEAD: **`a89bd0b0628dd5b60b59aae6742021acf6096af2`**, branch `worktree-email-reply-validation-phase1`.
- Baseline: previous review commit `84328d7b1`.
- Contract: the **current amended** [PRD](ai-email-reply-validation-and-duplicate-guard-prd.md), FR-025–FR-039, and [technical design](ai-email-reply-validation-and-duplicate-guard-technical-design.md).
- Date: October 17, 2026, Asia/Shanghai. Line references below identify this source revision. This deliverable changes documentation only.

P1 blocks acceptance of the affected duplicate-protection path. The scope includes current requirement compliance and retained unsafe writers, not only newly changed lines. This is a source/test review, not a guarantee that every possible defect has been found.

## Fresh verification

| Check | Result |
|---|---|
| Ordinary focused backend selection, normal parallel configuration | **46 files / 742 tests passed**; no audit-only settings preload |
| Focused utility suites, including model normalizer | **17 files / 241 tests passed** |
| Full component suite | **71 files / 465 tests passed** |
| Three temporary real-SQLite diagnostic cases | **All three reproduced sticky-positive loss**, one per affected method; these passing diagnostic assertions verify unsafe behavior, not a safety fix |
| Four focused Electron workflow specs | **14 tests passed**, including visible review/edit invalidation, loopback generation/reuse/SMTP and reconciliation |

The backend selection includes the new final-admission tests and changed skill-ref timing test. The previous intermittent kill-switch refusal did **not** recur in this run. Per-worker settings isolation is now part of the repository setup rather than an external audit workaround.

The SQLite diagnostics used the actual `EmailReceivedMessageModel` methods, a real temporary database, and an async TypeORM load subscriber to schedule a real guarded evidence write after the unrelated operation materialized its old entity. No model source was replaced and no SMTP was invoked. The diagnostic test source was copied to `/tmp` and removed from the worktree after execution.

Temporary evidence prefix: `/tmp/email-reply-audit-2026-10-17-r2-`. Files include `main.log`, `utility.log`, `components.log`, `e2e.log`, `stale-save-proof.log`, `stale-save-proof.test.ts`, and `stale-save-evidence.jsonl`. The retained report describes the reproduction below; these scratch files are supplementary local evidence.

## Current requirement assessment

| Requirement | Assessment | Remaining work / relevant evidence |
|---|---|---|
| FR-025 — schema and correction | Implemented in reviewed scope | Shared fields/enums, original-context correction and local validation remain covered. |
| FR-026 — JSON compatibility | Controlled implementation covered | Actual hosted/provider compatibility acceptance remains T02. |
| FR-027 — model/output/context policy | Implemented under amended contract | Byte bound/configured-limit chain and explicit unknown-model ceiling are present. Unknown capacity is an accepted limitation, not the old unfinished requirement. |
| FR-028 — guarded generation/reuse | Core implementation present; acceptance affected | Message facts consumed by guards can be overwritten by unrelated saves (D01). |
| FR-029 — shared local enforcement | Partial | Dedicated admission/evidence coordination fixed, but facts must survive every writer (D01). |
| FR-030 — flags and targeted metadata isolation | Partial | Read/classification/status saves can restore stale flag/evidence fields (D01). |
| FR-031 — fresh positive/negative enforcement | Partial | Authoritative positive evidence can be erased before a later check (D01). |
| FR-032 — detector/tool contract | Implemented in reviewed paths | Advancing confirmation clock and exact staged owner checks fixed. Preserve persisted evidence across D01 writers. |
| FR-033 — typed results/guidance | Implemented in reviewed scope | Structured outcomes, safe DTOs and effective revision-bound guidance retained. |
| FR-034 — audit/localization/UI | Implementation and automated scope covered | Real release acceptance remains T02; current normal backend/component runs are green. |
| FR-035 — reservation/atomic creation/deadline | Implemented under amended contract | Deadline-gated admission plus explicit admitted-commit certainty is now consistent across PRD/design. |
| FR-036 — atomic send/recovery | Core implementation covered; projection safety incomplete | Related message metadata/lifecycle must not be reverted by unrelated full saves (D01/T01). |
| FR-037 — sticky evidence/cache integrity | Partial | Dedicated writes are fenced, but later unrelated saves can erase the positive (D01). |
| FR-038 — upgrade/legacy/readiness | Implemented in reviewed scope | Preserve historical projections under D01; no new migration/readiness defect established. |
| FR-039 — bounds/rollout/measurements | Partial | Live pilots, baseline measurements and release signoff remain T02. |

These assessments describe reviewed code and executed checks, not exhaustive production proof. Full-feature acceptance still depends on the cross-cutting evidence-integrity issue and live release gates.

## D01 — Unrelated whole-entity saves erase newer sticky reply evidence [P1]

### Affected code and callers

- `src/model/EmailReceivedMessage.model.ts:517–528` — `updateReplyStatus`.
- `src/model/EmailReceivedMessage.model.ts:547–556` — `updateClassification`.
- `src/model/EmailReceivedMessage.model.ts:559–563` — `markRead`.
- Opening message detail normally calls `markRead`: `src/main-process/communication/emailReceive-ipc.ts:149–157`.
- The AI message read tool optionally calls it: `src/service/EmailReceiveAiTools.ts:250–254`.
- Receive sync persists classification through the same model path: `src/service/emailReceive/EmailReceiveSyncService.ts:401–407`.

### Trigger and actual behavior

1. An affected method loads the complete message while `replyDetectedAt` and reply provenance are null and `isAnswered` is zero.
2. Before its save, a detector/sync observation persists a positive through the newly mutex-guarded evidence method. The database now correctly contains sticky positive evidence and answered metadata.
3. The unrelated operation changes its own field on the previously loaded entity and calls `repository.save(entity)`.
4. TypeORM compares that old entity with the newer stored row and writes the old null/zero values back. The evidence method's COALESCE/sticky-positive predicate does not participate in this separate save, and the unrelated writer does not acquire the reliability mutex.

This is a retained unsafe write path, not a new regression in the C01/C02 fix. Serializing dedicated evidence writes and inspecting every final snapshot row is correct, but does not stop another method from subsequently erasing those facts.

### Real database reproduction

For each of `markRead`, `updateClassification`, and `updateReplyStatus`, the diagnostic scheduled the actual `updateReplyEvidence` after the initial entity load. It verified that the positive existed in SQLite before allowing the unrelated save to finish.

| Operation | Positive present during interleave | Positive after save | Answered after save | Source / matched ID after save |
|---|---|---|---|---|
| `markRead` | Yes | **Erased** | **0** | **null / null** |
| `updateClassification` | Yes | **Erased** | **0** | **null / null** |
| `updateReplyStatus` | Yes | **Erased** | **0** | **null / null** |

The three diagnostic cases passed by asserting this unsafe result. They did not perform SMTP or demonstrate two network submissions. The established defect is loss of authoritative persisted evidence through ordinary reachable model methods.

### Impact

FR-030/FR-037 require positive evidence to survive later observations and unrelated metadata changes. Once erased, it is no longer available to local duplicate checks; if remote flags/evidence subsequently disappear, the promised sticky protection has been lost. These full saves can also carry stale lifecycle, normalization, cache and provenance fields outside the intended ownership of a read/classification operation. Positive/flag/provenance loss was verified directly; concurrent lifecycle preservation needs the regression below.

### Required work

- [ ] Replace load–mutate–save with targeted updates containing **only** the method-owned columns: unread state; classification/confidence; or the explicitly allowed status/processed timestamp change. Missing rows can remain a no-op without loading the complete entity.
- [ ] Preserve positive timestamp, source, matched ID, answered-observation metadata, negative cache/owner fields, normalization and concurrent lifecycle fields when those are not owned by the operation.
- [ ] Coordinate eligibility/lifecycle mutations with the shared reliability transaction mechanism where required. Preserve allowed status-transition checks and historical sent protection; do not solve this by broad writes inside another mutex.
- [ ] Add permanent real-SQL regressions for all three methods. Load the old entity, persist a positive through the actual guarded writer, resume, and assert positive timestamp/source/matched ID/flag metadata survive. After the fix, the test must assert the **safe** result rather than copy the diagnostic's unsafe expectations.
- [ ] Cover unread/classification racing a successful send projection and a newer negative/context/normalization update. Assert unrelated fields remain unchanged and no stale save reopens eligibility.
- [ ] Run the relevant model, sync, admission and tool/IPC suites after fixing the writers. Include a subsequent guard/detection check proving the preserved positive still refuses new work.

## Remaining acceptance tasks

### T01 — Complete regression coverage for D01 without reopening earlier findings

- [ ] Add the targeted column-ownership and concurrency regressions above. Current green suites do not establish absence of D01: the three additional real-SQL diagnostics reproduced it.
- [ ] Retain the current final-admission tests for a positive copy of the seed, shared-mutex writer exclusion, advancing confirmation clocks and ordinary settings isolation.
- [ ] Verify any claim of preserved concurrent `sent` state against the actual model/transaction path. Avoid treating a mocked fresh entity as proof that a stale full save is safe.

### T02 — Execute live provider and release acceptance

- [ ] Run the real hosted-AI JSON compatibility and IMAP/Sent pilots in [pilot plan](emailreply-pilot-and-rollout-plan.md), across the supported provider families/configurations.
- [ ] Verify accepted/unsupported/ignored JSON hints, mailbox flag and Sent discovery behavior, configured/default model limits and supported fallback behavior against live services.
- [ ] Capture first-pass validation, correction/fallback/truncation, unknown reasons, latency/cache/guard-conflict metrics and availability against a real baseline; collect release signoff.
- [ ] Keep private bodies, raw model output and credentials out of telemetry. Do not represent controlled loopback tests as live provider acceptance or fabricated baseline data.

## Disposition of the preceding report

| Previous item | Current assessment |
|---|---|
| C01 — newer positive seed ignored by final verdict | **Fixed in the reviewed path:** all cluster rows are inspected; dedicated evidence writers share the snapshot mutex. No production nested-mutex deadlock found. D01 is a different retained writer path that can erase evidence. |
| C02 — frozen pre-admission confirmation timestamp | **Fixed:** production passes a clock function evaluated inside the mutex after admission; the regression forwards the original input. |
| G01 — unknown capacity fallback | **Closed under the amended PRD:** FR-027 explicitly permits the 32K application ceiling, disclaims proof of model capacity and keeps provider rejection as a no-draft error. Do not repeat it as an unimplemented requirement. |
| T01 — shared settings / normal-run failure | **Fixed and freshly verified in this selection:** repository setup isolates settings per worker; 46 files / 742 tests pass normally. |
| T02 — deadline-contract mismatch | **Closed under the amended PRD/design:** admission deadline and admitted-commit certainty are explicitly distinguished. |
| T03 — real provider rollout evidence | Still open as current T02; no live measurements/signoff were established here. |

Suggested order: fix D01 and add safe-result regressions, retain the verified prior fixes, then complete the real provider/release acceptance. Earlier TODOs remain historical records; this file identifies the current source and remaining work.
