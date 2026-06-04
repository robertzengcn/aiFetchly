# Contract: Dependency Install Audit Log

**Type**: Persistence (append-only) | **Direction**: Main process internal

---

## Entity: DependencyInstallAudit

Stored in SQLite via TypeORM.

### Schema

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | number | PK, auto-increment | Row ID |
| conversation_id | string | NOT NULL, indexed | Chat conversation context |
| skill_name | string | NOT NULL | Skill that triggered the install |
| dependency_id | string | NOT NULL, indexed | Catalog dependency ID |
| missing_binary | string | NOT NULL | Binary that was missing |
| suggested_by_ai | boolean | NOT NULL, default false | Whether AI suggested the fix |
| user_decision | string | NOT NULL | "approved" or "denied" |
| installer_backend | string | nullable | Package manager used (e.g., "brew") |
| package_name | string | nullable | Package installed (e.g., "poppler") |
| execution_status | string | nullable | InstallResultStatus value |
| execution_duration_ms | number | nullable | Install command duration |
| stderr_sanitized | string | nullable | Sanitized error output |
| created_at | Date | default CURRENT_TIMESTAMP | Timestamp |

### Indexes

- `idx_audit_conversation` ON (conversation_id)
- `idx_audit_dependency` ON (dependency_id)
- `idx_audit_created_at` ON (created_at)

## IPC Channel

`SYSTEM_DEPENDENCY_GET_AUDIT_LOG`

### Request

```typescript
interface GetAuditLogRequest {
  /** Filter by conversation ID */
  readonly conversation_id?: string;
  /** Filter by dependency ID */
  readonly dependency_id?: string;
  /** Pagination limit */
  readonly limit?: number;
  /** Pagination offset */
  readonly offset?: number;
}
```

### Response

```typescript
interface GetAuditLogResponse {
  readonly status: boolean;
  readonly data: readonly AuditLogEntry[];
  readonly total: number;
}

interface AuditLogEntry {
  readonly id: number;
  readonly conversation_id: string;
  readonly skill_name: string;
  readonly dependency_id: string;
  readonly missing_binary: string;
  readonly suggested_by_ai: boolean;
  readonly user_decision: string;
  readonly installer_backend: string | null;
  readonly package_name: string | null;
  readonly execution_status: string | null;
  readonly execution_duration_ms: number | null;
  readonly stderr_sanitized: string | null;
  readonly created_at: string;
}
```

## Stderr Sanitization Rules

Before storing stderr in audit log:

1. Remove absolute paths: replace `/Users/xxx/...` with `[PATH]`
2. Remove home directory references: replace `$HOME` or `~` with `[HOME]`
3. Remove any strings matching common secret patterns (API keys, tokens)
4. Truncate to 500 characters maximum
5. Remove ANSI escape codes
