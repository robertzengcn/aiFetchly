# Tool Contracts: AI File Tools

**Branch**: `001-ai-file-tools` | **Date**: 2026-04-22

## Shared Conventions

- All tools return `{ success: boolean, error?: string, ...toolSpecificFields }`
- All `path` parameters are relative to a configured workspace root
- All tools enforce workspace jail, deny list, and size limits via `FilePathGuard`
- Write/edit tools require permission confirmation (defer/resume flow)

---

## file_read

### Description
Read file contents with line numbers. Supports offset/limit for partial reads. Detects binary files and returns metadata instead of raw content.

### Parameters

| Name      | Type   | Required | Default  | Description                          |
|-----------|--------|----------|----------|--------------------------------------|
| path      | string | yes      | -        | File path relative to workspace root |
| offset    | number | no       | 1        | Starting line number (1-based)       |
| limit     | number | no       | null     | Max lines to return (null = all)      |
| encoding  | string | no       | "utf-8"  | File encoding                        |

### Result (text file)

```json
{
  "success": true,
  "path": "src/config/app.ts",
  "content": "1: import { app } from 'electron'\n2: ...\n",
  "truncated": false,
  "totalLines": 150,
  "linesShown": 150
}
```

### Result (binary file)

```json
{
  "success": true,
  "path": "assets/logo.png",
  "isBinary": true,
  "binaryMetadata": {
    "size": 24576,
    "mimeType": "image/png"
  },
  "truncated": false
}
```

### Error Responses

```json
{ "success": false, "error": "File not found: nonexistent.ts" }
{ "success": false, "error": "Path outside allowed workspace: ../../etc/passwd" }
{ "success": false, "error": "Access denied by security policy: .git/config" }
```

---

## file_write

### Description
Create a new file or overwrite an existing file atomically. Requires user permission confirmation.

### Parameters

| Name    | Type   | Required | Default   | Description                                |
|---------|--------|----------|-----------|--------------------------------------------|
| path    | string | yes      | -         | File path relative to workspace root       |
| content | string | yes      | -         | File content to write                      |
| mode    | string | no       | "create"  | "create" (fail if exists) or "overwrite"   |

### Result

```json
{
  "success": true,
  "path": "src/utils/newHelper.ts",
  "bytesWritten": 256,
  "mode": "created"
}
```

### Error Responses

```json
{ "success": false, "error": "File already exists: existing.ts (use mode 'overwrite' to replace)" }
{ "success": false, "error": "Path outside allowed workspace: /tmp/evil" }
{ "success": false, "error": "Permission denied by user" }
```

---

## file_edit

### Description
Perform exact string match replacement in a file. Default mode requires exactly one match. Requires user permission confirmation.

### Parameters

| Name        | Type    | Required | Default | Description                                |
|-------------|---------|----------|---------|--------------------------------------------|
| path        | string  | yes      | -       | File path relative to workspace root       |
| old_string  | string  | yes      | -       | Exact text to find                         |
| new_string  | string  | yes      | -       | Replacement text                           |
| replace_all | boolean | no       | false   | If true, replace all occurrences           |

### Result

```json
{
  "success": true,
  "path": "src/config/app.ts",
  "replacements": 1,
  "diff": "- old line\n+ new line\n"
}
```

### Error Responses

```json
{ "success": false, "error": "No match found for old_string in file" }
{ "success": false, "error": "Multiple matches (3) found. Use replace_all=true to replace all occurrences." }
{ "success": false, "error": "Path outside allowed workspace" }
{ "success": false, "error": "Permission denied by user" }
```

---

## glob_files

### Description
Find files matching a glob pattern. Returns matching paths within allowed workspace roots.

### Parameters

| Name      | Type     | Required | Default | Description                                  |
|-----------|----------|----------|---------|----------------------------------------------|
| pattern   | string   | yes      | -       | Glob pattern (e.g., "**/*.ts", "src/**/*.vue") |
| cwd       | string   | no       | null    | Base directory for pattern (default: root)    |
| ignore    | string[] | no       | null    | Additional ignore patterns                     |
| head_limit | number  | no       | 100     | Max results to return                          |

### Result

```json
{
  "success": true,
  "matches": [
    "src/config/app.ts",
    "src/config/database.ts",
    "src/config/settings.ts"
  ],
  "total": 3,
  "truncated": false
}
```

### Result (truncated)

```json
{
  "success": true,
  "matches": ["file1.ts", "file2.ts", "... (98 more)"],
  "total": 100,
  "truncated": true
}
```

---

## grep_files

### Description
Search file contents by regular expression. Supports multiple output modes, context lines, and case sensitivity.

### Parameters

| Name             | Type    | Required | Default             | Description                                |
|------------------|---------|----------|---------------------|--------------------------------------------|
| pattern          | string  | yes      | -                   | Regex pattern to search for                |
| path             | string  | no       | null                | Directory or file to search (default: root)|
| glob             | string  | no       | null                | File pattern filter (e.g., "*.ts")         |
| output_mode      | string  | no       | "content"           | "content", "files_with_matches", or "count"|
| context_before   | number  | no       | 0                   | Lines before match (-B)                     |
| context_after    | number  | no       | 0                   | Lines after match (-A)                      |
| case_insensitive | boolean | no       | false               | Case-insensitive search                     |
| head_limit       | number  | no       | 50                  | Max results to return                       |

### Result (content mode)

```json
{
  "success": true,
  "outputMode": "content",
  "matches": [
    {
      "file": "src/config/app.ts",
      "line": 15,
      "content": "const PORT = process.env.PORT || 3000;",
      "contextBefore": [],
      "contextAfter": ["const HOST = 'localhost';"]
    }
  ],
  "total": 1,
  "truncated": false
}
```

### Result (files_with_matches mode)

```json
{
  "success": true,
  "outputMode": "files_with_matches",
  "matches": ["src/config/app.ts", "src/server.ts"],
  "total": 2,
  "truncated": false
}
```

### Result (count mode)

```json
{
  "success": true,
  "outputMode": "count",
  "matches": [
    { "file": "src/config/app.ts", "count": 3 },
    { "file": "src/server.ts", "count": 1 }
  ],
  "total": 4,
  "truncated": false
}
```

### Error Responses

```json
{ "success": false, "error": "Invalid regex pattern: [unclosed" }
{ "success": false, "error": "Path outside allowed workspace" }
```
