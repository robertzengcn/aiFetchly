# Yellow Pages Scraper Plugin for AI Chat

**Document type:** Product Requirements Document  
**Status:** Proposed  
**Date:** 2026-07-28  
**Primary surface:** AiChatV2  
**Execution model:** Installed plugin with skill, command, hooks, and an MCP stdio server  
**Persistence model:** No Yellow Pages TypeORM entities

## 1. Executive Summary

AiFetchly currently ships Yellow Pages scraping as an application feature with a dedicated UI, application-owned entities, a main-process manager, and a child-process Puppeteer worker. Not every customer needs this capability. The product should move the capability into an independently installable plugin.

After this change, installing and enabling the plugin gives AiChatV2 the ability to call a Yellow Pages scraping tool. Without the plugin, the tool, skill instructions, slash command, hooks, Puppeteer runtime, platform adapters, and related dependencies are absent from the application tool catalog.

The plugin owns the actual scrape. Its MCP process launches Puppeteer and contains the platform adapters, selectors, deterministic fallback behavior, extraction logic, error classification, and artifact generation. The AiFetchly host owns plugin installation, permissions, the AI conversation loop, long-running job management, cancellation, progress delivery, AI-provider access, and tool-result serialization.

Yellow Pages scraping can take several minutes, so it must not run as a normal foreground function call. The host must route the plugin tool through the existing `ToolJobRegistry`. The first AI response ends after requesting the tool. Electron then runs the scrape locally. After the job completes or returns a recoverable failure, Electron sends a new request to the AI server containing the structured tool result. The remote AI server does not remain connected while Puppeteer is scraping.

Scraper recovery has two stages:

1. The plugin first performs bounded deterministic recovery, such as retrying navigation, trying packaged fallback selectors, reducing concurrency, or preserving partial results.
2. If deterministic recovery cannot finish the task, the plugin returns a structured, recoverable application error. The next AI-chat round can retry the tool with one of the plugin-approved recovery strategies, use partial results, switch platforms, or ask the user for help.

A later phase may support in-session AI recovery while the same browser page remains open. That requires a generic server-to-host AI recovery broker, preferably MCP sampling where supported. Returning an error alone cannot resume the same browser session because returning completes the MCP call and the current host disconnects the MCP process.

## 2. Product Problem

### 2.1 Current packaging problem

The existing application includes Yellow Pages code and dependencies for all customers even when they never use the feature. This increases application size, maintenance surface, permission exposure, and release coupling.

The current capability is also tied to UI and persistence assumptions that will be removed:

- A dedicated Yellow Pages management UI.
- Yellow Pages TypeORM entities and CRUD flows.
- A main-process `YellowPagesProcessManager` that is coupled to application task records.
- A child-process entry point compiled with the application.

### 2.2 Tool-call duration problem

Puppeteer work can exceed normal AI tool-call limits. A scrape may include browser startup, navigation, consent handling, several result pages, detail-page visits, contact extraction, rate limiting, and retries.

Executing this as a normal MCP call currently exposes several competing limits:

- Unrecognized MCP tools fall back to the `network` timeout class, currently 90 seconds.
- `MCPToolService` applies a separate 240-second call timeout.
- `MCPClient` also has a request timeout from server configuration.
- AiChatV2 async polling has a 30-minute ceiling.

Putting an MCP call inside a job does not solve the problem if an inner MCP timeout still terminates it after four minutes.

### 2.3 Recovery problem

Yellow Pages sites change selectors, insert consent screens, rate-limit navigation, return incomplete results, or display CAPTCHAs. Opaque exceptions such as `Tool execution failed` do not give the AI enough information to make a useful decision.

The legacy scraper already demonstrates a useful pattern: the child process captures page state, sends an `AI_SUPPORT_REQUEST` to the main process, and receives structured recovery actions. The independent plugin needs equivalent outcomes without receiving application credentials or depending on the legacy task manager.

## 3. Product Goals

1. Make Yellow Pages scraping available only after the user installs and enables the plugin.
2. Expose the capability through AiChatV2 AI tool calls rather than a Yellow Pages management UI.
3. Run all actual browser scraping code in the plugin MCP process.
4. Route long-running plugin calls through the host-owned `ToolJobRegistry`.
5. Show live progress and partial counts in the existing AiChatV2 tool card.
6. Propagate user cancellation through the job, MCP client, scraper, and Puppeteer browser.
7. Return structured success, partial-success, recoverable-failure, and fatal-failure results to the AI conversation.
8. Let the chat model perform bounded recovery in a subsequent model round.
9. Preserve the option to add safe in-session AI recovery through a generic host capability later.
10. Keep AI credentials, plan gating, provider selection, and billing decisions inside the host application.
11. Avoid Yellow Pages TypeORM entities and direct plugin access to the application database.
12. Keep large result sets out of the model context by returning summaries, previews, and artifact references.
13. Make async MCP execution support generic so future browser plugins can reuse it.

## 4. Non-Goals

1. Preserve compatibility with the existing Yellow Pages create, edit, list, or task-management UI.
2. Preserve or migrate existing Yellow Pages TypeORM entities.
3. Add new Yellow Pages database entities to the host application.
4. Let the plugin access the application database directly.
5. Keep the old `src/childprocess/YellowPagesScraper.ts` as the production scraper after migration.
6. Allow the AI to execute arbitrary JavaScript, shell commands, or unrestricted Puppeteer code during recovery.
7. Guarantee survival of an active scrape across application restart in the first release.
8. Use the chat model as the first response to ordinary transient failures that deterministic code can handle.
9. Return thousands of complete business records directly in an AI tool message.
10. Make the Yellow Pages feature available when the plugin is missing, disabled, unhealthy, or missing dependencies.

## 5. Users and Primary Stories

### 5.1 Marketing operator

The operator installs the Yellow Pages plugin and asks AiChatV2 to find businesses by category and location. The operator sees progress, can stop the job, and receives a concise summary plus an export artifact.

### 5.2 Operator without the plugin

The operator does not install the plugin. Yellow Pages tools and commands do not appear in AiChatV2. The application carries no active scraper process or Yellow Pages browser workload.

### 5.3 Operator facing a changed website

The scraper detects that configured result selectors no longer match. It returns safe diagnostics and allowed recovery strategies. The chat model retries with a fallback adapter or explains that the site needs user intervention.

### 5.4 Plugin developer

The developer can add or update platform adapters inside the plugin without changing AiFetchly core code or its database schema.

## 6. Guiding Design Decisions

### 6.1 The host owns orchestration; the plugin owns scraping

The application is responsible for jobs, AI chat, permissions, policy, audit, and lifecycle. The plugin is responsible for Puppeteer and Yellow Pages behavior. This prevents domain code from leaking back into AiFetchly core.

### 6.2 Async is a runtime policy

The model must not decide whether the operation runs asynchronously. Plugin tool policy declares it. Skill prose may explain expected behavior, but prose is not an execution guarantee.

### 6.3 Managed async is the first-release execution mode

The local query loop waits by polling `ToolJobRegistry`, emits progress, and eventually injects the real tool result into the next model round. The model does not receive a placeholder `{ async: true, job_id }` response during ordinary chat.

This is called managed async because the host manages the background execution while preserving one model-to-tool-to-model sequence.

### 6.4 Recoverable scraper failures are data, not transport failures

Selector changes, partial extraction, a navigation timeout after internal retries, or a platform block are application-level results. They must be returned as normal MCP content with `success: false` and a structured error object.

MCP protocol errors are reserved for conditions such as a crashed server, malformed protocol messages, unavailable runtime, or a broken transport.

### 6.5 AI recovery is bounded and constrained

The model may select from plugin-declared recovery strategies. It may not invent arbitrary browser programs. Every retry has a budget, a fingerprint, and a terminal policy.

### 6.6 Large outputs become artifacts

The model receives enough information to summarize and reason about the result, not the entire dataset. Complete records are stored as a JSON or CSV artifact in plugin-scoped storage exposed through a host-approved mechanism.

## 7. Target Architecture

```text
AiChatV2 renderer
  -> AI chat IPC handler
  -> AIChatQueryLoop
  -> remote AI server returns a Yellow Pages tool call
  -> MCP tool execution policy resolves to "async"
  -> ToolJobRegistry creates a conversation-scoped job
  -> MCPToolService starts the installed plugin MCP process
  -> plugin MCP server starts Puppeteer
  -> platform adapter navigates and extracts records
  -> progress/partial notifications flow to host and AiChatV2
  -> plugin returns success, partial success, or structured failure
  -> ToolJobRegistry reaches a terminal state
  -> AIChatQueryLoop appends a role:"tool" message
  -> remote AI server receives a new request
  -> model summarizes, retries, switches strategy, or asks the user
```

### 7.1 Remote AI connection behavior

The remote AI request that produced the tool call is complete before the local scrape starts. No remote completion stream must remain open for the duration of Puppeteer work.

The host retains the conversation messages and tool call ID locally. When the scrape reaches a terminal state, the host sends the tool result in a later AI request. This is the mechanism that avoids remote function-call timeout.

### 7.2 Process lifetime

For managed async execution, one MCP process may be started for the call and remain alive until the call completes, fails, or is cancelled. The host disconnects it only after terminal cleanup.

A persistent MCP daemon is not required for the first release. It becomes necessary only if the MCP call returns a detached job ID while browser work continues after the response.

## 8. Plugin Package

### 8.1 Proposed layout

```text
yellow-pages-scraper-plugin/
├── .aifetchly-plugin/
│   └── plugin.json
├── .mcp.json
├── skills/
│   └── yellow-pages-scraper/
│       └── SKILL.md
├── commands/
│   └── yellow-pages.md
├── hooks/
│   └── hooks.json
├── src/
│   ├── mcp-server.ts
│   ├── tools/
│   │   ├── scrapeYellowPages.ts
│   │   └── listPlatforms.ts
│   ├── scraper/
│   │   ├── YellowPagesScraper.ts
│   │   ├── BrowserSession.ts
│   │   ├── RecoveryCoordinator.ts
│   │   ├── ResultArtifactWriter.ts
│   │   └── errors.ts
│   └── platforms/
│       ├── PlatformAdapter.ts
│       └── adapters/
├── dist/
│   └── yellow-pages-mcp.cjs
└── package.json
```

### 8.2 Component responsibilities

| Component               | Responsibility                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Skill                   | Teaches the chat model when to use the scraper, how to interpret errors, and which retries are allowed. |
| Slash command           | Expands a user command such as `/yellow-pages dentists in Chicago` into a clear chat request.           |
| PreToolUse hook         | Enforces retry budgets, input limits, platform restrictions, and required permissions before execution. |
| PostToolUseFailure hook | Adds model-facing recovery guidance without changing the underlying error facts.                        |
| MCP server              | Implements the actual tools and owns the Puppeteer process.                                             |
| Platform adapters       | Contain site-specific navigation and extraction behavior.                                               |
| Recovery coordinator    | Runs deterministic fallbacks and classifies failures.                                                   |
| Artifact writer         | Writes complete results to approved plugin-scoped storage.                                              |

The skill, command, and hooks do not scrape pages. The MCP server and its imported scraper modules do the work.

## 9. Plugin Manifest and Tool Policy

### 9.1 Existing manifest compatibility

The current `PluginManifest` accepts unknown top-level fields for diagnostics, but the host does not yet consume tool execution policies. The product needs a typed, validated policy surface rather than relying on an ignored custom field.

### 9.2 Proposed manifest extension

```json
{
  "name": "yellow-pages-scraper",
  "displayName": "Yellow Pages Scraper",
  "version": "1.0.0",
  "description": "Find and export business listings from supported Yellow Pages platforms.",
  "skills": ["skills/yellow-pages-scraper"],
  "mcpServers": [".mcp.json"],
  "permissions": ["network", "automation", "plugin-storage", "ai-recovery"],
  "toolPolicies": {
    "scraper/scrape_yellow_pages": {
      "timeoutClass": "async",
      "maxRunMs": 1800000,
      "supportsProgress": true,
      "supportsPartialResult": true,
      "cancellable": true,
      "maxConcurrentPerConversation": 1
    }
  }
}
```

The exact manifest field name may change during technical design, but the behavior is required.

### 9.3 Policy identity

Policy must use a stable plugin/server/tool identity such as `pluginName/serverName/toolName`. It must not depend on a database-generated MCP server ID.

At runtime, the host maps that identity to the canonical AI tool name:

```text
mcp__yellow-pages-scraper__scraper__scrape_yellow_pages
```

### 9.4 Policy resolution order

The query loop should resolve policy in this order:

1. Explicit registered built-in skill policy.
2. Validated plugin MCP tool policy.
3. Generic tool-name inference as a compatibility fallback.

No Yellow Pages-specific conditional should be added to `AIChatQueryLoop` or `ToolTimeoutPolicy`.

## 10. MCP Tool Surface

### 10.1 Primary tool

The first release should expose one primary tool:

```text
scrape_yellow_pages
```

The model should not coordinate separate low-level tools for browser startup, page navigation, selector testing, pagination, and export. Those operations belong inside one plugin-owned workflow.

### 10.2 Optional discovery tool

The plugin may expose:

```text
list_yellow_pages_platforms
```

The primary tool should still be able to choose a platform automatically, so platform discovery is not a required preliminary call.

### 10.3 Primary input contract

```json
{
  "query": "dentists",
  "location": "Chicago, IL",
  "platform": "auto",
  "maxResults": 100,
  "includeDetailPages": true,
  "fields": [
    "businessName",
    "phone",
    "email",
    "website",
    "address",
    "categories"
  ],
  "recovery": {
    "previousErrorId": "err_8f31",
    "strategy": "fallback_adapter"
  }
}
```

### 10.4 Input rules

- `query` and `location` are required non-empty strings.
- `platform` is an approved platform identifier or `auto`.
- `maxResults` has a plugin-defined upper bound.
- `fields` is an allowlisted enum.
- `recovery` is optional and accepted only after a compatible previous failure.
- The model cannot supply JavaScript, executable expressions, arbitrary browser commands, cookies, or credentials.
- Advanced selector overrides, if ever supported, require strict validation and separate user permission.

### 10.5 Successful result contract

```json
{
  "success": true,
  "status": "completed",
  "summary": {
    "platform": "yellowpages.com",
    "query": "dentists",
    "location": "Chicago, IL",
    "recordCount": 86,
    "pagesVisited": 7,
    "detailPagesVisited": 86,
    "durationMs": 312450
  },
  "artifact": {
    "id": "yp_20260728_a81c",
    "format": "json",
    "recordCount": 86,
    "sizeBytes": 184220
  },
  "preview": [],
  "warnings": []
}
```

### 10.6 Partial-success contract

```json
{
  "success": true,
  "status": "partial",
  "summary": {
    "recordCount": 41,
    "expectedCount": 100,
    "pagesVisited": 4
  },
  "artifact": {
    "id": "yp_20260728_b72d",
    "format": "json",
    "recordCount": 41
  },
  "partial": true,
  "remaining": {
    "reason": "platform_rate_limit",
    "resumeStrategy": "retry_after_delay",
    "retryAfterMs": 120000
  },
  "warnings": ["The platform stopped returning result pages after page 4."]
}
```

Partial success should remain `success: true` when the collected data is useful and the primary requested operation has produced a usable artifact. The model can explain the limitation or offer a follow-up scrape.

## 11. Managed Async Job Lifecycle

### 11.1 Required state machine

```text
queued
  -> running
       -> completed
       -> failed
       -> cancelled
```

The job may publish these progress phases while running:

```text
queued -> running -> fetching -> extracting -> finalizing
```

### 11.2 Job creation

When the model calls `scrape_yellow_pages`, `AIChatQueryLoop` resolves the MCP policy to `async` and registers a job using:

- Canonical tool name.
- Validated arguments.
- Conversation ID.
- Tool call ID.
- Deadline.
- Retry fingerprint or idempotency key.

The registry starts the MCP execution subject to its concurrency limits.

### 11.3 Progress propagation

The plugin emits progress through MCP notifications. The host maps one notification to both destinations:

1. `ToolJobRegistry.updateProgress(jobId, progress)` for job status.
2. `context.emitProgress(progress)` for the existing AiChatV2 `tool_progress` stream.

Example progress payload:

```json
{
  "phase": "extracting",
  "message": "Extracted 38 of approximately 100 businesses",
  "progress": 0.38,
  "partialCount": 38,
  "expectedCount": 100
}
```

Progress messages must be concise and contain no sensitive page data.

### 11.4 Partial-result propagation

The plugin periodically flushes complete records to an artifact and sends a bounded partial snapshot:

```json
{
  "collectedCount": 38,
  "expectedCount": 100,
  "artifactId": "yp_20260728_a81c",
  "preview": []
}
```

The host maps this to `ToolJobRegistry.updatePartial`. It must not retain a growing array of all records in memory solely for chat progress.

### 11.5 Completion

On completion, the MCP tool returns a structured result. The job handle resolves. The query loop observes `completed`, creates a normal `ToolExecutionResult`, emits `tool_result`, appends the `role: "tool"` message, and continues to a new model round.

### 11.6 Failure

A recoverable application failure resolves the underlying MCP request with structured content but produces `ToolExecutionResult.success = false` in the host. This triggers failure hooks and gives the model a complete error object.

A transport or process failure rejects the job with a sanitized fatal error.

### 11.7 Cancellation

Cancellation must propagate end to end:

```text
User presses Stop
  -> AI turn AbortController aborts
  -> ToolJobRegistry.cancel(jobId)
  -> registered job cancel handler runs
  -> per-job AbortController aborts
  -> MCP cancellation reaches plugin
  -> scraper stops page loops
  -> Puppeteer page and browser close
  -> MCP process exits
  -> host sends SIGTERM, then SIGKILL after a grace period if needed
```

The current async path must register `handle.onCancel` and pass the resulting signal into MCP execution. Cancelling only the in-memory registry record is insufficient.

### 11.8 Deadline behavior

The job has one authoritative deadline, for example 30 minutes. Inner MCP and request timeouts must derive from that deadline or be disabled for the managed async call.

When the deadline expires, the host must cancel the job and stop its browser before returning a timeout result. It must not tell the model to retry while the original scraper may still be running.

### 11.9 Duplicate suppression

The host creates a retry fingerprint from the conversation ID and canonicalized scrape arguments. Starting an equivalent scrape while one is queued or running returns the existing job identity or a structured `JOB_ALREADY_RUNNING` result.

This prevents duplicate Puppeteer sessions when a model retries after an uncertain timeout.

### 11.10 In-memory lifetime

The existing `ToolJobRegistry` is in memory. First-release behavior on application restart is:

- Active jobs are interrupted.
- The plugin process and browser are terminated with application shutdown.
- The chat receives or reconstructs an interrupted result when possible.
- The user may start a new scrape.

Restart survival is deferred. If later required, persist only generic job metadata and plugin artifacts through a host-owned service or plugin-scoped storage. Do not recreate Yellow Pages TypeORM entities.

## 12. AI Recovery Model

### 12.1 Two distinct recovery loops

The product must distinguish:

- Scraper recovery inside one MCP call.
- Conversation recovery after the MCP call returns.

The first preserves the browser session. The second starts a new tool call and normally a new browser session.

### 12.2 Level 1: deterministic plugin recovery

The plugin handles ordinary failures without calling AI:

- Retry a navigation timeout with bounded exponential delay.
- Reload after a transient empty response.
- Try packaged fallback selectors in priority order.
- Detect consent dialogs using known selectors.
- Reduce page concurrency after resource pressure.
- Retry a detail page without discarding completed records.
- Skip one malformed listing and continue.
- Respect `Retry-After` or plugin rate policy.

Every operation has a maximum attempt count. Deterministic retry history is included in final diagnostics.

### 12.3 Level 2: outer-chat recovery

Outer-chat recovery is required for the first release.

Flow:

```text
Plugin cannot recover deterministically
  -> plugin closes or finalizes browser state
  -> plugin returns structured recoverable failure and partial artifact
  -> host preserves success:false
  -> query loop appends tool result
  -> next AI request includes the failure
  -> model selects one allowed recovery strategy
  -> model calls scrape_yellow_pages again
  -> host creates a new bounded job
```

This works with the current MCP process lifecycle because each retry is a new call. It does not require a persistent daemon or a live browser continuation token.

### 12.4 Model recovery choices

Depending on the error, the model may:

- Retry with `fallback_adapter`.
- Retry with a smaller `maxResults`.
- Retry without detail-page visits.
- Retry after the supplied delay.
- Select another supported platform.
- Use and summarize partial results.
- Ask the user to complete authentication or CAPTCHA verification.
- Explain that a missing dependency or plugin bug requires repair rather than retry.

### 12.5 Retry limits

- Default maximum outer-chat recovery attempts: 2.
- Hard maximum: 3.
- Identical recovery strategy and argument fingerprint may not repeat after the same failure code.
- CAPTCHA, authentication, permission, and missing-runtime failures are not automatically retried.
- A rate-limit failure cannot retry before `retryAfterMs`.
- Recovery calls count toward the existing maximum model-tool round budget.

The skill and failure hook instruct the model about these limits. The MCP server also enforces them because instructions and hooks are not security boundaries.

## 13. Structured Failure Contract

### 13.1 Required shape

```json
{
  "success": false,
  "status": "failed",
  "error": {
    "id": "err_8f31",
    "code": "RESULT_SELECTOR_NOT_FOUND",
    "category": "site_changed",
    "stage": "extracting",
    "message": "The configured result selector matched no elements.",
    "recoverable": true,
    "attempt": 1,
    "maxAttempts": 3,
    "retryAfterMs": null,
    "allowedStrategies": [
      "fallback_adapter",
      "reduced_scope",
      "switch_platform"
    ],
    "safeObservation": {
      "platform": "yellowpages.com",
      "pageTitle": "Search Results",
      "urlOrigin": "https://www.yellowpages.com",
      "urlPath": "/search",
      "selectorMatchCounts": {
        ".business-result": 0,
        ".listing": 24
      },
      "challengeType": null
    }
  },
  "partial": {
    "count": 17,
    "artifactId": "yp_20260728_a81c",
    "preview": []
  }
}
```

### 13.2 Error categories

| Category        | Meaning                                                    | Default model behavior                                   |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| `transient`     | Temporary navigation, network, or page-load failure.       | Retry once after deterministic attempts.                 |
| `site_changed`  | Known selectors or navigation assumptions no longer match. | Use a fallback adapter or constrained AI recovery.       |
| `rate_limited`  | Platform requests are being throttled.                     | Wait for `retryAfterMs`; do not retry immediately.       |
| `blocked`       | CAPTCHA, bot challenge, login, or access denial.           | Ask the user or switch platform.                         |
| `invalid_input` | Query, location, platform, or recovery request is invalid. | Correct arguments without repeating the same call.       |
| `dependency`    | Browser executable or required system package is missing.  | Offer dependency installation or plugin repair.          |
| `permission`    | Required host permission is absent or denied.              | Ask for permission through the host flow.                |
| `plugin_bug`    | Internal invariant, adapter, or package failure.           | Stop and report diagnostics; do not retry automatically. |
| `cancelled`     | User or host cancelled the job.                            | Do not retry unless the user asks.                       |

### 13.3 Error codes

The initial stable code set should include:

- `NAVIGATION_TIMEOUT`
- `RESULT_SELECTOR_NOT_FOUND`
- `DETAIL_SELECTOR_NOT_FOUND`
- `EMPTY_RESULTS`
- `PLATFORM_RATE_LIMITED`
- `CAPTCHA_REQUIRED`
- `AUTHENTICATION_REQUIRED`
- `PLATFORM_UNSUPPORTED`
- `INVALID_RECOVERY_REQUEST`
- `BROWSER_EXECUTABLE_MISSING`
- `PLUGIN_PERMISSION_DENIED`
- `JOB_ALREADY_RUNNING`
- `JOB_DEADLINE_EXCEEDED`
- `PLUGIN_PROCESS_EXITED`
- `SCRAPER_INTERNAL_ERROR`
- `USER_CANCELLED`

Codes are machine-stable. Human messages may improve without changing model control flow.

### 13.4 Safe diagnostics

The plugin may include:

- Platform identifier.
- Page title.
- URL origin and bounded path.
- Current scraper stage.
- Selector names and match counts.
- A short sanitized DOM observation.
- Visible labels relevant to the failed step.
- Challenge classification.
- Attempt history.
- A temporary screenshot artifact ID with an expiry.

The plugin must not include:

- Cookies or authorization headers.
- Passwords, tokens, API keys, or session storage.
- Full page HTML.
- Unbounded screenshots encoded in the tool result.
- Hidden form values.
- Raw browser profiles.
- Arbitrary local file paths.
- Personal data unrelated to the requested business extraction.

## 14. MCP Result Normalization Requirements

### 14.1 Recoverable failures must not use MCP `isError`

The current `MCPClient.callTool` throws when an MCP result has `isError: true`. Throwing converts useful structured diagnostics into a generic error string. The plugin must return recoverable failures as ordinary text or structured content containing `success: false`.

### 14.2 Host must preserve nested failure state

The current MCP fallback path constructs a successful `ToolExecutionResult` whenever `ToolExecutor.execute` returns, even if the returned object contains `{ success: false }`. This would prevent the normal `PostToolUseFailure` route.

The host must normalize MCP content so that:

```text
plugin result success:false
  -> ToolExecutionResult.success:false
  -> PostToolUseFailure hooks
  -> tool_result event with complete structured error
  -> role:"tool" message to the next AI round
```

### 14.3 Fatal failures

Protocol-level `isError`, process exits, malformed JSON-RPC, connection failures, and trust failures become fatal `ToolExecutionResult` values with sanitized messages. They do not expose command-line arguments, environment variables, or local secrets.

## 15. In-Session AI Recovery

### 15.1 Purpose

Outer-chat recovery loses the live page because the MCP call has returned and the process is disconnected. Some failures are easier to solve while the exact browser page remains open, such as a changed search form or an unexpected consent screen.

In-session recovery is a later phase in which the plugin pauses its current Puppeteer workflow, asks the host for an AI-generated constrained action plan, executes validated actions, and continues the same job.

### 15.2 Why returning an error is insufficient

Returning an MCP result completes the tool call. `MCPToolService` currently disconnects the client in `finally`, and the stdio client kills the child process on disconnect. Therefore, a returned error can help the next AI round start a fresh attempt, but it cannot resume the same browser session.

### 15.3 Recommended transport

Use a generic host AI broker through one of these mechanisms:

1. MCP sampling or another standard server-to-client request supported by the chosen MCP SDK.
2. A narrowly scoped AiFetchly extension request if standard sampling is unavailable.

The MCP option is preferred because it avoids creating a Yellow Pages-only reverse protocol.

The current client advertises no capabilities and only handles response messages. It must be extended before this phase can work.

### 15.4 Broker flow

```text
Plugin detects a recoverable live-page failure
  -> plugin captures sanitized observation
  -> plugin sends request_ai_recovery with correlation ID
  -> host verifies plugin permission and USER_AI_ENABLED
  -> host validates and caps the request
  -> host calls the configured AI provider or recovery endpoint
  -> host validates the returned action schema
  -> host returns approved actions to plugin
  -> plugin executes actions against the still-open page
  -> plugin reports action results
  -> loop repeats within budget or terminates
```

### 15.5 AI ownership

The plugin must not receive provider credentials or import host token services. The host owns:

- `USER_AI_ENABLED` gating before request parsing or provider access.
- Provider selection.
- Authentication and billing.
- AI request timeout.
- AI-recovery rate limits.
- Payload size limits.
- Audit logging.
- Response schema validation.

The plugin owns:

- The recovery goal.
- The sanitized page observation.
- The list of actions it is capable of executing.
- Interpretation of approved actions.
- Browser cleanup when recovery fails.

### 15.6 Allowed action DSL

The response is a data-only action list. Initial action types:

- `wait`
- `reload`
- `click`
- `type`
- `press_key`
- `scroll`
- `wait_for_selector`
- `use_fallback_adapter`
- `skip_listing`
- `skip_page`
- `give_up`

Each action includes an ID, type, bounded timeout, description, and only the fields required by that type.

The host and plugin reject:

- Arbitrary JavaScript.
- `page.evaluate` source.
- Shell commands.
- Filesystem commands.
- Navigation to an unapproved origin.
- Unbounded selector strings.
- Action counts above the configured maximum.
- Timeouts above the remaining job deadline.
- Credential or cookie manipulation.

### 15.7 Recovery budgets

- Maximum in-session AI iterations per failure: 3.
- Maximum actions per response: 5.
- AI request timeout: 30 seconds by default.
- Page observation size: 50 KB maximum after sanitization.
- Only one screenshot artifact per iteration.
- Previous action history is capped to the five most recent actions.
- Repeated failed action fingerprints terminate the loop.

These values preserve the useful safeguards already present in `YellowPagesAiSupportHandler` and `YellowPagesScraper.requestAiSupport`.

## 16. Failure Policy Matrix

| Failure                     | Plugin action                                | Outer AI action                                 | In-session AI eligible              | User-facing result                        |
| --------------------------- | -------------------------------------------- | ----------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| First navigation timeout    | Retry with delay.                            | None.                                           | No.                                 | Progress continues.                       |
| Repeated navigation timeout | Return transient error and partial artifact. | Retry once or reduce scope.                     | Optional.                           | Explain incomplete scrape.                |
| Known selector misses       | Try packaged fallbacks.                      | None if fallback works.                         | Yes after fallbacks fail.           | Progress continues or structured failure. |
| Unknown result layout       | Capture safe observation.                    | Retry with fallback adapter or switch platform. | Yes.                                | Explain site change if unresolved.        |
| One malformed listing       | Skip and record warning.                     | None.                                           | No.                                 | Successful result with warning.           |
| Partial extraction          | Finalize artifact.                           | Use partial data or retry remaining scope.      | Optional.                           | Partial-success summary.                  |
| HTTP 429                    | Respect delay and reduce request rate.       | Retry only after `retryAfterMs`.                | No.                                 | Waiting or rate-limit explanation.        |
| CAPTCHA                     | Stop automated interaction.                  | Ask user or switch platform.                    | Detection only; no bypass behavior. | User intervention required.               |
| Login required              | Stop before credentials are requested.       | Ask user to configure approved authentication.  | No credential generation.           | Permission/authentication guidance.       |
| Browser missing             | Return dependency error.                     | Offer dependency installation flow.             | No.                                 | Plugin needs repair.                      |
| Plugin process crash        | Host cleans up and returns fatal error.      | Do not retry automatically.                     | No.                                 | Diagnostic error.                         |
| User cancellation           | Close browser immediately.                   | Do not retry.                                   | No.                                 | Turn cancelled.                           |

## 17. Security and Privacy Requirements

### 17.1 Plugin process trust

An MCP stdio plugin executes local code. Installation and enablement must make the requested permissions visible. The host must continue to apply plugin trust checks, executable path validation, environment allowlisting, and command restrictions before process spawn.

### 17.2 Environment isolation

The plugin process receives only allowlisted environment values and explicitly configured plugin options. It must not inherit the full Electron main-process environment.

### 17.3 Network scope

The plugin declares the supported platform origins. Runtime navigation should remain on those origins and required first-party asset origins unless the user grants broader access.

### 17.4 Browser data

Browser profiles, cookies, and authentication data are passed only through an approved host capability. They are never placed in AI prompts, logs, tool results, or artifacts.

### 17.5 AI prompt injection

Page content is untrusted. Text found on a scraped page must be treated as data, never as instructions. The recovery broker constructs its own system policy, delimits page observations, and accepts only the action DSL.

### 17.6 Result privacy

Artifacts contain only fields requested by the user and permitted by product policy. Logs and telemetry record counts and error codes, not complete business records or page content.

## 18. Artifacts and Data Retention

### 18.1 Artifact requirement

Because Yellow Pages entities are being removed, complete results must be represented as an artifact rather than database rows.

Supported first-release formats:

- JSON for lossless structured data.
- CSV for export and spreadsheet workflows.

### 18.2 Artifact response

The tool result includes:

- Stable artifact ID.
- Format.
- Record count.
- Size.
- Small preview.
- Creation time.
- Optional expiration time.

The model should use the preview and summary. A separate approved file/artifact tool may inspect or export the complete content.

### 18.3 Storage boundary

The plugin writes only to plugin-scoped storage or through a host artifact service. It does not write to the application database. Artifact paths must not escape the approved root.

### 18.4 Retention

Retention is controlled by a generic artifact policy. Plugin uninstall may offer removal of plugin artifacts, but it must not silently delete user-exported files.

## 19. Plugin Installation and Availability

### 19.1 Installation

The plugin is installed through the existing plugin manager. Installation validates:

- Manifest structure and version.
- MCP declaration.
- Entrypoint confinement to the plugin root.
- Requested permissions.
- Runtime and browser dependencies.
- Tool policy schema.
- Skill, command, and hook files.

### 19.2 Enablement

When enabled:

- The skill is registered.
- The slash command is registered.
- Hooks are registered.
- MCP tools are added to the AI tool catalog.
- The host registers the plugin tool policies.

When disabled or uninstalled:

- No new scrape can start.
- Tools disappear from the model catalog.
- Commands and hooks are removed.
- Tool policies are unregistered.
- Active jobs receive cancellation and cleanup before process removal.

### 19.3 Dependency handling

Puppeteer and its browser executable belong to the plugin dependency plan. The plugin must declare required system dependencies so the existing dependency diagnostics and installation flow can report missing components before the first scrape.

Production packaging must not assume a globally installed `node` command. The host must launch the bundled plugin entry using an application-managed JavaScript runtime or another packaged executable strategy.

### 19.4 Current runtime gap

MCP is a protocol, not a JavaScript runtime. An MCP request cannot execute the plugin until the host has started an MCP server process capable of reading and writing JSON-RPC over stdin and stdout.

The current MCP implementation requires every stdio server declaration to contain a non-empty `command`. `MCPClient.connectStdio` passes that command and its arguments directly to `child_process.spawn`. A declaration such as the following therefore depends on a system-installed Node executable:

```json
{
  "mcpServers": {
    "scraper": {
      "transport": "stdio",
      "command": "node",
      "args": ["dist/yellow-pages-mcp.cjs"]
    }
  }
}
```

This may work in development but is not an acceptable packaged-application design. A user may not have Node installed, the executable may not be on `PATH`, and the available Node version may not match the plugin build.

Until the host-managed runtime described below is implemented, a JavaScript MCP plugin has only two production choices: require an external Node installation or ship a platform-specific standalone executable. Neither is the preferred Yellow Pages plugin architecture.

### 19.5 Proposed host-managed runtime declaration

The plugin declares JavaScript code and a required host runtime rather than an operating-system executable:

```json
{
  "mcpServers": {
    "scraper": {
      "transport": "stdio",
      "runtime": "aifetchly-node",
      "entry": "dist/yellow-pages-mcp.cjs",
      "timeout": 1800000
    }
  }
}
```

Required semantics:

- `runtime: "aifetchly-node"` means AiFetchly supplies its embedded JavaScript runtime.
- `entry` is a plugin-relative path to a built JavaScript file.
- The loader resolves and validates the entry against the installed plugin root.
- Absolute paths, path traversal, symlink escape, and entrypoints outside the plugin root are rejected.
- The plugin does not declare `ELECTRON_RUN_AS_NODE`, `NODE_PATH`, or an AiFetchly executable path.
- The host decides the actual executable and trusted runtime environment.

The exact persisted representation may use typed runtime fields or an internal command token. The public plugin contract must remain runtime-and-entry based and must not expose the application executable as a plugin-controlled command.

### 19.6 Electron provides the Node runtime

Electron includes a Node runtime. In both development and a packaged application, the main process can launch the executable represented by `process.execPath` in Node mode:

```typescript
const child = spawn(process.execPath, [resolvedPluginEntry], {
  cwd: pluginInstallRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...safeHostEnvironment,
    ELECTRON_RUN_AS_NODE: "1",
  },
});
```

`process.execPath` points to the running Electron executable. `ELECTRON_RUN_AS_NODE=1` tells that executable to run the supplied JavaScript entry as Node instead of starting another Electron application instance.

AiFetchly already uses this mechanism for the application-owned Google Maps and Yandex Maps workers. The plugin runtime should extract this behavior into a generic, policy-checked MCP process launcher rather than duplicating it in Yellow Pages code.

The existing MCP environment filter correctly rejects plugin-supplied `ELECTRON_*` variables, including `ELECTRON_RUN_AS_NODE`, because allowing an untrusted declaration to control Electron startup can enable process hijacking. The generic launcher must:

1. Build the normal allowlisted child environment.
2. Reject prohibited plugin-supplied variables.
3. Resolve and validate the plugin entrypoint.
4. Inject `ELECTRON_RUN_AS_NODE=1` from trusted host code after filtering.
5. Start the process with `shell: false` and piped stdin, stdout, and stderr.
6. Keep secrets, database paths, cookies, and unrelated Electron variables out of the child environment.

The plugin never needs to know the path to the Electron executable and cannot override the trusted launch flags.

### 19.7 MCP-to-Puppeteer execution sequence

```text
AI calls scrape_yellow_pages
  -> AIChatQueryLoop creates a ToolJobRegistry job
  -> MCPToolService resolves the installed plugin server
  -> host launcher resolves dist/yellow-pages-mcp.cjs
  -> host starts process.execPath in Node mode
  -> plugin MCP server initializes over stdin/stdout
  -> host sends tools/call JSON-RPC request
  -> plugin MCP handler receives scrape_yellow_pages
  -> handler creates or invokes YellowPagesScraper
  -> scraper launches the approved Chrome or Chromium executable
  -> scraper emits progress and partial MCP notifications
  -> scraper returns the structured final result
  -> host resolves the job and disconnects after cleanup
```

The plugin MCP entrypoint is a thin protocol adapter. Its tool handler delegates to plugin-owned scraper modules:

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "scrape_yellow_pages") {
    return createUnknownToolResult(request.params.name);
  }

  const scraper = new YellowPagesScraper(browserRuntime);
  return scraper.scrape(request.params.arguments);
});
```

The actual page navigation, selectors, pagination, extraction, retries, and browser cleanup remain in modules such as:

```text
src/scraper/YellowPagesScraper.ts
src/scraper/BrowserSession.ts
src/platforms/adapters/YellowPagesComAdapter.ts
```

The MCP server receives and returns messages. It does not replace the scraper implementation.

### 19.8 Node and Chrome are separate runtime dependencies

Running Puppeteer requires two distinct executables:

| Runtime                  | Purpose                                                                 | Recommended owner                       |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| Electron's embedded Node | Executes `yellow-pages-mcp.cjs`, the MCP SDK, and Puppeteer JavaScript. | AiFetchly host                          |
| Chrome or Chromium       | Loads and interacts with Yellow Pages websites.                         | Generic host browser dependency service |

The plugin does not need to bundle Node. It still needs access to a compatible Chrome or Chromium executable.

The recommended browser design is:

1. The plugin bundles or ships `puppeteer-core` and its JavaScript scraper dependencies.
2. A generic host browser dependency service locates or installs a supported browser.
3. The host passes an approved browser executable path through trusted startup configuration or MCP initialization data.
4. The plugin verifies the supplied file and launches it with `puppeteer.launch({ executablePath })`.
5. The plugin does not import AiFetchly's internal `BrowserManager`, query application settings directly, or read a browser path from the application database.

Passing the browser path through a trusted host capability keeps browser installation reusable across plugins without coupling the plugin to AiFetchly source modules.

### 19.9 Plugin JavaScript dependency packaging

The plugin has two supported packaging strategies:

1. Bundle the MCP SDK, scraper, adapters, `puppeteer-core`, and compatible pure-JavaScript dependencies into `dist/yellow-pages-mcp.cjs`.
2. Ship the compiled `dist` files with production-only plugin-local `node_modules` for packages that cannot be bundled reliably.

A mostly bundled CommonJS entrypoint is preferred because it limits module-resolution differences between development and packaged builds. Puppeteer-related packages that depend on dynamic files may remain plugin-local dependencies when required.

The plugin must not:

- Resolve modules through AiFetchly's private application `node_modules`.
- Depend on `NODE_PATH`.
- Assume paths inside `app.asar` are writable or executable.
- Include native modules unless they have a declared, verified Electron/Node ABI compatibility strategy.
- Download or execute unverified JavaScript during MCP startup.

Using `puppeteer-core` keeps the plugin code independent from the browser binary. Shipping full `puppeteer` with its own Chromium download is allowed only if package-size, signature, update, and cleanup policies explicitly support it.

### 19.10 Alternatives considered

**Require system Node:** Rejected for the default plugin. It adds an undeclared machine dependency and version variance.

**Ship a standalone executable:** Viable for plugins built separately for every operating system and architecture, but it increases package size, signing work, update complexity, and Puppeteer packaging effort.

**Use `utilityProcess.fork`:** Electron can execute JavaScript in a utility process, but the current MCP client expects stdin/stdout JSON-RPC. Adopting `utilityProcess` would require a new MCP transport adapter. It is not the smallest first implementation.

**Import Puppeteer from AiFetchly's application bundle:** Rejected. It couples plugin behavior to private package layout and application releases. The host may manage the browser executable, but the plugin owns its JavaScript client dependency.

## 20. AiChatV2 Experience

### 20.1 Tool discovery

The chat model sees the Yellow Pages tool only when the plugin and its MCP server and tool are enabled and healthy.

### 20.2 Running state

The existing tool card displays:

- Current phase.
- Concise progress message.
- Progress fraction when known.
- Collected and expected counts.
- Stop behavior through the existing chat cancellation control.

No new Yellow Pages management page is required.

### 20.3 Completion state

The AI response summarizes:

- Search query and location.
- Selected platform.
- Records found.
- Important warnings.
- Artifact availability.
- Whether the result is complete or partial.

### 20.4 Failure state

The AI does not expose raw diagnostic payloads unless they help the user. It translates the stable error into an action:

- Retrying with an allowed strategy.
- Waiting for a rate limit.
- Switching platform.
- Asking for authentication or CAPTCHA intervention.
- Reporting a missing dependency or plugin failure.

## 21. Existing Implementation Assessment

### 21.1 Reusable host capability

`src/service/ToolJobRegistry.ts` already provides:

- `queued`, `running`, `completed`, `failed`, and `cancelled` states.
- Maximum concurrent jobs.
- Progress snapshots.
- Partial snapshots.
- Conversation-scoped status lookup.
- Cancellation handlers.
- Terminal-job eviction.

This should remain a generic host service.

### 21.2 Current managed async behavior

`src/service/AIChatQueryLoop.ts` currently registers async work in `ToolJobRegistry`, polls every 15 seconds, emits `tool_progress`, and waits up to 30 minutes before producing a tool result.

Some comments and skill descriptions still state that the loop immediately returns `{ async: true, job_id }` and expects the model to poll. That documentation conflicts with the implemented managed-async behavior and must be corrected as part of this work.

### 21.3 Current MCP policy gap

`AIChatQueryLoop.executePreparedToolWithTimeout` resolves timeout metadata only from registered skills before falling back to name inference. Discovered plugin MCP tools are not registered `SkillDefinition` records, so their async policy is not available.

### 21.4 Current context gap

`ToolExecutor.executeInternal` receives a `ModuleExecutionContext`, but its MCP branch calls `executeMCPTool` without that context. MCP tools therefore cannot receive the existing progress emitter or cancellation signal.

### 21.5 Current timeout conflict

`MCPToolService.executeMCPTool` races every call against `MCP_CALL_TIMEOUT_MS`, currently 240 seconds, and always disconnects the MCP client in `finally`. A managed async scrape would still fail after four minutes unless the call timeout becomes policy-aware.

`MCPClient.sendRequest` also has a request timeout. All nested limits must respect the job deadline.

### 21.6 Current notification gap

`MCPClient.handleMessage` resolves JSON-RPC responses by numeric ID but ignores notifications and server-to-client requests. Progress, partial snapshots, cancellation acknowledgement, and future sampling need explicit protocol handling.

### 21.7 Current failure normalization gap

`MCPClient.callTool` throws for MCP `isError`. `ToolExecutor.executeMCPTool` wraps a returned plugin result in `{ success: true, result }`. `SkillExecutor.executeViaToolExecutor` then sets `ToolExecutionResult.success = true` whenever the executor returns.

Without normalization, `{ success: false }` from the plugin is nested inside an outer success and failure hooks do not receive the right signal.

### 21.8 Current cancellation gap

The async query loop cancels the registry job when the chat is stopped, but its async spawn path does not currently register a job cancellation handler or pass a per-job abort signal to the tool execution context.

### 21.9 Legacy AI support worth preserving

The current Yellow Pages worker and handler already contain useful concepts:

- `AI_SUPPORT_REQUEST` and correlated responses.
- Request types for step guidance, contact extraction, and observe-execute.
- AI enable checking in the main process.
- Page-content size limits.
- Screenshot validation and upload.
- AI request timeout.
- Request rate limits.
- Response caching.
- Sanitized previous-action history.
- Iteration limits.
- A constrained action list.

These outcomes should be preserved through a generic host broker, not by retaining `YellowPagesProcessManager` as a plugin dependency.

## 22. Required Host Changes

### HOST-01: MCP tool policy registry

Add a generic registry that loads validated tool policies from enabled plugins and resolves them by stable plugin/server/tool identity.

### HOST-02: Query-loop policy resolution

Update timeout resolution to consult the MCP tool policy registry before name inference.

### HOST-03: Context propagation

Pass `ModuleExecutionContext` through `ToolExecutor.executeMCPTool`, `MCPToolService.executeMCPTool`, and `MCPClient.callTool`.

### HOST-04: Job progress bridge

Map MCP progress notifications to the current execution context and to the correct `ToolJobRegistry` record.

### HOST-05: Partial-result bridge

Map bounded MCP partial notifications to `ToolJobRegistry.updatePartial`.

### HOST-06: Cancellation bridge

Create a per-job `AbortController`, register it with `ToolJobSpawnHandle.onCancel`, propagate cancellation to MCP, and kill an unresponsive process after a grace period.

### HOST-07: Deadline-aware MCP calls

Replace the unconditional 240-second MCP timeout for async calls with the remaining job deadline. Ensure the MCP request timer uses the same bound.

### HOST-08: MCP notification handling

Handle progress and partial notifications. Add server-to-client requests only when the in-session recovery phase begins.

### HOST-09: Result normalization

Preserve top-level plugin success and failure semantics through `MCPClient`, `ToolExecutor`, `SkillExecutor`, and `AIChatQueryLoop`.

### HOST-10: Duplicate suppression

Prevent equivalent queued or running scrape jobs from starting concurrently within one conversation.

### HOST-11: Terminal cleanup

On completion, failure, cancellation, timeout, plugin disablement, or application shutdown, close the browser and process and clear pending request state.

### HOST-12: Generic AI recovery broker

In the later phase, expose a provider-neutral, permission-gated, schema-validated host capability for in-session recovery.

### HOST-13: Documentation correction

Align `SkillDefinition` comments, built-in skill descriptions, async-job documentation, and tests with the selected managed-async behavior.

### HOST-14: Host-managed JavaScript MCP runtime

Extend plugin MCP declarations with a validated `aifetchly-node` runtime and plugin-relative entrypoint. Add a trusted launcher that runs `process.execPath` with an internally injected `ELECTRON_RUN_AS_NODE=1`, piped stdio, a confined working directory, and the existing sanitized environment. Do not require a system `node` executable.

### HOST-15: Generic browser runtime capability

Expose an approved Chrome or Chromium executable path to browser plugins without allowing them to read application settings or import application browser modules. Browser discovery, installation, version diagnostics, and path approval remain host-owned.

## 23. Required Plugin Behavior

### PLUGIN-01: Self-contained scraping runtime

All Yellow Pages browser, adapter, extraction, and recovery code ships inside the plugin package.

### PLUGIN-02: No application database access

The MCP process performs no TypeORM or application database operations.

### PLUGIN-03: Deterministic cleanup

Every terminal path closes pages, browser contexts, and the browser process.

### PLUGIN-04: Progress and partial notifications

The plugin emits bounded, correlated updates throughout browser startup, search, extraction, and artifact finalization.

### PLUGIN-05: Stable result schema

Success, partial success, recoverable failure, cancellation, and fatal failure follow versioned contracts.

### PLUGIN-06: Stable error taxonomy

The plugin uses stable error codes and allowed recovery strategies.

### PLUGIN-07: Retry enforcement

The plugin validates recovery requests, maximum attempts, delay requirements, and duplicate fingerprints.

### PLUGIN-08: Safe diagnostics

The plugin redacts secrets and caps all observations before returning or sending them to AI recovery.

### PLUGIN-09: Artifact output

The plugin writes complete results to approved storage and returns only a bounded preview to the model.

### PLUGIN-10: Dependency diagnostics

Missing browser or runtime components produce a stable dependency failure instead of a generic process crash.

### PLUGIN-11: Host-runtime-compatible entrypoint

The plugin ships a CommonJS MCP entrypoint that runs under AiFetchly's embedded Node version and resolves all JavaScript dependencies from its bundle or plugin-local production dependencies.

### PLUGIN-12: Browser runtime separation

The plugin uses `puppeteer-core` or an equivalent plugin-owned client library and launches only the host-approved browser executable. It does not import the application's Puppeteer package or `BrowserManager` implementation.

## 24. Non-Functional Requirements

### 24.1 Reliability

- No orphan Puppeteer process remains after a terminal job state.
- One failed listing does not discard completed records.
- A host timeout stops the underlying process before returning.
- Duplicate retries do not create duplicate live jobs.

### 24.2 Performance

- Progress begins within 10 seconds of job start or reports a queued state.
- Progress notifications are coalesced to avoid flooding IPC and rendering.
- Tool-result previews stay within the AI tool-content budget.
- Artifacts are streamed or incrementally written rather than accumulated twice in memory.

### 24.3 Compatibility

- Plugin enablement uses the existing plugin manager.
- MCP tool naming follows `mcp__<plugin>__<server>__<tool>`.
- Existing non-async MCP tools keep their current timeout behavior.
- Existing built-in async tools continue to use `ToolJobRegistry`.

### 24.4 Maintainability

- No Yellow Pages-specific branch is added to generic job, MCP, or query-loop services.
- Shared contracts use explicit TypeScript types and no `any`.
- Plugin and host protocol versions are independently diagnosable.

### 24.5 Observability

Record these metadata fields without page content or business records:

- Plugin version.
- Tool name.
- Job ID and conversation-correlated tool call ID.
- Platform identifier.
- Duration.
- Terminal status.
- Records collected.
- Error category and code.
- Deterministic retry count.
- Outer-chat recovery count.
- In-session AI recovery count when enabled.
- Cancellation latency.
- Cleanup outcome.

## 25. Testing Requirements

### 25.1 Host unit tests

- Plugin MCP policy resolves to `async`.
- Unknown MCP tools still receive the compatibility timeout.
- Async MCP calls are not terminated by the normal 240-second ceiling.
- Job progress notification updates both registry and event sink.
- Partial notification updates the correct job only.
- Cancellation invokes the job handler and aborts MCP execution.
- Deadline cancellation terminates an unresponsive process.
- Nested `{ success: false }` becomes `ToolExecutionResult.success = false`.
- Recoverable failure invokes failure hooks and reaches the next model round.
- Conversation scoping prevents one chat from reading another job.
- Duplicate fingerprints do not start a second job.

### 25.2 MCP client tests

- A host-managed plugin starts when no `node` executable exists on `PATH`.
- The launcher uses `process.execPath` and internally injects Node mode.
- A plugin-supplied `ELECTRON_RUN_AS_NODE`, `NODE_PATH`, or other prohibited environment variable remains rejected.
- Runtime entry path traversal and symlink escape are rejected.
- The launcher uses the plugin root as `cwd` and `shell: false`.
- Response correlation remains correct while notifications arrive.
- Unknown notifications are ignored safely.
- Progress notifications are schema validated.
- Malformed notifications do not crash the client.
- Request timers use the supplied deadline.
- Cancellation sends the protocol signal and cleans pending requests.
- Disconnect clears timers and process listeners.

### 25.3 Plugin unit tests

- The compiled CommonJS MCP entrypoint starts with AiFetchly's embedded Node version.
- JavaScript dependencies resolve from the bundle or plugin-local production dependencies without `NODE_PATH`.
- The scraper launches the supplied approved browser executable.
- A missing or incompatible browser produces `BROWSER_EXECUTABLE_MISSING` or another stable dependency error.
- Input validation and bounds.
- Platform selection.
- Adapter fallback order.
- Error classification.
- Recovery strategy validation.
- Retry budget enforcement.
- Safe diagnostic redaction.
- Artifact path confinement.
- Partial-result finalization.
- Browser cleanup on every terminal path.

### 25.4 Integration tests

- AI model requests the installed plugin tool.
- A mocked long scrape exceeds four minutes without MCP timeout.
- Progress appears in AiChatV2.
- Stop cancels the actual browser process promptly.
- A selector failure reaches the model as structured tool content.
- The model retries with an allowed fallback and succeeds.
- A repeated identical failure terminates without a loop.
- Partial records remain available after a later page fails.
- Disabling the plugin removes the tool from the catalog.
- Uninstalling during an active job cancels and cleans the job.

### 25.5 In-session recovery tests

- Host rejects recovery when `USER_AI_ENABLED` is not `true` before parsing or calling AI.
- Oversized observations are rejected or reduced.
- Credentials and cookies are redacted.
- AI actions outside the allowlist are rejected.
- Cross-origin navigation is rejected.
- Repeated action fingerprints stop the loop.
- Recovery timeout returns control to deterministic error handling.
- Browser remains alive across an approved recovery iteration.

### 25.6 Manual acceptance scenarios

1. Install and enable the plugin, ask for 100 businesses, observe progress, and receive an artifact.
2. Stop during extraction and verify the tool card stops and no browser process remains.
3. Simulate selector drift and verify the AI performs one allowed recovery call.
4. Simulate CAPTCHA and verify the AI asks for intervention rather than attempting bypass behavior.
5. Disable the plugin and verify the command and tool disappear.
6. Restart the app during a job and verify the process is gone and the job is reported as interrupted rather than running forever.

## 26. Acceptance Criteria

### AC-01: Optional capability

Without the plugin installed and enabled, AiChatV2 does not expose a Yellow Pages scraper tool or command.

### AC-02: Plugin-owned execution

The production scrape executes from the installed plugin MCP process and does not import the old application worker.

### AC-03: No Yellow Pages persistence dependency

The AI-only workflow completes without Yellow Pages TypeORM entities or the old Yellow Pages UI.

### AC-04: Long-running execution

A scrape may run beyond 240 seconds up to its declared job deadline without being terminated by a nested foreground timeout.

### AC-05: Progress

AiChatV2 receives correlated progress and partial counts while the job runs.

### AC-06: Cancellation

Stopping the chat cancels the registry job, closes Puppeteer, and terminates the plugin process within the configured grace period.

### AC-07: Structured recovery

A recoverable scraper failure reaches the next model round with its code, category, stage, recoverability, allowed strategies, safe observation, and partial artifact.

### AC-08: Correct failure semantics

The host records and displays recoverable plugin failure as `ToolExecutionResult.success = false`, not a nested success.

### AC-09: Bounded retry

The AI cannot repeat an identical failed scrape indefinitely and does not automatically retry user-intervention or fatal errors.

### AC-10: Result size

Large datasets are returned as artifacts with a bounded preview rather than injected fully into the model context.

### AC-11: Security

No AI request, tool result, progress event, audit record, or log contains cookies, tokens, browser profiles, full page HTML, or unrestricted local paths.

### AC-12: Cleanup

Completion, failure, cancellation, timeout, disablement, uninstall, and application shutdown leave no orphan plugin or browser processes.

### AC-13: AI gate

Every host handler that invokes AI recovery checks `USER_AI_ENABLED` before parsing the request or calling an AI service.

### AC-14: No system Node requirement

The installed plugin MCP server starts and executes Puppeteer JavaScript on a machine where `node` is not available on `PATH`, using AiFetchly's embedded Node runtime.

### AC-15: Separate browser dependency

The host supplies a verified Chrome or Chromium executable independently from the Node runtime, and the plugin launches it without importing AiFetchly's private browser modules or application dependencies.

## 27. Rollout Plan

### Phase 1: Generic async MCP foundation

- Add the host-managed `aifetchly-node` MCP runtime and confined entrypoint launcher.
- Add the generic browser executable capability for browser plugins.
- Add typed plugin MCP tool policy registration.
- Resolve MCP policy in the query loop.
- Pass execution context into MCP calls.
- Add progress, partial, cancellation, and deadline propagation.
- Normalize plugin result success correctly.
- Correct managed-async documentation and tests.

Exit condition: a synthetic MCP tool can run longer than four minutes, report progress, cancel, and return a structured failure to the next model round.

### Phase 2: Yellow Pages plugin extraction

- Create the independent plugin repository/package.
- Move scraper engine, adapters, and browser logic from the application into the plugin.
- Implement the MCP server and primary tool.
- Add the skill, command, hooks, permissions, and dependencies.
- Add artifact output.

Exit condition: an installed plugin completes a real scrape from AiChatV2 without the legacy UI or entities.

### Phase 3: Outer-chat recovery

- Add stable error taxonomy and safe diagnostics.
- Add deterministic fallbacks.
- Add recovery input schema and enforcement.
- Teach the plugin skill and hooks the retry policy.
- Add duplicate suppression.

Exit condition: a simulated selector change causes one bounded AI-selected recovery attempt and either succeeds or ends with an actionable explanation.

### Phase 4: Remove legacy application capability

- Remove Yellow Pages routes and management UI.
- Remove Yellow Pages TypeORM entities, models, and modules according to the database migration policy.
- Remove `YellowPagesProcessManager` and the application-owned child-process entry.
- Remove the worker build entry only after plugin parity is verified.
- Keep generic AI recovery and browser capabilities that other features use.

Exit condition: the core application builds and runs without Yellow Pages feature code; installing the plugin restores the AI capability.

### Phase 5: Optional in-session AI recovery

- Add MCP sampling or the generic server-to-host request mechanism.
- Add the host AI recovery broker.
- Port the useful safeguards from `YellowPagesAiSupportHandler`.
- Add the constrained action executor and iteration budgets.

Exit condition: a plugin can recover from a mocked live-page selector failure without ending the original MCP call or exposing provider credentials.

## 28. Migration Strategy

### 28.1 Code migration

Move, adapt, or rewrite these responsibilities into the plugin:

- `src/childprocess/YellowPagesScraper.ts` scraper engine.
- Yellow Pages-specific platform adapters and selector configuration.
- Browser-session and page-state capture logic.
- Yellow Pages-specific recovery coordinator.
- Result transformation and export logic.

Do not copy these application couplings into the plugin:

- TypeORM entity access.
- Electron `app` usage.
- Main-process token access.
- Direct references to `YellowPagesProcessManager`.
- Renderer IPC and Yellow Pages UI state.

### 28.2 AI support migration

For the first plugin release, convert unrecovered failures into the structured outer-chat contract. Do not block plugin extraction on an in-session broker.

When the broker phase begins, preserve the behavior of the existing handler through a generic API:

- AI gating.
- Rate limiting.
- Timeout.
- Page-size limit.
- Screenshot validation/upload.
- Response caching where safe.
- Action-schema validation.
- Iteration and history caps.

### 28.3 Data migration

No Yellow Pages entity migration is required for the new AI workflow. Existing records and removal timing are a separate product decision. The plugin does not read them.

## 29. Risks and Mitigations

| Risk                                 | Impact                                          | Mitigation                                                                  |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------- |
| MCP inner timeout remains active     | Long jobs fail despite job registration.        | Use one authoritative deadline propagated through every layer.              |
| Cancellation stops only the UI       | Browser continues consuming resources.          | Register job cancel handlers and enforce process kill after grace.          |
| Nested failure is treated as success | Model and hooks cannot recover correctly.       | Normalize MCP result semantics at the executor boundary.                    |
| Model retries indefinitely           | Cost, duplicate traffic, and platform blocking. | Fingerprints, attempt budgets, error-specific retry policy.                 |
| AI receives sensitive page state     | Credentials or personal data may leak.          | Sanitize, cap, artifact-reference, and validate at host boundary.           |
| AI returns unsafe browser actions    | Plugin executes untrusted behavior.             | Data-only action DSL, allowlists, same-origin policy, no JavaScript.        |
| Huge results overflow model context  | Slow or failed AI continuation.                 | Artifact plus summary and bounded preview.                                  |
| Plugin depends on global Node        | Packaged Electron app cannot start it reliably. | Application-managed runtime or packaged executable.                         |
| App restart loses in-memory job      | User sees an interrupted task.                  | Explicit interrupted behavior first; generic persistence later if required. |
| Site adapters become stale           | Scrapes fail after site changes.                | Versioned adapters, safe diagnostics, bounded recovery, plugin updates.     |

## 30. Trade-Offs and Rejected Alternatives

### 30.1 Detached job as the default

Rejected for the first release. Returning a job ID immediately would require the model to poll, require a persistent MCP process or external checkpointing, and complicate conversation completion. Managed async already exists and gives the model the final result automatically.

Detached jobs may be reconsidered for jobs that must survive chat closure or application restart.

### 30.2 Plugin calls the AI server directly

Rejected. It would expose credentials or duplicate provider, plan, billing, timeout, and audit behavior in each plugin. AI access remains host-owned.

### 30.3 Keep the legacy worker behind an MCP wrapper

Rejected as the final architecture. It would make the plugin depend on code that still ships in core and would not achieve optional packaging. It may be used only as a short migration bridge with a scheduled removal.

### 30.4 Let the model generate arbitrary Puppeteer code

Rejected. Page content is untrusted and model output is not an execution boundary. Recovery uses declared strategies and a constrained action DSL.

### 30.5 Store results in Yellow Pages entities

Rejected. The future product surface is AI-only and the entities are scheduled for removal. Artifacts provide export without restoring domain persistence.

## 31. Open Product Decisions

These decisions do not block the first host-foundation phase but must be resolved before marketplace release:

1. Default maximum results and hard maximum results per job.
2. Default artifact format and retention period.
3. Whether plugin uninstall removes unexported plugin artifacts.
4. Which platforms ship in version 1.0.
5. Whether authenticated platform sessions are supported in version 1.0.
6. Whether screenshot artifacts may be shown to users during failure diagnosis.
7. Whether a user can opt out of all AI-assisted recovery while keeping deterministic scraping.
8. Exact permission name and approval experience for host AI recovery.
9. Whether application shutdown records an interrupted tool message immediately or repairs it on next conversation load.
10. Whether generic job persistence is valuable enough for a later detached-job mode.

## 32. Success Metrics

### 32.1 Product metrics

- Users without the plugin have no Yellow Pages tool exposure.
- At least 95 percent of supported happy-path searches produce a usable artifact in the supported test matrix.
- At least 95 percent of user cancellations close the browser within five seconds.
- No duplicate live scrape is created for the same conversation and canonical arguments.
- No complete result artifact is injected into model context when it exceeds the preview budget.

### 32.2 Recovery metrics

- Deterministic recovery resolves the majority of transient navigation failures without an AI call.
- Recoverable failures reach the model with a stable error code and allowed strategies.
- Automatic outer-chat recovery never exceeds its configured attempt limit.
- CAPTCHA and authentication failures produce user intervention rather than automated bypass attempts.
- In-session recovery, when introduced, records action validation rejection and iteration outcomes without page content.

### 32.3 Engineering metrics

- No orphan MCP or browser processes in completion, failure, timeout, cancellation, disablement, uninstall, and shutdown tests.
- Existing built-in async tools pass regression tests.
- Existing foreground MCP tools retain their current behavior.
- Core application code contains no production Yellow Pages scraper after migration completion.

## 33. Source References

Current implementation surfaces used to derive this PRD:

- `src/service/ToolJobRegistry.ts`
- `src/service/AIChatQueryLoop.ts`
- `src/service/ToolTimeoutPolicy.ts`
- `src/service/SkillExecutor.ts`
- `src/service/ToolExecutor.ts`
- `src/service/MCPToolService.ts`
- `src/modules/MCPClient.ts`
- `src/service/PluginMcpDeclaration.ts`
- `src/modules/GoogleMapsModule.ts`
- `src/modules/YandexMapsModule.ts`
- `src/entityTypes/skillTypes.ts`
- `src/entityTypes/pluginTypes.ts`
- `src/service/PluginComponentRegistryService.ts`
- `src/childprocess/YellowPagesScraper.ts`
- `src/modules/YellowPagesProcessManager.ts`
- `src/modules/YellowPagesAiSupportHandler.ts`
- `src/modules/interface/BackgroundProcessMessages.ts`
- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/views/components/aiChatV2/AiChatV2Message.vue`
- `src/views/components/plugins/PluginManager.vue`
- `docs/superpowers/plans/2026-06-27-async-tool-job-polling.md`
- `docs/test-manual/aiChatV2-async-jobs.md`
- `docs/AI_PUPPETEER_RECOVERY_ARCHITECTURE.md`
- `docs/yellow-pages-scraper-prd.md`

## 34. Terminology

**Managed async:** The host runs a tool in `ToolJobRegistry`, polls locally, emits progress, and gives the final result to the model without requiring model-driven status polling.

**Detached job:** A tool returns a job ID before its work finishes. The caller later checks status. This is not the default design in this PRD.

**Outer-chat recovery:** The plugin returns a structured failure, the host sends it to the model in the next round, and the model starts a new tool call with an allowed strategy.

**In-session recovery:** The plugin keeps the browser alive and asks the host AI broker for constrained actions before the current MCP call returns.

**Application-level failure:** A valid MCP response that reports the requested operation did not complete. It contains `success: false` and structured diagnostics.

**Protocol failure:** The MCP server or transport cannot complete the protocol exchange, such as a crash or malformed JSON-RPC response.

**Recovery fingerprint:** A stable digest of the failure, canonical arguments, and selected strategy used to prevent repeated identical retries.

**Artifact:** A plugin-produced JSON or CSV result stored outside the AI message and represented in chat by an ID, summary, and preview.
