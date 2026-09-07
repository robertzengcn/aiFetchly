# Git-Free GitHub Plugin Installation — Technical Design

## Document Information

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-09-08 |
| Owners | Desktop Platform / Plugin System |
| Product requirement | [Git-Free GitHub Plugin Installation PRD](./git-free-github-plugin-installation-prd.md) |
| Primary runtime | Electron main process, TypeScript 5.x |
| User interface | Vue 3, Vuetify, vue-i18n |
| Persistence | Existing SQLite/TypeORM plugin provenance fields |

## 1. Summary

AiFetchly will install a plugin from a public GitHub repository without invoking
the `git` executable. The GitHub source fetcher will resolve the requested ref
to an immutable commit SHA using GitHub's REST API, download that commit as a
ZIP archive, and pass the archive through the existing bounded extraction and
plugin validation pipeline.

The public GitHub REST archive endpoints do **not** require a token for public
repositories. Unauthenticated requests are rate-limited, however, so the
implementation must recognize and explain rate-limit failures. Private
repository authentication is deliberately deferred; version 1 must never ask
for, discover, log, or persist a GitHub token.

This design makes seven architectural changes:

1. GitHub repository URLs select archive acquisition before generic `.git`
   routing.
2. A new GitHub archive client resolves revisions and downloads immutable ZIPs.
3. GitHub and generic URL downloads share one hardened HTTPS transport.
4. Acquisition results may contribute trusted provenance metadata.
5. Expected install failures cross IPC as typed results instead of flattened
   exception strings.
6. Renderer cancellation propagates to active main-process HTTP work.
7. Native Git reports a dedicated `git-not-installed` error when it is selected
   explicitly and cannot be spawned.

No new database entity or migration is required. The current
`InstalledPluginEntity` provenance columns are sufficient.

## 2. Scope

### 2.1 In scope

- Public repositories hosted on `github.com`.
- Repository URLs with and without a trailing `.git`.
- Default-branch installation when no ref is supplied.
- Branch, tag, abbreviated SHA, and full SHA input through the separate Ref
  field.
- Immutable commit resolution and provenance.
- Existing GitHub release asset URL behavior.
- Explicit native Git installations and actionable missing-Git errors.
- Bounded download, redirect validation, cancellation, cleanup, typed errors,
  UI guidance, translations, and automated tests.

### 2.2 Out of scope

- Private repository installation or token storage.
- GitHub Enterprise Server.
- Git submodules and Git LFS object hydration.
- SSH URLs.
- Arbitrary credentials embedded in URLs.
- Automatically installing Git.
- Supporting `tree/<ref>` or `commit/<sha>` browser convenience URLs in version
  1. They are rejected with guidance to use the repository URL and Ref field.
- Changing the plugin manifest, archive validation, permission review, or
  activation model.

## 3. Current-System Findings

The proposed design is based on the following repository behavior:

- `GitHubPluginFetcher` classifies repository, release-asset, and latest-release
  URLs. Repository URLs currently delegate to `GitPluginFetcher` with an HTTPS
  `.git` URL.
- `UrlPluginFetcher` checks the `.git` suffix before GitHub classification. A
  GitHub repository ending in `.git` can therefore bypass GitHub-specific
  archive behavior.
- `GitHubPluginFetcher` and `UrlPluginFetcher` contain separate native-HTTPS
  download implementations with different failure detail and no shared redirect
  policy.
- `PluginArchiveService` already enforces compressed size, extracted size, file
  count, traversal, absolute-path, device-path, and symlink protections.
- `PluginManifestService.resolvePluginRoot()` already accepts a manifest at the
  archive root or under one wrapper directory, matching GitHub ZIP layout.
- `PluginInstallService` constructs persisted provenance from the original
  request only. A fetcher cannot currently return a resolved commit SHA.
- `registerValidatedHandler` and renderer `windowInvoke` reduce a rejected IPC
  operation to a message string. Expected domain error codes are consequently
  unavailable to the install dialog.
- `GitPluginFetcher` does not preserve whether spawning failed with `ENOENT`, so
  a missing Git executable becomes a generic I/O error.

The implementation should extend these boundaries, not create a parallel
installation path.

Current code anchors:

- [`GitHubPluginFetcher.ts`](../../src/service/pluginSources/GitHubPluginFetcher.ts)
- [`GitPluginFetcher.ts`](../../src/service/pluginSources/GitPluginFetcher.ts)
- [`UrlPluginFetcher.ts`](../../src/service/pluginSources/UrlPluginFetcher.ts)
- [`pluginSourceTypes.ts`](../../src/service/pluginSources/pluginSourceTypes.ts)
- [`PluginInstallService.ts`](../../src/service/PluginInstallService.ts)
- [`PluginArchiveService.ts`](../../src/service/PluginArchiveService.ts)
- [`plugin-ipc.ts`](../../src/main-process/communication/plugin-ipc.ts)
- [`PluginInstallSourceDialog.vue`](../../src/views/components/plugins/PluginInstallSourceDialog.vue)

## 4. Design Principles

1. **GitHub is an archive source.** Selecting GitHub must not inspect `PATH` or
   spawn Git.
2. **Explicit Git remains Git.** Selecting the Git source preserves clone
   semantics and may require a local executable.
3. **Resolve before downloading.** Installation bytes are requested by immutable
   commit SHA, not a moving branch name.
4. **One untrusted-archive boundary.** Every downloaded ZIP enters
   `LocalZipPluginFetcher` and the current archive and manifest validators.
5. **No implicit credentials.** Public GitHub requests contain no authorization
   header, query token, cookie, or credential-manager lookup.
6. **Typed failures are product behavior.** Expected network and source failures
   are returned as data; unexpected programming faults still use the IPC error
   envelope.
7. **Acquire into temporary storage, then commit.** Partial network output and
   failed validation never alter an installed plugin.

## 5. Architecture

### 5.1 Component view

```text
Renderer
  PluginInstallSourceDialog.vue
       | install request { operationId, kind, uri, ref, overwrite }
       | optional cancel request { operationId }
       v
Electron main process
  plugin-ipc.ts
       | validates request / owns AbortController
       v
  PluginInstallService
       | selects source fetcher
       v
  GitHubPluginFetcher ----------------------+
       | repository                         | release asset
       v                                    |
  GitHubArchiveClient                       |
       | resolve commit + download           |
       +-------------------+----------------+
                           v
                 PluginHttpDownloadService
                           |
                           v
                    temporary ZIP
                           |
                           v
                 LocalZipPluginFetcher
                           |
                           v
                   PluginArchiveService
                           |
                           v
                  PluginImportService
                           |
                           v
              Plugin Module -> Model -> SQLite
```

The worker-process subsystem is not involved. Acquisition is network I/O in the
Electron main process, and all database writes continue through the existing
module/model path.

### 5.2 Installation sequence

```text
User        Dialog        plugin-ipc      InstallService    GitHub       Archive/Import
 |            |               |                |              |                |
 | Install    |               |                |              |                |
 |----------->| operationId   |                |              |                |
 |            |-------------->| AbortController|              |                |
 |            |               |--------------->| classify URL |                |
 |            |               |                |------------->| resolve ref    |
 |            |               |                |<-------------| full SHA       |
 |            |               |                |------------->| ZIP by SHA     |
 |            |               |                |<-------------| temp ZIP       |
 |            |               |                |------------------------------>|
 |            |               |                |        validate/import        |
 |            |               |                |<------------------------------|
 |            |               |<---------------| typed result + provenance     |
 |            |<--------------| cleanup controller                            |
 | success or actionable error|                |              |                |
```

### 5.3 Cancellation sequence

```text
Dialog -- plugin:cancel-install(operationId) --> main-process operation map
                                                     |
                                                     v
                                               AbortController.abort()
                                                     |
                 active request/stream <-------------+
                          |
                          v
                  delete partial file
                          |
                          v
                normal fetcher cleanup in finally
```

Cancellation is best-effort. Once the atomic install rename has started, the
existing import transaction finishes rather than leaving a partial installation.

## 6. GitHub URL Contract

### 6.1 Accepted forms

The GitHub source accepts:

```text
https://github.com/{owner}/{repository}
https://github.com/{owner}/{repository}/
https://github.com/{owner}/{repository}.git
https://github.com/{owner}/{repository}/releases/download/{tag}/{asset}.zip
https://github.com/{owner}/{repository}/releases/latest
```

Repository `.git` is syntax only and is stripped during canonicalization. It
does not select native Git.

### 6.2 Validation rules

`classifyGitHubUrl()` must:

- parse with the WHATWG `URL` class;
- require `https:`;
- require exact hostname `github.com`, case-insensitively;
- allow no username or password;
- allow no non-default port;
- reject fragments;
- reject repository query strings;
- reject control characters and CR/LF before parsing;
- accept exactly two repository path segments, aside from the supported release
  patterns;
- remove one trailing `.git` from the repository name;
- canonicalize the repository URL to
  `https://github.com/{owner}/{repository}`;
- retain the existing release-asset and latest-release classifications; and
- return an `unknown` classification for all other paths.

Owner and repository values must be treated as data and inserted only into URL
path components. They must never be interpolated into a shell command.

### 6.3 Dispatcher precedence

`UrlPluginFetcher.classifyUrlKind()` must use this order:

1. exact supported GitHub URL;
2. generic Git URL;
3. generic ZIP URL;
4. unsupported URL.

This ordering is the regression guard that makes
`https://github.com/org/repo.git` Git-free while preserving non-GitHub `.git`
behavior.

### 6.4 Unsupported convenience URLs

Version 1 rejects URLs such as:

```text
https://github.com/org/repo/tree/feature/example
https://github.com/org/repo/commit/0123456789abcdef
```

The returned error instructs the renderer to show: use the repository URL and
put the branch, tag, or commit in the Ref field. This avoids ambiguous parsing
of branch names containing `/` and keeps one canonical source identity.

## 7. GitHub Archive Protocol

### 7.1 Authentication answer

For public repositories, GitHub's REST endpoints for commit lookup and repository
archives can be called without authentication. No token is needed. These calls
consume GitHub's unauthenticated REST rate limit for the public IP address.

Private repositories require authentication and repository Contents read
permission. That flow is not implemented in version 1.

Authoritative references:

- [GitHub REST API authentication guidance](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)
- [GitHub repository contents archive endpoints](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip)
- [GitHub commits endpoints](https://docs.github.com/en/rest/commits/commits)
- [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

### 7.2 Unauthenticated request budget

GitHub currently documents a primary limit of 60 unauthenticated REST requests
per hour for an originating IP address. A normal successful repository install
uses two REST requests: one commit lookup and one archive request. The practical
upper bound is therefore about 30 successful installs per hour for a shared IP,
before counting other unauthenticated GitHub API consumers. Redirect delivery
and release-asset traffic may be governed separately by GitHub.

The client must not assume the numeric limit. It reads rate response headers for
diagnosis, maps exhausted quota to `github-rate-limited`, and never performs
automatic retries. The documented figure is capacity-planning context, not a
hardcoded application constant.

### 7.3 Why revision resolution comes first

The implementation performs a metadata lookup before downloading an archive.
This is intentional:

- branch names and tags can move;
- archive redirect URLs are not a stable provenance API;
- ZIP content does not provide a trustworthy, uniform commit metadata field;
- persisted provenance requires the exact installed revision; and
- requesting the archive by the resolved SHA ensures lookup and content refer to
  the same immutable commit.

The normal flow therefore uses two GitHub API requests: one revision lookup and
one archive request. Redirects from the archive request do not count as semantic
API operations.

### 7.4 Resolve an explicit ref

When the request contains a non-empty ref:

```http
GET https://api.github.com/repos/{owner}/{repo}/commits/{encodedRef}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
User-Agent: AiFetchly/{appVersion}
```

The response body is read into a bounded metadata buffer of at most 1 MiB. The
client parses `sha` and accepts only a 40-character lowercase or uppercase
hexadecimal Git commit ID. The persisted value is normalized to lowercase.

GitHub accepts a branch, tag, abbreviated SHA, or full SHA for this operation.
The URL path component is encoded; the raw ref is never concatenated into a URL.

### 7.5 Resolve the default branch head

When the request does not contain a ref:

```http
GET https://api.github.com/repos/{owner}/{repo}/commits?per_page=1
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
User-Agent: AiFetchly/{appVersion}
```

The first array item supplies the full SHA at request time. This avoids a
separate repository-metadata request and resolves the default branch in one API
call. An empty array is mapped to `github-ref-not-found`, covering a repository
with no commits.

### 7.6 Download the immutable archive

After resolution:

```http
GET https://api.github.com/repos/{owner}/{repo}/zipball/{fullSha}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
User-Agent: AiFetchly/{appVersion}
```

GitHub normally returns a redirect to an archive host. The shared transport
validates that redirect and streams the result to a unique temporary `.part`
file. Only a complete, size-valid response is renamed to the `.zip` path passed
to `LocalZipPluginFetcher`.

### 7.7 Race behavior

If a branch moves between revision lookup and archive download, the archive is
still requested by the already-resolved SHA. The installation remains
reproducible. If the commit disappears or becomes inaccessible in between, the
operation fails; it must not retry by resolving a newer branch head silently.

### 7.8 Release assets

Existing supported release-asset URLs continue to download the specified ZIP.
They move to the shared transport but do not gain commit resolution, because a
release asset is publisher-supplied content rather than a repository snapshot.
Its provenance stores the canonical release URL and request metadata available
today.

The existing `releases/latest` input remains supported by constructing the
documented stable asset target
`releases/latest/download/plugin.zip`. Version 1 does not add release discovery
or arbitrary asset selection.

## 8. Shared HTTPS Download Service

### 8.1 New service

Add:

```text
src/service/pluginSources/PluginHttpDownloadService.ts
```

The service uses Node's `https` module. No production dependency is added. Its
constructor accepts a request function and clock/timer seam for unit tests.

It exposes two operations backed by the same redirect, deadline, header, and
response-limit engine:

- `downloadToFile()` streams a large archive through a `.part` file; and
- `getBuffer()` collects a small response up to the caller's byte limit for
  metadata JSON.

`GitHubArchiveClient` uses `getBuffer()` for commit lookup and
`downloadToFile()` for the ZIP. Generic ZIP acquisition uses only
`downloadToFile()`.

### 8.2 Contracts

```typescript
export interface PluginHttpHeaders {
  readonly [name: string]: string;
}

export interface PluginRedirectContext {
  readonly from: URL;
  readonly to: URL;
  readonly redirectCount: number;
}

export type PluginRedirectPolicy = (
  context: PluginRedirectContext,
) => boolean;

export interface PluginHttpDownloadRequest {
  readonly url: URL;
  readonly destinationPath: string;
  readonly headers: PluginHttpHeaders;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly redirectPolicy: PluginRedirectPolicy;
  readonly signal?: AbortSignal;
  readonly onProgress?: (receivedBytes: number, totalBytes?: number) => void;
}

export interface PluginHttpBufferRequest {
  readonly url: URL;
  readonly headers: PluginHttpHeaders;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly redirectPolicy: PluginRedirectPolicy;
  readonly signal?: AbortSignal;
}

export type PluginHttpFailureReason =
  | "aborted"
  | "timeout"
  | "network"
  | "http-status"
  | "too-large"
  | "redirect-missing-location"
  | "redirect-limit"
  | "redirect-loop"
  | "redirect-rejected"
  | "filesystem";

export type PluginHttpDownloadResult =
  | {
      readonly success: true;
      readonly finalUrl: string;
      readonly bytesWritten: number;
      readonly statusCode: number;
      readonly responseHeaders: Readonly<Record<string, string>>;
    }
  | {
      readonly success: false;
      readonly reason: PluginHttpFailureReason;
      readonly statusCode?: number;
      readonly retryAfterSeconds?: number;
      readonly responseHeaders?: Readonly<Record<string, string>>;
    };

export type PluginHttpBufferResult =
  | {
      readonly success: true;
      readonly finalUrl: string;
      readonly body: Uint8Array;
      readonly statusCode: number;
      readonly responseHeaders: Readonly<Record<string, string>>;
    }
  | {
      readonly success: false;
      readonly reason: PluginHttpFailureReason;
      readonly statusCode?: number;
      readonly retryAfterSeconds?: number;
      readonly responseHeaders?: Readonly<Record<string, string>>;
    };
```

The actual implementation must use existing project quote style and lint rules.
No `any` type is permitted.

### 8.3 Streaming algorithm

1. Validate the initial URL and abort state.
2. Create `destinationPath + ".part"` with exclusive creation.
3. Start one overall deadline for the full redirect chain and response stream.
4. Issue an HTTPS GET with `Accept-Encoding: identity` so byte limits apply to
   the actual archive representation.
5. On a redirect, resolve `Location` relative to the current URL, validate it,
   close the current response, and continue without resetting the deadline.
6. On a 2xx response, reject an oversized valid `Content-Length` before piping.
7. Count each received chunk and abort immediately above `maxBytes`.
8. Flush and close the output stream after a complete response.
9. Rename the `.part` file to `destinationPath` on the same filesystem.
10. On every failure or cancellation, destroy request/response streams and
    remove the partial file.

All settle paths use one idempotent completion guard so timeout, abort, request
error, stream error, and close events cannot resolve twice.

### 8.4 Redirect policy

Every redirect must satisfy all baseline rules:

- HTTPS only;
- no username or password;
- default HTTPS port only;
- no CR/LF in `Location`;
- no repeated normalized URL;
- at most five redirects; and
- approval by the caller's host policy.

Policies are deliberately source-specific:

| Source | Initial host | Allowed redirect hosts |
|---|---|---|
| GitHub API metadata | `api.github.com` | No redirects expected; only `api.github.com` |
| GitHub repository archive | `api.github.com` | `api.github.com`, `codeload.github.com` |
| GitHub release asset | `github.com` | `github.com`, `release-assets.githubusercontent.com`, `objects.githubusercontent.com` |
| Generic HTTPS ZIP | Original exact host | Original exact host only |

An allowlist is a named exported constant with focused tests. If GitHub changes
its documented delivery hosts, the list is updated through a reviewed release;
the client must not fall back to following an arbitrary host.

### 8.5 Sensitive-header handling

Version 1 sends no credentials. The shared service is nevertheless safe for
future authenticated use:

- `authorization`, `cookie`, and `proxy-authorization` are removed whenever the
  origin changes;
- sensitive headers are permitted only when a caller explicitly marks the exact
  destination origin as credential-bearing; and
- URLs and headers are never included verbatim in error messages or logs.

This future-proofing does not authorize private-repository support.

### 8.6 Limits

Use named constants:

```typescript
export const PLUGIN_HTTP_TIMEOUT_MS = 60_000;
export const PLUGIN_HTTP_MAX_REDIRECTS = 5;
export const PLUGIN_GITHUB_METADATA_MAX_BYTES = 1 * 1024 * 1024;
```

Archive downloads use `PLUGIN_PACKAGE_LIMITS.maxZipBytes`; no duplicate archive
size constant is introduced. Existing extracted-size and file-count limits remain
owned by `PluginArchiveService`.

## 9. GitHub Archive Client

### 9.1 New class

Add:

```text
src/service/pluginSources/GitHubArchiveClient.ts
```

```typescript
export interface GitHubRepositoryIdentity {
  readonly owner: string;
  readonly repository: string;
  readonly canonicalUrl: string;
}

export interface GitHubResolvedRevision {
  readonly requestedRef?: string;
  readonly commitSha: string;
}

export interface GitHubArchiveClientDependencies {
  readonly http: PluginHttpDownloadService;
  readonly appVersion: string;
}
```

Public methods:

```typescript
resolveRevision(
  repository: GitHubRepositoryIdentity,
  requestedRef: string | undefined,
  signal?: AbortSignal,
): Promise<GitHubResolveResult>

downloadArchive(
  repository: GitHubRepositoryIdentity,
  revision: GitHubResolvedRevision,
  destinationPath: string,
  signal?: AbortSignal,
  onProgress?: PluginSourceProgressHandler,
): Promise<GitHubDownloadResult>
```

Both methods return discriminated unions. Network helpers do not throw for
expected HTTP, cancellation, timeout, parse, or size failures. Programmer errors
may still throw and are redacted by `PluginInstallService`.

### 9.2 Status mapping

| Response or transport condition | Plugin error code | Recoverable | UI action |
|---|---|---:|---|
| `401` | `github-repository-unavailable` | Yes | Verify URL/access |
| `403` with remaining rate `0` | `github-rate-limited` | Yes | Wait and retry |
| `403` without rate-limit proof | `github-repository-unavailable` | Yes | Verify access |
| `404` resolving explicit ref, repository probe succeeds | `github-ref-not-found` | Yes | Correct Ref |
| `404` resolving explicit ref, repository probe is inaccessible | `github-repository-unavailable` | Yes | Verify URL/access |
| `404` resolving default head | `github-repository-unavailable` | Yes | Verify URL/access |
| `404` downloading resolved SHA | `github-repository-unavailable` | Yes | Retry/verify access |
| `429` | `github-rate-limited` | Yes | Wait and retry |
| Other `4xx` | `github-repository-unavailable` | Yes | Verify URL |
| `5xx` | `source-download-failed` | Yes | Retry later |
| Deadline exceeded | `source-timeout` | Yes | Check network/retry |
| Abort signal | `source-cancelled` | Yes | No error toast on user cancel |
| Redirect policy failure | `source-redirect-rejected` | No | Report safely |
| Malformed JSON/SHA | `source-download-failed` | Yes | Retry/report issue |
| ZIP exceeds limit | existing `install-io-failed` with safe size message | No | Use smaller package |

A `404` must never assert that a repository is private. GitHub intentionally
uses not-found responses for some inaccessible resources.

An explicit-ref `404` is ambiguous by itself. On that failure path only, the
client performs a bounded unauthenticated `GET /repos/{owner}/{repo}` probe. A
successful probe proves that the repository is public and the ref is missing.
An inaccessible probe maps to `github-repository-unavailable`; a probe rate
limit maps to `github-rate-limited`. This conditional third request is not made
on the successful path. It is never used to solicit credentials.

`Retry-After` is parsed as a bounded non-negative integer. If absent, the UI may
show a generic wait-and-retry message. `X-RateLimit-Reset` may be converted to a
relative wait duration using the injected clock, but the absolute timestamp is
not persisted.

### 9.3 No authentication fallback

On `401`, `403`, or `404`, version 1 does not:

- prompt for a personal access token;
- inspect Git credential helpers;
- inspect environment variables for tokens;
- retry through native Git;
- open a browser login; or
- send credentials found elsewhere in AiFetchly.

The user can deliberately choose the Git source if their local Git setup already
has private access.

## 10. Source Fetcher Changes

### 10.1 `PluginSourceRequest`

Add an internal-only cancellation field:

```typescript
export interface PluginSourceRequest {
  // existing fields remain unchanged
  readonly signal?: AbortSignal;
}
```

The renderer never serializes `AbortSignal`. `plugin-ipc.ts` creates it after
request validation and supplies it to `PluginInstallService`.

### 10.2 Acquisition provenance

Extend the acquired-source result:

```typescript
export interface PluginAcquisitionProvenance {
  readonly sourceUri?: string;
  readonly sourceRef?: string;
  readonly sourceMeta?: Readonly<Record<string, unknown>>;
}

export interface FetchedPluginSource {
  readonly localRoot: string;
  readonly cleanup: () => Promise<void>;
  readonly provenance?: PluginAcquisitionProvenance;
}
```

For a GitHub repository archive, the fetcher returns:

```typescript
{
  sourceUri: "https://github.com/owner/repository",
  sourceRef: requestedRef,
  sourceMeta: {
    acquisition: "github-archive",
    resolvedCommitSha: "40-character-sha",
    repositoryHost: "github.com"
  }
}
```

`sourceRef` is omitted when the user requested the default branch. The immutable
SHA is always present for successful repository archive installations.

### 10.3 Provenance merge ownership

`PluginInstallService` builds final provenance using this precedence:

```typescript
const provenance: PluginSourceProvenance = {
  sourceKind: request.kind,
  sourceUri: acquired.provenance?.sourceUri ?? request.uri,
  sourceRef: acquired.provenance?.sourceRef ?? request.ref,
  source: request.source,
  sourceMeta: {
    ...registryMetadata,
    ...request.sourceMeta,
    ...acquired.provenance?.sourceMeta,
  },
};
```

Fetcher-generated keys win over renderer/request keys. This prevents a caller
from spoofing `resolvedCommitSha` or `acquisition`. `sourceKind` and `source` are
still controlled by the validated request and registry.

The merge must create a fresh serializable object and reject values that do not
survive the existing IPC/persistence sanitization rules.

### 10.4 `GitHubPluginFetcher`

The constructor becomes fully injectable:

```typescript
interface GitHubPluginFetcherDependencies {
  readonly archiveClient: GitHubArchiveClient;
  readonly zip: LocalZipPluginFetcher;
  readonly temporaryDirectoryFactory: PluginTemporaryDirectoryFactory;
}
```

Repository behavior:

1. classify and canonicalize URL;
2. create a unique temporary directory;
3. resolve the ref;
4. download `<temp>/source.zip` by resolved SHA;
5. delegate extraction to `LocalZipPluginFetcher` with the original limits,
   overwrite flag, progress handler, and abort signal;
6. return the extracted root plus trusted acquisition provenance; and
7. clean the ZIP and extraction directory on all failure and final cleanup paths.

It must not depend on or instantiate `GitPluginFetcher` for repository URLs.

### 10.5 `UrlPluginFetcher`

`UrlPluginFetcher` receives shared instances through its constructor rather than
creating nested default fetchers. Its generic ZIP behavior uses
`PluginHttpDownloadService`; its GitHub behavior delegates to the same registered
`GitHubPluginFetcher` instance.

This removes duplicated network code and makes limits, cancellation, redirect
rules, and tests consistent.

### 10.6 Fetcher registry composition

`PluginInstallService.createDefaultRegistry()` constructs dependencies once:

```text
PluginHttpDownloadService (one instance)
  +-> GitHubArchiveClient
  |     +-> GitHubPluginFetcher
  +-> UrlPluginFetcher

LocalZipPluginFetcher (one instance)
  +-> GitHubPluginFetcher
  +-> UrlPluginFetcher
```

The registry still exposes the same source kinds. Existing tests that inject a
custom registry remain valid.

## 11. Error Model

### 11.1 New error codes

Extend `PluginErrorCode` with:

```typescript
| "git-not-installed"
| "github-repository-unavailable"
| "github-ref-not-found"
| "github-rate-limited"
| "source-timeout"
| "source-download-failed"
| "source-redirect-rejected"
| "source-cancelled"
```

Dedicated codes are selected instead of a free-form `reason` nested under
`install-io-failed`. Codes are easier to exhaustively map in the renderer,
preserve compatibility with the existing `PluginError` union, and allow future
telemetry without parsing English messages.

### 11.2 Error safety

All service messages are safe summaries. They must not include:

- URL query strings;
- request or response headers;
- local temporary paths;
- archive entry content;
- environment variables;
- Git stderr that may contain credentials; or
- response bodies from GitHub.

Unexpected `unknown` errors continue through the existing redaction function.
Expected errors use static templates plus sanitized owner/repository/ref values
only when needed.

### 11.3 Native Git spawn result

Refactor `GitPluginFetcher.runUntilSettled()` to retain why the process settled:

```typescript
type GitProcessResult =
  | { readonly kind: "closed"; readonly exitCode: number | null }
  | { readonly kind: "spawn-error"; readonly errorCode?: string }
  | { readonly kind: "timeout" };
```

If `child_process.spawn()` emits an error whose code is `ENOENT`, return:

```typescript
{
  code: "git-not-installed",
  message: "Git is not installed or is not available on PATH. Choose GitHub to install a public repository without Git.",
  recoverable: true
}
```

Other spawn failures and non-zero exits remain safe generic install failures.
No code path attempts to install Git.

## 12. IPC Design

### 12.1 Shared renderer-safe result

Add a serializable result type to `src/entityTypes/pluginTypes.ts`:

```typescript
export type PluginInstallFromSourceResult =
  | {
      readonly success: true;
      readonly plugin: PluginSummary;
    }
  | {
      readonly success: false;
      readonly errors: readonly PluginError[];
    };
```

Expected service failures are returned inside the normal IPC success envelope:

```text
{ status: true, msg: "", data: { success: false, errors: [...] } }
```

This is intentional. The outer envelope describes whether IPC execution and
schema handling worked. The inner union describes the plugin-install domain
result. Unexpected exceptions still return outer `status: false` and a redacted
message through `registerValidatedHandler`.

### 12.2 Install request schema

Replace permissive passthrough validation for this channel with an explicit Zod
schema:

```typescript
{
  operationId: z.string().uuid(),
  kind: z.enum(["local-zip", "local-folder", "git", "github", "npm", "url"]),
  overwrite: z.boolean().optional(),
  zipPath: boundedSafeString.optional(),
  folderPath: boundedSafeString.optional(),
  uri: boundedSafeString.optional(),
  ref: boundedSafeString.optional(),
  npmSpec: boundedSafeString.optional()
}
```

The schema is strict. It does not accept `signal`, callbacks, arbitrary
`sourceMeta`, or unknown fields from the renderer. Kind-specific required-field
checks remain in a typed refinement or service validator.

This IPC handler is plugin management, not an AI function, so the repository's
AI-enable gate does not apply.

### 12.3 Operation registry

`plugin-ipc.ts` owns:

```typescript
const activePluginInstalls = new Map<string, AbortController>();
```

Install handling:

1. validate the request;
2. reject a duplicate `operationId`;
3. create and store an `AbortController`;
4. call `PluginInstallService` with `signal`;
5. promote capabilities and broadcast configuration changes only on success;
6. remove the controller in `finally`; and
7. return the typed domain result.

Only the main process mutates the map. No database access is added to the IPC
handler.

### 12.4 Cancel channel

Add to `src/config/channellist.ts`:

```typescript
export const PLUGIN_CANCEL_INSTALL = "plugin:cancel-install";
export const PLUGIN_GET_INSTALL_CAPABILITIES =
  "plugin:get-install-capabilities";
```

The handler accepts only `{ operationId: UUID }`. It aborts and returns `true`
when an active operation exists; otherwise it returns `false`. Cancellation is
idempotent and scoped to one installation.

The capability handler takes no input and returns:

```typescript
export interface PluginInstallCapabilities {
  readonly githubArchiveInstallEnabled: boolean;
}
```

The dialog reads this value when it opens. This prevents renderer copy from
promising Git-free behavior while the emergency compatibility flag is disabled.
The renderer can observe the flag but cannot enable it.

The preload bridge must expose this allowlisted channel through the existing IPC
mechanism. No general-purpose abort or event channel is added.

### 12.5 Renderer API

Change the renderer API to:

```typescript
export async function installPluginFromSource(
  request: PluginInstallFromSourceRequest,
): Promise<PluginInstallFromSourceResult>

export async function cancelPluginInstall(
  operationId: string,
): Promise<boolean>

export async function getPluginInstallCapabilities():
  Promise<PluginInstallCapabilities>
```

The API generates no error copy. The component maps stable codes to localized
messages. An outer IPC failure remains an exception and is rendered as a safe
generic installation failure.

## 13. User Interface Design

### 13.1 GitHub source copy

When source kind is GitHub, the dialog shows:

- label: **GitHub repository URL**;
- helper: **Public repositories install without Git or a GitHub token.**;
- optional Ref field with branch/tag/commit guidance; and
- no token field in version 1.

Selecting Git shows a separate helper that a local Git installation may be
required. The UI must not imply GitHub and Git are equivalent sources.

### 13.2 Working state

The install button enters an indeterminate working state. Version 1 uses the
existing progress callback where available but does not introduce a main-to-
renderer byte-progress event. The visible status can remain **Installing…**;
precise byte progress is not required by the PRD.

While active:

- source fields and Install are disabled;
- Cancel remains enabled;
- dismissing the dialog triggers best-effort cancellation; and
- late resolution from the closed dialog is ignored.

### 13.3 Error mapping

The component uses an exhaustive mapping from `PluginErrorCode` to translation
keys. Suggested English behavior:

| Code | User-facing guidance |
|---|---|
| `git-not-installed` | Git is unavailable. Choose GitHub for a public repository, or install Git and retry. |
| `github-repository-unavailable` | The repository was not found or is not publicly accessible. Check the URL and access. |
| `github-ref-not-found` | This branch, tag, or commit was not found. Check Ref and retry. |
| `github-rate-limited` | GitHub's public request limit was reached. Wait and retry. |
| `source-timeout` | The download timed out. Check the connection and retry. |
| `source-download-failed` | The plugin could not be downloaded. Retry later. |
| `source-redirect-rejected` | GitHub redirected to an untrusted location, so installation was stopped. |
| `source-cancelled` | No error alert when cancellation was initiated by this dialog. |

Unknown codes fall back to the already-sanitized service message, then a generic
localized error if the message is empty.

### 13.4 Internationalization

Add identical keys under `plugins.install_source` in:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Every component call follows the repository convention of an English fallback,
for example:

```typescript
t("plugins.install_source.github_no_git_hint") ||
  "Public repositories install without Git or a GitHub token."
```

## 14. Persistence and Provenance

### 14.1 Stored fields

The existing columns store:

| Field | GitHub archive value |
|---|---|
| `sourceKind` | `github` |
| `sourceUri` | canonical repository URL without `.git`, query, or fragment |
| `sourceRef` | user-requested ref, omitted for default branch |
| `source` | existing registry/source identity when supplied |
| `sourceMetaJson.acquisition` | `github-archive` |
| `sourceMetaJson.resolvedCommitSha` | full normalized commit SHA |
| `sourceMetaJson.repositoryHost` | `github.com` |

No downloaded archive URL is stored because it may contain expiring signed query
parameters. No request or response headers are stored.

### 14.2 Reinstall behavior

Reinstall and overwrite keep the existing `PluginImportService` transaction and
rollback semantics. New provenance replaces the installed record only after the
new plugin has passed extraction, manifest validation, permission analysis, and
atomic installation.

### 14.3 Database boundary

The fetcher and HTTP client do not access SQLite. `PluginInstallService` passes
provenance into `PluginImportService`, which continues through the established
Module and Model layers. No database code is added to IPC or worker code.

## 15. Security Design

### 15.1 Threats and controls

| Threat | Control |
|---|---|
| SSRF through a GitHub-looking URL | Exact HTTPS host and port checks; no arbitrary archive host |
| Open redirect to attacker host | Source-specific host allowlists on every hop |
| Credential leakage on redirect | No v1 credentials; sensitive-header stripping on origin change |
| ZIP bomb | Existing compressed/extracted byte and file-count limits |
| Path traversal | Existing archive entry validation |
| Symlink/device entry | Existing archive rejection |
| Partial or corrupted download | `.part` file plus completed-response rename |
| Disk residue after failure | Transport cleanup plus fetcher `finally` cleanup |
| Ref/content race | Resolve once, download by immutable SHA |
| Provenance spoofing | Acquisition metadata wins over renderer metadata |
| Shell injection | Native HTTPS; spawn argument array for explicit Git; `shell: false` |
| Secret leakage in errors | Static domain messages and existing redaction |
| Cross-install cancellation | UUID-keyed controller map and exact lookup |

### 15.2 Trust boundary

An archive obtained from GitHub is untrusted input. GitHub transport success does
not imply plugin safety or publisher approval. The archive receives exactly the
same manifest validation, component validation, permission extraction, staging,
and persistence treatment as a local ZIP.

### 15.3 Logging

Allowed structured fields:

- source kind;
- canonical host;
- operation outcome code;
- elapsed duration bucket;
- byte-size bucket;
- redirect count; and
- whether a ref was supplied.

Disallowed fields:

- raw URLs with query strings;
- headers;
- tokens;
- local temp paths;
- Git stderr; and
- repository/ref values in analytics unless explicitly approved by privacy
  review.

## 16. Reliability and Cleanup

### 16.1 Cleanup ownership

Each layer owns what it creates:

| Layer | Resource | Cleanup point |
|---|---|---|
| HTTP service | `.part` output | Any transport failure/abort |
| GitHub fetcher | temp directory and downloaded ZIP | Acquisition failure or returned `cleanup()` |
| Local ZIP fetcher | extraction directory | Returned `cleanup()` |
| Install service | acquired source | Existing `finally` block |
| IPC handler | abort controller map entry | Handler `finally` block |

Cleanup errors are logged safely and do not replace the primary domain failure.

### 16.2 Retry policy

There is no automatic retry in version 1. Automatic retries can multiply
unauthenticated rate-limit usage and may conceal persistent redirect or access
problems. The UI offers an explicit Retry action for recoverable errors.

The immutable SHA prevents a manual retry from changing content after resolution
within one attempt. A new user retry performs a new resolution, which is expected
for a moving branch.

### 16.3 Process shutdown

On app shutdown, active network requests are destroyed by process termination and
temporary files remain under the existing plugin staging/temp root. Existing
startup stale-temp cleanup should remove them. If no such cleanup covers the new
directory prefix, implementation must add a bounded startup sweep for only that
explicit prefix; it must never recursively delete a broad system temp directory.

## 17. Feature Flag and Rollout

### 17.1 Flag

Add a main-process-only flag reader to `src/config/featureFlags.ts`, following
the existing live Token-store feature flag pattern:

```text
github_archive_install_enabled
```

The feature is enabled unless the main-process Token store contains the exact
value `"false"`. A Token-store read failure also leaves the feature enabled;
installation safety still comes from the archive controls, while a corrupt
settings store should not unexpectedly restore the native-Git dependency. Test
helpers set and restore the explicit value rather than caching it. After two
stable releases with no material archive-install regression, remove the flag
and make archive behavior unconditional.

The flag is evaluated when an install starts, following the existing
`isBrowserProfileImportEnabled()` live-read pattern. It is not stored in SQLite
and is not renderer-controlled.

### 17.2 Disabled behavior

When disabled, GitHub repository URLs retain the previous native-Git behavior so
the release can be rolled back without changing stored plugin records. Release
asset URLs continue their existing archive behavior. The UI's no-Git helper is
shown only when `PLUGIN_GET_INSTALL_CAPABILITIES` reports the feature enabled; it
must not promise behavior that the main process has disabled.

### 17.3 Rollout stages

1. **Service-only:** enable in CI and internal builds; exercise unit/integration
   tests with Git deliberately absent.
2. **UI-enabled beta:** ship helper text, cancellation, typed errors, capability
   discovery, and provenance inspection to a beta cohort/build.
3. **Default enabled:** enable for public builds after Windows, macOS, and Linux
   packaged smoke tests.
4. **Flag removal:** remove compatibility fallback after two stable releases.

Rollback sets the local support flag to `"false"` (or ships that default in a
patch). Existing archive-installed plugins continue to load because their stored
provenance needs no runtime Git.

## 18. Test Strategy

All HTTP tests use injected request doubles or a loopback HTTPS fixture. Unit and
CI tests must not depend on live GitHub or its rate limit.

### 18.1 `PluginHttpDownloadService` tests

Add `test/vitest/utilitycode/pluginHttpDownloadService.test.ts`:

- streams a successful bounded ZIP to the destination;
- rejects declared `Content-Length` over limit;
- rejects a chunked body when accumulated bytes exceed limit;
- preserves one timeout across redirects;
- aborts before request, during redirect, and during stream;
- removes `.part` output after every failure;
- rejects HTTP downgrade;
- rejects credentials and non-default ports in redirect URLs;
- rejects absent `Location`, redirect loops, and more than five hops;
- applies exact caller host policy;
- strips sensitive headers on cross-origin redirect; and
- settles once when abort and stream error race.

### 18.2 `GitHubArchiveClient` tests

Add `test/vitest/utilitycode/githubArchiveClient.test.ts`:

- explicit branch resolves to full SHA;
- branch containing `/` is safely encoded;
- tag, abbreviated SHA, and full SHA resolve;
- omitted ref resolves the first default-branch commit;
- empty default-branch result is `github-ref-not-found`;
- malformed or oversized metadata is rejected safely;
- archive request uses full SHA, not requested ref;
- no `Authorization` or cookie header is sent;
- `403` with exhausted quota maps to `github-rate-limited`;
- ordinary `403` maps to inaccessible repository;
- explicit-ref `404` plus a successful repository probe maps to
  `github-ref-not-found`;
- explicit-ref `404` plus inaccessible repository probe maps to repository
  unavailable;
- default-head `404` maps to repository unavailable;
- `429`, `5xx`, timeout, abort, and redirect rejection map correctly; and
- response bodies and query strings do not appear in errors.

### 18.3 `GitHubPluginFetcher` tests

Extend `test/vitest/utilitycode/githubPluginFetcher.test.ts`:

- repository URL uses archive client and never Git fetcher;
- trailing `.git` also uses archive client;
- exact supported release URLs remain classified;
- case, slash, credentials, port, query, fragment, and extra-path cases;
- `tree/` and `commit/` return correction guidance;
- resolved SHA and canonical URL are returned as acquisition provenance;
- ZIP delegates to `LocalZipPluginFetcher`;
- wrapped GitHub archive root resolves correctly through existing services;
- abort and every failure delete the temporary directory; and
- archive size limit is forwarded from `PLUGIN_PACKAGE_LIMITS`.

### 18.4 Dispatcher tests

Extend `test/vitest/utilitycode/urlPluginFetcher.test.ts`:

- GitHub repository without `.git` selects GitHub;
- GitHub repository with `.git` selects GitHub before generic Git;
- non-GitHub `.git` still selects Git;
- generic ZIP uses the shared downloader; and
- unsupported protocols/redirects remain rejected.

### 18.5 Install-service tests

Extend `test/vitest/utilitycode/pluginInstallService.test.ts`:

- acquisition provenance reaches import/persistence;
- canonical fetcher URI overrides raw request URI;
- resolved SHA cannot be overwritten by request `sourceMeta`;
- cleanup runs after success, validation failure, import failure, cancellation,
  and unexpected exception;
- source kind remains the validated request kind; and
- unexpected errors remain redacted.

### 18.6 Git fetcher tests

Extend `test/vitest/utilitycode/gitPluginFetcher.test.ts`:

- spawn `ENOENT` returns `git-not-installed`;
- non-`ENOENT` spawn error remains generic;
- non-zero exit remains safe;
- timeout is distinguishable; and
- arguments remain an array with `shell: false`.

### 18.7 IPC tests

Extend `test/vitest/main/plugin-ipc.test.ts`:

- strict install schema accepts each valid source request;
- unknown fields, CR/LF, invalid UUID, and missing kind fields are rejected;
- expected domain failure returns outer success with inner typed failure;
- capability promotion and broadcast happen only on install success;
- duplicate operation ID is rejected;
- cancel aborts only the matching operation;
- repeated/unknown cancellation is harmless;
- capability query reflects the main-process feature flag;
- controller entries are removed on all settle paths; and
- no database repository is accessed directly.

### 18.8 Component tests

Create
`test/vitest/main/components/PluginInstallSourceDialog.test.ts`:

- GitHub source shows the no-Git/no-token helper;
- Git source shows the local Git requirement;
- Ref is optional and forwarded correctly;
- Install disables inputs and shows working state;
- Cancel invokes cancellation with the active operation ID;
- each new stable error code selects the correct localized message;
- user cancellation does not show a failure alert;
- success emits `imported` and closes; and
- unmounted/closed component ignores a late result.

Update all six locale files in the same commit as the UI and its tests.

### 18.9 Existing security regressions

Retain and run existing archive tests for:

- ZIP Slip paths;
- absolute Windows/POSIX paths;
- symlink/device entries;
- compressed and extracted byte limits;
- file-count limits;
- manifest missing/invalid;
- one-wrapper-directory layout; and
- staging rollback.

### 18.10 Verification commands

At minimum:

```bash
yarn test:components
yarn testmain
yarn test
yarn vue-check
yarn build
```

Also run the project-specific Vitest configuration that owns
`test/vitest/utilitycode/` if it is not included by `yarn testmain`. Packaged
smoke tests must run on Windows, macOS, and Linux with `git` removed from `PATH`.

## 19. Observability and Success Measurement

If existing privacy-approved telemetry supports plugin installs, record only:

```typescript
interface GitHubPluginInstallMetric {
  readonly sourceKind: "github";
  readonly outcomeCode: PluginErrorCode | "success";
  readonly usedRef: boolean;
  readonly durationBucket: string;
  readonly archiveSizeBucket?: string;
  readonly redirectCount?: number;
}
```

Do not record owner, repository, ref, SHA, full URL, IP address, or headers.

Operational review should compare:

- GitHub source success rate;
- missing-Git failures before and after rollout;
- rate-limit failure rate;
- timeout and rejected-redirect rate;
- validation failure rate; and
- cancellation cleanup failures.

Metrics are optional if no compliant telemetry path already exists. Logging is
not a prerequisite for the feature.

## 20. File-by-File Implementation Plan

### Phase A — contracts and transport

| File | Change |
|---|---|
| `src/entityTypes/pluginTypes.ts` | Add stable error codes and renderer-safe result types |
| `src/service/pluginSources/pluginSourceTypes.ts` | Add abort signal and acquisition provenance |
| `src/service/pluginSources/PluginHttpDownloadService.ts` | Add bounded HTTPS/redirect transport |
| `test/vitest/utilitycode/pluginHttpDownloadService.test.ts` | Add transport security and cleanup tests |

### Phase B — GitHub acquisition

| File | Change |
|---|---|
| `src/service/pluginSources/GitHubArchiveClient.ts` | Resolve refs and download SHA archive |
| `src/service/pluginSources/GitHubPluginFetcher.ts` | Replace repository Git delegation |
| `src/service/pluginSources/UrlPluginFetcher.ts` | Change precedence and use shared HTTP service |
| `src/service/PluginInstallService.ts` | Compose shared dependencies and merge trusted provenance |
| Related utility tests | Add classification, API mapping, provenance, and cleanup coverage |

### Phase C — explicit Git diagnostics and IPC

| File | Change |
|---|---|
| `src/service/pluginSources/GitPluginFetcher.ts` | Preserve spawn failure reason and map `ENOENT` |
| `src/config/channellist.ts` | Add cancellation and capability-query channels |
| `src/config/featureFlags.ts` | Add live main-process archive-install flag |
| `src/main-process/communication/plugin-ipc.ts` | Strict schema, operation map, typed result, cancellation, capabilities |
| `src/preload.ts` or existing channel allowlist | Expose only the new fixed channel if required |
| Related Git and IPC tests | Cover missing Git, domain result, and cancellation |

### Phase D — renderer and documentation

| File | Change |
|---|---|
| `src/views/api/plugins.ts` | Return typed install result and expose cancel API |
| `src/views/components/plugins/PluginInstallSourceDialog.vue` | Helpers, typed errors, capability-aware working/cancel state |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add all user-facing translations |
| `test/vitest/main/components/PluginInstallSourceDialog.test.ts` | Required component coverage |
| `docs/skill-installation-operations.md` | Explain no-token public GitHub flow and limitations |

Each phase is a complete logical unit and should be staged by specific file and
committed using the repository's conventional commit policy. UI, translations,
and UI tests ship together.

## 21. Compatibility

- Existing installed plugins need no migration.
- Local folder, local ZIP, npm, and explicit Git source contracts remain
  supported.
- Generic non-GitHub `.git` URLs retain Git behavior.
- GitHub release ZIP behavior remains supported but gains shared transport
  controls.
- A GitHub repository containing submodule pointers or Git LFS pointer files is
  installed exactly as represented by GitHub's source archive. AiFetchly does not
  fetch referenced submodule repositories or LFS objects.
- The resolved wrapper directory name is not persisted and must not be treated as
  plugin identity.

## 22. Alternatives Considered

### 22.1 Bundle Git with AiFetchly

Rejected. It increases package size, patching responsibility, platform-specific
signing complexity, and attack surface for a capability public GitHub archives
do not require.

### 22.2 Automatically install Git

Rejected. It requires elevated/system changes, package-manager variation, and
user consent outside plugin installation scope.

### 22.3 Download the moving branch archive directly

Rejected. It saves one metadata request but cannot reliably persist the exact
commit from trusted response metadata and weakens reproducibility.

### 22.4 Parse the commit from the ZIP wrapper directory

Rejected. Wrapper naming is transport presentation, not a stable or sufficiently
trusted API contract for provenance.

### 22.5 Retry through Git after archive failure

Rejected. It reintroduces the hidden system dependency and changes access and
credential behavior without user consent.

### 22.6 Use the system `curl` or `wget`

Rejected. That replaces one missing executable dependency with another and makes
redirect, header, byte-limit, and cancellation behavior less portable.

### 22.7 Add a third-party HTTP client

Not required. Node HTTPS supports the needed bounded streaming behavior, and the
project already uses it. A shared service corrects current duplication without a
new dependency.

### 22.8 Add `reason` under `install-io-failed`

Rejected. Dedicated union members give exhaustive UI handling and stable test and
telemetry dimensions without parsing nested optional values.

## 23. Resolved PRD Open Questions

| Question | Decision |
|---|---|
| Metadata first or archive default? | Resolve metadata first, then download by immutable SHA. |
| Shared downloader? | Yes, GitHub and generic ZIP acquisition share one hardened service. |
| Redirect hosts? | Exact source-specific allowlists defined in section 8.4. |
| Cancellation? | Renderer operation UUID maps to a main-process `AbortController`. |
| Error shape? | Add dedicated `PluginErrorCode` members and return a typed domain result. |
| Feature flag? | Live main-process Token-store flag, removed after two stable releases. |
| `tree/` and `commit/` URLs? | Reject in v1 with repository-URL plus Ref-field guidance. |
| Reliable resolved SHA? | Use one commit lookup API request; do not infer it from an archive. |

## 24. Acceptance Traceability

| PRD requirement group | Technical sections |
|---|---|
| No Git for GitHub repository URLs | 5, 6, 7, 10 |
| Public API without token | 7.1–7.2, 7.4–7.6, 9.3 |
| Default/specific ref and immutable provenance | 7.3–7.7, 10.2–10.3, 14 |
| Safe download and extraction | 8, 15, 16 |
| Actionable errors | 9.2, 11, 12, 13.3 |
| Explicit Git behavior | 10, 11.3, 13.1 |
| Cancellation and cleanup | 5.3, 8.3, 12.3–12.4, 16 |
| UI/i18n/accessibility | 13, 18.8 |
| Rollout and rollback | 17 |
| Cross-platform and automated validation | 18 |

## 25. Definition of Done

- GitHub repository installation completes on packaged Windows, macOS, and Linux
  builds with no `git` executable available.
- Public repository requests contain no authentication material.
- Requested refs resolve to full SHAs and archives are downloaded by those SHAs.
- Canonical URL, requested ref, and resolved SHA persist successfully.
- Generic URL and release asset downloads use the shared bounded transport.
- Every redirect is HTTPS and source-allowlisted.
- Cancellation, timeouts, oversize responses, and all failure paths remove
  temporary artifacts.
- Expected errors retain stable codes through the renderer API.
- Explicit Git missing from `PATH` produces `git-not-installed` and does not
  trigger automatic software installation.
- Existing archive security and plugin import tests continue to pass.
- New service, dispatcher, IPC, and component tests pass.
- All six supported locale files contain the new copy.
- Rollback through the feature flag is verified before public enablement.
- User documentation states clearly: public GitHub archives require no token;
  private repositories are not supported in version 1.
