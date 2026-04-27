# Quickstart: AI File Tools Development

**Branch**: `001-ai-file-tools` | **Date**: 2026-04-22

## Prerequisites

- Node.js and yarn installed
- Project dependencies installed (`yarn`)
- On branch `001-ai-file-tools`

## Install New Dependencies

```bash
yarn add fast-glob @vscode/ripgrep write-file-atomic isbinaryfile picomatch zod diff
yarn add -D @types/diff
```

## Key Files to Understand

| File | Purpose |
|------|---------|
| `src/service/FilePathGuard.ts` | Path safety validation (workspace jail, deny list, symlink check) |
| `src/service/FileToolService.ts` | Core file tool execution logic (read, write, edit, glob, grep) |
| `src/entityTypes/fileToolTypes.ts` | All TypeScript interfaces for tool params and results |
| `src/config/fileToolConfig.ts` | Workspace roots, deny list, size limits, rate limits |
| `src/config/skillsRegistry.ts` | Skill registration (add 5 new entries to `BUILT_IN_SKILLS`) |
| `src/service/ToolExecutor.ts` | Tool dispatch (add 5 new cases to `executeInternal`) |

## Architecture Flow

```
AI Chat → StreamEventProcessor → SkillExecutor (permission check)
                                    ↓
                              ToolExecutor (dispatch)
                                    ↓
                              FileToolService (execution)
                                    ↓
                              FilePathGuard (safety check)
```

## Development Workflow

### 1. Start with FilePathGuard

```bash
# Write tests first
# test/vitest/main/FilePathGuard.test.ts

# Run tests
yarn vitest run test/vitest/main/FilePathGuard.test.ts
```

### 2. Implement FileToolService

```bash
# Write tests first
# test/vitest/main/FileToolService.test.ts

# Run tests
yarn vitest run test/vitest/main/FileToolService.test.ts
```

### 3. Register in SkillRegistry

Add entries to `BUILT_IN_SKILLS` array in `src/config/skillsRegistry.ts`.

Pattern (read tool example):
```typescript
{
  name: "file_read",
  description: "Read file contents...",
  parameters: { /* JSON Schema */ },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  source: "built-in",
  execute: async (args, context) => {
    const result = await ToolExecutor.execute("file_read", args, context.conversationId);
    return { success: true, result };
  }
}
```

Pattern (write tool example):
```typescript
{
  name: "file_write",
  description: "Create or overwrite a file...",
  parameters: { /* JSON Schema */ },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "filesystem",
  source: "built-in",
  execute: async (args, context) => {
    const result = await ToolExecutor.execute("file_write", args, context.conversationId);
    return { success: true, result };
  }
}
```

### 4. Add Dispatch Cases in ToolExecutor

In `executeInternal()`, add new cases:
```typescript
case "file_read":
case "file_write":
case "file_edit":
case "glob_files":
case "grep_files":
  return await FileToolService.execute(toolName, args);
```

### 5. Run Full Test Suite

```bash
yarn vitest run test/vitest/main/
```

## Testing Tips

- Use `os.tmpdir()` for test fixtures (temporary directories)
- Clean up test files in `afterEach` / `afterAll` hooks
- Create symlinks programmatically to test escape prevention
- Use `Buffer.from()` to create binary test files
- Mock `FilePathGuard` in FileToolService tests for isolated testing

## Commit Strategy

Follow CLAUDE.md auto-commit rule: commit after each completed function:
1. FilePathGuard class + tests → commit
2. FileToolService read methods + tests → commit
3. SkillRegistry read tool entries → commit
4. ToolExecutor read dispatch cases → commit
5. FileToolService write/edit methods + tests → commit
6. SkillRegistry write/edit tool entries → commit
7. ToolExecutor write/edit dispatch cases → commit
8. Integration tests → commit
9. Package config updates → commit
