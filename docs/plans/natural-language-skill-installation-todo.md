# Natural-Language Skill Installation — Outstanding Task TODO

Status: 2026-08-28 — Coverage audit of `worktree-natural-language-skill-installation`
against PRD `docs/prd/natural-language-skill-installation-prd.md` v1.1 and tech design
`docs/prd/natural-language-skill-installation-technical-design.md` v1.1.

The implementing plan (`docs/plans/2026-08-24-natural-language-skill-installation.md`)
marks Phases A–G done. The tasks below are the items that are **still incomplete**
relative to the PRD/design. Companion narrative: see
`docs/plans/natural-language-skill-installation-outstanding-tasks.md`.

---

## TODO — Not yet complete, with reasons

### 1. Wire Windows shell providers into the chat `run_shell_command` path
- [ ] **Reason:** `src/service/process/` correctly implements §16 (pwsh→powershell→cmd,
      `detached:false` on Windows, env scrub, BOM/UTF-16LE decode, byte counts,
      `PROCESS_OUTPUT_EMPTY_UNEXPECTED`, process-tree kill), but it is consumed **only**
      by dependency probes (`SkillDependencyOrchestrator`). The conversation shell tool
      `run_shell_command` still uses the legacy `spawn` in
      `src/config/skillsRegistry.ts:1952` → `ShellToolService.executeShellCommand`, which
      retains `detached:true` (`ShellToolService.ts:316-323`), Unix env ALLOWLIST
      (`scrubEnvironment`, `:283-291`), `powershell.exe` with no pwsh/fallback
      (`findPowerShell`, `:265-277`), and no BOM/byte-count handling.
- **Ref:** PRD Goal 4, §16, NFR-02.
- **Blocks:** NFR-02 is not met on the primary conversation shell path.

### 2. Add DB baseline + feature migration
- [ ] **Reason:** New entities are registered in `src/config/dbEntities.ts`
      (`SkillInstallationEntity`, `SkillInstallationSessionEntity`,
      `SkillInstallationEventEntity`, `PromptSkillInvocationEntity`), but
      `src/config/dbMigrations.ts` still exports `DB_MIGRATIONS = []`. With no migrations,
      the DataSource keeps using `synchronize` (`src/config/SqliteDb.ts:363-364`) even in
      packaged builds — no safe incremental migration path.
- **Ref:** Design §3.5, §14.3, DoD.
- **Blocks:** "Persistence ships through a baseline and feature migration."

### 3. Route plugin / executable packages to existing install services
- [ ] **Reason:** `SkillPackageInspectionService` classifies repos as `plugin` /
      `executable` / `prompt`, but `SkillInstallationModule` only activates via
      `SkillActivationService.activate` and registers via `registerPromptSkill`
      (`SkillInstallationModule.ts:834-859`). There is **no code path** handing a
      `plugin`/`executable` package to `PluginInstallService` / `SkillImportService`.
      Classification exists; routing does not.
- **Ref:** FR-07, PRD §13.3.

### 4. Make dependencies actually catalog-backed
- [ ] **Reason:** `SkillDependencyOrchestrator` implements ffmpeg **and** ffprobe
      multi-probe detection/verification (`SkillDependencyOrchestrator.ts:31-48,134-171`),
      but uses a standalone hardcoded `KNOWN_BINARIES` table (`:25-82`) and never imports or
      calls the real `SystemDependencyCatalog` / `SystemDependencyModule` (header comment at
      line 23 claims it does). Those are only wired via the separate
      `SystemDependencyResolver` / `SystemDependencyInstaller` flow, disconnected from
      skill-install detection.
- **Ref:** FR-14, Design §12.

### 5. Wire secret injection into approved internal commands
- [ ] **Reason:** `SkillCredentialService.retrieve()` provides the inject-into-approved-child
      API and storage is fail-closed `safeStorage`, but the code documents the consumer gap
      (`SkillCredentialService.ts:124-131`): the approved-command execution path
      (`ApprovedCommandTemplate.environmentNames`) "does not exist yet — repository commands
      are parsed and shown for approval but never run." So repo-setup/helper commands are never
      executed and injection into a running process is never exercised.
- **Ref:** FR-16, PRD §18.4/§19.2.
- **Compounds:** #3 and #4 (nothing actually runs install/helper commands).

### 6. Add a construction site that grants read/execute skill-root capability (no write)
- [ ] **Reason:** The capability model (`src/entityTypes/filesystemContextTypes.ts` — roots
      `skill-source` / `skill-activation` / `install-staging`) and capability-aware path policy
      (`ConversationFilesystemContextService.ts:281-291`, `PATH_CAPABILITY_DENIED`) exist,
      but no construction site ever creates such a root. Only the full-permission workspace
      root (`resolve()`, `:160-165`) and legacy default (`legacyContext`, `:188-194`) are built.
      The execute-without-write skill root exists only in the type system.
- **Ref:** FR-13, PRD §6.3/§14.4/§15.3.

### 7. Emit monotonic `SKILL_INSTALL_PROGRESS` events to the renderer
- [ ] **Reason:** Per-session audit events with monotonic `seq` are stored in the DB
      (`SkillInstallationEventModel.append`, `SkillInstallationModule.ts:928`), but
      `SKILL_INSTALL_PROGRESS` is only declared (`src/config/channellist.ts:371`) — there is
      **no `webContents.send(...)`** and no renderer subscription. The UI is driven by the
      install-card snapshot from the tool result, not a live progress channel.
- **Ref:** Design §15.1, PRD §23.2.

### 8. Install card: structured fields + expandable diagnostics
- [ ] **Reason:** `SkillInstallCard.vue` renders state, ready, retry, cancel,
      approve/reject, secure secret input, and an aggregated `safeSummary`, but source /
      commit / dependencies / secrets / mode are presented only as a single text string
      (`SkillInstallationModule.ts:958-976`) and there is **no expandable diagnostics view**.
- **Ref:** Design §22.1.

### 9. Confirm/resolve credential persistence model deviation
- [ ] **Reason:** Design §14.1/§20.3 specifies `SkillCredentialBindingEntity` +
      `SkillCredentialModule` (opaque binding IDs in SQLite, encrypted value in a separate
      store). Implemented instead is `SkillCredentialService` storing safeStorage-encrypted
      values in `credentials.json` keyed by `${installationId}:${environmentVariable}`. This is
      secure and fail-closed, but is a **deviation** from the specified persistence
      architecture — migration/audit differs from spec. Needs explicit sign-off or alignment.
- **Ref:** Design §14.1, §20.3.

---

## Deferred (already disclosed in the implementing plan — for completeness)

See `docs/plans/2026-08-24-natural-language-skill-installation.md:206-212`.
- [ ] Validate the Windows CI matrix on an actual Windows runner (authored per `build.yml`
      setup; cannot be executed in a Linux worktree). — §16.4 / §26.3, NFR-02.
- [ ] Add a model-driven `skill_install_prepare` E2E (currently covered only at the
      enforcement layer by unit/integration tests, not FakeOpenAI E2E).
- [ ] Add npm/URL plugin sources for standalone skill install (routed to existing
      `PluginInstallService` where applicable).
- [ ] Fix the known aiChat **E2E T-05 parallel-run flake** (passes in isolation).

---

## Note: Kill-switch flag (intended, not a gap)

The feature is behind `AIFETCHLY_SKILL_INSTALL_ENABLED` (`true`/`1`), **default OFF**.
It is **not** set in `/home/robertzeng/project/aiFetchly/.env` (that file only defines
`VITE_LOGIN_URL` and `VITE_PLUGIN_HUB_URL`, plus a commented `UPDATESERVER`). Default-off is
by design; enabling requires setting the flag at build/runtime — this is not an incomplete task.
