# Security Review: aiFetchly

## Scope

Repository-wide Codex Security scan of AiFetchly with high-impact deep review of Electron IPC, AI/RAG/tooling, plugin/MCP, worker, file/shell, and database-adjacent surfaces.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_d5d4756c1f1b8ec125026235
- Revision: 9c89de894df6e966034c4dd8a11aae4595782e5c
- Snapshot digest: codex-security-snapshot/v1:sha256:3cce281e170a582001ce35f2980fc7d646da37fe3edf91fe17740808bb5f7a2d
- Inventory strategy: repository
- Included paths: .
- Excluded paths: node_modules/, dist/
- Runtime or test status: Static validation with one fast-glob runtime fixture; Electron app was not launched. Dependency advisory audit was deferred because yarn/npm were unavailable.
- Artifacts reviewed: rank_input.jsonl, deep_review_input.jsonl, work_ledger.jsonl, raw_candidates.jsonl, deduped_candidates.jsonl, repository_coverage_ledger.md, per-finding candidate ledgers
- Scan context: Threat model generated during Phase 1 and stored in artifacts/01_context/threat_model.md.

Limitations and exclusions:
- Full deterministic inventory had 3159 rows; 30 high-impact files were full-file reviewed in this bounded run.
- No Electron UI runtime or packaged app was launched.
- Dependency advisory audit could not run against yarn.lock with available tools.
- Excluded node_modules/: Generated/vendor dependency tree excluded from source review.
- Excluded dist/: Build output excluded in favor of source files.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 11 |
| Severity mix | high: 3, medium: 7, low: 1 |
| Confidence mix | high: 9, medium: 2 |
| Coverage | partial |
| Validation mode | Static source/control/sink trace plus targeted fixture for fast-glob behavior. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

AiFetchly is an Electron desktop marketing automation app with privileged main-process IPC, workers, scraping, local SQLite, AI/RAG tools, plugins, MCP, shell/file tools, and sensitive local tokens/cookies/contact data.

### Assets

- local user tokens and refresh tokens
- social cookies and email/proxy credentials
- campaign/contact/email data
- AI chat/tool history
- local files reachable through tool surfaces
- installed plugins/skills/MCP declarations

### Trust Boundaries

- renderer to Electron main process IPC
- untrusted web/scraped content to workers and AI tools
- plugin/skill packages to local execution surfaces
- AI output to privileged shell/file/MCP/RAG tools
- local persistence to later privileged scheduled/tool execution

### Attacker Capabilities

- renderer compromise or untrusted child-window content
- malicious plugin package or MCP declaration
- AI/tool prompt injection controlling tool arguments
- attacker-selected URLs/documents/scraped pages

### Security Objectives

- do not grant untrusted renderer/plugin/AI data main-process code execution
- do not expose local files/secrets through tools or workers without explicit grants
- enforce AI feature gates and tool permissions before work
- constrain worker browser navigation away from local/internal targets

### Assumptions

- local OS account compromise is out of scope
- operator-approved dangerous actions reduce severity unless the privilege boundary itself is bypassed

## Findings

| Finding | Severity | Confidence |
| --- | --- | --- |
| [MCP stdio server configuration can spawn arbitrary local processes](#finding-1) | high | high |
| [RAG upload trusts renderer-supplied file paths and can embed arbitrary local files](#finding-2) | high | high |
| [Website content scraper accepts arbitrary URL schemes and returns fetched content](#finding-3) | high | high |
| [grep_files bypasses deny-list and symlink containment for matched files](#finding-4) | medium | high |
| [RAG document metadata can redirect error-log reads to arbitrary local files](#finding-5) | medium | high |
| [RAG AI IPC handlers bypass USER_AI_ENABLED](#finding-6) | medium | high |
| [Contact extraction worker can fetch internal HTTP(S) URLs](#finding-7) | medium | medium |
| [Shell Allow Once becomes a session-wide approval](#finding-8) | medium | high |
| [Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history](#finding-9) | medium | medium |
| [RAG delete can unlink stored external document paths](#finding-10) | medium | high |
| [glob_files can enumerate denied and symlinked file paths](#finding-11) | low | high |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] MCP stdio server configuration can spawn arbitrary local processes

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | Command execution / privilege bypass |
| CWE | CWE-78 |
| Affected lines | src/modules/MCPClient.ts:161-164, src/service/MCPToolService.ts:277-337, src/main-process/communication/mcp-tool-ipc.ts:57-61, src/service/PluginImportService.ts:498-513 |

#### Summary

Renderer- or plugin-controlled MCP stdio server definitions are trusted as executable commands and spawned by the Electron main process without the shell-tool approval boundary.

#### Root Cause

MCP configuration validates shape but not command provenance or an allowlist before `MCPClient.connectStdio` calls `spawn` and inherits the main process environment.

**sink** — `src/modules/MCPClient.ts:161-164`

sink evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
const child = spawn(command, args, {
```

**root_control** — `src/service/MCPToolService.ts:277-337`

root_control evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
async addMCPServer(config: MCPServerConfig): Promise<number> {
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**sink** — `src/modules/MCPClient.ts:161-164`

sink evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
const child = spawn(command, args, {
```

**root_control** — `src/service/MCPToolService.ts:277-337`

root_control evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
async addMCPServer(config: MCPServerConfig): Promise<number> {
```

**entrypoint/wrapper** — `src/main-process/communication/mcp-tool-ipc.ts:57-61`

entrypoint/wrapper evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
MCP_TOOL_ADD,
```

#### Dataflow

MCP_TOOL_ADD or plugin import -\> MCPToolService persisted stdio config -\> discover/test/execute -\> MCPClient.connectStdio -\> child_process.spawn(command,args).

**sink** — `src/modules/MCPClient.ts:161-164`

sink evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
const child = spawn(command, args, {
```

**root_control** — `src/service/MCPToolService.ts:277-337`

root_control evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
async addMCPServer(config: MCPServerConfig): Promise<number> {
```

**entrypoint/wrapper** — `src/main-process/communication/mcp-tool-ipc.ts:57-61`

entrypoint/wrapper evidence for MCP stdio server configuration can spawn arbitrary local processes.

```typescript
MCP_TOOL_ADD,
```

#### Reachability

A compromised renderer, untrusted plugin package, or user tricked into importing a plugin can configure a stdio MCP server; discovery or execution launches the process before MCP handshake success.

#### Severity

**High** — This is high because it creates local process execution in the privileged Electron main process. It is not critical because the clearest paths require renderer/plugin/MCP configuration reachability rather than unauthenticated internet reachability.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Require an explicit MCP stdio permission prompt equivalent to shell execution, restrict commands to vetted bundled binaries or signed plugin declarations, do not inherit full process.env, and disable plugin MCP servers until explicitly trusted.

Tests:
- Attempt to add a stdio MCP server pointing to a harmless marker command and assert it is blocked until explicit shell-equivalent approval.
- Import a plugin with mcp/servers.json stdio command and assert it is disabled or requires trust before discovery.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-2"></a>

### [2] RAG upload trusts renderer-supplied file paths and can embed arbitrary local files

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | Arbitrary local file read / data exfiltration |
| CWE | CWE-22, CWE-200 |
| Affected lines | src/modules/RAGDocumentModule.ts:105-143, src/main-process/communication/rag-ipc.ts:378-383, src/service/ChunkingService.ts:421-568, src/modules/RagSearchModule.ts:275-303 |

#### Summary

The RAG upload IPC accepts a renderer-provided `filePath`, validates only existence, extension, and size, then reads and embeds that file through the main process.

#### Root Cause

The document source path is not tied to `showOpenDialog`, `SAVE_TEMP_FILE`, or an app-owned upload directory before chunking and remote embedding.

**root_control** — `src/modules/RAGDocumentModule.ts:105-143`

root_control evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
async validateFile(filePath: string): Promise<DocumentValidationResult> {
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:378-383`

entrypoint/wrapper evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
registerValidatedHandler(
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**root_control** — `src/modules/RAGDocumentModule.ts:105-143`

root_control evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
async validateFile(filePath: string): Promise<DocumentValidationResult> {
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:378-383`

entrypoint/wrapper evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
registerValidatedHandler(
```

**sink** — `src/service/ChunkingService.ts:421-568`

sink evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
private async extractDocumentContent(
```

#### Dataflow

RAG_UPLOAD_DOCUMENT payload filePath -\> RAGDocumentModule.validateFile/uploadDocument -\> ChunkingService.extractDocumentContent -\> RagConfigApi.generateEmbedding.

**root_control** — `src/modules/RAGDocumentModule.ts:105-143`

root_control evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
async validateFile(filePath: string): Promise<DocumentValidationResult> {
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:378-383`

entrypoint/wrapper evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
registerValidatedHandler(
```

**sink** — `src/service/ChunkingService.ts:421-568`

sink evidence for RAG upload trusts renderer-supplied file paths and can embed arbitrary local files.

```typescript
private async extractDocumentContent(
```

#### Reachability

Any renderer context with access to the preload bridge can submit a readable supported local path. In combination with child-window preload exposure, untrusted child content could attempt known-path reads.

#### Severity

**High** — This is high because it can read supported local documents and send their contents to a remote embedding service. It is not critical because the attacker needs renderer/preload access and must know or guess readable supported file paths.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Require upload tokens issued by the file picker or SAVE_TEMP_FILE flow, copy files into an app-owned upload root before indexing, and reject arbitrary external paths.

Tests:
- Call RAG_UPLOAD_DOCUMENT with an external temp .txt file and assert the request is rejected unless accompanied by a picker/save-temp grant.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-3"></a>

### [3] Website content scraper accepts arbitrary URL schemes and returns fetched content

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | SSRF / arbitrary URL content disclosure |
| CWE | CWE-918, CWE-200 |
| Affected lines | src/childprocess/websiteContentScraper.ts:71-84, src/childprocess/websiteContentScraper.ts:117-125, src/service/WebsiteAnalysisService.ts:348-362 |

#### Summary

Website analysis accepts any syntactically valid URL and the worker passes it directly to Puppeteer, returning page markdown to the caller or AI workflow.

#### Root Cause

The URL control checks only parseability/truthiness and does not enforce http/https, block file URLs, block loopback/private/metadata destinations, or constrain redirects.

**sink** — `src/childprocess/websiteContentScraper.ts:71-84`

sink evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
// Navigate to URL with timeout
```

**entrypoint/wrapper** — `src/childprocess/websiteContentScraper.ts:117-125`

entrypoint/wrapper evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
parentPort.on('message', async (e: { data: string }) => {
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**sink** — `src/childprocess/websiteContentScraper.ts:71-84`

sink evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
// Navigate to URL with timeout
```

**entrypoint/wrapper** — `src/childprocess/websiteContentScraper.ts:117-125`

entrypoint/wrapper evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
parentPort.on('message', async (e: { data: string }) => {
```

**supporting_entrypoint** — `src/service/WebsiteAnalysisService.ts:348-362`

supporting_entrypoint evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
static async getPageContentAsMarkdown(
```

#### Dataflow

ANALYZE_WEBSITE or read_url_content URL -\> WebsiteAnalysisService.scrapeWebsite -\> child worker SCRAPE_WEBSITE -\> Puppeteer page.goto(url) -\> page.content markdown returned.

**sink** — `src/childprocess/websiteContentScraper.ts:71-84`

sink evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
// Navigate to URL with timeout
```

**entrypoint/wrapper** — `src/childprocess/websiteContentScraper.ts:117-125`

entrypoint/wrapper evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
parentPort.on('message', async (e: { data: string }) => {
```

**supporting_entrypoint** — `src/service/WebsiteAnalysisService.ts:348-362`

supporting_entrypoint evidence for Website content scraper accepts arbitrary URL schemes and returns fetched content.

```typescript
static async getPageContentAsMarkdown(
```

#### Reachability

A renderer or AI tool call can supply the URL. If a child/untrusted renderer has the bridge, it can request local file URLs or localhost/internal HTTP resources and receive rendered content.

#### Severity

**High** — This is high because it can expose local files or internal service content through a privileged worker. It is not critical without runtime proof of broad secret access or unauthenticated external reachability.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Allow only http/https, resolve and block localhost, link-local, private, and metadata IPs before and after redirects, and reject file/data/chrome schemes.

Tests:
- Unit test WebsiteAnalysisService rejects file://, localhost, 127.0.0.1, RFC1918, and redirect-to-private URLs.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-4"></a>

### [4] grep_files bypasses deny-list and symlink containment for matched files

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace plus a fast-glob runtime fixture. |
| Category | Path traversal / sensitive file read |
| CWE | CWE-22, CWE-59, CWE-200 |
| Affected lines | src/service/FileToolService.ts:471-482, src/service/FileToolService.ts:530-546, src/service/FilePathGuard.ts:109-120 |

#### Summary

`grep_files` validates only the search root and then reads each fast-glob match without applying `FilePathGuard` to the matched file.

#### Root Cause

Per-file deny-list and realpath containment are skipped after glob expansion.

**entrypoint/wrapper** — `src/service/FileToolService.ts:471-482`

entrypoint/wrapper evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
const cwd = params.path ? this.guard.validate(params.path) : null;
```

**sink** — `src/service/FileToolService.ts:530-546`

sink evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
const fullPath = path.join(searchPath, file);
```

#### Validation

Validated by static source/control/sink trace plus a fast-glob runtime fixture. Validation details were not recorded separately.

Validation method: static trace plus fast-glob fixture

**entrypoint/wrapper** — `src/service/FileToolService.ts:471-482`

entrypoint/wrapper evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
const cwd = params.path ? this.guard.validate(params.path) : null;
```

**sink** — `src/service/FileToolService.ts:530-546`

sink evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
const fullPath = path.join(searchPath, file);
```

**intended_control** — `src/service/FilePathGuard.ts:109-120`

intended_control evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
// 5. Deny-list check — compute relative path from matching root
```

#### Dataflow

grep_files pattern/path -\> FilePathGuard validates root -\> fast-glob matches .env or symlinked file -\> fs.readFileSync(fullPath) -\> tool result lines returned.

**entrypoint/wrapper** — `src/service/FileToolService.ts:471-482`

entrypoint/wrapper evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
const cwd = params.path ? this.guard.validate(params.path) : null;
```

**sink** — `src/service/FileToolService.ts:530-546`

sink evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
const fullPath = path.join(searchPath, file);
```

**intended_control** — `src/service/FilePathGuard.ts:109-120`

intended_control evidence for grep_files bypasses deny-list and symlink containment for matched files.

```typescript
// 5. Deny-list check — compute relative path from matching root
```

#### Reachability

Requires filesystem tool access or approval; the validation artifact shows fast-glob matches `.env` and follows symlinked directories by default.

#### Severity

**Medium** — Medium: this can disclose sensitive local files inside or via symlink from an approved root, but requires file-tool permission/AI-tool reachability.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Validate every matched file with FilePathGuard using realpath and deny-list, disable followSymbolicLinks, and prevent caller ignore patterns from overriding deny rules.

Tests:
- Fixture with .env and symlink escape: file_read and grep_files should both reject denied/out-of-root files.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-5"></a>

### [5] RAG document metadata can redirect error-log reads to arbitrary local files

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | Arbitrary local file read |
| CWE | CWE-22, CWE-200 |
| Affected lines | src/main-process/communication/rag-ipc.ts:474-488, src/modules/RAGDocumentModule.ts:359-379, src/modules/RAGDocumentModule.ts:525-540 |

#### Summary

The document metadata update path lets renderer input persist an arbitrary `log` path, and the error-log handler later reads it verbatim.

#### Root Cause

The code trusts user-updated metadata.log instead of requiring log paths generated by createErrorLogPath under the app error log directory.

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:474-488`

entrypoint/wrapper evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
registerValidatedHandler(
```

**root_control** — `src/modules/RAGDocumentModule.ts:359-379`

root_control evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
async updateDocumentMetadata(
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:474-488`

entrypoint/wrapper evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
registerValidatedHandler(
```

**root_control** — `src/modules/RAGDocumentModule.ts:359-379`

root_control evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
async updateDocumentMetadata(
```

**sink** — `src/modules/RAGDocumentModule.ts:525-540`

sink evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
async getDocumentErrorLog(documentId: number): Promise<string | null> {
```

#### Dataflow

RAG_UPDATE_DOCUMENT metadata.log -\> RAGDocumentModel.log -\> RAG_GET_DOCUMENT_ERROR_LOG -\> fs.readFileSync(document.log).

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:474-488`

entrypoint/wrapper evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
registerValidatedHandler(
```

**root_control** — `src/modules/RAGDocumentModule.ts:359-379`

root_control evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
async updateDocumentMetadata(
```

**sink** — `src/modules/RAGDocumentModule.ts:525-540`

sink evidence for RAG document metadata can redirect error-log reads to arbitrary local files.

```typescript
async getDocumentErrorLog(documentId: number): Promise<string | null> {
```

#### Reachability

Requires an existing document id or ability to create one and renderer/preload access.

#### Severity

**Medium** — Medium: arbitrary text file read is security-relevant, but the path is scoped to renderer/local app access and readable UTF-8 files.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Make log path write-only through saveErrorLog, reject metadata.log from renderer updates, and enforce containment under the error_logs directory before reads.

Tests:
- Update metadata.log to an external temp file and assert getDocumentErrorLog rejects it.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-6"></a>

### [6] RAG AI IPC handlers bypass USER_AI_ENABLED

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | Feature-gate authorization bypass |
| CWE | CWE-862 |
| Affected lines | src/main-process/communication/rag-ipc.ts:369-383, src/main-process/communication/rag-ipc.ts:588-611, src/main-process/communication/_shared/registerValidatedHandler.ts:57-75 |

#### Summary

RAG query/upload/search/model/test/chunk-and-embed handlers use the generic validated wrapper rather than the AI-gated wrapper.

#### Root Cause

AI/RAG operations do not check `USER_AI_ENABLED` before remote embedding/model work, despite the shared AI wrapper existing for that purpose.

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:369-383`

entrypoint/wrapper evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
registerValidatedHandler(RAG_QUERY, ragQueryInputSchema, async (input) => {
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:588-611`

entrypoint/wrapper evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
registerValidatedHandler(
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:369-383`

entrypoint/wrapper evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
registerValidatedHandler(RAG_QUERY, ragQueryInputSchema, async (input) => {
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:588-611`

entrypoint/wrapper evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
registerValidatedHandler(
```

**intended_control** — `src/main-process/communication/_shared/registerValidatedHandler.ts:57-75`

intended_control evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
export function registerAiValidatedHandler<TInput, TOutput>(
```

#### Dataflow

Renderer RAG channel -\> registerValidatedHandler -\> RagSearchModule remote model/embedding operations.

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:369-383`

entrypoint/wrapper evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
registerValidatedHandler(RAG_QUERY, ragQueryInputSchema, async (input) => {
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:588-611`

entrypoint/wrapper evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
registerValidatedHandler(
```

**intended_control** — `src/main-process/communication/_shared/registerValidatedHandler.ts:57-75`

intended_control evidence for RAG AI IPC handlers bypass USER_AI_ENABLED.

```typescript
export function registerAiValidatedHandler<TInput, TOutput>(
```

#### Reachability

Any renderer with the preload bridge can trigger these operations regardless of the AI feature flag.

#### Severity

**Medium** — Medium: it violates the product permission/plan boundary and can amplify local file exfiltration, but standalone impact is feature-gate bypass rather than direct code execution.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Register AI-backed RAG handlers with registerAiValidatedHandler or perform the Token/USER_AI_ENABLED check before parsing/work.

Tests:
- Set USER_AI_ENABLED=false and assert all RAG AI/embedding channels fail closed before work.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-7"></a>

### [7] Contact extraction worker can fetch internal HTTP(S) URLs

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | SSRF / internal content exposure |
| CWE | CWE-918, CWE-200 |
| Affected lines | src/childprocess/contact-extraction/ContactExtractionWorker.ts:150-157, src/childprocess/contact-extraction/ContactDiscovery.ts:253-289, src/childprocess/contact-extraction/ContactDiscovery.ts:435-439 |

#### Summary

Contact extraction accepts HTTP(S) URLs and navigates with Puppeteer without blocking loopback, private, metadata, DNS-rebinding, or redirect targets.

#### Root Cause

URL validation checks only syntactic http/https and not destination authority or resolved network address.

**entrypoint/wrapper** — `src/childprocess/contact-extraction/ContactExtractionWorker.ts:150-157`

entrypoint/wrapper evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
const { requestId, urls } = message;
```

**sink** — `src/childprocess/contact-extraction/ContactDiscovery.ts:253-289`

sink evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
if (!validateUrl(url)) {
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**entrypoint/wrapper** — `src/childprocess/contact-extraction/ContactExtractionWorker.ts:150-157`

entrypoint/wrapper evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
const { requestId, urls } = message;
```

**sink** — `src/childprocess/contact-extraction/ContactDiscovery.ts:253-289`

sink evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
if (!validateUrl(url)) {
```

**root_control** — `src/childprocess/contact-extraction/ContactDiscovery.ts:435-439`

root_control evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
export function validateUrl(url: string): boolean {
```

#### Dataflow

extractContactFromUrls/result URL -\> ContactExtractionWorker -\> discoverAndExtractContactInfo -\> validateUrl -\> page.goto(url) -\> extraction/optional AI processing.

**entrypoint/wrapper** — `src/childprocess/contact-extraction/ContactExtractionWorker.ts:150-157`

entrypoint/wrapper evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
const { requestId, urls } = message;
```

**sink** — `src/childprocess/contact-extraction/ContactDiscovery.ts:253-289`

sink evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
if (!validateUrl(url)) {
```

**root_control** — `src/childprocess/contact-extraction/ContactDiscovery.ts:435-439`

root_control evidence for Contact extraction worker can fetch internal HTTP(S) URLs.

```typescript
export function validateUrl(url: string): boolean {
```

#### Reachability

Renderer/AI/stored search result URLs can reach the worker; impact depends on internal services reachable from the desktop host.

#### Severity

**Medium** — Medium: SSRF-like internal fetch is plausible and can expose content to extraction/AI, but desktop local-network impact is environment-dependent and not dynamically reproduced.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Validate final destinations before and after redirects, block loopback/link-local/RFC1918/metadata ranges, and cap/disable AI forwarding for internal addresses.

Tests:
- Run worker against local HTTP fixture and assert loopback/private destinations are rejected.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-8"></a>

### [8] Shell Allow Once becomes a session-wide approval

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | Permission bypass |
| CWE | CWE-862, CWE-863 |
| Affected lines | src/service/SkillPermissionService.ts:165-172, src/service/SkillPermissionService.ts:125-137, src/service/ShellToolService.ts:250-257 |

#### Summary

A non-persistent shell permission grant is stored in process-wide sessionGrants and checked before the shell always-prompt rule, allowing later shell commands without fresh confirmation.

#### Root Cause

The intended one-shot approval is not bound to a pending tool call and is checked before category-specific shell prompting.

**root_control** — `src/service/SkillPermissionService.ts:165-172`

root_control evidence for Shell Allow Once becomes a session-wide approval.

```typescript
function grantPermission(skillName: string, persistent: boolean): void {
```

**broken_control** — `src/service/SkillPermissionService.ts:125-137`

broken_control evidence for Shell Allow Once becomes a session-wide approval.

```typescript
if (
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**root_control** — `src/service/SkillPermissionService.ts:165-172`

root_control evidence for Shell Allow Once becomes a session-wide approval.

```typescript
function grantPermission(skillName: string, persistent: boolean): void {
```

**broken_control** — `src/service/SkillPermissionService.ts:125-137`

broken_control evidence for Shell Allow Once becomes a session-wide approval.

```typescript
if (
```

**sink** — `src/service/ShellToolService.ts:250-257`

sink evidence for Shell Allow Once becomes a session-wide approval.

```typescript
const child = spawn(interpreter.command, [...interpreter.args, command], {
```

#### Dataflow

Allow Once or skill:grant-permission persistent=false -\> sessionGrants.add(shell_execute) -\> checkPermission returns allowed -\> ShellToolService.spawn.

**root_control** — `src/service/SkillPermissionService.ts:165-172`

root_control evidence for Shell Allow Once becomes a session-wide approval.

```typescript
function grantPermission(skillName: string, persistent: boolean): void {
```

**broken_control** — `src/service/SkillPermissionService.ts:125-137`

broken_control evidence for Shell Allow Once becomes a session-wide approval.

```typescript
if (
```

**sink** — `src/service/ShellToolService.ts:250-257`

sink evidence for Shell Allow Once becomes a session-wide approval.

```typescript
const child = spawn(interpreter.command, [...interpreter.args, command], {
```

#### Reachability

Requires a user to click Allow Once once, or renderer access to the grant channel, then a later model/tool shell command.

#### Severity

**Medium** — Medium: it bypasses a meaningful local approval boundary for shell commands, but it requires an initial grant or renderer foothold.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Represent one-shot grants as pending tool-call scoped tokens consumed once, and always apply the shell prompt rule unless the current pending shell command matches that token.

Tests:
- Grant shell_execute with persistent=false and assert a second different shell command still returns needsPrompt.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-9"></a>

### [9] Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | IPC bridge exposure / authorization bypass |
| CWE | CWE-346, CWE-862 |
| Affected lines | src/background.ts:372-400, src/preload.ts:540-829, src/main-process/communication/ai-chat-ipc.ts:1103-1165 |

#### Summary

Child windows opened from the app are allowed for every URL and receive the same preload bridge, exposing local AI chat history and clear operations to untrusted child content.

#### Root Cause

`setWindowOpenHandler` does not allowlist trusted origins or remove preload for child windows, and the legacy chat handlers do not re-check sender origin.

**root_control** — `src/background.ts:372-400`

root_control evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
(win as any).webContents.setWindowOpenHandler(({ url }) => {
```

**entrypoint/wrapper** — `src/preload.ts:540-829`

entrypoint/wrapper evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
invoke: (channel, data) => {
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**root_control** — `src/background.ts:372-400`

root_control evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
(win as any).webContents.setWindowOpenHandler(({ url }) => {
```

**entrypoint/wrapper** — `src/preload.ts:540-829`

entrypoint/wrapper evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
invoke: (channel, data) => {
```

**sink** — `src/main-process/communication/ai-chat-ipc.ts:1103-1165`

sink evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
// Get chat history
```

#### Dataflow

window.open/target blank URL -\> BrowserWindow child with preload -\> window.api.invoke AI_CHAT_CONVERSATIONS/HISTORY/CLEAR -\> local AI chat model reads/deletes rows.

**root_control** — `src/background.ts:372-400`

root_control evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
(win as any).webContents.setWindowOpenHandler(({ url }) => {
```

**entrypoint/wrapper** — `src/preload.ts:540-829`

entrypoint/wrapper evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
invoke: (channel, data) => {
```

**sink** — `src/main-process/communication/ai-chat-ipc.ts:1103-1165`

sink evidence for Arbitrary child windows inherit the app IPC bridge and can read or delete AI chat history.

```typescript
// Get chat history
```

#### Reachability

Requires attacker-controlled content to be opened in a child window or renderer compromise. The code makes that child trusted from the IPC bridge perspective.

#### Severity

**Medium** — Medium: the impact is sensitive local chat disclosure/destruction, but exploitability depends on child-window content reachability rather than a standalone network listener.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Deny untrusted child windows or open them externally; only attach preload to trusted app origins; add sender-frame origin checks on sensitive handlers.

Tests:
- Open a child BrowserWindow to a test origin and assert window.api is absent.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-10"></a>

### [10] RAG delete can unlink stored external document paths

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace. |
| Category | Arbitrary local file deletion |
| CWE | CWE-22, CWE-73 |
| Affected lines | src/modules/RAGDocumentModule.ts:75-80, src/modules/RAGDocumentModule.ts:336-340, src/main-process/communication/rag-ipc.ts:493-501 |

#### Summary

Because uploads persist the original renderer-supplied path, `RAG_DELETE_DOCUMENT` with `deleteFile=true` can unlink that external file.

#### Root Cause

Deletion assumes stored document.filePath is app-owned, but upload never copies or contains it.

**supporting_root_control** — `src/modules/RAGDocumentModule.ts:75-80`

supporting_root_control evidence for RAG delete can unlink stored external document paths.

```typescript
// Create document entity
```

**sink** — `src/modules/RAGDocumentModule.ts:336-340`

sink evidence for RAG delete can unlink stored external document paths.

```typescript
// Delete file if requested
```

#### Validation

Validated by static source/control/sink trace. Validation details were not recorded separately.

Validation method: static trace

**supporting_root_control** — `src/modules/RAGDocumentModule.ts:75-80`

supporting_root_control evidence for RAG delete can unlink stored external document paths.

```typescript
// Create document entity
```

**sink** — `src/modules/RAGDocumentModule.ts:336-340`

sink evidence for RAG delete can unlink stored external document paths.

```typescript
// Delete file if requested
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:493-501`

entrypoint/wrapper evidence for RAG delete can unlink stored external document paths.

```typescript
registerValidatedHandler(
```

#### Dataflow

RAG_UPLOAD_DOCUMENT external filePath -\> stored document.filePath -\> RAG_DELETE_DOCUMENT deleteFile=true -\> fs.unlinkSync(document.filePath).

**supporting_root_control** — `src/modules/RAGDocumentModule.ts:75-80`

supporting_root_control evidence for RAG delete can unlink stored external document paths.

```typescript
// Create document entity
```

**sink** — `src/modules/RAGDocumentModule.ts:336-340`

sink evidence for RAG delete can unlink stored external document paths.

```typescript
// Delete file if requested
```

**entrypoint/wrapper** — `src/main-process/communication/rag-ipc.ts:493-501`

entrypoint/wrapper evidence for RAG delete can unlink stored external document paths.

```typescript
registerValidatedHandler(
```

#### Reachability

Requires registering a supported readable file as a document, then delete permission under the same OS user.

#### Severity

**Medium** — Medium: destructive local file impact is real but constrained to files the app user can delete and that first pass RAG upload validation.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Only delete files under an app-owned upload directory, and stop persisting external source paths as deletable targets.

Tests:
- Upload external temp file, delete document with deleteFile=true, assert external file remains.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

<a id="finding-11"></a>

### [11] glob_files can enumerate denied and symlinked file paths

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Validated by static source/control/sink trace plus a fast-glob runtime fixture. |
| Category | Sensitive file enumeration |
| CWE | CWE-22, CWE-59, CWE-200 |
| Affected lines | src/service/FileToolService.ts:432-450, src/service/FileToolService.ts:457-461, src/service/FilePathGuard.ts:109-120 |

#### Summary

`glob_files` returns fast-glob matches without per-match guard validation, so denied names and symlinked outside paths can be enumerated.

#### Root Cause

The deny-list and realpath checks are not applied to glob results.

**entrypoint/wrapper** — `src/service/FileToolService.ts:432-450`

entrypoint/wrapper evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
const cwd = params.cwd ? this.guard.validate(params.cwd) : null;
```

**sink** — `src/service/FileToolService.ts:457-461`

sink evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
const total = allMatches.length;
```

#### Validation

Validated by static source/control/sink trace plus a fast-glob runtime fixture. Validation details were not recorded separately.

Validation method: static trace plus fast-glob fixture

**entrypoint/wrapper** — `src/service/FileToolService.ts:432-450`

entrypoint/wrapper evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
const cwd = params.cwd ? this.guard.validate(params.cwd) : null;
```

**sink** — `src/service/FileToolService.ts:457-461`

sink evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
const total = allMatches.length;
```

**intended_control** — `src/service/FilePathGuard.ts:109-120`

intended_control evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
// 5. Deny-list check — compute relative path from matching root
```

#### Dataflow

glob_files cwd/pattern -\> FilePathGuard validates cwd -\> fast-glob returns .env or symlinked file paths -\> result returned.

**entrypoint/wrapper** — `src/service/FileToolService.ts:432-450`

entrypoint/wrapper evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
const cwd = params.cwd ? this.guard.validate(params.cwd) : null;
```

**sink** — `src/service/FileToolService.ts:457-461`

sink evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
const total = allMatches.length;
```

**intended_control** — `src/service/FilePathGuard.ts:109-120`

intended_control evidence for glob_files can enumerate denied and symlinked file paths.

```typescript
// 5. Deny-list check — compute relative path from matching root
```

#### Reachability

Requires filesystem tool access or approval; exposes path names, not file content.

#### Severity

**Low** — Low: useful reconnaissance and policy bypass, but lower direct impact than grep_files content disclosure.

Severity would increase with proof of unauthenticated external reachability, broad secret exposure, or reliable code execution; it would decrease if sender-origin, trust, or containment controls are added.

#### Remediation

Apply FilePathGuard to every matched path and disable symlink following for glob searches.

Tests:
- Fixture with .env and symlink escape: glob_files should not return denied or out-of-root paths.

Preventive controls:
- Add regression tests at the IPC/service boundary.
- Keep privileged sinks behind centralized permission and path/destination validation helpers.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Electron child windows/preload IPC | renderer-main privilege/data exposure | Reported | Child BrowserWindow allows all URLs with app preload; legacy AI chat history/clear/conversation handlers exposed without sender-origin check. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Legacy/v2 AI chat IPC | AI enable and permission gates | Rejected | v2 and primary AI work paths use AI gate or explicit check; legacy history/clear issue is tracked in COV-IPC-CHILD-001. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| AI file tools | file read/write/edit containment and deny-list | Reported | Direct file operations validate paths, but grep/glob matched paths bypass per-file guard/deny-list and symlink containment. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Shell tool permissioning | command execution approval semantics | Reported | Allow Once creates process-wide session grant checked before shell prompt rule. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Plugin package import | archive traversal and sandbox execution | Rejected | Archive traversal/symlink checks and isolated-vm worker controls close reviewed archive/sandbox rows. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Plugin source fetchers | remote source fetching/SSRF/command behavior | Needs follow-up | Registered source fetchers were not selected for full-file review in this pass. Deferred: Not selected in bounded deep-review set; requires separate shard over pluginSources implementations. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| MCP server/tool execution | local process execution and environment exposure | Reported | Manual or plugin stdio server config reaches spawn with arbitrary command/args and full process.env. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Hook dispatcher | trusted command hook execution | Rejected | Hook execution requires registered/trusted command hooks, shell:false, small env allowlist, and output validation. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| System dependency installer | catalog-driven package manager execution | Rejected | Dependency IDs resolve through shipped catalog and fixed package-manager argv templates; package names are restricted. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Dependency advisories | third-party package vulnerability audit | Needs follow-up | No yarn/npm binary was available in this shell; bundled pnpm cannot audit yarn.lock. Deferred: Package advisory audit not completed due missing compatible package manager. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| RAG document storage | local file read/delete and error-log path control | Reported | Renderer-controlled document filePath/log metadata can be read, embedded, or deleted without containment. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| RAG embedding/search IPC | AI enable gate | Reported | RAG AI operations use generic validated handlers rather than AI-gated handler. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| RAG/vector models | SQL/sqlite-vec query construction | Rejected | Reviewed raw SQL uses parameter binding or validated/generated table names; no attacker SQL syntax path found. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Contact extraction worker | browser navigation SSRF/internal content exfiltration | Reported | Worker accepts HTTP(S) URLs and navigates with no private/internal destination filtering or redirect policy. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Website content scraper | browser navigation SSRF/file URL content disclosure | Reported | Worker accepts arbitrary URL strings and returns fetched page markdown. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Google Maps worker | arbitrary URL/DB/file write | Rejected | Worker constructs fixed google.com/maps/search URL and does not navigate extracted third-party website links or write DB/files directly. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Desktop deep link auth | token injection/state validation | Rejected | Token params/extras are rejected and code/state are consumed through pending auth/PKCE flow; broad host branch lacks exploit without state/code bypass. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |
| Repository long tail | unreviewed deterministic inventory outside selected high-impact rows | Needs follow-up | 30 high-impact files received full-file review; remaining inventory not exhaustively full-file reviewed in this bounded run. Deferred: Would require additional repository-wide ranking/review batches for honest full coverage. Evidence: artifacts/03_coverage/repository_coverage_ledger.md |

## Open Questions And Follow Up

- Should MCP stdio support be restricted to trusted signed plugins or explicit user-approved commands?
  - Follow-up prompt: Review src/modules/MCPClient.ts and src/service/MCPToolService.ts for a hardened MCP stdio trust model and tests.
- Which renderer surfaces can open untrusted child windows with preload today?
  - Follow-up prompt: Audit Vue renderer links and window.open use for child-window preload exposure from src/background.ts:372.
- Can plugin source fetchers reach local/internal networks or execute source-manager commands unsafely?
  - Follow-up prompt: Run a focused Codex Security scan on src/service/pluginSources/.
- Plugin source fetchers were not selected for full-file review in this bounded pass.
  - Follow-up prompt: Review deferred unit defer-plugin-source-fetchers and close its stated proof gap. Paths: src/service/pluginSources/.
- No yarn/npm binary was available and bundled pnpm cannot audit yarn.lock.
  - Follow-up prompt: Review deferred unit defer-dependency-advisories and close its stated proof gap. Paths: package.json, yarn.lock.
- 30 high-impact files were deep-reviewed from a 3159-row deterministic inventory; remaining rows require follow-up batches.
  - Follow-up prompt: Review deferred unit defer-long-tail-inventory and close its stated proof gap. Paths: rank_input.jsonl.
