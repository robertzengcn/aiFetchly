# Unresolved Security Fix Validation

Original validation date: 2026-07-04
Original validated revision: `04ba23e3f4fe55893a24ddb81733dc73da502ebc`
Baseline security scan revision: `9c89de894df6e966034c4dd8a11aae4595782e5c`
Source report: `docs/security_scan/report.md`

Resolution validation date: 2026-07-06
Resolved-at commits (branch `worktree-remindsecurity`):
- `0a581180` — F2 follow-up (RAG upload grant)
- `bfb6b2a3` — F1 follow-up (MCP stdio trust hardening)
- `8aef310a` — F3/F7 follow-up (DNS-aware SSRF interception)
- `c9a8f713` — F6 follow-up (remaining RAG AI gating)

This file previously recorded prior Codex Security findings that remained
either partially fixed or not fixed after the baseline round of security
commits. All five "remaining gaps" listed below have since been closed; each
section keeps the original gap description for history and adds a
**Resolution** block describing the follow-up fix and its tests.

## Summary

| Prior finding | Original status | Current status | Follow-up fix |
| --- | --- | --- | --- |
| MCP stdio server configuration can spawn arbitrary local processes | Partially fixed | **Resolved** | `MCP_TOOL_TRUST` now requires a trusted sender origin + native confirmation dialog (`bfb6b2a3`) |
| RAG upload trusts renderer-supplied file paths and can embed arbitrary local files | Not fixed | **Resolved** | Upload-grant mechanism; `SHOW_OPEN_DIALOG` issues, `RAG_UPLOAD_DOCUMENT` consumes (`0a581180`) |
| Website content scraper accepts arbitrary URL schemes and returns fetched content | Partially fixed | **Resolved** | DNS-aware request interception via shared `PuppeteerSsrfGuard` (`8aef310a`) |
| RAG AI IPC handlers bypass `USER_AI_ENABLED` | Partially fixed | **Resolved** | `SAVE_TEMP_FILE` + model handlers gated via `AiFeatureGate` (`c9a8f713`) |
| Contact extraction worker can fetch internal HTTP(S) URLs | Partially fixed | **Resolved** | Shared DNS-aware interception + post-navigation revalidation (`8aef310a`) |

## 1. MCP stdio server configuration can spawn arbitrary local processes

Original status: Partially fixed
Original severity: High
**Current status: Resolved (`bfb6b2a3`)**

### Original Fix Evidence (baseline)

- `src/service/MCPToolService.ts` adds `assertStdioTrusted(server)` and fails closed unless `MCP_TRUST_<server.id>` is set to `"true"`.
- `assertStdioTrusted` is called before discovery, execution, and connection tests.
- `src/modules/MCPClient.ts` builds a minimal child process environment and filters dangerous env names (`LD_PRELOAD`, `NODE_OPTIONS`, `ELECTRON_*`, …).

### Original Remaining Gap (now closed)

The trust flag could be set through renderer-accessible IPC (`MCP_TOOL_TRUST`
was a plain `registerValidatedHandler` with no sender-origin or user-gesture
check), so the spawn path moved from "spawn immediately" to "set trust, then
spawn".

### Resolution

Trust is now treated like a shell-tool approval, not a settings update:

- Extracted `src/service/OriginTrust.ts` → `isAppTrustedOrigin(url)`, the
  single source of truth for the F9 trusted-origin set (about/file/app
  schemes + the Vite dev-server origin). `background.ts` F9
  `setWindowOpenHandler` now uses the same helper.
- `MCP_TOOL_TRUST` (`src/main-process/communication/mcp-tool-ipc.ts`):
  - rejects any sender frame whose origin (`event.senderFrame.url`) is not
    trusted;
  - when granting trust, shows a native `dialog.showMessageBox` confirmation
    labelled with the exact server id+name (`MCPToolService.getServerName`)
    and only grants on an explicit "Trust" click — i.e. a real user gesture
    bound to one server;
  - revocation stays confirmation-free (revoking is always safe).
- Tests: `test/vitest/main/service/OriginTrust.test.ts` (10 cases).
- Type-check mock: `BrowserWindow.fromWebContents` added to
  `test/mocks/electron.ts`.

## 2. RAG upload trusts renderer-supplied file paths and can embed arbitrary local files

Original status: Not fixed
Original severity: High
**Current status: Resolved (`0a581180`)**

### Original Fix Evidence (baseline)

- Uploaded files are staged into `app.getPath("userData")/rag_uploads`.
- `deleteDocument` only unlinks paths that resolve under the staging dir.

### Original Remaining Gap (now closed)

The pipeline still read the renderer-supplied source path
(`fs.realpathSync` + `fs.copyFileSync`) before staging it, so any local file
whose path the renderer supplied could be read and embedded.

### Resolution

Arbitrary renderer-supplied paths are no longer accepted. `RAG_UPLOAD_DOCUMENT`
(`src/main-process/communication/rag-ipc.ts`) now permits a `filePath` only if
it is:

- **app-owned** — resolves under `userData/uploads` (the `SAVE_TEMP_FILE`
  streaming destination), or
- **grant-backed** — backed by a short-lived, one-shot grant issued by
  `SHOW_OPEN_DIALOG` (the native file picker).

Otherwise it throws `Upload rejected: file path was not selected through the
app's file dialog.`

- New `src/service/UploadGrantService.ts`: grants are canonicalized via
  `realpath` (symlink-equivalent paths collapse to one key), scoped by
  operation, one-shot, and short-lived (5 min default). `getUploadGrantService()`
  is a process-wide singleton shared between the dialog issuer and the upload
  consumer.
- `SHOW_OPEN_DIALOG` issues a grant for every path the native dialog returns.
- The frontend's primary path (buffer streaming via `SAVE_TEMP_FILE`) is
  unaffected; the dialog-based flow is covered by grants.
- Tests: `test/vitest/main/service/UploadGrantService.test.ts` (12 cases
  covering issue/consume/expiry/one-shot/operation-scoping/canonicalization
  and `isPathUnderDir` traversal protection).

## 3. Website content scraper accepts arbitrary URL schemes and returns fetched content

Original status: Partially fixed
Original severity: High
**Current status: Resolved (`8aef310a`)**

### Original Fix Evidence (baseline)

- `UrlGuard.validateWithDns(url)` before navigation; bad schemes, IP literals,
  and DNS-rebinding hosts rejected.
- Final post-redirect URL revalidated before returning content.

### Original Remaining Gap (now closed)

The request interceptor called the **synchronous** `UrlGuard.validate()`,
which blocks bad schemes and IP literals but does **not** resolve DNS. A
public URL that redirected (or embedded subresources pointing) to a host
resolving to an internal range could still be fetched.

### Resolution

- New shared `src/service/PuppeteerSsrfGuard.ts` →
  `applySsrfNavigationGuard(page, options?)` calls `UrlGuard.validateWithDns`
  on **every** outgoing request (main frame, redirect targets, subresources)
  and aborts blocked destinations; fail-closed if validation itself throws.
  Optional `blockResourceTypes` preserves per-worker perf optimizations.
- `src/childprocess/websiteContentScraper.ts`: the local sync interceptor was
  replaced with the shared DNS-aware guard. The final post-navigation
  `validateWithDns(page.url())` check remains as defense in depth.
- Tests: `test/vitest/main/service/PuppeteerSsrfGuard.test.ts` (13 cases with
  mocked DNS covering loopback/private/metadata IP literals, bad schemes,
  DNS-rebinding hosts, public passes, and resource-type blocking).

## 4. RAG AI IPC handlers bypass `USER_AI_ENABLED`

Original status: Partially fixed
Original severity: Medium
**Current status: Resolved (`c9a8f713`)**

### Original Fix Evidence (baseline)

- `RAG_QUERY`, `RAG_UPLOAD_DOCUMENT`, `RAG_SEARCH`, `RAG_TEST_EMBEDDING_SERVICE`,
  and `RAG_CHUNK_AND_EMBED_DOCUMENT` use `registerAiValidatedHandler`.

### Original Remaining Gap (now closed)

Several RAG paths that call remote AI/model services still bypassed the AI
gate: `SAVE_TEMP_FILE` (streaming `ipcMain.on`), `RAG_UPDATE_EMBEDDING_MODEL`,
and `RAG_GET_AVAILABLE_MODELS`.

### Resolution

- New `src/service/AiFeatureGate.ts` → `isAiEnabled()`, the single fail-closed
  source of truth for the `USER_AI_ENABLED` check (returns false when the flag
  is off **or** the Token store is unreachable). `registerAiValidatedHandler`
  now delegates to it.
- `SAVE_TEMP_FILE` (`src/main-process/communication/rag-ipc.ts`) checks
  `isAiEnabled()` at the top and sends a fail-closed `SAVE_TEMP_FILE_COMPLETE`
  response before parsing metadata or writing/processing upload data.
- `RAG_UPDATE_EMBEDDING_MODEL` and `RAG_GET_AVAILABLE_MODELS` converted to
  `registerAiValidatedHandler`.
- Other no-remote-work handlers (`RAG_TEST_PIPELINE` is a mock; `RAG_GET_STATS`,
  `RAG_GET_SUGGESTIONS`, analytics are DB-only) were audited and intentionally
  left ungated — they do not trigger embeddings or remote model calls.
- Tests: `test/vitest/main/service/AiFeatureGate.test.ts` (5 cases covering
  enabled/disabled/unset/garbage values and fail-closed-on-Token-throw).

## 5. Contact extraction worker can fetch internal HTTP(S) URLs

Original status: Partially fixed
Original severity: Medium
**Current status: Resolved (`8aef310a`)**

### Original Fix Evidence (baseline)

- `validateUrlAsync(url)` (DNS-aware) before the initial navigation and before
  each DOM-derived/fallback contact-page navigation.

### Original Remaining Gap (now closed)

The browser navigation itself did not apply a redirect-aware SSRF guard: the
request interceptor only blocked resource types and `continue()`d every other
request without URL validation, so an attacker-controlled public site could
redirect the browser to an internal HTTP(S) destination after the initial URL
passed validation.

### Resolution

- `src/childprocess/contact-extraction/ContactDiscovery.ts` replaces the
  resource-type-only interceptor with the shared
  `applySsrfNavigationGuard(page, { blockResourceTypes: ["stylesheet","font","media"] })`
  — preserving the perf optimization while validating every request (including
  redirect targets and subresources) with `UrlGuard.validateWithDns`.
- Added `assertPageUrlSafe(page)` and call it after each external navigation
  (initial, contact-page, fallback) as defense in depth, so extraction never
  runs against an internal page even if a request were to slip through.
- Tests: shared guard covered by `PuppeteerSsrfGuard.test.ts` (13 cases).

## Recommended Fix Order — completed

1. ~~Fix the RAG arbitrary file read first.~~ Done — `0a581180`.
2. ~~Lock down `MCP_TOOL_TRUST`.~~ Done — `bfb6b2a3`.
3. ~~Add DNS-aware request interception to both Puppeteer worker paths.~~
   Done — `8aef310a` (website scraper + contact extraction).
4. ~~Finish AI gating for the remaining RAG model and streaming upload paths.~~
   Done — `c9a8f713`.

## Verification notes

- `npx tsc --noEmit -p tsconfig.json` passes with 0 errors at `c9a8f713`.
- New unit suites all green (40 tests across the four new service modules):
  `UploadGrantService`, `OriginTrust`, `PuppeteerSsrfGuard`, `AiFeatureGate`.
- Pre-existing failures in the broader vitest/main suite (task IPC mocks,
  sqlite-vec-backed AI-memory DB tests, yellow-pages selector tests) were
  confirmed unrelated by reproducing them against the pre-fix revision; they
  stem from the worktree environment (missing `sqlite-vec-linux-x64` native
  extension, missing local `node_modules/.bin/tsc`) and stale fixtures, not
  from these security changes.
