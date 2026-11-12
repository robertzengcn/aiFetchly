# Browser decision acceleration audit and TODO — November 12

Reviewed HEAD `11689f401` and the existing uncommitted changes to ManagedBrowserModule.ts and BrowserTaskRunner.ts. Specifications are [the PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md). The implementation remains incomplete. This report supersedes prior completion claims for the cases described below.

The review includes source tracing, comparison with previous audits and a direct execution of the production domain-normalization function. Findings marked source-confirmed still need targeted runtime regression tests. Existing untracked temporary JSON files belong to the starting worktree.

## 0. Fix round 2026-11-12 (implementation HEAD: `9569878a2`)

The November 12 audit's defects closed with targeted fixes and regression tests:

| Defect | Fix and evidence | Commit |
| --- | --- | --- |
| **N01 — multi-label suffix entries never match** | `registrableDomainOf` rewritten as a LONGEST-MATCH traversal: tails are compared longest-first against the rule sets, so 3+ label rules (`s3.amazonaws.com`, `s3.dualstack.amazonaws.com`) actually match; PSL wildcard (`*.ck`) and exception (`!www.ck`) rules are supported. The audited reproduction now isolates tenants: `alice.s3.amazonaws.com` ≠ `bob.s3.amazonaws.com`, and the bare suffix is null. The audited functional intent is closed with the curated list (the `tldts` dependency remains uninstallable on this host + CI frozen-lockfile — noted as the formal swap when a yarn-capable host is available). Tests: tenant isolation, depth traversal, wildcard/exception, loopback rejection. | `9569878a2` |
| **N03 — terminal gate errors all classified as cancellation** | The runner's outer catch maps EXACT gate reasons: `task_cancelled` → cancelled; `task_interrupted` → partial/interrupted; every other `task_*` (task_failed, task_not_found, task_paused...) stays FAILED preserving the originating reason. Tests: three typed gate errors → three distinct truthful terminals. | `9569878a2` |
| **N04 — proxy encryption migration inconsistent** | `googleMaps-ipc` and `yandexMaps-ipc` decrypt `entity.pass` in the main process before the scraper worker sees it (`decryptForUse` + legacy-plaintext migration, undecryptable rows skipped instead of silently breaking auth); `SearchModule` encrypts search-task proxy rows at all three write sites and decrypts at the worker-read site — plaintext never persists in `search_task_proxy` and ciphertext never reaches proxy auth. `migratePlaintextPass` made public for the IPC boundary. | `9569878a2` |
| **N02 — proxy rollback retries the failed target** | The switch snapshots the OLD session (proxy selection from `startProxySelection` on the record, full URL, account/conversation) BEFORE the stop; the restore rebuilds THAT session instead of retrying the failed new target, and includes `requestedStartUrl`. The switch allowance is charged only AFTER validation succeeded (rejected requests no longer consume it). Auto-resolved proxies are health-checked by host/port row match before the stop. Still keyed by lineage (per-task keying needs task-identity threading — N08). | `9569878a2` |

Validation: `tsc --noEmit` exit 0; browserDecision + browserAgents + managedBrowser + browserLogin **500 tests pass**; utility managedBrowser **150 pass**.

## 0. Fix round 2026-11-12b (implementation HEAD: `0e44d0e18`)

**N05 closed** — all four reservation/identity races:

| Item | Fix and evidence | Commit |
| --- | --- | --- |
| Site-ID allocation | `upsertSite` now uses INSERT-ONLY allocation (`insertSiteWithId`) with bounded conflict retry: on a PK collision the domain is re-checked (the concurrent winner may be the same domain) and the allocation retried up to 3x. A conflicting save can never re-point a credentialed site. | `0e44d0e18` |
| Sign-in reservation | `signIn` reserves BOTH `account:<id>` AND `session:<id>` synchronously before the awaited cooldown check — two calls on one session with different accounts serialize instead of running concurrent FILL_LOGIN_FORM. | `0e44d0e18` |
| Edited-username identity | the password-only card's username edit re-reserves the switched account synchronously and re-checks ITS cooldown before save/bind; the extra reservation is released on every path. | `0e44d0e18` |
| Lease task binding | `ManagedBrowserLeaseService.acquire` returns `account_in_use` when the conversation matches but BOTH owner task ids are set and differ — two tasks in one conversation no longer share a session. | `0e44d0e18` |
| Per-domain site cap | the capacity check counts registered sessions PLUS a synchronously-reserved in-flight per-domain counter, released in a start() finally (converts to the registered session on success, released on failure) — three parallel starts on one domain can no longer all pass. | `0e44d0e18` |

Validation: `tsc --noEmit` exit 0; 500 main + 118 targeted utility tests pass.

## 0. Fix round 2026-11-12c (implementation HEAD: `d4bed37c3`)

**N09 boundary evidence partially closed:**

| Item | Fix and evidence | Commit |
| --- | --- | --- |
| SELECT live identity | The runner binds each `o_N` token to the OBSERVED value (`expected_values` rides the action schema); the executor's live resolution verifies the live option value still matches the observed value — options reordering or changing after the observation FAIL the step (`stale_select_option`) instead of silently choosing another option. Tests: matching live value selects; reordered live value fails the step. | `d4bed37c3` |
| NAVIGATE provenance | A cross-ORIGIN target on the same registrable domain is allowed ONLY when its origin was OBSERVED as a link (`hrefOrigin` on the observation) or IS the current origin — the model can no longer invent deep links it never saw. Tests: unobserved same-domain origin rejected with `navigate_unobserved_origin` and nothing dispatched; observed link origin navigates and completes. | `d4bed37c3` |

Still open in N09: candidate-shortlist omission evidence beyond all scan windows; legacy/runner command concurrency at worker boundaries (X2 last item).

**CI final status (2026-11-13, run `43260891074` on `d57beaebd`): all three jobs GREEN** — Lint and unit tests ✓, Electron E2E (Playwright) ✓, Package smoke test ✓ (Linux packaging + packaged app smoke). The two earlier package-job failures were intermittent infra (runner lost communication mid-packaging); the identical source tree passed packaging on retrigger. The branch is landable from the CI standpoint.

Remaining open work (tracked above): N06 hosted client/planner, N07 card mounting journeys, N08 root-conversation threading, and the N09 residual boundary evidence.

## Current correctness defects and related cases

### N01 — P0 — multi-label suffix entries never match

- [ ] Replace the partial suffix matcher with a maintained public-suffix implementation supporting private suffixes, longest matching rules, wildcards and exceptions.

RegistrableDomain.ts adds entries such as s3.amazonaws.com, but registrableDomainOf compares only the final TWO labels to the set. Running the actual transpiled production function gives all three inputs alice.s3.amazonaws.com, bob.s3.amazonaws.com and s3.amazonaws.com the result amazonaws.com. Thus adding the entry did not isolate those tenants. The same algorithm ignores every three-or-more-label rule in the set. Missing rules remain another instance of this defect class. The X1 functional-closure annotation is too broad.

The returned identity feeds account matching, navigation checks, site registration and concurrency limits. Test those consumers together. Cover an entire suffix itself, two unrelated tenants, longer rules, wildcard/exception rules, internationalized hosts and private-name rejection. Preserve the landed HTTPS downgrade and localhost restrictions. Requirements A-FR-02/07/16, S-FR-03, D-FR-16.

### N02 — P1 — proxy rollback retries the failed target

- [ ] Snapshot the old effective proxy, full URL, cookies and task ownership before switching. Restore that snapshot if the new launch fails.
- [ ] Preserve validated selection through launch, validate auto-selected proxy health, and charge switch budgets to the correct task.

ManagedBrowserModule.switchSessionProxyInner prevalidates before stop and serializes the switch, which fixes earlier failures. However its catch calls start with proxy: target again. If that proxy is unreachable or causes launch failure, restoration repeats the same failure. The restoration also omits requestedStartUrl. The uncommitted edit fixes the invalid cast of a resolved proxy to BrowserProxySelection, but preserves this rollback defect.

Additional occurrences in the same flow are re-resolving auto after stopping, health-checking only proxy_id, incrementing the switch counter before validation, and keying the counter by conversation/account/platform rather than task. Rejected requests consume the allowance and unrelated tasks can share it. Verify account and public sessions, failed health/confirmation/decryption, changed proxy rows between validation and launch, rollback failure, full URL/cookies, and simultaneous switches. Requirements P-FR-02–06, C-FR-13.

### N03 — P1 — terminal gate errors are all classified as cancellation

- [ ] Map exact typed terminal reasons to cancelled, interrupted and failed, preserving the originating reason.

The current uncommitted BrowserTaskRunner catch treats every message starting task_ as task_cancelled. AgentTaskControlService throws task_not_found and task_<state>, including interrupted or failed. Those failures therefore become user cancellation even when the user never stopped the task. Exercise renderer Stop while waiting, pause expiry, failed control state, removed task, parent abort and worker failure. Verify both returned results and durable state. Requirements D-FR-09, C-FR-08/12/16.

### N04 — P0 — proxy encryption migration remains inconsistent across consumers

- [ ] Introduce explicit secret-safe read/write paths and migrate every proxy consumer together.

googleMaps-ipc.ts:93 and yandexMaps-ipc.ts:101 still forward entity.pass as a browser password. Encrypted rows therefore send ciphertext to proxy authentication. SearchModule.ts:609,656,1232 still writes proxy.pass into search-task proxy records. Review the list/detail renderer DTOs and all scraper workers alongside these paths, including legacy plaintext rows, encrypted rows, missing keys and decryption failure. Keep plaintext restricted to the authorized network consumer and exclude it from renderer list responses, tool results and secondary persistence. Requirements P-FR-08, P-AC-02. The November 10 P0-8 inventory remains relevant.

### N05 — P1 — reservation and identity races remain outside runner admission

- [ ] Make site-ID allocation transactional and insert-only with conflict retry.
- [ ] Reserve per-domain capacity before asynchronous session initialization.
- [ ] Reserve both session and account during sign-in, including an account selected after username editing.
- [ ] Bind lease reuse to the unique owning task.

The BrowserSite model/module and credential-login service have no implementation changes since the November 7 audit baseline. The detailed November 10 X2 paths remain open, including nextAiSiteId followed by repository.save, sign-in reservation changes after card submission and conversation-only lease reuse. Reproduce simultaneous upserts with different domains, same-domain session starts, two accounts signing into one page, edited-account cooldown and sibling task lease acquisition. A conflicting save must never repoint a credentialed site. Requirements S-AC-01, A-FR-10, M-FR-06/07, D-FR-08.

## Missing production workflows

### N06 — P1 — hosted/native routes and planning remain incomplete

- [ ] Wire hosted availability and HostedDecisionClient through executeTask. It still returns hosted_decision_unavailable for the hosted route at ManagedBrowserAiToolService.ts:1319.
- [ ] Complete native profile configuration and supported-operation/format negotiation.
- [ ] Complete bounded planner, trusted value bindings, field helper/cache and runner sign-in integration.
- [ ] Enforce model-specific budgets, total usage accounting, provider change and active feature-disable behavior.

Completion criteria now reach the model, and recovery has a deadline. Preserve these fixes while verifying the entire provider→plan→action→independent verification path. Requirements D-FR-01–06/16–25, A-FR-14, design §§5/8–12.

### N07 — P1 — credential, account-picker and domain-confirmation journeys remain disconnected

- [ ] Mount the credential, account-picker and site-confirmation cards in the owning conversation with validated submit/cancel IPC and live waiting state.
- [ ] Use the observed redirect ledger in an actual one-time domain approval workflow.
- [ ] Replace static account labels/platform lookups with BrowserSite consumers.
- [ ] Finish per-account AI opt-in, explicit registration confirmation, same-site-frame filling and checked keystroke fallback.

Current renderer source searches find no production subscriptions/mounts for the three card flows. A no-account sign-in can wait for a response that the UI never exposes. A redirect ledger helper alone does not complete the domain-confirmation journey. Cover zero/one/many accounts, refusal/expiry, SSO identity, changed username, wrong password, all output surfaces containing a sentinel, and six translated UI flows. Requirements A-FR-03–21, S-FR-01–06, A-AC-01–05.

### N08 — P1 — root conversation, task controls and batch cleanup remain incomplete

- [ ] Carry the unique task owner and root conversation through AgentRuntime's query-loop input and every browser event.
- [ ] Route sessions, approvals, credentials and handoffs to the root conversation with task labels.
- [ ] Restore live batch state after component remount or chat switching.
- [ ] Enforce scoped batch consent, consequential-action restrictions and session cleanup when child output lacks a session ID.
- [ ] Implement bounded externalized result access, aggregate cost/provider concurrency limits and separately selected sub-agent model.

AgentRuntime has no changes since the November 7 baseline. The November 10 root-routing analysis remains open. Conversation filtering and multiple batch containers fix earlier UI mixing, but need authoritative state restoration and complete child ownership. Test two chats, overlapping batches, sibling isolation, remount, parent deletion, crash, Return now, stop-one/stop-all, pause/resume and 45-minute handoff. Requirements M-FR-01–13, C-FR-01–16.

### N09 — P1 — observation and operation coverage needs complete boundary evidence

- [ ] Verify live SELECT identity against the originating observation when options reorder or change before dispatch.
- [ ] Verify focused/dialog relevance and bounded continuation beyond all scan windows, including candidate-shortlist omissions.
- [ ] Bind same-site navigation to observed links or trusted plan provenance.
- [ ] Exercise legacy commands and runner commands concurrently at worker challenge, pause and takeover boundaries.

The prior hidden-prefix and long-option-value fixes are retained. Positional option tokens and bounded scans need the related mutation/coverage cases above before D-FR-12–17 acceptance closes. Existing executeTask integration tests improve coverage of the runner's real call path.

## Requirement coverage and release evidence

| Requirement group | Current status and remaining work |
| --- | --- |
| D-FR-01–04 | Provider gate foundation exists. N01/N06 cover identity and provider parity. |
| D-FR-05–10c | Runner and routing exist. N03/N05/N06/N08 cover terminal, ownership, planning and progress gaps. |
| D-FR-11–15a | Observation/revision fixes landed. N01/N09 cover identity, coverage and operation validation evidence. |
| D-FR-16–21 | Expanded operations exist. N01/N06/N09 cover provenance, options, adapters and field helpers. |
| D-FR-22–27 | Recovery, verification and approval fixes exist. N03/N06/N09 require complete lifecycle and production acceptance. |
| A-FR-01–21 | Credential-free tool and worker filler exist. N01/N05/N07/N08 remain open. |
| S-FR-01–06 | Registry and redirect ledger exist. N01/N05/N07 remain open. |
| P-FR-01–09 | Selection, encryption and restart foundations exist. N02/N04 plus country affinity, locale/timezone, direct/proxy UI and WebRTC evidence remain open. |
| M-FR-01–13 | Fan-out and batch controls exist. N05/N08 and aggregate resource qualification remain open. |
| C-FR-01–16 | Pause/handoff/control foundations exist. N02/N03/N07/N08/N09 remain open. |

- [ ] Remove fixme only after implementing and passing the actual app driver for browserDecisionTask.test.ts, browserParallelTasks.test.ts and the remaining sign-in test. Three decision tests, two parallel tests and one sign-in test are currently marked fixme. A green E2E job can skip these acceptance flows.
- [ ] Run complete component, utility and Electron app-flow checks against the reviewed working tree. Earlier CI results belong to their recorded commits.
- [ ] Complete six-language held-out paired task evaluation, independent outcomes, shortlist recall, active/user-wait timing, all-attempt costs, p50/p95 and rollback/upgrade evidence. PRD §§8–10 and design §§20–21 remain acceptance gates.

Local packaging is authorized under the updated repository instructions. Historical CI packaging success and later infrastructure failures should retain their exact revision attribution.

## Fixes verified in the update

The source update adds a runner internal action path, rejects unknown observed targets, strengthens keypress approval, uses monotonic registry revision resets, converts tool proxy selections, prevalidates and serializes proxy switches, and handles additional handoff states. The original November 7 six-defect list has corresponding fixes. The remaining related cases are listed above rather than treating historical unchecked entries as current proof.

The two existing uncommitted production edits were included in this review. N02 and N03 explicitly describe their current behavior. No production fixes are part of this documentation change.

## Validation scope and concurrent changes

The main Vitest configuration ran browserDecision, browserLogin, browserAgents and managedBrowser with its mandatory TypeScript precheck. The initial run reported 491 passing tests and two failing tests out of 493. Both failures were awaitRunnerApproval approve/deny cases receiving expired. During that run, external edits changed ManagedBrowserAiToolService and its test to key approvals by request ID. Those failures therefore require attribution against a stable snapshot. The later source correctly validates request ID plus session ID, improving the historical session-key collision.

The execution log is retained locally at %TEMP%/bda-nov12.log. Domain normalization was executed directly through TypeScript transpilation and a Node VM, yielding the three results documented in N01. Full component, Electron E2E, remote CI and packaged-artifact execution were not rerun in this audit. Source-confirmed defects and outstanding acceptance work should be closed with the regression cases specified above.

The affected approval-service suite was rerun after the concurrent edit and passed all 46 tests, including its TypeScript precheck. Its log is %TEMP%/bda-nov12-approval.log. This resolves the two observed failures in the targeted rerun. The full combined suite was not repeated after that external edit.
