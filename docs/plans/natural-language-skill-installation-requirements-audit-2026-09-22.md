# Natural-language skill installation: requirements audit

Audit date: 2026-09-22. Implementation reviewed: `d1152e75` in the
`natural-language-skill-installation` worktree.

**Verdict: not all requirements are implemented.** The main architecture exists,
but reproducible lifecycle, readiness, credential, selection, and token-budget
defects prevent declaring the PRD and technical design complete.

The two documents supplied from the parent checkout are byte-identical to this
worktree's `docs/prd/natural-language-skill-installation-prd.md` and
`docs/prd/natural-language-skill-installation-technical-design.md` (both v1.1).
This is a requirements audit, not a production-code change or a complete security
assessment. Earlier completion records were treated as historical evidence,
not as proof of current behavior.

## Verification performed

- Targeted backend run: **11 files, 211 tests passed**, including the automatic
  `tsc --noEmit` gate. Covered installation module/lifecycle/routing/policy,
  invocation/tools, activation, migrations, worker, filesystem context, and
  process providers.
- Complete component suite: **35 files, 202 tests passed**.
- Seven temporary integration probes confirmed the observed defects in findings
  1–6 below. The probes asserted the current defective behavior; their passing
  results do **not** mean those requirements pass. Temporary test files were
  removed after execution.
- Direct, network-free probes confirmed safety-section omission, missed
  `python3`/credential detection, and a generic-shell routing bypass.
- Reviewed the Electron E2E specifications, including the newer
  `skillAcceptanceVideoUse.test.ts` and `skillInstallRuntimeFlows.test.ts`.
  They were **not executed** in this audit. The old final-audit TODO is stale
  about some E2E omissions; the newer files must be considered.
- Windows/macOS behavior, current remote CI status, branch protection, real
  repository downloads, production metrics, and provider credential checks were
  **not verified**. Windows and macOS CI jobs exist; Linux test success does not
  establish that those platform gates pass at this commit.

Local run logs: `/tmp/skill-requirements-audit-tests.log`,
`/tmp/skill-requirements-audit-components.log`,
`/tmp/skill-requirements-audit-probes.log`, and
`/tmp/skill-requirements-audit-identity.log`.

## Findings

### 1. High: installation identity is reduced to the source URI

**Requirements:** FR-02, FR-29, NFR-01; PRD §10.2; design §8.

`SkillInstallationModule.prepare()` looks up active and ready installations by
canonical URI alone (`src/modules/SkillInstallationModule.ts:263`, `:271`).
The transactional claim does the same (`src/model/SkillInstallation.model.ts:172`).
Requested ref, subdirectory, mode, and the calling conversation are not checked
before returning an existing session.

**Reproduced:** prepare the same local source from conversation A with ref `v1`
and managed-copy mode, then from B with ref `v2` and linked mode. B receives A's
session ID. This conflates different installation requests and can hand B a
session its subsequent conversation-bound operations cannot use. Ready reuse
also checks only structural activation readability, not the requested revision
or current dependency health.

### 2. High: discovery supports nested/multiple skills, activation does not

**Requirements:** FR-04–FR-08; PRD §11.3; design §9.3.

Inspection recognizes subdirectories, wrapper roots, and `skills/<name>`
children, but activation uses `plan.source.acquiredRoot` without the selected
candidate's `rootRelativePath` (`SkillInstallationModule.ts:1978`, `:2014`).
Plugin/executable routing likewise passes the acquisition root (`:588`, `:677`).
The selected subdirectory is stored as an empty string (`:2045`). Instruction
reading also stays at the inspection root instead of following a discovered
wrapper/child (`SkillPackageInspectionService.ts:91`).

**Reproduced:** a source with only `nested/SKILL.md` prepares successfully with
`subdirectory: "nested"`, then fails activation because the wrong root is copied.

Multi-selection has additional gaps: approval executes only `selected[0]`
(`SkillInstallationModule.ts:568`), never persists the submitted selection into
the plan, and secret resumption falls back to the plan's first candidate
(`:1013`). The card lists candidates but has no selection control and sends no
`selectedSkillIds` (`SkillInstallCard.vue:49`, `:525`). “Choose skills/install
all” is therefore not a complete user flow.

### 3. High: updates and same-name replacements do not preserve source identity

**Requirements:** FR-19, NFR-01; PRD §13.5 and §24.1.

`update()` starts a fresh prepare without carrying the existing installation ID
(`SkillInstallationModule.ts:1389`); prepare allocates a new ID. Activation only
adopts a prior record when its identity, including source revision, matches
(`:2072`). A changed revision therefore leaves the old ready row alongside a
new one, with credentials still bound to the old ID.

Separately, activation paths are derived only from the display name, and any
AiFetchly-owned destination is replaceable regardless of source identity
(`src/service/SkillActivationService.ts:86`).

**Reproduced:** approving an update after changing `SKILL.md` yields a different
installation ID and two enabled ready records. Installing a second unrelated
source named `video-use` replaces the first source's files without a replacement
warning in the plan. Old rows then address the same activation path, making
subsequent lifecycle operations ambiguous.

### 4. High: required setup can be skipped while reporting ready

**Requirements:** FR-06, FR-14, FR-16, FR-17; PRD §18.4; design §8.3 and §18.

Commands are extracted and shown, but `approve()` goes directly to activation.
Readiness checks structure, registry registration, and binary-probe statuses;
there is no required-command completion checkpoint
(`SkillInstallationModule.ts:568`, `:2100`). Command buttons appear only in
hold/failure states, disappearing at ready (`SkillInstallCard.vue:495`).

**Reproduced:** `install.md` containing a required `uv sync` produces a one-command
plan and goes straight to ready without executing that command.

Command preparation also splits on whitespace, drops some arguments, sets a
placeholder working directory, and always produces `environmentNames: []`
(`src/service/SkillInstallPlanner.ts:217`). Thus real plans never request the
runner's credential injection even though independently constructed runner tests
cover it. Execution accepts a supplied cwd and does not re-hash the source before
spawn (`src/service/SkillApprovedCommandRunner.ts:89`, `:191`), so the exact
source/cwd/capability approval binding is incomplete.

### 5. High: secret submission does not gate on all required credentials

**Requirements:** FR-07, FR-15–FR-17; PRD §19.

Secure IPC stores the submitted variable and immediately resumes the session
without checking that the name is in the plan or that all required credentials
exist (`src/main-process/communication/skill-installation-ipc.ts:300`).
`resumeAfterSecret()` does not inspect credential status and always enters the
prompt activation path, including for plugin/executable plans
(`SkillInstallationModule.ts:987`).

**Reproduced:** a plan requiring `FIRST_API_KEY` and `SECOND_API_KEY` reaches
`awaiting_secret`, then calling resume without storing either reaches ready.
Through normal IPC, submitting just one value is enough to leave the secret
state. Secret collection also precedes missing-dependency preparation, contrary
to the ElevenLabs sequence.

Detection is incomplete: a direct probe of `GITHUB_TOKEN=`, `CLIENT_SECRET=`,
and `ELEVENLABS_API_KEY=` discovers only the last one because of the credential
regex (`SkillInstallPlanner.ts:41`).

### 6. High: cancelling a dependency hold leaves the skill active

**Requirements:** FR-19; PRD §10.1; design §8.4.

Activation registers the skill and saves its row as enabled/ready before missing
dependencies move the session to `installing_dependencies`
(`SkillInstallationModule.ts:2049`, `:2144`). `cancel()` rolls back only
`activating` and `verifying` states (`:1149`).

**Reproduced:** force ffmpeg missing, approve, cancel from
`installing_dependencies`: the session becomes cancelled, but the installation
row remains enabled/ready and the catalog still resolves the skill. The separate
dependency-decline handler does roll back; cancel does not share that behavior.
Additionally, verification rollback failure currently goes through `fail()` and
returns `failed` rather than the dedicated `rollback_required` state (`:2129`).

### 7. High: token budgeting can omit mandatory safety instructions

**Requirements:** FR-24; PRD §14.3; design §10.7.

The refusal condition is `!essentialIncluded && selected.length === 0`
(`src/service/PromptSkillTokenBudgetService.ts:149`). If a small preamble fits
but a mandatory Safety section does not, the service still returns a successful
section-selected body.

**Reproduced:** with a 100-token budget, a short preamble, a long Safety section,
and a short Examples section, the output selects the preamble and Examples and
omits Safety. It should refuse when the essential contract cannot fit.

Production `use_skill` does not supply model/remaining-context budgets
(`src/config/skillsRegistry.ts:2412`); invocation defaults to fixed 16,000/8,000
token limits (`PromptSkillInvocationService.ts:40`) without subtracting already
active skills. Heading and wrapper overhead are also not fully budgeted.

### 8. High: pasted chat credentials still reach conversation persistence

**Requirements:** FR-31, NFR-03; PRD §19.1–§19.2.

Ordinary installer tool schemas reject known secret shapes, but that is after
the separate chat input path. `AIChatQueryEngine` starts with the raw request
message and saves it (`src/service/AIChatQueryEngine.ts:669`, `:764`).
`AIChatV2Module.saveUserMessage()` forwards the content unchanged (`:59`), and
`AIChatModule.saveMessage()` assigns it directly to the persisted entity (`:40`).
There is no installer credential rejection/redaction at this persistence boundary.

Consequently, the secure credential field and tool-argument tests do not satisfy
the requirement to reject a pasted key in ordinary chat before persistence.

### 9. High: runtime fallback policy is bypassable by normal shell syntax

**Requirements:** FR-30, NFR-11; PRD §9.7; design §8.6.

Shell enforcement matches a limited command regex
(`src/service/SkillInstallationToolPolicy.ts:46`, `:100`).
**Reproduced:** after explicit intent for the video-use URL,
`git -c advice.detachedHead=false clone https://github.com/browser-use/video-use`
returns `{ allowed: true }`, although it acquires exactly the installation target.
This bypasses the installer-specific boundary; ordinary shell permissions remain
a separate control.

The manual fallback is also a boolean event, not a bounded provider operation:
`approveManualAction()` does not require a typed manual-action result or record
the exact approved operation (`SkillInstallationModule.ts:1732`), and the policy
allows every call when that boolean is true (`SkillInstallationToolPolicy.ts:65`).

### 10. Medium: GitHub archive provenance is discarded

**Requirements:** FR-03; PRD §11.1–§11.2 and §20.4.

The GitHub fetcher supplies trusted `resolvedCommitSha` and `github-archive`
provenance (`src/service/pluginSources/GitHubPluginFetcher.ts:274`). The skill
acquirer ignores it, tries Git `rev-parse` against the archive checkout, then
uses a tree hash as `resolvedRevision` while recording acquisition method `git`
(`src/service/SkillSourceAcquisitionService.ts:187`, `:228`, `:326`).
Unless the caller supplied an explicit SHA, public GitHub installs lose the
actual resolved commit that the fetcher already knows.

### 11. Medium: request constraints and retry checkpoints are not durable

**Requirements:** FR-04, FR-15, FR-18–FR-20; PRD §9.2 and §10.1.

Prepare extracts an English `read <file>` pattern from constraints, then passes
constraints into a planner that never uses or stores them
(`SkillInstallationModule.ts:388`, `SkillInstallPlanner.ts:37`). Explicit
dependency requests, credential timing, and “wait/do not transcribe” are not part
of the persisted installation contract. Conversation history may retain the
request, but the session cannot independently restore it.

Retry creates a fresh prepare using only conversation ID and canonical source
(`SkillInstallationModule.ts:1291`). It loses ref, mode, subdirectory, and user
constraints, rather than resuming the last verified checkpoint. Update likewise
has no persisted requested branch/ref to follow.

### 12. Medium: dependency and management/review data are incomplete

**Requirements:** FR-06, FR-14, NFR-08; PRD §18, §22.2–§22.4; design §14.1.

Dependency planning recognizes a small binary-word list and produces only
system-binary items. **Reproduced:** instructions containing only
`python3 --version` produce no dependency: detection adds `python3` but the
fallback table is keyed by `python` (`SkillDependencyOrchestrator.ts:177`).
Language environments, MCP dependencies, model artifacts, resolved paths,
version ranges, and persistent dependency bindings are not implemented as the
design describes. Probe output becomes satisfied/missing status without saving
the detected version/path (`:262`); no `SkillDependencyBinding` implementation
was found.

The renderer-safe plan omits requested permissions, activation location,
command cwd/expected writes, and update behavior (`SkillInstallationModule.ts:2345`).
Management listing omits linked canonical target, dependencies/versions,
granted permissions, and last verification (`:1583`); the manager has no
reveal-source action. Six translation files and parity tests exist, but mode,
dependency status, risk, classification, and manager status are still displayed
as raw enum strings (`SkillInstallCard.vue:42`, `:71`, `:129`;
`SkillInstallManager.vue:48`). Translation-key parity is not full localization.

## Requirement traceability

**Present** means the implementation and inspected tests cover the central
contract, with no specific gap established here. It is not a claim that every
platform or adversarial case passed. **Partial** means a concrete gap above or
an explicitly identified design/acceptance limitation. **Platform unverified**
means code exists but this audit cannot establish the required platform result.

| ID | Assessment | Evidence / limitation |
| --- | --- | --- |
| FR-01 | Partial | Intent guard and routing tests exist; first-tool E2Es script the desired model tool. Supported local/SSH source recognition and non-English deterministic routing are not comprehensive. |
| FR-02 | Partial | Persisted session/transaction exists; identity conflation, finding 1. |
| FR-03 | Partial | Staging, hashes, fetchers exist; GitHub commit provenance lost, finding 10. |
| FR-04 | Partial | Ordered bounded instruction reads; nested roots and durable constraints incomplete, findings 2/11. |
| FR-05 | Present | Inspection classifies prompt/executable/plugin/multiple/invalid layouts; installing the selected layout is separately incomplete. |
| FR-06 | Partial | Review card and typed plan exist; missing review details and setup checkpoint, findings 4/12. |
| FR-07 | Partial | Existing import services used initially; secret resume and nested roots bypass correct routing, findings 2/5. |
| FR-08 | Present | Root SKILL.md managed installs are first-class prompt skills without generated executable manifests. |
| FR-09 | Present | Canonical base directory and both directory-variable substitutions in context assembler. |
| FR-10 | Platform unverified | Managed-copy implementation and Linux tests pass; macOS/Windows current-commit results not checked. |
| FR-11 | Platform unverified | POSIX link implementation/tests and Windows junction code/CI exist; current Windows run not checked. |
| FR-12 | Present | Shared conversation scope and no-home-fallback implementation; filesystem-context tests pass. |
| FR-13 | Present | Separate bounded resource read/list/execute tools and permissions; prompt-tool tests pass. |
| FR-14 | Partial | Typed system dependency installer and ffmpeg/ffprobe probes; planning/binding gaps, findings 4/12. |
| FR-15 | Partial | Durable approval/secret states; credential completeness and checkpoint resume gaps, findings 5/11. |
| FR-16 | Partial | Encrypted storage and isolated command runner exist; actual planner never declares injected env names, findings 4/5. |
| FR-17 | Partial | Structure/catalog/binary checks exist; premature ready and stale reuse, findings 1/4/5/6. |
| FR-18 | Partial | Installation path avoids daily-use invocation; terminal user constraints are not persisted, finding 11. |
| FR-19 | Partial | All lifecycle operations exist; update identity, cancellation, rollback gaps, findings 3/6/11. |
| FR-20 | Partial | Structured events/codes and retry cap exist; retry loses parameters and rollback failure state differs, findings 6/11. |
| FR-21 | Present | Universal use_skill and bounded metadata-only catalog. Presenter omits runtime IDs from displayed lines, so ambiguous-name resolution still needs a follow-up. |
| FR-22 | Present | Short acknowledgement plus hidden attachment integrated with query loop; invocation/tool tests pass. |
| FR-23 | Partial | Durable snapshots and compaction integration exist. Design says preserve snapshot for changed/missing linked sources; reconciliation deactivates them. See document discrepancy below. |
| FR-24 | Partial | Section/resource mechanisms exist; mandatory section and aggregate/model-budget gaps, finding 7. |
| FR-25 | Present | Legacy adapter routes through prompt invocation; dedicated newer E2E exists but was not run here. |
| FR-26 | Present | Application-owned policy in shared context assembly and compact capability guidance; routing tests pass. |
| FR-27 | Partial | Distinct invocation/install/executable entry points exist; credential resumption routes executable/plugin packages through prompt activation, finding 5. |
| FR-28 | Present | Main-tier prepare plus bounded internal hydration/replay implementation; routing tests pass. |
| FR-29 | Partial | Follow-up conversation/revision checks exist; prepare reuses foreign session and manual fallback lacks exact action binding, findings 1/9. |
| FR-30 | Partial | Runtime policy exists; normal syntax bypass and unbounded manual flag, finding 9. |
| FR-31 | Partial | Installer schemas reject secret shapes and secure IPC exists; ordinary chat persistence remains unguarded, finding 8. |
| NFR-01 | Partial | Session claim/upsert mechanisms exist; URI conflation and update duplicates, findings 1/3. |
| NFR-02 | Platform unverified | Process providers and blocking Windows workflow exist; Linux suite cannot prove real Windows capture. |
| NFR-03 | Partial | Secure field/runner redaction exist; pasted chat keys can persist, finding 8. |
| NFR-04 | Partial | Staging file/size/depth, instruction-byte and acquisition concurrency bounds exist. The 100-skill cap is in catalog replacement, not inspection/planning. No full exhaustion verification performed. |
| NFR-05 | Present | Ownership/containment checks and link-target preservation implemented/tested; cancellation correctness is separately incomplete. |
| NFR-06 | Partial | Existing imports retained and legacy adapters exist; secret/nested routing gaps, findings 2/5. Full plugin regression suite not run. |
| NFR-07 | Present | AI-serving prepare/approve/update/invoke IPC gate before decoding; pure status/cancel are deliberately ungated. |
| NFR-08 | Partial | Six locales and passing component suite; raw user-facing enums and missing UI fields, finding 12. |
| NFR-09 | Present | Initial model catalog contains bounded metadata, not unused instruction bodies. |
| NFR-10 | Present | Prompt loading/assembly is inert; helper execution is a separate tool. |
| NFR-11 | Partial | Policy is app-owned and repository metadata cannot self-grant permissions; generic fallback enforcement is incomplete, finding 9. |
| NFR-12 | Partial | Provider-neutral versioned prompt and policy exist. Full specified routing/performance counters, alerts, and release metrics were not established by this audit; enforcement gap remains. |

## Technical-design and acceptance qualifications

- **Architecture/migrations:** baseline, feature, and session-idempotency
  migrations are registered in `src/config/dbMigrations.ts`. Module/Model
  persistence, dedicated worker placement, Forge entry, and typed IPC are
  implemented. The older claim that migrations are absent is obsolete.
- **Recovery discrepancy between documents:** PRD §14.6 calls for diagnostics
  rather than silently restoring missing/hash-invalid skills; design §10.10 and
  §21.3 call for retaining a verified stored snapshot when a linked source
  changes or vanishes. `PromptSkillInvocationModule.reconcileForRecovery()`
  deactivates missing/hash-changed entries (`:132`). Reconcile the documents and
  acceptance tests before marking both contracts satisfied.
- **E2E quality:** newer runtime and acceptance tests cover substantially more
  than the old TODO records. However, the natural-language tests supply
  `skill_install_prepare` and a ready response through the fake model before
  approval (`skillInstallationNaturalLanguage.test.ts:160`, `:182`, `:221`).
  That proves transport/tool availability, not semantic model selection or that
  the assistant reports readiness only after readiness. Some assertions accept
  awaiting-secret/dependency holds as well as ready (`:235`). Stronger newer
  deterministic fixture tests should be retained, and the misleading tests
  should assert the actual terminal contract.
- **Rollout:** the installer has an environment-variable opt-in flag
  (`SkillInstallationModule.ts:51`). The proposed platform/cohort stages and
  PRD §28 reliability/latency/privacy metrics are not proven by passing unit tests.

## Completion recommendation

Keep this feature **incomplete against the supplied PRD/design**. Fix findings
1–9 before relying on readiness or lifecycle guarantees; complete provenance,
durable constraints, dependency metadata, and review/management UI. Add regression
tests for the reproduced cases, reconcile recovery semantics, then rerun the
Electron acceptance suite and required Windows/macOS jobs at the resulting
commit. No implementation fixes were made as part of this audit.

---

## Remediation record (2026-09-25)

All 12 findings implemented and regression-tested on
`worktree-natural-language-skill-installation` (d1152e75 → 5e98aeb9).

| # | Fix (commits) |
|---|---|
| 1 | Full request identity (ref/subdirectory/mode) persisted AT CREATION (migration 0003 + entity columns); `requestIdentityMatches` gates idempotent reuse AND the transactional claim; ready-reuse compares revision/mode only when pinned (84d46218) |
| 2 | Plan source carries the INSPECTION root; activation/plugin/executable routing join the selected candidate's `rootRelativePath`; submitted `selectedSkillIds` persist into the plan (0b460735) |
| 3 | update() carries the existing installationId; the activation upsert UPDATES the row in place when the new revision matches no identity; same-name rows are superseded (exactly one ready row); `replacing-existing-skill` plan warning (12817157) |
| 4 | New `awaiting_commands` checkpoint: plans with commands hold before ready; runApprovedCommand marks completion and continues the sequence; full-arg templates + declared env names + medium risk; runner re-hashes the source before spawn (`SOURCE_CHANGED_AFTER_APPROVAL`) (299c993a) |
| 5 | submit-secret validates plan membership; resume gates on ALL required credentials configured (module + IPC); planner regex finds every UPPER_SNAKE credential; resumeAfterSecret routes plugin/executable correctly; §18.4 ordering — deps before credentials before activation (2bf15006) |
| 6 | The dependency hold now PRECEDES activation (nothing to roll back by construction); cancel rolls back installing_dependencies sessions; failed verification rollback surfaces `rollback_required`/`ROLLBACK_FAILED` (2bf15006) |
| 7 | Budget refuses whenever ANY essential section cannot fit (not just empty selections); SkillExecutionContext.remainingContextTokens threaded through use_skill (e45db759) |
| 8 | ChatCredentialGuard at AIChatQueryEngine.submitMessage — pasted keys rejected BEFORE persistence/provider with typed `CHAT_CREDENTIAL_REJECTED`; engine-level test proves nothing persists (e45db759) |
| 9 | Flag-tolerant shell regex (`git -c … clone`, `git --depth 1 clone`, uv); acquisition/setup blocked under explicit routing regardless of target string; manual-action approval records its EXACT target and the policy honors only that target (e45db759) |
| 10 | Acquirer prefers the fetcher's trusted `resolvedCommitSha` + acquisition method (`github-archive`/`github-release-asset` in the union); rev-parse/tree-hash only for sources without provenance (42c7dea2) |
| 11 | Constraints persist in the plan; planner surfaces `constraint-dependency-unplanned` + `user-terminal-instruction` warnings; retry resumes the full ref/subdir/mode checkpoint (24c0d247) |
| 12 | python3→python mapping fixed; probe EVIDENCE recorded on plan items; SafePlanView gains permissions/activationTarget/dep-evidence; manager gains linked target + subdirectory + hash; card/manager render localized depStatus/modeLabel/status in all six locales (be881659) |

Gates at 5e98aeb9: full main suite 500 files / 4,524 tests green;
components 35 files / 202 tests green; targeted planner/policy/lifecycle/
runner suites green. Remaining qualification items from the audit (recovery
PRD-vs-design document reconciliation, E2E assertion tightening for the
natural-language spec, platform matrix re-run) are the follow-up work.

Incident note: during pre-existence verification a second `git stash pop`
popped a FOREIGN stash (worktree-ai-chat-message-queue) into this tree.
Detected immediately via conflict markers; tracked files hard-reset to
HEAD, foreign untracked files removed, the foreign stash entry remains
retained in the stash list (nothing lost). Lesson recorded: never blind-pop
in a multi-worktree repo — always `git stash list` before pop.
