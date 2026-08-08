# Knowledge Library Website Import AI Tool - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-07-24 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/knowledge-library-website-import-ai-tool-prd.md` |
| Primary code paths | `src/service/KnowledgeLibraryAiTools.ts`, `src/entityTypes/knowledgeLibraryAiToolTypes.ts`, `src/config/skillsRegistry.ts`, `src/service/WebsiteAnalysisService.ts`, `src/childprocess/websiteContentScraper.ts`, `src/service/HtmlConversionService.ts`, `src/service/UrlGuard.ts`, `src/service/PuppeteerSsrfGuard.ts`, `src/modules/RagSearchModule.ts`, `src/modules/RAGDocumentModule.ts`, `src/model/RAGDocument.model.ts`, `src/entity/RAGDocument.entity.ts` |

## 1. Purpose

This document translates `docs/prd/knowledge-library-website-import-ai-tool-prd.md` into an implementation-facing technical design.

The feature gives AI Chat a safe tool surface for importing website knowledge:

```text
User: "Import https://example.com/pricing into my knowledge library"
  -> LLM calls knowledge_library_import_website({ mode: "single_page", url })
  -> SkillExecutor prompts for permission
  -> KnowledgeLibraryAiTools validates args and AI gate
  -> Website import service scrapes and stages markdown
  -> RagSearchModule.uploadDocument() imports, chunks, and embeds
  -> tool_result returns compact imported/skipped page metadata
```

The implementation must keep the existing architecture boundary:

```text
AI tool layer
  -> validates tool arguments, checks AI enablement, formats safe results

Website import service layer
  -> validates URLs, coordinates scrape/crawl, stages markdown files

Child process layer
  -> performs browser navigation and HTML-to-markdown extraction only

RAG module/service layer
  -> owns upload, validation, duplicate checks, chunking, embedding, cleanup

Model layer
  -> owns database access
```

No AI tool wrapper, IPC handler, or child process should access TypeORM repositories directly.

## 2. Current System Summary

### 2.1 Knowledge Library AI Tool Surface

Current built-in knowledge tools live in `src/config/skillsRegistry.ts` and call functions from `src/service/KnowledgeLibraryAiTools.ts`.

Existing tools:

```text
knowledge_library_search
knowledge_library_list_documents
knowledge_library_import_attachment
knowledge_library_delete_document
```

`knowledge_library_import_attachment` already has the correct orchestration shape:

```text
KnowledgeLibraryAiTools.importAttachment()
  -> parse zod input
  -> check USER_AI_ENABLED through Token
  -> resolve conversation-scoped attachment_ref through DocumentService
  -> validate file through RAGDocumentModule
  -> check duplicate through RAGDocumentModule
  -> RagSearchModule.initializeRagModule()
  -> RagSearchModule.uploadDocument()
  -> return compact metadata
```

Website import should extend the same service rather than adding a separate execution model.

### 2.2 Existing Website Scrape Path

AiFetchly already has a browser-based page reader:

```text
WebsiteAnalysisService.getPageContentAsMarkdown(url)
  -> WebsiteAnalysisService.scrapeWebsite(url)
  -> utilityProcess.fork(childprocess/websiteContentScraper.js)
  -> websiteContentScraper.scrapeWebsite(url)
  -> UrlGuard.validateWithDns(url)
  -> Puppeteer page.goto()
  -> PuppeteerSsrfGuard on browser requests
  -> page.content()
  -> HtmlConversionService.convertHtmlToMarkdown(html)
```

The current public method truncates content for chat context. Website import must not use the truncated context reader directly. It should reuse the worker and conversion pipeline, but needs an import-oriented scrape API that returns full bounded markdown plus metadata.

### 2.3 Existing RAG Import Path

The existing RAG upload path is:

```text
RagSearchModule.uploadDocument(options)
  -> checkAndSetDefaultEmbeddingModel()
  -> DocumentService.uploadDocument(options)
  -> RAGDocumentModule.uploadDocument(options)
  -> RAGDocumentModule.validateFile(filePath)
  -> RAGDocumentModule.stageUploadFile(filePath, ext)
  -> RAGDocumentModel.createDocument(document)
  -> ChunkingService.chunkDocument(document)
  -> embedding provider
  -> VectorStoreService.storeEmbedding()
  -> DocumentService.updateDocumentMetadata()
  -> DocumentService.updateDocumentStatus(completed)
```

Website import must feed generated `.md` files into this path. It should not create chunks, embeddings, vector indexes, or document rows itself.

### 2.4 Existing File Type Support

`RAGDocumentModule` already supports `.md`, so converted webpages can be staged as markdown and imported without expanding supported file types.

### 2.5 Existing URL Safety

`UrlGuard` provides:

- HTTP/HTTPS scheme allowlist.
- blocked internal hostnames.
- blocked private, loopback, link-local, carrier NAT, unspecified, and metadata IPs.
- DNS-aware validation.
- credential URL rejection.

`PuppeteerSsrfGuard` applies DNS-aware validation to browser requests so redirects and subresources are blocked before navigation reaches internal/private targets.

The new feature must use these existing guards both before spawning the worker and inside the worker.

## 3. Target Architecture

### 3.1 New Files

Add:

```text
src/service/WebsiteKnowledgeImportService.ts
test/vitest/main/websiteKnowledgeImportService.test.ts
```

Add or extend tests:

```text
test/vitest/main/knowledgeLibraryAiTools.test.ts
test/vitest/main/knowledgeLibraryAiToolPermissions.test.ts
test/vitest/main/service/ToolLoadPolicyService.test.ts
test/vitest/main/service/ToolCatalogService.test.ts
```

Optional if metadata columns are included in the first implementation:

```text
test/modules/RAGDocumentWebsiteMetadata.test.ts
```

### 3.2 Modified Files

Modify:

```text
src/entityTypes/knowledgeLibraryAiToolTypes.ts
src/service/KnowledgeLibraryAiTools.ts
src/config/skillsRegistry.ts
src/service/ToolLoadPolicyService.ts
src/childprocess/websiteContentScraper.ts
src/service/WebsiteAnalysisService.ts
```

Recommended metadata modifications:

```text
src/entity/RAGDocument.entity.ts
src/model/RAGDocument.model.ts
src/modules/RAGDocumentModule.ts
src/service/DocumentService.ts
```

### 3.3 Runtime Flow

```text
LLM tool call
  -> SkillExecutor.execute("knowledge_library_import_website")
  -> KnowledgeLibraryAiTools.importWebsite(args, context)
  -> importKnowledgeWebsiteInputSchema.parse(args)
  -> Token(USER_AI_ENABLED) check
  -> WebsiteKnowledgeImportService.prepareImportSources(input)
     -> UrlGuard.validateWithDns(seed/input URLs)
     -> utilityProcess.fork(websiteContentScraper)
     -> worker revalidates URL and scrapes rendered page
     -> worker converts HTML to markdown
     -> service stages one .md file per page under app-owned staging
  -> for each staged source:
     -> RAGDocumentModule.validateFile(source.filePath)
     -> RAGDocumentModule duplicate lookup
     -> RagSearchModule.initializeRagModule()
     -> RagSearchModule.uploadDocument({ filePath: source.filePath, ...metadata })
  -> compact tool result
  -> AIChatQueryLoop sends tool_result to model
```

## 4. Public AI Tool Contract

### 4.1 Tool Definition

Register the tool near the existing knowledge library tools:

```ts
{
  name: "knowledge_library_import_website",
  description:
    "Import public webpage content into the local knowledge library by URL. Supports one page, an explicit list of pages, or a bounded same-origin crawl. Converts pages to markdown and indexes them through the existing RAG pipeline. Requires user confirmation. Do not use for private, authenticated, localhost, internal network, or non-http URLs.",
  parameters: { ... },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "automation",
  timeoutClass: "network",
  source: "built-in",
  execute: async (args, context) => {
    const result = await importKnowledgeLibraryWebsiteForAi(
      args as Record<string, unknown>,
      context
    );
    return {
      success: result.success,
      result: result as unknown as Record<string, unknown>,
    };
  },
}
```

Use `permissionCategory: "automation"` instead of `network` because the tool can drive Puppeteer and create multiple local RAG documents.

### 4.2 Zod Input Schema

Add to `src/entityTypes/knowledgeLibraryAiToolTypes.ts`:

```ts
export const importKnowledgeWebsiteInputSchema = z
  .object({
    mode: z
      .enum(["single_page", "url_list", "site_crawl"])
      .default("single_page"),
    url: z.string().trim().url().max(2048).optional(),
    urls: z.array(z.string().trim().url().max(2048)).min(1).max(50).optional(),
    maxPages: z.number().int().min(1).max(100).default(20),
    maxDepth: z.number().int().min(0).max(4).default(2),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(tagSchema).max(20).optional(),
    author: z.string().trim().min(1).max(200).optional(),
    duplicatePolicy: z.enum(["fail", "allow", "replace"]).default("fail"),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "url_list") {
      if (!value.urls || value.urls.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["urls"],
          message: "urls is required for url_list mode",
        });
      }
      return;
    }

    if (!value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "url is required for single_page and site_crawl modes",
      });
    }
  });
```

### 4.3 TypeScript Types

Add parsed input:

```ts
export type ImportKnowledgeWebsiteParsed = z.infer<
  typeof importKnowledgeWebsiteInputSchema
>;
```

Add mode:

```ts
export type KnowledgeWebsiteImportMode =
  | "single_page"
  | "url_list"
  | "site_crawl";
```

Add page result summaries:

```ts
export interface ImportedWebsiteDocumentSummary
  extends KnowledgeLibraryDocumentSummary {
  readonly sourceUrl: string;
  readonly finalUrl?: string;
  readonly chunksCreated: number;
  readonly processingTimeMs: number;
}

export interface SkippedWebsiteImportSummary {
  readonly url: string;
  readonly reason: string;
  readonly code:
    | "DUPLICATE_DOCUMENT"
    | "URL_BLOCKED"
    | "SCRAPE_FAILED"
    | "EMPTY_CONTENT"
    | "UNSUPPORTED_FILE_TYPE"
    | "FILE_TOO_LARGE";
  readonly existingDocuments?: readonly KnowledgeLibraryDocumentSummary[];
}

export interface ImportKnowledgeWebsiteResult {
  readonly success: true;
  readonly mode: KnowledgeWebsiteImportMode;
  readonly imported: readonly ImportedWebsiteDocumentSummary[];
  readonly skipped: readonly SkippedWebsiteImportSummary[];
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly requestedCount: number;
  readonly discoveredCount?: number;
  readonly summary: string;
}
```

Extend `KnowledgeLibraryToolErrorCode`:

```ts
| "URL_BLOCKED"
| "SCRAPE_FAILED"
| "EMPTY_CONTENT"
```

Add outcome union:

```ts
export type KnowledgeLibraryWebsiteImportOutcome =
  | ImportKnowledgeWebsiteResult
  | KnowledgeLibraryToolError;
```

## 5. Website Import Service

### 5.1 Service Responsibility

Add `src/service/WebsiteKnowledgeImportService.ts`.

The service owns URL ingestion before RAG upload. It should not know about embeddings, vector storage, or TypeORM.

Responsibilities:

1. Validate and normalize input URLs.
2. Coordinate import modes.
3. Call the existing website scraper worker.
4. Extract crawl links from scraper response.
5. Stage one markdown file per page in app-owned storage.
6. Return safe import-source objects to `KnowledgeLibraryAiTools`.

Non-responsibilities:

1. Creating RAG document rows.
2. Updating document status.
3. Writing chunks.
4. Writing vectors.
5. Querying TypeORM repositories.
6. Returning raw markdown to the LLM.

### 5.2 Interfaces

```ts
export interface WebsiteImportPrepareOptions {
  readonly mode: "single_page" | "url_list" | "site_crawl";
  readonly url?: string;
  readonly urls?: readonly string[];
  readonly maxPages: number;
  readonly maxDepth: number;
}

export interface WebsiteImportSource {
  readonly sourceUrl: string;
  readonly finalUrl?: string;
  readonly canonicalUrl?: string;
  readonly title?: string;
  readonly fileName: string;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly contentSha256: string;
}

export interface WebsiteImportSkippedSource {
  readonly url: string;
  readonly reason: string;
  readonly code: "URL_BLOCKED" | "SCRAPE_FAILED" | "EMPTY_CONTENT";
}

export interface WebsiteImportPrepareResult {
  readonly mode: "single_page" | "url_list" | "site_crawl";
  readonly sources: readonly WebsiteImportSource[];
  readonly skipped: readonly WebsiteImportSkippedSource[];
  readonly requestedCount: number;
  readonly discoveredCount?: number;
}
```

### 5.3 Staging Directory

Use app-owned temporary staging:

```text
app.getPath("userData")/website-imports/<importRunId>/<pageFile>.md
```

The generated markdown file is temporary input to `RAGDocumentModule.uploadDocument()`. That module copies it into durable `rag_uploads`, so cleanup of `website-imports` can be best-effort.

Recommended cleanup:

1. Create a run directory for each tool invocation.
2. Keep staged website import files for 24 hours for debugging.
3. Delete expired staging files opportunistically when the service starts a new import.
4. Never delete files from outside `website-imports`.

### 5.4 Markdown Document Format

Write app-generated source metadata at the top:

```markdown
# [page title]

Source URL: https://example.com/pricing
Final URL: https://example.com/pricing/
Imported At: 2026-07-24T10:00:00.000Z

[converted markdown body]
```

This metadata becomes searchable text. That is acceptable because source URL and import time are useful for retrieval and user-facing citations.

Do not include:

- local file paths,
- cookies,
- request headers,
- full raw HTML,
- vector index paths,
- tool call IDs,
- conversation IDs.

### 5.5 File Naming

Use deterministic readable names plus a short URL hash:

```text
{hostname}-{path-slug}-{hash8}.md
```

Rules:

1. host from final URL if available, otherwise source URL,
2. path slug from pathname,
3. `index` for empty path,
4. sanitize to `[a-zA-Z0-9._-]`,
5. cap base name length to avoid filesystem limits,
6. append first 8 to 12 chars of SHA-256 URL hash.

Example:

```text
example.com-index-a1b2c3d4.md
example.com-pricing-e5f6a7b8.md
docs.example.com-guide-install-09ac31fe.md
```

## 6. Scraper Worker Changes

### 6.1 Extend Response Shape

Current `websiteContentScraper.ts` returns markdown only. For import and crawl, extend the response while preserving backwards compatibility.

Current response:

```ts
interface ScrapeWebsiteResponse {
  type: "SCRAPE_SUCCESS" | "SCRAPE_ERROR";
  requestId: string;
  markdown?: string;
  error?: string;
}
```

Target response:

```ts
interface ScrapeWebsiteResponse {
  type: "SCRAPE_SUCCESS" | "SCRAPE_ERROR";
  requestId: string;
  markdown?: string;
  title?: string;
  finalUrl?: string;
  canonicalUrl?: string;
  links?: string[];
  error?: string;
}
```

Existing callers can continue using `message.markdown` and ignore the new fields.

### 6.2 Extract Metadata

After navigation and final URL validation:

```ts
const title = (await page.title()).trim() || undefined;
const finalUrl = page.url();
const canonicalUrl = await page.$eval(
  'link[rel="canonical"]',
  (el) => (el as HTMLLinkElement).href
).catch(() => undefined);
```

Canonical URL must still pass `UrlGuard.validate()` and same-origin checks before use as duplicate metadata.

### 6.3 Extract Links

For crawl mode, return rendered anchor URLs:

```ts
const links = await page.$$eval("a[href]", (anchors) =>
  anchors
    .map((anchor) => (anchor as HTMLAnchorElement).href)
    .filter((href) => typeof href === "string" && href.length > 0)
);
```

The worker may return raw rendered links. The main service should normalize, same-origin filter, and guard-check them before queueing.

### 6.4 Main Content Extraction

Improve markdown quality by selecting a likely content root before conversion:

```ts
const htmlContent = await page.evaluate(() => {
  const selectors = [
    "article",
    "main",
    '[role="main"]',
    ".markdown-body",
    ".docs-content",
    ".doc-content",
    ".content",
    ".post",
    ".entry-content",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent && element.textContent.trim().length > 200) {
      return element.outerHTML;
    }
  }

  return document.body?.outerHTML || document.documentElement.outerHTML;
});
```

This should live in the worker or `HtmlConversionService`, not in the AI tool wrapper.

### 6.5 Avoid Truncated Reader

Do not call `WebsiteAnalysisService.getPageContentAsMarkdown()` directly for import because it intentionally truncates content for chat context. Instead:

1. Extract shared worker-fork logic into a reusable public method such as `WebsiteAnalysisService.scrapePageForImport()`, or
2. Create a dedicated `WebsiteContentScrapeService` that both website analysis and website import can use.

Recommended:

```text
src/service/WebsiteContentScrapeService.ts
```

Then:

```text
WebsiteAnalysisService.getPageContentAsMarkdown()
  -> WebsiteContentScrapeService.scrapePage()
  -> truncates for chat context

WebsiteKnowledgeImportService
  -> WebsiteContentScrapeService.scrapePage()
  -> stages full bounded markdown
```

This removes duplicated utilityProcess fork code.

## 7. Crawl Design

### 7.1 URL Normalization

Normalize URLs before dedupe:

1. trim whitespace,
2. parse with `new URL()`,
3. remove `hash`,
4. preserve query string for MVP,
5. normalize trailing slash with `URL.toString()`,
6. reject credentials,
7. validate with `UrlGuard`.

Do not lowercase path or query because some servers treat them as case-sensitive. Host casing is normalized by `URL`.

### 7.2 Single Page Mode

Algorithm:

```text
validate seed URL with UrlGuard.validateWithDns()
scrape seed URL
reject empty/oversized content
stage markdown
return one WebsiteImportSource
```

### 7.3 URL List Mode

Algorithm:

```text
input urls
  -> normalize and dedupe in stable order
  -> take first maxPages
  -> for each URL:
       validate
       scrape
       stage
       collect source or skipped result
  -> return partial result
```

Do not fail the entire URL list because one page fails.

### 7.4 Site Crawl Mode

Use breadth-first traversal.

Algorithm:

```text
seed = validateAndNormalize(input.url)
origin = new URL(seed).origin
queue = [{ url: seed, depth: 0 }]
seen = Set(seed)

while queue not empty and processedPages < maxPages:
  item = queue.shift()
  scrape item.url
  stage/import candidate or skipped result

  if item.depth >= maxDepth:
    continue

  for link in scraped.links:
    normalized = normalize(link)
    if normalized origin != origin:
      continue
    if seen has normalized:
      continue
    if UrlGuard rejects normalized:
      continue
    seen.add(normalized)
    queue.push({ url: normalized, depth: item.depth + 1 })
```

### 7.5 Crawl Limits

Defaults:

```text
maxPages: 20
maxDepth: 2
concurrency: 1
navigationTimeoutMs: 30000
totalToolTimeout: network timeout class
```

Hard caps:

```text
maxPages: 100
maxDepth: 4
urlListSize: 50
maxMarkdownBytesPerPage: 10 MB
```

Use concurrency 1 for MVP. Concurrency can increase later, but a single browser process per page is already expensive and embedding also consumes quota.

### 7.6 Same-Origin Rule

MVP must follow exact origin only:

```ts
new URL(candidate).origin === new URL(seed).origin
```

Examples:

```text
https://example.com/docs       -> may follow https://example.com/pricing
https://example.com/docs       -> must not follow https://blog.example.com
https://example.com/docs       -> must not follow http://example.com
```

Subdomain crawling should be a later explicit option.

## 8. RAG Document Metadata Design

### 8.1 Phase 1 Metadata Without Schema Change

If the first implementation avoids schema changes, map website metadata into existing fields:

```ts
{
  name: generatedFileName,
  title: pageTitle,
  description:
    "Imported webpage\n" +
    `Source URL: ${sourceUrl}\n` +
    `Final URL: ${finalUrl}\n` +
    `Import group: ${importGroupId}`,
  tags: ["website", hostTag, ...userTags],
  author: input.author ?? "Website"
}
```

This is shippable but limited. Duplicate detection and UI grouping will be weaker.

### 8.2 Recommended First-Class Metadata

Add nullable columns to `RAGDocumentEntity`:

```ts
@Column("varchar", { length: 40, nullable: true })
sourceType?: string; // "file" | "attachment" | "webpage"

@Column("varchar", { length: 2048, nullable: true })
sourceUrl?: string;

@Column("varchar", { length: 2048, nullable: true })
canonicalUrl?: string;

@Column("varchar", { length: 2048, nullable: true })
sourceRootUrl?: string;

@Column("varchar", { length: 120, nullable: true })
importGroupId?: string;

@Column("varchar", { length: 64, nullable: true })
contentSha256?: string;

@Column("datetime", { nullable: true })
crawledAt?: Date;
```

Add indexes:

```ts
@Index(["sourceType"])
@Index(["importGroupId"])
@Index(["contentSha256"])
```

Consider source URL indexes only after checking SQLite index length and query patterns. For duplicate lookups, a normalized URL hash column may be better than indexing a 2048-character URL.

### 8.3 Better URL Hash Columns

Recommended durable duplicate fields:

```ts
@Column("varchar", { length: 64, nullable: true })
sourceUrlSha256?: string;

@Column("varchar", { length: 64, nullable: true })
canonicalUrlSha256?: string;
```

These make duplicate lookups cheap and avoid large URL indexes.

### 8.4 Upload Options Extension

Extend `DocumentUploadOptions`:

```ts
export interface DocumentUploadOptions {
  filePath: string;
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  author?: string;
  sourceType?: "file" | "attachment" | "webpage";
  sourceUrl?: string;
  canonicalUrl?: string;
  sourceRootUrl?: string;
  importGroupId?: string;
  contentSha256?: string;
  crawledAt?: Date;
}
```

Thread these fields through:

```text
RagSearchModule.uploadDocument()
  -> DocumentService.uploadDocument()
  -> RAGDocumentModule.uploadDocument()
  -> RAGDocumentEntity
```

Existing callers can omit all fields.

### 8.5 Model Methods

Add to `RAGDocumentModel`:

```ts
async findActiveBySourceUrlSha256(
  sourceUrlSha256: string
): Promise<RAGDocumentEntity | undefined>

async findActiveByCanonicalUrlSha256(
  canonicalUrlSha256: string
): Promise<RAGDocumentEntity | undefined>

async findActiveByContentSha256(
  contentSha256: string
): Promise<RAGDocumentEntity[]>

async getDocumentsByImportGroup(
  importGroupId: string
): Promise<RAGDocumentEntity[]>
```

Add corresponding module methods to `RAGDocumentModule`; AI tool code should call the module, not the model.

## 9. Duplicate Detection

### 9.1 MVP Duplicate Policy

For each page, duplicate detection order:

```text
if canonicalUrlSha256 exists:
  check active document by canonicalUrlSha256

if not duplicate:
  check active document by sourceUrlSha256

if not duplicate:
  check active document by contentSha256

if no metadata columns:
  fallback to checkDuplicate(fileName, fileSize)
```

### 9.2 Per-Mode Behavior

`single_page`:

- `duplicatePolicy: "fail"` returns `DUPLICATE_DOCUMENT`.
- `duplicatePolicy: "allow"` imports a new snapshot.
- `duplicatePolicy: "replace"` returns `INVALID_INPUT`.

`url_list` and `site_crawl`:

- `duplicatePolicy: "fail"` skips duplicate pages and reports them in `skipped`.
- `duplicatePolicy: "allow"` imports snapshots.
- `duplicatePolicy: "replace"` returns `INVALID_INPUT` before scraping.

### 9.3 Replace Is Deferred

Do not implement replace until there is a transaction-aware replacement flow:

```text
old document active
  -> create new document pending
  -> chunk/embed new document
  -> mark old document archived/deleted
  -> activate new document
```

If embedding fails, the old document must remain active.

## 10. KnowledgeLibraryAiTools Changes

### 10.1 Dependencies

Extend `KnowledgeLibraryAiToolsDeps`:

```ts
export interface KnowledgeLibraryAiToolsDeps {
  readonly documentService?: DocumentService;
  readonly ragDocumentModule?: RAGDocumentModule;
  readonly ragSearchModule?: RagSearchModule;
  readonly websiteImportService?: WebsiteKnowledgeImportService;
  readonly isAiEnabled?: () => boolean;
}
```

Add helper:

```ts
private getWebsiteImportService(): WebsiteKnowledgeImportService {
  return this.deps.websiteImportService ?? new WebsiteKnowledgeImportService();
}
```

### 10.2 importWebsite Method

Add:

```ts
async importWebsite(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<KnowledgeLibraryWebsiteImportOutcome>
```

High-level implementation:

```text
parse importKnowledgeWebsiteInputSchema
if AI disabled:
  return AI_DISABLED
if duplicatePolicy is replace:
  return INVALID_INPUT

prepare = WebsiteKnowledgeImportService.prepareImportSources(...)
if prepare.sources empty:
  return SCRAPE_FAILED or URL_BLOCKED based on skipped errors

initialize RagSearchModule once
for each source:
  validate staged markdown file
  run duplicate check
  if duplicate:
    add skipped duplicate
    continue
  upload document through RagSearchModule.uploadDocument()
  add imported summary

if imported empty:
  return IMPORT_FAILED or DUPLICATE_DOCUMENT based on skipped errors

return success summary with imported and skipped arrays
```

### 10.3 Partial Success Handling

For multi-page imports, treat page failures as skipped items:

```ts
const imported: ImportedWebsiteDocumentSummary[] = [];
const skipped: SkippedWebsiteImportSummary[] = [];
```

Return `success: true` when `imported.length > 0`.

Return `success: false` only when no pages are imported.

### 10.4 Tool Output Safety

Map documents with existing `toDocumentSummary()` style.

Never include:

- `filePath`,
- `vectorIndexPath`,
- markdown content,
- HTML content,
- local staging path,
- raw error stack traces.

### 10.5 Free Function Wrapper

Add:

```ts
export async function importKnowledgeLibraryWebsiteForAi(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<KnowledgeLibraryWebsiteImportOutcome> {
  return getDefaultTools().importWebsite(args, context);
}
```

## 11. Skill Registry and Tool Loading

### 11.1 SkillRegistry

Import the wrapper:

```ts
import {
  listKnowledgeLibraryDocumentsForAi,
  importKnowledgeLibraryAttachmentForAi,
  importKnowledgeLibraryWebsiteForAi,
  deleteKnowledgeLibraryDocumentForAi,
} from "@/service/KnowledgeLibraryAiTools";
```

Register `knowledge_library_import_website` adjacent to `knowledge_library_import_attachment`.

### 11.2 ToolLoadPolicyService

Add to contextual knowledge library tools:

```ts
const CONTEXTUAL_KNOWLEDGE_LIBRARY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "knowledge_library_list_documents",
  "knowledge_library_import_attachment",
  "knowledge_library_import_website",
  "knowledge_library_delete_document",
]);
```

The existing `KNOWLEDGE_LIBRARY_INTENT_RE` should already catch knowledge-library wording. Consider extending it to catch website import phrasing:

```text
import .* (webpage|website|url|docs|documentation) .* knowledge
save .* (webpage|website|url) .* knowledge
remember .* (webpage|website|url)
```

### 11.3 Approval Policy

No custom approval policy should be needed. The normal `requiresConfirmation: true` and `permissionCategory: "automation"` path should prompt.

Tests should verify it does not auto-run when the user's approval mode requires confirmation.

## 12. Website Import Service Implementation Details

### 12.1 Public Method

```ts
export class WebsiteKnowledgeImportService {
  async prepareImportSources(
    options: WebsiteImportPrepareOptions
  ): Promise<WebsiteImportPrepareResult> {
    if (options.mode === "url_list") {
      return await this.prepareUrlList(options);
    }
    if (options.mode === "site_crawl") {
      return await this.prepareSiteCrawl(options);
    }
    return await this.prepareSinglePage(options);
  }
}
```

### 12.2 URL Validation

Use `UrlGuard.validateWithDns()` for user-provided URLs.

Use `UrlGuard.validate()` for initial filtering of discovered links, then `validateWithDns()` before scraping. This avoids DNS lookups on every link discovered from a large page until a URL is actually visited.

### 12.3 Scrape Response

The scrape service should return:

```ts
export interface WebsitePageScrapeResult {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly canonicalUrl?: string;
  readonly title?: string;
  readonly markdown: string;
  readonly links: readonly string[];
}
```

### 12.4 Empty Content Detection

Implement:

```ts
function isUsefulMarkdown(markdown: string): boolean {
  const normalized = markdown.replace(/\s+/g, " ").trim();
  return normalized.length >= 200;
}
```

Keep the threshold configurable as a constant.

### 12.5 Content Hash

Compute hash after adding source metadata or before?

Recommended:

1. `bodySha256`: hash only the converted webpage markdown body.
2. `contentSha256`: hash the full staged markdown including source metadata.

For duplicate detection, use `bodySha256` if a column is added. If only one field is added, use `contentSha256` over the body, not over import timestamp metadata, otherwise every import has a different hash.

Recommended entity field name:

```ts
bodySha256?: string;
```

If the PRD's `contentSha256` name is used, define it as the hash of normalized markdown body, not the staged file including `Imported At`.

### 12.6 Import Group ID

Generate one group ID per tool invocation:

```ts
const importGroupId = `web-${Date.now()}-${crypto.randomUUID()}`;
```

Every page imported from the same tool call receives the same `importGroupId`.

For `single_page`, this is still useful for audit and future refresh.

## 13. Data Model Migration Strategy

### 13.1 Minimal Phase

The fastest safe implementation can ship without schema changes:

- source URLs in `description`,
- website/user tags in `tags`,
- generated filename includes URL hash,
- duplicate fallback uses filename + file size.

This phase is lower risk but provides weaker duplicate and grouping behavior.

### 13.2 Recommended Phase

Add nullable metadata columns in the same feature branch as `site_crawl`. Because the fields are nullable, existing documents remain valid.

Update:

```text
RAGDocumentEntity
RAGDocumentModel.updateDocument()
RAGDocumentModel.updateDocumentMetadata() if metadata can change later
RAGDocumentModule.uploadDocument()
DocumentService.uploadDocument()
KnowledgeLibraryAiTools.toDocumentSummary() only if safe source metadata should be exposed
```

Run schema initialization/migration using the repository's standard database flow.

### 13.3 Backward Compatibility

Existing documents:

- have `sourceType` null,
- continue appearing in list/search,
- continue uploading/deleting normally,
- are not treated as website duplicates.

Existing upload callers:

- omit new metadata fields,
- compile unchanged if fields are optional.

## 14. Error Mapping

### 14.1 Service Errors to Tool Errors

| Condition | Tool code | Behavior |
| --- | --- | --- |
| zod parse failure | `INVALID_INPUT` | Return immediately |
| AI disabled | `AI_DISABLED` | Return before scraping |
| `replace` duplicate policy | `INVALID_INPUT` | Return before scraping |
| URL guard rejects all URLs | `URL_BLOCKED` | Return failure |
| URL guard rejects one URL in multi-page mode | `URL_BLOCKED` skipped item | Continue |
| Worker timeout | `SCRAPE_FAILED` | Single-page failure or skipped item |
| Empty markdown | `EMPTY_CONTENT` | Single-page failure or skipped item |
| RAG validate too large | `FILE_TOO_LARGE` | Single-page failure or skipped item |
| RAG validate unsupported | `UNSUPPORTED_FILE_TYPE` | Should be rare for `.md`; map anyway |
| duplicate found | `DUPLICATE_DOCUMENT` | Single-page failure or skipped item |
| upload throws | `IMPORT_FAILED` | Single-page failure or skipped item |

### 14.2 Aggregate Failure Selection

When no pages import:

1. If every skipped item is duplicate, return `DUPLICATE_DOCUMENT`.
2. If every skipped item is URL-blocked, return `URL_BLOCKED`.
3. If every skipped item is empty, return `EMPTY_CONTENT`.
4. Otherwise return `IMPORT_FAILED` with a compact summary.

## 15. Security Design

### 15.1 Defense in Depth

Use two URL validation layers:

```text
WebsiteKnowledgeImportService
  -> validate user URLs before worker spawn

websiteContentScraper
  -> validate again before page.goto()
  -> validate every browser request through PuppeteerSsrfGuard
  -> validate final URL after redirects
```

### 15.2 URL Schemes

Allowed:

```text
http:
https:
```

Blocked:

```text
file:
data:
javascript:
chrome:
devtools:
ftp:
mailto:
tel:
```

### 15.3 Host and IP Controls

Rely on `UrlGuard` for:

- localhost,
- `metadata`,
- `metadata.google.internal`,
- private IPv4,
- private IPv6,
- loopback,
- link-local,
- carrier NAT,
- unspecified addresses,
- IPv4-mapped IPv6 private ranges,
- DNS resolution to blocked addresses.

### 15.4 Web Content Trust Boundary

Webpage content is untrusted. It can be stored as knowledge, but it must not be executed as instruction text.

Rules:

1. The import tool does not follow commands found in pages.
2. The import tool does not call other AI tools based on page content.
3. The import result does not send full page content back to the model.
4. `knowledge_library_search` consumers must continue treating retrieved snippets as source data, not tool policy.

### 15.5 No Secret Leakage

Logs and tool results must not include:

- cookies,
- headers,
- local paths,
- full HTML,
- full markdown,
- stack traces containing paths,
- vector index paths.

## 16. Performance and Resource Design

### 16.1 Sequential MVP

Run imports sequentially in MVP:

```text
scrape page
stage page
validate page
upload/chunk/embed page
next page
```

This avoids concurrent browser and embedding pressure.

### 16.2 Future Concurrent Crawl

If concurrency is added later:

1. separate scrape concurrency from embedding concurrency,
2. keep per-origin rate limits,
3. cap active browser pages,
4. preserve deterministic result ordering,
5. avoid overlapping writes to the same import group.

### 16.3 Tool Timeout

Use `timeoutClass: "network"` initially. If large crawls exceed this class, add a background job design rather than increasing synchronous tool timeout indefinitely.

Future background job shape:

```text
knowledge_library_start_website_import
  -> returns importJobId

knowledge_library_get_website_import_status
  -> returns progress/imported/skipped/errors
```

MVP can remain synchronous with conservative page caps.

### 16.4 Embedding Cost

Every imported page creates chunks and embeddings. The confirmation prompt and result summary should make the page count visible.

The tool should enforce `maxPages` before scraping to avoid accidental high-cost imports.

## 17. Implementation Plan

### 17.1 Phase 1: Single Page Import

Files:

```text
src/entityTypes/knowledgeLibraryAiToolTypes.ts
src/service/WebsiteContentScrapeService.ts
src/service/WebsiteKnowledgeImportService.ts
src/service/KnowledgeLibraryAiTools.ts
src/config/skillsRegistry.ts
src/service/ToolLoadPolicyService.ts
test/vitest/main/knowledgeLibraryAiTools.test.ts
test/vitest/main/knowledgeLibraryAiToolPermissions.test.ts
```

Steps:

1. Add schema, types, result unions, and error codes.
2. Extract reusable worker-fork logic from `WebsiteAnalysisService`.
3. Add `WebsiteKnowledgeImportService.prepareSinglePage()`.
4. Add `KnowledgeLibraryAiTools.importWebsite()`.
5. Register `knowledge_library_import_website`.
6. Add contextual tool loading.
7. Add unit tests.
8. Run focused Vitest tests.
9. Commit.

### 17.2 Phase 2: URL List

Files:

```text
src/service/WebsiteKnowledgeImportService.ts
src/service/KnowledgeLibraryAiTools.ts
test/vitest/main/websiteKnowledgeImportService.test.ts
test/vitest/main/knowledgeLibraryAiTools.test.ts
```

Steps:

1. Add stable URL normalization and dedupe.
2. Add per-page skipped result collection.
3. Add partial success aggregation.
4. Add tests for mixed success/failure.
5. Commit.

### 17.3 Phase 3: Site Crawl

Files:

```text
src/childprocess/websiteContentScraper.ts
src/service/WebsiteContentScrapeService.ts
src/service/WebsiteKnowledgeImportService.ts
test/vitest/main/websiteKnowledgeImportService.test.ts
```

Steps:

1. Extend scraper worker response with title, final URL, canonical URL, and links.
2. Add same-origin breadth-first crawl.
3. Enforce maxPages and maxDepth.
4. Add blocked-link tests.
5. Add local fixture crawl tests.
6. Commit.

### 17.4 Phase 4: Website Metadata

Files:

```text
src/entity/RAGDocument.entity.ts
src/model/RAGDocument.model.ts
src/modules/RAGDocumentModule.ts
src/service/DocumentService.ts
src/modules/RagSearchModule.ts
test/modules/RAGDocumentWebsiteMetadata.test.ts
```

Steps:

1. Add nullable metadata columns.
2. Extend upload options.
3. Persist metadata during upload.
4. Add duplicate query methods.
5. Update duplicate checks.
6. Run database initialization/migration path.
7. Commit.

## 18. Test Plan

### 18.1 KnowledgeLibraryAiTools Tests

Add cases:

```text
importWebsite rejects missing URL for single_page
importWebsite rejects missing urls for url_list
importWebsite returns AI_DISABLED before scraping
importWebsite rejects duplicatePolicy replace
importWebsite imports staged markdown through RagSearchModule.uploadDocument
importWebsite does not expose filePath in result
importWebsite returns URL_BLOCKED for unsafe single_page URL
importWebsite returns partial success for url_list
importWebsite returns failure when every page is skipped
```

### 18.2 WebsiteKnowledgeImportService Tests

Mock scraper calls and filesystem staging.

Add cases:

```text
single_page stages one markdown file
url_list deduplicates stable URLs
url_list honors maxPages
site_crawl follows same-origin links
site_crawl skips cross-origin links
site_crawl honors maxDepth
empty markdown is skipped
oversized markdown is skipped
```

### 18.3 Registry and Permission Tests

Add cases:

```text
knowledge_library_import_website is registered
permissionCategory is automation
requiresConfirmation is true
source is built-in
tool appears in getAllToolFunctions()
tool appears in contextual knowledge library loading
```

### 18.4 Security Tests

Add URL safety cases:

```text
file:///etc/passwd
http://localhost
http://127.0.0.1
http://169.254.169.254
http://metadata.google.internal
https://user:pass@example.com
same-origin page with link to http://127.0.0.1
public URL redirecting to private IP
```

### 18.5 Manual UAT

1. Start app with `yarn dev`.
2. Open AI Chat.
3. Ask: `Import https://example.com into my knowledge library and tag it website-test.`
4. Confirm the tool prompt.
5. Verify the result reports one imported document.
6. Ask a question answerable from the imported page.
7. Confirm `knowledge_library_search` returns the imported page as source.
8. Try a blocked URL such as `http://localhost:5173` and confirm it is rejected.
9. Try URL list mode with one valid URL and one invalid/blocked URL; confirm partial success.
10. Try crawl mode with a local public fixture or controlled test site; confirm page cap and same-origin behavior.

## 19. Rollout and Compatibility

### 19.1 Feature Flag

If the release needs staged rollout, add a local setting such as:

```text
KNOWLEDGE_WEBSITE_IMPORT_ENABLED
```

Default can be enabled for development and disabled for production until Phase 1 verification is complete.

### 19.2 Backward Compatibility

Existing tools remain unchanged:

- `knowledge_library_import_attachment` keeps accepting only `attachment_ref`.
- `knowledge_library_search` search behavior is unchanged.
- existing document uploads do not need website metadata.
- existing website analysis continues reading markdown from the scraper.

### 19.3 Failure Recovery

If a multi-page import fails halfway:

1. successfully imported documents remain active,
2. failed pages are reported in `skipped`,
3. no automatic rollback occurs in MVP,
4. user can delete imported documents through existing delete tool if needed.

If `RagSearchModule.uploadDocument()` creates a document then embedding fails, existing upload error handling marks the document failed and records an error log. Website import should surface a compact `IMPORT_FAILED` skipped item.

## 20. Open Technical Decisions

1. Should metadata columns ship in Phase 1, or should Phase 1 use description/tags only?
2. Should `contentSha256` mean staged markdown hash or normalized webpage body hash?
3. Should import crawl use one persistent browser worker for all pages, or fork per page through the existing service pattern?
4. Should `WebsiteAnalysisService` own the shared scrape facade, or should a new `WebsiteContentScrapeService` own it?
5. Should URL list hard max be 50 or 100?
6. Should site crawl support `includePaths` and `excludePaths` in the first implementation?
7. Should the result include `importGroupId`, or hide it until UI grouping exists?
8. Should the confirmation prompt estimate embedding cost by discovered page count, or only show configured caps before discovery?

## 21. Acceptance Checklist

- [ ] Tool schema added with `single_page`, `url_list`, and `site_crawl`.
- [ ] AI gate is checked before scraping.
- [ ] Tool requires confirmation.
- [ ] Tool is registered as built-in with `permissionCategory: "automation"`.
- [ ] Tool is included in contextual knowledge-library tool loading.
- [ ] Existing scraper and `HtmlConversionService` are reused.
- [ ] URL guard runs before worker spawn and inside worker.
- [ ] One staged markdown file is created per webpage.
- [ ] `RagSearchModule.uploadDocument()` is the only RAG ingestion path.
- [ ] One RAG document is created per webpage.
- [ ] Multi-page imports return imported and skipped page summaries.
- [ ] Tool result excludes local paths and full content.
- [ ] Child process does not access the database.
- [ ] Unit tests cover schema, AI gate, duplicate policy, result safety, and upload delegation.
- [ ] Security tests cover blocked URL classes.
- [ ] Manual UAT verifies imported pages are searchable through `knowledge_library_search`.
