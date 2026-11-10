# Yellow Pages Scraper Plugin — Independent Repository — Technical Design

**Status:** Proposed; implementation and release gates remain open.\
**Split date:** 2026-10-19. Source review: 2026-10-14; this split does not reverify implementation or deployment.\
**Implementation repository:** Independent `yellow-pages-scraper-plugin` (location TBD).\
**Companion document:** [Product requirements](yellow-pages-scraper-plugin-prd.md).\
**Other repository:** [Desktop technical design](aifetchly-desktop-yellow-pages-plugin-technical-design.md).

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

The source technical review used desktop `58fb0b54` and a Hub working tree based on `71b8c84`; the PRD used desktop `70037427`. These are historical evidence, not current verification. The Hub tree included unrelated publishing/source edits. Names marked **new** are proposed; numeric defaults marked **proposed** need product approval before release.

## Detailed sections owned by this repository

- [4. Independent repository and release tree](yellow-pages-scraper-plugin-technical-design.md#4-independent-repository-and-release-tree)
- [5.1 Proposed native manifest](yellow-pages-scraper-plugin-technical-design.md#51-proposed-native-manifest)
- [5.2 MCP server declaration](yellow-pages-scraper-plugin-technical-design.md#52-mcp-server-declaration)
- [10. MCP tool and business record contracts](yellow-pages-scraper-plugin-technical-design.md#10-mcp-tool-and-business-record-contracts)
- [10.1 Public input](yellow-pages-scraper-plugin-technical-design.md#101-public-input)
- [10.2 Normalized records](yellow-pages-scraper-plugin-technical-design.md#102-normalized-records)
- [10.3 Domain result envelope](yellow-pages-scraper-plugin-technical-design.md#103-domain-result-envelope)
- [11. Plugin scraper implementation](yellow-pages-scraper-plugin-technical-design.md#11-plugin-scraper-implementation)
- [12.1 Deterministic recovery](yellow-pages-scraper-plugin-technical-design.md#121-deterministic-recovery)
- [12.3 Recovery outcome policy](yellow-pages-scraper-plugin-technical-design.md#123-recovery-outcome-policy)
- [15. Hub direct distribution implementation](yellow-pages-scraper-plugin-technical-design.md#15-hub-direct-distribution-implementation)

## Integration references owned by the other repository

- [1. Decisions and scope](aifetchly-desktop-yellow-pages-plugin-technical-design.md#1-decisions-and-scope)
- [2. Current implementation and required changes](aifetchly-desktop-yellow-pages-plugin-technical-design.md#2-current-implementation-and-required-changes)
- [3. Architecture and ownership](aifetchly-desktop-yellow-pages-plugin-technical-design.md#3-architecture-and-ownership)
- [5. Versioned manifest and compatibility contract](aifetchly-desktop-yellow-pages-plugin-technical-design.md#5-versioned-manifest-and-compatibility-contract)
- [5.3 Persistence and launch authority](aifetchly-desktop-yellow-pages-plugin-technical-design.md#53-persistence-and-launch-authority)
- [5.4 Tool policy registry](aifetchly-desktop-yellow-pages-plugin-technical-design.md#54-tool-policy-registry)
- [6. Host runtime and browser provisioning](aifetchly-desktop-yellow-pages-plugin-technical-design.md#6-host-runtime-and-browser-provisioning)
- [7. Execution context and job admission](aifetchly-desktop-yellow-pages-plugin-technical-design.md#7-execution-context-and-job-admission)
- [8. Managed async execution sequence](aifetchly-desktop-yellow-pages-plugin-technical-design.md#8-managed-async-execution-sequence)
- [9. Deadlines, progress, and cancellation](aifetchly-desktop-yellow-pages-plugin-technical-design.md#9-deadlines-progress-and-cancellation)
- [10.4 Normalization precedence](aifetchly-desktop-yellow-pages-plugin-technical-design.md#104-normalization-precedence)
- [12. Recovery across process lifetimes](aifetchly-desktop-yellow-pages-plugin-technical-design.md#12-recovery-across-process-lifetimes)
- [12.2 Host recovery ledger](aifetchly-desktop-yellow-pages-plugin-technical-design.md#122-host-recovery-ledger)
- [13. File artifacts, export, and retention](aifetchly-desktop-yellow-pages-plugin-technical-design.md#13-file-artifacts-export-and-retention)
- [14. Plugin activation, update, disable, and uninstall](aifetchly-desktop-yellow-pages-plugin-technical-design.md#14-plugin-activation-update-disable-and-uninstall)
- [16. Conditional managed/ticketed distribution](aifetchly-desktop-yellow-pages-plugin-technical-design.md#16-conditional-managedticketed-distribution)
- [17. Migration and legacy removal](aifetchly-desktop-yellow-pages-plugin-technical-design.md#17-migration-and-legacy-removal)
- [18. Implementation ownership and change map](aifetchly-desktop-yellow-pages-plugin-technical-design.md#18-implementation-ownership-and-change-map)
- [19. Verification plan](aifetchly-desktop-yellow-pages-plugin-technical-design.md#19-verification-plan)
- [20. Security, diagnostics, and operational limits](aifetchly-desktop-yellow-pages-plugin-technical-design.md#20-security-diagnostics-and-operational-limits)
- [21. Delivery sequence and unresolved release decisions](aifetchly-desktop-yellow-pages-plugin-technical-design.md#21-delivery-sequence-and-unresolved-release-decisions)
- [22. Source references](aifetchly-desktop-yellow-pages-plugin-technical-design.md#22-source-references)

## 4. Independent repository and release tree

Proposed source layout:

```text
yellow-pages-scraper-plugin/
├── .aifetchly-plugin/plugin.json
├── .mcp.json
├── skills/yellow-pages-scraper/SKILL.md
├── commands/yellow-pages.md
├── contracts/
│   ├── scrape-input.v1.schema.json
│   ├── scrape-result.v1.schema.json
│   ├── host-context.v1.schema.json
│   ├── progress.v1.schema.json
│   ├── partial.v1.schema.json
│   └── fixtures/
├── src/
│   ├── childprocess/
│   │   ├── mcp-server.ts
│   │   ├── HostContextReader.ts
│   │   ├── McpToolHandlers.ts
│   │   └── ShutdownCoordinator.ts
│   ├── scraper/
│   │   ├── ScrapeCoordinator.ts
│   │   ├── BrowserSession.ts
│   │   ├── DeterministicRecovery.ts
│   │   ├── RecordNormalizer.ts
│   │   ├── ResultWriter.ts
│   │   └── ScraperError.ts
│   ├── platforms/
│   │   ├── PlatformAdapter.ts
│   │   ├── PlatformCatalog.ts
│   │   └── adapters/
│   └── contracts/
├── assets/                       # Explicit runtime assets, if required
├── test/{unit,contracts,integration,fixtures}/
├── scripts/{build,verify-package,publish-metadata}.ts
├── dist/yellow-pages-mcp.cjs
├── package.json
├── yarn.lock
├── THIRD_PARTY_NOTICES
└── .github/workflows/
```

The process entrypoint lives in `src/childprocess/`. Other scraper files are pure plugin domain code; worker-specific messaging/shutdown stays under `childprocess`. The new repository must set its own equivalent architecture rules. It must not depend on a relative checkout of the desktop, its `@/` alias, its `node_modules`, or Electron source modules.

The runtime bundle includes MCP SDK, `puppeteer-core`, adapters, and extraction dependencies. Browser binaries are external host-managed dependencies. Hub canonical packaging excludes `node_modules`, so all needed runtime code must be bundled and any dynamic assets copied explicitly. No install/build/postinstall script runs on customer machines or during Hub static validation.

Maintain developer source on the normal branch. CI produces a release commit/tree containing the distributable at the repository root plus required metadata; the Hub points to that exact commit. Do not assume fetching a source commit will run the build. The manifest version and release inventory agree before publishing. Optional hooks can be added later; they are not necessary to enforce retry policy.
## 5.1 Proposed native manifest

This is a **new schema**, not a currently executable package. `hostRequirements` and `capabilities` are typed extensions proposed here. Capability names are separate from existing `SkillPermissionCategory` values.

```json
{
  "name": "yellow-pages-scraper",
  "displayName": "Yellow Pages Scraper",
  "version": "1.0.0",
  "description": "Find and export business listings from supported directories.",
  "skills": ["skills/yellow-pages-scraper"],
  "mcpServers": [".mcp.json"],
  "permissions": ["network", "automation", "filesystem"],
  "hostRequirements": {
    "contractVersion": 1,
    "capabilities": {
      "mcp-host-node": 1,
      "mcp-managed-async": 1,
      "browser-executable": 1,
      "plugin-file-artifacts": 1
    }
  },
  "capabilities": {
    "browserExecutable": true,
    "fileArtifacts": ["json", "csv"]
  },
  "toolPolicies": {
    "scraper/scrape_yellow_pages": {
      "contractVersion": 1,
      "timeoutClass": "async",
      "maxRunMs": 1800000,
      "supportsProgress": true,
      "supportsPartialResult": true,
      "cancellable": true,
      "maxConcurrentPerConversation": 1,
      "resultContract": "aifetchly.plugin-result.v1"
    },
    "scraper/list_yellow_pages_platforms": {
      "contractVersion": 1,
      "timeoutClass": "fast",
      "maxRunMs": 30000,
      "supportsProgress": false,
      "supportsPartialResult": false,
      "cancellable": true,
      "maxConcurrentPerConversation": 1
    }
  }
}
```

`permissions` expresses requested categories; it does not grant them. Grant evaluation remains host-owned. `filesystem` is constrained by the file-artifact capability in host code; it must not become permission for model-supplied paths. The PRD’s illustrative `plugin-storage` name maps to this concrete file-artifact contract. No `ai-recovery` permission is requested in v1.

`aifetchly.plugin-result.v1` identifies the generic host envelope for status, safe error/recovery metadata, and artifact candidates. The business-record/summary schema is plugin-owned and advertised through the MCP tool output schema; the host must not add a Yellow Pages-specific result parser or import plugin domain types. The TypeScript scrape types in [§10](yellow-pages-scraper-plugin-technical-design.md#10-mcp-tool-and-business-record-contracts) describe plugin contracts and shared fixtures.

Validate extension versions, enums, bounds, referenced servers/tools, and path confinement. Reject unknown fields within these typed extension blocks; preserve unrelated manifest extras only under existing compatibility behavior. Unknown required host capability prevents activation. Add a stable unsupported-host diagnostic, mapped to existing `needs_configuration`/`invalid` health semantics as appropriate; do not report healthy readiness.

At release, fill target metadata with the actual minimum desktop version that implements these capabilities. No fictional minimum app version appears in this example. Older clients that ignore extensions must still fail closed on the runtime declaration: there is no fallback `command` in [§5.2](yellow-pages-scraper-plugin-technical-design.md#52-mcp-server-declaration).
## 5.2 MCP server declaration

```json
{
  "mcpServers": {
    "scraper": {
      "transport": "stdio",
      "runtime": "aifetchly-node",
      "entry": "dist/yellow-pages-mcp.cjs",
      "timeout": 30000,
      "description": "Local Yellow Pages tools"
    }
  }
}
```

The `timeout` is the default foreground/discovery request ceiling. Async execution uses policy and remaining job budget, not this value. `runtime`/`entry` and legacy `command`/`args` are mutually exclusive. Reject plugin-provided runtime command-line overrides, absolute entries, `..`, symlink escape, and conflicting launch environment.

Extend `PluginMcpServerDeclaration` and `NormalizedMcpServer` as discriminated variants. Keep manually configured external MCP commands working under their current validation; do not silently convert them to host runtime mode.
## 10. MCP tool and business record contracts
### 10.1 Public input

```typescript
type ListingField =
  | "businessName" | "phone" | "email" | "website" | "address"
  | "categories";

type RecoveryStrategy =
  | "fallback_adapter" | "reduced_scope" | "switch_platform"
  | "retry_after_delay";

interface ScrapeInputV1 {
  readonly query: string;
  readonly location: string;
  readonly platform?: string;
  readonly maxResults?: number;
  readonly includeDetailPages?: boolean;
  readonly fields?: readonly ListingField[];
  readonly recovery?: {
    readonly previousErrorId: string;
    readonly strategy: RecoveryStrategy;
  };
}
```

Proposed validation: trim query/location; each 1–256 characters; default `platform: "auto"`; default 100 results, hard cap 1,000; default detail pages enabled; deduplicated allowlisted fields. Reject extra top-level fields and all caller-supplied paths, scripts, cookies, browser flags, host context, and retry counters. The host validates schema before admission; the plugin revalidates its domain schema.

`auto` chooses only an adapter advertised as ready for the supplied region. If region cannot be determined reliably, return an actionable ambiguity/unsupported-platform outcome; do not silently scrape an unrelated country. `list_yellow_pages_platforms` returns bounded IDs, labels, countries, supported fields, and availability. Importing an adapter does not establish live site support.
### 10.2 Normalized records

```typescript
interface BusinessRecordV1 {
  readonly recordId: string;
  readonly platform: string;
  readonly businessName: string;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly address?: {
    readonly formatted: string;
    readonly countryCode?: string;
  };
  readonly categories?: readonly string[];
  readonly sourceUrl: string;
  readonly collectedAt: string;
}
```

Use a versioned normalization strategy. Prefer a stable directory listing ID for deduplication; otherwise hash platform plus normalized canonical source URL and business identity. Do not merge unrelated businesses merely because phone numbers match. Return only requested business fields plus minimal provenance; missing values are absent, never AI-invented. Cap individual fields and URLs before serialization.

`EMPTY_RESULTS` is not automatically an error. Confirmed no-results UI with valid selectors produces `completed` and zero records. Missing result containers without no-results evidence produces `RESULT_SELECTOR_NOT_FOUND`. Do not confuse exhaustion with a block or parser failure.
### 10.3 Domain result envelope

```typescript
interface ScrapeSummaryV1 {
  readonly platform: string;
  readonly query: string;
  readonly location: string;
  readonly recordCount: number;
  readonly pagesVisited: number;
  readonly detailPagesVisited: number;
  readonly durationMs: number;
}

interface ScrapeErrorV1 {
  readonly id: string;
  readonly code: string;
  readonly category: "transient" | "site_changed" | "rate_limited"
    | "blocked" | "invalid_input" | "dependency" | "permission"
    | "plugin_bug" | "cancelled";
  readonly stage: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly allowedStrategies: readonly RecoveryStrategy[];
  readonly retryAfterMs?: number;
}

type ScrapeResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly success: true;
      readonly status: "completed" | "partial";
      readonly summary: ScrapeSummaryV1;
      readonly preview: readonly BusinessRecordV1[];
      readonly warnings: readonly string[];
    }
  | {
      readonly schemaVersion: 1;
      readonly success: false;
      readonly status: "failed" | "cancelled";
      readonly error: ScrapeErrorV1;
      readonly summary?: ScrapeSummaryV1;
      readonly preview: readonly BusinessRecordV1[];
    };
```

Artifact candidates are a separate plugin-to-host field ([§13](aifetchly-desktop-yellow-pages-plugin-technical-design.md#13-file-artifacts-export-and-retention)); the host adds registered artifact references to the public envelope. Optional safe observations use a separately capped schema from the PRD, not arbitrary nested objects. `schemaVersion` is required. The primary model-facing `artifact` reference remains compatible with the PRD; an optional `artifacts` array can carry both JSON and CSV.

Useful incomplete data is `success: true, status: "partial"` only after at least one usable artifact is registered. Artifact registration failure cannot become a completed success. Cancellation remains `success: false` even when a partial artifact is retained. A cancelled turn must not automatically resume AI recovery.
## 11. Plugin scraper implementation

### 11.1 Adapter interface

```typescript
interface PlatformAdapter {
  readonly id: string;
  readonly countries: readonly string[];
  readonly supportedFields: readonly ListingField[];
  search(context: AdapterContext, input: ScrapeInputV1): Promise<void>;
  extractListings(context: AdapterContext): Promise<readonly BusinessRecordV1[]>;
  nextPage(context: AdapterContext): Promise<boolean>;
  enrichListing(context: AdapterContext, record: BusinessRecordV1): Promise<BusinessRecordV1>;
  classifyPage(context: AdapterContext): Promise<PageClassification>;
}
```

`AdapterContext` is plugin-local and supplies typed Puppeteer page access, cancellation, time budget, rate limiting, and safe diagnostics. `PageClassification` distinguishes listings, confirmed empty results, consent, authentication, challenge, and unexpected layout. These types live in the plugin; the host does not import Puppeteer or site selectors for this feature.

### 11.2 Scrape pipeline

1. Validate context/input and choose a supported adapter.
2. Open output staging and launch a browser with an isolated profile.
3. Navigate to the directory through the adapter’s allowed origins.
4. Classify the page before extraction; handle packaged consent logic only.
5. Extract, normalize, validate, and deduplicate listings.
6. Optionally enrich from directory detail pages with bounded concurrency.
7. Append records incrementally; publish counts and periodic finalized checkpoints.
8. Stop at result cap, pagination exhaustion, deadline, cancellation, or terminal block.
9. Finalize JSON/CSV and candidate manifest; close browser; return a bounded result.

Proposed detail concurrency is two pages per job, clamped by platform policy. Retries use abortable backoff and a per-origin limiter. A detail failure preserves the base listing with a warning. Use an upper page/visit budget in addition to record count to avoid looping through duplicate pages indefinitely.

Linked business websites are not implied by directory detail permission. v1 collects emails only when available on permitted directory pages unless the product explicitly includes linked-site crawling. That extension requires redirect/DNS/private-network policy, origin budget, and field-specific tests. No captcha bypass, arbitrary model-generated script, or raw HTML transfer is part of this plugin.

### 11.3 Adapter migration matrix

Current active configuration imports include:

| Config source | Migration check |
| --- | --- |
| `yell-com.ts` | Search/location, pagination, directory details |
| `11880-de.ts`, `gelbeseiten-de.ts` | German location normalization and field extraction |
| `paginegialle-it.ts`, `pagesjaunes-fr.ts` | Country-specific search and consent fixtures |
| `yelp-com.ts`, `yellowpages-com.ts` | Platform selection, detail fields, block classification |
| `itownpage-jp.ts`, `usonar-yellowpage-jp.ts` | Japanese text/location handling and pagination |
| `korealocalpages-kr.ts`, `yellowpages-com-sg.ts` | Regional selection and detail extraction |

This is a source inventory, not a claim that every adapter works or must ship in 1.0. Build fixture and staging evidence for each; publish only the approved subset in `PlatformCatalog`. Existing extra adapter files, such as Canadian adapters, need consumer tracing before deletion. Preserve dependencies shared with other features.
## 12.1 Deterministic recovery

Plugin-owned retries cover navigation reloads, packaged fallback selectors, backoff after transient errors, lower detail concurrency, and skipping malformed records. Proposed default is two retries per transient operation, bounded by total job deadline and per-origin limits. Auth/captcha/permission/dependency failures stop without retry.
## 12.3 Recovery outcome policy

| Failure | Automatic action |
| --- | --- |
| Changed selector with packaged fallback | One eligible new call using `fallback_adapter` |
| Recoverable detail pressure | `reduced_scope`, preserving already exported data |
| Rate limit | Retry only after allowed time and within deadline/budget; otherwise explain delay |
| Supported alternate directory | `switch_platform` with retained logical-search budget |
| Confirmed no results | Completed zero-result output, no automatic retry |
| CAPTCHA/login required | Stop and explain; no live-session handoff is promised in v1 |
| Missing browser, denied permission, crash, invalid result | Repair/intervention; no automatic repeated scrape |
| User cancellation or cleanup failure | Stop; no automatic retry |

A subsequent scrape starts fresh. Combining outputs requires deduplication by record identity; `resumeStrategy` does not promise continuation of the previous browser session.
## 15. Hub direct distribution implementation

### 15.1 First-release acquisition contract

For public distribution, publish a GitHub source whose repository/ref identify the **prebuilt release commit**, not a moving development branch. Illustrative catalog source fragment:

```json
{
  "source": "github",
  "repo": "OWNER/yellow-pages-scraper-plugin",
  "ref": "0123456789abcdef0123456789abcdef01234567",
  "sha": "0123456789abcdef0123456789abcdef01234567"
}
```

`OWNER` and the SHA are placeholders, not release coordinates. The current desktop normalizer prefers `sha` over `ref`, then GitHub acquisition resolves/downloads the commit archive and records `resolvedCommitSha`. Validate the SHA shape at the catalog boundary and compare installed provenance with the selected version. Do not use `/tree/<ref>` or `/commit/<sha>` browser URLs; the fetcher expects repository identity plus the ref field.

The fetched archive must have a discoverable manifest at its root (or supported single enclosing directory) and built `dist`. Verify the archive-install feature flag in packaged apps; a native-git compatibility fallback cannot satisfy the no-git acceptance test. No npm source is selected for v1 because acquisition must not require customer-side package tooling.

A commit pin identifies source content, not an independent archive signature. If stronger signed/checksummed ZIP delivery is required, implement and select the corresponding integrity route; do not claim that the current direct source verifies a Hub artifact SHA256.

### 15.2 Hub validation changes

Reuse native manifest discovery, capability scanning, static validation reports, version/source attachment, and catalog publication. Add validators for host requirements, tool policies, and the `aifetchly-node` declaration. Ensure declaration scanning reads the manifest’s declared `.mcp.json` rather than assuming only `mcp/servers.json`.

The current managed declaration parser expects a Python runtime object; this design uses a host runtime string. Add explicit runtime dispatch before Python parsing:

- Legacy command server → existing validation.
- `runtime: "aifetchly-node"` → host-runtime/entry/compatibility validator; no Python environment/resource rows.
- Managed/uv Python object → existing managed normalization.
- Unknown runtime → unsupported declaration error.

Inspect the validation-to-normalization enqueue path so a valid host-runtime plugin is not rejected later by the Python normalizer. A host capability does not imply a downloadable Hub-managed runtime. Direct v1 should retain `resource_status: not_required` only when it truly has no Hub-managed resources; browser dependency readiness is supplied by desktop and shown in compatibility diagnostics.

### 15.3 Publishing workflow

The independent plugin CI builds/tests the release and produces source revision, package inventory, dependency notices, checksums, and target compatibility evidence. Use existing Hub admin workflow:

1. Create/update plugin identity.
2. Create draft version with matching manifest version.
3. Create source metadata and attach source to version.
4. Complete static validation/review for the exact release content.
5. Set tested target/minimum-host compatibility metadata supported by the selected catalog/detail route.
6. Publish and verify the refreshed catalog contains the correct access/install mode and source.
7. Install that catalog entry in a packaged desktop staging test before general availability.

No Yellow Pages-specific Hub endpoint is necessary. Hub code/flags and public metadata vary by deployment; staging acceptance must verify actual behavior. Existing uncommitted SHA-optional changes in the Hub do not relax this plugin’s immutable-release requirement.

### 15.4 Canonical packaging constraints

Although direct GitHub acquisition does not necessarily download the canonical Hub ZIP, CI should test canonicalization to keep future delivery compatible. The Hub strips `node_modules`, caches, VCS data, credential-shaped files, and fixes file modes to 0644. Do not depend on executable bits, symlinks, or install scripts.

Current desktop limits are 50 MiB compressed, 250 MiB extracted, 5,000 files. Hub canonical defaults permit 512 MiB uncompressed and 20,000 files. Enforce the stricter desktop limits in release CI. Exclude fixtures/source maps containing unnecessary source or secrets from the distributable; keep required runtime assets and licenses. Test the resulting bytes by launching MCP and exercising fixtures after canonicalization.
