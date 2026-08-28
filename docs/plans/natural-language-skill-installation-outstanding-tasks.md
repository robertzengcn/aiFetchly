# Natural-Language Skill Installation — Outstanding / Incomplete Tasks

Status of a live requirements-coverage audit (2026-08-28) against the PRD
(`docs/prd/natural-language-skill-installation-prd.md` v1.1) and tech design
(`docs/prd/natural-language-skill-installation-technical-design.md` v1.1),
performed on `worktree-natural-language-skill-installation`.

The implementing plan (`docs/plans/2026-08-24-natural-language-skill-installation.md`)
marks Phases A–G as done. This file records the tasks that are **incomplete or
only partially met** relative to the PRD/design, plus the concrete reason for
each. These are the items that block the PRD "Definition of Done".

---

## 1. §16 / NFR-02 — Windows shell reliability not delivered on the chat path

**Requirement:** Make PowerShell, cmd, Bash, and native command output reliable
and testable on the user-facing shell tool (pwsh→powershell→cmd resolution,
`detached:false` on Windows, environment scrub instead of Unix ALLOWLIST,
BOM/UTF-16LE decoding, byte counts, `PROCESS_OUTPUT_EMPTY_UNEXPECTED`, process
tree kill).

**Implemented:** The new `src/service/process/` provider layer
(`WindowsProcessProvider`, `PosixProcessProvider`, `ShellInterpreterResolver`,
`PlatformProcessProvider`) implements the full §16 contract correctly.

**Gap / reason:** The providers are consumed **only by dependency probes**
(`SkillDependencyOrchestrator.ts` → `getPlatformProcessProvider()`). The
user-facing chat shell tool `run_shell_command` still calls
`ShellToolService.executeShellCommand` (`src/config/skillsRegistry.ts:1952`),
which uses its **own legacy `spawn` path** — `detached: true` on all platforms
(`ShellToolService.ts:316-323`), a Unix-style env ALLOWLIST
(`scrubEnvironment`, `ShellToolService.ts:283-291`), `powershell.exe` without a
pwsh preference or fallback (`findPowerShell`, `ShellToolService.ts:265-277`),
and no BOM/byte-count/`PROCESS_OUTPUT_EMPTY_UNEXPECTED` handling. The two shell
resolvers disagree about the shell to use for the same request.

**Blocking:** PRD Goal 4 and NFR-02 (100% of expected-output Windows shell
fixtures capture non-empty output) are not met on the primary conversation
shell path.

---

## 2. §3.5 / §14.3 — Database baseline + feature migration absent

**Requirement:** Establish and verify the repository baseline migration before
feature persistence ships; register a distinct skill-installation migration in
`DB_MIGRATIONS` and entities in `DB_ENTITIES`. DoD: "Persistence ships through
a baseline and feature migration."

**Implemented:** The new entities are registered in
`src/config/dbEntities.ts` (`SkillInstallationEntity`,
`SkillInstallationSessionEntity`, `SkillInstallationEventEntity`,
`PromptSkillInvocationEntity`).

**Gap / reason:** `src/config/dbMigrations.ts` still exports
`export const DB_MIGRATIONS: Array<new () => MigrationInterface> = [];` (empty).
Because `DB_MIGRATIONS.length === 0`, the DataSource keeps using
`synchronize` (`src/config/SqliteDb.ts:363-364`) even in packaged builds.
The design explicitly requires a baseline before the feature migration; without
it, packaged builds auto-mutate the schema and there is no safe incremental
migration path.

**Blocking:** Design §14.3 DoD "Establish and verify the repository baseline
migration" and "Persistence ships through a baseline and feature migration."

---

## 3. FR-07 / §10, §11 — Plugin & executable packages not routed to existing services

**Requirement:** Route plugin and executable-skill packages through existing
installation services (`PluginInstallService` / `SkillImportService`) instead
of reimplementing their import.

**Implemented:** `SkillPackageInspectionService` classifies repositories as
`plugin`, `executable`, `prompt`, multi-skill, or ambiguous (classification
only).

**Gap / reason:** `SkillInstallationModule` only activates via
`SkillActivationService.activate` (managed copy / link) and registers via
`registerPromptSkill` (prompt kind only, `SkillInstallationModule.ts:834-859`).
There is **no code path** that hands a `plugin`/`executable` package to a
separate plugin/executable installer service. Classification exists; routing
does not.

**Blocking:** FR-07 and PRD §13.3 ("route to that service instead of
reimplementing plugin import").

---

## 4. FR-14 / §12 — Dependencies are not actually catalog-backed

**Requirement:** Detect, prepare, and verify typed dependencies through the
validated dependency catalog; repository prose cannot become a privileged
command.

**Implemented:** ffmpeg **and** ffprobe multi-probe detection/verification
(`SkillDependencyOrchestrator.ts:31-48,134-171`) — every declared probe must
pass, via the new process provider.

**Gap / reason:** `SkillDependencyOrchestrator` uses a standalone hardcoded
`KNOWN_BINARIES` table with free-text `installHint`s
(`SkillDependencyOrchestrator.ts:25-82`). Its header comment claims "install
flows through SystemDependencyModule" (line 23), but it **never imports or
calls the real `SystemDependencyCatalog` / `SystemDependencyModule`**. Those
are imported only by the separate `SystemDependencyResolver` /
`SystemDependencyInstaller` flow, which is not connected to skill-install
dependency detection.

**Blocking:** FR-14 and design §12 ("a local validated catalog maps them to
supported operations").

---

## 5. FR-16 / §13 — Secret injection into approved processes not wired

**Requirement:** Inject secrets only into approved processes; never in chat,
logs, or command arguments.

**Implemented:** `SkillCredentialService.retrieve()` provides the
inject-into-one-approved-child API; storage is fail-closed `safeStorage`.

**Gap / reason:** The code itself documents the consumer gap
(`SkillCredentialService.ts:124-131`): "the approved-command execution path
(`ApprovedCommandTemplate.environmentNames`) … does not exist yet — repository
commands are parsed and shown for approval but never run." So repository-setup
commands are surfaced for approval but **never executed**, and credential
injection into a running process is never exercised by any path.

**Blocking:** FR-16 and PRD §18.4/§19.2 real execution workflows; also
compounds FR-07/FR-14 (nothing actually runs install/helper commands).

---

## 6. FR-13 / §6.3, §15.3 — Read/list + separately-approved execute skill root (no write) never wired

**Requirement:** Provide read/list and separately-approved execute access to the
selected skill root without granting write access.

**Implemented:** Full capability type model
(`src/entityTypes/filesystemContextTypes.ts` — `read|write|execute|watch|
activate`; root kinds `skill-source`, `skill-activation`, `install-staging`)
and capability-aware path policy
(`ConversationFilesystemContextService.ts:281-291`,
`PATH_CAPABILITY_DENIED`).

**Gap / reason:** No construction site ever creates a `skill-source` /
`skill-activation` / `install-staging` root. The only contexts built are the
full-permission workspace root (`resolve()`,
`ConversationFilesystemContextService.ts:160-165`) and the legacy-default
context (`legacyContext`, `:188-194`). The execute-without-write skill root
exists **only in the type system**, never in a reachable code path.

**Blocking:** FR-13 and PRD §14.4 / §15.3 capability model.

---

## 7. §15.1 — `SKILL_INSTALL_PROGRESS` monotonic renderer events not emitted

**Requirement:** Progress events must be monotonic and scoped to a session and
pushed to the renderer for UI rendering.

**Implemented:** Sequential per-session **audit** events with monotonic
`seq` numbers (`SkillInstallationEventModel.append`,
`SkillInstallationModule.ts:928`) stored in the DB.

**Gap / reason:** `SKILL_INSTALL_PROGRESS` is declared in
`src/config/channellist.ts:371` but there is **no `webContents.send(...)`**
anywhere and no renderer subscription. The UI is driven by the install-card
snapshot from the tool result, not a live progress channel.

**Blocking:** §15.1 and PRD §23.2 progress-event contract.

---

## 8. §22.1 — Install card lacks structured fields and expandable diagnostics

**Requirement:** One stable card showing source, resolved commit, state,
discovered skill type/name, dependency checklist, permission requests, secure
credential requests, current operation/progress, retryable errors, final
readiness, plus an expandable low-level diagnostic view.

**Implemented:** `SkillInstallCard.vue` renders state, ready, retry, cancel,
approve/reject, secure secret input, and an aggregated `safeSummary`.

**Gap / reason:** Source / commit / dependencies / secrets / mode are presented
only as a single `safeSummary` text string (`SkillInstallationModule.ts:958-976`),
not as separate structured fields; there is **no expandable diagnostics view**
(no expansion panel or diagnostics payload).

**Blocking:** §22.1 (conversation experience).

---

## 9. Deviation — `SkillCredentialBindingEntity` / `SkillCredentialModule` not implemented

**Requirement (design §14.1/§20.3):** Store only opaque credential binding IDs in
SQLite (`SkillCredentialBindingEntity` + `SkillCredentialModule`), with the
encrypted value in a separately managed store.

**Implemented:** `SkillCredentialService` stores encrypted values (safeStorage)
in `credentials.json` keyed by `${installationId}:${environmentVariable}`.

**Gap / reason:** No `SkillCredentialBindingEntity` or `SkillCredentialModule`
exists; the encrypted store is a JSON file rather than the specified
encrypted-store + DB-binding split. This is **secure** (no plaintext, no secret
in DB, fail-closed) but is a deviation from the design's persistence
architecture, so migration/audit differs from spec.

**Blocking:** None for security; deviation from design persistence model that
should be confirmed/intentional.

---

## 10. Already-disclosed in the implementing plan (for completeness)

These are acknowledged as deferred in
`docs/plans/2026-08-24-natural-language-skill-installation.md:206-212`:

- **Windows CI matrix** must be validated on an actual Windows runner (authored
  per `build.yml` setup; cannot be executed in a Linux worktree). Concrete for
  §16.4 / §26.3 and NFR-02.
- **Model-driven `skill_install_prepare` E2E** is only covered at the
  enforcement layer by unit/integration tests, not by a FakeOpenAI E2E.
- **npm/URL plugin sources for standalone skill install** are not added
  (routed to existing `PluginInstallService` where applicable).
- Known **aiChat E2E T-05 parallel-run flake** (passes in isolation).

---

## Summary

| # | Task | PRD/Design ref | Status |
|---|------|----------------|--------|
| 1 | Windows shell reliability on chat shell path | §16, NFR-02 | **Partial** — provider layer only, not wired to `run_shell_command` |
| 2 | DB baseline + feature migration | §14.3, DoD | **Missing** — `DB_MIGRATIONS` empty, uses `synchronize` |
| 3 | Plugin/executable service routing | FR-07, §13.3 | **Partial** — classification only, no routing |
| 4 | Catalog-backed dependencies | FR-14, §12 | **Partial** — multi-probe OK, catalog not connected |
| 5 | Secret injection into approved processes | FR-16, §13 | **Partial** — API exists, no execution consumer |
| 6 | Read/execute skill-root capability | FR-13, §6.3/§15.3 | **Partial** — types only, no construction site |
| 7 | `SKILL_INSTALL_PROGRESS` monotonic events | §15.1, §23.2 | **Missing** — declared, never emitted |
| 8 | Install card structured fields + diagnostics | §22.1 | **Partial** — single summary, no expandable diagnostics |
| 9 | Credential persistence model | §14.1/§20.3 | **Deviation** — JSON store instead of DB binding |
| 10 | Windows CI / E2E / npm sources | §16.4/§26 | Deferred (disclosed) |
