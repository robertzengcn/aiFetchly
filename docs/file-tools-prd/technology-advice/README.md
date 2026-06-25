# Technology Advice: AI File Tools

This document captures implementation-focused technology advice for adding:

- `file_read`
- `file_write`
- `file_edit`
- `glob_files`
- `grep_files`

to aiFetchly's AI tool system.

## 1. Runtime and architecture fit

- Keep all file operations in the Electron main process.
- Route tool discovery through `SkillRegistry.getAllToolFunctions()` so tools are visible in the active stream path.
- Keep execution routing through `StreamEventProcessor` -> `SkillExecutor` / `ToolExecutor`.
- Treat `aiTools.config.ts` as legacy unless/until proven otherwise in runtime.

## 2. Recommended service split

- Create `FileToolService` for core logic.
- Keep `ToolExecutor` as dispatcher only.
- Add a dedicated path guard helper (`FilePathGuard`) shared by all file tools.

## 3. Security baseline (mandatory)

- Enforce workspace-root jail for every path.
- Reject traversal (`..`), absolute paths outside root, null-byte paths, and symlink escapes.
- Apply a deny list for sensitive paths (`.git`, secrets, private keys, env files, internal protected app data).
- Enforce read/write size caps and result truncation flags.

## 4. Recommended libraries

- `fast-glob` for `glob_files`
- `@vscode/ripgrep` for `grep_files` primary engine
- `write-file-atomic` for safe write/edit commits
- `isbinaryfile` for binary detection
- `picomatch` for deny-list glob matching
- `zod` for strict parameter validation
- `diff` for optional edit diff summaries

## 5. Tool behavior guidance

### `file_read`

- Inputs: `path`, `offset`, `limit`, `encoding`
- Return line-numbered text output where possible.
- If binary, return structured binary metadata rather than raw bytes.
- Include `truncated: true` when limits are hit.

### `file_write`

- Inputs: `path`, `content`, `mode` (`create` or `overwrite`)
- Use atomic temp-write + rename.
- Require permission confirmation.
- Return `bytesWritten` and create/overwrite status.

### `file_edit`

- Inputs: `path`, `old_string`, `new_string`, `replace_all`
- Default to strict single-match replacement.
- Fail on 0 or multiple matches unless `replace_all=true`.
- Require permission confirmation.

### `glob_files`

- Inputs: `pattern`, optional `cwd`, `ignore`, `head_limit`
- Respect default ignore paths (`node_modules`, `.git`, `dist`, etc.).
- Enforce result cap and expose truncation.

### `grep_files`

- Inputs: `pattern`, optional `path`, `glob`, `output_mode`, context flags, case flag, `head_limit`
- Prefer ripgrep JSON output for performance and structure.
- Provide fallback strategy when rg binary is unavailable.
- Enforce output caps to avoid large stream payloads.

## 6. Permission model integration

- Reuse existing `SkillPermissionService`.
- Add/confirm filesystem permission category in skill typing.
- For risky operations (`file_write`, `file_edit`), use confirmation flow:
  - return `needsPermissionPrompt: true` on first run
  - defer and resume via existing stream permission continuation mechanism

## 7. Rate limiting and reliability

- Add explicit file-tool buckets in `RateLimiterManager`.
- Keep write/edit concurrency low (prefer 1).
- Cap grep/read output before serialization.
- Prefer explicit tool-name mappings instead of broad substring matching.

## 8. Packaging and distribution notes

- If using `@vscode/ripgrep`, ensure binary is unpacked in Electron packaging (`asarUnpack`).
- Verify platform path resolution at startup and fall back gracefully when unavailable.

## 9. Testing checklist

Must-have tests:

- path traversal rejection
- symlink escape rejection
- deny-list enforcement
- binary read handling
- truncation behavior
- atomic write behavior
- file edit uniqueness behavior
- permission defer/resume for write/edit calls
- glob/grep result capping and formatting

## 10. Rollout recommendation

1. Ship read-only tools first: `glob_files`, `grep_files`, `file_read`.
2. Validate stability and token usage in real chat flows.
3. Add `file_write` and `file_edit` with mandatory permission prompts.
4. Add audit enrichment and policy refinements after initial adoption.

