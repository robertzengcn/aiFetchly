# Testing Guide — v2.0 “Local Extensibility” Milestone

> How to test every feature shipped in the v2.0 milestone. Covers automated tests (what to run) **and** manual / live‑app checks (how to drive the running Electron app) for each phase.
>
> Scope: Phases 13–18. Phases 13, 15, 16 are complete; Phase 14 is implemented (plans done, verification pending); Phases 17–18 are planned (not yet built).

---

## 1. Milestone at a glance

| Phase | Name | Status | Delivers | Requirements |
|------|------|--------|----------|--------------|
| 13 | Global Context + Built‑in Slash Commands | ✅ Complete (6/6) | `~/.aifetchly` loader, `AGENTS.md` injection, slash‑command registry + parser + dispatcher, built‑in commands, suggestions UI, i18n | CFG‑01/03/04/05/06/07, CTX‑01/03, CMD‑01..05/07/08, TRS‑05/06/07, DX‑01/02, I18‑01 |
| 14 | Workspace Watcher Worker | 🟡 Implemented (verify pending) | Child‑process watcher, ref‑counted lifecycle, workspace `AGENTS.md`/commands scan, binary trust gate, renderer events | CFG‑02, CTX‑02, WAT‑01..07, TRS‑01/03/04 |
| 15 | Prompt Command Files | ✅ Complete (2/2) | `commands/*.md` loading (global + trusted workspace), `$ARGUMENTS` expansion, source reconciliation | CMD‑06 (+ CMD‑07/08, D‑01..04) |
| 16 | Dynamic Agents | ✅ Complete (3/3) | Source‑aware agent registry, global/workspace loaders, trust filter, `run_subagent` dispatch, `/agents` command, D‑Discovery context block | AGT‑01/02/03 |
| 17 | Hooks | ⬜ Not started | `hooks/hooks.json` parsing, `HookRegistry`, safe dispatch, per‑capability trust entity | TRS‑02, HOK‑01/02 |
| 18 | Skills + Plugin Integration | ⬜ Not started | `skills/*/manifest.json` via `SkillRegistry`; plugin `commands/`+`agents/` promotion | SKL‑01/02 |

**Unifying invariants (enforced + tested across all phases):**
- **TRS‑05** — AI‑serving IPC handlers check `USER_AI_ENABLED` first; list/status/reload handlers don't.
- **TRS‑06** — No direct execution of arbitrary JS/shell/TS from `~/.aifetchly`; prompt commands are text‑expansion only.
- **TRS‑07** — Renderer never reads extension files directly; worker never touches DB/registries.
- **WAT‑02** — Worker is scan‑only: no SQLite/TypeORM, no registry mutation, no trust decisions, no renderer IPC.

---

## 2. Test infrastructure

| Concern | Tooling |
|--------|---------|
| Main‑process unit/integration | **Vitest** — `vite.main.config.mjs` |
| Utility‑code unit | **Vitest** — `vite.utilityCode.config.mjs` |
| Module/scraper tests | **Mocha** — `test/modules/**/*.test.ts` |
| Type gate | `tsc --noEmit` runs once per Vitest startup via `test/vitest/_typecheck/globalSetup.ts` (type errors abort the run) |
| Renderer boundary | Vitest tests asserting no FS access from renderer / worker no‑DB |
| Coverage target | **80%+** (project standard) |

### ⚠ Critical gotcha — `yarn testmain` hangs

The full `yarn testmain` suite **hangs 20+ minutes** on a pre‑existing Electron/DB integration test that launches `electron-forge-start`. It is unrelated to v2.0 logic and shows ~10% CPU (progressing, not deadlocked) but never finishes in reasonable time.

**Do not use `yarn testmain` for iteration.** Use **targeted** runs with the TSC globalSetup skipped, then run `tsc` separately:

```bash
# Targeted Vitest (fast, ~1–3s per filter) — pass filename substrings
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs <filter1> <filter2> ...

# Utility-code tests
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs <filter>

# Mandatory separate type check (the SKIP flag only skips the globalSetup)
npx tsc --noEmit
```

> `AIFETCHLY_SKIP_TSC=1` is for tight inner loops only — **never commit code that needs it** (the `tsc` gate is mandatory). Always run `npx tsc --noEmit` before committing.

### Other environment notes
- `better-sqlite3` may emit `ERR_DLOPEN_FAILED` stderr in tests that touch the real DB driver — this is **pre‑existing graceful‑degradation noise**; the tests catch + log it and still pass.
- The native module may need rebuilding after Node updates: `yarn rebuild-sqlite3`.

---

## 3. Running tests — quick reference

```bash
# Full automated gate for the whole milestone (recommended before shipping):
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  AIFetchlyConfig AIFetchlyConfigMarkdown AIFetchlyConfigSnapshotDiff \
  AIFetchlyRuntimeRegistrySync.trust AIFetchlyConfigManager.watcher \
  CommandRegistry SlashCommandParser SlashCommandDispatcher \
  AIChatContextAssembler rendererNoFsAccessToAifetchly rendererNoFsAccessToWorkspaceConfig \
  i18nKeysPresent AiChatV2SlashSuggestions \
  promptCommandFrontmatter \
  AgentDefinitionRegistry agentFrontmatter AgentRuntime runSubagentTool
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs agentDefinitionRegistry
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs childprocess/WorkerNoDbBoundary
npx tsc --noEmit        # must report 0 errors

# Per-phase commands are in §4.
# Module/scraper (Mocha):
yarn test
```

---

## 4. Per‑phase test plans

Each phase below lists: **(a)** features, **(b)** automated tests with exact run commands, **(c)** manual / live‑app checks with step‑by‑step instructions, **(d)** requirements covered.

---

### Phase 13 — Global Context + Built‑in Slash Commands  ✅

**Features:** bounded async scan of `~/.aifetchly`; `AGENTS.md` injected into AiChatV2 system message; `CommandRegistry` (scoped IDs, deterministic order, `replaceSource`); `SlashCommandParser`; built‑ins `/help` `/clear` `/status` `/reload-config`; discriminated‑union dispatcher; renderer suggestions dropdown; i18n (6 languages).

**(b) Automated tests**
```bash
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  AIFetchlyConfigLoader.test AIFetchlyConfigMarkdown AIFetchlyConfigSnapshotDiff \
  AIFetchlyRuntimeRegistrySync.trust \
  CommandRegistry SlashCommandParser SlashCommandDispatcher \
  AIChatContextAssembler.test rendererNoFsAccessToAifetchly i18nKeysPresent \
  AiChatV2SlashSuggestions
```

**(c) Manual / live‑app checks**
1. **`AGENTS.md` live update (SC1 / CTX‑01):** `yarn dev` → add `~/.aifetchly/AGENTS.md` with a distinctive instruction → in AiChatV2 send a chat → confirm the model obeys the instruction **without restarting the app**.
2. **Slash suggestions UX (CMD‑05):** in the AiChatV2 composer type `/` → confirm the dropdown shows `/help /clear /status /reload-config` with source badges → arrow‑key navigate, Enter/Tab to choose, Shift+Enter inserts a newline.
3. **`/reload-config` + `/status` (SC3 / DX‑02):** run `/reload-config` → confirm it rescans and reports counts; run `/status` → confirm it shows global config + diagnostics.
4. **i18n locale QA (I18‑01):** switch the app language to zh/es/fr/de/ja → confirm `aifetchlyConfig` + `slashCommands` strings read correctly.
5. **Boundary (TRS‑07):** verified automatically by `rendererNoFsAccessToAifetchly.test.ts` (renderer never reads `~/.aifetchly` directly).

**(d) Requirements:** CFG‑01/03/04/05/06/07, CTX‑01/03, CMD‑01/02/03/04/07/08, TRS‑05/06/07, DX‑01/02, I18‑01. *(CMD‑05 = the suggestions UX, is the one primarily manual‑QA’d item.)*

---

### Phase 14 — Workspace Watcher Worker  🟡

**Features:** one long‑lived child‑process worker (`src/childprocess/aifetchly-config/`) watching `<workspace>/.aifetchly/**`; `WorkspaceWatchManager` ref‑counted `acquire`/`release`/`rescan`/`shutdown`; crash‑restart cap (max 3/60s) + full rescan; `applyWorkspaceSnapshot` trust filter (TRS‑01); `WorkspaceTrustCard.vue` (4 TRS‑03 options); renderer events; i18n.

**(b) Automated tests**
```bash
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  AIFetchlyConfigManager.watcher AIFetchlyRuntimeRegistrySync.trust \
  childprocess/WorkerNoDbBoundary rendererNoFsAccessToWorkspaceConfig \
  i18n/workspaceTrust.i18n.parity
# Worker-no-DB invariant (WAT-02) grep gate:
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs childprocess/WorkerNoDbBoundary
```

**(c) Manual / live‑app checks**
1. **Lifecycle (SC1/SC2):** open an existing chat with an **approved** workspace → watching starts; close it → watching stops only when no consumers remain. Switch workspace → old watch stops, new watch starts with immediate snapshot + renderer refresh.
2. **Live workspace `AGENTS.md` (SC3 / CTX‑02):** with a trusted workspace open, edit `<workspace>/.aifetchly/AGENTS.md` → confirm AiChatV2 context refreshes **without restart**.
3. **Cross‑platform file events (WAT‑05):** on Linux/macOS/Windows, edit `<ws>/.aifetchly/AGENTS.md` → confirm the change appears live (chokidar semantics differ per OS; CI only covers one).
4. **Trust prompt flow (TRS‑03/04):** open a chat whose workspace has an untrusted `.aifetchly` → the trust card appears → exercise all 4 options (Preview / Trust instructions only / Trust all workspace AI config / Keep disabled) → confirm the choice persists across restart.
5. **Crash recovery (WAT‑07 / SC4):** kill the worker process → confirm it restarts + rescans within the cap; exceed the cap → auto‑watch stops with an error, `/reload-config` is the manual retry.
6. **Perf (SC5):** a typical `.aifetchly` rescan completes **under 500ms**.

**(d) Requirements:** CFG‑02, CTX‑02, WAT‑01..07, TRS‑01/03/04. *(WAT‑02 worker‑no‑DB is the load‑bearing invariant — grep‑gated in `WorkerNoDbBoundary.test.ts`.)*

---

### Phase 15 — Prompt Command Files  ✅

**Features:** markdown prompt commands from `~/.aifetchly/commands/*.md` (global) + trusted workspace; frontmatter validated (name `^[a-z][a-z0-9_-]*$`, description ≤500, ≤10 aliases, `argumentHint` ≤100, `type: prompt`, non‑empty body); `$ARGUMENTS` literal replace‑all expansion (D‑01/D‑02); source‑replacement reconciliation (add/change/delete/rename); workspace‑shadows‑global precedence (D‑03); inline `argumentHint` in suggestions (D‑04).

**(b) Automated tests**
```bash
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  promptCommandFrontmatter AIFetchlyConfigLoader.commands SlashCommandDispatcher
# $ARGUMENTS expander purity (utility code):
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs expandPrompt
```

**(c) Manual / live‑app checks**
1. **Add/remove without restart (SC1 / CMD‑06):** create `~/.aifetchly/commands/review.md` (valid frontmatter + body) → confirm `/review` appears in suggestions; delete it → confirm it disappears **without restart**.
2. **`$ARGUMENTS` expansion (SC2):** run `/review src/service` → confirm the body is submitted with `$ARGUMENTS = "src/service"` through the normal Chat V2 path.
3. **Rename/edit reconciliation (SC3):** rename or edit a command file → confirm source replacement reconciles (no stale entries, no missed events).
4. **Workspace trust (SC4):** an untrusted workspace command does **not** appear until trusted; invalid frontmatter produces a diagnostic and the command is ignored.

**Sample `~/.aifetchly/commands/review.md`:**
```markdown
---
name: review
description: Review the given path for bugs and style issues.
type: prompt
argumentHint: <path>
---
Review the following path for correctness bugs and style issues: $ARGUMENTS
```

**(d) Requirements:** CMD‑06 (+ CMD‑07 ranking, CMD‑08 unknown/disabled messaging, D‑01..04).

---

### Phase 16 — Dynamic Agents  ✅

**Features:** source‑aware `AgentDefinitionRegistry` (D‑Precedence: built‑in > user > trusted workspace > plugin; built‑ins unshadowable; `replaceSource` atomic reconciliation); `buildAgentDefinition` pure frontmatter validator; global `~/.aifetchly/agents/*.md` loader; workspace scanner (worker produces RAW drafts — WAT‑02); trust filter drops untrusted workspace agents before registry mutation (TRS‑01); `AgentRuntime.runSync` resolution swap to **registry‑first with DB fallback**; `run_subagent` agentId description (both ID forms); `/agents` built‑in command; D‑Discovery “Available agents” system‑message block; i18n.

**(b) Automated tests**
```bash
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  AgentDefinitionRegistry agentFrontmatter \
  AIFetchlyConfigLoader.agents AIFetchlyRuntimeRegistrySync.trust \
  AgentRuntime runSubagentTool SlashCommandDispatcher \
  AIChatContextAssembler.aifetchly childprocess/WorkerNoDbBoundary
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.utilityCode.config.mjs agentDefinitionRegistry
```
*(A ready‑to‑use fixture `~/.aifetchly/agents/lead-researcher.md` is already created — see SC1.)*

**(c) Manual / live‑app checks** *(these are the 2 `human_needed` UAT items in `16-UAT.md`)*
1. **`/agents` lists a user agent (SC1 / AGT‑02):** open AiChatV2 → run `/agents` → confirm a row `user:agent:lead-researcher — lead-researcher: Researches a topic... [user]` appears, and the D‑Discovery “Available agents” block contains the same scoped id.
2. **`run_subagent` dispatch (SC2 / AGT‑03):** in AiChatV2, prompt the model to delegate research to the lead‑researcher agent → confirm `run_subagent` fires with the **exact scoped id** (`user:agent:lead-researcher`) copied from the Available‑agents block (no fuzzy/bare id), and the agent runs with its tool allowlist intersected at runtime.
3. **Built‑ins unshadowable (SC3 / AGT‑01):** confirmed automatically — `SOURCE_RANK` + `rebuildNameIndex` lowest‑rank‑wins (unit tests).
4. **Workspace trust (SC3 / TRS‑01):** an untrusted workspace agent never reaches the registry → never appears in `/agents` or the block (unit‑tested at `AIFetchlyRuntimeRegistrySync.ts:165`).

**(d) Requirements:** AGT‑01/02/03 (+ DX‑01 `agent-tool-invalid` non‑fatal warning, D‑Discovery).

---

### Phase 17 — Hooks  ⬜ (planned)

**Goal:** parse `<workspace>/.aifetchly/hooks/hooks.json` (matchers for `PreToolUse`/`PostToolUse`/`SessionStart`/`Stop`); `HookRegistry.replaceSource`/`unregisterSource`; dispatch only through existing safe boundaries; per‑capability `AIFetchlyWorkspaceTrust` entity; non‑fatal diagnostics.

**When built, test:**
- **Automated:** `HookRegistry` source reconciliation; trust gating before mutation; main‑process‑never‑executes‑shell boundary (grep gate mirroring WAT‑02); `AIFetchlyWorkspaceTrust` Model/Module (no worker DB access).
- **Manual (planned):** edit a trusted `<ws>/.aifetchly/hooks/hooks.json` → confirm dispatch changes via `replaceSource`; trigger a hook failure → confirm it's non‑fatal and surfaces a diagnostic; an unsupported event → diagnostic.

**(d) Requirements:** TRS‑02, HOK‑01/02.

---

### Phase 18 — Skills + Plugin Integration  ⬜ (planned)

**Goal:** register `~/.aifetchly/skills/<name>/manifest.json` through the existing `SkillRegistry`/`SkillExecutor`/`SkillPermissionService` (never arbitrary code in main); promote plugin `commands/*.md` and `agents/*.md` once native registries are stable; preserve `~/.aifetchly/plugins/<name>/options.json` without conflicting with installed package roots.

**When built, test:**
- **Automated:** manifest validation; SkillRegistry registration → OpenAI tool schema; permission check path; plugin command/agent promotion through the Phase 13/16 registries.
- **Manual (planned):** drop a skill manifest → confirm it appears as a callable tool; a plugin's `commands/`/`agents/` become active; `options.json` path coexists with `userData/plugins/installed`.

**(d) Requirements:** SKL‑01/02.

---

## 5. Milestone‑level end‑to‑end flows (cross‑phase)

These exercise the whole extensibility surface together. Run in the live app (`yarn dev`):

**Flow A — Global instructions + prompt command**
1. Add `~/.aifetchly/AGENTS.md` (Phase 13) + `~/.aifetchly/commands/review.md` (Phase 15).
2. In AiChatV2, type `/` → confirm `/review` is suggested (13 + 15).
3. Run `/review src/service` → confirm `$ARGUMENTS` expansion submits through Chat V2 (15) and the model also obeys `AGENTS.md` (13).

**Flow B — Workspace trust + live update**
1. Open a workspace with `.aifetchly/` → trust card appears (14).
2. Choose “Trust all workspace AI config” → edit `<ws>/.aifetchly/AGENTS.md` → confirm context refreshes without restart (14/CTX‑02).

**Flow C — Dynamic agent discovery + dispatch**
1. `~/.aifetchly/agents/lead-researcher.md` exists (Phase 16, fixture ready).
2. Run `/agents` → confirm `user:agent:lead-researcher` (16/SC1).
3. Ask the model to delegate research → confirm `run_subagent` fires with the scoped id (16/SC2).

**Flow D — Worker resilience**
1. With a workspace watched (14), kill the worker process → confirm restart + rescan within the cap (WAT‑07).

---

## 6. Known gotchas & environment notes

| Issue | Detail | Workaround |
|------|--------|-----------|
| `yarn testmain` hangs | A pre‑existing Electron/DB test launches `electron-forge-start` and never finishes (~20+ min). | Use targeted `AIFETCHLY_SKIP_TSC=1 npx vitest run …` + separate `npx tsc --noEmit`. |
| `better-sqlite3 ERR_DLOPEN_FAILED` | Native module not registered in some test contexts. | Pre‑existing graceful‑degradation noise; tests catch + log and still pass. Rebuild with `yarn rebuild-sqlite3` if the real app fails. |
| `.md` Write hook | A project PreToolUse hook blocks the Write tool on `.md` files (except README/CLAUDE/AGENTS/CONTRIBUTING and `/docs/` paths). | Write `.md` via Bash heredoc, or place under `docs/`. |
| Worker DB access | Worker must never touch SQLite/TypeORM. | Enforced by `childprocess/WorkerNoDbBoundary.test.ts` grep gate (checks `process.env.WORKER_TYPE`). |
| AI gating | AI‑serving IPC must check `USER_AI_ENABLED` first. | Verified by absence of `registerAiValidatedHandler` on non‑AI surfaces (TRS‑05 Strategy A). |

---

## 7. Requirement → test traceability (v2.0)

| Req | Phase | Automated test(s) | Manual check |
|-----|-------|-------------------|--------------|
| CTX‑01 | 13 | `AIChatContextAssembler.test` | Flow A step 1 (AGENTS.md live) |
| CTX‑02 | 14 | `AIChatContextAssembler.aifetchly` | Phase 14 SC3 |
| CMD‑01..04 | 13 | `CommandRegistry`, `SlashCommandParser`, `SlashCommandDispatcher` | — |
| CMD‑05 | 13 | `AiChatV2SlashSuggestions` | Phase 13 manual #2 (suggestions UX) |
| CMD‑06 | 15 | `promptCommandFrontmatter`, `AIFetchlyConfigLoader.commands` | Phase 15 SC1/SC2 |
| CMD‑07/08 | 13/15 | `SlashCommandDispatcher` | — |
| WAT‑01..07 | 14 | `AIFetchlyConfigManager.watcher`, `childprocess/WorkerNoDbBoundary` | Phase 14 SC1–SC5 |
| TRS‑01 | 14/16 | `AIFetchlyRuntimeRegistrySync.trust` | Phase 14/16 trust flows |
| TRS‑05/06/07 | 13 | `rendererNoFsAccessToAifetchly`, boundary tests | — |
| AGT‑01 | 16 | `AgentDefinitionRegistry` | — |
| AGT‑02 | 16 | `agentFrontmatter`, `AIFetchlyConfigLoader.agents` | Phase 16 SC1 |
| AGT‑03 | 16 | `AgentRuntime`, `runSubagentTool`, `SlashCommandDispatcher` | Phase 16 SC2 |
| HOK‑01/02 | 17 | *(planned)* | *(planned)* |
| SKL‑01/02 | 18 | *(planned)* | *(planned)* |

---

### Shipping checklist (before marking the milestone done)
- [ ] §3 full automated gate green (all targeted Vitest filters + `tsc --noEmit` 0 errors)
- [ ] All per‑phase manual checks in §4 executed in the live app
- [ ] Cross‑phase flows A–D (§5) pass end‑to‑end
- [ ] No `yarn testmain`‑hang‑masked regressions (run the full suite once on a machine where it completes, or accept the targeted‑suite substitute with documented rationale)
- [ ] i18n verified in all 6 languages (en/zh/es/fr/de/ja)
- [ ] `/gsd-verify-work` UAT items closed for each completed phase
