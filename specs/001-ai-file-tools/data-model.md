# Data Model: AI File Tools Integration

**Branch**: `001-ai-file-tools` | **Date**: 2026-04-22

## Overview

The file tools feature introduces no new database entities. Tool calls and results are persisted through the existing `ToolExecutionService`. This document defines the TypeScript interfaces and runtime data structures.

## Key Types

### FilePathGuard Configuration

```typescript
interface WorkspaceRootConfig {
  readonly roots: readonly string[];
  readonly denyPatterns: readonly string[];
}

interface PathValidationResult {
  readonly safe: boolean;
  readonly resolvedPath: string;
  readonly error?: string;
}
```

### Tool Parameter Schemas

```typescript
// file_read parameters
interface FileReadParams {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
  readonly encoding?: string; // default: "utf-8"
}

// file_write parameters
interface FileWriteParams {
  readonly path: string;
  readonly content: string;
  readonly mode?: "create" | "overwrite"; // default: "create"
}

// file_edit parameters
interface FileEditParams {
  readonly path: string;
  readonly old_string: string;
  readonly new_string: string;
  readonly replace_all?: boolean; // default: false
}

// glob_files parameters
interface GlobFilesParams {
  readonly pattern: string;
  readonly cwd?: string;
  readonly ignore?: readonly string[];
  readonly head_limit?: number;
}

// grep_files parameters
interface GrepFilesParams {
  readonly pattern: string;
  readonly path?: string;
  readonly glob?: string;
  readonly output_mode?: "content" | "files_with_matches" | "count";
  readonly context_before?: number; // -B
  readonly context_after?: number;  // -A
  readonly case_insensitive?: boolean;
  readonly head_limit?: number;
}
```

### Tool Result Schemas

```typescript
// Shared result envelope
interface FileToolResult {
  readonly success: boolean;
  readonly error?: string;
}

// file_read result
interface FileReadResult extends FileToolResult {
  readonly path: string;
  readonly content?: string;
  readonly isBinary?: boolean;
  readonly binaryMetadata?: {
    readonly size: number;
    readonly mimeType?: string;
  };
  readonly truncated: boolean;
  readonly totalLines?: number;
  readonly linesShown?: number;
}

// file_write result
interface FileWriteResult extends FileToolResult {
  readonly path: string;
  readonly bytesWritten: number;
  readonly mode: "created" | "overwritten";
}

// file_edit result
interface FileEditResult extends FileToolResult {
  readonly path: string;
  readonly replacements: number;
  readonly diff?: string; // optional unified diff summary
}

// glob_files result
interface GlobFilesResult extends FileToolResult {
  readonly matches: readonly string[];
  readonly total: number;
  readonly truncated: boolean;
}

// grep_files result (content mode)
interface GrepContentMatch {
  readonly file: string;
  readonly line: number;
  readonly content: string;
  readonly contextBefore?: readonly string[];
  readonly contextAfter?: readonly string[];
}

// grep_files result (files_with_matches mode)
// Uses matches as file paths

// grep_files result (count mode)
interface GrepCountEntry {
  readonly file: string;
  readonly count: number;
}

// grep_files result envelope
interface GrepFilesResult extends FileToolResult {
  readonly outputMode: "content" | "files_with_matches" | "count";
  readonly matches: readonly GrepContentMatch[] | readonly string[] | readonly GrepCountEntry[];
  readonly total: number;
  readonly truncated: boolean;
}
```

### Deny List Configuration

```typescript
interface DenyListConfig {
  readonly patterns: readonly string[];
  readonly description: string;
}

// Default deny list entries
const DEFAULT_DENY_LIST: readonly DenyListConfig[] = [
  { patterns: [".git/**"], description: "Version control internals" },
  { patterns: ["**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx"], description: "Cryptographic keys" },
  { patterns: ["**/.env", "**/.env.*"], description: "Environment variable files" },
  { patterns: ["**/credentials*", "**/secrets*"], description: "Credential and secret files" },
  { patterns: ["**/node_modules/**"], description: "Package dependencies" },
];
```

### Rate Limit Configuration

```typescript
interface FileToolRateLimits {
  readonly fileRead: RateLimitConfig;
  readonly fileSearch: RateLimitConfig;
  readonly fileWrite: RateLimitConfig;
}

// Values:
// fileRead:    { maxPerMinute: 30, maxConcurrent: 5, cooldownMs: 200 }
// fileSearch:  { maxPerMinute: 20, maxConcurrent: 3, cooldownMs: 500 }
// fileWrite:   { maxPerMinute: 10, maxConcurrent: 1, cooldownMs: 1000 }
```

## Entity Relationships

```
WorkspaceRootConfig
  └── used by FilePathGuard
        └── called by FileToolService
              └── called by ToolExecutor (dispatch)
                    └── called by SkillExecutor (permission check)
                          └── called by StreamEventProcessor (orchestration)
                                └── triggered by AI tool call
```

## State Transitions

### Tool Execution Flow

```
IDLE → PARAMETERS_VALIDATED → PATH_VALIDATED → PERMISSION_CHECKED → EXECUTING → COMPLETED
                                  │                    │
                                  └── REJECTED         └── DEFERRED (awaiting user prompt)
                                                          │
                                                          └── RESUMED → EXECUTING → COMPLETED
```

### Permission States

```
UNKNOWN → needsPrompt=true → USER_APPROVED → allowed=true → execute
                                │
                         USER_DENIED → allowed=false → return error
```

## No Database Changes

This feature requires **no new TypeORM entities, no migrations, and no schema changes**. All state is:
- **Runtime**: Tool execution in memory, managed by StreamEventProcessor
- **Persistent**: Tool calls/results saved via existing ToolExecutionService (uses existing AIChatMessage entity)
- **Configuration**: Workspace roots and deny list loaded from app config at startup
