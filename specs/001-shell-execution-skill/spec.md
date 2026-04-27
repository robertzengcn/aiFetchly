# Feature Specification: Shell Execution Skill

**Feature Branch**: `001-shell-execution-skill`
**Created**: 2026-04-24
**Status**: Draft
**Input**: User description: "A built-in skill that allows AI chat to execute user-requested local shell commands safely, with explicit user consent, security controls (denylist, timeout, output limits, environment scrubbing), workspace-restricted working directories, and structured audit logging."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Execute a Local Command via AI Chat (Priority: P1)

A user asks the AI chat to run a local shell command (e.g., "list files in this folder", "check git status", "run npm test"). The AI identifies the intent to execute a command, presents the exact command and working directory to the user for approval, and upon consent, executes the command. The user receives the command output (stdout/stderr), exit code, and execution duration in the chat.

**Why this priority**: This is the core value proposition — the fundamental capability that all other stories build upon. Without command execution, no other feature matters.

**Independent Test**: Can be fully tested by sending any natural language command request through AI chat and verifying that the command executes, returns structured output, and the result is displayed to the user.

**Acceptance Scenarios**:

1. **Given** the user types "list files in this folder" in AI chat, **When** the AI processes the request, **Then** the user sees a permission prompt showing the exact command (e.g., `ls -la`) and the current working directory before execution begins
2. **Given** the user approves the command, **When** the command completes, **Then** the user sees the command output, exit code, and how long the command took
3. **Given** the user denies the command, **When** consent is refused, **Then** the command is NOT executed and the user sees a denial confirmation in chat
4. **Given** the command produces output, **When** output exceeds the size limit, **Then** the user sees truncated output with a clear indicator that content was cut off

---

### User Story 2 - Protection from Destructive Commands (Priority: P2)

A user (or AI suggestion) attempts to run a clearly destructive command (e.g., `rm -rf /`, `format C:`, `dd if=/dev/zero`). The system blocks the command before execution with a clear explanation of why it was blocked, regardless of user consent.

**Why this priority**: Security is critical for user trust. Users must be protected from accidental or unintentional destructive operations before any command runs.

**Independent Test**: Can be fully tested by attempting to run known destructive commands and verifying they are blocked with appropriate error messages.

**Acceptance Scenarios**:

1. **Given** a destructive command pattern is detected (e.g., `rm -rf /`), **When** the system performs pre-execution checks, **Then** the command is blocked and the user sees a clear explanation of why it was blocked
2. **Given** a command matches the denylist, **When** the user attempts to approve it, **Then** execution is still prevented and the denial reason is shown
3. **Given** a command does not match the denylist, **When** the system performs checks, **Then** execution proceeds to the normal consent flow

---

### User Story 3 - Workspace-Restricted Command Execution (Priority: P3)

A user or AI attempts to run a command with a working directory outside the allowed workspace roots. The system rejects the command and informs the user that the directory is not permitted.

**Why this priority**: Prevents unauthorized file system access outside the user's workspace, protecting system integrity.

**Independent Test**: Can be fully tested by attempting to set the working directory to a system path (e.g., `/etc`, `C:\Windows`) and verifying rejection.

**Acceptance Scenarios**:

1. **Given** the command specifies a working directory outside allowed workspace roots, **When** the system validates the path, **Then** execution is rejected with a message indicating the directory is not within the workspace
2. **Given** the command specifies a working directory inside allowed workspace roots, **When** the system validates the path, **Then** execution proceeds to the consent flow
3. **Given** no working directory is specified, **When** the command runs, **Then** it defaults to a workspace-allowed directory

---

### User Story 4 - Automatic Timeout on Long-Running Commands (Priority: P4)

A user runs a command that hangs or takes excessively long (e.g., a server start command, a network request without timeout). The system enforces a timeout, terminates the process, and returns a clear timeout indication to the user.

**Why this priority**: Prevents resource exhaustion and ensures the AI chat remains responsive. Without timeout enforcement, a hung command could block the entire skill system.

**Independent Test**: Can be fully tested by running a command that sleeps or loops indefinitely and verifying it is terminated within the expected timeout period.

**Acceptance Scenarios**:

1. **Given** a command runs longer than the specified timeout (default 60 seconds), **When** the timeout is reached, **Then** the process and its child processes are terminated and the user receives a timeout indication
2. **Given** the user specifies a custom timeout within allowed limits (up to 10 minutes), **When** the command runs, **Then** the custom timeout is respected
3. **Given** the user specifies a timeout exceeding the maximum allowed, **When** the command is prepared, **Then** the timeout is capped at the maximum (10 minutes)

---

### User Story 5 - Cross-Platform Shell Support (Priority: P5)

A user on Windows asks to run a command, and the system automatically uses PowerShell. A user on Linux/macOS asks to run a command, and the system uses Bash. The user can optionally override the shell selection.

**Why this priority**: Ensures the feature works across all supported platforms without requiring platform-specific knowledge from the user.

**Independent Test**: Can be fully tested by running the same command on different platforms and verifying the correct shell is selected automatically, and by explicitly overriding the shell choice.

**Acceptance Scenarios**:

1. **Given** the application is running on Linux/macOS, **When** the user runs a command with default shell selection, **Then** the system uses Bash as the interpreter
2. **Given** the application is running on Windows, **When** the user runs a command with default shell selection, **Then** the system uses PowerShell as the interpreter
3. **Given** the user explicitly selects a specific shell (bash, powershell, or cmd), **When** the command is prepared, **Then** the system uses the user-selected interpreter

---

### User Story 6 - Audit Trail for Shell Executions (Priority: P6)

After shell commands have been executed, a developer or security-conscious user can review an audit log showing what commands were run, when, whether they succeeded, and how long they took. Sensitive tokens in command text are redacted.

**Why this priority**: Provides accountability and debugging capability. Important for security review but not blocking for core functionality.

**Independent Test**: Can be fully tested by executing several commands and then reviewing the audit log to verify all executions are recorded with correct metadata and redacted sensitive content.

**Acceptance Scenarios**:

1. **Given** a shell command has been executed, **When** the audit log is reviewed, **Then** the log entry includes the tool name, redacted command, working directory, shell type, success status, exit code, timeout status, duration, and timestamp
2. **Given** a command contains sensitive tokens (passwords, API keys), **When** the audit log is written, **Then** sensitive values are replaced with redaction markers

---

### Edge Cases

- What happens when a command produces no output (empty stdout and stderr)?
- How does the system handle commands that require user input (e.g., `sudo`, `read -p`)? (stdin is disabled — command will fail or exit immediately)
- What happens when the specified working directory does not exist?
- How does the system handle binary output (non-text stdout)?
- What happens when multiple shell execution requests arrive simultaneously?
- How does the system behave when the environment has no shell available?
- What happens when a command writes excessively to stderr but not stdout?
- What if the user's environment variables contain secrets that would be inherited?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a built-in skill for executing local shell commands through AI chat
- **FR-002**: System MUST present a permission prompt to the user showing the exact command text and working directory before executing any shell command
- **FR-003**: System MUST require explicit user consent (allow once or deny) before executing a command; v1 MUST NOT support permanent global grant for all shell commands
- **FR-004**: System MUST support automatic shell selection based on the operating system (Bash for Linux/macOS, PowerShell for Windows)
- **FR-005**: System MUST allow the user to override the shell selection with an explicit choice
- **FR-006**: System MUST enforce a default timeout of 60 seconds on all commands, terminating the process tree when the timeout is reached
- **FR-007**: System MUST allow custom timeouts up to a maximum of 10 minutes (600 seconds)
- **FR-008**: System MUST truncate command output (stdout and stderr) when it exceeds size limits, with clear truncation indicators
- **FR-009**: System MUST reject commands matching destructive patterns in a denylist, regardless of user consent
- **FR-010**: System MUST validate that the working directory is within allowed workspace roots and reject commands with unauthorized paths
- **FR-011**: System MUST return a structured result for every command execution containing: success status, exit code, stdout, stderr, duration, truncation flags, and timeout indicator
- **FR-012**: System MUST disable interactive stdin to prevent commands from waiting on user input (preventing hangs)
- **FR-013**: System MUST scrub the execution environment of common secret variables before spawning a command
- **FR-014**: System MUST return structured error responses rather than raw crashes to the AI chat stream
- **FR-015**: System MUST log each shell execution with redacted command text, working directory, shell type, success status, exit code, timeout status, duration, and timestamp
- **FR-016**: System MUST redact sensitive tokens (passwords, API keys, tokens) from audit log entries
- **FR-017**: System MUST NOT persist any unredacted command text in logs
- **FR-018**: System MUST NOT modify existing skill execution, MCP tool, or Python skill environment management behavior

### Key Entities

- **Shell Execution Request**: Represents a command execution attempt, containing the command text, optional working directory, shell preference, and timeout setting
- **Shell Execution Result**: Represents the outcome of a command execution, containing success status, exit code, stdout, stderr, duration, truncation indicators, and timeout flag
- **Shell Permission Consent**: Represents the user's decision on a shell execution request, supporting allow-once and deny actions
- **Shell Audit Log Entry**: Represents a recorded shell execution for auditing purposes, containing redacted command, metadata, and timestamps

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can request and receive results for any standard shell command through AI chat within 5 seconds of approving execution (excluding command runtime)
- **SC-002**: 100% of shell execution attempts present a permission prompt showing the exact command before execution
- **SC-003**: 100% of commands matching destructive patterns are blocked before execution, regardless of user consent
- **SC-004**: All commands running beyond their timeout are terminated within 1 second of the timeout threshold
- **SC-005**: Users can execute commands on Linux, macOS, and Windows without manual shell configuration
- **SC-006**: 100% of executed commands produce a structured result, never causing unhandled errors in the AI chat stream
- **SC-007**: All audit log entries have sensitive tokens redacted — zero unredacted secrets persisted in logs
- **SC-008**: Shell skill orchestration overhead (permission prompt, validation, process setup) is under 100 milliseconds, excluding actual command runtime
- **SC-009**: Existing built-in skills and MCP tools continue to operate with no regressions after shell skill integration

## Assumptions

- The application already has a skill registry, skill executor, and permission prompt system that can be extended
- The application already has a path-guard mechanism for validating workspace paths
- Users run commands in a context where a shell interpreter (Bash or PowerShell) is available
- v1 does not include interactive terminal sessions (stdin is disabled)
- v1 does not include background job orchestration UI
- v1 does not include incremental stdout/stderr streaming (full output returned after command completes)
- v1 ships with a single `shell_execute` skill rather than separate per-shell aliases
- v1 does not support persistent global permission grants for shell commands (only per-execution consent)
- Session-scoped "allow all shell commands" is deferred to a future version
- The denylist covers common destructive patterns and can be extended in future versions
