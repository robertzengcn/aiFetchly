# Natural-Language Skill Installation — Implementation Plan

Source PRD: `docs/prd/natural-language-skill-installation-prd.md` (v1.1)
Source tech design: `docs/prd/natural-language-skill-installation-technical-design.md` (v1.1)
Branch: `worktree-natural-language-skill-installation` (synced with dev @ d5a22f82, merge 65807e4b)

## Scope for this implementation pass

The PRD is a multi-release program (Phases 0–7 with Windows CI matrix, gradual
rollout, full UI). This pass delivers the complete backend spine + model-facing
tool surface + IPC + a compact conversation UI card, organized as the design's
Phases 1–6 core. Explicitly deferred (documented in the final status report):

- Windows runner CI matrix (tests are written to run on POSIX + Windows but the
  GitHub Actions Windows gate is left to CI config work)
- Worker/utility-process offload for acquisition (main-process execution this
  pass; the design allows "main process or controlled utility process")
- npm/URL plugin sources for standalone skill install (routed to existing
  PluginInstallService where applicable)
- E2E Playwright specs (unit + integration coverage this pass)

## Phase map (commit-sized units)

### Phase A — Unified conversation filesystem scope (PRD §15, design §6)
1. `src/entityTypes/filesystemContextTypes.ts` — capability/root/context types.
2. `src/service/ConversationFilesystemContextService.ts` — resolve once via
   `WorkspaceResolver`; missing workspace → `WORKSPACE_NOT_APPROVED` (fail
   closed for conversation tools); legacy context for non-chat callers.
3. Wire `ShellToolService` to accept a resolved context (default cwd =
   canonical workspace root; explicit cwd must pass the same guard). Keep
   existing signature working (backward compat for skillsRegistry caller) by
   adding an optional context param.
4. Wire `ToolExecutor.executeFileTool` + `executeShellCommand` call site to the
   shared context so shell and file tools observe the same root.
Tests: `test/vitest/main/ConversationFilesystemContextService.test.ts` +
shell/file shared-scope integration test.

### Phase B — Cross-platform process providers (design §7)
1. `src/service/process/PlatformProcessProvider.ts` — contract types.
2. `src/service/process/ShellInterpreterResolver.ts` — pwsh → powershell →
   cmd resolution; typed arg arrays; `shell:false`.
3. `src/service/process/PosixProcessProvider.ts` / `WindowsProcessProvider.ts` —
   env preservation + secret scrub (NOT Unix allowlist on Windows),
   `detached:false` on Windows, BOM/UTF-16LE detection, byte counts,
   `PROCESS_OUTPUT_EMPTY_UNEXPECTED` sentinel, tree-kill.
4. Registry: `getPlatformProcessProvider()`.
Tests: provider unit tests (echo/unicode/timeout/tree-kill on POSIX here;
Windows provider logic tested via env/decode pure functions).

### Phase C — Prompt-skill runtime (design §10, §11)
1. `src/entityTypes/promptSkillTypes.ts` — manifest/catalog/invocation types.
2. `src/service/PromptSkillLoader.ts` — bounded SKILL.md parse (256 KiB cap),
   YAML frontmatter via restricted parser, sha256 hash, unknown-field
   preservation, name/description validation, `${AIFETCHLY_SKILL_DIR}` +
   `${CLAUDE_SKILL_DIR}` variables.
3. `src/service/PromptSkillCatalog.ts` — runtime-id scoped registry
   (`prompt:user:<id>`), replaceSource/resolve/list, real-path dedupe,
   symlink/junction acceptance, collision diagnostics, precedence
   workspace > user > plugin > built-in.
4. `src/service/PromptSkillTokenBudgetService.ts` — token-aware full /
   section-aware-selected / metadata-only decisions (headings + fenced-block
   aware; no mid-block slicing).
5. `src/service/PromptSkillContextAssembler.ts` — hidden instruction block
   with boundary markers, frontmatter stripped, variables substituted,
   base-dir + workspace header.
6. `src/entity/PromptSkillInvocation.entity.ts` + Model + Module — durable
   invoked-skill state (unique conversation+agent+runtimeId+contentHash),
   same-hash idempotent `already-loaded`, new-hash new revision, compaction
   reattachment source.
7. `src/service/PromptSkillInvocationService.ts` — resolve (name or runtimeId),
   verify hash, normalize, persist, produce attachment; rejects disabled /
   hash-mismatch / install-mutation arguments.
8. Global loader expansion in `AIFetchlyConfigLoader.tryReadSkillFiles`:
   accept links/junctions + `SKILL.md`-only directories → register prompt
   skills in the catalog (manifest.json keeps executable precedence).
9. Tools in `skillsRegistry`: `use_skill` (always-loaded), `skill_resource_list`,
   `skill_resource_read` (read-only, runtime-root confined).
10. Chat integration: `AIChatQueryLoop` appends short ack then hidden context
    message after `use_skill`; `AIChatContextAssembler` reattaches active
    invocations after compact summary.
Tests: loader/catalog/budget/assembler/invocation unit tests + DB-backed
module tests + catalog-metadata-excludes-bodies assertion.

### Phase D — Installer core (design §8, §9, §11, §12)
1. `src/entityTypes/skillInstallationTypes.ts` — source/session/plan/next-action
   types + Zod schemas (secret-shaped field rejection).
2. `src/service/SkillInstallIntentGuard.ts` — deterministic explicit-intent
   classifier (skill/package signal + supported source / install identity);
   distinguishes install vs invoke vs execute; provider-neutral.
3. `src/service/SkillInstallationRoutingPromptSection.ts` — versioned full
   policy + compact reminder (snapshot-test every normative rule).
4. `src/service/SkillSourceAcquisitionService.ts` — reuse plugin source
   fetchers (git/github/local-folder/local-zip) into
   `<userData>/skill-installation/sessions/<id>/source`, limits, commit pin,
   redaction.
5. `src/service/SkillPackageInspectionService.ts` — layout classification
   (plugin → executable → prompt SKILL.md → skills/<n>/SKILL.md → wrapper dir),
   instruction precedence (user-named → INSTALL.md → README → SKILL.md),
   bounded reads.
6. `src/service/SkillInstallPlanner.ts` — immutable plan v1 (revision hash over
   instruction hashes); dependencies from catalog mapping + ffmpeg/ffprobe
   multi-probe; credential requirements; commands as typed templates.
7. `src/service/SkillActivationService.ts` — managed copy (temp sibling + atomic
   rename) under `~/.aifetchly/skills`; symlink/junction linked mode with
   ownership metadata; uninstall removes only owned paths (never link targets);
   rollback.
8. `src/service/SkillInstallationVerifier.ts` — acquisition/inspection/
   activation/dependency/credential/registry probes → ready only if all pass.
9. `src/service/SkillCredentialService.ts` — fail-closed safeStorage wrapper;
   opaque binding ids only in DB.
10. Entities + Models + `src/modules/SkillInstallationModule.ts` —
    state machine (requested→…→ready, failed/cancelled/rollback), CAS updates,
    event log, idempotency by normalized identity, lease.
11. Tools: `skill_install_prepare/approve/status/cancel` in skillsRegistry
    (prepare always-loaded behind feature flag
    `AIFETCHLY_SKILL_INSTALL_ENABLED`, default on in dev builds off in prod? —
    PRD Phase 6 says flag; default OFF with env kill-switch pattern used by
    small-model routing: absent → disabled).
12. Enforcement: `SkillInstallationToolPolicy` in `AIChatQueryLoop` before tool
    execution (block shell/file/catalog substitutes for the target after
    explicit install intent; allow unrelated work);
    `ToolLoadPolicyService` always-load for prepare + use_skill;
    `DeferredToolHydrationCoordinator` one-shot replay;
    `BuiltInToolCapabilitiesPromptSection` compact reminder;
    `AIChatContextAssembler` injects routing policy once.
Tests: intent-guard phrase matrix, plan revision/CAS tests, acquisition with
local git fixture, classification fixtures, activation/rollback path-safety
tests, tool-policy allow/deny matrix, hydration replay cap, prompt snapshot.

### Phase E — Dependency orchestration (design §12)
1. `src/service/SkillDependencyOrchestrator.ts` — map instruction proposals →
   SystemDependencyCatalog entries; detect via probes (ffmpeg/ffprobe);
   multi-probe verification; typed install actions through existing
   SystemDependencyModule; never raw repo commands.
Tests: mapping + multi-probe unit tests.

### Phase F — IPC + UI + i18n (design §15.1, §20-21)
1. `src/schemas/ipc/skillInstallation.ts` — Zod request/response schemas.
2. `src/main-process/communication/skill-installation-ipc.ts` — thin handlers
   (AI gate on AI-serving ops), progress events, secure secret channel
   (`SKILL_INSTALL_SUBMIT_SECRET` separate), register in index.ts.
3. `src/preload.ts` channel whitelist + `src/views/api/` typed bridge.
4. UI: `SkillInstallCard.vue` (progress card: state/commit/deps/secrets/
   retry) + secure input; wire into AiChatV2 tool_result rendering.
5. i18n: all six languages (en/zh/es/fr/de/ja).
6. Component tests for the card.
Tests: IPC schema validation tests + component tests.

### Phase G — Acceptance fixture + regression sweep
1. Local git fixture repo (`test/fixtures/video-use-skill/` with SKILL.md,
   install.md, helpers/) + integration test asserting the §18.1 sequence:
   intent guard → prepare first tool → acquire → inspect install.md → plan →
   approve → activate → verify → ready → report + stop (no execution).
2. Repeated prepare → same session (no duplicate).
3. Full `yarn testmain` + `yarn test:components` + tsc/vue-tsc gates green.

## Key invariants carried into tests

- Secrets never in tool args/chat/logs; `awaiting_secret` only via secure IPC.
- Installer lifecycle calls require session_id (+plan_revision for approve).
- `next_action` is the only authority for the next step.
- No generic shell/file/catalog substitute after explicit install intent
  (unless typed `manual-action-required`).
- Load-time no-execution for prompt skills.
- Uninstall never deletes link targets / home / unresolved paths.
- Metadata-only discovery; bodies injected only after invocation.
