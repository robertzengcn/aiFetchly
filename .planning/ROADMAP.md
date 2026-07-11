# Roadmap: AiFetchly

## Milestones

- [x] **v1.0 Google Maps Business Scraper** - Phases 1-4 (shipped 2026-05-23)
- [x] **v1.1 AI Chat File Operation Recording** - Phases 5-8 (shipped 2026-05-25)
- [x] **v1.2 Yandex Maps Business Scraper** - Phases 9-12 (shipped 2026-05-26) — [Archive](.planning/milestones/v1.2-REQUIREMENTS.md)
- [ ] **v2.0 Local Extensibility** - Phases 13-18 (started 2026-07-04)

## Phases

<details>
<summary>v1.0 Google Maps Business Scraper (Phases 1-4) - SHIPPED 2026-05-23</summary>

### Phase 1: Type Contracts and Skill Registration

**Goal:** Establish typed contracts and register the AI skill so the system recognizes `search_google_maps_businesses`.
**Plans:** Complete

### Phase 2: Module and Worker Implementation

**Goal:** Implement the scraping engine -- GoogleMapsModule orchestrates a child process worker.
**Plans:** Complete

### Phase 3: UI Page and Integration

**Goal:** Add manual UI page, IPC handlers, frontend API, and translations.
**Plans:** Complete

### Phase 4: Persistence, Export, and Validation

**Goal:** Add result persistence, CSV/JSON export, and final validation/testing.
**Plans:** Complete

</details>

<details>
<summary>v1.1 AI Chat File Operation Recording (Phases 5-8) - SHIPPED 2026-05-25</summary>

- [x] Phase 5: Types and Tracker Foundation (1/1 plans) - completed 2026-05-25
- [x] Phase 6: Backend Integration (2/2 plans) - completed 2026-05-25
- [x] Phase 7: Frontend Badges and UI (2/2 plans) - completed 2026-05-25
- [x] Phase 8: Translations and Polish (1/1 plan) - completed 2026-05-25

</details>

<details>
<summary>v1.2 Yandex Maps Business Scraper (Phases 9-12) - SHIPPED 2026-05-26</summary>

- [x] Phase 9: Type Contracts and Skill Registration (2/2 plans) - completed 2026-05-26
- [x] Phase 10: Module and Worker Implementation (3/3 plans) - completed 2026-05-26
- [x] Phase 11: UI Page and Integration (2/2 plans) - completed 2026-05-26
- [x] Phase 12: Translations and Validation (1/1 plan) - completed 2026-05-26

</details>

<details>
<summary>v2.0 Local Extensibility (Phases 13-18) - STARTED 2026-07-04</summary>

Source: `docs/prd/aifetchly-local-extensibility-prd.md` + `docs/prd/aifetchly-local-extensibility-technical-design.md`

### Phase 13: Global Context and Built-in Slash Commands

**Goal:** Establish the global `~/.aifetchly` config loader, inject `AGENTS.md` into AiChatV2 context, and ship the slash command registry with built-in commands and a suggestions UI.
**Requirements:** CFG-01, CFG-03, CFG-04, CFG-05, CFG-06, CFG-07, CTX-01, CTX-03, CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-07, CMD-08, TRS-05, TRS-06, TRS-07, DX-01, DX-02, I18-01
**Success criteria:**

1. App startup performs a full async scan of `~/.aifetchly`; adding `AGENTS.md` there changes the next AiChatV2 response without app restart.
2. Typing `/` in the AiChatV2 composer shows built-in commands (`/help`, `/clear`, `/status`, `/reload-config`) with source badges; selecting one dispatches correctly (prompt submit or local result).
3. `/reload-config` forces a rescan and reports current counts; `/status` shows global config + diagnostics state.
4. Renderer never reads `~/.aifetchly` directly (verified by tests); AI-serving dispatch checks `USER_AI_ENABLED`.
5. Invalid/oversized files produce diagnostics, not app crashes; all new UI text translated to 6 languages.

**Plans:** 6 plans
Plans:
**Wave 1**

- [x] 13-01-config-loader-stack-PLAN.md — Pure types + constants + hand-rolled frontmatter parser + path safety + async bounded config loader + snapshot diff
- [x] 13-02-command-registry-parser-PLAN.md — Slash command types + CommandRegistry with source replacement + SlashCommandParser

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 13-03a-context-pipeline-assembler-injection-PLAN.md — Context store + context loader + runtime registry sync + config manager singleton + AGENTS.md injection into AIChatContextAssembler

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 13-03b-commands-dispatcher-ipc-PLAN.md — Built-in slash commands + discriminated-union dispatcher + SlashCommandModule + IPC handlers + channel constants + startup hook

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 13-04-renderer-suggestions-ui-PLAN.md — Preload whitelists + renderer API + AiChatV2SlashSuggestions dropdown + composer Enter/Tab intercept + config-changed subscription

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 13-05-i18n-boundary-tests-PLAN.md — aifetchlyConfig + slashCommands groups in all 6 lang files + TRS-07 renderer boundary test + I18-01 keys-present test

### Phase 14: Workspace Watcher Worker

**Goal:** Add the workspace config watcher child process with reference-counted lifecycle, workspace `AGENTS.md`/commands scanning, binary trust gating, and live-update renderer events.
**Requirements:** CFG-02, CTX-02, WAT-01, WAT-02, WAT-03, WAT-04, WAT-05, WAT-06, WAT-07, TRS-01, TRS-03, TRS-04
**Success criteria:**

1. Opening an existing chat with an approved workspace starts workspace watching; closing it stops watching only when no consumers remain.
2. Switching workspace stops the old watch and starts the new one with an immediate snapshot + renderer refresh.
3. Editing a trusted `<workspace>/.aifetchly/AGENTS.md` updates AiChatV2 context without app restart.
4. Worker crash causes restart + full rescan within the restart cap; worker never touches DB/registries (verified by tests).
5. Untrusted workspace `.aifetchly` is disabled until the trust prompt is accepted; a typical `.aifetchly` rescan completes under 500ms.

**Plans:** 5 plans
Plans:

**Wave 1**

- [x] 14-01-worker-foundation-PLAN.md — Pure-Node worker (fork) + chokidar ^3.6.0 + scanner + zod protocol + WAT-02 grep gate + SC5 SLA log+assert

**Wave 2** *(blocked on Wave 1)*

- [x] 14-02-manager-trust-filter-PLAN.md — WorkspaceWatchManager ref-counted lifecycle + crash-restart cap + applyWorkspaceSnapshot trust filter (TRS-01)

**Wave 3** *(blocked on Wave 2)*

- [x] 14-03-main-ipc-integration-PLAN.md — WorkspaceWatchModule + 4 invoke-channel IPC + preload whitelists + manager singleton wiring + background.ts shutdown hook + D-04 additive workspaceId

**Wave 4** *(blocked on Wave 3)*

- [x] 14-04-renderer-trust-card-PLAN.md — WorkspaceTrustCard.vue (4 TRS-03 options + main-supplied Preview) + AiChatV2 subscriber filter by workspaceId + acquire/release lifecycle

**Wave 5** *(blocked on Wave 4)*

- [x] 14-05-i18n-boundary-tests-PLAN.md — workspaceTrust i18n group in all 6 lang files + TRS-07 renderer boundary test + SC5 perf-backstop

### Phase 15: Prompt Command Files

**Goal:** Load markdown prompt commands (`commands/*.md`) from global and trusted-workspace sources with `$ARGUMENTS` expansion and source-replacement reconciliation.
**Requirements:** CMD-06
**Success criteria:**

1. Adding `~/.aifetchly/commands/review.md` makes `/review` appear in suggestions; deleting it removes it without restart.
2. `/review src/service` expands the body with `$ARGUMENTS = "src/service"` and submits through the normal Chat V2 path.
3. Renaming or editing a command file reconciles correctly via source replacement (no stale entries, no missed events).
4. Workspace commands require trust before appearing; invalid frontmatter produces a diagnostic and the command is ignored.

**Plans:** 2/2 plans complete
Plans:

**Wave 1**

- [x] 15-01-expansion-validator-dispatcher-PLAN.md — Pure `$ARGUMENTS` expander (D-01/D-02) + CMD-06 frontmatter validator/builder + dispatcher `case "prompt":` wiring to `submit_prompt`

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 15-02-source-wiring-argument-hint-PLAN.md — Global loader command scan + workspace draft→definition conversion + D-03 workspace-shadows-global + D-04 argumentHint inline in suggestions

### Phase 16: Dynamic Agents

**Goal:** Refactor `AgentDefinitionRegistry` for source-aware dynamic registration, parse `agents/*.md`, and enable `run_subagent` dispatch by scoped dynamic ID.
**Requirements:** AGT-01, AGT-02, AGT-03
**Success criteria:**

1. Adding `~/.aifetchly/agents/lead-researcher.md` registers `user:agent:lead-researcher`; `/agents` lists it.
2. `run_subagent` dispatches the dynamic agent; its tool allowlist is intersected with registered/permitted tools at runtime.
3. Built-in agent IDs cannot be shadowed by dynamic ones; workspace agents require trust before registration.

**Plans:** 3 plans

Plans:
**Wave 1**

- [x] 16-01-registry-validator-frontmatter-PLAN.md — refactor AgentDefinitionRegistry into a source-aware class with D-Precedence rank + atomic replaceSource (AGT-01); pure buildAgentDefinition validator + non-fatal agent-tool-invalid diagnostic (AGT-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 16-02-loaders-trust-scanner-PLAN.md — COMPLETE 2026-07-09 — global ~/.aifetchly/agents loader + manager-owned registry; workspace scanner raw drafts (worker-no-DB); workspace draft to definition converter + applyWorkspaceSnapshot trust filter (TRS-01) (AGT-02) — 3/3 tasks TDD, 44 tests green, tsc 0

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 16-03-dispatch-list-context-PLAN.md — AgentRuntime.runSync registry-first resolution with DB fallback (AGT-03); /agents built-in command; "Available agents" system-message block (D-Discovery); i18n chrome

### Phase 17: Hooks

**Goal:** Parse `hooks/hooks.json`, register hooks by source with trust gating, dispatch only through safe existing boundaries, and add the per-capability workspace trust entity.
**Requirements:** TRS-02, HOK-01, HOK-02
**Success criteria:**

1. Editing a trusted `<workspace>/.aifetchly/hooks/hooks.json` updates dispatch behavior via `HookRegistry.replaceSource`.
2. Hooks never execute shell directly in the main process; actions route through worker/sandbox or a registered skill.
3. The `AIFetchlyWorkspaceTrust` entity persists per-capability trust (instructions/commands/agents/hooks/skills) via Model/Module (no DB access from worker).
4. Hook failures are non-fatal and surface as diagnostics; unsupported events produce diagnostics.

**Plans:** 3 plans
Plans:

**Wave 1**

- [x] 17-01-PLAN.md — AIFetchlyWorkspaceTrust entity/model/module + migration seed + schema-apply [BLOCKING] (TRS-02) + HookRegistry.replaceSource/unregisterSource (HOK-01) + maxHooksPerSource/diagnostic-code constants

**Wave 2** *(parallel; both depend on 17-01, zero file overlap)*

- [x] 17-02-PLAN.md — hooks.json parse layer (buildHookDefinition + global/worker scanners + converter) + hooks: trust-filter line + entity-backed sync trust cache replacing approvalCache (HOK-01, TRS-02)
- [x] 17-03-PLAN.md — NEW hook-execution worker (protocol + entry + client + forge/vite) + dispatcher command-hook worker routing + skill-ref no-op + SessionStart/Stop emitters (HOK-02)

### Phase 18: Skills and Plugin Integration

**Goal:** Register local skills via the existing SkillRegistry/permission flow and promote plugin `commands/`/`agents/` once the native registries are stable.
**Requirements:** SKL-01, SKL-02
**Success criteria:**

1. A `~/.aifetchly/skills/<name>/manifest.json` is validated, registered, exposed as an OpenAI tool schema, executed via SkillExecutor, and permission-checked — never loaded as arbitrary code into the main process.
2. Plugin `commands/*.md` become active slash commands; plugin `agents/*.md` become dynamic agents, once the native registries are stable.
3. `~/.aifetchly/plugins/<name>/options.json` path is preserved without conflicting with installed plugin package roots under `userData/plugins/installed`.

**Plans:** TBD

</details>

## Backlog

### Phase 999.1: Follow-up — Phase 6 incomplete plans (BACKLOG)

**Goal:** Resolve plans that ran without producing summaries during Phase 6 execution
**Source phase:** 6
**Deferred at:** 2026-05-25 during /gsd-next advancement to Phase 8
**Plans:**

- [ ] 06-01: Thread conversationId through ToolExecutor (ran, no SUMMARY.md)
- [ ] 06-02: Add AI_FILE_OPERATION to preload whitelist, init tracker (ran, no SUMMARY.md)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Type Contracts and Skill Registration | v1.0 | 3/3 | Complete | 2026-05-23 |
| 2. Module and Worker Implementation | v1.0 | 2/2 | Complete | 2026-05-23 |
| 3. UI Page and Integration | v1.0 | 2/2 | Complete | 2026-05-23 |
| 4. Persistence, Export, and Validation | v1.0 | 1/1 | Complete | 2026-05-23 |
| 5. Types and Tracker Foundation | v1.1 | 1/1 | Complete | 2026-05-25 |
| 6. Backend Integration | v1.1 | 2/2 | Complete | 2026-05-25 |
| 7. Frontend Badges and UI | v1.1 | 2/2 | Complete | 2026-05-25 |
| 8. Translations and Polish | v1.1 | 1/1 | Complete | 2026-05-25 |
| 9. Type Contracts and Skill Registration | v1.2 | 2/2 | Complete | 2026-05-26 |
| 10. Module and Worker Implementation | v1.2 | 3/3 | Complete | 2026-05-26 |
| 11. UI Page and Integration | v1.2 | 2/2 | Complete | 2026-05-26 |
| 12. Translations and Validation | v1.2 | 1/1 | Complete | 2026-05-26 |
| 13. Global Context and Built-in Slash Commands | v2.0 | 6/6 | Complete   | 2026-07-05 |
| 14. Workspace Watcher Worker | v2.0 | 3/5 | In Progress|  |
| 15. Prompt Command Files | v2.0 | 2/2 | Complete    | 2026-07-07 |
| 16. Dynamic Agents | v2.0 | 3/3 | Complete   | 2026-07-09 |
| 17. Hooks | v2.0 | 3/3 | Complete   | 2026-07-11 |
| 18. Skills and Plugin Integration | v2.0 | 0/? | Not started | — |
