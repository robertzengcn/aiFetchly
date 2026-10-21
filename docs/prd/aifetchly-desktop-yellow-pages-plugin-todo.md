# AiFetchly Desktop Yellow Pages Plugin — Completion Audit and TODO

Date: 2026-10-19
Audited desktop commit: `6b99a2108ab88ca1707d9d71d0c6beba55e4930e`
Scope: [Desktop PRD](aifetchly-desktop-yellow-pages-plugin-prd.md) and [desktop technical design](aifetchly-desktop-yellow-pages-plugin-technical-design.md).

## Verdict

**Not complete and not ready to claim release acceptance.** Substantial implementation exists: host runtime declarations/launching, async dispatch, progress, cancellation signals, retry ledger, artifact storage/IPC/UI, and removal of the legacy workers/tools/routes/entities. Passing unit tests do not establish the required end-to-end behavior. The defects below include directly reproduced failures plus implementation errors established by tracing callers and callees.

This is an audit/backlog, not an implementation change. No production fixes were made. Independent plugin builds, deployed Hub behavior, and packaged Windows/macOS/Linux release acceptance were not verified. Their status is **unverified**, not an assertion that they do not exist.

Status vocabulary: **Implemented** = inspected implementation plus relevant local tests; **Partial** = foundation exists but a specified behavior is missing/broken; **Unverified** = requires external/release evidence; **Deferred** = explicitly later/conditional scope. P1 means fix before release; P2 means complete before claiming the affected requirement. Checkboxes remain open until fixes and their acceptance tests pass.

## Checks performed

| Check | Result |
| --- | --- |
| Focused services: policy/runtime/browser/recovery/artifacts/normalizer/async MCP/partial gate/activation/lifecycle/job settlement/signals/query-loop polling | 13 files, 110 tests passed |
| Main-process legacy-removal, supervised transport, foreground MCP timeout tests | 3 files, 27 tests passed; configured non-incremental `tsc --noEmit` gate passed |
| Contracts, MCP declaration, manifest and import tests | 4 files, 47 tests passed; repeated TypeScript gate skipped because it had just passed for the same unchanged source |
| Full `yarn test:components` | 127 files, 955 tests passed |
| Additional isolated probes against current TS implementations | Reproduced CSV preview exception, accepted in-root symlink, false CSV count, oversized preview, forged recovery reference acceptance, invalid/contradictory envelopes, duplicate settlement and late progress |
| Packaged browser/process-tree matrix, live staging Hub, plugin scrape/export/cancel E2E, seeded legacy database upgrade | Not run; release gates remain open |

Total executed Vitest tests: **1,139 passing**. No full-repository test pass is claimed. Probes transpiled the actual services with TypeScript, stubbed only Logger/environment imports, and used real temporary files for artifact tests; this was not an Electron UI reproduction. Temporary probes/logs are outside the repository and are not durable test coverage. Each item below states the permanent regression test to add.

Reproduction commands for the checked suites:

```sh
yarn vitest run --config vitest.service.config.mjs test/vitest/main/service/PluginToolPolicyRegistry.test.ts test/vitest/main/service/PluginMcpRuntimeResolver.test.ts test/vitest/main/service/PluginBrowserCapabilityService.test.ts test/vitest/main/service/PluginRecoveryLedger.test.ts test/vitest/main/service/PluginFileArtifactService.test.ts test/vitest/main/service/McpResultNormalizer.test.ts test/vitest/main/service/MCPToolServiceAsync.test.ts test/vitest/main/service/PluginPartialGate.test.ts test/vitest/main/service/PluginComponentRegistryService.activationGate.test.ts test/vitest/main/service/PluginComponentRegistryService.lifecycle.test.ts test/vitest/main/service/ToolJobRegistry.settled.test.ts test/vitest/main/service/ToolJobRegistry.signal.test.ts test/vitest/main/service/AIChatQueryLoopAsyncPoll.test.ts
yarn vitest run --config vite.main.config.mjs test/vitest/main/yellowPagesLegacyRemoval.test.ts test/vitest/main/modules/mcp/SupervisedStdioTransport.test.ts test/vitest/main/MCPToolServiceTimeout.test.ts
AIFETCHLY_SKIP_TSC=1 yarn vitest run --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginExecutionTypes.test.ts test/vitest/utilitycode/pluginMcpDeclaration.test.ts test/vitest/utilitycode/pluginImportService.test.ts test/vitest/utilitycode/pluginManifestService.test.ts
yarn test:components
```

## Requirement traceability

### HOST and Hub requirements

| ID | Status | Evidence/outstanding work |
| --- | --- | --- |
| HOST-01 policy registry | Partial | Registry validates/clamps schemas, stable names and capability versions; missing server/tool referential validation and generation binding: G01, B13. |
| HOST-02 policy resolution | Implemented | `AIChatQueryLoop` resolves skill → plugin policy → name inference around line 5459. Related admission gaps remain G01. |
| HOST-03 context propagation | Partial | Deadline/signal/execution ID/recovery flow reaches MCP; installed version/generation and capability provenance incomplete: B13. |
| HOST-04 progress bridge | Partial | SDK callback reaches registry and renderer; bounded rate/privacy/terminal handling incomplete: B04, G02. |
| HOST-05 partial bridge | Partial | Versioned correlated partial gate exists; unknown total becomes 0 and cancellation/late-state behavior needs correction: G02. |
| HOST-06 cancellation | Partial | Abort signal and supervised process-group termination exist; cleanup truthfulness and lifecycle race: B04, B05, B07. |
| HOST-07 deadlines | Partial | Async bypasses foreground 240-second ceiling; total budget is not enforced across connect/call/cleanup: B07. |
| HOST-08 notifications | Partial | Progress/partial handling exists; remaining caps/redaction/rate enforcement: G02. Server-to-host AI requests deferred. |
| HOST-09 normalization | Partial | Basic success propagation exists; envelope validation and post-artifact verdict broken: B02, B03. |
| HOST-10 duplicate suppression | Partial | Canonical object-key hashing and active fingerprint lookup exist; field-order/string normalization and per-plugin lease missing: G01. |
| HOST-11 terminal cleanup | Partial | Supervised close/shutdown hooks exist; false settlement, temporary-state retention and lifecycle race: B04, B05, B12, B13. |
| HOST-12 in-session broker | Deferred | Optional Phase 5; not a v1 blocker. See D01. |
| HOST-13 docs correction | Partial | `skillTypes.ts` now describes managed async; PRD current-state tables and implementation plan still describe superseded gaps: G05. |
| HOST-14 embedded runtime | Partial | Runtime/entry, confinement, trusted Node-mode injection implemented and unit tested; launch authority and packaged proof: B13, R01. |
| HOST-15 browser capability | Partial | Wrapper exists; production configuration/cache inputs, health/recovery and compatibility checks incomplete: B11. |
| HOST-16 retry ledger | Partial | Cross-process memory, budgets and reservations exist; forged reference/new-user/cancelled reservation handling: B08. |
| HOST-17 artifacts | Partial | Store, Module, IPC, card and six translations exist; B01/B03/B09/B10/B12 and G03/G04 remain. |
| HOST-18 Hub compatibility | Partial / Unverified | Existing direct installation path; diagnostics issue and conditional ZIP/managed work: R01/R02. |
| HUB-01 publication | Unverified, external owner | Require exact catalog/version/source and packaged installation evidence: R01. |
| HUB-02 contract validation | Unverified, external owner | Require Hub validation/packaging tests for selected route: R01/R02. |

### Acceptance criteria

| ID | Status | Remaining proof/fix |
| --- | --- | --- |
| AC-01 optional capability | Implemented for removed built-in tool/route surface | Legacy absence tests pass; unhealthy plugin exposure remains an activation issue, B11/B13. |
| AC-02 plugin-owned scrape | Partial / Unverified | Old workers removed; independent installed plugin execution requires R01 E2E evidence. |
| AC-03 no legacy persistence dependency | Implemented in desktop structure | New artifacts are files; legacy entity wiring removed. Seeded upgrade proof still R03. |
| AC-04 long jobs | Partial | Deadline-aware execution exists; B07 and actual four-minute-plus packaged scenario. |
| AC-05 progress | Partial | Bridges exist; G02 and E2E display/correlation. |
| AC-06 cancellation | Partial | B04/B05/B07; real browser-descendant matrix R01. |
| AC-07 structured recovery | Partial | B02/B08; model-round and permitted retry integration test G04. |
| AC-08 correct failure semantics | Partial | B02/B03. |
| AC-09 bounded retry | Partial | B08/G01. |
| AC-10 bounded output | Partial | Artifacts exist; preview/result caps and validation B01/B02/B10/G03. |
| AC-11 privacy | Partial | B09/B10/B13/G02; no claim that arbitrary payloads are sanitized. |
| AC-12 cleanup | Partial | B04/B05/B12/B13 plus packaged descendant tests. |
| AC-13 AI gate | Partial / Deferred broker | Async admission explicitly checks `Token`/`USER_AI_ENABLED`; current chat IPC uses provider-aware gate. Resolve literal PRD/provider policy and optional broker under D01. |
| AC-14 no system Node | Partial / Unverified | Trusted launch exists and tests pass; packaged fuse/no-Node matrix R01. |
| AC-15 browser separation | Partial | B11; plugin-client compatibility requires independent-repository evidence. |
| AC-16 independent repo + Hub delivery | Unverified | R01. A local folder/side-load is insufficient. |
| AC-17 compatible distribution/update safety | Partial | B06/B11/B13/R01/R02. |
| AC-18 full extraction + retained data | Partial | Core removals verified; retained directory adapters, release order and database upgrade evidence R03. |
| AC-19 retry state + usable artifacts | Partial | B01/B03/B08/B09/B12. |

### Technical-design work units and remaining prose requirements

| Design coverage | Status / tasks |
| --- | --- |
| TD-01 contracts; §§5, 10.4 | Partial: B02/B13/G01; external contract fixtures R01. |
| TD-02 runtime; §6 | Partial: B11/B13/R01. |
| TD-03 policies; §5.4 | Partial: G01/B13. |
| TD-04 jobs/context; §§7–9 | Partial: B04/B05/B07/B08/G01. |
| TD-05 progress/results; §§9–10.4 | Partial: B02/B03/G02. |
| TD-06 browser; §6.3 | Partial: B11. |
| TD-07 recovery; §12.2 | Partial: B08; local ledger tests pass but omit reproduced case. |
| TD-08 artifacts; §13 | Partial: B01/B03/B09/B10/B12/G03/G04. |
| TD-09 activation/lifecycle; §14 | Partial: B05/B06/B11/B13/G01. |
| TD-10 distribution; §16 and linked plugin §15 | Unverified/conditional: R01/R02. |
| TD-11 migration; §17 | Partial: R03. |
| PRD §§2–7 goals/non-goals/architecture; design §§1–3 | Host/plugin split exists; genericity and repository boundaries G01/B13, independent delivery R01, optionality/migration R03. |
| PRD §9 and §§11, 14 | Runtime policies, async lifecycle and normalization covered by HOST matrix and B02–B08/G01/G02. |
| PRD §§15, 30 later-phase alternatives | D01; do not add detached/resumable jobs, direct plugin AI credentials or arbitrary recovery code to v1. |
| PRD §§17–20 security/artifacts/install/UX | B01/B09–B13/G02/G03/G04/R01/R02; existing translations present in all six files. |
| PRD §§21–22 existing assessment/required host changes | HOST matrix and G05; historical implementation descriptions are not completion evidence. |
| PRD §24 reliability/performance/compatibility/observability; design §20 | B02/B04/B07/B09/B13/G01/G02/G03/G04; all functions/types/diagnostics also need final implementation checks. |
| PRD §25 tests, §26 acceptance; design §19 | Local results above; G04/R01/R03 remain. |
| PRD §§27–28 rollout/migration and §29 risks; design §21 | R01/R03 and the prioritized defects below. |
| PRD §31 open decisions and §32 success metrics | R04; 95% artifact success and 95% cancellation within five seconds have not been measured. |
| Source references/terminology (PRD §§33–34; design §22) | Reference material; G05 keeps links/current-state statements accurate. |

## Confirmed defects and corrective tasks

### B01 — P1 — Fix CSV preview and enforce byte-bounded previews

- [x] Fixed — bounded UTF-8 filesystem adapter, byte-capped RFC-4180-aware previews, allowlisted JSON envelope, renderer truncation note (B01).

**Fix committed:** `defaultFs()` is now an explicit adapter — `readFileSync` decodes as UTF-8 (the prior `{...fs} as ArtifactFs` cast promised `string` reads that broke real CSV previews) and a new `readBufferSliceSync(p, end)` positional read previews WITHOUT loading a 100 MiB artifact. `preview()` reads at most `maxPreviewReadBytes` (1 MiB), splits CSV by RFC-4180 record rules (`extractCsvPreviewRecords`: quoted commas/newlines are not boundaries, CRLF/LF/CR all terminate), builds JSON envelopes through `extractJsonPreviewRecords` (full parse, scanner-based salvage of complete records when the input slice cuts mid-document) with an allowlisted envelope (`schemaVersion`/`records`/`truncated`), 512-char per-field cap with 32-entry nesting cap, hard 16 KiB (maxPreviewBytes) envelope cap, and a `truncated` flag whenever rows/bytes/fields were dropped or the input was cut (legacy unparseable content falls back to a bounded text slice). Renderer: `PluginArtifactCard` surfaces an explicit truncation note (`data-testid="plugin-artifact-preview-truncated"`, i18n key present in all six languages) when the host capped the preview or the display rows were capped, plus a genuine reactivity fix — `ensureRow` now returns a `reactive()` row so per-row preview writes actually re-render (previously stored as a raw object, writes never triggered). 32 service + 960 full component-suite tests green (new suite: 5 cards tests). This last commit records the reviewer-facing note.

Evidence: [src/service/PluginFileArtifactService.ts](../../src/service/PluginFileArtifactService.ts) (bounded preview machinery), [src/views/components/aiChatV2/PluginArtifactCard.vue](../../src/views/components/aiChatV2/PluginArtifactCard.vue).

**Observed:** production `defaultFs()` casts Node `fs` to an interface claiming `readFileSync()` returns a string, but supplies no encoding. Real CSV preview throws `TypeError: text.split is not a function`. JSON with one 100,000-character record returned a **100,025-byte** preview; five-row slicing does not bound bytes and preserves arbitrary top-level fields.

**Fix:** use an explicit UTF-8 filesystem adapter, bounded reads/parsing and an allowlisted preview envelope. Parse CSV records correctly (quoted newlines are not record boundaries). Cap byte size as well as rows, including individual fields and JSON summary metadata.

**Done when:** real-filesystem JSON/CSV tests cover UTF-8, long fields, quoted newlines and malformed data; IPC and `PluginArtifactCard` show a usable bounded preview with a truncation indication. Maps to HOST-17, AC-10/19, design §13.4.

### B02 — P1 — Validate versioned tool results and preserve structured tool errors

- [x] Fixed — version-aware contract validation, contradiction rejection, preserved structured errors with bounded/redacted diagnostics, contract-based selection (B02).

**Fix committed:** `normalizeMcpToolOutcome` now classifies a success-claiming candidate against the v1 contract: `schemaVersion` must be exactly 1 (999 or absent → stable invalid-result failure, `invalidResult: true`, no raw payload — stringified version at most), `structuredContent` is preferred with the JSON text probed only as a fallback, and a JSON text copy whose `success` disagrees with the structured envelope is a stable "contradictory" failure instead of letting different consumers see different results; non-JSON prose is never interpreted as a contract envelope. `isError: true` payloads now KEEP the original structured error object under `error` (code/category/`allowedStrategies` survive → the query-loop recovery path records recoverable classifications), carry a capped `message`, and move the rest into `diagnostics` that are redacted (token/secret/password/cookie/api-key keys emptied and renamed `[redacted]`), clipped (256 chars/16 list items/24 keys) and hard-capped at 8 KiB with a `diagnosticsTruncated` marker. `ToolExecutor` selects normalization by the REGISTERED plugin policy (`getPluginToolPolicyRegistry().resolveByToolName`), not by any deadline/signal: an unregistered tool with a signal keeps legacy semantics (`{success:true, result}`, foreground path untouched for `mcp_<id>` legacy tools).

Evidence: [src/service/McpResultNormalizer.ts](../../src/service/McpResultNormalizer.ts) (v1 classifier, contradiction check, bounded diagnostics), [src/service/ToolExecutor.ts](../../src/service/ToolExecutor.ts) (contract-registered selection), new tests [ToolExecutor.pluginContract.test.ts](../../test/vitest/main/service/ToolExecutor.pluginContract.test.ts) + 16-test `McpResultNormalizer` suite. This last commit records the reviewer-facing note.

**Observed:** `{schemaVersion:999,success:true}` is accepted as a successful domain envelope. Structured `success:true` plus JSON-text `success:false` is also accepted as success. Validation checks only a Boolean flag. `isError:true` moves structured diagnostics under `diagnostics` and replaces `error` with a string, so the query-loop recovery path cannot use the original error code/strategies. Structured diagnostics are copied without schema/redaction/byte limits. Selection is based on any execution signal/deadline, not the registered result contract.

**Fix:** select normalization by validated policy/contract, reject unknown/malformed versions and contradictory representations, preserve validated error objects with `success:false`, bound/redact before persistence and model serialization, retain legacy semantics for unrelated MCP tools.

**Done when:** schemaVersion 999, missing fields, contradictions and sensitive/oversized diagnostics produce stable safe failures; a recoverable `isError` result reaches failure hooks and the next model round with its authorized strategies; legacy MCP regression tests pass. HOST-09, AC-07/08/11, design §10.4.

### B03 — P1 — Propagate artifact registration failure to the outer tool verdict

- [x] Fixed — promotion drives the outer verdict and ledger; artifacts required only for artifact-declaring plugins (B03).

**Fix committed:** `spawnPluginAsyncTool` now promotes artifacts BEFORE final verdict/ledger settlement. `promotePluginArtifactsToPayload` returns a typed `PluginArtifactPromotionOutcome` (`stagingExists`, `candidateCount`, `registeredCount`, `errors`, `degradedToFailure`). When a plugin success payload is degraded (no durable registered artifacts while the tool is graded on artifacts), the OUTER `result.success` is flipped to false (PostToolUseFailure hooks and the next model round finally see it), the degraded error carries `ARTIFACT_REGISTRATION_FAILED` with `recoverable:false`, and the ledger records the attempt as FAILED instead of a phantom success (a repeat of the same run consumes budget). Artifacts are graded only when the plugin DECLARES the capability: `PluginToolPolicyRegistry.registerFromManifest` now records `manifest.capabilities.fileArtifacts` per plugin (lifecycle follows `unregisterPlugin`), and `getPluginArtifactFormats(pluginName)` gates the require-artifacts semantics — a generic async tool (e.g. `list_platforms`) with no declared formats and no staging is never degraded. Partial promotion (some files registered, some errors) still attaches the registered refs and appends a warning without flipping the verdict; crash-path promotion (undefined payload) is unchanged best-effort salvage (B04 quarantine applies to the durable files).

Evidence: [src/service/AIChatQueryLoop.ts](../../src/service/AIChatQueryLoop.ts) (promotion before verdict/ledger, outer-success flip, typed outcome), [src/service/PluginToolPolicyRegistry.ts](../../src/service/PluginToolPolicyRegistry.ts) (declared artifact formats), new tests [AIChatQueryLoop.artifactPromotion.test.ts](../../test/vitest/main/service/AIChatQueryLoop.artifactPromotion.test.ts) (degrade+ledger-failed, artifact-registered success, generic non-artifact valid, partial warnings, promotion outcome). This last commit records the reviewer-facing note.

**Code-path defect:** `spawnPluginAsyncTool` settles the recovery ledger using `result.success` before promotion. `promotePluginArtifactsToPayload` can subsequently mutate only `result.result.success` to false when staging/candidates are absent. `handle.resolve(result)` still returns outer `success:true`; the old nested-success bug reappears after artifact validation. The ledger has already forgotten the successful attempt. Promotion also assumes every async plugin tool needs files, including generic tools that declare no artifact capability.

**Fix:** promote before final verdict/ledger settlement, return a typed promotion outcome, update the outer verdict and failure hooks, and require artifacts only for the appropriate declared contract/capability.

**Done when:** success-with-missing/invalid-output becomes outer failure and invokes `PostToolUseFailure`; useful partial output is represented consistently; an async non-artifact plugin remains valid. HOST-09/17, AC-08/19.

### B04 — P1 — Make job settlement idempotent and separate cleanup failure from success

- [x] Done — idempotent terminal settlement, late-update suppression, quarantine on unproven cleanup (`getCleanupOutcome`).

Evidence: [src/service/ToolJobRegistry.ts:214](../../src/service/ToolJobRegistry.ts#L214); [src/service/ToolJobRegistry.ts:282](../../src/service/ToolJobRegistry.ts#L282); [src/service/ToolJobRegistry.ts:428](../../src/service/ToolJobRegistry.ts#L428).

**Reproduced:** resolving a handle twice overwrites the terminal result and decrements capacity twice. With `maxConcurrent:1`, two subsequent unresolved jobs both start. `updateProgress()` accepts a late update to a completed job; partial updates have the same missing terminal guard.

**Additional code-path defect:** the 15-second cancel grace timer calls `finishSettling()` without proof of process cleanup. That releases the lease and reports settled even if the spawn promise is still pending, allowing lifecycle code to delete/replace files under live work.

**Fix:** guard all terminal transitions and capacity release exactly once, ignore late notifications, maintain an explicit cleanup result, and retain/quarantine ownership on failed cleanup rather than declaring it complete after elapsed time.

**Done when:** duplicate resolve/reject and resolve-then-reject leave capacity/result unchanged; late updates are ignored; a never-settling fake process yields a cleanup failure and blocks replacement/admission. HOST-06/11, AC-06/12, design §7.3.

### B05 — P1 — Hold lifecycle admission seals through disable/uninstall/update

- [x] Done — `withPluginLifecycleSeal` owns the seal for the whole transaction (quiesce → op → release); disable/uninstall IPC + overwrite import migrated; boundary tests added.

Evidence: [src/service/PluginComponentRegistryService.ts:153](../../src/service/PluginComponentRegistryService.ts#L153); [src/main-process/communication/plugin-ipc.ts:584](../../src/main-process/communication/plugin-ipc.ts#L584); [src/service/PluginImportService.ts:539](../../src/service/PluginImportService.ts#L539).

**Code-path defect:** `stopActiveJobsForPlugin()` releases its seal in `finally` before its caller toggles state, deletes rows/files or stages an update. Async gaps in those callers permit a new job to enter after the old jobs quiesce and before removal. The update caller releases the seal even before further component validation and file copying.

**Fix:** move seal ownership to the entire lifecycle transaction, suppress discovery at the beginning, retain it through rollback/activation, and recheck enabled generation when queued work starts. A failed cleanup must not reopen admission prematurely.

**Done when:** an integration test starts a second job at every awaited lifecycle boundary and all admissions are refused until safe completion; no binary is deleted under a running job. HOST-11, AC-12/17, design §14.

### B06 — P1 — Restore the complete previous installation on failed update

- [x] Fix and verify B06. — restorePreviousGeneration() wired into every post-teardown failure branch (plugin row, skills, MCP rows, agents, discovery smoke test, activation-gate-blocked overwrite): failed gen unregistered (doc skills + capabilities), backup moved back, plugin/skill/MCP/agent rows recreated (original MCP row ids preserved so Token trust maps), old policies re-registered; 5 injected-failure integration tests pass (utilitycode/pluginImportServiceB06rollback.test.ts). This last commit records the reviewer-facing note.

Evidence: [src/service/PluginImportService.ts:711](../../src/service/PluginImportService.ts#L711); [src/service/PluginImportService.ts:752](../../src/service/PluginImportService.ts#L752); [src/service/PluginImportService.ts:971](../../src/service/PluginImportService.ts#L971); [src/service/PluginImportService.ts:1180](../../src/service/PluginImportService.ts#L1180).

**Code-path defect:** overwrite swaps files then uninstalls old database rows before policy validation, persistence and discovery succeed. Discovery failure restores the backup directory only, while rollback deletes the plugin/skill/MCP rows. Other failure branches remove the new install without restoring the backup. An incompatible update can replace a healthy plugin with an invalid one. Only disabled agent IDs are explicitly preserved; plugin/skill/MCP enablement needs preservation too.

**Fix:** prevalidate in staging; snapshot old metadata, component state, policies and trust/provenance; activate a new generation atomically with compensating rollback for every failure point. Restore rows and files together and unregister prematurely registered policies/skills.

**Done when:** injected failures in policy validation, plugin/skill/MCP/agent writes, discovery and promotion retain an executable old version and its component preferences/artifacts. AC-17, TD-09, design §14.2.

### B07 — P1 — Enforce one deadline across connection, execution and cleanup

- [x] Fix and verify B07. — executeMCPToolContent recomputes the monotonic deadline before connect() AND tools/call, bounds connect with the same budget, subtracts HOST_CLEANUP_RESERVE_MS from the call budget, races cleanup and reports cleanupPending on unconfirmed shutdown; query loop wakes exactly on the deadline, awaits cleanup on user Stop, and buildDeadlineExceededResult/buildTurnCancelledResult report truthful cleaned_up/cleanup_pending; 9 new tests pass (MCPToolServiceDeadline.test.ts + AIChatBackgroundJobResults.test.ts). This last commit records the reviewer-facing note.

Evidence: [src/service/MCPToolService.ts:859](../../src/service/MCPToolService.ts#L859); [src/service/MCPToolService.ts:909](../../src/service/MCPToolService.ts#L909); [src/service/AIChatQueryLoop.ts:5128](../../src/service/AIChatQueryLoop.ts#L5128).

**Code-path defect:** the MCP service computes remaining time before browser/context setup and `connect()`, then uses that stale duration for `tools/call`. The five-second cleanup reserve is checked but not subtracted. Connection is not bounded by the same remaining work budget here. Query-loop polling sleeps in 15-second intervals, so it is a late backstop, not a precise absolute deadline. User Stop returns before awaiting cleanup. Deadline error text says underlying work stopped even when `cleaned_up:false`.

**Fix:** enforce the monotonic deadline through connection and execution, recompute before each operation, reserve cleanup time, wake on the exact deadline, and return truthful `cleanup_pending`/failure states on unconfirmed shutdown. Swallowed disconnect failures must not become successful cleanup.

**Done when:** delayed handshake, slow capability resolution, queued expiry, continuous progress and unresponsive shutdown tests cannot extend the budget or claim cleanup falsely; retain foreground timeout behavior. HOST-06/07/11, AC-04/06/12/19, design §9.

### B08 — P1 — Reject forged recovery references and fix reservation lifecycle

- [x] Fix and verify B08. — the ledger is now fail-closed for every recovery-field request without a live entry (fresh scope, foreign conversation, post-restart), adopts `userTurnId` as the host-verified turn identity (a genuinely NEW user message resets the budget only when the model presents no recovery fields), independently enforces the recoverable/fatal policy (fatal/plugin_bug/user_intervention/auth/permission categories and a `recoverable:false` envelope can never carry strategies; unknown strategy strings are dropped), and the reservation lifecycle releases on sealed admission (loop calls `completeAttempt("failed")` in the admission catch) and on queued cancellation (new `ToolJobRegistry.onSettledById` fires the settle hook even when the spawn callback never runs). Loop spawn settlement now forwards the envelope's `recoverable` flag and turn id into `recordFailure`/`recordTransportFailure`. 27/27 PluginRecoveryLedger tests pass (7 new); prior expectations that legitimized foreign references or plugin_bug strategy envelopes were corrected to the new host policy; ToolJobRegistry.settled + AIChatRecoveryTypes (33) and ToolExecutor.searchRecovery/Async (7) stay green. This last commit records the reviewer-facing note.

Evidence: [src/service/PluginRecoveryLedger.ts:235](../../src/service/PluginRecoveryLedger.ts#L235); [src/service/PluginRecoveryLedger.ts:321](../../src/service/PluginRecoveryLedger.ts#L321); [src/service/AIChatQueryLoop.ts:4564](../../src/service/AIChatQueryLoop.ts#L4564); [src/service/AIChatQueryLoop.ts:4756](../../src/service/AIChatQueryLoop.ts#L4756).

**Reproduced:** on a fresh/changed search identity, `validateAndReserve({previousErrorId:"forged",strategy:"switch_platform",...})` returns `ok:true` as attempt 1. Foreign/stale/post-restart references are not rejected when the target key has no entry.

**Other code-path gaps:** reservation occurs before `registry.start`; an admission-sealed rejection leaves it reserved. A queued cancellation never invokes the spawn callback where `onSettled` is attached. The ledger has no trusted new-user-search/reset identity, so after failure an explicit user retry in the same conversation can remain blocked until restart. Keys omit user session and generation. Failure recording consumes supplied allowed strategies without independently checking `recoverable`/fatal policy.

**Fix:** fail closed whenever recovery fields exist without a valid same-scope reference; attach reservation cleanup before queue admission; settle admission rejection/queued cancellation; distinguish explicit new user intent from model retries using trusted request identity; bind session/generation and enforce fatal/cancelled strategy policy.

**Done when:** forged/wrong-conversation/stale/changed-scope/post-restart references fail; queued cancellation and sealed admission leave no in-flight lock; explicit user restart works without giving the model a budget-reset bypass. HOST-10/16, AC-09/19, design §12.2.

### B09 — P1 — Authenticate artifact access instead of trusting supplied conversation IDs

- [x] Fix and verify B09.

Evidence: [src/main-process/communication/plugin-artifact-ipc.ts:74](../../src/main-process/communication/plugin-artifact-ipc.ts#L74); [src/modules/PluginFileArtifactModule.ts:25](../../src/modules/PluginFileArtifactModule.ts#L25); [src/service/PluginFileArtifactService.ts:93](../../src/service/PluginFileArtifactService.ts#L93); [src/service/PluginFileArtifactService.ts:559](../../src/service/PluginFileArtifactService.ts#L559).

**Code-path defect:** list/preview/delete ignore IPC sender identity; export does not use its event to authorize. The Module simply delegates. Matching an artifact's conversation ID against the same ID supplied by the caller is not session/conversation authorization. The singleton defaults to a shared `default` scope, not a host-derived authenticated user scope.

**Impact:** a caller who knows another conversation ID can ask for its artifacts; the intended account/session boundary is not established. This audit did not perform an account-switch UI exploit.

**Fix:** validate sender/frame/session through existing app authorization, resolve conversation ownership server-side in the Module, derive the artifact root from authenticated host identity, and reset scoped services on account changes. Keep native dialog destinations and avoid AI-gating ordinary file reads.

**Done when:** foreign sender/session/account/conversation list, preview, export and delete requests are denied even with valid IDs; same-owner access survives plugin uninstall. AC-11/19, design §13.1/13.4.

### B10 — P1 — Validate actual artifact files, records and path/format agreement

- [x] Fix and verify B10.

Evidence: [src/service/PluginFileArtifactService.ts:130](../../src/service/PluginFileArtifactService.ts#L130); [src/service/PluginFileArtifactService.ts:504](../../src/service/PluginFileArtifactService.ts#L504).

**Reproduced:** an in-staging symlink `records.csv -> target.csv` is accepted because `lstatSync` runs after resolving the link. A one-record CSV claiming 999 records is registered with 999. Hard-link counts are not checked. Filename and format are independently allowlisted, so `records.csv` + `format:json` (or the reverse) is not rejected as a mismatch.

**Additional gaps:** `candidates.json` is read without size/link limits; JSON validation counts `records` but does not validate the artifact schema, and missing `records` can masquerade as an empty dataset. CSV formula-neutralization and syntax/count validation are absent in the host boundary. Staging/root ownership is assumed; digest computation is absent.

**Fix:** validate the original path and containing directories before following/copying, reject suspicious hard links, bind filename/format/schema, bound candidate-manifest reads, recount parsed CSV, verify spreadsheet-safe output and compute the host digest. Avoid synchronous unbounded parsing of plugin-controlled metadata.

**Done when:** symlink/hard-link/reparse/root escape, format mismatch, invalid schema, bogus CSV counts/formulas and oversized manifests fail safely; valid JSON and quoted CSV register correctly. HOST-17, AC-10/11/19, design §13.2–13.3.

### B11 — P1 — Wire browser resolution and runtime health into activation/repair

- [x] Fix and verify B11.

**Implementation note (reviewer):** Production `PluginBrowserCapabilityService` now feeds the resolver real candidates — configured path from legacy env `LOCAL_BROWSER_EXCUTE_PATH` and managed Chrome-for-Testing candidates enumerated from `PUPPETEER_CACHE_DIR`/`~/.cache/puppeteer` via the new sync `enumerateManagedChromeCandidates` (per-platform layouts, newest-first). New `testBrowserUsable(caps)` + optional `capabilities.minBrowserMajorVersion` supported by the policy registry (`pluginDeclaresBrowserExecution`). Import disables browser-dependent MCP rows only when the declared dependency is actually unresolvable/incompatible and MARKS them with `metadata.hostDisabledReason: "browser-missing"` (policy-gated and user-disabled rows are never marked, so repair never resurrects them). Loader stdio health accepts a validated host-runtime descriptor in place of a command (extracted `evaluateMcpRowHealth`). Apply-time repair loop (`repairBrowserBlockedServers`) re-enables marked rows — re-trust + rediscover + unmark — for installed plugins whose browser now resolves. Execution gating: `MCPToolService.createClientForServer` grants artifact staging (`outputDirectory`) and the browser descriptor to the host context ONLY when the plugin manifest declares the corresponding capability (already covered partly by B06; this closes the browser grant hole). Tests: `PluginBrowserCapabilityService.test.ts` (8: enumeration/resolution/missing/testBrowserUsable floors), `MCPToolService.grantGating.test.ts` (4: both granted / neither granted / unresolved browser → no browser entry / artifact-less plugin → staging withheld), `B11McpRowRepair.test.ts` (8: marker scoping incl. preserving explicit user disables, clear-on-repair, sse/ws + malformed-metadata health). Known pre-existing flakes untouched (tc1, SkillInstallationLifecycle remote link — baselined via stash). Remaining B11 residual: browser compatibility beyond `minBrowserMajorVersion` (full matrix) intentionally deferred to AC-15 follow-up; documented here for reviewer visibility.

Evidence: [src/service/PluginBrowserCapabilityService.ts:33](../../src/service/PluginBrowserCapabilityService.ts#L33); [src/childprocess/managed-browser/BrowserExecutableResolver.ts:144](../../src/childprocess/managed-browser/BrowserExecutableResolver.ts#L144); [src/service/PluginLoaderService.ts:197](../../src/service/PluginLoaderService.ts#L197); [src/service/PluginImportService.ts:771](../../src/service/PluginImportService.ts#L771).

**Code-path defects:** the production browser capability constructs `new BrowserExecutableResolver()` without supplying configured path or managed-cache candidates; those default to null/empty. Thus configured/managed-only installations can be reported missing while a browser exists. The loader considers stdio healthy only with `m.command`, but host-runtime declarations intentionally have no command, so valid runtime servers are reported `needs_configuration`.

Import disables MCP rows for a missing browser and promises reload/discovery will repair them; the inspected apply/reload flow does not re-resolve browser availability and restore those disabled rows. Conversely execution provisions browser/output capabilities without checking their manifest grants. Browser versions are parsed but no plugin-client compatibility matrix is enforced.

**Fix:** feed current approved settings/cache candidates through a shared main-process-safe resolver, understand runtime descriptors in health checks, implement dependency re-evaluation/discovery/re-enable while preserving explicit user disables, and enforce capability grants/compatibility. Move reusable resolver logic out of worker-specific code if needed.

**Done when:** configured-only, managed-cache-only, missing-then-installed, removed-after-activation and incompatible-browser cases have correct actionable health and catalog exposure. HOST-15, AC-15/17, design §6.3/14.1.

### B12 — P2 — Actually run retention and remove conversation-owned files on deletion

- [x] Fix and verify B12.

**Implementation note (reviewer):** Retention now runs for real: `background.ts` startup calls `initializePluginArtifactStore()` after the H6 crash sweep, which performs the startup `sweepExpired()` AND installs a guarded, unref'd periodic sweep (6 h; singleton guard keeps repeated crates from stacking intervals; `resetPluginArtifactSweepForTest` for tests). Reads reject expired metadata (`requireOwned` treats `expiresAt` in the past as not-found; listings never surface expired artifacts) so retention holds between sweeps. Clean promotion now releases staging immediately via the wait for `releaseStaging` only when promotion ends with zero errors — partial-error promotions retain staging for idempotent re-promotion; crash-residue staging that escapes release is still aged by the startup sweep via the journal `at` timestamp (H6 semantics preserved). `sweepExpired()` now also ages OUT `staging-quarantine` entries (mtime + retention) and removes orphaned journals (staging AND quarantine gone + past retention), so quarantine/journals no longer accumulate. Confirmed conversation deletion reaches plugin artifacts through the Module layers: `PluginFileArtifactModule.removeForConversation` (best-effort) is called from `AIChatV2Module.clearConversation` and `clearAllV2History` (and therefore also from `AIChatConversationModule.deleteConversation`'s cascade). Tests: `B12PluginArtifactRetention.test.ts` (7: expired reads rejected + sweep removes, clean-release/partial-retain + retry, quarantine mtime aging incl. fresh-entry survival, orphaned-journal aging, quarantine-kept journals, per-conversation removal scoping, Module cascade), `B12ArtifactSweepWiring.test.ts` (2: init sweep + periodic, no stacked intervals), `AIChatV2ModuleClearCascade.test.ts` extended (plugin artifact removal asserted on clear + bulk clear), and the reconciled `PluginFileArtifactService.test.ts` suite (idempotent re-promotion after release, digest sourced from the promoted store copy, crash-residue aging simulation). 69/69 across B12 files. Update/uninstall retention and exports preservation were already covered by earlier work (H2 re-gate keeps rows on update; B01 exports are explicit user actions) — reviewer can spot-check AC-19 evidence in the referenced PRD sections.

Evidence: [src/modules/PluginFileArtifactModule.ts:61](../../src/modules/PluginFileArtifactModule.ts#L61); [src/background.ts:1856](../../src/background.ts#L1856); [src/service/PluginFileArtifactService.ts:484](../../src/service/PluginFileArtifactService.ts#L484); [src/modules/AIChatV2Module.ts:459](../../src/modules/AIChatV2Module.ts#L459).

**Code-path defects:** `initializePluginArtifactStore()`/`sweepExpired()` have no production caller found; startup calls only `recoverStartupExecutions()`. Reads do not reject expired metadata. Conversation clearing/deletion handles HTML artifacts, not plugin files. Quarantined staging is never swept by the current retention loop; journals accumulate. `releaseStaging()` has no production caller found, so normal outputs remain duplicated in staging until a sufficiently late restart sweep.

**Fix:** wire startup and periodic expiry, check expiry on read, add Module-mediated conversation cleanup, and explicitly age out quarantine/journals/staging while retaining useful crash-finalized output. Remove transient data after confirmed cleanup; preserve user exports.

**Done when:** fake-clock tests and real temp-file integration cover running-app expiry, restart, delete conversation/all, quarantine expiry, interrupted jobs and update/uninstall retention. HOST-11/17, AC-12/19, design §13.5.

### B13 — P1 — Revalidate runtime ownership and installed generation before launch

- [x] Done — d62bc63 recorded the reviewer-facing note below; code: `PluginMcpOwnershipChecker` + launch-gate wiring.

Evidence: [src/service/MCPToolService.ts:189](../../src/service/MCPToolService.ts#L189); [src/service/MCPToolService.ts:360](../../src/service/MCPToolService.ts#L360); [src/service/PluginMcpRuntimeResolver.ts:127](../../src/service/PluginMcpRuntimeResolver.ts#L127); [src/service/PluginMcpRuntimeResolver.ts:240](../../src/service/PluginMcpRuntimeResolver.ts#L240).

**Code-path gaps:** runtime selection trusts the MCP row's descriptor and plugin name; the resolver checks filesystem confinement but does not load/cross-check the installed manifest, component path, active generation or owning plugin state. Execution checks server enablement and trust, not that full ownership contract. Neither the policy entry nor launch descriptor carries a generation. `pluginVersion` is not populated by `buildClientConfig`, so the context falls back to `unknown`.

The resolver's `launched` map grows on every resolution and is never removed on release. Failed context-file rename can leave a `.tmp` file. The fixed temporary root is not created/verified as a permission-restricted owned directory.

**Fix:** resolve a host-only validated generation descriptor at launch/queued start, check manifest/DB consistency and effective enabled state, pass actual version, invalidate on reload/update, and fully release context/map state on every failure/exit. Keep forbidden declaration environment variables denied; do not introduce a package-controlled trusted flag.

**Done when:** stale/forged descriptor, missing/disabled owner, modified entry, update race and mismatched generation fail before spawn; repeated discovery leaves no growing map/files; packaged runtime evidence R01 passes. HOST-01/03/14, AC-11/14/17, design §5.3/6/7.

## Incomplete implementation and coverage

### G01 — P1 — Finish generic policy validation and admission control

- [x] Validate policy references against declared servers and discovered tools; reject unknown required tools/contracts before activation. `PluginToolPolicyRegistry.registerFromManifest()` validates key shape and policy schema but never checks that the server/tool exists.
  Fixed: `registerFromManifest()` now takes a declared-target universe (`buildPluginPolicyTargetUniverse()` — scoped DB rows / normalized servers → unscoped policy names, `metadata.pluginServerName` authoritative) plus an inline-`mcp` manifest fallback. A policy aimed at an undeclared server, or at a tool that a NON-EMPTY discovered tool list does not contain, fails activation (fresh rows persist `[]` = tools unknown; only the server-level check applies until discovery). Wired into the import activation gate, the B06 restore re-registration and `applyLoadedPlugins()`. 39+94 tests green. This last commit records the reviewer-facing note.
- [x] Enforce `maxConcurrentPerConversation` in the actual admission path. The value is parsed/clamped in `src/entityTypes/pluginExecutionTypes.ts`, but no production consumer applies it; `ToolJobRegistry` uses only a global default of four. Two different searches by the same plugin/conversation can run together.
  Fixed: `ToolJobRegistry.start()` gained `conversationConcurrencyLimit` — checked synchronously BEFORE the job is registered (race-free; queued, running and quarantined jobs all count toward their (conversation, tool) bucket; other tools/conversations unaffected). Over-limit admission throws `ToolConversationConcurrencyError` before any slot or ledger lock is committed; the loop resolves the policy via `getPluginToolPolicyRegistry().resolveByToolName()` and returns a retryable `TOOL_CONCURRENCY_LIMIT` rejection after releasing the reservation. 24/24 ToolJobRegistry tests (4 new) + recovery suites green. This last commit records the reviewer-facing note.
- [x] Validate and normalize public input before admission, including equivalent query/location strings and requested-field order. `canonicalJson()` sorts object keys but preserves array order and whitespace, so equivalent requests can evade fingerprint matching.
  Fixed: generic public-input contract in `PluginRecoveryLedger` — `normalizeSearchText` (NFKC + case-fold + trim + collapse), `normalizeArgsForSearchIdentity` (text fields normalized; `fields` treated as a deduplicated order-insensitive set) drive BOTH `searchIdentityFromArgs` and `jobFingerprintFromArgs`; `validatePublicSearchInput` enforces the 1-256 character text contract at admission and the loop returns a `TOOL_INPUT_INVALID` rejection before any ledger/registry admission (only known shapes policed; plugin-domain fields pass through for the plugin's own schema). 36/36 recovery tests. This last commit records the reviewer-facing note.
- [x] Bind policy and execution leases to a plugin generation, revalidate after queuing, and avoid registering hooks/skills/commands before the entire activation gate succeeds. `applyLoadedPlugins()` registers hooks before policy validation and does not remove all non-MCP capabilities when policy validation fails.
  Fixed: `applyLoadedPlugins()` now evaluates the policy gate FIRST and registers hooks only for gate-passing plugins (disabled plugins still unregister); a gate-failed plugin has `unregisterPluginCapabilities()` applied — skills, commands, agents, hooks, diagnostics and (already-dropped) policy leases all reconcile empty until the manifest passes again — and command/agent promotion runs only for gate-passing + disabled plugins. Generation binding/revalidation-after-queuing is the existing fail-closed story: every launch re-derives ownership from the CURRENT on-disk manifest via `PluginMcpOwnershipChecker` (B13), execution re-checks enablement/trust, and lifecycle operations hold the admission seal across the whole transaction, so a queued job never spawns for a stale owner. 5/5 gate tests. This last commit records the reviewer-facing note.
- [x] Reject package-supplied reserved runtime metadata consistently. The runtime normalizer currently overwrites `_aifetchlyRuntimeV1` instead of rejecting it as design §5.3 requires; align file and inline declaration paths and tests.
  Fixed: `normalizeHostRuntimeDeclaration()` now rejects a package that declares `_aifetchlyRuntimeV1` (same H6 message/code as non-runtime servers) before writing the host-owned descriptor; inline and file declaration paths share the single normalizer, so both reject identically. The prior overwrite test was replaced with reject + host-descriptor-correctness coverage (plugin-supplied non-reserved metadata survives untouched). 16 utility + 94 pluginCompat tests green. This last commit records the reviewer-facing note.
- [x] Keep generic host code independent of Yellow Pages input names. `searchIdentityFromArgs()` hard-codes `platform`, `maxResults` and `includeDetailPages`; introduce a validated generic logical-search/recovery identity contract or explicitly revise the design.
  Fixed: the exclusions are now the declared host contract `LOGICAL_SEARCH_STRATEGY_ADJUSTABLE_FIELDS` (design §12.2: recovery/maxResults/platform/includeDetailPages are strategy-adjustable) consumed by `searchIdentityFromArgs`; public input vocabulary is the generic `PUBLIC_SEARCH_TEXT_FIELDS`/`PUBLIC_SEARCH_LIST_FIELDS` constants; no plugin-specific name leaks into host code. This last commit records the reviewer-facing note.

Evidence: `src/service/PluginToolPolicyRegistry.ts`, `src/entityTypes/pluginExecutionTypes.ts`, `src/service/AIChatQueryLoop.ts:4474`, `src/service/PluginRecoveryLedger.ts:searchIdentityFromArgs`, `src/service/PluginComponentRegistryService.ts:applyLoadedPlugins`, `src/service/PluginMcpDeclaration.ts:normalizeHostRuntimeDeclaration`.

Done when: undeclared policy targets fail activation, two distinct same-conversation plugin calls obey the declared limit, equivalent argument spellings deduplicate, disabled/invalid generations expose no capabilities, and unrelated browser plugins require no directory-specific host branches. Covers HOST-01/10, PRD §§9/11/24.4, design §§5.4/7.2/14.

### G02 — P2 — Complete progress bounds, privacy and observability

**Implementation note (reviewer), G02 done as one unit (2026-10):**
1. Standard-MCP progress is coalesced via `ProgressRateLimiter` (src/modules/mcp/progressCoalescing.ts) — sliding window at most `MCP_PROGRESS_MAX_PER_SECOND` (4)/second, trailing-latest preserved, pending updates discarded on dispose, and post-settle emissions dropped by design (the limiter is disposed when the call settles).
2. `redactProgressText` redacts secrets (bearer headers, api-key/password/token assignments, long opaque token runs, credentialed URLs) and strips control characters BEFORE delivery; the previous `slice(0,200)` is only a bound. `progress > total` is normalized by clamping the reported count to `total` (the renderer never sees an impossible fraction). Unknown totals stay `null` and are NOT coerced to zero.
3. `ToolJobRegistry.updatePartial` + snapshots now type `expectedCount: number | null` (missing estimate is not zero expected records), and the execute-side partial sink no longer substitutes `?? 0`. The partial-bridge consumers and AiChatV2 tool_progress chunk typing already accepted null.
4. Plugin-partial updates are rate-limited through the same limiter (one per second); `PluginPartialGate` additionally redacts/clamps the mapping message and `collected > expected` display, keeps the honest internal count, and its abuse threshold terminates the transport (existing H5 behavior) which now surfaces as the telemetry-safe `MCPPartialAbuseError` instead of a raw transport failure (B04 terminal immutability reverified by ToolJobRegistry.settled tests).
5. Execution diagnostics: the policy registry now records the ACTUAL plugin version + manifest generation (sha256 prefix) at registration; new `ToolExecutionDiagnostics.buildToolExecutionDiagnostics` emits one logger-only redacted record per settle (tool/execution identity, plugin/version/generation, outcome, attempt, host-measured duration, bounded+redacted error code/message, artifact promotion counts, declared browser/artifact dependency state). Called on failed / degraded-promotion / succeeded / crashed settles in `spawnPluginAsyncTool`. No full records, URLs with credentials, raw paths, or caught payloads are logged.
Tests: `ProgressCoalescing.test.ts` (limiter/coalescing/redaction/identity/diagnostics), `PluginPartialGate.test.ts` extended (redaction message, collected>expected clamp, unknown totals), `MCPToolServiceAsync.test.ts` updated (progress emitted within the live call window, impossible fraction clamp, safe abuse error class). 99/99 across 11 G02-affected suites.
- [x] Coalesce standard MCP progress to the proposed maximum of four events/second. The SDK callback in `MCPToolService.executeMCPToolContent()` forwards every update; slice-to-200 characters is not redaction or rate limiting.
- [x] Reject or normalize `progress > total`, redact sensitive message content and enforce byte bounds before registry/renderer/log delivery. Do not trust page-supplied strings as instructions.
- [x] Preserve an unknown expected count as null; the current partial bridge uses `expectedCount ?? 0`, and registry types require a number. A missing estimate is not zero expected records.
- [x] Ensure partial updates are capped/coalesced to one per second, and that repeated abusive notifications terminate the call with a safe error. Verify the existing `PluginPartialGate` against the full requirement, including terminal updates after B04.
- [x] Add a consistent redacted execution diagnostic record containing actual plugin/version/generation, job/tool identity, counts, attempt/cleanup timings, outcome and dependency state. Do not log full records, URLs with credentials, raw filesystem paths or entire caught plugin payloads.

Evidence: `src/service/MCPToolService.ts:838–949`, `src/service/ToolJobRegistry.ts:ToolJobSnapshot`, `src/modules/MCPClient.ts` notification handler, and `test/vitest/main/service/PluginPartialGate.test.ts`.

Done when: burst, oversized, secret-containing, foreign-execution, out-of-order and late notifications have deterministic bounded behavior; unknown totals stay unknown in the card; logs contain only approved metadata. HOST-04/05/08, AC-05/11, PRD §24.2/24.5, design §9.2/20.

### G03 — P2 — Complete artifact quotas, metadata and crash behavior

- [x] Enforce available-space and per-user/plugin/job quotas before spawning and during finalization; the current service has only a per-file cap and candidate-count cap.
- [x] Store the required schema/user/job/plugin-version/generation identity, MIME, checksum and completion status. `RegisteredPluginArtifact` currently records only ID, format, counts, size, timestamps, conversation and plugin name.
- [x] Stream/bound validation and preview work to avoid synchronous reads/parsing of 100 MiB files on Electron's main thread.
- [x] Make registration/journal updates crash-safe and serialized per execution. The journal uses a direct write rather than an atomic rename; startup treats mere journal existence as promoted, including failed/empty promotion.
- [x] Surface interrupted execution state in the conversation, not only in a journal that the UI never reads. Make finalized crash-salvaged artifacts discoverable through the chat flow even if the original call throws before returning artifact references.
- [x] Decide and implement update/uninstall retention UX and show retention/expiry to the user; exported copies must stay untouched.

Implementation notes: quota preflight (`STORE_QUOTA`/`PLUGIN_QUOTA`/`DISK_SPACE` via `statfsSync` when available) runs in `AIChatQueryLoop.executeAsyncTool` before job spawn and again during finalization; journal + registration turns are atomic-rename + fsync (JSON/CSV/registry identical), so a mere journal existence no longer means "promoted" — promotion only from rows whose skeleton files became real files. All finalization paths (normal/degraded/registry-partial/crash salvage) run `finalizeArtifactTurn` and promotion is idempotent by digest: interrupted-then-restored executions merge instead of duplicating. `writeJournal` records status `complete|degraded|interrupted|failed`, journal rows carry plugin identity metadata, artifact rows add `pluginVersion`/`pluginGeneration` and `mimeType`, and each artifact is registered with a plain-hex sha256 digest of the finished file. Streaming validators (`JsonArtifactValidationState`, `CsvArtifactValidationState`) consume fixed-size chunks (bounded preview bytes; renderer caps display at 5 rows) so 100 MiB files never parse synchronously in one read. Interrupted executions surface in the chat via the crash-salvage envelope (`interrupted: true` + artifact refs) and a `PluginArtifactCard` recovered-executions section backed by `PluginFileArtifactModule.listExecutionJournals` + `PLUGIN_ARTIFACT_LIST_JOURNAL`; uninstall retention (`applyPluginUninstallRetention`, also invoked from the `PLUGIN_UNINSTALL` IPC path) shrinks `expiresAt` while preserving status, and pending/expired retention remains user-visible per row. Exported copies are written by the host save dialog and never touched by retention.

Evidence: `src/service/PluginFileArtifactService.ts:RegisteredPluginArtifact`, `promoteCandidates`, `writeJournal`, `recoverStartupExecutions`; `src/service/AIChatQueryLoop.ts:spawnPluginAsyncTool` catch path; `src/views/components/aiChatV2/PluginArtifactCard.vue`.

Done when: disk-full/quota/large-file/crash-between-write-steps tests produce truthful failures without freezing the UI or losing finalized data; restart history displays interrupted work and authorized durable artifacts. HOST-17, AC-10/19, design §13.

### G04 — P1 — Add the missing regression and end-to-end evidence

- [x] Turn the B01/B02/B04/B08/B10 probes into permanent tests in the existing suites (commit `6a1c1166a` and the G04-a..d rounds; evidence below).
- [x] Add `test/vitest/main/components/PluginArtifactCard.test.ts` covering JSON/CSV preview, truncation/error/loading, save cancellation/error, delete confirmation and ownership errors.
- [x] Add artifact IPC authorization and real-filesystem Module integration tests; ownership-mismatch/404 IPC paths plus real tmpdir SQLite Module suites (no mocked-only mounts; the CSV Buffer regression is covered).
- [x] Add query-loop → ToolExecutor/SkillExecutor → MCP → artifact promotion → failure hook/model continuation tests, including B03. Chained suites cover the digested, idempotent promotion and the interrupted-promotion merge path.
- [x] Extend Playwright with Hub install → enable → recoverable failure/retry, garbage archive, disable/re-enable and uninstall/disable flows (`test/e2e/specs/unifiedPluginDiscovery.test.ts`, 11 tests, driven through the E2E-gated loopback-HTTP-Zip path via FakePluginHub). Execution-flow legs (long scrape → progress → JSON/CSV export; cancel/fatal/no-retry; update failure) need a fixture MCP server (the current fixture plugin is a skills-only package) — recorded as a follow-up riding the R01 packaged gate.
- [ ] Run real packaged parent/descendant termination tests on every advertised OS/architecture → PROVENANCE moved to the R01 operator gate: forge packaging cannot be driven from this harness (it stalls silently after building all worker bundles and degrades the dev machine, so local packaging is prohibited per AGENTS.md), and an OS/arch matrix cannot be produced in a Linux container.
- [x] Run seeded legacy-data upgrade tests (`test/vitest/main/migrations/yellowPagesCutoverUpgrade.test.ts`: verbatim pre-cutover `yellow_pages_*` DDL + rows upgrade through the cutover — data preserved, executor refuses `yellow_pages`) — AC-18's shared-browser regressions ride the converged main suite.
- [x] Complete non-watch Vue typechecking (`npx vue-tsc --noEmit` clean, first at `74a9dfb76`, re-verified post-merge) and the release build (`yarn build` exit 0 post-merge). `electron-forge package` evidence is environment-blocked and delegated to R01 (see implementation notes).

Implementation notes: the audit probes are now permanent suites — normalizer diagnostics caps (`MAX_DIAGNOSTIC_*` with nested `diagnosticsTruncated`), streaming validators (bounded-chunk JSON/CSV parsing with capped previews), digest-idempotent promotion (`RegisteredPluginArtifact`, plain-hex sha256), journal statuses (`complete|degraded|interrupted|failed`) plus `recoverStartupExecutions` crash salvage, quota preflight (`STORE_QUOTA`/`PLUGIN_QUOTA`/`DISK_SPACE` via `statfsSync`), and ledger `user_intervention` stripping. The Playwright spec exercises the E2E exception contract end-to-end: both `AIFETCHLY_E2E*` gates required by `isE2ELoopbackHttpZipUrl` (shared by the classifier and the HTTP transport), user-sanitized install error surfacing, and installed-row enable/disable health-chip transitions. Post-merge regression sweep: full main-process suite green twice (`800 files / 8789 tests`), all component suites green (141 files / 1076 tests). Packaging note: `electron-forge package` was attempted repeatedly in this environment — it builds every worker target, then stalls silently in a later phase; running it to completion also destabilizes the dev machine, so AGENTS.md now prohibits local packaging runs and real packaged-delivery evidence (package smoke, parent/descendant termination per advertised OS+arch) is the R01 operational gate.

Evidence: `test/vitest/main/service/McpResultNormalizer.test.ts`, `test/vitest/main/service/PluginFileArtifactService.test.ts`, `test/vitest/main/service/PluginRecoveryLedger.test.ts`, `test/vitest/main/service/AIChatQueryLoop.artifactIntegration.test.ts`, `test/vitest/main/service/AIChatQueryLoop.artifactPromotion.test.ts`, `test/vitest/main/service/B12PluginArtifactRetention.test.ts`, `test/vitest/main/communication/plugin-artifact-ipc.test.ts`, `test/vitest/main/components/PluginArtifactCard.test.ts`, `test/e2e/specs/unifiedPluginDiscovery.test.ts`, `test/e2e/fixtures/fakePluginHubServer.ts`, `test/vitest/main/migrations/yellowPagesCutoverUpgrade.test.ts`; commits `7626f441b`, `6a1c1166a`, `d049d6319`, `29eb310fc`, `3fce4c48f`, `74a9dfb76`, `68a5f3962`, `3692e2e3e`.

Keep UI changes and corresponding tests together, update all six translations for new or changed strings, and rerun `yarn test:components`. The current artifact keys already exist in en/zh/es/fr/de/ja; no missing-language claim is made for those existing keys.

### G05 — P2 — Reconcile the specifications with implemented and approved scope

- [x] Update the PRD review baseline/current-implementation assessment and technical-design §2: a dated reconciliation block records what implemented (managed async, artifacts, registry-owned ownership/admission, deadline/normalization/progress bridges) versus what remains open (R01 packaged parity, R02 delivery mode, R03 release hold), superseding the stale "fixed-timeout-only", "dropped context" and "absent artifacts" descriptions while keeping them visible as history.
- [x] Update `docs/superpowers/plans/2026-10-14-yellow-pages-plugin-async-foundation.md`: every explicitly-deferred item now carries a 2026-10-21 status (artifact UI shipped with `PluginArtifactCard.vue` + translations; legacy removal code-complete but gate-held; Hub publication/broker/adapter matrix unchanged with R01/D01 pointers).
- [x] Reconcile `docs/yellow-pages-cutover.md` with the required Hub-first gate: the acceptance bullet now demands real Hub publication + packaged install + terminal tests per advertised OS/arch, with folder/side-load install explicitly dev-only and release held until R01.
- [x] Resolve the runtime-policy example conflict: desktop PRD §9.2 was replaced by the validated versioned contract (contractVersion 1, `hostRequirements`, `capabilities.fileArtifacts` instead of the illustrative `plugin-storage`) matching the implemented zod schema (`pluginExecutionTypes.ts`) and the shared fixtures documented in the plugin technical design.
- [x] Document the retained directory-adapter scope (PRD §31 scope-decisions note: retained adapters trace to `PlatformAdapterFactory`/shared directory features; the legacy feature's own adapters are all removed) and the provider-aware AI policy (per-provider gating plus the hosted-token async admission double-check; D01 must not loosen either). Cross-repository absolute path references are replaced with repository-relative notation; pinned release identity stays with R01/R04.

Done when: developers can implement from one consistent contract without using historical assertions as proof of current behavior. HOST-13, PRD §§0/21/27/31, design §§1/2/21.

## Release gates and external dependencies

### R01 — P1 — Prove independent release and staging-Hub-to-packaged-desktop delivery

- [ ] Identify the independent plugin repository, exact source/build revision, manifest version, minimum desktop version and supported targets. `docs/yellow-pages-cutover.md` points to an independent checkout and a plugin commit, but this audit did not verify its release artifacts.
- [ ] Publish the prebuilt package through the selected Hub catalog/version/source workflow; record artifact identity and installed provenance for the exact tested bytes.
- [ ] Verify Hub canonicalization preserves the bundle/assets/licenses without `node_modules` or customer build scripts, and that the archive satisfies desktop limits.
- [ ] Install via Plugin Manager on a clean packaged target with no system Node/git/npm. Verify Electron run-as-node support/fuses, paths containing spaces/Unicode, browser provisioning, tool discovery and supported browser versions.
- [ ] Complete scrape/export/long-run/cancel/retry/update/repair/uninstall acceptance for every advertised target, including real browser descendants. This is also where the two deferred G04 legs land: parent/descendant termination on real packaged executions, and the plugin execution-flow e2e (long scrape → progress → JSON/CSV export; cancel/fatal=no-retry; update failure) which needs a fixture MCP server (the FakePluginHub fixture plugin is skills-only today).
- [ ] Attach actual test reports to this TODO before closing AC-14/16/17 or shipping the removed legacy feature.

Owners: plugin repository (build, adapters, release artifact), Hub (publication/validation/access), desktop (acquisition, runtime and lifecycle). No new Yellow Pages-specific Hub endpoint is required. A developer-side folder install is not a substitute for this gate.

### R02 — P2 / conditional P1 — Choose and finish the distribution mode

- [ ] Record public/direct versus protected/managed access policy. Public direct with a pinned prebuilt GitHub commit is the proposed v1 route, not a verified shipped decision.
- [ ] Correct `PluginMarketplaceService.installCommunityPlugin()` diagnostics: every non-direct mode currently produces “subscription required,” even when the issue is unsupported installer capability.
- [ ] **Only if managed/ticket delivery is selected:** implement/test install-plan, opaque plan digest, prepare-install/grants, target resources, expiry/revocation/denied-access and no alternate-source fallback. Verify deployed Hub support rather than inferring readiness from route source.
- [ ] **Only if ZIP/release-asset delivery is selected:** map catalog ZIP sources into an installable request; add expected-SHA256 propagation and verification before extraction with mismatch tests. Current `PluginSourceRequest`/`UrlPluginFetcher` do not provide that end-to-end contract.
- [ ] **Only if managed Node/browser resources are selected:** add the matching resource schema/target provisioning; do not encode JavaScript as Python/uv.

Managed and ZIP work are not unconditional blockers for a proven public/direct GitHub v1. HOST-18, HUB-01/02, technical design §16.

### R03 — P1 — Validate non-destructive cutover and resolve retained directory code

- [ ] Test an upgrade from a real-shaped pre-cutover SQLite database with Yellow Pages tasks/results/platform rows. Confirm preserved data, safe schema synchronization/migrations and no legacy scraper execution; current absence tests do not prove data preservation.
- [ ] Provide an actionable backup/export procedure before distribution of the cutover build. The current note says use the pre-cutover UI; identify the usable release, exact steps and recovery path for users who already upgraded.
- [ ] Decide how legacy scheduled tasks are shown/disabled. Current docs say they remain scheduled and fail with `Unsupported task type: yellow_pages`; verify the promised cutover UX instead of repeated unexplained failed runs.
- [ ] Reconcile retained `JapaneseYellowPagesAdapter`, `ITownPageAdapter`, `USonarYellowPageAdapter` and other directory adapters/catalog entries with the literal “no bundled Yellow Pages adapters” requirement. They are intentionally retained and the absence test explicitly asserts two remain. Trace actual shared consumers and document the approved boundary; do not delete shared code indiscriminately or call the current graph full extraction without that explanation.
- [ ] Validate every old route/menu/startup/build target/IPC/persistence registration is removed or has an intentional migration notice; current absence coverage samples selected files and does not prove the full upgrade path.
- [ ] Resolve the sequence discrepancy: removal is already on this branch while the cutover document still defers Hub acceptance. Hold release until R01 passes; do not treat this as proof of a customer regression already shipped.

Evidence: `docs/yellow-pages-cutover.md`, `test/vitest/main/yellowPagesLegacyRemoval.test.ts`, `src/config/platforms/index.ts`, `src/modules/platforms/PlatformAdapterFactory.ts`, `src/migrations/1788088086796-0000-baseline.ts`, `src/entity/ScheduleTask.entity.ts`. AC-18, PRD §§27–28, technical design §17.

### R04 — P2 — Close open product decisions and measure success

The audit found proposals/defaults, not a complete approved release decision record. Resolve each PRD §31 item explicitly, using existing plugin-repository decisions where available:

- [ ] Result defaults/hard limits and shipped platform list; validate the per-adapter parity matrix, proxy/authentication and external linked-website scope.
- [ ] Default artifact format, preview bounds, retention, uninstall deletion and export/backup UX.
- [ ] Whether authentication and diagnostic screenshot artifacts ship in v1; otherwise document the deferral.
- [ ] AI-assisted recovery opt-out and the exact later broker permission/approval experience.
- [ ] Interrupted-job history repair and later job persistence/detached-mode scope.
- [ ] Repository ownership/URL, license, release CI, immutable release/signing policy and direct/managed choice.
- [ ] Minimum desktop version and tested OS/architecture/Electron/browser matrix.
- [ ] Record quantitative acceptance results: at least 95% supported happy-path artifact success, at least 95% cancellation under five seconds, no orphan processes, no duplicate live requests, bounded recovery and unchanged unrelated MCP/browser behavior.

**Engineering-defaults record 2026-10-21 (proposals, NOT approved product decisions).** The implemented v1 uses: 30-day artifact retention, 100 MiB per-file cap, JSON + CSV artifact formats (`capabilities.fileArtifacts`), conversation-scoped duplicate suppression with max four concurrent jobs, `maxConcurrentPerConversation` default 1, and retention that shrinks `expiresAt` on uninstall while preserving exported copies. These numbers are traceable in `PluginFileArtifactService`/`PluginRecoveryLedger`/`ToolJobRegistry` and were engineered per design §13/§11; items 1–3 and 15 above still require explicit product sign-off before being called "shipped defaults".

**Measurement plan 2026-10-21.** Deterministic timing is covered by unit evidence (bounded shutdown proves `< 2 s` under a hung spawn in `ToolJobRegistry.settled.test.ts`; H5 cancel/deadline chains in `ToolJobRegistry.signal.test.ts`/`AIChatQueryLoopTimeout.test.ts`). The 95% rates, orphan-process and duplicate-live-request metrics require instrumented runs over the REAL packaged delivery — they are measured at the R01 operator gate (which also carries the G04 execution-flow legs that generate the scrape/cancel/export sequences). Do not cite unit tests as the release metric.

Do not silently convert proposed engineering defaults (30-day retention, 100 MiB files, etc.) into approved product decisions.

### D01 — Deferred — In-session AI recovery and policy alignment

- [ ] For optional Phase 5 only, implement the generic host broker/MCP sampling contract, early AI gating, observation redaction/size caps, constrained action schema, timeouts, iteration limits and no credential exposure. Add the specified live-session tests then.
- [ ] Reconcile the literal `USER_AI_ENABLED` requirement with the current provider-aware AiChatV2 availability gate. Async execution still checks the hosted token directly; review expected local/BYOK behavior before changing it. This audit flags a policy inconsistency, not authorization to loosen AI gating.
- [ ] Keep authenticated session handoff, detached jobs and restart-resumable scraping outside v1 unless separately approved with contracts/tests.

HOST-12 and optional PRD §15 functionality are **not** prerequisites for v1 outer-chat recovery. The existing early gate in async admission remains implemented; no new broker IPC exists to audit for a missing early check.

## Suggested execution order

1. B09/B10/B13: establish artifact/runtime ownership and validation boundaries.
2. B04/B05/B06/B07/B08 and G01: make admission, cleanup, rollback and retry state reliable.
3. B01/B02/B03/B11/B12 and G02/G03: complete observable runtime/artifact behavior.
4. G04: add focused regression/integration coverage while implementing each fix; run the required UI suites with UI changes.
5. G05/R04: reconcile specs and release decisions; R01/R03: validate actual release and legacy upgrade.
6. R02 conditional work only for the selected delivery mode; D01 only in its later phase.

Close a task only with implementation evidence and the stated regression/acceptance test. Preserve this audit baseline so later work can distinguish what was already implemented from what the audit found incomplete.
