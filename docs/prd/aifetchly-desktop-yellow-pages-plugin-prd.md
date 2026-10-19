# AiFetchly Desktop — Yellow Pages Plugin Support — Product Requirements Document

**Status:** Proposed; implementation and release gates remain open.\
**Split date:** 2026-10-19. Source review: 2026-10-14; this split does not reverify implementation or deployment.\
**Implementation repository:** `aiFetchly`.\
**Companion document:** [Technical design](aifetchly-desktop-yellow-pages-plugin-technical-design.md).\
**Other repository:** [Plugin product requirements document](yellow-pages-scraper-plugin-prd.md).

## Scope and repository boundary

This document scopes the desktop changes needed to host independently released browser plugins and retire the built-in Yellow Pages feature. It is not a PRD or design for the entire existing desktop application. Scraper behavior is specified in the plugin pair linked above.

| Responsibility | Owner |
| --- | --- |
| Plugin Manager, trusted runtime/browser provisioning, async jobs, deadlines, progress routing, AI gating, cross-call retry ledger, artifact registration/export, legacy removal | AiFetchly desktop repository |
| MCP server, scraping engine, directory adapters/selectors, deterministic recovery, domain schemas, JSON/CSV writing, skill/command, independent build and release | Independent `yellow-pages-scraper-plugin` repository (owner/URL TBD) |
| Catalog publication, source/version identity, access decisions and package validation | `aifetchly-hub-go`; external dependency of both projects |

The plugin must build and test without a desktop checkout, desktop aliases, private dependencies, Electron settings, or application database access. Integration uses versioned MCP messages and explicit host capabilities. The desktop must not retain a production Yellow Pages scraper or fallback after cutover. Hub changes are coordination requirements, not code owned by either implementation repository.

## Reading and contract authority

The original section and requirement identifiers are retained for review traceability, so numbering is intentionally non-contiguous. Each detailed source section appears in exactly one owning document. Cross-repository behavior in that section defines obligations at the interface, not permission to implement the other repository's internals. Product scope is authoritative in the PRDs; technical examples remain proposals until the identified release decisions are resolved.

The desktop PRD owns the overall AC-01–AC-19 integration acceptance gate, rollout, migration and open product decisions. The plugin PRD owns PLUGIN-01–PLUGIN-12, tool/error contracts and plugin unit coverage. See [desktop acceptance criteria](aifetchly-desktop-yellow-pages-plugin-prd.md#26-acceptance-criteria) and [plugin requirements](yellow-pages-scraper-plugin-prd.md#23-required-plugin-behavior). Both repositories must pass their own checks plus the coordinated Hub-to-packaged-desktop release scenario before legacy removal.

## Detailed sections owned by this repository

- [0. Review Baseline and Corrections](aifetchly-desktop-yellow-pages-plugin-prd.md#0-review-baseline-and-corrections)
- [2. Product Problem](aifetchly-desktop-yellow-pages-plugin-prd.md#2-product-problem)
- [3. Product Goals](aifetchly-desktop-yellow-pages-plugin-prd.md#3-product-goals)
- [4. Non-Goals](aifetchly-desktop-yellow-pages-plugin-prd.md#4-non-goals)
- [5. Users and Primary Stories](aifetchly-desktop-yellow-pages-plugin-prd.md#5-users-and-primary-stories)
- [6. Guiding Design Decisions](aifetchly-desktop-yellow-pages-plugin-prd.md#6-guiding-design-decisions)
- [7. Target Architecture](aifetchly-desktop-yellow-pages-plugin-prd.md#7-target-architecture)
- [9. Plugin Manifest and Tool Policy](aifetchly-desktop-yellow-pages-plugin-prd.md#9-plugin-manifest-and-tool-policy)
- [11. Managed Async Job Lifecycle](aifetchly-desktop-yellow-pages-plugin-prd.md#11-managed-async-job-lifecycle)
- [14. MCP Result Normalization Requirements](aifetchly-desktop-yellow-pages-plugin-prd.md#14-mcp-result-normalization-requirements)
- [15. In-Session AI Recovery](aifetchly-desktop-yellow-pages-plugin-prd.md#15-in-session-ai-recovery)
- [17. Security and Privacy Requirements](aifetchly-desktop-yellow-pages-plugin-prd.md#17-security-and-privacy-requirements)
- [18. Artifacts and Data Retention](aifetchly-desktop-yellow-pages-plugin-prd.md#18-artifacts-and-data-retention)
- [19. Plugin Installation and Availability](aifetchly-desktop-yellow-pages-plugin-prd.md#19-plugin-installation-and-availability)
- [19.1 Installation](aifetchly-desktop-yellow-pages-plugin-prd.md#191-installation)
- [19.2 Enablement](aifetchly-desktop-yellow-pages-plugin-prd.md#192-enablement)
- [19.3 Dependency handling](aifetchly-desktop-yellow-pages-plugin-prd.md#193-dependency-handling)
- [19.4 Current runtime gap](aifetchly-desktop-yellow-pages-plugin-prd.md#194-current-runtime-gap)
- [19.5 Proposed host-managed runtime declaration](aifetchly-desktop-yellow-pages-plugin-prd.md#195-proposed-host-managed-runtime-declaration)
- [19.6 Electron provides the Node runtime](aifetchly-desktop-yellow-pages-plugin-prd.md#196-electron-provides-the-node-runtime)
- [19.8 Node and Chrome are separate runtime dependencies](aifetchly-desktop-yellow-pages-plugin-prd.md#198-node-and-chrome-are-separate-runtime-dependencies)
- [19.10 Alternatives considered](aifetchly-desktop-yellow-pages-plugin-prd.md#1910-alternatives-considered)
- [19.12 Hub installation modes and release decision](aifetchly-desktop-yellow-pages-plugin-prd.md#1912-hub-installation-modes-and-release-decision)
- [20. AiChatV2 Experience](aifetchly-desktop-yellow-pages-plugin-prd.md#20-aichatv2-experience)
- [21. Existing Implementation Assessment](aifetchly-desktop-yellow-pages-plugin-prd.md#21-existing-implementation-assessment)
- [22. Required Host Changes](aifetchly-desktop-yellow-pages-plugin-prd.md#22-required-host-changes)
- [24. Non-Functional Requirements](aifetchly-desktop-yellow-pages-plugin-prd.md#24-non-functional-requirements)
- [25. Testing Requirements](aifetchly-desktop-yellow-pages-plugin-prd.md#25-testing-requirements)
- [25.1 Host unit tests](aifetchly-desktop-yellow-pages-plugin-prd.md#251-host-unit-tests)
- [25.2 MCP client tests](aifetchly-desktop-yellow-pages-plugin-prd.md#252-mcp-client-tests)
- [25.4 Integration tests](aifetchly-desktop-yellow-pages-plugin-prd.md#254-integration-tests)
- [25.5 In-session recovery tests](aifetchly-desktop-yellow-pages-plugin-prd.md#255-in-session-recovery-tests)
- [25.6 Manual acceptance scenarios](aifetchly-desktop-yellow-pages-plugin-prd.md#256-manual-acceptance-scenarios)
- [25.7 Distribution and migration tests](aifetchly-desktop-yellow-pages-plugin-prd.md#257-distribution-and-migration-tests)
- [26. Acceptance Criteria](aifetchly-desktop-yellow-pages-plugin-prd.md#26-acceptance-criteria)
- [27. Rollout Plan](aifetchly-desktop-yellow-pages-plugin-prd.md#27-rollout-plan)
- [28. Migration Strategy](aifetchly-desktop-yellow-pages-plugin-prd.md#28-migration-strategy)
- [29. Risks and Mitigations](aifetchly-desktop-yellow-pages-plugin-prd.md#29-risks-and-mitigations)
- [30. Trade-Offs and Rejected Alternatives](aifetchly-desktop-yellow-pages-plugin-prd.md#30-trade-offs-and-rejected-alternatives)
- [31. Open Product Decisions](aifetchly-desktop-yellow-pages-plugin-prd.md#31-open-product-decisions)
- [32. Success Metrics](aifetchly-desktop-yellow-pages-plugin-prd.md#32-success-metrics)
- [33. Source References](aifetchly-desktop-yellow-pages-plugin-prd.md#33-source-references)
- [34. Terminology](aifetchly-desktop-yellow-pages-plugin-prd.md#34-terminology)

## Integration references owned by the other repository

- [1. Executive Summary](yellow-pages-scraper-plugin-prd.md#1-executive-summary)
- [8. Plugin Package](yellow-pages-scraper-plugin-prd.md#8-plugin-package)
- [10. MCP Tool Surface](yellow-pages-scraper-plugin-prd.md#10-mcp-tool-surface)
- [12. AI Recovery Model](yellow-pages-scraper-plugin-prd.md#12-ai-recovery-model)
- [13. Structured Failure Contract](yellow-pages-scraper-plugin-prd.md#13-structured-failure-contract)
- [16. Failure Policy Matrix](yellow-pages-scraper-plugin-prd.md#16-failure-policy-matrix)
- [19.7 MCP-to-Puppeteer execution sequence](yellow-pages-scraper-plugin-prd.md#197-mcp-to-puppeteer-execution-sequence)
- [19.9 Plugin JavaScript dependency packaging](yellow-pages-scraper-plugin-prd.md#199-plugin-javascript-dependency-packaging)
- [19.11 Repository ownership and release artifact](yellow-pages-scraper-plugin-prd.md#1911-repository-ownership-and-release-artifact)
- [19.13 Publication, installation, and update requirements](yellow-pages-scraper-plugin-prd.md#1913-publication-installation-and-update-requirements)
- [23. Required Plugin Behavior](yellow-pages-scraper-plugin-prd.md#23-required-plugin-behavior)
- [25.3 Plugin unit tests](yellow-pages-scraper-plugin-prd.md#253-plugin-unit-tests)

## 0. Review Baseline and Corrections

This revision was checked against desktop `70037427` and the Hub working tree based on `71b8c84`. The Hub has pre-existing uncommitted publishing/source changes; this review includes the visible implementation but does not establish what is deployed. No Hub files were changed. All requirements below describe the target unless explicitly identified as existing behavior.

| Previous error or omission | Verified correction / required action | Evidence |
| --- | --- | --- |
| Installation was described without a separate repository or Hub release workflow. | Build releases in the plugin repository; publish through the Hub; install through the existing Plugin Manager. Hub managed APIs exist, but desktop currently rejects non-direct Hub installs. | Desktop `PluginMarketplaceService.installCommunityPlugin`; Hub `internal/httpapi/routes/install_plan.go`, `prepare_install.go` |
| Shipping production `node_modules` was presented as Hub-compatible. | Hub canonical packaging removes every `node_modules` directory and runs no build scripts. Publish a prebuilt bundle with required assets outside excluded directories. | Hub `internal/artifacts/plugin_package.go` |
| Hub ZIP publication could be mistaken for usable desktop delivery. | Catalog `zip` sources are not installable today; URL downloads lack expected-checksum plumbing. Prefer a prebuilt GitHub commit or implement the missing ZIP mapping/integrity checks. | `AiFetchHubMarketplaceFetcher`, `pluginSourceTypes.ts`, `UrlPluginFetcher` |
| Stdio MCP was described as a custom response-only client. | Stdio now uses the MCP SDK and `SupervisedStdioTransport`; the legacy response handler is not the stdio implementation. | `src/modules/MCPClient.ts`, `src/modules/mcp/SupervisedStdioTransport.ts` |
| Async jobs were said to lack an abort signal. | Registry jobs own an abort signal and the query loop already passes `handle.signal`; the MCP executor/service still drop execution context. | `ToolJobRegistry`, `AIChatQueryLoop.executeAsyncTool`, `ToolExecutor.executeMCPTool` |
| All MCP `isError` results were called protocol failures. | Tool-level errors and JSON-RPC/transport failures are distinct. Preserve structured diagnostics and classify recoverability from validated data. | `MCPClient.callToolContent` versus `callTool` |
| Thirty-minute polling was treated as a cancellation deadline. | Current polling returns a failure while allowing work to continue. Add cancellation and cleanup at deadline expiry. | `AIChatQueryLoop.pollAsyncJobToCompletion` |
| Retry enforcement depended on a process that exits after each call. | Host owns a conversation-scoped recovery ledger across process lifetimes. Hooks and model instructions cannot enforce this alone. | `MCPToolService.executeMCPTool` disconnects in `finally` |
| Removal covered only one worker and the dedicated UI. | Remove both worker targets, built-in tools, startup hooks, IPC/preload, routes, and persistence registrations after release validation. | `forge.config.js`, `skillsRegistry.ts`, `ToolExecutor.ts`, `background.ts`, `bootuprun.ts` |
| A browser dependency service was assumed to be entirely new. | Reuse existing managed-browser resolution and dependency infrastructure through a generic plugin boundary; no plugin imports from host worker internals. | `src/childprocess/managed-browser/BrowserExecutableResolver.ts` |

The prior AI-chat-only surface and artifact-based result design are retained. This revision specifies extraction and distribution; it does not create the new repository, implement the plugin, publish a Hub version, or delete existing user data.
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
2. Import legacy Yellow Pages records into the plugin. Legacy data retention/export is a cutover prerequisite, not permission to drop tables.
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
  "permissions": ["network", "automation", "plugin-storage"],
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

This is a proposed extension, not a manifest that the current host can execute as specified. Permission strings are illustrative until mapped to validated host capabilities; declaring a string does not grant access. `ai-recovery` is deferred to the optional broker phase. Validate these fields in both desktop and Hub, and gate installation/activation by a compatible desktop version. The exact field names may change during technical design, but the behavior is required.

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

Use MCP progress notifications correlated by a host-issued progress token on the tool call. The JSON below is the normalized host progress shape, not an assertion that MCP standardizes `phase` or `partialCount`. Define and validate any extra metadata. Partial snapshots require a documented, versioned extension with the same correlation and payload limits. The host maps each validated update to both destinations:

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
  -> registry-owned AbortController aborts handle.signal
  -> registered cleanup handlers run
  -> MCP cancellation reaches plugin
  -> scraper stops page loops
  -> Puppeteer page and browser close
  -> MCP process exits
  -> host sends SIGTERM, then SIGKILL after a grace period if needed
```

Forward the existing registry-owned `handle.signal` into MCP execution; use `handle.onCancel` for additional cleanup where needed. Cancelling only the in-memory registry record is insufficient.

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
## 14. MCP Result Normalization Requirements

### 14.1 Tool failures versus protocol failures

MCP `isError: true` indicates a tool-level failure, not a JSON-RPC protocol error. The current convenience method `MCPClient.callTool` throws for it, while `callToolContent` preserves it along with structured content and all content blocks.

The initial plugin contract returns its validated domain envelope (`success`, `status`, structured error) in `structuredContent` with a matching bounded JSON text representation for compatibility. Recoverable domain outcomes may use this ordinary result envelope. The generic host normalization must also preserve useful diagnostics from `isError: true` tools; it must not classify all such outcomes as transport failures or stringify unbounded content. Declare one precedence rule: `isError: true` cannot become success even if a contradictory nested payload claims success. Recoverability comes from validated error policy, not the flag alone.

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

Process exits, malformed JSON-RPC, connection failures, and trust failures become fatal `ToolExecutionResult` values with sanitized messages. Tool-level `isError` is normalized separately as described above. They do not expose command-line arguments, environment variables, or local secrets.
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

The current stdio SDK client advertises an empty capability set and has no application sampling broker. Add capability negotiation and request handlers in that SDK path before this phase; do not build sampling around the legacy `handleMessage` implementation.

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
## 17. Security and Privacy Requirements

### 17.1 Plugin process trust

An MCP stdio plugin executes local code. Installation and enablement must make the requested permissions visible. The host must continue to apply plugin trust checks, executable path validation, environment allowlisting, and command restrictions before process spawn.

These checks are not an OS sandbox: installed local plugin code has the process user’s access unless separately isolated. Permission declarations and path checks must not be described as sandbox guarantees.

### 17.2 Environment isolation

The plugin process receives only allowlisted environment values and explicitly configured plugin options. It must not inherit the full Electron main-process environment.

### 17.3 Network scope

The plugin declares the supported platform origins. Directory navigation should remain on those origins and approved supporting origins. Following business website links for email/contact extraction needs a separately declared, bounded capability; otherwise omit those fields or report them unavailable. Validate redirects and reject local/private network destinations under the host network policy. Do not imply that directory-only origins permit arbitrary linked-site crawling.

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

The plugin writes only to a host-provisioned per-plugin, per-job output directory outside the installed package, or through a host artifact service. A generic host adapter must validate/register completed files and resolve artifact IDs for chat download/export with conversation ownership checks. Merely returning an ID does not make a file downloadable. This bridge is required work; no existing generic plugin artifact API is assumed. The plugin does not write to the application database. Artifact paths must not escape the approved root.

### 18.4 Retention

Retention must be implemented through a generic artifact policy. Updates and repair must preserve completed outputs outside the install directory; pending output must be finalized or clearly marked incomplete. Plugin uninstall may offer removal of plugin artifacts, but it must not silently delete user-exported files.
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

The current plugin stdio declaration requires a non-empty `command`; typed `runtime` and `entry` fields are not supported yet. `MCPClient.connectStdio` now uses the MCP SDK with `SupervisedStdioTransport`, which validates commands, sanitizes environment, spawns an owned child, and supervises shutdown. Extend that path rather than introducing an unsupervised parallel launcher.

A declaration using `command: "node"` still relies on an external executable and is not an acceptable default for customer machines. A successful local developer install does not prove packaged-app compatibility. The proposed runtime contract below is a release blocker until validated end to end.
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

Electron includes a Node runtime. The proposed launcher uses `process.execPath` in Node mode, subject to validation of the shipped Electron configuration and run-as-node fuse on every supported target:

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

The existing MCP environment filter correctly rejects plugin-supplied `ELECTRON_*` variables, including `ELECTRON_RUN_AS_NODE`, because allowing an untrusted declaration to control Electron startup can enable process hijacking. The existing supervised transport must gain a trusted runtime launch path without weakening declaration-side restrictions. The launcher must:

1. Build the normal allowlisted child environment.
2. Reject prohibited plugin-supplied variables.
3. Resolve and validate the plugin entrypoint.
4. Inject `ELECTRON_RUN_AS_NODE=1` from trusted host code after filtering.
5. Start the process with `shell: false` and piped stdin, stdout, and stderr.
6. Keep secrets, database paths, cookies, and unrelated Electron variables out of the child environment.

The plugin never needs to know the path to the Electron executable and cannot override the trusted launch flags.
### 19.8 Node and Chrome are separate runtime dependencies

Running Puppeteer requires two distinct executables:

| Runtime                  | Purpose                                                                 | Recommended owner                       |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| Electron's embedded Node | Executes `yellow-pages-mcp.cjs`, the MCP SDK, and Puppeteer JavaScript. | AiFetchly host                          |
| Chrome or Chromium       | Loads and interacts with Yellow Pages websites.                         | Generic host browser dependency service |

The plugin does not need to bundle Node. It still needs access to a compatible Chrome or Chromium executable.

The recommended browser design is:

1. The plugin bundles `puppeteer-core` and its JavaScript scraper dependencies into the release artifact.
2. A generic host browser dependency service locates or installs a supported browser.
3. The host passes an approved browser executable path through trusted startup configuration or MCP initialization data.
4. The plugin verifies the supplied file and launches it with `puppeteer.launch({ executablePath })`.
5. The plugin does not import AiFetchly's internal `BrowserManager`, query application settings directly, or read a browser path from the application database.

Existing managed-browser code already resolves configured, managed-cache, and system browser candidates with a typed missing-dependency result. Reuse that behavior through a main-process capability; do not import worker-only code into the plugin or add a second Yellow Pages browser downloader. The capability contract and compatibility check are still required work.

Passing the browser path through a trusted host capability keeps browser installation reusable across plugins without coupling the plugin to AiFetchly source modules.
### 19.10 Alternatives considered

**Require system Node:** Rejected for the default plugin. It adds an undeclared machine dependency and version variance.

**Ship a standalone executable:** Viable for plugins built separately for every operating system and architecture, but it increases package size, signing work, update complexity, and Puppeteer packaging effort.

**Use `utilityProcess.fork`:** Electron can execute JavaScript in a utility process, but the current MCP client expects stdin/stdout JSON-RPC. Adopting `utilityProcess` would require a new MCP transport adapter. It is not the smallest first implementation.

**Import Puppeteer from AiFetchly's application bundle:** Rejected. It couples plugin behavior to private package layout and application releases. The host may manage the browser executable, but the plugin owns its JavaScript client dependency.
### 19.12 Hub installation modes and release decision

The existing Community catalog in Plugin Manager is the discovery surface; do not introduce a separate Yellow Pages installer or a second Hub page. `AiFetchHubMarketplaceFetcher` accepts `direct`, `ticket`, and `managed`, but `PluginMarketplaceService.installCommunityPlugin` only installs `allowed` + `direct` entries with an installable object source. Recognizing catalog metadata is not managed installation support.

The recommended first release is a direct Hub catalog entry pointing to a prebuilt GitHub tree pinned by commit SHA, **if the product chooses public/direct distribution**. The selected commit must include its built `dist` output; a tag containing only TypeScript source is insufficient. It still requires the host runtime, browser capability, and async work in this PRD. Do not require native git, npm, or Node on the customer machine; verify the chosen archive acquisition path in packaged builds. Local-folder/ZIP installation is for development and diagnostics, not the release acceptance path.

Hub `source: "zip"` entries are currently accepted for catalog display but dropped from the installable source by `normalizeEntrySource`. Generic `source: "url"` ZIP downloads exist, but `PluginSourceRequest` has no expected-checksum field and `UrlPluginFetcher` does not compare downloaded bytes with a Hub checksum. A checksummed ZIP/release-asset route therefore requires explicit source mapping and integrity verification work; do not assume the Hub SHA256 automatically reaches desktop enforcement. Test the exact acquisition route and redirect policy before selecting it.

If the release needs subscription-protected delivery, ticketed downloads, or Hub-managed resources, completing desktop managed installation is a prerequisite. Do not relabel a protected package as public/direct or bypass access decisions to make installation work. Follow the generic managed-installation PRD, reconciled with current source and the unified Plugin Manager UI. Show unsupported installation modes accurately instead of reporting every non-direct mode as “subscription required.”

The Hub already implements version-ID install plans, prepare-install, resource download tickets, and managed publication gates. Its runtime declaration validator currently recognizes `managed-python` and `uv-python`; it does **not** implement the proposed `aifetchly-node`/browser contract. Do not encode a JavaScript scraper as a Python runtime or assume uv provisions Node/Chrome. For the initial direct route, Node and browser capability are supplied by the desktop. Any Hub-managed Node/browser resources need their own generic schema, validation, target selection, and installer support before use.
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

`MCPToolService.executeMCPTool` still races calls against 240 seconds and disconnects in `finally`. The stdio SDK call uses `options.timeoutMs` or server timeout; although supported at client level, the service does not supply a job deadline. `sendRequest` is the legacy non-SDK path, not the stdio timer.

SDK calls currently set `resetTimeoutOnProgress: true`. Progress must never extend the authoritative job deadline. Connection startup, queue wait, retries, browser work, and cleanup need a bounded budget. The current query-loop 30-minute polling cap returns without cancelling the job; explicitly cancel and await bounded cleanup when it expires.

### 21.6 Current notification gap

Stdio uses the SDK, and `callToolContent` already supports a timeout override, abort signal, structured content, and full content blocks. There is no generic plugin progress-token/on-progress bridge to job state or validated partial-snapshot extension. Add those to the SDK path. Sampling remains deferred; legacy SSE/WebSocket behavior must not regress.

### 21.7 Current failure normalization gap

`MCPClient.callTool` throws for MCP `isError`. `ToolExecutor.executeMCPTool` wraps a returned plugin result in `{ success: true, result }`. `SkillExecutor.executeViaToolExecutor` then sets `ToolExecutionResult.success = true` whenever the executor returns.

Without normalization, `{ success: false }` from the plugin is nested inside an outer success and failure hooks do not receive the right signal.

### 21.8 Current cancellation gap

`ToolJobRegistry` already owns an `AbortController` per job; cancellation/shutdown aborts `handle.signal`, and the async query loop passes it to execution context. Preserve this existing mechanism. `ToolExecutor` and `MCPToolService` must forward that signal to the SDK call. Reuse supervised process ownership for cleanup, and verify browser descendants, disable/uninstall, and deadline termination rather than assuming the UI cancellation state proves cleanup.

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

Reuse the registry-owned `handle.signal`, propagate it through MCP execution, attach cleanup with `onCancel` where needed, and await bounded supervised process/browser-tree termination. Do not introduce a second competing job cancellation authority.

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

Extend plugin MCP declarations with a validated `aifetchly-node` runtime and plugin-relative entrypoint. Extend the supervised stdio launcher to run `process.execPath` with an internally injected `ELECTRON_RUN_AS_NODE=1`, piped stdio, a confined working directory, and the existing sanitized environment. Do not require a system `node` executable.

### HOST-15: Generic browser runtime capability

Reuse existing managed-browser resolution behind a generic plugin capability. Expose an approved Chrome or Chromium executable path to browser plugins without allowing them to read application settings or import application browser modules. Browser discovery, installation, version diagnostics, and path approval remain host-owned.

### HOST-16: Cross-call recovery ledger

Track trusted recovery state across MCP processes and enforce attempts, delay, and search identity before spawning. Test concurrent retry requests and forged/expired prior-error IDs.

### HOST-17: Plugin result artifact bridge

Provision output directories outside installed code, validate finalized artifacts, and expose authorized download/export by opaque ID in chat. Implement retention and update/uninstall behavior without Yellow Pages database entities. Reuse applicable generic storage services after checking their ownership and lifetime contracts.

### HOST-18: Hub installation compatibility

Complete the selected distribution path in [§19.12](aifetchly-desktop-yellow-pages-plugin-prd.md#1912-hub-installation-modes-and-release-decision). Reuse existing catalog/import infrastructure. If managed distribution is selected, implement the missing desktop plan/ticket/resource pipeline; do not duplicate Hub discovery. Add host-version/runtime capability gating for the new declaration and usable diagnostics when a dependency is absent.

### HUB-01: Publish the independent plugin

Create the catalog/version/source records and publish the tested prebuilt package using existing Hub workflows. Verify manifest, capabilities, target support, release identity, and archive size compatibility. Static validation must not execute scraper or package scripts.

### HUB-02: Validate new generic contracts where used

Add validation/metadata support for runtime/policy/minimum-host capability declarations required by the chosen release route. Unknown manifest fields being preserved does not establish support. Managed Node/browser resources are a separate extension, required only if that distribution route is chosen.
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
### 25.7 Distribution and migration tests

- Build the plugin in an isolated checkout with no desktop source dependencies; test the exact released ZIP and Hub-canonicalized bytes. Verify all runtime assets survive exclusion and satisfy desktop limits.
- Install from the actual staging Hub catalog on a clean packaged-app target without system Node, git, or npm. Local-folder success does not satisfy this case.
- Test direct source identity/checksum mismatch and inaccessible release; for managed mode also test denied access, stale plan, expired ticket, revoked artifact, and target mismatch.
- Update while a job is running; failed update preserves the previous version and artifacts. Disable/uninstall terminates browser descendants and removes all catalog exposure.
- Assert host-owned retry limits survive process restart between calls and reject forged IDs/concurrent duplicate retries. Assert progress cannot extend the hard deadline.
- Test artifact ID ownership, traversal rejection, export after plugin update, and handling of interrupted partial outputs.
- Upgrade a legacy database with existing results; preserve data and prevent legacy tasks from restarting after cutover.
- Verify no Yellow Pages built-in tool, route, startup handler, IPC channel, worker bundle, or adapter remains active after extraction. Regression-test unrelated scrapers and shared browser infrastructure.
- For implementation UI changes, add/update `test/vitest/main/components/` tests and pass `yarn test:components`; extend `test/e2e/specs/` for Hub install → AI scrape → export/cancel. Update all six supported translations. These are implementation requirements; this PRD-only revision changes no UI.
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

### AC-16: Independent repository and Hub delivery

The plugin builds without the desktop repository, and a user discovers and installs its tested version from the Hub through the existing Plugin Manager on a clean supported machine. Package, source revision/checksum, Hub version, and installed provenance agree. No local development path or built-in fallback is required.

### AC-17: Distribution compatibility and update safety

The release satisfies Hub canonicalization and desktop archive limits. Unsupported host/target or denied access cannot produce an enabled unusable plugin. A failed update preserves the previous working version; completed artifacts survive update and repair. A managed/ticket release is blocked until desktop and deployed Hub support its complete installation flow.

### AC-18: Complete extraction with legacy data retained

Both worker build targets and all production Yellow Pages routes, tools, IPC, startup tasks, adapters, and persistence registrations are removed after the Hub delivery gate. Existing user records are preserved under the documented cutover/export policy. Other browser features still pass regression tests.

### AC-19: Recovery state and usable artifacts

Retry budgets remain authoritative across distinct MCP process lifetimes. Completed/partial artifacts can actually be exported through authorized chat controls, not merely mentioned by ID. Deadline expiry cancels underlying work before any automatic retry.
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
- Add the skill, command, optional hooks, validated permissions, and dependencies.
- Add artifact output.

Exit condition: an installed plugin completes a real scrape from AiChatV2 without the legacy UI or entities.

### Phase 3: Outer-chat recovery

- Add stable error taxonomy and safe diagnostics.
- Add deterministic fallbacks.
- Add recovery input schema and enforcement.
- Teach the plugin skill and hooks the retry policy.
- Add duplicate suppression.

Exit condition: a simulated selector change causes one bounded AI-selected recovery attempt and either succeeds or ends with an actionable explanation.

### Phase 3b: Hub publication and packaged-app acceptance

- Produce the independent repository’s versioned prebuilt release and immutable source/artifact identity.
- Publish a staging Hub entry through the supported source/version workflow.
- Validate the selected direct or managed route under [§19.11](yellow-pages-scraper-plugin-prd.md#1911-repository-ownership-and-release-artifact)–19.13.
- Install, update, repair, disable, and uninstall through Plugin Manager on the supported packaged-app target matrix.
- Confirm browser acquisition, artifact export, entitlement behavior, and no developer-tool prerequisite.

Exit condition: a user can discover and install the released plugin from the Hub and complete a scrape on a clean supported machine. Local-folder installation alone is insufficient.

### Phase 4: Remove legacy application capability

- Remove Yellow Pages routes and management UI.
- Remove Yellow Pages TypeORM entities, models, and modules according to the database migration policy.
- Remove `YellowPagesProcessManager` and both application-owned child-process entries.
- Remove both worker build entries only after the Hub-distributed plugin passes the agreed parity matrix.
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

### 28.1.1 Extraction and removal inventory

This inventory is the minimum cutover checklist, not permission to delete shared code by directory name. Trace consumers before moving/removing each item.

| Area | Current desktop surfaces | Target action |
| --- | --- | --- |
| Worker/build | `src/childprocess/YellowPagesScraper.ts`, `YellowPagesScraperProcess.ts`; both entries in `forge.config.js`; `vite.yellowPages.config.mjs`, `vite.yellowPagesScraperProcess.config.mjs`; worker schemas | Adapt scraper into plugin-owned MCP implementation; remove both core build targets and obsolete protocols. Do not copy Electron worker bootstrapping. |
| Domain logic | `YellowPagesController`, `YellowPagesProcessManager`, `YellowPagesOrchestrator`, `YellowPages*Module`, `YellowPagesAiSupportHandler`, `YellowPagesHealthCheck` | Move domain behavior, replace orchestration with generic host jobs, remove obsolete core code. |
| Adapters/config | `src/modules/platforms/`, `src/config/platforms/`, `ChildProcessAdapterFactory`, `BasePlatformAdapter`, Yellow Pages interfaces, `yellowPagesProxyLaunch` | Move Yellow Pages-only code/config; identify and retain shared consumers or extract a clean shared contract. |
| Built-in AI | `src/config/skillsRegistry.ts`, `src/config/aiTools.config.ts`, `ToolExecutor`, `ToolExecutionService`, `ToolTimeoutPolicy`, `yellowPagesResultFormatter` | Remove `search_yellow_pages` and `get_available_yellow_pages_platforms` registrations and domain branches. Installed plugin uses canonical MCP names. |
| Startup | `src/background.ts`, `src/modules/bootuprun.ts` | Remove Yellow Pages initialization, recovery, and orphan-task checks; keep generic process cleanup. |
| IPC/renderer | `yellowPagesIpc.ts`, communication registration, preload allowlists, IPC schemas/channels, `src/views/api/yellowpages.ts`, pages/components, menus, router files including migration registry | Remove legacy routes/actions and exposure; retain generic plugin/chat controls. Update corresponding UI tests and translations. |
| Persistence | Three `YellowPages*.entity.ts` files, task/result models, `src/config/SqliteDb.ts`, legacy SQL definitions | Remove feature registrations and data-access paths under the non-destructive upgrade policy in [§28.3](aifetchly-desktop-yellow-pages-plugin-prd.md#283-data-migration). |
| Tests/docs/dependencies | Existing Yellow Pages tests, fixtures, scripts, docs, package dependencies | Move adapter fixtures/tests to plugin; replace core tests with absence/host-integration coverage; remove only dependencies proven exclusive to Yellow Pages. |

Before extraction, record a parity matrix per currently configured adapter: category/location search, pagination, detail fields, export, proxy/session behavior, supported regions, and recovery. Mark each behavior as retained, explicitly deferred, or removed, with fixture coverage. The recommended v1 scope defers authenticated sessions (subject to [§31](aifetchly-desktop-yellow-pages-plugin-prd.md#31-open-product-decisions)) and excludes live-page AI recovery; do not claim full legacy parity without documenting those exclusions. Final platform and field coverage must be decided before publishing.

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

The plugin does not read or migrate legacy tables. Before removing the old UI, choose and document a user-visible export/backup path for existing tasks/results. Default cutover preserves existing database files/tables and disables legacy startup/task scheduling; no silent table drop or automatic legacy-job resume. Review TypeORM synchronization/migrations when removing entity registrations, and test upgrades from a database containing Yellow Pages records. Destructive cleanup, if ever offered, is a separate explicit operation. Generic plugin installation and chat persistence remain host-owned Models/Modules.
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

Release-blocking decisions added by this review:

11. Independent repository owner/URL, release CI, license, and immutable artifact policy.
12. Public/direct versus protected/managed distribution. Direct is the recommended first path if access policy permits; paid/managed delivery requires the desktop installer work above.
13. Minimum compatible desktop version and tested OS/architecture/browser matrix for the new runtime contract.
14. Legacy export/backup and cutover communication before removing the existing UI; no silent deletion by default.
15. Exact result-artifact API, retention default, ownership, and download/export UI integration.
16. Per-adapter parity matrix, including proxy support, external business-site crawling, and deferred authentication.

The proposed AI-chat-only replacement remains the product scope; a new plugin-rendered Yellow Pages management UI would be a separate requirement.
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

Additional evidence for the 2026-10-14 review (desktop-relative unless noted):

- `src/service/PluginMarketplaceService.ts` — current direct-only Hub installation guard.
- `src/service/pluginMarketplaces/AiFetchHubMarketplaceFetcher.ts` — catalog mode/schema normalization and catalog-only ZIP sources.
- `src/service/pluginSources/pluginSourceTypes.ts`, `src/service/pluginSources/UrlPluginFetcher.ts` — acquisition contract and missing expected-checksum verification.
- `src/modules/mcp/SupervisedStdioTransport.ts` — existing stdio supervision and environment filtering.
- `src/childprocess/managed-browser/BrowserExecutableResolver.ts` — existing browser resolution.
- `src/childprocess/YellowPagesScraperProcess.ts`, `forge.config.js` — second worker target.
- `src/config/skillsRegistry.ts`, `src/config/aiTools.config.ts`, `src/service/ToolExecutionService.ts` — built-in Yellow Pages tools and coupling.
- `src/background.ts`, `src/modules/bootuprun.ts`, `src/config/SqliteDb.ts`, `src/preload.ts` — cutover registrations.
- `docs/prd/plugin-hub-managed-installation-prd.md` — related proposal; not proof of implementation.
- `docs/prd/unified-plugin-page-discovery-prd.md` — related unified Plugin Manager requirements.
- Hub (`/home/robertzeng/project/aifetchly-hub-go`): `internal/artifacts/plugin_package.go`, `internal/validation/manifest.go`, `internal/resources/declaration.go`, `internal/resources/plan.go`, `internal/httpapi/routes/install_plan.go`, `internal/httpapi/routes/prepare_install.go`, `internal/publish/publish.go`.

Hub working-tree source takes precedence over stale comments or older PRDs when describing current behavior. Deployed behavior must be verified during staging acceptance.
## 34. Terminology

**Managed async:** The host runs a tool in `ToolJobRegistry`, polls locally, emits progress, and gives the final result to the model without requiring model-driven status polling.

**Detached job:** A tool returns a job ID before its work finishes. The caller later checks status. This is not the default design in this PRD.

**Outer-chat recovery:** The plugin returns a structured failure, the host sends it to the model in the next round, and the model starts a new tool call with an allowed strategy.

**In-session recovery:** The plugin keeps the browser alive and asks the host AI broker for constrained actions before the current MCP call returns.

**Application-level failure:** A valid MCP response that reports the requested operation did not complete. It contains `success: false` and structured diagnostics.

**Protocol failure:** The MCP server or transport cannot complete the protocol exchange, such as a crash or malformed JSON-RPC response.

**Recovery fingerprint:** A stable digest of the failure, canonical arguments, and selected strategy used to prevent repeated identical retries.

**Artifact:** A plugin-produced JSON or CSV result stored outside the AI message and represented in chat by an ID, summary, and preview.
