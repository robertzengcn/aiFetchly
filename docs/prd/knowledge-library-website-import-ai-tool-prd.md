# Knowledge Library Website Import AI Tool - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-24
- **Owner**: Engineering Team
- **Related systems**: AiChatV2, AI tool calling, SkillRegistry, RAG, DocumentService, RAGDocumentModule, RagSearchModule, WebsiteAnalysisService, websiteContentScraper
- **Technical design**: `docs/prd/knowledge-library-website-import-ai-tool-technical-design.md`
- **Related PRDs**:
  - `docs/prd/knowledge-library-management-ai-tools-prd.md`
  - `docs/prd/knowledge-library-management-ai-tools-technical-design.md`
  - `docs/rag-tool-call-rerank-prd.md`
  - `docs/ai-chat-v2-attachment-upload-prd.md`
- **Related files**:
  - `src/service/KnowledgeLibraryAiTools.ts`
  - `src/entityTypes/knowledgeLibraryAiToolTypes.ts`
  - `src/config/skillsRegistry.ts`
  - `src/service/DocumentService.ts`
  - `src/modules/RAGDocumentModule.ts`
  - `src/modules/RagSearchModule.ts`
  - `src/model/RAGDocument.model.ts`
  - `src/entity/RAGDocument.entity.ts`
  - `src/service/WebsiteAnalysisService.ts`
  - `src/childprocess/websiteContentScraper.ts`
  - `src/service/HtmlConversionService.ts`
  - `src/service/UrlGuard.ts`
  - `src/service/PuppeteerSsrfGuard.ts`
  - `src/service/ToolLoadPolicyService.ts`
  - `src/service/SkillPermissionService.ts`

## 1. Summary

AiFetchly already lets the AI assistant import user-attached chat documents into the local knowledge library through `knowledge_library_import_attachment`. Many users also keep important business knowledge on public websites: product documentation, pricing pages, FAQ pages, support articles, policies, integration guides, landing pages, and competitor or partner information.

This feature adds an AI-callable tool that imports webpage or website content into the existing local RAG-backed knowledge library by URL. The user should be able to say:

```text
Import https://example.com/pricing into my knowledge library and tag it pricing.
```

or:

```text
Import the docs pages from https://example.com/docs into the knowledge library.
```

The implementation must reuse the existing website scraping and HTML-to-markdown conversion pipeline where possible, then feed the converted markdown into the existing RAG document upload, chunking, embedding, and vector indexing pipeline. It must not create a separate website knowledge store.

The recommended storage model is one RAG document per webpage. A whole website import should be represented as a group or collection of webpage documents, not as one large document.

## 2. Problem Statement

Users often expect the AI assistant to learn from websites directly. Today the assistant can read a URL for immediate chat context through existing website analysis/read-url flows, and it can search previously imported knowledge with `knowledge_library_search`, but it does not have a supported way to persist webpage content into the knowledge library.

This creates several gaps:

1. Users must manually copy webpage text into a file, upload it, and then import it.
2. The assistant can answer from a website in the moment but cannot make that website durable local knowledge.
3. Users cannot build a local knowledge base from product docs, FAQs, support pages, or policy pages by URL.
4. The existing `knowledge_library_import_attachment` tool only accepts an attachment reference, not a URL.
5. A naive URL import implementation could bypass SSRF protections, duplicate scraping code, write database records from the wrong layer, or produce poor RAG quality by embedding noisy page chrome.

The product needs a permissioned AI tool that converts web content into normal knowledge library documents while preserving AiFetchly's database architecture, worker isolation rules, AI feature gate, and existing RAG ingestion behavior.

## 3. Goals

1. Let AI Chat import a single webpage into the knowledge library by URL.
2. Let AI Chat import multiple explicit webpage URLs in one tool call.
3. Let AI Chat import a bounded same-origin website crawl from a start URL.
4. Reuse the existing `websiteContentScraper` child process for browser-based page loading.
5. Reuse `HtmlConversionService` for HTML-to-markdown conversion.
6. Reuse `UrlGuard` and `PuppeteerSsrfGuard` for URL and redirect safety.
7. Reuse `RagSearchModule.uploadDocument()` so webpage imports follow the same upload, chunking, embedding, status, and error handling path as file imports.
8. Store each webpage as an individual RAG document.
9. Represent a whole website import as a group of webpage documents with shared metadata.
10. Return concise structured tool results that list imported, skipped, duplicate, and failed pages.
11. Require user confirmation before importing webpages or websites.
12. Respect the AI feature gate before scraping or embedding work begins.
13. Keep all database access in Model/Module/Service layers, never directly in IPC handlers, AI tool wrappers, or child processes.
14. Add tests covering URL validation, tool schema validation, duplicate handling, partial success, permissions, and RAG upload delegation.

## 4. Non-Goals

1. Do not replace the existing document import tool.
2. Do not replace `knowledge_library_search`.
3. Do not build a separate website vector database.
4. Do not let a child process write to the database.
5. Do not allow unrestricted crawling of the public internet.
6. Do not support authenticated/private websites in the first release.
7. Do not support cross-origin crawling in the first release.
8. Do not import arbitrary local files through URL schemes such as `file://`.
9. Do not bypass the existing skill permission and tool approval systems.
10. Do not require custom UI for the MVP, beyond existing tool-call confirmation and result rendering.
11. Do not guarantee perfect article extraction for every website. Extraction quality can improve iteratively.
12. Do not implement scheduled re-crawling in the first release.

## 5. Target Users

### 5.1 Marketing Operator

Maintains campaigns and wants the assistant to remember product pages, landing pages, FAQs, and pricing pages.

Example:

```text
Import our pricing page into knowledge and tag it product, pricing.
```

### 5.2 Sales or Support User

Wants support docs, refund policy, shipping policy, and product documentation available when drafting replies.

Example:

```text
Import these support URLs into the knowledge library so future email replies can use them.
```

### 5.3 Knowledge Library Maintainer

Curates the library and wants website imports to be organized, deduplicated, searchable, and removable page by page.

Example:

```text
Import the website docs, but skip pages already in the library.
```

### 5.4 Power User

Uses AI Chat as a command surface and expects transparent tool calls, clear permission prompts, and structured import summaries.

Example:

```text
Crawl up to 25 pages from https://example.com/docs and import them as website docs.
```

## 6. User Stories

1. As a user, I can ask the assistant to import one URL into the knowledge library, so I do not need to manually save a webpage as a file.
2. As a user, I can provide multiple URLs and import them in one request, so I can quickly build a focused knowledge set.
3. As a user, I can ask for a bounded website crawl, so I can import docs or FAQ pages without listing every URL manually.
4. As a user, I can see which pages were imported and which were skipped, so I understand the result.
5. As a user, I can avoid duplicate imports by default, so the library stays clean.
6. As a user, I can allow duplicates when I intentionally want a second snapshot.
7. As a user, I can search imported webpages through `knowledge_library_search`, so website knowledge works like uploaded document knowledge.
8. As a user, I can delete individual imported pages later, so I am not forced to remove an entire website import.

## 7. Current Architecture Findings

### 7.1 Existing AI Knowledge Library Tools

`KnowledgeLibraryAiTools` currently provides AI-callable document management logic:

- `listDocuments()`
- `importAttachment()`
- `deleteDocument()`

`importAttachment()` validates tool args, checks AI enablement, resolves a conversation-scoped attachment reference, validates the file, performs duplicate checks, initializes the RAG module, and calls `RagSearchModule.uploadDocument()`.

The website import tool should follow this same orchestration style.

### 7.2 Existing RAG Upload Pipeline

`RagSearchModule.uploadDocument()` is the correct ingestion path. It:

1. Ensures a default embedding model exists.
2. Calls `DocumentService.uploadDocument()`.
3. Updates processing status.
4. Chunks the document.
5. Generates embeddings.
6. Stores vector metadata.
7. Marks processing complete or failed.

The website import tool should produce one app-owned markdown file per webpage and pass each markdown file into this pipeline.

### 7.3 Existing Document Staging Safety

`RAGDocumentModule.uploadDocument()` validates the file and copies it into the app-owned `rag_uploads` directory before persisting the document path. This makes it safe for a tool wrapper to pass a temporary app-owned markdown file, because the durable stored document path remains controlled by the application.

### 7.4 Existing Website Scraper

`src/childprocess/websiteContentScraper.ts` already:

- launches Puppeteer in a child process,
- validates the URL with `UrlGuard.validateWithDns()`,
- applies `PuppeteerSsrfGuard` to navigation and subresources,
- waits for page content,
- extracts page HTML,
- converts HTML to markdown with `HtmlConversionService`.

The new feature should reuse this worker instead of adding another browser automation path.

### 7.5 Existing URL Safety

`UrlGuard` blocks unsafe URL schemes, localhost, private IPs, link-local addresses, cloud metadata endpoints, and DNS results resolving to blocked ranges. `PuppeteerSsrfGuard` applies URL checks to requests inside browser navigation.

All webpage import modes must use this safety boundary before scraping, and the worker must continue to validate URLs itself.

## 8. Product Requirements

### 8.1 Tool Name

Add a new built-in AI tool:

```text
knowledge_library_import_website
```

The tool should be registered adjacent to:

- `knowledge_library_search`
- `knowledge_library_list_documents`
- `knowledge_library_import_attachment`
- `knowledge_library_delete_document`

### 8.2 Tool Description

The tool description should tell the model:

```text
Import public webpage content into the local knowledge library by URL. Supports one page, an explicit list of pages, or a bounded same-origin crawl. Converts pages to markdown and indexes them through the existing RAG pipeline. Requires user confirmation. Do not use for private, authenticated, localhost, internal network, or non-http URLs.
```

### 8.3 Import Modes

The tool must support three modes.

#### 8.3.1 Single Page

Imports exactly one URL.

Example:

```json
{
  "mode": "single_page",
  "url": "https://example.com/pricing",
  "tags": ["pricing", "product"]
}
```

#### 8.3.2 URL List

Imports an explicit list of URLs. Each URL becomes one RAG document.

Example:

```json
{
  "mode": "url_list",
  "urls": [
    "https://example.com/pricing",
    "https://example.com/faq",
    "https://example.com/refund-policy"
  ],
  "tags": ["website", "support"]
}
```

#### 8.3.3 Site Crawl

Starts from one URL, discovers same-origin links, and imports pages until the limits are reached.

Example:

```json
{
  "mode": "site_crawl",
  "url": "https://example.com/docs",
  "maxPages": 25,
  "maxDepth": 2,
  "tags": ["docs"]
}
```

The crawl must be same-origin only in the first release.

### 8.4 Recommended JSON Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": ["single_page", "url_list", "site_crawl"],
      "default": "single_page"
    },
    "url": {
      "type": "string",
      "description": "URL for single_page or site_crawl mode."
    },
    "urls": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Explicit URLs for url_list mode. Each URL becomes one document."
    },
    "maxPages": {
      "type": "number",
      "default": 20,
      "description": "Maximum pages to import for url_list or site_crawl mode. Hard max 100."
    },
    "maxDepth": {
      "type": "number",
      "default": 2,
      "description": "Maximum crawl depth for site_crawl mode. Hard max 4."
    },
    "title": {
      "type": "string",
      "description": "Optional title override. Best used for single_page mode."
    },
    "description": {
      "type": "string",
      "description": "Optional document description or collection description."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "author": {
      "type": "string",
      "description": "Optional author. Defaults to Website."
    },
    "duplicatePolicy": {
      "type": "string",
      "enum": ["fail", "allow", "replace"],
      "default": "fail",
      "description": "fail skips duplicate pages, allow imports anyway, replace is not supported in MVP."
    }
  },
  "required": []
}
```

Validation rules:

1. `single_page` requires `url`.
2. `site_crawl` requires `url`.
3. `url_list` requires `urls`.
4. `url` and every `urls[]` item must be HTTP or HTTPS after `UrlGuard` validation.
5. `urls` should accept up to 50 explicit URLs in MVP.
6. `maxPages` should default to 20 and have a hard maximum of 100.
7. `maxDepth` should default to 2 and have a hard maximum of 4.
8. `replace` should return `INVALID_INPUT` until replacement semantics are implemented.

### 8.5 Tool Permission

Recommended registry settings:

```ts
{
  name: "knowledge_library_import_website",
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "automation",
  timeoutClass: "network",
  source: "built-in"
}
```

Reasoning:

- It fetches remote URLs.
- It may run Puppeteer automation.
- It writes app-owned temporary markdown files.
- It mutates the local knowledge library through RAG upload.
- It can consume embedding quota.

The permission prompt should clearly show:

1. Mode.
2. URL or number of URLs.
3. Max pages and max depth for crawls.
4. Tags.
5. Duplicate policy.
6. That the pages will be saved into the local knowledge library.

### 8.6 AI Feature Gate

Because import triggers chunking and embedding, the tool must check AI enablement before scraping or uploading.

Required behavior:

1. At the start of the tool service method, read `USER_AI_ENABLED` through `Token`.
2. If disabled, return:

```json
{
  "success": false,
  "code": "AI_DISABLED",
  "error": "AI is not enabled. Importing websites requires an active AI subscription."
}
```

3. Do not validate, scrape, stage, upload, or embed if AI is disabled.

### 8.7 Result Shape

The tool should return compact metadata only. It must not return local file paths, vector index paths, full markdown, HTML, or chunk content.

Recommended success result:

```json
{
  "success": true,
  "mode": "site_crawl",
  "importedCount": 12,
  "skippedCount": 3,
  "requestedCount": 1,
  "discoveredCount": 28,
  "imported": [
    {
      "id": 42,
      "name": "example.com-docs-index.md",
      "title": "Example Docs",
      "sourceUrl": "https://example.com/docs",
      "finalUrl": "https://example.com/docs/",
      "tags": ["docs", "website"],
      "fileType": ".md",
      "fileSize": 18420,
      "status": "active",
      "processingStatus": "completed",
      "chunksCreated": 9,
      "processingTimeMs": 2400
    }
  ],
  "skipped": [
    {
      "url": "https://example.com/login",
      "code": "SCRAPE_FAILED",
      "reason": "No readable content was extracted from the page."
    }
  ],
  "summary": "Imported 12 webpage documents into the knowledge library. Skipped 3 pages."
}
```

Recommended error codes:

- `INVALID_INPUT`
- `AI_DISABLED`
- `URL_BLOCKED`
- `SCRAPE_FAILED`
- `EMPTY_CONTENT`
- `FILE_TOO_LARGE`
- `DUPLICATE_DOCUMENT`
- `IMPORT_FAILED`

For multi-page modes, individual page failures should usually be represented in `skipped` while the overall result remains `success: true` if at least one page imported. If no pages import, return `success: false` with the most useful aggregate error.

## 9. Storage Model

### 9.1 One Webpage Per Document

Each imported webpage should become one row in `rag_documents` and should be processed as a normal markdown document.

This is the recommended behavior for all modes:

```text
https://example.com/
  -> document #1

https://example.com/pricing
  -> document #2

https://example.com/docs/setup
  -> document #3
```

### 9.2 Why Not One Document Per Website

One giant document per website is not recommended because:

1. Citations become vague.
2. Updates are expensive.
3. Duplicate detection becomes unreliable.
4. Large sites can exceed file or embedding limits.
5. Users cannot delete or update a single page cleanly.
6. RAG chunks from unrelated pages become mixed under one document title.
7. Partial crawl failures become hard to represent.

### 9.3 Website Import Grouping

A whole website import should be represented as a collection or group of webpage documents.

Recommended metadata fields:

```ts
sourceType?: "file" | "attachment" | "webpage";
sourceUrl?: string;
canonicalUrl?: string;
sourceRootUrl?: string;
importGroupId?: string;
contentSha256?: string;
crawledAt?: Date;
```

For MVP, if schema changes are deferred, use:

- `author`: `Website`
- `tags`: include `website`, host tag, and user-provided tags
- `description`: include source URL, final URL, import mode, and import group ID

However, the durable design should add first-class metadata columns because URL and hash metadata will be needed for duplicate detection, refresh, filtering, and UI grouping.

### 9.4 Naming Convention

Recommended generated file/document names:

```text
{hostname}-{path-slug}-{url-hash}.md
```

Examples:

```text
example.com-index-a1b2c3d4.md
example.com-pricing-e5f6a7b8.md
docs.example.com-guide-install-09ac31fe.md
```

The tool should preserve page titles in `title`.

### 9.5 Markdown Front Matter

The staged markdown file should include lightweight source metadata at the top so future debugging and exports remain understandable even if database metadata changes.

Example:

```markdown
# Pricing

Source URL: https://example.com/pricing
Final URL: https://example.com/pricing/
Imported At: 2026-07-24T10:00:00.000Z

[converted markdown body]
```

Do not include cookies, request headers, local paths, vector paths, or raw hidden HTML.

## 10. Crawl Requirements

### 10.1 Single Page Mode

Required behavior:

1. Validate the URL with `UrlGuard.validateWithDns()`.
2. Scrape through the existing website scraper worker.
3. Convert HTML to markdown through `HtmlConversionService`.
4. Reject empty content.
5. Stage markdown as an app-owned temporary `.md` file.
6. Validate the file through `RAGDocumentModule.validateFile()`.
7. Check duplicates.
8. Upload through `RagSearchModule.uploadDocument()`.

### 10.2 URL List Mode

Required behavior:

1. Deduplicate the provided URLs after normalization.
2. Preserve stable input order.
3. Import each URL as one document.
4. Continue after individual page failures.
5. Return imported and skipped arrays.
6. Stop at `maxPages` even if more URLs are provided.

### 10.3 Site Crawl Mode

Required behavior:

1. Start from `url`.
2. Only follow same-origin links.
3. Remove URL fragments.
4. Skip `mailto:`, `tel:`, `javascript:`, `data:`, `file:`, and other non-http(s) URLs.
5. Validate every discovered URL before it is queued.
6. Enforce `maxPages`.
7. Enforce `maxDepth`.
8. Deduplicate by normalized URL.
9. Continue after individual page failures.
10. Return `discoveredCount`.

Recommended crawl strategy:

```text
1. Validate seed URL.
2. Scrape seed page.
3. Extract links from rendered DOM.
4. Normalize same-origin links.
5. Queue unseen links by breadth-first order.
6. Repeat until maxPages or maxDepth is reached.
```

### 10.4 Sitemap Support

Sitemap support is optional in MVP but recommended for phase 2.

If implemented:

1. Try `{origin}/sitemap.xml`.
2. Parse same-origin URLs only.
3. Prefer sitemap URLs before DOM-discovered links.
4. Still enforce `maxPages`, `maxDepth`, and URL safety.
5. Do not parse nested sitemap indexes beyond a bounded maximum.

### 10.5 Robots and Rate Limits

For MVP:

1. Use conservative defaults.
2. Limit concurrency to 1 or 2 per import job.
3. Add a small delay between page requests.
4. Do not crawl unbounded websites.

Future versions should consider `robots.txt` handling before larger crawls.

## 11. Content Extraction Requirements

### 11.1 Reuse Existing Conversion

The feature must reuse `HtmlConversionService.convertHtmlToMarkdown()` for HTML-to-markdown conversion.

The feature should not add a second independent HTML conversion strategy unless `HtmlConversionService` itself is improved.

### 11.2 Improve Main Content Extraction

The current conversion removes scripts, styles, comments, and unsafe attributes, but full-page conversion may still include navigation, footers, sidebars, cookie banners, and repeated menus.

Before sending HTML into markdown conversion, the scraper should attempt to select a likely content root:

1. `article`
2. `main`
3. `[role="main"]`
4. documentation-specific containers such as `.content`, `.docs-content`, `.markdown-body`, `.post`, `.entry-content`
5. fallback to `body`

This should be implemented as an enhancement to the existing website content scraper or `HtmlConversionService`, not as duplicate conversion logic inside the AI tool service.

### 11.3 Empty and Low-Value Content

The import should skip a page if:

1. Markdown is empty after trimming.
2. Markdown is below a minimal useful threshold after removing boilerplate.
3. The page is clearly a login, error, or access denied page.
4. The page content exceeds a configured maximum size.

Recommended MVP thresholds:

- minimum markdown length: 200 characters,
- maximum staged markdown bytes: 10 MB,
- RAG validation maximum remains controlled by `RAGDocumentModule`.

### 11.4 Page Title

The scraper should return the rendered page title when available. The import tool should use it as `document.title` unless the user provides an explicit title override and the import mode is `single_page`.

For multi-page imports, a single user-provided `title` should not overwrite every page title. It should be treated as collection-level context or prefix only if the UX explicitly says so.

## 12. Duplicate Handling

### 12.1 Default Policy

Default `duplicatePolicy` should be `fail`, interpreted per page:

- for single page: return `DUPLICATE_DOCUMENT` if duplicate,
- for multi-page modes: skip duplicate pages and include them in `skipped`.

### 12.2 Recommended Duplicate Keys

For website imports, duplicate detection should use:

1. normalized canonical URL, if available,
2. final URL after redirects,
3. content SHA-256 hash,
4. fallback to generated filename plus file size.

The current `RAGDocumentModule.checkDuplicate(name, fileSize)` is acceptable for file imports but insufficient for websites. Website duplicate detection should be added at the Model/Module layer, not in the AI tool wrapper.

### 12.3 Replace Policy

`replace` should remain unsupported in the MVP.

Reason: replacing a webpage document must coordinate:

1. old document status,
2. old chunks,
3. old vector index entries,
4. new upload success or failure,
5. rollback behavior if embedding fails.

Until that exists, return:

```json
{
  "success": false,
  "code": "INVALID_INPUT",
  "error": "duplicatePolicy \"replace\" is not supported yet. Use \"fail\" or \"allow\"."
}
```

## 13. Architecture Requirements

### 13.1 Required Layering

```text
AI tool definition
  -> KnowledgeLibraryAiTools.importWebsite()
  -> Website import service
  -> websiteContentScraper child process
  -> app-owned markdown staging
  -> RagSearchModule.uploadDocument()
  -> DocumentService
  -> RAGDocumentModule
  -> RAGDocumentModel
  -> database
```

### 13.2 AI Tool Layer

`KnowledgeLibraryAiTools.importWebsite()` should:

1. parse and validate raw model args with zod,
2. check AI enablement before network or RAG work,
3. reject unsupported duplicate policies,
4. call a service to scrape and stage website content,
5. call module methods for validation and duplicate checks,
6. call `RagSearchModule.uploadDocument()` for each page,
7. map results to compact tool output,
8. avoid direct database access.

### 13.3 Website Import Service

Add a dedicated service such as:

```text
src/service/WebsiteKnowledgeImportService.ts
```

Responsibilities:

1. validate and normalize URLs,
2. coordinate single page, URL list, and crawl modes,
3. call the existing scraper worker,
4. stage converted markdown in an app-owned temporary directory,
5. return import source metadata to `KnowledgeLibraryAiTools`,
6. never write RAG database rows directly.

### 13.4 Child Process

Worker-specific scraping code must stay in:

```text
src/childprocess/
```

The existing `websiteContentScraper.ts` should be extended if needed to return:

```ts
{
  markdown: string;
  title?: string;
  finalUrl: string;
  links?: string[];
}
```

Existing callers that only need markdown can ignore the additional fields.

The child process must not access the database.

### 13.5 RAG Module

`RagSearchModule.uploadDocument()` should remain the only path that turns a staged webpage markdown file into searchable RAG content.

Do not duplicate chunking, embedding, vector storage, or processing status logic in the website import feature.

### 13.6 Model Layer

If website metadata columns are added, `RAGDocument.model.ts` should provide query methods such as:

```ts
findBySourceUrl(sourceUrl: string): Promise<RAGDocumentEntity | undefined>
findByCanonicalUrl(canonicalUrl: string): Promise<RAGDocumentEntity | undefined>
findByContentSha256(contentSha256: string): Promise<RAGDocumentEntity[]>
getDocumentsByImportGroup(importGroupId: string): Promise<RAGDocumentEntity[]>
```

The AI tool service should not use TypeORM repositories directly.

## 14. Security Requirements

### 14.1 SSRF Protection

All input and discovered URLs must be protected against SSRF.

Required:

1. Only `http:` and `https:` schemes are allowed.
2. Block credentials in URLs.
3. Block localhost and internal hostnames.
4. Block loopback, private, link-local, carrier NAT, unspecified, and cloud metadata IPs.
5. Use DNS-aware validation before fetch.
6. Validate final URL after redirects.
7. Validate every browser request through `PuppeteerSsrfGuard`.
8. Validate discovered links before queueing.

### 14.2 Prompt Injection Boundary

Imported webpages are untrusted content. Their content must not alter tool permission policy, system prompts, or assistant behavior.

Required:

1. The import tool must not execute instructions found in webpages.
2. Webpage text is only stored as knowledge content.
3. Future retrieval through `knowledge_library_search` must continue to treat retrieved content as source context, not instructions.
4. Tool results should not include full webpage content in the model response.

### 14.3 Local File Safety

Required:

1. Do not accept local file paths.
2. Do not accept `file://` URLs.
3. Do not expose staged markdown file paths in tool output.
4. Persist imported content only through app-owned staging and `RAGDocumentModule.uploadDocument()`.
5. Physical deletion must remain guarded by existing RAG upload staging containment checks.

### 14.4 Resource Limits

Required limits:

1. URL length max: 2048 characters.
2. URL list max: 50 input URLs in MVP.
3. Crawl max pages default: 20.
4. Crawl max pages hard max: 100.
5. Crawl max depth default: 2.
6. Crawl max depth hard max: 4.
7. Per-page navigation timeout.
8. Total tool timeout.
9. Per-page markdown size limit.
10. Low concurrency for crawling.

## 15. UX Requirements

### 15.1 Chat Behavior

The assistant should choose this tool when the user asks to:

- import a webpage into knowledge,
- save a URL to the knowledge library,
- remember a website,
- crawl documentation into knowledge,
- add online FAQ or policy pages to local knowledge.

The assistant should ask a clarification question before calling the tool when:

1. The user says "import the website" but gives no URL.
2. The user asks for a whole website crawl with no limit.
3. The user provides multiple domains but asks for a crawl.
4. The user asks for authenticated/private website import.

### 15.2 Confirmation Prompt

The confirmation prompt should be explicit.

For a single page:

```text
Import webpage into knowledge library?

URL: https://example.com/pricing
Mode: single page
Tags: pricing, product
This will scrape the page, convert it to markdown, and create a searchable local knowledge document.
```

For a crawl:

```text
Import website pages into knowledge library?

Start URL: https://example.com/docs
Mode: same-origin crawl
Max pages: 20
Max depth: 2
Tags: docs, website
This may scrape multiple pages and create one knowledge document per page.
```

### 15.3 Tool Result Summary

The assistant should summarize:

1. how many pages were imported,
2. how many were skipped,
3. why pages were skipped,
4. that each page is now searchable through the knowledge library,
5. any next step needed if all pages failed.

Example:

```text
Imported 12 webpages from example.com into the knowledge library. Skipped 3 pages: 2 duplicates and 1 page with no readable content. The imported pages are now searchable in future knowledge-library answers.
```

## 16. Internationalization

If a custom UI is added for website import, all user-facing text must be translated in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

MVP can rely on generic AI tool confirmation/result rendering if no custom UI strings are introduced.

## 17. Observability

Log structured events without storing page content in logs.

Recommended events:

- import started,
- URL rejected,
- page scraped,
- page skipped,
- duplicate detected,
- upload succeeded,
- upload failed,
- crawl completed.

Recommended metrics:

- pages requested,
- pages discovered,
- pages imported,
- pages skipped,
- scrape duration,
- RAG upload duration,
- chunks created,
- embedding failure count,
- duplicate count.

Do not log:

- full markdown,
- full HTML,
- local staged file paths,
- cookies,
- request headers,
- API tokens.

## 18. Testing Requirements

### 18.1 Unit Tests

Add tests for:

1. Tool schema accepts `single_page` with `url`.
2. Tool schema accepts `url_list` with `urls`.
3. Tool schema accepts `site_crawl` with `url`, `maxPages`, and `maxDepth`.
4. Tool schema rejects missing URL fields for each mode.
5. Tool returns `AI_DISABLED` before scraping when AI is disabled.
6. Tool rejects `replace` duplicate policy.
7. Tool maps URL guard failures to `URL_BLOCKED`.
8. Tool maps scrape failures to `SCRAPE_FAILED`.
9. Tool skips empty markdown as `EMPTY_CONTENT`.
10. Tool calls `RagSearchModule.uploadDocument()` with staged markdown, never a URL as `filePath`.
11. Tool returns compact metadata with no local paths or content.
12. URL list mode returns partial success when some pages fail.
13. Site crawl mode respects `maxPages`.
14. Site crawl mode excludes cross-origin links.

### 18.2 Integration Tests

Add integration coverage with mocked or local HTTP fixtures:

1. Import one static HTML page and verify a RAG document is created.
2. Import multiple pages and verify one document per page.
3. Crawl a small same-origin fixture site and verify page count.
4. Verify imported webpage documents are searchable through `knowledge_library_search`.
5. Verify duplicate URL import is skipped with default policy.

### 18.3 Security Tests

Add tests for blocked URLs:

1. `file:///etc/passwd`
2. `http://localhost`
3. `http://127.0.0.1`
4. `http://169.254.169.254`
5. private network hosts,
6. URLs with credentials,
7. redirects to blocked targets,
8. discovered links to blocked targets.

### 18.4 Permission Tests

Add tests verifying:

1. `knowledge_library_import_website` is registered as built-in.
2. It requires confirmation.
3. It uses `permissionCategory: "automation"`.
4. It appears in contextual knowledge-library tool loading.
5. It does not auto-run in approval modes that require prompts.

## 19. Phased Delivery

### Phase 1: Single Page Import

Deliver:

1. `knowledge_library_import_website` with `single_page` mode.
2. URL validation.
3. Existing scraper reuse.
4. Markdown staging.
5. RAG upload integration.
6. Duplicate handling with current name/size fallback.
7. Unit tests.

Exit criteria:

1. User can ask AI Chat to import one webpage.
2. Imported page appears in knowledge library.
3. Imported page is searchable through `knowledge_library_search`.
4. Unsafe URLs are rejected before scraping.

### Phase 2: URL List Import

Deliver:

1. `url_list` mode.
2. Partial success result shape.
3. Stable URL deduplication.
4. Per-page skipped results.
5. Tests for mixed success/failure.

Exit criteria:

1. User can import multiple specific URLs in one confirmed tool call.
2. One failed page does not fail the entire batch if other pages import.

### Phase 3: Bounded Site Crawl

Deliver:

1. `site_crawl` mode.
2. Same-origin link discovery.
3. `maxPages` and `maxDepth`.
4. Optional page title/final URL/link metadata from scraper worker.
5. Crawl tests with fixture pages.

Exit criteria:

1. User can import a bounded same-origin website crawl.
2. Crawler does not leave the seed origin.
3. Crawler respects all limits.

### Phase 4: First-Class Website Metadata

Deliver:

1. Add source metadata columns to `RAGDocumentEntity`.
2. Add model/module query methods for source URL and content hash.
3. Improve duplicate detection.
4. Group imported webpages by `importGroupId`.
5. Optional UI filtering by source type and website host.

Exit criteria:

1. Website imports are visible as grouped page documents.
2. Duplicate checks use URL/hash metadata, not only name/size.

### Phase 5: Refresh and Maintenance

Deliver:

1. Re-import or refresh existing website documents.
2. Compare content hash before embedding.
3. Optional scheduled refresh.
4. Replace policy with rollback-safe behavior.

Exit criteria:

1. Users can update stale website knowledge without manually deleting old pages.

## 20. Open Questions

1. Should the first release add source metadata columns immediately, or ship URL metadata in description/tags first?
2. Should same-origin crawl include subdomains, or strictly match exact origin?
3. Should the crawler consult `sitemap.xml` in Phase 1 or Phase 2?
4. Should the UI show website imports as grouped collections immediately?
5. What is the default hard limit for crawl pages that balances usefulness and embedding cost?
6. Should imported webpage content include images' alt text?
7. Should the app expose a manual website import UI in addition to the AI tool?
8. Should authenticated website import be supported later through existing browser profiles, or remain out of scope?

## 21. Acceptance Criteria

1. `knowledge_library_import_website` is registered as a built-in AI tool.
2. The tool supports `single_page`, `url_list`, and `site_crawl` in its contract, even if implementation ships by phase.
3. The tool requires confirmation before execution.
4. AI enablement is checked before URL scraping, staging, upload, or embedding.
5. The tool rejects unsafe URLs using existing URL guard services.
6. The implementation reuses `websiteContentScraper` and `HtmlConversionService`.
7. The implementation reuses `RagSearchModule.uploadDocument()`.
8. Each imported webpage is saved as a separate RAG document.
9. Multi-page imports return imported and skipped page summaries.
10. Tool results never expose local file paths, vector paths, full HTML, full markdown, cookies, or headers.
11. Child processes do not access the database.
12. IPC handlers do not access the database directly.
13. Imported webpage documents can be found through `knowledge_library_search`.
14. Duplicate pages are skipped by default.
15. Tests cover schema validation, permission registration, URL safety, duplicate handling, partial success, and RAG upload delegation.

## 22. Recommended Implementation Order

1. Add zod schema and TypeScript result types in `knowledgeLibraryAiToolTypes.ts`.
2. Add a website import service that validates URLs, calls the existing scraper worker, and stages markdown.
3. Extend `KnowledgeLibraryAiTools` with `importWebsite()`.
4. Register `knowledge_library_import_website` in `SkillRegistry`.
5. Add the tool to contextual knowledge-library loading in `ToolLoadPolicyService`.
6. Add tests for the tool service and registry permissions.
7. Ship `single_page`.
8. Add `url_list`.
9. Add `site_crawl`.
10. Add first-class website metadata and improved duplicate detection.

## 23. Future Enhancements

1. Manual website import UI in the knowledge library page.
2. Website import groups with expandable page documents.
3. Refresh selected page.
4. Refresh entire website group.
5. Detect content hash changes before re-embedding.
6. Sitemap-first crawl.
7. Robots-aware crawl policy.
8. Crawl include/exclude path filters.
9. PDF/document link import from crawled websites.
10. Authenticated website import with explicit browser profile selection.
11. Import preview before committing to RAG.
12. Extraction quality scoring and boilerplate detection.
