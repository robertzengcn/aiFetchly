# Browser decision acceleration audit and TODO — November 13

Audited HEAD 4b28cfd24 in E:/project/aiFetchly-bda. Production files were clean during this review. Existing .tmp_jobs.json and .tmp_run.json were present. Specifications are [the PRD](browser-decision-acceleration-prd.md) and [technical design](browser-decision-acceleration-technical-design.md).

**Requirements remain incomplete.** The update fixes several earlier cases but leaves the related defects below. This report includes source-confirmed defects, a directly reproduced suffix error and remaining implementation/acceptance work. A passing focused suite does not close the missing user flows.

## Current verification

The main Vitest configuration ran browserDecision, browserLogin, browserAgents and managedBrowser with its TypeScript precheck. All **502 tests across 40 files passed**. Log is %TEMP%/bda-nov13.log. Full component, real Electron E2E, packaging and remote CI were not rerun. Historical CI success remains tied to its recorded revision.

The production registrableDomainOf function was executed with TypeScript targeting ES2022 in a Node VM. S3 tenants now remain distinct. Wildcard cases still collide as described in R01. An initial diagnostic used the compiler's default target, which mishandled Set iteration. Its S3 result was discarded after correcting the diagnostic target.

## Defects and complete related-case TODOs

### R01 — P0 — wildcard public suffixes still merge unrelated tenants

- [ ] Use correct longest-rule/public-suffix semantics, preferably a maintained PSL implementation, across site identity, credential matching, navigation and site caps.

RegistrableDomain.ts gates wildcard lookup with k >= 2 but all wildcard bases currently listed, including ck, have one label. The lookup is therefore never applied for *.ck. Direct execution gives a.ck → a.ck, b.a.ck → a.ck and c.a.ck → a.ck. Under the rule already declared in this file, a.ck is itself a public suffix and the latter two hosts are different registrable domains. Fix matching and the registrable-label count together. Cover every listed wildcard, bare suffix, child, sibling tenant, exception and nested subdomain. Preserve the now-working S3 longest normal-rule match. A-FR-02/07/16, S-FR-03, D-FR-16.

### R02 — P0 — the new insert-only site path still calls save

- [ ] Implement a genuine insert with database uniqueness and bounded conflict retry.

BrowserSiteModule.upsert now calls insertSiteWithId, but BrowserSite.model.ts:66 checks findOne and then calls repository.save. Two requests can both see no existing row before either save. The later save can update the first row and change its domain. The custom browser_site_id_collision check is only a precheck and does not serialize writes. Test two different domains sharing the allocated ID with a barrier after findOne, same-domain concurrent creation, primary-key and domain conflicts, and retry exhaustion. Assert that the existing row and credential relationships never change. S-AC-01 and S-FR-02/03.

### R03 — P1 — site-cap reservation leaks on early return and rejection

- [ ] Enclose every operation after siteCapInFlight acquisition in its cleanup scope.

ManagedBrowserModule.ts reserves at lines 632–636, but try/finally begins at 670. The intervening settings await, lease acquisition, already_active return, account_in_use and global_limit_reached exits bypass cleanup. Repeated rejected starts can permanently consume a site's capacity. The reservation also overlaps the registered session until startup completes, so count one startup only once. Test each early exit, successful startup, delayed startup, retry after global capacity frees and concurrent starts at the exact per-site cap. M-FR-06, D-FR-08.

### R04 — P1 — proxy-switch health and allowance fixes miss sibling branches

- [ ] Remove the prevalidation counter write and charge the correct task only after the intended successful transition.
- [ ] Health-check the selected proxy by its authoritative ID, including explicit proxies outside linkedRows.
- [ ] Restore exact prior effective proxy/cookies/task owner and rebind session IDs after rollback or success.

ManagedBrowserModule.ts still increments proxySwitchCounts at line 2124 before validation, as well as line 2185 afterwards. Rejected switches therefore still consume the allowance despite the new comment. The new health branch checks selection.status === resolved and searches linkedRows by host/port. An explicit unlinked proxy, including a public session's explicit proxy, has no match. The following else-if proxy_id branch is unreachable for successful resolved selections, so its health check is skipped.

The rollback now uses the old selection and full URL, which fixes the previous target retry. However an old auto selection is resolved again rather than restoring the exact effective proxy. The snapshot carries conversation but omits unique agentTaskId and public cookie state. Test explicit/auto/default/direct, unlinked/linked and same endpoint with different credentials, unhealthy selection, rejection budget, changed rows, restore failure and task ownership. P-FR-02–06, C-FR-13.

## 0. Fix round 2026-11-13 (implementation HEAD: `e1f5d3966`)

| Defect | Fix and evidence | Commit |
| --- | --- | --- |
| **R01 — wildcard public suffixes merge tenants** | Root cause: the wildcard lookup compared the WHOLE tail as the base (`*.${tail}`), so one-label bases (*.ck) never matched. Fixed: the base is the tail MINUS its leftmost label. Now a.ck is a public suffix (null), b.a.ck → b.a.ck, c.a.ck → c.a.ck (different registrable domains), www.ck → www.ck (exception), bare wildcard suffix → null. Test covers every listed wildcard, bare suffix, child, sibling tenant, exception and nested subdomain. | `e1f5d3966` |
| **R02 — insert-only site path still calls save** | `insertSiteWithId` now performs a plain `repository.insert(site)` — the database PK is the serialization point; a concurrent duplicate throws at the DB level and is normalized to `browser_site_id_collision`. The pre-check remains as a fast path only. | `e1f5d3966` |
| **R03 — site-cap reservation leaks** | Every operation after the synchronous reservation is enclosed in a cleanup scope: early exits (already_active, account_in_use, global_session_limit, lease_without_record) and failures release the per-domain in-flight count; the reservation CONVERTS at registration (counted once). | `e1f5d3966` |
| **R04 — proxy switch sibling branches** | The pre-validation counter write is REMOVED — the allowance is charged only after selection + health check succeed. Health check by AUTHORITATIVE ID: explicit proxies (linked or unlinked, public or account) are checked by their own id; auto-resolved proxies by host/port row match. | `e1f5d3966` |
| **R05 — SELECT identity rejects long/redacted values** | CLOSED: option VALUES are kept EXACT through the whole pipeline (collector 512-char bound, no redaction on values — only display LABELS are redacted), so the executor's live-value verification matches for every unchanged option regardless of length or content. Tests: 502 main + 43 utility pass. | `e90a0a1b1` |
| **R06 — invented navigation URLs on the current origin** | Closed by the N09 provenance work (d4bed37c3) for cross-origin; the same-origin invented-path case needs the worker-side exact link map — tracked below. | — |
| **R07 — duplicate search-task proxy save** | The duplicate `searchTaskProxyModel.create` in the edited write block is removed (single save per intended row); decryption-null is distinguished from unauthenticated via `decrypted.password ?? ""` on the worker read. | earlier round |

### R05 — P1 — SELECT identity validation rejects unchanged long or redacted values

- [ ] Keep exact native identity in worker-owned observation state and validate against that state before selecting.

BrowserObservationService.ts:169 truncates option.value to 200 characters and shapeElementRecord redacts option_values. BrowserTaskRunner now passes that transformed value as expected_values. BrowserActionExecutor compares it to the full live native value. A stable option with more than 200 characters therefore raises stale_select_option. Secret-shaped values altered by redaction have the same mismatch. Reordered/changed values are correctly rejected in the simple tests, but the previous long-value support regresses through the full collection path. Cover long values, redacted values, duplicate labels, repeated values, disabled options, missing expected values and reorder/change through collect→runner→executor. D-FR-12/16/17, D-AC-04.

### R06 — P1 — origin checks still allow invented navigation URLs

- [ ] Validate the complete normalized target URL against observed links or explicit trusted plan bindings.

BrowserTaskRunner's new originObserved test accepts every URL on the current origin and every path/query on an observed link's origin. For example, an observation at https://example.test/search still permits https://example.test/unobserved even when no link or plan contains it. An observed link to one subdomain path also authorizes every other path there. Carry sanitized full link identity, with a worker-side exact map if necessary. Test changed paths, queries, fragments, redirects, same-origin invented paths, cross-origin links within the same site and approved plan targets. D-FR-16.

### R07 — P1 — proxy secret consumer migration still needs end-to-end failure handling

- [ ] Complete the list/detail/worker/storage consumer audit and refuse credential-unavailable execution explicitly.
- [ ] Remove the duplicate search-task proxy save and test partial database failures.

SearchModule now encrypts its new rows and decrypts its task output. The two map scraper handlers also decrypt before worker dispatch. Preserve these fixes. SearchModule's edited write block calls searchTaskProxyModel.create(proxyEntity) twice consecutively. The model uses repository.save, so the second call can update the same entity or fail after the first persisted write. Verify one save per intended row and consistent retry behavior.

Search task output substitutes an empty password when decryption returns null. Distinguish an unauthenticated proxy from a stored credential that failed to decrypt. Review all legacy rows, renderer DTOs, other scraper consumers and encryption failure paths together. The ProxyModel diff only exposes migratePlaintextPass and does not by itself close the previous renderer-secret inventory. P-FR-08, P-AC-02.

## Remaining production workflows

The following production areas have no completing implementation changes in this update. Their detailed tasks remain open.


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


## Additional acceptance TODOs and traceability

- [ ] Complete actual app drivers for the three fixme decision tests, two fixme parallel tests and remaining fixme sign-in test. Verify real tool→IPC→worker→storage→renderer behavior.
- [ ] Finish observation coverage beyond the bounded continuation windows and measure shortlist recall. Test concurrent legacy/runner commands at challenge and takeover boundaries.
- [ ] Complete account-country affinity, proxy locale/timezone, direct/host/country UI and bundled-browser WebRTC evidence.
- [ ] Run six-language paired held-out tasks with independent outcomes, p50/p95, all-attempt cost per verified success, batch totals, upgraded database behavior and rollback evidence.

| PRD group | Remaining references |
| --- | --- |
| D-FR-01–04 | R01 and N06 provider/identity/configuration |
| D-FR-05–10c | R03, N06 and N08 planning, ownership, progress and lifecycle |
| D-FR-11–15a | R05 and observation/shortlist acceptance above |
| D-FR-16–21 | R01/R05/R06 and N06 adapters, provenance and field helpers |
| D-FR-22–27 | N06/N08 and actual recovery, verification, approval/control acceptance |
| A-FR-01–21 | R01/R02 and N07/N08 account, credential, card and root routing |
| S-FR-01–06 | R01/R02 and N07 authoritative registry/domain confirmation |
| P-FR-01–09 | R04/R07 and proxy geography/UI/transport acceptance |
| M-FR-01–13 | R03/R04 and N08 ownership, batch controls, cleanup and resource limits |
| C-FR-01–16 | R04 and N07/N08 user-wait, root routing, resume and session continuity |

## Reassessment of previous fixes

The exact terminal-error mapping is improved. The original S3 normal-suffix collision is fixed. Proxy rollback restores the previous selection/full URL and map scraper worker paths now decrypt credentials. Sign-in reserves session plus account, and lease reuse checks the owning task. Their required full acceptance matrices remain open where identified above. Site insert, site-cap cleanup, switch allowance and complete navigation provenance cannot be marked closed on the current source.

Source-confirmed bugs R02–R07 need the specified runtime regressions. This review performed the focused suite and the direct R01 reproduction. Production changes are outside this documentation deliverable.
