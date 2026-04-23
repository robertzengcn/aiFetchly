# Research: System Dependency Installation

**Phase**: Phase 0 | **Date**: 2026-04-21

---

## R1: PATH Refresh After Install (FR-011)

### Decision
Use login shell PATH refresh + utility process restart.

### Rationale
- Electron utility process inherits `process.env` snapshot at fork time
- Homebrew on Apple Silicon installs to `/opt/homebrew/bin` which is NOT in GUI app PATH
- The existing `PythonRuntimeWorkerClient.dispose()` already handles worker restarts gracefully
- The worker is stateless — no accumulated state is lost on restart
- After refresh, `process.env.PATH` in main process is updated, and next `execute()` re-forks with fresh env

### Implementation Strategy
1. After `brew install` succeeds, call `refreshPath()` that spawns a login shell: `zsh -l -c 'echo $PATH'`
2. Update `process.env.PATH` with the result
3. Call `PythonRuntimeWorkerClient.dispose()` to kill old worker
4. Re-probe binary with `spawnSync(probe, ["--version"])` using updated PATH
5. If probe fails, return `path_issue` and suggest app restart

### Alternatives Considered
- **fix-path npm package**: Would work but adds a dependency for a ~10-line function. Inline implementation is sufficient.
- **Read /etc/paths + /etc/paths.d/**: Misses Homebrew paths on Apple Silicon (those come from `.zprofile`).
- **Absolute path resolution**: Could resolve binary to `/opt/homebrew/bin/pdfinfo` directly, but this doesn't fix PATH for other operations. Less robust.
- **app.relaunch()**: Does not re-read system environment variables. Not viable.

---

## R2: Enhanced Diagnostics Pattern Detection (FR-001)

### Decision
Extend `SkillDiagnosticsService.diagnoseStderr()` with a pattern map for known system tool errors, returning structured `dependency_id` and `missing_binary`.

### Rationale
- The existing service already classifies `missing_system_tool` but returns only a generic hint
- Skill manifests already declare system deps with `name`, `probe`, and `install_hint`
- The manifest's `system[]` array provides the authoritative mapping from probe binary to dependency name
- When a `missing_system_tool` error is detected, the manifest's system deps can be cross-referenced to produce the `dependency_id`

### Implementation Strategy
1. Extend `SkillDiagnoseResult` with optional `dependency_id` and `missing_binary` fields
2. When `cause === "missing_system_tool"`, iterate manifest `python.system[]` to find which dep's probe matches the error
3. Add additional stderr patterns for known tools: `PDFInfoNotInstalledError`, `TesseractNotFoundError`, `ffmpeg: command not found`
4. Fall back to manifest's system deps when stderr doesn't match a specific pattern

### Alternatives Considered
- **Separate diagnosis service**: Would add unnecessary indirection. The existing `SkillDiagnosticsService` is the natural place.
- **AI-based classification**: Overkill for a fixed set of known patterns. Regex matching is deterministic and fast.

---

## R3: Dependency Catalog Format and Location (FR-015)

### Decision
Static JSON file at `src/config/dependency-catalog.json`, loaded at runtime.

### Rationale
- JSON is the simplest format that TypeScript can validate at load time
- Ships with the app, no network dependency for v1
- Easy to extend with signed remote updates in future versions
- Separated from code — updating catalog does not require recompilation
- Follows the pattern of existing config files in `src/config/`

### Catalog Schema
```json
{
  "version": 1,
  "dependencies": {
    "poppler": {
      "probe": "pdfinfo",
      "description": "PDF rendering library (provides pdfinfo, pdftotext, pdftoppm)",
      "platforms": {
        "darwin": { "manager": "brew", "package": "poppler" },
        "linux": { "manager": "apt", "package": "poppler-utils" },
        "win32": { "manager": "winget", "package": "GnuWin32.Poppler" }
      }
    }
  }
}
```

### Alternatives Considered
- **TypeScript constant file**: Harder to update without rebuild. Less data-like.
- **SQLite table**: Overkill for ~5 entries. Adds migration complexity.
- **Remote-only catalog**: Would fail offline. Local-first is required.

---

## R4: Installer Command Templates (FR-008)

### Decision
Fixed command templates per platform manager, validated against catalog.

### Rationale
- Security requirement: never execute free-form commands from AI output
- Templates are deterministic: `brew install <catalog-package>` where `<catalog-package>` comes from local JSON
- Each platform has known exit codes and error patterns

### Templates

| Platform | Manager | Command Template | Timeout |
|----------|---------|-----------------|---------|
| darwin | brew | `brew install <package>` | 5 min |
| linux | apt | `sudo apt-get install -y <package>` | 5 min |
| win32 | winget | `winget install --id <package> --accept-source-agreements --accept-package-agreements --silent` | 5 min |

### Pre-checks (before install)
1. Probe binary: `spawnSync(probe, ["--version"])` — if found, return `already_installed`
2. Check manager: `which brew` / `which apt-get` / `winget --version` — if not found, return `installer_not_found`

### Exit Code Handling
- **brew**: exit 0 = success; exit 1 + "already installed" = `already_installed`; else `installation_failed`
- **apt**: exit 0 = success; "already the newest version" = `already_installed`; "password" = `permission_denied`
- **winget**: exit 0 = success; -1978335135 = `already_installed`; -1978335209 = `permission_denied`

### Alternatives Considered
- **Generic shell execution**: Violates FR-008 (no free-form commands). Rejected.
- **Node.js native addon for package management**: Massive over-engineering. No cross-platform solution exists.
- **Docker containers**: Not viable for desktop Electron app. User expects native integration.

---

## R5: User Confirmation Flow (FR-006)

### Decision
Leverage existing `SkillPermissionService` pattern with a new permission category `system_install`.

### Rationale
- The existing permission service already handles approve/deny/session-grant flows
- Skill permissions are checked before execution — same pattern applies to system installs
- The chat UI already has patterns for permission dialogs (from skill execution)
- Reusing the pattern reduces code duplication and maintains UX consistency

### Implementation Strategy
1. Add a new IPC channel `SYSTEM_DEPENDENCY_REQUEST_INSTALL` that sends the recommendation to renderer
2. Renderer shows a dialog with dependency name, reason, platform-specific command
3. User approves → IPC calls back to main process → install executes
4. User denies → result is `permission_denied`, no install attempted

### Alternatives Considered
- **Electron dialog (dialog.showMessageBox)**: Works but doesn't integrate with chat flow. Users expect inline interaction.
- **Auto-approve with settings toggle**: Violates FR-006. All installs require explicit approval.

---

## R6: Audit Logging Storage (FR-013)

### Decision
SQLite via TypeORM entity, following the three-layer Model/Module/IPC architecture.

### Rationale
- All other app data is in SQLite — consistency
- TypeORM entity provides typed access and migration support
- Model layer handles queries, Module layer handles business logic
- Audit data is append-only, no complex queries needed

### Schema
```typescript
DependencyInstallAudit {
  id: number (auto-increment)
  conversation_id: string
  skill_name: string
  dependency_id: string
  missing_binary: string
  suggested_by_ai: boolean
  user_decision: "approved" | "denied"
  installer_backend: string
  package_name: string
  execution_status: InstallResultStatus
  execution_duration_ms: number
  stderr_sanitized: string
  created_at: Date
}
```

### Alternatives Considered
- **File-based logging**: No structured queries. Harder to surface in UI.
- **Remote-only logging**: Privacy concern. User may not want install data sent to server.
- **In-memory logging only**: Lost on app restart. Not acceptable for audit.

---

## R7: Skill Retry After Install (FR-010)

### Decision
Automatic single retry within `StreamEventProcessor` after successful install.

### Rationale
- The `StreamEventProcessor` already manages the skill execution lifecycle in the chat stream
- It handles tool call results and can trigger follow-up actions
- After install + probe verification, it can re-invoke the original `SkillExecutor.execute()` call
- Single retry prevents infinite loops — if retry fails, the error is returned as-is

### Implementation Strategy
1. `StreamEventProcessor` catches `missing_system_tool` diagnosis from skill failure
2. Triggers resolve → user approval → install flow
3. On `installed` result, re-probes binary
4. If probe succeeds, calls `SkillExecutor.execute()` with original args
5. Retry result replaces the original failure in chat

### Alternatives Considered
- **Manual retry (user clicks "retry")**: Degrades UX. The spec requires automatic retry.
- **Multiple retries**: Spec says exactly one retry. Repeated failures → manual guidance.
