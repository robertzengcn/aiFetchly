# Shell Execute Tool Contract

**Feature**: 001-shell-execution-skill
**Date**: 2026-04-24

## Tool Definition

```json
{
  "name": "shell_execute",
  "description": "Execute a local shell command with explicit user confirmation and safety controls. Supports Bash (Linux/macOS) and PowerShell (Windows) with optional shell override.",
  "parameters": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "Command text to execute. The exact command will be shown to the user for approval before execution."
      },
      "cwd": {
        "type": "string",
        "description": "Optional working directory. Must be within allowed workspace roots. Defaults to workspace root if not specified."
      },
      "shell": {
        "type": "string",
        "enum": ["auto", "bash", "powershell", "cmd"],
        "description": "Shell interpreter to use. 'auto' selects Bash on Linux/macOS and PowerShell on Windows.",
        "default": "auto"
      },
      "timeout_ms": {
        "type": "number",
        "description": "Maximum execution time in milliseconds. Default 60000 (60s), max 600000 (10min).",
        "default": 60000
      }
    },
    "required": ["command"]
  }
}
```

## Input Validation Schema

```
command:
  - type: string
  - required: true
  - minLength: 1
  - maxLength: 10000

cwd:
  - type: string
  - required: false
  - must resolve under workspace roots (FilePathGuard validation)

shell:
  - type: enum ["auto", "bash", "powershell", "cmd"]
  - required: false
  - default: "auto"

timeout_ms:
  - type: number (integer)
  - required: false
  - default: 60000
  - minimum: 1000
  - maximum: 600000
```

## Success Response

```json
{
  "success": true,
  "exit_code": 0,
  "stdout": "file1.txt\nfile2.txt\n",
  "stderr": "",
  "duration_ms": 245,
  "stdout_truncated": false,
  "stderr_truncated": false,
  "timed_out": false
}
```

## Error Responses

### Command Failed (non-zero exit)

```json
{
  "success": false,
  "exit_code": 1,
  "stdout": "",
  "stderr": "command not found: foo",
  "duration_ms": 12,
  "stdout_truncated": false,
  "stderr_truncated": false,
  "timed_out": false
}
```

### Timeout

```json
{
  "success": false,
  "exit_code": null,
  "stdout": "partial output...",
  "stderr": "",
  "duration_ms": 60000,
  "stdout_truncated": true,
  "stderr_truncated": false,
  "timed_out": true
}
```

### Denylist Block

```json
{
  "success": false,
  "error": "Command blocked by safety policy: destructive pattern detected",
  "exit_code": null,
  "stdout": "",
  "stderr": "",
  "duration_ms": 0,
  "stdout_truncated": false,
  "stderr_truncated": false,
  "timed_out": false
}
```

### Workspace Path Rejection

```json
{
  "success": false,
  "error": "Working directory '/etc' is outside allowed workspace roots",
  "exit_code": null,
  "stdout": "",
  "stderr": "",
  "duration_ms": 0,
  "stdout_truncated": false,
  "stderr_truncated": false,
  "timed_out": false
}
```

### User Deny

```json
{
  "success": false,
  "error": "User denied command execution",
  "exit_code": null,
  "stdout": "",
  "stderr": "",
  "duration_ms": 0,
  "stdout_truncated": false,
  "stderr_truncated": false,
  "timed_out": false
}
```

## Permission Prompt Payload

When the system requires user consent, it sends this data to the UI:

```json
{
  "type": "permission_prompt",
  "toolCallId": "call_abc123",
  "skillName": "shell_execute",
  "permissionCategory": "shell",
  "details": {
    "command": "ls -la /home/user/project",
    "cwd": "/home/user/project",
    "shell": "bash",
    "timeout_ms": 60000
  }
}
```

## IPC Channels

### Resume after permission grant

**Channel**: `AI_CHAT_RESUME_TOOL_AFTER_PERMISSION`

**Payload**:
```json
{
  "toolCallId": "call_abc123",
  "conversationId": "conv_xyz",
  "decision": "allow_once",
  "args": {
    "command": "ls -la",
    "cwd": "/home/user/project",
    "shell": "bash",
    "timeout_ms": 60000
  }
}
```
