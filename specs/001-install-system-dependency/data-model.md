# Data Model: System Dependency Installation

**Phase**: Phase 1 | **Date**: 2026-04-21

---

## Entities

### 1. DependencyCatalogEntry

Static configuration entity (loaded from JSON, not persisted in DB).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| dependency_id | string | yes | Normalized identifier (e.g., `"poppler"`) |
| probe | string | yes | Binary name to probe (e.g., `"pdfinfo"`) |
| description | string | yes | Human-readable description |
| platforms | Record<Platform, PlatformCandidate> | yes | Per-platform install info |

**Platform** = `"darwin"` | `"linux"` | `"win32"`

**PlatformCandidate**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| manager | string | yes | Package manager name (`"brew"`, `"apt"`, `"winget"`) |
| package | string | yes | Package name for that manager |

---

### 2. ResolutionResult

Advisory output from the resolver. Not persisted — returned via IPC.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| dependency_id | string | yes | Matched catalog entry ID |
| missing_binary | string | yes | The binary that was not found |
| confidence | number | yes | 0-1 confidence score |
| reason | string | yes | Human-readable reason for the match |
| platform_candidates | Record<Platform, PlatformCandidate> | yes | Install options per platform |
| requires_manual_review | boolean | yes | True if confidence < threshold (0.8) |

**Validation**: `confidence` must be >= 0 and <= 1. `dependency_id` must exist in local catalog.

---

### 3. InstallRequest

User-initiated install request. Sent via IPC from renderer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| dependency_id | string | yes | Catalog entry to install |
| reason | string | yes | Why the install is needed |
| conversation_id | string | yes | Chat context for audit |
| skill_name | string | yes | Skill that triggered the need |

**Validation**: `dependency_id` must exist in catalog. Current platform must have a candidate.

---

### 4. InstallResult

Typed outcome of an install attempt. Not persisted directly — audit log captures it.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | InstallResultStatus | yes | Outcome enum |
| dependency_id | string | yes | What was installed |
| probe | string | no | Binary that was verified |
| details | string | no | Human-readable outcome description |
| stderr | string | no | Sanitized stderr on failure |

**InstallResultStatus** = `"installed"` | `"already_installed"` | `"permission_denied"` | `"installer_not_found"` | `"unsupported_platform"` | `"path_issue"` | `"installation_failed"`

---

### 5. DependencyInstallAudit (TypeORM Entity)

Persistent audit record in SQLite.

| Column | Type | Required | DB Type |
|--------|------|----------|---------|
| id | number | auto | INTEGER PRIMARY KEY AUTOINCREMENT |
| conversation_id | string | yes | VARCHAR(255) |
| skill_name | string | yes | VARCHAR(255) |
| dependency_id | string | yes | VARCHAR(255) |
| missing_binary | string | yes | VARCHAR(255) |
| suggested_by_ai | boolean | yes | BOOLEAN DEFAULT false |
| user_decision | string | yes | VARCHAR(50) — `"approved"` or `"denied"` |
| installer_backend | string | no | VARCHAR(100) — e.g., `"brew"` |
| package_name | string | no | VARCHAR(255) — e.g., `"poppler"` |
| execution_status | string | no | VARCHAR(50) — InstallResultStatus |
| execution_duration_ms | number | no | INTEGER |
| stderr_sanitized | string | no | TEXT |
| created_at | Date | auto | DATETIME DEFAULT CURRENT_TIMESTAMP |

**Indexes**:
- `idx_audit_conversation` on `conversation_id`
- `idx_audit_dependency` on `dependency_id`
- `idx_audit_created_at` on `created_at`

---

## State Transitions

### Install Flow State Machine

```
SKILL_FAILURE
     │
     ▼
DIAGNOSED (missing_system_tool)
     │
     ▼
RESOLVED (advisory result)
     │
     ├──── confidence < 0.8 ──→ MANUAL_REVIEW_REQUIRED
     │
     ▼ (confidence >= 0.8)
USER_PROMPTED (approve/deny)
     │
     ├──── denied ──→ PERMISSION_DENIED (audited)
     │
     ▼ (approved)
VALIDATED (against catalog)
     │
     ├──── not in catalog ──→ BLOCKED (audited)
     │
     ▼ (in catalog)
INSTALLING
     │
     ├──── installer_not_found ──→ INSTALLER_NOT_FOUND (audited)
     ├──── installation_failed ──→ INSTALLATION_FAILED (audited)
     ├──── success ──→ PROBING
     │                         │
     │                         ├──── found ──→ INSTALLED + RETRY_SKILL
     │                         └──── not found ──→ PATH_ISSUE (audited)
     │
     ▼
RETRY_SKILL (exactly once)
     │
     ├──── success ──→ COMPLETE (result shown in chat)
     └──── failure ──→ RETRY_FAILED (error shown in chat, manual guidance)
```

### Key Invariants
1. `resolve` never produces side effects (no install, no file writes)
2. `install` always requires prior `resolve` + user approval
3. `dependency_id` is always validated against local catalog before command execution
4. Command template parameters come from catalog only — never from AI output
5. Retry happens at most once — failures after retry show manual guidance
6. Every state transition produces an audit log entry (except `RESOLVED` which is advisory)
