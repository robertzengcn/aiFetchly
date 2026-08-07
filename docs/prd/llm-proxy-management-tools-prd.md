# LLM Proxy Management Tools - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-19
- **Owner**: Engineering Team
- **Related systems**: AiChatV2, AI tool calling, SkillRegistry, SkillExecutor, Proxy Management, Proxy Validation, Electron utility process
- **Technical design**: `docs/prd/llm-proxy-management-tools-technical-design.md`
- **Related docs**:
  - `docs/GOOGLE_PROXY_CHECK_PLAN.md`
  - `docs/prd/plugin-subagent-management-prd.md`
  - `docs/prd/knowledge-library-management-ai-tools-prd.md`
  - `docs/ai-chat-tool-approval-modes-prd.md`
  - `docs/skills/PRD_AI_Skills_System.md`
- **Related files**:
  - `src/views/pages/proxy/proxy.vue`
  - `src/views/pages/proxy/widgets/ProxyTable.vue`
  - `src/views/api/proxy.ts`
  - `src/main-process/communication/proxy-ipc.ts`
  - `src/controller/proxy-controller.ts`
  - `src/modules/ProxyModule.ts`
  - `src/model/Proxy.model.ts`
  - `src/model/ProxyCheck.model.ts`
  - `src/entity/Proxy.entity.ts`
  - `src/entity/ProxyCheck.entity.ts`
  - `src/entityTypes/proxyType.ts`
  - `src/schemas/ipc/proxy.ts`
  - `src/childprocess/googleProxyCheck.ts`
  - `src/config/skillsRegistry.ts`
  - `src/service/SkillExecutor.ts`
  - `src/service/SkillPermissionService.ts`
  - `src/service/ScheduledAiToolPolicy.ts`

## 1. Summary

AiFetchly already lets users manage proxies from the Proxy page. The UI supports listing, adding, editing, deleting, importing, checking selected proxies, removing failed proxies, and showing Google pass status. The missing product layer is an LLM-facing proxy management capability so users can ask AI Chat to inspect, create, update, import, validate, and clean up proxy records without navigating the proxy UI manually.

This feature adds built-in AI tools for proxy CRUD and proxy validation. The tools must reuse the existing proxy Module/Model architecture and existing proxy checking flow. The LLM should decide what operation to run and explain results. It should not implement proxy networking logic, access the database directly, or drive the Vue page as a browser automation workaround.

Proxy checking should remain deterministic backend work:

- Basic reachability checks run through the main-process proxy validation path.
- Google pass checks continue to run in `src/childprocess/googleProxyCheck.ts` through Electron's utility process isolation.
- Long-running batch checks should be exposed as background jobs or progress-emitting tool calls.
- A subagent may orchestrate proxy maintenance later, but the subagent must call proxy tools rather than becoming the low-level checker.

## 2. Problem Statement

Business automation workflows depend on healthy proxies. Users need to import large proxy lists, validate them, identify failed entries, test Google reachability, and remove bad proxies. Today, those tasks are possible through the Proxy page, but AI Chat cannot help manage them.

This creates workflow friction:

1. Users must leave chat and operate the proxy table manually.
2. Users cannot ask the assistant to check only stale, failed, or selected proxies.
3. Users cannot ask the assistant to summarize proxy health before a scraping workflow.
4. Users cannot safely delegate cleanup such as "remove proxies that failed Google check".
5. A naive LLM integration could expose proxy passwords in tool results.
6. A naive implementation could bypass existing database architecture rules.
7. A naive implementation could let unattended scheduled AI tasks mutate proxy state without clear policy.
8. Existing batch check behavior has reliability risk because the "check all" path uses async `forEach`, which can report completion before all checks finish.

The product needs a controlled AI tool surface that makes proxy management conversational while preserving permission prompts, credential safety, architecture boundaries, and reliable progress reporting.

## 3. Goals

1. Let users ask AI Chat to list and inspect proxies.
2. Let users ask AI Chat to create one proxy.
3. Let users ask AI Chat to update one known proxy.
4. Let users ask AI Chat to delete one known proxy after confirmation.
5. Let users ask AI Chat to import multiple proxies from structured input.
6. Let users ask AI Chat to check selected proxies, all proxies, or filtered proxy sets.
7. Let users ask AI Chat to remove failed proxies after confirmation.
8. Reuse `ProxyModule` for business logic and `ProxyModel` for database access.
9. Keep all database operations out of AI chat IPC handlers and child processes.
10. Keep Google proxy validation in the existing child process path.
11. Redact proxy credentials from normal LLM tool results.
12. Require user confirmation before mutating proxy records or starting network/browser validation.
13. Return concise structured results that AI Chat can summarize.
14. Support progress for long-running batch checks.
15. Make scheduled AI behavior explicit through tool policy.
16. Add focused tests for schemas, permission categories, credential redaction, CRUD safety checks, and batch progress behavior.

## 4. Non-Goals

1. Do not make the LLM operate `proxy.vue` or `ProxyTable.vue` through UI automation for CRUD.
2. Do not create a subagent as the low-level proxy checker.
3. Do not let AI tools access TypeORM repositories directly.
4. Do not let worker or utility processes access the database directly.
5. Do not expose proxy passwords in list results.
6. Do not implement account proxy assignment in the MVP.
7. Do not redesign the proxy UI.
8. Do not replace the existing `PROXYLIST`, `PROXYSAVE`, `PROXYDELETE`, `PROXYCHECK`, or `CHECKALLPROXY` IPC paths for the UI.
9. Do not create a new proxy database schema unless required by the check job model.
10. Do not scrape websites or run business tasks as part of proxy checking.
11. Do not automatically delete failed proxies without explicit user confirmation.
12. Do not add marketplace, plugin, or MCP proxy tools in the MVP.

## 5. Target Users

### 5.1 Marketing Operator

Runs lead discovery, search scraping, Google Maps, Yellow Pages, and contact extraction workflows. Wants to confirm proxies are healthy before starting a task.

Example:

```text
Check the proxies I imported today and tell me how many are usable for Google.
```

### 5.2 Power User

Uses AI Chat as the app command surface. Wants to create, update, import, validate, and clean up proxy records without switching pages.

Example:

```text
Import these SOCKS5 proxies, check them with a 20 second timeout, and keep only the ones that pass.
```

### 5.3 Scheduled Automation Maintainer

Configures recurring AI tasks and wants proxy health checks to run on a schedule without granting broad shell or database permissions.

Example:

```text
Every morning, check all proxies and summarize failures.
```

### 5.4 Admin or Reviewer

Audits what the AI can do and expects proxy changes to be permission-gated, logged, and easy to trace.

Example:

```text
Show me which proxies were deleted by AI this week.
```

Audit history is desirable but not required for the MVP unless the existing tool execution log already provides enough traceability.

## 6. Current Architecture Findings

### 6.1 Proxy page is a wrapper

`src/views/pages/proxy/proxy.vue` only renders `ProxyTable`. It is not the correct integration point for LLM CRUD.

Current UI path:

```text
proxy.vue
  -> ProxyTable.vue
    -> src/views/api/proxy.ts
      -> src/main-process/communication/proxy-ipc.ts
        -> ProxyController / ProxyModule
          -> ProxyModel / ProxyCheckModel
```

### 6.2 CRUD already exists

Current CRUD support:

- `ProxyModule.getProxylist(page, size, search)`
- `ProxyModule.getProxyDetail(id)`
- `ProxyModule.saveProxy(entity)`
- `ProxyModule.importProxy(data)`
- `ProxyModule.deleteProxy(id)`
- `ProxyModel.getProxyList(page, size, search)`
- `ProxyModel.getProxyById(id)`
- `ProxyModel.saveProxy(proxyData)`
- `ProxyModel.importProxies(proxies)`
- `ProxyModel.deleteProxy(id)`

The AI tool layer should call the Module layer and should not duplicate repository logic.

### 6.3 Proxy validation already exists

Current validation support:

- `ProxyController.checkProxy(proxyEntity, timeout)` validates one proxy.
- `ProxyController.updateProxyStatus(proxyEntity, proxyID, timeout)` validates one stored proxy and updates `proxy_check`.
- `ProxyController.checkGooglePass(proxyEntity, timeout)` forks `googleProxyCheck.js`.
- `ProxyController.checkAllproxy(callback, finishcall, timeout, proxyIds)` checks selected or all proxies.
- `src/childprocess/googleProxyCheck.ts` runs the Google/browser validation in a child process.

The AI tool layer should reuse or refactor this path rather than creating a subagent checker.

### 6.4 AI tools should be registered skills

Built-in AI tools are registered in `src/config/skillsRegistry.ts` and executed through `SkillExecutor`. This gives the product:

- JSON-schema tool descriptions for the LLM.
- Existing permission prompts.
- Existing tool call/result rendering.
- Existing scheduled AI tool policy integration.
- Existing audit logging through the tool execution pipeline.

Proxy AI tools should be built-in skills, not new renderer-only IPC shortcuts.

### 6.5 Current permission categories do not include database mutation

`SkillPermissionCategory` currently supports:

- `pure`
- `network`
- `filesystem`
- `automation`
- `shell`

Proxy create, update, delete, import, remove failed, and check operations mutate local database state or run network/browser work. Until a narrower `data` or `database` permission category exists, these tools should use `automation` with confirmation for mutating operations.

### 6.6 Credential exposure is the biggest data risk

`ProxyListEntity` can include `password`, and `ProxyEntity` can include `pass`. The Proxy table hides the password column by default, but the data shape can still carry credentials.

LLM tool results must redact credentials by default:

- Lists should return `hasPassword: true` instead of `pass`.
- Detail reads should return credentials only when explicitly requested and permissioned.
- Mutation results should not echo `pass`.
- Tool audit logs should avoid storing raw passwords in arguments where possible.

### 6.7 Batch checking has a correctness risk

The selected-proxy branch of `checkAllproxy` awaits each proxy check in sequence. The all-proxies branch uses `records.forEach(async (item) => ...)`, which does not await all checks before moving to progress and finish callbacks.

Before exposing batch check to the LLM, the implementation should refactor batch checking into a controlled async loop using `Promise.allSettled` with a concurrency limit.

## 7. Proposed Solution

Add a proxy AI tool service and register built-in skills for proxy management.

New service:

```text
src/service/ProxyAiTools.ts
```

Primary built-in tools:

1. `proxy_list`
2. `proxy_get`
3. `proxy_create`
4. `proxy_update`
5. `proxy_delete`
6. `proxy_import`
7. `proxy_check`
8. `proxy_remove_failed`

Optional later tool:

1. `proxy_health_report`

The service should:

- Parse and validate tool arguments with Zod.
- Normalize ports, protocol names, search strings, and pagination.
- Call `ProxyModule` and `ProxyController`.
- Redact credentials before returning results.
- Enforce exact-ID operations for update and delete.
- Provide safety checks such as `expected_host` and `expected_port`.
- Return structured tool results with stable codes.
- Support progress and job IDs for long-running checks if the current tool loop cannot block safely.

## 8. Product Experience

### 8.1 List proxies

User:

```text
Show me proxies that failed validation.
```

Expected behavior:

1. The model calls `proxy_list` with a status filter if available.
2. Tool returns compact rows without passwords.
3. Assistant summarizes the count and relevant rows.

Example assistant response:

```text
I found 8 failed proxies. The first 5 are #12, #18, #21, #24, and #31. None of the results exposed stored passwords.
```

### 8.2 Create one proxy

User:

```text
Add this proxy: socks5://proxy.example.com:1080 with username demo and password secret.
```

Expected behavior:

1. The model calls `proxy_create`.
2. The app shows a permission prompt because this mutates local proxy records.
3. User approves.
4. Tool creates the proxy through `ProxyModule.saveProxy`.
5. Tool returns the new proxy ID and redacted summary.

Example assistant response:

```text
Added proxy #54: socks5://proxy.example.com:1080 with credentials stored.
```

### 8.3 Update one proxy

User:

```text
Change proxy #54 to port 1081.
```

Expected behavior:

1. The model calls `proxy_update` with `proxy_id: 54` and `port: "1081"`.
2. The tool loads the current proxy before update.
3. The app shows a permission prompt.
4. User approves.
5. Tool updates the record and returns a redacted before/after summary.

If the user refers to a proxy by host instead of ID and multiple matches exist, the assistant must list candidates and ask for the ID before update.

### 8.4 Delete one proxy

User:

```text
Delete proxy #54.
```

Expected behavior:

1. The model calls `proxy_delete`.
2. The app shows a permission prompt.
3. Tool optionally checks `expected_host` or `expected_port`.
4. Tool deletes through `ProxyModule.deleteProxy`.
5. Tool returns `deleted: true`.

Delete must require a known ID. Fuzzy delete by host-only is not allowed in the tool contract.

### 8.5 Import proxies

User:

```text
Import these proxies:
http://1.2.3.4:8080:user:pass
socks5://5.6.7.8:1080
```

Expected behavior:

1. The model parses the text into `proxy_import` input.
2. The app shows a permission prompt.
3. Tool validates all rows before calling `ProxyModule.importProxy`.
4. Tool returns imported count, skipped duplicate count if available, and invalid row details.

### 8.6 Check selected proxies

User:

```text
Check proxies #10, #11, and #12 with a 15 second timeout.
```

Expected behavior:

1. The model calls `proxy_check` with `proxy_ids: [10, 11, 12]`, `mode: "both"`, `timeout_ms: 15000`.
2. The app shows a permission prompt because this runs network/browser checks and updates status.
3. Tool starts the check.
4. UI receives progress events or the tool returns a `job_id`.
5. Assistant summarizes pass/fail results when complete.

### 8.7 Remove failed proxies

User:

```text
Remove proxies that failed the latest check.
```

Expected behavior:

1. The assistant should first call `proxy_list` with failure status to show the candidate count.
2. The assistant should ask for user confirmation in chat if the user did not already clearly authorize deletion.
3. The model calls `proxy_remove_failed`.
4. The app shows the permission prompt.
5. Tool removes failed proxies and returns deleted count.

## 9. Tool Contracts

### 9.1 Common types

#### Safe proxy summary

Returned by list, detail, create, update, import, and check tools.

```typescript
interface SafeProxySummary {
  id: number;
  host: string;
  port: string;
  protocol?: "http" | "https" | "socks4" | "socks5";
  username?: string;
  hasPassword: boolean;
  countryCode?: string;
  addtime?: string;
  checktime?: string;
  status?: "unknown" | "pass" | "failure";
  googlePass?: "not_checked" | "pass" | "fail";
}
```

Credential rule:

- `pass` and `password` must not appear in `SafeProxySummary`.
- `username` can be returned because it is visible in the current proxy table.
- If future requirements treat usernames as sensitive, add `redact_username`.

#### Tool error

```typescript
interface ProxyToolError {
  success: false;
  code:
    | "INVALID_INPUT"
    | "AI_DISABLED"
    | "PROXY_NOT_FOUND"
    | "EXPECTED_PROXY_MISMATCH"
    | "DUPLICATE_PROXY"
    | "CHECK_FAILED"
    | "IMPORT_FAILED"
    | "DELETE_FAILED"
    | "PERMISSION_REQUIRED"
    | "UNSUPPORTED_OPERATION";
  error: string;
}
```

### 9.2 `proxy_list`

Purpose: Let the LLM inspect proxy records without exposing credentials.

Permission:

- `requiresConfirmation: false`
- `permissionCategory: "pure"`

Input schema:

```typescript
{
  page?: number;       // default 0, min 0
  size?: number;       // default 20, min 1, max 100
  search?: string;     // optional host/port/user/protocol search
  status?: "unknown" | "pass" | "failure";
  googlePass?: "not_checked" | "pass" | "fail";
}
```

Output:

```typescript
{
  success: true;
  proxies: SafeProxySummary[];
  total: number;
  page: number;
  size: number;
  credentialsRedacted: true;
}
```

Notes:

- If `status` or `googlePass` cannot be filtered in SQL initially, the service may fetch a bounded scan and filter in memory.
- The bounded scan must have a hard cap such as 500 rows to avoid unbounded memory work.

### 9.3 `proxy_get`

Purpose: Inspect one proxy by exact ID.

Permission:

- Default: `requiresConfirmation: false`, `permissionCategory: "pure"`
- If `include_credentials: true`: must require confirmation or be implemented as a separate high-risk tool later.

MVP recommendation:

- Do not support `include_credentials` in v1.
- Return credential presence only.

Input schema:

```typescript
{
  proxy_id: number; // positive integer
}
```

Output:

```typescript
{
  success: true;
  proxy: SafeProxySummary;
  credentialsRedacted: true;
}
```

### 9.4 `proxy_create`

Purpose: Create one proxy record.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`

Input schema:

```typescript
{
  host: string;
  port: string | number;
  protocol: "http" | "https" | "socks4" | "socks5";
  user?: string;
  pass?: string;
  country_code?: string;
}
```

Validation:

- `host` must be non-empty after trim.
- `port` must normalize to a string integer from `1` to `65535`.
- `protocol` must be normalized to lowercase.
- `user` and `pass` must be trimmed but not logged in plaintext.
- Reject duplicates by host and port using existing `ProxyModule.saveProxy` behavior.

Output:

```typescript
{
  success: true;
  proxy: SafeProxySummary;
  created: true;
}
```

### 9.5 `proxy_update`

Purpose: Update one existing proxy by exact ID.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`

Input schema:

```typescript
{
  proxy_id: number;
  host?: string;
  port?: string | number;
  protocol?: "http" | "https" | "socks4" | "socks5";
  user?: string | null;
  pass?: string | null;
  country_code?: string | null;
  expected_host?: string;
  expected_port?: string | number;
}
```

Validation:

- `proxy_id` is required.
- At least one update field must be present.
- If `expected_host` is provided, the current proxy host must match exactly.
- If `expected_port` is provided, the current proxy port must match exactly after normalization.
- Null for `user`, `pass`, or `country_code` means clear the field.
- The tool must load the current proxy before update.

Output:

```typescript
{
  success: true;
  proxy: SafeProxySummary;
  updated: true;
  changedFields: string[];
}
```

### 9.6 `proxy_delete`

Purpose: Delete one proxy by exact ID.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`

Input schema:

```typescript
{
  proxy_id: number;
  expected_host?: string;
  expected_port?: string | number;
}
```

Validation:

- `proxy_id` is required.
- If expected fields are provided, they must match the current record before deletion.
- The tool should return the redacted deleted proxy summary for audit display.

Output:

```typescript
{
  success: true;
  deleted: true;
  proxy: SafeProxySummary;
}
```

### 9.7 `proxy_import`

Purpose: Import multiple proxies from LLM-parsed structured input.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`

Input schema:

```typescript
{
  proxies: Array<{
    host: string;
    port: string | number;
    protocol: "http" | "https" | "socks4" | "socks5";
    user?: string;
    pass?: string;
    country_code?: string;
  }>;
  duplicatePolicy?: "skip" | "fail"; // default skip
}
```

Validation:

- Maximum 500 proxies per call in MVP.
- Validate every row before writing.
- Reject the entire call if `duplicatePolicy` is `fail` and any duplicate exists.
- If `duplicatePolicy` is `skip`, import only unique proxies and return skipped count.

Output:

```typescript
{
  success: true;
  importedCount: number;
  skippedDuplicateCount: number;
  invalidCount: number;
  proxies: SafeProxySummary[];
  credentialsRedacted: true;
}
```

### 9.8 `proxy_check`

Purpose: Validate stored proxies and update check status.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`
- `timeoutClass: "network"` or async job mode for large batches.

Input schema:

```typescript
{
  proxy_ids?: number[];
  check_all?: boolean;
  filters?: {
    status?: "unknown" | "pass" | "failure";
    googlePass?: "not_checked" | "pass" | "fail";
    search?: string;
  };
  mode?: "basic" | "google" | "both"; // default both
  timeout_ms?: number;                 // default 15000, min 1000, max 60000
  concurrency?: number;                // default 3, min 1, max 10
}
```

Validation:

- Exactly one target selector must be provided:
  - `proxy_ids`
  - `check_all: true`
  - `filters`
- `proxy_ids` max 100 in synchronous mode.
- Large checks should return a job ID instead of blocking the AI loop.
- `mode: "google"` still needs proxy details and should update only Google pass status if basic status is not requested.

Output for small synchronous run:

```typescript
{
  success: true;
  checkedCount: number;
  basicPassCount: number;
  basicFailCount: number;
  googlePassCount: number;
  googleFailCount: number;
  results: Array<{
    proxy: SafeProxySummary;
    basic?: "pass" | "failure";
    googlePass?: "pass" | "fail";
    error?: string;
  }>;
}
```

Output for async run:

```typescript
{
  success: true;
  async: true;
  job_id: string;
  expectedCount: number;
  message: string;
}
```

### 9.9 `proxy_remove_failed`

Purpose: Delete proxies whose latest basic check failed, optionally constrained by Google pass status.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`

Input schema:

```typescript
{
  failureType?: "basic" | "google" | "either"; // default basic
  dry_run?: boolean;                           // default false
  max_delete?: number;                         // default 100, max 500
}
```

Behavior:

- If `dry_run: true`, list candidates without deleting and do not require mutation.
- If `dry_run: false`, require confirmation and delete only candidates matching the latest check statuses.
- The assistant should normally run dry-run/list first before delete.

Output:

```typescript
{
  success: true;
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  proxies: SafeProxySummary[];
}
```

## 10. Subagent Decision

### 10.1 Do not create a subagent for low-level checking

Proxy checking is deterministic I/O and browser validation work. A subagent adds reasoning overhead but does not improve check correctness. The low-level checker must stay in backend code where timeouts, concurrency, process isolation, and database writes are controlled.

### 10.2 Optional later subagent: Proxy Maintenance Assistant

A subagent can be useful as an orchestration layer after the tools exist.

Possible agent definition:

```yaml
name: proxy-maintenance
description: Audits proxy health, recommends cleanup, and runs approved proxy tools.
tools:
  - proxy_list
  - proxy_get
  - proxy_check
  - proxy_remove_failed
```

Responsibilities:

- Inspect stale or failed proxies.
- Run checks with user-approved scope.
- Summarize basic pass and Google pass health.
- Recommend cleanup.
- Ask for confirmation before destructive actions.

Non-responsibilities:

- No direct database access.
- No network implementation.
- No Puppeteer code.
- No bypass of `SkillExecutor`, tool permissions, or scheduled AI policy.

MVP decision: ship proxy tools first. Add the subagent only after proxy tools and progress reporting are reliable.

## 11. Architecture Requirements

### 11.1 Required layering

```text
AI Chat / Scheduled AI
  -> SkillRegistry tool definition
    -> SkillExecutor permission + audit flow
      -> ProxyAiTools service
        -> ProxyModule / ProxyController
          -> ProxyModel / ProxyCheckModel
            -> SQLite / TypeORM

Google check:
ProxyController
  -> Electron utilityProcess
    -> src/childprocess/googleProxyCheck.ts
      -> Puppeteer browser validation
    -> result message to main process
  -> ProxyCheckModel updates DB in main process
```

### 11.2 Database rules

- AI tools must not import `ProxyModel` unless there is a strong reason and the operation remains inside service/module boundaries.
- AI tools must not import TypeORM repositories.
- IPC handlers must not access proxy repositories directly.
- Child processes must not access the database.
- Google check child process sends results back to main process; main process updates `ProxyCheckModel`.

### 11.3 AI feature gate

Because these are AI functions exposed through AI Chat, the first entry point is already gated by AI Chat's `USER_AI_ENABLED` check. If standalone AI IPC handlers are added later for proxy AI tools, they must use `registerAiValidatedHandler` or check `Token` and `USER_AI_ENABLED` before parsing request data.

Read-only proxy list tools inside an already-authorized AI chat execution do not need a second feature gate. Mutating or network tools should still rely on `SkillExecutor` permission checks.

### 11.4 Permission and scheduled task policy

Recommended categories:

| Tool | Permission category | Confirmation | Scheduled AI |
|---|---|---:|---|
| `proxy_list` | `pure` | No | Allowed |
| `proxy_get` | `pure` | No | Allowed |
| `proxy_create` | `automation` | Yes | Allow only if explicitly allowlisted |
| `proxy_update` | `automation` | Yes | Allow only if explicitly allowlisted |
| `proxy_delete` | `automation` | Yes | Allow only if explicitly allowlisted |
| `proxy_import` | `automation` | Yes | Allow only if explicitly allowlisted |
| `proxy_check` | `automation` | Yes | Allow only if explicitly allowlisted |
| `proxy_remove_failed` | `automation` | Yes | Allow only if explicitly allowlisted |

Scheduled AI must never run shell for this feature. Scheduled cleanup should require explicit tool allowlisting and `autoApproveTools`.

## 12. Data and Validation Requirements

### 12.1 Protocol normalization

Accepted input:

- `http`
- `https`
- `socks4`
- `socks5`

Normalization:

- Lowercase.
- Trim whitespace.
- Reject unknown protocols.
- Do not silently convert missing protocol to `http`; ask for clarification or return validation error.

### 12.2 Port normalization

Accepted input:

- String or number.

Rules:

- Trim if string.
- Must parse to integer.
- Must be from 1 to 65535.
- Store as string to match existing `ProxyEntity.port`.

### 12.3 Host validation

MVP rules:

- Non-empty string.
- Trim whitespace.
- Reject strings containing URL paths, query strings, or whitespace.

Future hardening:

- Validate IP, hostname, or bracketed IPv6 address.
- Normalize URL-form proxy strings before schema validation.

### 12.4 Credential handling

Rules:

- Accept `user` and `pass` on create/import/update.
- Never return `pass` in normal tool output.
- Avoid logging raw `pass` in service logs.
- Consider redacting `pass` from tool argument audit metadata if existing audit logs store raw arguments.
- Return `hasPassword: true` when a password exists.

### 12.5 Duplicate handling

Existing duplicate check is host and port. MVP should keep this behavior for compatibility.

Future option:

- Treat host, port, protocol, and username as a composite duplicate key if users need multiple auth variants for one endpoint.

## 13. Proxy Check Job Requirements

### 13.1 Refactor batch checker

Before adding `proxy_check`, refactor `ProxyController.checkAllproxy` or extract `ProxyCheckModule` so batch checking has predictable completion.

Required behavior:

- No async `forEach`.
- Controlled concurrency.
- Await all checks before final completion.
- Emit progress after each proxy finishes.
- Preserve timeout per proxy.
- Continue checking other proxies if one fails.
- Return per-proxy errors without throwing the entire batch unless setup fails.

Suggested internal interface:

```typescript
interface ProxyCheckBatchOptions {
  proxyIds?: number[];
  checkAll?: boolean;
  mode: "basic" | "google" | "both";
  timeoutMs: number;
  concurrency: number;
  onProgress?: (progress: ProxyCheckProgress) => void;
}

interface ProxyCheckProgress {
  checked: number;
  total: number;
  proxyId: number;
  basic?: "pass" | "failure";
  googlePass?: "pass" | "fail";
  error?: string;
}
```

### 13.2 Async job threshold

The implementation should choose async mode when:

- More than 20 proxies are requested.
- `mode` includes Google checks for more than 5 proxies.
- Estimated runtime exceeds AI tool timeout.
- The user explicitly asks for background checking.

Async jobs should use the existing AI async job infrastructure if available. If not, MVP can run small checks synchronously and defer large checks until job infrastructure is wired.

### 13.3 Progress events

For synchronous tool calls, use `SkillExecutionContext.emitProgress` where available.

Progress event guidance:

- `phase: "running"` when checks start.
- `progress` from 0 to 100.
- `partialCount` = checked count.
- `expectedCount` = total proxies.
- `message` should not include passwords.

## 14. UX Requirements

### 14.1 Chat behavior

The assistant should:

- List candidates before destructive operations when the user did not give an exact ID.
- Ask a clarifying question if multiple proxies match.
- Explain that credentials are stored but not displayed.
- Summarize check results with counts and a short table when useful.
- Never paste proxy passwords back into chat.

### 14.2 Tool result rendering

MVP can use generic tool call/result cards.

Future UI improvements:

- Proxy health result card.
- Progress bar for batch check jobs.
- "Open Proxy page" action after mutations.
- "View failed proxies" shortcut.

### 14.3 Proxy page refresh

If a proxy tool runs while the Proxy page is open, the page should eventually reflect changes. MVP can rely on existing table reload when the user navigates or searches. A later improvement can broadcast a renderer event such as `PROXY_DATA_CHANGED`.

## 15. Security and Safety Requirements

1. Mutating proxy tools must require permission prompts.
2. Network/browser validation must require permission prompts.
3. Tool results must redact passwords.
4. Tool logs should redact passwords where possible.
5. Delete must require exact proxy ID.
6. Update must require exact proxy ID.
7. Expected host/port checks must be supported for safer stale-list operations.
8. Child process code must stay under `src/childprocess/`.
9. Child processes must not access SQLite or TypeORM.
10. AI tools must not bypass `SkillExecutor`.
11. Scheduled AI must only run non-pure proxy tools when explicitly allowlisted.
12. Prompt injection from imported proxy text must not override tool policy. Proxy input is data, not instructions.

## 16. Implementation Plan

### Phase 1: Foundation and schemas

1. Add `src/entityTypes/proxyAiToolTypes.ts`.
2. Add Zod schemas for proxy AI tool input.
3. Add safe proxy mapping helpers.
4. Add credential redaction helper.
5. Add unit tests for normalization and redaction.

Deliverable:

- No user-visible tool yet.
- Tested input parsing and safe output mapping.

### Phase 2: Read-only tools

1. Add `src/service/ProxyAiTools.ts`.
2. Implement `listProxies(args)`.
3. Implement `getProxy(args)`.
4. Register `proxy_list` and `proxy_get` in `skillsRegistry.ts`.
5. Add tests for read-only tool outputs.

Deliverable:

- AI Chat can inspect proxies without exposing passwords.

### Phase 3: CRUD mutation tools

1. Implement `createProxy(args)`.
2. Implement `updateProxy(args)`.
3. Implement `deleteProxy(args)`.
4. Implement `importProxies(args)`.
5. Register tools in `skillsRegistry.ts` with `automation` and confirmation.
6. Add tests for duplicate handling, expected-host mismatch, expected-port mismatch, and delete not found.

Deliverable:

- AI Chat can create, update, delete, and import proxies through permissioned tools.

### Phase 4: Reliable proxy check service

1. Refactor `ProxyController.checkAllproxy` to remove async `forEach`.
2. Add controlled concurrency.
3. Add result aggregation.
4. Add progress callbacks.
5. Preserve existing UI IPC behavior for `CHECKALLPROXY`.
6. Add tests for selected checks and all checks using mocked validation.

Deliverable:

- Existing Proxy page check behavior becomes reliable.

### Phase 5: AI proxy check tool

1. Implement `proxy_check`.
2. Support `proxy_ids`, `check_all`, and filters.
3. Support `mode`, `timeout_ms`, and `concurrency`.
4. Emit progress where available.
5. Add async job mode if needed for large batches.
6. Add tests for small synchronous checks and large async threshold behavior.

Deliverable:

- AI Chat can validate proxies and summarize health.

### Phase 6: Remove failed and optional maintenance agent

1. Implement `proxy_remove_failed` with dry-run support.
2. Register the tool as confirmed automation.
3. Add tests for dry-run and delete behavior.
4. Optionally define a `proxy-maintenance` subagent that calls proxy tools.

Deliverable:

- AI Chat can safely clean up failed proxies.
- Optional agent orchestration is available only after tools are stable.

## 17. Test Plan

### 17.1 Unit tests

Add tests under the existing test structure:

- `test/modules/ProxyAiTools.test.ts` or service equivalent.
- `test/vitest/main/proxy-ai-tools.test.ts` if registry or main-process behavior is easier to test with Vitest.

Test cases:

1. `proxy_list` redacts passwords.
2. `proxy_get` redacts passwords.
3. `proxy_create` normalizes numeric port to string.
4. `proxy_create` rejects invalid protocol.
5. `proxy_create` rejects invalid port.
6. `proxy_update` rejects empty update.
7. `proxy_update` rejects expected host mismatch.
8. `proxy_delete` rejects expected port mismatch.
9. `proxy_import` enforces max batch size.
10. `proxy_import` skips duplicates when requested.
11. `proxy_check` rejects calls without a target selector.
12. `proxy_check` rejects multiple target selectors.
13. `proxy_check` clamps timeout and concurrency.
14. `proxy_remove_failed` dry run does not delete.

### 17.2 Integration tests

1. Register built-in tools and confirm they appear in available tools.
2. Verify permission category for each tool.
3. Verify scheduled AI policy classifies pure tools as low risk and automation tools as allowlist-required.
4. Verify create/update/delete call `ProxyModule`, not repositories.
5. Verify batch check final callback fires after all mocked checks settle.

### 17.3 Manual QA

1. Start app with `yarn dev`.
2. Open AI Chat.
3. Ask: "List my proxies."
4. Verify no passwords appear.
5. Ask: "Add proxy http://127.0.0.1:8080."
6. Verify permission prompt appears.
7. Approve and verify proxy appears on Proxy page.
8. Ask: "Update proxy #ID to port 8081."
9. Verify permission prompt and table update.
10. Ask: "Check proxy #ID."
11. Verify progress/result.
12. Ask: "Delete proxy #ID."
13. Verify permission prompt and deletion.

## 18. Acceptance Criteria

### AC-1: Read-only proxy tools

Given AI Chat is enabled, when the model calls `proxy_list`, then the tool returns proxy summaries with no `pass` or `password` fields.

### AC-2: Exact-ID detail

Given a valid proxy ID, when the model calls `proxy_get`, then the tool returns one safe proxy summary and redacts credentials.

### AC-3: Create with confirmation

Given a user asks to add a proxy, when the model calls `proxy_create`, then the app prompts for permission before writing the record.

### AC-4: Update safety

Given `expected_host` is supplied and does not match the current record, when the model calls `proxy_update`, then no update occurs and the tool returns `EXPECTED_PROXY_MISMATCH`.

### AC-5: Delete safety

Given `proxy_delete` is called without a valid exact ID, then validation fails and no record is deleted.

### AC-6: Import validation

Given an import batch contains invalid rows, then the tool returns invalid row details and does not silently create malformed records.

### AC-7: Batch check completion

Given `proxy_check` checks multiple proxies, then the final result is returned only after all selected checks have settled or the job has been accepted for async execution.

### AC-8: Google check isolation

Given a Google check runs, then Puppeteer work happens in `src/childprocess/googleProxyCheck.ts` through utility process isolation, and database updates happen only in the main process.

### AC-9: Permission categories

Given tools are registered, then read-only tools are `pure` and mutating/checking tools are `automation` with `requiresConfirmation: true`.

### AC-10: Scheduled AI policy

Given a scheduled AI task tries to run `proxy_delete` without explicit allowlisting and auto-approve, then the tool is blocked by scheduled AI policy.

### AC-11: Existing UI remains compatible

Given the Proxy page calls existing proxy IPC channels, then list, save, delete, import, check, and remove failed behavior still works.

### AC-12: No direct database access from AI wrapper

Given the proxy AI service is inspected, then it calls Module/Controller methods and does not create TypeORM repositories directly.

## 19. Open Questions

1. Should `proxy_get` ever expose credentials with an additional permission prompt, or should credentials remain write-only for AI tools?
2. Should duplicate detection remain host+port or include protocol and username?
3. Should `proxy_remove_failed` delete only basic failures or also Google failures by default?
4. Should AI tool audit logs redact raw tool arguments before persistence?
5. Should batch proxy checks use existing async tool job infrastructure immediately, or should MVP limit synchronous checks to small batches?
6. Should proxy status filters be implemented in SQL joins against `proxy_check`, or is bounded in-memory filtering acceptable for MVP?
7. Should failed proxy cleanup create a recoverable archive or audit table before deletion?

## 20. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Passwords leak into chat or logs | Users expose proxy credentials | Redact all tool outputs, avoid logging raw args, add tests |
| Batch check reports done too early | Users trust incomplete health results | Refactor async `forEach` into awaited concurrency batches |
| LLM deletes wrong proxy | Data loss and workflow failures | Require exact ID and support expected host/port checks |
| Scheduled AI deletes proxies unexpectedly | Unattended destructive action | Require allowlisting and auto-approve for automation tools |
| Google checks overwhelm local resources | Browser processes consume CPU/RAM | Concurrency limit and async job threshold |
| Child process writes DB | Architecture violation and runtime failures | Keep DB updates in main process only |
| New AI tools bypass existing UI behavior | Divergent proxy logic | Reuse `ProxyModule` and `ProxyController` |
| Credential args persist in tool logs | Sensitive data stored locally | Redact audit metadata or store password presence only |

## 21. Success Metrics

1. 0 instances of `pass` or `password` fields in `proxy_list` and `proxy_get` results.
2. 100% of mutating proxy tools show permission prompts in interactive AI Chat.
3. Batch check final result count equals requested proxy count in tests.
4. Existing Proxy page check behavior still passes manual QA.
5. Scheduled AI blocks unallowlisted proxy mutations.
6. Users can complete create, check, summarize, and delete workflows from AI Chat without navigating to the Proxy page.

## 22. Recommended MVP Scope

Ship in this order:

1. `proxy_list`
2. `proxy_get`
3. `proxy_create`
4. `proxy_update`
5. `proxy_delete`
6. Batch checker refactor
7. `proxy_check`

Defer:

1. `proxy_remove_failed`
2. Async large-batch jobs if the first release can enforce small synchronous limits.
3. Credential reveal tools.
4. Proxy Maintenance Assistant subagent.
5. UI-specific proxy health cards.

The minimum useful product is not just CRUD. It must include credential redaction and permission gating, otherwise the AI tool surface creates more risk than value.
