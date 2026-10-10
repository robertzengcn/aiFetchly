# Git-Free GitHub Plugin Installation - Product Requirements Document

## Document Information

- **Version:** 1.0
- **Status:** Proposed
- **Created:** 2026-09-08
- **Owner:** AiFetchly Desktop Engineering
- **Target platforms:** Windows, macOS, Linux
- **Primary surface:** Plugin Manager > Install Plugin from Source > GitHub
- **Related implementation:**
  - `src/service/pluginSources/GitHubPluginFetcher.ts`
  - `src/service/pluginSources/GitPluginFetcher.ts`
  - `src/service/pluginSources/LocalZipPluginFetcher.ts`
  - `src/service/PluginArchiveService.ts`
  - `src/service/PluginInstallService.ts`
  - `src/service/PluginImportService.ts`
  - `src/views/components/plugins/PluginInstallSourceDialog.vue`
  - `src/main-process/communication/plugin-ipc.ts`
- **Related product documents:**
  - `docs/superpowers/specs/2026-06-18-plugin-multi-source-install-design.md`
  - `docs/prd/plugin-marketplace-support-prd.md`
  - `docs/prd/natural-language-skill-installation-prd.md`
- **External references:**
  - [GitHub source code archives](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)
  - [GitHub REST API: download a repository archive](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip)

## 1. Executive Summary

AiFetchly currently presents **GitHub** as a plugin source, but installing a normal GitHub repository secretly depends on the `git` executable. `GitHubPluginFetcher` converts `https://github.com/owner/repo` into a `.git` URL and delegates to `GitPluginFetcher`, which runs `git clone`. Users whose computers do not have Git installed receive a generic clone failure even though GitHub can provide the same source snapshot as a ZIP over HTTPS.

This PRD changes the GitHub source into a dependency-free installation path:

- A public GitHub repository installs through a GitHub-generated ZIP archive.
- The user does not need Git, a GitHub account, an access token, or administrator rights.
- An optional branch, tag, or commit selects the source revision.
- The downloaded ZIP uses AiFetchly's existing bounded and path-safe archive extraction pipeline.
- Native Git remains available under the separate **Git** source for SSH, non-GitHub repositories, and advanced workflows.
- Missing Git on the native Git path produces a specific, recoverable error with useful alternatives.
- Private GitHub repository support is explicitly deferred from the first release, while the data and service contracts remain compatible with a later authenticated archive flow.

The product outcome is simple: when a user pastes a public GitHub plugin URL, installation works on a clean AiFetchly-supported computer without requiring the user to install developer tooling.

## 2. Background and Current Behavior

### 2.1 Existing source choices

The Plugin Manager currently supports these source kinds:

- Local ZIP
- Local folder
- Git
- GitHub
- npm
- URL

This separation implies that **GitHub** is a hosted-source integration and **Git** is the native version-control integration. The implementation does not currently preserve that distinction.

### 2.2 Current GitHub repository flow

For a repository URL, the current flow is:

```text
User enters https://github.com/owner/repo
  -> GitHubPluginFetcher classifies it as a repository
  -> URL becomes https://github.com/owner/repo.git
  -> GitPluginFetcher starts `git clone --depth 1 ...`
  -> installation fails if `git` is absent or unavailable in Electron's PATH
```

The failure is especially common for non-developer users and clean Windows installations. A user may also have Git installed in an interactive shell while the packaged Electron process cannot locate it, which produces the same product failure.

### 2.3 Existing capabilities that should be reused

AiFetchly already has most of the required pipeline:

- `GitHubPluginFetcher` downloads GitHub release ZIP assets with redirect, timeout, and compressed-size controls.
- `LocalZipPluginFetcher` delegates extraction to `PluginArchiveService`.
- `PluginArchiveService` rejects path traversal, absolute paths, symlinks, Windows device filenames, too many files, oversized compressed packages, and oversized extracted packages.
- `PluginManifestService.resolvePluginRoot` unwraps one generated top-level archive directory.
- `PluginImportService.installFromLocalRoot` performs manifest validation, component validation, copying, persistence, rollback, and activation.
- `InstalledPluginEntity` already stores source kind, source URI, requested ref, and non-secret source metadata.

This feature should extend the source-acquisition step rather than create a second installation pipeline.

## 3. Problem Statement

### 3.1 User problem

A user who sees a **GitHub** option reasonably expects to paste a GitHub address and install the plugin. Instead, the operation can fail because of a developer dependency that the UI never disclosed.

The current recovery path is poor:

- The error does not distinguish missing Git from a bad repository, invalid ref, authentication failure, timeout, or network failure.
- The user is not told that a public repository can be downloaded without Git.
- Installing Git may require leaving AiFetchly, selecting an OS-specific installer, approving administrator access, and restarting the app.
- Automatically installing Git would add substantial platform, privilege, security, packaging, and maintenance responsibilities to AiFetchly.

### 3.2 Product problem

The current behavior makes a hosted public artifact depend on local developer tooling. That conflicts with AiFetchly's desktop-product audience and makes success vary by machine configuration rather than by the plugin source itself.

### 3.3 Root cause

The GitHub source is implemented as a convenience wrapper around the Git source. It is not implemented as a first-class GitHub archive acquisition path.

## 4. Product Principles

### 4.1 GitHub means no hidden Git dependency

The GitHub source must work for supported public GitHub URLs using built-in HTTPS capabilities. Native Git may be offered as an explicit alternative, but it must not be required silently.

### 4.2 Do not install system software automatically

AiFetchly must not download or install Git as part of plugin installation. System package installation is platform-specific, often privileged, and unnecessary for the primary public GitHub flow.

### 4.3 One validation pipeline for every source

An archive acquired from GitHub must pass through the same extraction, manifest validation, component validation, size enforcement, rollback, persistence, and activation behavior as a local ZIP.

### 4.4 Authentication is least-privilege and explicit

Public repository installation must not request a token. Future private repository support must request read-only repository contents access and must never place credentials in a URL, command line, log, diagnostic bundle, provenance field, or renderer error.

### 4.5 Errors tell the user what to do next

Each expected failure must map to a stable error category and at least one valid recovery action. “Git clone failed” is not an acceptable error for a missing executable or a GitHub archive request.

### 4.6 Reproducibility requires immutable provenance

A branch or tag can move. The installer should preserve what the user requested and, where GitHub exposes it, the resolved commit SHA that supplied the installed bytes.

## 5. Goals

1. Install a valid plugin from a public `github.com/owner/repo` URL without Git installed.
2. Support the repository default branch when the user leaves the ref field empty.
3. Support an explicit branch, tag, or full commit SHA.
4. Reuse the existing secure ZIP extraction and plugin import pipeline.
5. Preserve source provenance without storing secrets.
6. Provide deterministic cleanup after success, validation failure, download failure, timeout, cancellation, or application shutdown.
7. Keep the existing Git source working for advanced users.
8. Detect missing Git precisely when the user explicitly selects the Git source.
9. Provide complete English, Chinese, Spanish, French, German, and Japanese UI text.
10. Add component, service, archive, IPC, and regression tests for the new behavior.
11. Maintain compatibility with plugins installed from local folders, local ZIPs, Git, npm, URL, release assets, and marketplaces.

## 6. Non-Goals

The first release will not:

1. Automatically install Git or another system package manager.
2. Provide private GitHub repository authentication.
3. Add GitHub OAuth login or long-term GitHub token storage.
4. Clone Git history, tags, branches, or Git metadata for a GitHub source.
5. Initialize or update Git submodules.
6. Guarantee Git LFS object inclusion when the repository owner has not configured GitHub archives to include them.
7. Replace the existing native Git source.
8. Add automatic plugin updates or background update polling.
9. Add repository browsing, organization discovery, or GitHub search.
10. Support arbitrary GitHub Enterprise Server hosts under the `github` source in v1.
11. Execute plugin code, install plugin dependencies, or run setup scripts during source acquisition.

## 7. Target Users

### 7.1 Non-technical plugin user

This user receives a GitHub link from a plugin author and expects installation to work without understanding Git, branches, PATH configuration, or access tokens.

### 7.2 Windows desktop user

This user may not have Git installed and may not have administrator rights. The user expects the same installation result as a macOS or Linux user.

### 7.3 Power user

This user may intentionally choose the Git source for SSH authentication, non-GitHub hosting, or a repository workflow. The user needs an accurate missing-Git message rather than an opaque clone failure.

### 7.4 Security-conscious administrator

This user needs bounded downloads, safe extraction, immutable provenance, no automatic system changes, no credential leakage, and actionable audit information.

### 7.5 Plugin author

This user publishes a repository containing a supported plugin manifest and expects consumers to install it without documenting Git as a prerequisite.

## 8. Definitions

| Term | Definition |
|---|---|
| GitHub source | The `github` plugin source kind selected in the install dialog or inferred from an eligible `github.com` URL. |
| Git source | The `git` plugin source kind that invokes the system Git executable. |
| Repository archive | A ZIP snapshot generated by GitHub for a branch, tag, or commit. It contains source files but not complete Git history. |
| Requested ref | The optional branch, tag, or commit entered by the user. |
| Resolved revision | The immutable commit SHA associated with the downloaded source when it can be determined safely. |
| Release asset | A file explicitly uploaded to a GitHub Release, such as `plugin.zip`. |
| Source archive | A GitHub-generated ZIP snapshot of repository content. |
| Public repository | A repository whose archive endpoint can be accessed without authentication. |
| Private repository | A repository whose content requires authenticated GitHub access. |

## 9. Scope and Release Strategy

### 9.1 Version 1: public GitHub archives

Version 1 includes:

- Public repository ZIP acquisition without authentication.
- Default branch and explicit ref support.
- Existing release asset support.
- Existing latest-release `plugin.zip` convention support.
- Clear handling for not found, inaccessible, invalid ref, rate-limited, timeout, oversized, malformed, and invalid-plugin responses.
- Exact missing-Git detection for the separate Git source.
- Provenance recording, including resolved revision when available.
- UI copy and tests in all supported languages.

### 9.2 Future version: private GitHub archives

A later release may add:

- GitHub OAuth device authorization or a one-time fine-grained personal access token.
- Read-only Contents permission validation.
- Secure credential storage or one-use credential handling.
- Authenticated GitHub API requests for private repository archives.
- Token-expiry, authorization-revocation, and organization-policy recovery flows.

The v1 source request and provenance format must not prevent this extension.

## 10. Primary User Stories

### US-01: Install a public repository without Git

As a user without Git installed, I want to paste a public GitHub repository URL so that I can install a plugin without setting up developer tools.

### US-02: Install the repository default branch

As a user who does not know the repository's branch name, I want to leave the ref field empty so that AiFetchly installs the repository's default branch.

### US-03: Install a specific revision

As a user following a plugin author's instructions, I want to enter a branch, tag, or commit so that AiFetchly installs the intended source revision.

### US-04: Understand an inaccessible repository

As a user who enters a private, deleted, renamed, or mistyped repository URL, I want an accurate message that does not falsely claim the repository is private and gives me valid next steps.

### US-05: Use native Git deliberately

As a power user, I want the Git source to keep supporting HTTPS and SSH repository URLs and to tell me specifically when Git is missing.

### US-06: Verify what was installed

As an administrator, I want the installed plugin record to preserve its GitHub URL, requested ref, and resolved revision without credentials so that I can diagnose and reproduce the installation.

## 11. User Experience Requirements

### 11.1 Install dialog

When **GitHub** is selected, the dialog must show:

- Field label: **GitHub repository or release URL**
- URL example: `https://github.com/owner/repo`
- Ref label: **Branch, tag, or commit (optional)**
- Helper text: **Public repositories install without Git. Leave the revision empty to use the repository's default branch.**

The UI must not request a token for a public repository.

### 11.2 Install progress

The install action must prevent duplicate submission while active. If progress events are available, the UI should present these product states:

1. Connecting to GitHub
2. Downloading repository archive
3. Validating archive
4. Validating plugin
5. Installing plugin
6. Plugin installed

If byte-level progress is unavailable, an indeterminate progress indicator is acceptable. The state text must still identify the current stage.

### 11.3 Success state

On success:

- The dialog closes using the existing successful install behavior.
- The Plugin Manager refreshes.
- Plugin commands, skills, agents, hooks, and MCP capabilities are promoted using the existing post-install flow.
- The plugin detail surface identifies the source as GitHub.
- If provenance is displayed, it may show the requested ref and shortened resolved commit SHA.

### 11.4 Error and recovery states

| Condition | User-facing message intent | Recovery actions |
|---|---|---|
| Repository cannot be found or accessed | “Repository not found or access is required.” | Check URL; use a public repo; import a ZIP; use Git with configured credentials. |
| Ref does not exist | “Branch, tag, or commit was not found.” | Correct the ref; leave it empty for the default branch. |
| GitHub request is rate-limited | “GitHub temporarily limited archive requests.” | Retry later; import a downloaded ZIP; optionally use Git. |
| Network unavailable | “Could not connect to GitHub.” | Check connection and retry. |
| Request times out | “GitHub download timed out.” | Retry; verify network/proxy; import ZIP. |
| Archive exceeds limits | “Repository archive is too large to install safely.” | Use a smaller plugin package or release asset. |
| Invalid/corrupt ZIP | “GitHub returned an invalid or unreadable archive.” | Retry; use a release asset; contact plugin author. |
| Manifest missing | Existing manifest-not-found behavior. | Select the correct plugin repository or release. |
| Multiple wrapper directories prevent root discovery | Existing manifest-not-found behavior with archive-layout guidance. | Package a supported manifest at the repository root or a single wrapper root. |
| Git source selected and Git is absent | “Git is not installed or cannot be found.” | Use GitHub source; import ZIP; install Git and restart AiFetchly. |

Errors must not include response bodies, signed redirect query strings, authorization headers, tokens, userinfo, local temporary paths, or unredacted source URLs containing credentials.

### 11.5 Accessibility

- Helper and error text must be associated with the relevant input.
- Progress changes must be announced through an accessible live region or Vuetify equivalent.
- Keyboard users must be able to select the source, enter the URL/ref, submit, cancel, and return to the invalid field.
- Error meaning must not depend on color alone.

### 11.6 Internationalization

Every new or changed user-facing string must be added to:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

English fallback text must remain present in the Vue component according to project convention.

## 12. Functional Requirements

### 12.1 Requirements catalog

| ID | Requirement | Priority | Acceptance evidence |
|---|---|---:|---|
| FR-01 | A public `https://github.com/{owner}/{repo}` URL installs without invoking the Git executable. | P0 | Fetcher test proves Git dependency is never called; integration test runs with Git unavailable. |
| FR-02 | A trailing `.git` on an HTTPS GitHub URL entered under the GitHub source is normalized and installed through the archive path. | P0 | URL-classification and acquisition tests. |
| FR-03 | An empty ref installs the repository default branch. | P0 | Mocked GitHub response and integration fixture. |
| FR-04 | An explicit branch, tag, or commit is passed as the requested archive revision. | P0 | Request-construction tests for all three forms. |
| FR-05 | Release asset URLs continue to download and install through the ZIP pipeline. | P0 | Existing behavior plus regression tests. |
| FR-06 | `releases/latest` continues to support the existing `plugin.zip` convention. | P1 | Redirect/download regression test. |
| FR-07 | The GitHub source follows a bounded number of HTTPS redirects. | P0 | Redirect success, overflow, downgrade, and loop tests. |
| FR-08 | Archive downloads enforce timeout and compressed-byte limits during streaming, before extraction. | P0 | Timeout and over-limit stream tests. |
| FR-09 | Downloaded archives use `LocalZipPluginFetcher` and `PluginArchiveService`; no parallel extractor is introduced. | P0 | Dependency-injection assertion and archive regression suite. |
| FR-10 | GitHub's generated single root directory is unwrapped by the existing plugin-root resolution behavior. | P0 | Archive fixture with `{repo}-{sha}/plugin.json`. |
| FR-11 | Acquisition does not execute plugin code, package scripts, hooks, Git commands, or dependency installers. | P0 | Spawn spy and no-execution security tests. |
| FR-12 | Temporary archive and extraction directories are cleaned after every terminal outcome. | P0 | Success/failure/timeout/cancel cleanup tests. |
| FR-13 | Source provenance records `sourceKind`, normalized source URL, requested ref, and resolved revision when available. | P0 | Persistence integration test. |
| FR-14 | Source provenance never records credentials or temporary signed URLs. | P0 | Redaction and persisted-row assertions. |
| FR-15 | Expected GitHub HTTP failures map to typed plugin errors rather than raw transport exceptions. | P0 | HTTP status matrix tests. |
| FR-16 | Selecting the native Git source still uses `GitPluginFetcher`. | P0 | Git source regression tests. |
| FR-17 | A missing Git executable maps to a specific recoverable error and not a generic clone failure. | P0 | Spawn `ENOENT` test and component assertion. |
| FR-18 | Manual plugin installation remains available regardless of the AI-enabled setting because this flow does not call an AI API. | P0 | IPC test with AI disabled. |
| FR-19 | Installation remains atomic: failure leaves no installed-plugin row, copied install directory, or promoted capabilities. | P0 | rollback integration tests. |
| FR-20 | Existing overwrite/name-conflict behavior applies unchanged. | P0 | overwrite regression tests. |
| FR-21 | URL source auto-detection routes eligible GitHub URLs to the same Git-free GitHub acquisition path. | P0 | `UrlPluginFetcher` delegation test. |
| FR-22 | Public GitHub installation sends no authorization header by default. | P0 | HTTP client request assertion. |
| FR-23 | A 404 response is described as “not found or requires access,” not definitively as a private repository. | P0 | error-mapping and UI copy tests. |
| FR-24 | GitHub API rate-limit responses expose retry guidance without leaking response headers that may contain sensitive infrastructure data. | P1 | rate-limit response test. |
| FR-25 | The install dialog communicates that public GitHub installation does not require Git. | P0 | Vue component test in all relevant states. |
| FR-26 | Existing source types continue to install with no behavior regression. | P0 | source registry and source-specific regression suites. |

### 12.2 Supported GitHub URL forms

Version 1 must accept:

```text
https://github.com/owner/repo
https://github.com/owner/repo.git
https://github.com/owner/repo/releases/latest
https://github.com/owner/repo/releases/download/tag/plugin.zip
```

Version 1 may accept and normalize these convenience URLs if tests define unambiguous behavior:

```text
https://github.com/owner/repo/tree/branch-name
https://github.com/owner/repo/commit/full-commit-sha
```

If convenience URL parsing is not implemented, the product must reject these forms with a message that tells the user to enter the repository URL and place the branch, tag, or commit in the revision field. It must not silently install a different revision.

The GitHub source must reject:

- Plain HTTP URLs
- Non-GitHub hosts
- URLs containing username/password userinfo
- URLs containing control characters
- Repository paths without both owner and repository
- File and local-path schemes
- URLs whose normalized owner, repository, or ref cannot be represented safely

### 12.3 Ref behavior

- Empty ref means the repository default branch.
- A user-entered ref must be trimmed but otherwise preserved as a single data value.
- A ref must never be interpolated into a shell command.
- URL path segments must be encoded safely.
- A missing ref must produce a distinct error from a missing repository where GitHub's response makes the distinction possible.
- If a branch and tag have the same name, GitHub's archive resolution behavior is authoritative for v1.
- A full commit SHA is preferred for reproducible installs.

### 12.4 Public API and authentication behavior

- Public repository archives must be requested without a token.
- The product may use GitHub's REST archive endpoint or another documented GitHub archive URL that preserves default-branch and ref behavior.
- The client must identify itself with a stable, non-secret User-Agent appropriate for GitHub API use.
- If the REST API is used, the client must send the recommended media type and supported API-version headers.
- The client must follow the archive redirect.
- Authentication headers must never be added to public v1 requests.
- Future private-repository credentials must be sent only to the trusted GitHub API origin and must be removed before following a redirect to another host.
- Temporary redirect URLs must not be persisted or displayed.

GitHub documents that public archive requests can be made without authentication. Private archive access requires an eligible token with read-only **Contents** permission. Private archive redirects are temporary. These rules inform future support but do not expand v1 scope.

### 12.5 Source precedence

| User selection | URL | Required behavior |
|---|---|---|
| GitHub | GitHub repository URL | Archive download; never Git clone. |
| GitHub | GitHub release asset | HTTPS asset download. |
| URL | Eligible GitHub URL | Delegate to GitHub archive/asset path. |
| Git | Any accepted HTTPS/SSH/Git URL | Native Git clone. |
| Local ZIP | Local ZIP path | Existing local archive path. |

The presence of `.git` at the end of a GitHub URL must not override an explicit **GitHub** selection. The user's selected source kind is authoritative.

## 13. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | Cross-platform behavior | Equivalent success and error semantics on supported Windows, macOS, and Linux builds. |
| NFR-02 | Download timeout | A stalled single archive request terminates within the configured 60-second source timeout. |
| NFR-03 | Redirect bound | No more than five redirects per acquisition request. |
| NFR-04 | Package limits | Preserve `PLUGIN_PACKAGE_LIMITS` for compressed bytes, extracted bytes, and file count. |
| NFR-05 | Memory use | Stream archives to disk; do not buffer the complete archive in renderer or main-process memory. |
| NFR-06 | Atomicity | No partial active plugin after any failure. |
| NFR-07 | Cleanup | Temporary files are removed on every handled terminal path and on best-effort cancellation. |
| NFR-08 | Security | No path traversal, symlink extraction, device files, HTTP downgrade, credential forwarding, or plugin execution during acquisition. |
| NFR-09 | Privacy | No token, signed URL, local temp path, or credential-bearing URL in logs, renderer errors, diagnostics, or persistence. |
| NFR-10 | Accessibility | All new states are keyboard accessible and screen-reader meaningful. |
| NFR-11 | Internationalization | Translation keys exist in all six supported language files. |
| NFR-12 | UI quality | `yarn test:components` passes with tests for helper, loading, success, and failure states. |
| NFR-13 | Backward compatibility | Existing plugin installation and activation test suites pass unchanged unless assertions intentionally reflect the new GitHub behavior. |
| NFR-14 | Maintainability | Network download behavior is shared or extracted rather than duplicated across GitHub and generic URL fetchers. |
| NFR-15 | Observability | Failures are categorized by stable, redacted error codes suitable for support diagnostics. |

## 14. Required Error Taxonomy

The implementation may add dedicated `PluginErrorCode` values or map them to existing codes with structured metadata. The renderer must be able to distinguish at least these cases:

| Stable condition | Preferred code | Recoverable |
|---|---|---:|
| Git executable missing | `git-not-installed` | Yes |
| GitHub repository not found or inaccessible | `github-repository-unavailable` | Yes |
| GitHub ref not found | `github-ref-not-found` | Yes |
| GitHub authentication required | `github-auth-required` | Yes |
| GitHub API rate limit | `github-rate-limited` | Yes |
| GitHub network timeout | `source-timeout` | Yes |
| GitHub download/network failure | `source-download-failed` | Yes |
| Redirect invalid, unsafe, or excessive | `source-redirect-rejected` | No |
| Archive exceeds compressed limit | `install-io-failed` | No |
| Archive extraction safety violation | Existing `path-outside-plugin` or `install-io-failed` | No |
| Plugin manifest invalid/missing | Existing manifest error codes | Depends on existing behavior |

If adding new error codes is judged too broad for the first implementation, `dependency-unsatisfied` may represent missing Git, `permission-denied` may represent unavailable/auth-required GitHub content, and `install-io-failed` may represent transport failures. The UI must still receive a stable machine-readable reason rather than parsing English strings.

## 15. Source Acquisition Flow

```text
Renderer: Install Plugin from Source
  -> existing plugin-install IPC validation
  -> PluginInstallService
  -> PluginSourceRegistry(kind = github)
  -> GitHubPluginFetcher
       -> classify + normalize trusted GitHub URL
       -> repository: request ZIP archive for requested/default ref
       -> release asset: request existing ZIP asset URL
       -> enforce HTTPS, redirect, timeout, and download limits
       -> LocalZipPluginFetcher
       -> PluginArchiveService safe extraction
  -> PluginImportService.installFromLocalRoot
       -> unwrap one archive root directory
       -> validate manifest and components
       -> copy atomically
       -> persist through Module/Model layers
       -> promote capabilities
  -> cleanup temporary download and extraction roots
  -> redacted result to renderer
```

No child or worker process is required. Database access remains in the existing Module and Model path. The renderer and IPC handler must not access TypeORM repositories directly.

## 16. Provenance Requirements

The installed plugin record must preserve:

```json
{
  "sourceKind": "github",
  "sourceUri": "https://github.com/owner/repo",
  "sourceRef": "main",
  "sourceMetaJson": {
    "acquisition": "github-archive",
    "resolvedRevision": "full-commit-sha-if-known",
    "archiveType": "source-zip"
  }
}
```

Rules:

- `sourceUri` is canonical and contains no query string, fragment, userinfo, token, or signed redirect data.
- `sourceRef` contains the user-requested ref. It is null when the user requested the default branch and the product does not separately resolve its name.
- `resolvedRevision` is a full immutable commit SHA when it can be obtained from a trusted GitHub response without another fragile dependency.
- `acquisition` distinguishes `github-archive` from `git-clone` and `github-release-asset`.
- No database migration is expected because existing provenance fields can hold this data.
- Future update logic must prefer `resolvedRevision` for auditing and the requested ref for checking newer content.

## 17. Security and Privacy Requirements

### 17.1 Transport

- Only HTTPS is permitted for GitHub requests and every followed redirect.
- Certificate verification must remain enabled.
- Redirects must be bounded and resolved using URL semantics, including relative `Location` headers.
- A redirect to plain HTTP must fail closed.
- The downloader must not forward sensitive headers across origins.

### 17.2 Input validation

- Accept only the exact public GitHub host for v1.
- Normalize hostname case and a trailing `.git` suffix.
- Reject control characters and credential-bearing URLs.
- Treat owner, repository, and ref as data, never as command fragments.
- Do not use `exec`, a shell, or string-concatenated system commands for GitHub acquisition.

### 17.3 Resource exhaustion

- Reject an oversized `Content-Length` before writing when the header is trustworthy and exceeds the configured limit.
- Independently count streamed bytes and abort when the limit is crossed.
- Preserve extracted-byte and file-count checks because compressed size alone does not prevent archive bombs.
- Retain the existing symlink and unsafe-entry rejection.

### 17.4 Trust boundary

- A successful download is untrusted input, not an approved plugin.
- Downloading must not import modules, load plugin configuration as executable code, run package hooks, or prepare runtimes.
- Installation becomes active only after the existing manifest and component validation succeeds.
- Existing permission review and effective-enablement rules remain unchanged.

### 17.5 Authentication readiness

Although private repositories are out of scope for v1, the implementation must not make unsafe future authentication likely:

- The network abstraction should accept headers separately from URLs.
- Redirect logic should know the original and destination origins.
- Provenance and diagnostics should pass through existing redaction utilities.
- No placeholder token field should be added to the UI until secure credential handling is implemented end to end.

## 18. Native Git Fallback Requirements

Native Git remains a separate product path, not the default fallback for GitHub repositories.

When **Git** is selected:

1. AiFetchly attempts the existing shallow clone behavior.
2. If process creation fails with `ENOENT`, AiFetchly returns the missing-Git error immediately.
3. The UI explains three options:
   - Select **GitHub** for a public GitHub repository.
   - Download/import a ZIP.
   - Install Git, then restart AiFetchly so the packaged process receives the updated PATH.
4. AiFetchly does not automatically open or execute an installer.

Other Git failures must not be mislabeled as missing Git. Authentication failure, invalid repository, invalid ref, timeout, and general clone failure remain distinct where safely detectable without exposing raw credential-helper output.

## 19. Compatibility Requirements

### 19.1 Existing installations

No migration or reinstallation is required for already installed plugins. Existing records with `sourceKind: "github"` remain valid even if they were originally acquired through Git.

### 19.2 Reinstall and overwrite

Reinstalling an existing GitHub plugin uses the new archive path. Existing name-conflict and overwrite rules apply.

### 19.3 Plugin layouts

Supported archive layouts remain:

```text
archive-root/plugin.json
archive-root/.aifetchly-plugin/plugin.json
archive-root/.claude-plugin/plugin.json
archive-root/generated-wrapper/plugin.json
archive-root/generated-wrapper/.aifetchly-plugin/plugin.json
archive-root/generated-wrapper/.claude-plugin/plugin.json
```

Repositories containing multiple unrelated top-level directories and no root manifest remain invalid unless existing plugin discovery explicitly supports them.

### 19.4 Submodules and Git LFS

GitHub source archives are snapshots, not clones:

- Git submodule contents may not be present.
- Git history and `.git` metadata are not present.
- Git LFS objects depend on repository archive configuration.

Plugin packages must be self-contained. If a required manifest component is absent, normal validation fails with an actionable message. The installer must not attempt recursive network acquisition based on `.gitmodules` in v1.

## 20. Testing Requirements

### 20.1 GitHub fetcher unit tests

Extend `test/vitest/utilitycode/githubPluginFetcher.test.ts` to cover:

- Plain repository URL uses archive acquisition and never calls Git.
- Repository URL ending in `.git` still uses archive acquisition under the GitHub source.
- Empty ref requests default-branch behavior.
- Branch, tag, and commit refs are encoded and passed correctly.
- Release asset and latest-release paths remain supported.
- Public request contains no authorization header.
- One or more valid HTTPS redirects succeed.
- Relative redirect locations resolve correctly.
- Too many redirects fail.
- Redirect loops fail.
- HTTPS-to-HTTP redirect fails.
- Cross-origin redirect does not receive sensitive headers.
- Timeout aborts the request and cleans temporary files.
- Oversized `Content-Length` rejects early.
- Oversized streamed body aborts even without `Content-Length`.
- Non-200 responses map to expected typed errors.
- Partial output files are removed after failure.
- Successful ZIP delegates to the existing ZIP fetcher.
- Cleanup removes both download and extraction temporary directories.

### 20.2 Archive and import integration tests

Add fixtures for:

- GitHub-style generated wrapper directory containing a valid AiFetchly manifest.
- GitHub-style generated wrapper directory containing a valid Claude-compatible manifest.
- Missing manifest.
- Unsafe path entry.
- Symlink entry.
- Archive bomb/oversized extracted content.
- Too many files.
- Corrupt ZIP.

Verify install, persistence, capability promotion, uninstall, and cleanup.

### 20.3 Git fetcher tests

Extend `test/vitest/utilitycode/gitPluginFetcher.test.ts` to cover:

- Spawn emits `ENOENT` and maps to missing Git.
- Non-zero exit is not mislabeled as missing Git.
- Timeout remains bounded.
- URI redaction remains intact.
- Existing argument-array and `shell: false` behavior remains intact.

### 20.4 URL dispatcher tests

Verify:

- GitHub repository URLs delegate to the GitHub archive path.
- GitHub `.git` URLs selected as generic URL follow the documented source-classification rule.
- Non-GitHub `.git` URLs continue to use native Git.
- Direct ZIP URLs retain existing behavior.

### 20.5 IPC tests

Verify:

- Source kind and required-field validation.
- Control-character rejection.
- Errors are redacted before reaching the renderer.
- No database repository access occurs in the IPC handler.
- Manual plugin installation remains available when AI features are disabled.
- Successful installation triggers capability promotion and configuration refresh.

### 20.6 Vue component tests

Create or extend the corresponding test under `test/vitest/main/components/` for `PluginInstallSourceDialog.vue`:

- GitHub helper states that public repositories do not require Git.
- Ref field accepts branch, tag, or commit.
- Install is disabled when URL is empty.
- Duplicate submit is blocked while working.
- Progress/loading state renders.
- Missing/inaccessible repository message renders.
- Invalid-ref recovery guidance renders.
- Missing-Git message is rendered for the Git source, with GitHub and ZIP alternatives.
- Successful install emits `imported` and closes the dialog.
- All new translation keys resolve in each supported locale.

The hard UI gate is:

```bash
yarn test:components
```

### 20.7 Cross-platform validation

Required CI or packaged-app validation:

| Platform | Git availability | Expected result |
|---|---|---|
| Windows | Git absent | Public GitHub install succeeds. |
| Windows | Git absent | Explicit Git source shows missing-Git recovery. |
| macOS | Git unavailable to packaged PATH | Public GitHub install succeeds. |
| Linux | Git absent | Public GitHub install succeeds. |
| Any | Git present | GitHub still uses archive; Git source still clones. |

Tests must not depend on live GitHub for normal CI. HTTP and download behavior should use injectable transports or a local fixture server. A small opt-in smoke test may exercise a known public repository outside the required deterministic suite.

## 21. Acceptance Criteria

The feature is complete only when all criteria below pass:

1. On a machine where `git` is unavailable, a user can install a valid plugin from a public GitHub repository URL.
2. The GitHub repository path starts no Git process.
3. No GitHub token is requested or sent for a public repository.
4. Empty ref installs the default branch.
5. Explicit branch, tag, and commit inputs install the selected revision or return a precise ref error.
6. The GitHub-generated archive wrapper directory is handled by existing root resolution.
7. Download, extraction, validation, persistence, activation, rollback, and cleanup preserve existing plugin guarantees.
8. An inaccessible repository does not produce a misleading generic Git error.
9. Explicit Git installation returns a specific missing-Git error when process creation reports `ENOENT`.
10. No temporary archive or extraction directory remains after tested terminal outcomes.
11. No credential, signed redirect URL, or sensitive header is persisted or returned to the renderer.
12. All six language files contain the new UI copy.
13. Component tests cover the UI change and `yarn test:components` passes.
14. Relevant unit, main-process, module, and integration suites pass.
15. Existing non-GitHub source installation behavior remains compatible.

## 22. Success Metrics

If privacy-preserving product telemetry is available and enabled, measure:

- GitHub plugin installation success rate.
- Failure rate by stable error category.
- Percentage of GitHub installations completed without Git available.
- Retry success after timeout, rate-limit, unavailable-repository, or invalid-ref errors.
- Median and 95th-percentile acquisition duration.
- Number of users who switch from Git to GitHub after a missing-Git error.

Do not collect full repository URLs, owner names, repository names, refs, tokens, signed redirect URLs, or local paths. Aggregate only source kind, outcome code, platform, duration bucket, and whether Git was detectable.

Initial product targets after release:

- At least 95% success for valid, in-limit public GitHub plugin repositories under normal network conditions.
- Zero Git process starts for GitHub repository installations.
- Zero known credential or signed-URL disclosures.
- No statistically meaningful regression in local ZIP, local folder, Git, npm, release asset, or generic URL installs.

## 23. Rollout Plan

### Phase 1: service behavior behind a feature flag

- Add archive acquisition for GitHub repository URLs.
- Add typed error mapping and missing-Git detection.
- Add deterministic unit and integration tests.
- Keep UI behavior unchanged while internal verification runs.

### Phase 2: user-facing Git-free experience

- Update install-dialog helper and errors in all languages.
- Add component tests.
- Enable archive acquisition by default for GitHub sources.
- Retain a temporary internal fallback flag capable of restoring the former GitHub-to-Git behavior during the stabilization window, without exposing automatic fallback to users.

### Phase 3: cleanup and provenance hardening

- Remove the fallback after stability targets are met.
- Confirm resolved revision persistence.
- Add diagnostics counters using only privacy-safe categories.
- Update plugin author documentation to recommend release assets or commit-pinned source archives.

### Future phase: private repositories

- Complete a separate security review and PRD amendment.
- Choose OAuth device flow or one-use fine-grained token UX.
- Require read-only Contents permission.
- Verify origin-bound authorization and redirect header stripping.
- Add secure storage, revocation, redaction, and organization-policy test matrices.

## 24. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Unauthenticated GitHub API limits are reached | Public installation temporarily fails. | Return a typed retryable error; allow local ZIP or explicit Git recovery; consider a documented archive-URL fallback only after security review. |
| Branch or tag moves after installation | Later reinstall may produce different bytes. | Persist requested ref and resolved commit; recommend commit SHA or release assets for reproducibility. |
| Archive lacks submodule or LFS content | Manifest components may be missing. | Keep plugins self-contained; validate after extraction; explain archive limitations. |
| Redirect handling leaks future credentials | Private-repo token could reach another host. | Never add auth in v1; design header stripping and origin checks before private support. |
| GitHub changes archive compression | Binary ZIP bytes differ despite identical files. | Validate extracted content, not archive byte identity; use resolved commit for source identity. |
| Very large repository consumes disk or CPU | Main process slowdown or resource exhaustion. | Enforce streaming compressed limit, extracted limit, file count, timeout, and cleanup. |
| Electron network behavior differs behind proxies | Corporate users cannot connect. | Reuse the application's approved network/proxy strategy where available; provide timeout/network diagnostics. |
| Existing users expect Git credentials to work under GitHub source | Private install stops working through that selection. | v1 documents public-only GitHub source; retain explicit Git source for credential-helper/SSH workflows. |
| Error localization becomes inconsistent | Users receive English or ambiguous messages. | Centralize error keys and assert parity across all language files. |
| Live-network tests become flaky | CI loses trust. | Use injectable HTTP transport/local fixture server; keep live smoke tests optional. |

## 25. Dependencies

- Existing `PluginSourceRegistry` and `PluginInstallService` orchestration.
- Existing `LocalZipPluginFetcher` and `PluginArchiveService` safety controls.
- Existing `PluginManifestService.resolvePluginRoot` wrapper handling.
- Existing `PluginImportService.installFromLocalRoot` validation and rollback.
- Existing installed-plugin provenance fields.
- Existing IPC validation and redaction utilities.
- Existing Vue dialog and six-language i18n structure.
- A testable HTTP transport abstraction or injectable request function for deterministic network behavior.

No new database entity is required. No worker process is required. No system dependency is required for the public GitHub path.

## 26. Product Decisions

The following decisions are resolved by this PRD:

1. **Public GitHub repositories install by ZIP archive, not Git clone.**
2. **Public installation requires no token.**
3. **Private GitHub support is deferred from v1.**
4. **Native Git remains a separate explicit source.**
5. **AiFetchly does not install Git automatically.**
6. **Existing archive validation is reused rather than reimplemented.**
7. **Requested ref and immutable revision are separate provenance concepts.**
8. **A 404 is described as missing or inaccessible, not conclusively private.**
9. **The UI must disclose that public GitHub installation works without Git.**
10. **UI changes and all-language translations ship with component tests.**

## 27. Open Questions for Technical Design

These questions should be resolved in the technical design without changing the product requirements:

1. Should repository metadata be requested first to resolve the default branch and commit, or should the archive endpoint's default behavior be used followed by revision extraction from trusted response metadata?
2. Should GitHub and generic URL downloads share one hardened redirect/download service?
3. Which GitHub redirect hosts should be explicitly allowlisted for source archives and release assets?
4. How should cancellation be propagated from the renderer to the active main-process request?
5. Should the existing plugin error union gain dedicated codes or a structured `reason` field under existing codes?
6. What feature-flag location and rollback duration should be used during rollout?
7. Should `tree/<ref>` and `commit/<sha>` convenience URLs be supported in v1 or rejected with correction guidance?
8. Can the resolved commit SHA be obtained reliably from the archive response, or is one additional GitHub API request required?

## 28. Definition of Done

- Product, engineering, security, and design owners approve this PRD and its technical design.
- Public GitHub repository installation is verified with Git absent on Windows, macOS, and Linux.
- Unit, integration, IPC, module, component, and regression tests pass.
- `yarn test:components` passes as a hard UI gate.
- All supported language files contain reviewed translations.
- Security review confirms safe redirects, bounded streaming, archive safety, cleanup, and redaction.
- Packaged Electron smoke testing confirms the GitHub source has no PATH or Git dependency.
- User-facing documentation explains public/private behavior and archive limitations.
- Rollback instructions are documented and tested before default enablement.
