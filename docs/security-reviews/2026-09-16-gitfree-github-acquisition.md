# Security Review — Git-free GitHub Plugin Acquisition

- **Date:** 2026-09-16
- **Scope:** GitHub archive/asset + generic-ZIP plugin acquisition path
  (`src/service/pluginSources/*`, `src/service/PluginInstallService.ts`,
  `src/main-process/communication/plugin-ipc.ts` install handler)
- **Requirement source:** git-free GitHub plugin installation PRD §17 and
  §28 ("security review confirms safe redirects, bounded streaming,
  archive safety, cleanup, and redaction"); technical design §8, §15, §16.
- **Reviewer:** code review pass recorded on branch
  `worktree-natural-language-skill-installation` (review log commit
  `88fb9522` + the GF Phase D transport consolidation that followed it).
- **Result:** **PASS — no open findings.** One resource-leak finding from
  the pre-landing review (temp-dir leak on archive failure paths) was
  fixed and regression-tested in commit `88fb9522`; the same ownership
  contract was then extended to the release-asset and generic-ZIP paths.

## Controls verified

### 1. HTTPS-only, allowlisted redirects (design §8.4)

- The single transport (`PluginHttpDownloadService`) rejects any redirect
  that is not HTTPS, carries userinfo, uses a non-default port, contains
  CR/LF, loops, or exceeds five hops — independent of the caller policy.
- Per-source host allowlists are named exported constants
  (`src/service/pluginSources/GitHubArchiveClient.ts`):
  - GitHub API metadata → `api.github.com` only.
  - Repository zipball → `api.github.com`, `codeload.github.com`.
  - Release assets → `github.com`, `release-assets.githubusercontent.com`,
    `objects.githubusercontent.com`.
  - Generic ZIP (`UrlPluginFetcher`) → the original exact host only;
    cross-host redirects are rejected, never followed.
- Evidence: `test/vitest/utilitycode/pluginHttpDownloadService.test.ts`
  (redirect suite), `githubPluginFetcher.test.ts` (asset allowlist chain +
  non-allowlisted host rejection), `urlPluginFetcher.test.ts` (cross-host
  rejection).

### 2. Bounded streaming (design §8.3/§8.6)

- One overall deadline spans the redirect chain and stream; timeouts
  destroy the request and remove the partial file.
- `Content-Length` is pre-rejected when trustworthy and over-limit;
  received bytes are counted regardless, and the stream aborts above
  `PLUGIN_PACKAGE_LIMITS.maxZipBytes`. No unbounded buffer exists for
  archive data (metadata reads are capped at 1 MiB via `getBuffer`).
- Downloads stream to an exclusive `<dest>.part` (O_EXCL) renamed only
  after a complete response — no partial archive is ever extracted.
- All GitHub, release-asset, and generic-ZIP downloads ride this one
  transport since the GF Phase D consolidation; no parallel download
  implementation remains (`PluginInstallService.defaultRegistry` composes
  a single shared instance).

### 3. Archive safety (design §15)

- Zip entries are rejected for absolute paths, `..` traversal, and device
  file names (`PluginArchiveService.isUnsafeEntryName`), plus symlink
  entries, file-count, and extracted-size ceilings.
- The GitHub-generated `{repo}-{sha}/` wrapper is unwrapped only by the
  reviewed `resolvePluginRoot`; plugin identity always comes from the
  manifest, never the attacker-controlled wrapper name (regression:
  `githubPluginFetcher.test.ts` GF-7 case).

### 4. Temp-dir cleanup (design §16.1, FR-12)

- Archive and release-asset acquisition use an explicit ownership
  handoff: the returned `cleanup()` owns the temp dir on success; a
  `finally` removes it on every other terminal path (typed failure,
  exception, abort). The generic-ZIP path follows the same contract.
- Regression tests observe creation/removal through the
  `createTempDir` seam (no production test hooks).

### 5. No credential surface; provenance redaction (design §9.3, §14)

- v1 sends no tokens, cookies, or credentials to GitHub. Sensitive
  header names (`authorization`, `cookie`, `proxy-authorization`) are
  stripped automatically whenever a redirect changes origin, so the
  transport is safe for any future authenticated caller.
- Stored provenance (`sourceKind`, canonical `sourceUri`, `sourceRef`,
  `sourceMeta.{acquisition, resolvedCommitSha, repositoryHost}`) is
  generated main-process-side and takes precedence over renderer-supplied
  values; the persistence test proves a spoofed renderer
  `resolvedCommitSha` never reaches the DB row and that no `token=` /
  `sig=` material is stored
  (`test/vitest/utilitycode/pluginInstallProvenance.test.ts`).
- Fetcher error messages pass through `redactErrors`
  (`_authToken`, `Authorization: Bearer`, query-string values stripped)
  before crossing the IPC boundary (`pluginSourceRedact.test.ts`).
- The IPC install input is a strict zod schema (UUID `operationId`, bounded
  strings, control-character/CRLF rejection), and installer secrets are
  unaffected — they travel only via `SKILL_INSTALL_SUBMIT_SECRET` with
  `rejectSecretShaped` blocking credential-shaped values in ordinary args
  (natural-language installer contract, unchanged by this feature).

### 6. Cancellation and concurrency

- `operationId`-keyed `AbortController`s cancel an in-flight acquisition;
  aborts settle the transport exactly once and remove partial files.
- 404-mapping never leaks whether a repository is private vs. missing —
  both surface as `github-repository-unavailable` (design §9.2), and the
  explicit-ref probe is bounded to one request.

## Findings

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| SR-1 | CRITICAL (pre-landing review) | `acquireRepoViaArchive` leaked the download temp dir on failure paths | Fixed in `88fb9522` (ownership handoff + `finally`), regression test added; contract extended to asset/URL paths |
| — | — | No other findings | — |

## Re-review triggers

Re-run this review if: redirect allowlists change, any download path stops
using `PluginHttpDownloadService`, authentication is added to GitHub
requests, or archive extraction limits change.
