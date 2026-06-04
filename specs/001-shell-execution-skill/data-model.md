# Data Model: Shell Execution Skill

**Feature**: 001-shell-execution-skill
**Date**: 2026-04-24

## Entities

### ShellExecutionRequest

Represents an incoming shell command execution request from AI chat.

| Field         | Type                        | Required | Default   | Description                                      |
|---------------|-----------------------------|----------|-----------|--------------------------------------------------|
| command       | string                      | yes      | —         | Command text to execute (max 10000 chars)        |
| cwd           | string                      | no       | workspace | Working directory under workspace roots          |
| shell         | "auto" \| "bash" \| "powershell" \| "cmd" | no | "auto" | Shell interpreter to use                         |
| timeout_ms    | number                      | no       | 60000     | Timeout in ms, max 600000                        |

**Validation rules**:
- `command` must be non-empty string, max 10000 characters
- `cwd` must resolve under allowed workspace roots (validated by FilePathGuard)
- `timeout_ms` must be positive integer, clamped to [1000, 600000]
- `shell` must be one of the enum values

### ShellExecutionResult

Represents the structured outcome of a shell command execution.

| Field              | Type            | Required | Description                                      |
|--------------------|-----------------|----------|--------------------------------------------------|
| success            | boolean         | yes      | Whether the command exited with code 0            |
| exit_code          | number \| null  | yes      | Process exit code, null if timed out or failed to spawn |
| stdout             | string          | yes      | Captured standard output, possibly truncated      |
| stderr             | string          | yes      | Captured standard error, possibly truncated       |
| duration_ms        | number          | yes      | Execution wall-clock time in milliseconds         |
| stdout_truncated   | boolean         | yes      | Whether stdout was truncated at size cap          |
| stderr_truncated   | boolean         | yes      | Whether stderr was truncated at size cap          |
| timed_out          | boolean         | yes      | Whether the command was killed due to timeout     |

**State transitions**:
- Request received → Validating → Pre-check (denylist, cwd) → Executing → Collecting output → Complete
- At any pre-execution stage: can transition to Rejected with structured error
- During execution: can transition to TimedOut

### ShellPermissionConsent

Represents the user's consent decision for a shell execution request.

| Field        | Type                                          | Required | Description                                  |
|--------------|-----------------------------------------------|----------|----------------------------------------------|
| toolCallId   | string                                        | yes      | Unique tool call ID from AI stream           |
| decision     | "allow_once" \| "deny"                        | yes      | User's consent decision                      |
| command      | string                                        | yes       | Exact command text shown to user             |
| cwd          | string                                        | yes       | Working directory shown to user              |

**Validation rules**:
- `decision` must be one of the enum values
- No persistent storage for `allow_once` — one-time grant only

### ShellAuditLogEntry

Represents a persisted audit record of a shell execution.

| Field              | Type            | Required | Description                                      |
|--------------------|-----------------|----------|--------------------------------------------------|
| id                 | number (auto)   | yes      | Auto-incremented primary key                     |
| conversationId     | string          | yes      | AI chat conversation ID                          |
| toolCallId         | string          | yes      | Tool call ID for correlation                     |
| commandRedacted    | string          | yes      | Command text with sensitive tokens redacted      |
| cwd                | string          | yes      | Working directory used                           |
| shell              | string          | yes      | Shell interpreter used                           |
| success            | boolean         | yes      | Whether command succeeded                        |
| exitCode           | number \| null  | yes      | Process exit code                                |
| timedOut           | boolean         | yes      | Whether timeout was reached                      |
| durationMs         | number          | yes      | Execution duration in ms                         |
| createdAt          | Date            | yes      | Timestamp of execution                           |

**Redaction rules applied to `commandRedacted`**:
- API key patterns (sk-*, ghp_*, AKIA*)
- Password assignments (password=*, --password=*)
- Token assignments (token=*, --token=*, Bearer *)
- URLs with embedded credentials (user:pass@host)
- Environment variable assignments for secrets

## Relationships

```
ShellExecutionRequest
    → validated by FilePathGuard (cwd validation)
    → checked against denylist (shellToolConfig)
    → requires ShellPermissionConsent (user approval)
    → produces ShellExecutionResult
    → recorded as ShellAuditLogEntry
```

## TypeORM Entity

The `ShellAuditLogEntry` will be persisted as a TypeORM entity extending `AuditableEntity`, following the pattern established by `DependencyInstallAuditEntity`.
