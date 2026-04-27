# Research: Shell Execution Skill

**Feature**: 001-shell-execution-skill
**Date**: 2026-04-24

## Decision 1: Skill Registration Pattern

**Decision**: Register `shell_execute` in `BUILT_IN_SKILLS` array in `src/config/skillsRegistry.ts` following the existing `SkillDefinition` interface.

**Rationale**: All built-in skills follow this pattern. The registry uses a Map with name as key, merged with MCP tools. Using `tier: "main"` ensures execution in the main process where `child_process.spawn` is available.

**Alternatives considered**:
- Dynamic registration via `registerSkill()` — reserved for user/marketplace skills, not built-in
- Separate registry file — would break the existing lookup pattern used by `SkillRegistry.isRegistered()`

## Decision 2: Permission Category Extension

**Decision**: Add `"shell"` to the `SkillPermissionCategory` union type in `src/entityTypes/skillTypes.ts`.

**Rationale**: Existing categories (`pure`, `network`, `filesystem`, `automation`) don't capture shell execution risk. Shell commands can combine filesystem access, network calls, and system modifications. A dedicated `shell` category enables:
- Always-prompt policy regardless of stored permissions
- Dedicated consent UX showing command preview
- Future session-scoped grants without affecting other categories

**Alternatives considered**:
- Reuse `"automation"` category — too broad, shell needs stricter consent policy
- Reuse `"filesystem"` category — shell commands can do much more than file operations

## Decision 3: Execution Engine

**Decision**: Use Node.js built-in `child_process.spawn` directly, no third-party libraries.

**Rationale**: Full control over interpreter selection and argv boundaries. Lower attack surface. Fewer dependency risks. The existing `SkillEnvironmentManager.ts` already demonstrates this pattern with `runProcess`-style flow.

**Alternatives considered**:
- `execa` — adds dependency, not needed for controlled execution
- `cross-spawn` — only needed for Windows quirks, can handle natively
- `shelljs` — synchronous API, not suitable for timeout/process-tree kill

## Decision 4: Process-Tree Kill Strategy

**Decision**: Use platform-specific process-tree termination.

**Rationale**: Killing only the immediate child leaves orphaned grandchild processes. On POSIX, use `process.kill(-pid)` with process groups. On Windows, use `taskkill /T /F /PID`.

**Alternatives considered**:
- Kill only child PID — leaves orphan processes consuming resources
- `tree-kill` npm package — adds dependency for trivial functionality
- Send SIGTERM then SIGKILL — more complex, tree kill handles this

## Decision 5: Path Safety Integration

**Decision**: Reuse existing `FilePathGuard` from `src/service/FilePathGuard.ts` with workspace roots from `getDefaultWorkspaceRoots()`.

**Rationale**: The FilePathGuard already implements: null-byte rejection, path normalization, symlink resolution, workspace-root jail, and deny-list matching. Using the same guard ensures consistent security posture across file and shell tools.

**Alternatives considered**:
- Custom path validation in ShellToolService — duplicate logic, maintenance burden
- New guard class — unnecessary when FilePathGuard already handles all cases

## Decision 6: Audit Logging Pattern

**Decision**: Follow the existing `SystemDependencyAuditLogger` pattern with a new service `ShellAuditLogger` that stores structured audit entries via a dedicated Model.

**Rationale**: The codebase already uses append-only audit logs with TypeORM entities. `DependencyInstallAuditEntity` provides a proven pattern: conversation ID, skill name, execution status, duration, sanitized output. Shell audit should follow the same structure with shell-specific fields.

**Alternatives considered**:
- Console-only logging — not persistent, can't be reviewed later
- Piggyback on `ToolExecutionService` — doesn't have shell-specific fields (redacted command, shell type, timeout)

## Decision 7: Input Validation Library

**Decision**: Use `zod` for input validation at the service boundary.

**Rationale**: Already listed as a dependency in CLAUDE.md for the 001-ai-file-tools branch. Provides runtime validation with clear error messages. Follows the technology advice document recommendation.

**Alternatives considered**:
- Manual validation — verbose, error-prone, no schema reuse
- TypeScript type guards — no runtime validation

## Decision 8: Environment Scrubbing Strategy

**Decision**: Use allowlist approach — keep only essential environment keys, remove all secret-bearing patterns.

**Rationale**: Blacklist approach risks missing new secret variable patterns. The existing `SecurityUtils` and `SystemDependencyAuditLogger` show the codebase already uses regex-based secret detection. An allowlist is safer: start with `PATH`, `HOME`, `USER`, `LANG`, `TERM` and expand conservatively.

**Alternatives considered**:
- Blacklist approach (remove `*TOKEN*`, `*KEY*`, `*SECRET*`) — risks missing patterns
- Pass full environment — exposes all user secrets to child process

## Decision 9: Rate Limiting

**Decision**: Add dedicated rate-limit bucket for shell operations (max 2 concurrent, reasonable per-minute limit).

**Rationale**: Prevents accidental command storms from repeated tool-call loops. The file tool system already uses rate limiting buckets. Shell execution should have even stricter limits due to higher resource impact.

**Alternatives considered**:
- No rate limiting — risk of command storms from AI loops
- Very strict (1 concurrent) — too limiting for legitimate use cases

## Decision 10: Output Size Caps

**Decision**: Cap stdout/stderr at 256KB each with truncation flags.

**Rationale**: Matches the technology advice recommendation. Large outputs can crash the IPC channel between main and renderer process. Truncation flags let the user know content was cut off.

**Alternatives considered**:
- No caps — risk of memory issues and IPC channel crashes
- Smaller caps (64KB) — might truncate useful output
- Larger caps (1MB) — matches file tool read limit but excessive for command output
