# Yellow Pages Scraper Plugin — Independent Repository — Product Requirements Document

**Status:** Proposed; implementation and release gates remain open.\
**Split date:** 2026-10-19. Source review: 2026-10-14; this split does not reverify implementation or deployment.\
**Implementation repository:** Independent `yellow-pages-scraper-plugin` (location TBD).\
**Companion document:** [Technical design](yellow-pages-scraper-plugin-technical-design.md).\
**Other repository:** [Desktop product requirements document](aifetchly-desktop-yellow-pages-plugin-prd.md).

## Scope and repository boundary

This document scopes an independently developed and released Yellow Pages plugin. The desktop is a consuming host, not a source dependency or build workspace. Host capabilities described here are integration prerequisites; their implementation belongs to the desktop pair linked above.

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

## Integration references owned by the other repository

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

## 1. Executive Summary

AiFetchly currently ships Yellow Pages scraping as an application feature with a dedicated UI, application-owned entities, a main-process manager, and a child-process Puppeteer worker. Not every customer needs this capability. The product should move the capability into an independently installable plugin.

After this change, installing and enabling the plugin gives AiChatV2 the ability to call a Yellow Pages scraping tool. Without the plugin, no Yellow Pages tools, instructions, commands, hooks, or adapters are registered or bundled. Shared Puppeteer/browser infrastructure required by other application features may remain; extraction does not imply removing every browser dependency from core.

The independent plugin repository owns source, tests, build output, adapter versions, and releases. The Hub owns catalog publication and approved package distribution; it does not execute scrapes. Users discover and install the released plugin through AiFetchly’s Plugin Manager.

The plugin owns the actual scrape. Its MCP process launches Puppeteer and contains the platform adapters, selectors, deterministic fallback behavior, extraction logic, error classification, and artifact generation. The AiFetchly host owns plugin installation, permissions, the AI conversation loop, long-running job management, cancellation, progress delivery, AI-provider access, and tool-result serialization.

Yellow Pages scraping can take several minutes, so it must not run as a normal foreground function call. The host must route the plugin tool through the existing `ToolJobRegistry`. The first AI response ends after requesting the tool. Electron then runs the scrape locally. After the job completes or returns a recoverable failure, Electron sends a new request to the AI server containing the structured tool result. The remote AI server does not remain connected while Puppeteer is scraping.

Scraper recovery has two stages:

1. The plugin first performs bounded deterministic recovery, such as retrying navigation, trying packaged fallback selectors, reducing concurrency, or preserving partial results.
2. If deterministic recovery cannot finish the task, the plugin returns a structured, recoverable application error. The next AI-chat round can retry the tool with one of the plugin-approved recovery strategies, use partial results, switch platforms, or ask the user for help.

A later phase may support in-session AI recovery while the same browser page remains open. That requires a generic server-to-host AI recovery broker, preferably MCP sampling where supported. Returning an error alone cannot resume the same browser session because returning completes the MCP call and the current host disconnects the MCP process.
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
│   ├── childprocess/
│   │   └── mcp-server.ts
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
| PreToolUse hook         | Optional model guidance and early validation; authoritative checks belong in the host and plugin runtime. |
| PostToolUseFailure hook | Adds model-facing recovery guidance without changing the underlying error facts.                        |
| MCP server              | Implements the actual tools and owns the Puppeteer process.                                             |
| Platform adapters       | Contain site-specific navigation and extraction behavior.                                               |
| Recovery coordinator    | Runs deterministic fallbacks and classifies failures.                                                   |
| Artifact writer         | Writes complete results to approved plugin-scoped storage.                                              |

Hooks are optional for the first release and are not the enforcement boundary. The skill, command, and hooks do not scrape pages. The MCP server and its imported scraper modules do the work.
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

The host must maintain a conversation- and plugin-scoped recovery ledger across MCP process exits: prior error IDs, canonical search identity, attempt counts, allowed strategies, earliest retry time, and consumed retries. It validates and atomically reserves each retry before spawning work, and passes trusted recovery context to the plugin. Model-supplied counters or `previousErrorId` alone are not authority. The plugin validates local deterministic budgets and strategy inputs. After host restart, reject unrecognized recovery IDs; the user may explicitly start a new search. Hooks only explain this policy.

Partial-result follow-ups start a new scrape unless a separately specified checkpoint contract exists. `resumeStrategy` is guidance, not a promise to resume a closed browser; deduplicate records when combining artifacts.
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
## 19.7 MCP-to-Puppeteer execution sequence

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
## 19.9 Plugin JavaScript dependency packaging

The independent repository builds the MCP SDK, scraper, adapters, and `puppeteer-core` into `dist/yellow-pages-mcp.cjs`. Copy required non-code assets into an explicit package assets directory and test the exact archive after Hub repackaging. Hub validation/packaging never runs `npm install` or the plugin build.

The Hub canonical packager excludes **all `node_modules` directories**, so the previous option to ship plugin-local production `node_modules` is invalid for that route. A dependency that cannot be bundled or packaged as explicit assets blocks release until a supported packaging contract is implemented. Do not silently depend on install scripts or private host dependencies.

Desktop archive limits are currently 50 MiB compressed, 250 MiB extracted, and 5,000 files (`PLUGIN_PACKAGE_LIMITS`); Hub canonical defaults allow 512 MiB uncompressed and 20,000 files. The release must satisfy the stricter desktop limits. Keep the browser binary separate. Hub archive entries use mode 0644, so do not rely on executable bits for bundled scripts/binaries.

The plugin must not resolve through AiFetchly’s `node_modules`, depend on `NODE_PATH`, write inside `app.asar`, download JavaScript on startup, or ship native modules without a verified ABI/target strategy. Builds must include dependency licenses, a lockfile, and reproducible artifact identity.
## 19.11 Repository ownership and release artifact

| Repository | Owns | Must not own |
| --- | --- | --- |
| Independent `yellow-pages-scraper-plugin` (proposed name; URL TBD) | Scraper, adapters/selectors, MCP server, skill/command, optional hooks, result schema, fixtures, release build and CI | Imports from desktop `@/`, Electron settings/Token, application database, main-process task manager |
| `aiFetchly` | Plugin Manager, host runtime/browser capabilities, generic jobs, MCP policy, AI gating, artifact access, legacy removal | Production Yellow Pages scraping engine or bundled fallback adapters after cutover |
| `aifetchly-hub-go` | Catalog identity, version/source attachment, review/validation, compatible target/resource metadata, publication, access decisions, supported artifact/download flows | Scrape execution, business results, browser sessions, desktop AI credentials |

Keep the plugin outside the desktop source/build tree. Its CI must build and test without the desktop checkout or desktop `node_modules`. Ship the prebuilt entry, manifest, skill, command, optional hooks, assets, and licenses in the release package; keep fixtures/build tools in the repository as appropriate. The Hub must receive built output, not a source-only tree that expects customer-side compilation.

Use the same manifest name (`yellow-pages-scraper`) and version throughout the package, Hub version, and desktop provenance. Record the source revision, checksum, build inputs, and supported host/browser versions. Source references must identify reproducible release content. The visible Hub working tree currently allows GitHub/git metadata without a SHA if a ref is present; that is not sufficient reproducibility for this plugin’s release policy. Prefer a commit SHA or an immutable release ZIP with checksum and verify what the deployed Hub accepts.
## 19.13 Publication, installation, and update requirements

1. Build and test the independent plugin release, including canonical-packager survival, desktop archive limits, runtime launch, and adapter fixtures.
2. Create/update the Hub plugin and draft version, register a source, and attach that source to the version. Use existing validation/review and admin publication workflows; retain evidence for the exact built artifact. Publishing regenerates the catalog. No new Yellow Pages-specific Hub endpoint is required.
3. Publish only tested OS/architecture and host-version combinations. Managed versions additionally require the Hub rollout flag, ready resources, and supported targets. Verify deployment configuration; code presence alone is not operational readiness.
4. Refresh the existing Hub catalog, open details, and show permissions, support requirements, installation size where known, access state, and missing dependencies. Resolve fresh access before acquisition. An unsupported host/runtime must produce an actionable upgrade/repair state rather than a healthy-looking unusable plugin.
5. For direct distribution, use the existing source acquisition/import pipeline with pinned identity and checksum verification for the selected source type. For managed distribution, implement `GET /api/v1/plugins/by-id/:pluginId/versions/:versionId/install-plan`, honor `compatible`, and use `POST .../prepare-install` with its opaque `planDigest` where required. Keep tickets, credentials, and signed URLs in the main process; never forward them to the MCP server or AI. Handle stale plans, expiry, revoked artifacts, and unavailable access checks without silent fallback to another source.
6. Stage, validate, register components, and smoke-test runtime/tool discovery before making a version available to AI. A failed install/update must leave the previous working version intact. Update must stop new jobs and drain or cancel active jobs before replacing files; never mix running old code with replaced assets.
7. Preserve plugin-scoped result storage during update/repair. Uninstall cancels owned work and removes components; shared browser resources still used by other features remain installed. Exported user files are never silently deleted.

Version 1 must pass a Hub-to-packaged-desktop installation test on each advertised target. If managed installation is selected, its desktop implementation and Hub deployment readiness are explicit release gates, not assumed completed foundations.
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

The plugin ships a CommonJS MCP entrypoint that runs under AiFetchly's embedded Node version and resolves all JavaScript dependencies from its prebuilt bundle and explicitly packaged assets that survive Hub canonicalization.

### PLUGIN-12: Browser runtime separation

The plugin uses `puppeteer-core` or an equivalent plugin-owned client library and launches only the host-approved browser executable. It does not import the application's Puppeteer package or `BrowserManager` implementation.
## 25.3 Plugin unit tests

- The compiled CommonJS MCP entrypoint starts with AiFetchly's embedded Node version.
- JavaScript dependencies resolve from the canonicalized release bundle and assets without `node_modules` or `NODE_PATH`.
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
