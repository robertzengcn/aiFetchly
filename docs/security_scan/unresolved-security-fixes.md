# Unresolved Security Fix Validation

Validation date: 2026-07-04
Validated revision: `04ba23e3f4fe55893a24ddb81733dc73da502ebc`
Baseline security scan revision: `9c89de894df6e966034c4dd8a11aae4595782e5c`
Source report: `docs/security_scan/report.md`

This file records the prior Codex Security findings that remain either partially fixed or not fixed after the latest code update. The assessment is based on targeted static validation of the original source-control-sink paths, not a full runtime test of the Electron app.

## Summary

| Prior finding | Current status | Main remaining gap |
| --- | --- | --- |
| MCP stdio server configuration can spawn arbitrary local processes | Partially fixed | Stdio execution is trust-gated, but renderer IPC can set the trust flag directly. |
| RAG upload trusts renderer-supplied file paths and can embed arbitrary local files | Not fixed | The app still reads a renderer-supplied source path before staging it. |
| Website content scraper accepts arbitrary URL schemes and returns fetched content | Partially fixed | Redirect and subresource interception does not perform DNS-range validation before fetch. |
| RAG AI IPC handlers bypass `USER_AI_ENABLED` | Partially fixed | Several RAG remote/AI paths still use the generic handler or streaming `ipcMain.on`. |
| Contact extraction worker can fetch internal HTTP(S) URLs | Partially fixed | Initial URL validation exists, but browser redirects are not guarded per request. |

## 1. MCP stdio server configuration can spawn arbitrary local processes

Status: Partially fixed
Original severity: High

### Current Fix Evidence

- `src/service/MCPToolService.ts:155` adds `assertStdioTrusted(server)` and fails closed unless `MCP_TRUST_<server.id>` is set to `"true"`.
- `src/service/MCPToolService.ts:408`, `src/service/MCPToolService.ts:548`, and `src/service/MCPToolService.ts:613` call the trust check before discovery, execution, and connection tests.
- `src/modules/MCPClient.ts:217` builds a minimal child process environment instead of inheriting all of `process.env`.
- `src/modules/MCPClient.ts:223` filters caller-supplied env values and blocks dangerous names such as `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `NODE_OPTIONS`, and `ELECTRON_*`.

### Remaining Gap

The trust flag can still be set through renderer-accessible IPC:

- `src/main-process/communication/mcp-tool-ipc.ts:130` registers `MCP_TOOL_TRUST`.
- `src/main-process/communication/mcp-tool-ipc.ts:135` calls `service.setTrust(input.serverId, input.trusted)`.
- `src/preload.ts:749` through `src/preload.ts:758` includes `MCP_TOOL_TRUST` in the generic invoke whitelist.
- `src/main-process/communication/_shared/registerValidatedHandler.ts:24` validates shape but does not verify sender origin, privileged UI state, or a user gesture.

That means the dangerous spawn path has moved from "spawn immediately" to "set trust, then spawn". If a renderer is compromised, or if a privileged preload bridge is exposed through another window issue, the renderer can likely trust a stdio MCP server before invoking discovery or execution.

### Required Follow-Up

- Treat `MCP_TOOL_TRUST` like a shell approval, not a normal settings update.
- Require an explicit user-confirmation flow that is bound to one server id and one pending action.
- Reject trust changes from untrusted sender frames or non-app origins.
- Consider one-shot trust for discovery/test execution and a separate persistent trust flow for user-installed MCP servers.
- Keep the env allowlist and env denylist; those parts address secret leakage and process-hijack bypasses.

## 2. RAG upload trusts renderer-supplied file paths and can embed arbitrary local files

Status: Not fixed
Original severity: High

### Current Fix Evidence

- `src/modules/RAGDocumentModule.ts:76` stages uploaded files into `app.getPath("userData")/rag_uploads`.
- `src/modules/RAGDocumentModule.ts:96` persists the staged path as `document.filePath`.
- `src/modules/RAGDocumentModule.ts:462` only deletes paths that resolve under the upload staging directory.

### Remaining Gap

The app still reads the renderer-supplied source path before staging:

- `src/modules/RAGDocumentModule.ts:69` validates `options.filePath`.
- `src/modules/RAGDocumentModule.ts:82` passes the same renderer-supplied path into `stageUploadFile`.
- `src/modules/RAGDocumentModule.ts:136` resolves the external path with `fs.realpathSync(sourcePath)`.
- `src/modules/RAGDocumentModule.ts:153` copies the external path with `fs.copyFileSync(resolvedSource, destPath)`.
- `src/main-process/communication/rag-ipc.ts:410` exposes `RAG_UPLOAD_DOCUMENT` as an AI-gated handler, but gating AI does not prove that `filePath` came from an approved file picker or app-owned temp upload.

The original security issue was local file read and embedding from a known path supplied by the renderer. Copying the file into `rag_uploads` after accepting that path prevents later delete/read problems, but it does not stop the initial arbitrary file read.

### Required Follow-Up

- Do not accept arbitrary renderer-supplied filesystem paths for RAG upload.
- Accept only paths produced by `SHOW_OPEN_DIALOG`, `SAVE_TEMP_FILE`, or another app-owned grant mechanism.
- Store a short-lived upload grant keyed by canonical path, expiry time, and operation.
- Consume the grant when `RAG_UPLOAD_DOCUMENT` starts.
- Reject direct path strings that do not have a matching grant, even if they exist and have a supported extension.

## 3. Website content scraper accepts arbitrary URL schemes and returns fetched content

Status: Partially fixed
Original severity: High

### Current Fix Evidence

- `src/childprocess/websiteContentScraper.ts:66` calls `UrlGuard.validateWithDns(url)` before browser navigation.
- `src/service/UrlGuard.ts:161` rejects non-`http` and non-`https` schemes.
- `src/service/UrlGuard.ts:174` blocks internal hostnames such as `localhost` and metadata aliases.
- `src/service/UrlGuard.ts:183` blocks private, loopback, link-local, and metadata IP literals.
- `src/service/UrlGuard.ts:217` resolves DNS and rejects hosts with private or internal resolved addresses.
- `src/childprocess/websiteContentScraper.ts:93` validates the final post-redirect URL before returning page content.

### Remaining Gap

The request interception path does not perform DNS-range validation before continuing browser requests:

- `src/childprocess/websiteContentScraper.ts:126` enables request interception.
- `src/childprocess/websiteContentScraper.ts:129` calls synchronous `UrlGuard.validate(req.url())`.
- `UrlGuard.validate()` blocks bad schemes and IP literals, but it does not resolve DNS.

Because Puppeteer follows redirects and loads subresources, an attacker-controlled public URL can redirect to a hostname that resolves to an internal address. The final post-redirect `validateWithDns(page.url())` may reject before content is returned, but the request may already have been issued to the internal destination. That keeps SSRF side effects and internal request reachability in scope.

### Required Follow-Up

- Make request interception async and call `UrlGuard.validateWithDns(req.url())` before `req.continue()`.
- Abort requests when DNS validation fails.
- Keep the final post-navigation validation as defense in depth.
- Consider restricting scraping to main-frame documents only or blocking subresources entirely unless required.
- Add tests for redirects from public hosts to `127.0.0.1`, `169.254.169.254`, RFC1918 ranges, and DNS names resolving to those ranges.

## 4. RAG AI IPC handlers bypass `USER_AI_ENABLED`

Status: Partially fixed
Original severity: Medium

### Current Fix Evidence

These RAG handlers now use `registerAiValidatedHandler`, which checks `USER_AI_ENABLED` before parsing or doing work:

- `src/main-process/communication/rag-ipc.ts:400` gates `RAG_QUERY`.
- `src/main-process/communication/rag-ipc.ts:410` gates `RAG_UPLOAD_DOCUMENT`.
- `src/main-process/communication/rag-ipc.ts:555` gates `RAG_SEARCH`.
- `src/main-process/communication/rag-ipc.ts:630` gates `RAG_TEST_EMBEDDING_SERVICE`.
- `src/main-process/communication/rag-ipc.ts:646` gates `RAG_CHUNK_AND_EMBED_DOCUMENT`.

### Remaining Gap

Some RAG paths that call remote AI/model services still bypass the AI gate:

- `src/main-process/communication/rag-ipc.ts:87` registers streaming `SAVE_TEMP_FILE` with `ipcMain.on`, not `registerAiValidatedHandler`.
- `src/main-process/communication/rag-ipc.ts:231` calls `ragController.uploadDocument(uploadOptions)` from that streaming path.
- `src/main-process/communication/rag-ipc.ts:587` registers `RAG_UPDATE_EMBEDDING_MODEL` with `registerValidatedHandler`.
- `src/main-process/communication/rag-ipc.ts:592` calls `RagConfigApi.getAvailableEmbeddingModels()` before updating the embedding model.
- `src/main-process/communication/rag-ipc.ts:610` registers `RAG_GET_AVAILABLE_MODELS` with `registerValidatedHandler`.
- `src/main-process/communication/rag-ipc.ts:615` calls `RagConfigApi.getAvailableEmbeddingModels()`.

If the project rule is "AI feature requests must check AI enable first", these still violate it because they perform RAG upload/model work or remote model API calls before verifying `USER_AI_ENABLED`.

### Required Follow-Up

- Add an AI-enabled fail-closed check at the top of the `SAVE_TEMP_FILE` `ipcMain.on` handler before parsing metadata or writing/processing upload data.
- Convert `RAG_UPDATE_EMBEDDING_MODEL` to `registerAiValidatedHandler`.
- Convert `RAG_GET_AVAILABLE_MODELS` to `registerAiValidatedHandler` if model catalog access is considered part of the AI feature surface.
- Audit `RAG_TEST_PIPELINE`, `RAG_GET_STATS`, `RAG_GET_SUGGESTIONS`, and analytics endpoints to decide whether they trigger embeddings, remote model calls, or paid AI work.
- Add targeted tests that set `USER_AI_ENABLED` to disabled and assert no RAG upload, embedding, model-list, or model-update work occurs.

## 5. Contact extraction worker can fetch internal HTTP(S) URLs

Status: Partially fixed
Original severity: Medium

### Current Fix Evidence

- `src/childprocess/contact-extraction/ContactDiscovery.ts:285` calls `validateUrlAsync(url)` before launching browser navigation.
- `src/childprocess/contact-extraction/ContactDiscovery.ts:388` validates DOM-derived contact page URLs before navigating to them.
- `src/childprocess/contact-extraction/ContactDiscovery.ts:433` validates fallback URLs before navigating to them.
- `src/service/UrlGuard.ts:217` performs DNS resolution and blocks private, loopback, link-local, and metadata destinations.

### Remaining Gap

The browser navigation itself does not apply a redirect-aware SSRF guard:

- `src/childprocess/contact-extraction/ContactDiscovery.ts:305` enables request interception only to block resource types.
- `src/childprocess/contact-extraction/ContactDiscovery.ts:306` continues most requests without URL validation.
- `src/childprocess/contact-extraction/ContactDiscovery.ts:325`, `src/childprocess/contact-extraction/ContactDiscovery.ts:340`, `src/childprocess/contact-extraction/ContactDiscovery.ts:396`, `src/childprocess/contact-extraction/ContactDiscovery.ts:441`, and `src/childprocess/contact-extraction/ContactDiscovery.ts:487` call `page.goto(...)` after pre-validation, but redirects during those navigations are not checked before fetch.

An attacker-controlled public site can still redirect the browser to an internal HTTP(S) destination after the initial URL has passed validation. Even if later extraction fails, the internal request may already have been sent.

### Required Follow-Up

- Reuse the website scraper's interception pattern, but make it DNS-aware before continuing each request.
- Validate every main-frame navigation, redirect, and DOM-derived URL with `UrlGuard.validateWithDns`.
- Abort internal/private/link-local/metadata destinations before the browser fetches them.
- Revalidate `page.url()` after each `page.goto`.
- Add tests or a small local harness for public-to-private redirects and private subresource loads.

## Recommended Fix Order

1. Fix the RAG arbitrary file read first. It is still not fixed and can expose local files through embeddings.
2. Lock down `MCP_TOOL_TRUST` so the stdio spawn approval cannot be self-granted by a compromised renderer.
3. Add DNS-aware request interception to both Puppeteer worker paths.
4. Finish AI gating for the remaining RAG model and streaming upload paths.
