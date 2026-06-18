# Multi-Source Plugin Installation — Design Spec

- **Date:** 2026-06-18
- **Status:** Approved
- **Scope:** Extend the existing Plugin Management System to install plugins from `local-zip`, `local-folder`, `git`, `github`, `npm`, and `url` sources.
- **Depends on:** `doc/skills/PRD_Plugin_Management_System.md`, `doc/skills/Plugin_Management_System_Technical_Design.md`
- **Implementation branch:** `feature/plugin-multi-source-install`

## 1. Problem

The Plugin Manager currently accepts only local `.zip` packages (`PluginImportService.importFromZip`). Users cannot install plugins from a git repo, GitHub release, npm package, HTTPS URL, or local folder. The PRD's Non-Goals explicitly deferred remote install, but product now needs it.

## 2. Goals

1. Install plugins from: local zip, local folder, git URL, GitHub repo or release asset, npm package (public registry or scoped/private with auth), and arbitrary HTTPS URL.
2. Reuse the existing manifest/skill/MCP validation, persistence, rollback, and cache-invalidation pipeline — no parallel runtime.
3. Record provenance so a future "update" feature can re-fetch.
4. Apply the same security guarantees as zip import (size limits, no code execution during fetch, no plugin code on the critical path of validation).
5. Auth model for private git/npm: rely on the user's local environment (SSH agent + git credential helper, npm config / `_authToken` via env or short-lived prompt). No new long-term secret storage in v1.
6. All user-facing strings translated to en/zh/es/fr/de/ja.

## 3. Non-Goals (v1)

- "Check for updates" / auto-update. Provenance columns make this a clean follow-up.
- Marketplace browsing.
- Recursive plugin dependencies.
- SSH key management UI.
- Storing remote credentials in the app's secure storage (we rely on environment / OS credential helper).

## 4. Architecture

### 4.1 Core abstraction: `PluginSourceFetcher`

```typescript
export type PluginSourceKind =
  | "local-zip"
  | "local-folder"
  | "git"
  | "github"
  | "npm"
  | "url";

export interface PluginSourceRequest {
  readonly kind: PluginSourceKind;
  readonly overwrite?: boolean;
  // local-zip
  readonly zipPath?: string;
  // local-folder
  readonly folderPath?: string;
  // git / github / url
  readonly uri?: string;
  readonly ref?: string;            // branch, tag, commit
  // npm
  readonly npmPackage?: string;
  readonly npmVersion?: string;
  readonly npmRegistry?: string;
  readonly npmAuthScope?: string;
  readonly npmAuthToken?: string;   // short-lived, never persisted
  // progress callback (optional)
  readonly onProgress?: (msg: string, pct?: number) => void;
}

export interface FetchedPluginSource {
  readonly localRoot: string;       // a directory containing the plugin root
  readonly cleanup: () => Promise<void>;
}

export interface PluginSourceFetcher {
  readonly kind: PluginSourceKind;
  acquire(req: PluginSourceRequest): Promise<PluginAcquireResult>;
}

export type PluginAcquireResult =
  | { success: true; source: FetchedPluginSource }
  | { success: false; errors: readonly PluginError[] };
```

A registry maps `kind → fetcher`. Each fetcher is a small, focused class.

### 4.2 Pipeline

```
PluginInstallService.installFromSource(req)
  └─ PluginSourceRegistry.get(req.kind).acquire(req)  → FetchedPluginSource
  └─ PluginImportService.installFromLocalRoot(localRoot, { overwrite, sourceMeta })
       (existing steps 3–12 of current importFromZip, refactored)
  └─ cleanup()
```

`installFromLocalRoot` is the existing post-extract logic (manifest load → name-conflict check → skill/MCP validation → atomic copy → persist rows → cache clear). The only change is that the source-kind/uri/ref are persisted onto the row.

### 4.3 New `PluginInstallService`

A new orchestrator service. It owns the registry, the size/time limit enforcement on fetched directories, and the security redaction of URIs in diagnostics.

## 5. Fetcher Specifications

All fetchers:
- Honor `PLUGIN_PACKAGE_LIMITS` (50 MB compressed / 250 MB extracted / 5000 files) and abort early.
- Never execute plugin code (`npm install`, `pip install`, postinstall scripts, plugin entry files).
- HTTPS only for network calls. Plain HTTP is rejected with `permission-denied`.
- Strip secrets from any log/diagnostics output.

### 5.1 `LocalZipPluginFetcher` (`local-zip`)
Wraps the existing `PluginArchiveService.extractZip`. Backward compat for the existing `PLUGIN_IMPORT` channel.

### 5.2 `LocalFolderPluginFetcher` (`local-folder`)
- Validates that the path is a directory and is not inside `getPluginsRoot()` (avoid recursive copy / self-install).
- Validates the folder against `PLUGIN_PACKAGE_LIMITS`.
- Returns the folder directly as `localRoot` with a no-op cleanup. The downstream `installFromLocalRoot` copies files into `getPluginInstallRoot(name)` (existing behavior), so the user's source folder is never mutated.

### 5.3 `GitPluginFetcher` (`git`)
- Accepts `https://` / `git@` / `ssh://` URLs.
- Rejects anything that smells like a local path or `file://`.
- Clones with: `git clone --depth 1 --branch <ref> <uri> <tmp>` (or `--single-branch` when no ref).
- Inherits the user's environment (`env: process.env`) so SSH agent + git credential helper work. **Does not** pass credentials on the command line.
- Runs `git clone` with a 60s timeout and discards stderr from being echoed to the renderer (it may contain auth hints).
- After clone, walks the resulting directory; if it contains a single subdirectory and no manifest at root, descend into that subdir (handle "repo contains a `plugin-root/` wrapper").
- Applies `PLUGIN_PACKAGE_LIMITS` on the cloned tree.

### 5.4 `GitHubPluginFetcher` (`github`)
- URL classifier:
  - `github.com/:owner/:repo` (optionally `?ref=`) → `GitPluginFetcher` with `https://github.com/owner/repo.git` and the ref.
  - `github.com/:owner/:repo/releases/download/:tag/:asset(.zip)` → direct HTTPS download of the asset, then reuse `LocalZipPluginFetcher` pipeline on the downloaded bytes.
  - `github.com/:owner/:repo/releases/latest` → resolve `latest` via the GitHub API redirect, then download the first `.zip` asset (or the source tarball if no assets).
- No PAT in v1; public repos and release assets only. If 404/403, return `permission-denied` with a hint to use the `git` source with a credential helper.

### 5.5 `NpmPluginFetcher` (`npm`)
- Resolves the package via the configured registry (default `https://registry.npmjs.org`).
- Uses `npm pack <pkg>@<version> --registry=<registry> --ignore-scripts --json` to download the tarball **without running lifecycle scripts**.
  - `--ignore-scripts` is mandatory; if a future npm version drops it, we fail closed.
- For scoped auth: passes `_authToken` via a temporary `.npmrc` in the temp working directory (mode 0600, deleted in cleanup), never via CLI args (so the token never appears in `ps`).
- Extracts the tarball, validates it's a plugin (has a plugin manifest), applies size limits.
- Records `sourceUri = "<pkg>@<version>"`, `sourceRef = version`, `sourceMetaJson = { registry }`.

### 5.6 `UrlPluginFetcher` (`url`)
Single URL field, auto-detect:
- Ends in `.zip` or `Content-Type: application/zip` → download to temp `.zip`, delegate to `LocalZipPluginFetcher`.
- Ends in `.git` or matches `git@...` / `ssh://...` → delegate to `GitPluginFetcher`.
- `github.com/...` → delegate to `GitHubPluginFetcher`.
- Otherwise: error `manifest-schema-invalid` ("unsupported URL shape").

Download uses Node `https` with a 60s timeout, redirects followed up to 5 hops, rejects non-HTTPS, enforces max body size by aborting the stream at `PLUGIN_PACKAGE_LIMITS.maxZipBytes`.

## 6. Data Model Changes

### 6.1 `InstalledPluginEntity` new columns

```typescript
@Column("text", { default: "local-zip" })
sourceKind: string;            // PluginSourceKind

@Column("text", { nullable: true })
sourceUri?: string;            // repo / npm pkg / url / folder path

@Column("text", { nullable: true })
sourceRef?: string;            // git ref, npm version, release tag

@Column("text", { default: "{}" })
sourceMetaJson: string;        // { registry, scope, fetchNotes } — NO secrets
```

`sourceKind` is a free-text column for TypeORM/SQLite compatibility; the typed `PluginSourceKind` is enforced at the boundary.

### 6.2 No changes
- `InstalledSkillEntity`, `MCPToolEntity`, ownership columns — unchanged.
- `PluginManifest`, `PluginError`, `PluginSummary` — unchanged in shape (a `sourceUri`/`sourceRef` may be surfaced in `PluginDetail` only).

## 7. Service Layer

### 7.1 Refactor: `PluginImportService`
Split current `importFromZip` into:
- `installFromLocalRoot(localRoot, opts): Promise<PluginImportResult>` — pure, no zip handling. Steps 3–12 of the current method.
- `importFromZip(options)` — now thin: extract zip → call `installFromLocalRoot`.

### 7.2 New: `PluginInstallService`
```typescript
export class PluginInstallService {
  static async installFromSource(req: PluginSourceRequest): Promise<PluginImportResult>;
}
```
- Resolves fetcher via `PluginSourceRegistry`.
- Calls `acquire()`.
- Enforces post-fetch size/file limits on the produced directory.
- Forwards `{ kind, uri, ref, meta }` as `sourceMeta` to `installFromLocalRoot`.
- Always calls `cleanup()` in a `finally`.

### 7.3 New: `PluginSourceRegistry`
A simple lookup. Built once at module load; tests can swap fetchers.

## 8. IPC

### 8.1 New channel
`PLUGIN_INSTALL_FROM_SOURCE = "plugin:install-from-source"` in `src/config/channellist.ts`.

Handler in `plugin-ipc.ts`:
- AI-enable gate (existing pattern).
- Validate `kind` is in the `PluginSourceKind` union.
- Validate per-kind required fields (e.g. `git` requires `uri`).
- Reject any user-supplied `uri` containing `\n`, `\r`, or shell metacharacters that would survive being passed to `child_process.spawn` with `shell: false` (we use `shell: false` everywhere; defense-in-depth).
- Redact secrets before returning errors.

Keep `PLUGIN_IMPORT` (zip-only) for backward compatibility — the renderer calls it from the existing zip flow.

### 8.2 Optional: source provenance in `PLUGIN_GET`
`PluginDetail` gains optional `sourceKind`, `sourceUri`, `sourceRef`. UI shows read-only.

## 9. Security Requirements

1. **HTTPS only** for URL/GitHub/npm downloads and registry calls. Reject HTTP.
2. **`shell: false`** for all `child_process.spawn` calls (`git`, `npm`). Never `exec`.
3. **No credentials on the CLI.** Git auth comes from the user's SSH agent / credential helper / `.gitconfig`. npm tokens go through a temporary 0600 `.npmrc`.
4. **`--ignore-scripts`** is mandatory for `npm pack`.
5. **Size limits** applied to every fetched source, not just zip.
6. **Timeout**: 60s for any single network operation.
7. **No plugin code execution during fetch.** No `npm install`, no `pip install`, no plugin entry file imports.
8. **Path safety**: a `local-folder` source path must not be inside `getPluginsRoot()`.
9. **Log/diagnostics redaction**: strip `?token=`, basic-auth userinfo, and any `_authToken` values from URIs and error messages before they reach the renderer or the diagnostics bundle.
10. **Worker process rule** unchanged: any helper that needs DB still goes through main-process Modules.

## 10. UI

### 10.1 New dialog: `PluginInstallSourceDialog.vue`
- Radio/segmented control for source kind: `Local Zip | Local Folder | Git | GitHub | npm | URL`.
- Per-kind form (dynamically rendered):
  - **Local Zip**: file picker → existing `PLUGIN_IMPORT` path.
  - **Local Folder**: directory picker + helper text "Folder will be copied into the plugins cache; your source folder will not be modified."
  - **Git**: URL input + optional branch/tag/commit.
  - **GitHub**: URL input (repo or release asset) + optional ref.
  - **npm**: package name + version + optional registry URL + optional auth token (password-type input; never persisted).
  - **URL**: single URL input with hint about auto-detection.
- Reuse the existing install-review step (manifest, components, permissions, warnings) — same flow as today's zip import, just driven by the new source.
- Progress indicator during fetch (indeterminate spinner + status text).
- Error display: the `PluginError[]` joined, with the redacted URI shown.

### 10.2 Existing dialog
`PluginImportDialog.vue` keeps working for zip. Both dialogs reachable from the Plugin Manager toolbar.

### 10.3 i18n
All new strings added under `plugins.install_source.*` in `src/views/lang/{en,zh,es,fr,de,ja}.ts`.

## 11. Testing Plan

### 11.1 Unit tests
- `PluginSourceRegistry` returns the right fetcher.
- `LocalFolderPluginFetcher`:
  - accepts a valid folder
  - rejects a folder inside `getPluginsRoot()`
  - rejects a missing folder
  - enforces file/size limits
- `GitPluginFetcher`:
  - rejects `file://`, local paths, HTTP URLs
  - builds correct `git clone` argv (assert `--depth 1`, `--branch <ref>`, `shell:false`)
  - times out
  - handles single-subdir wrapper layout
- `GitHubPluginFetcher` URL classifier: repo URL → clone; release asset URL → download; releases/latest → API resolve.
- `NpmPluginFetcher`:
  - passes `--ignore-scripts`
  - writes `.npmrc` (0600) and deletes it in cleanup
  - no token on CLI
- `UrlPluginFetcher`:
  - `.zip` → zip path
  - `.git` → git path
  - `github.com` → github path
  - rejects HTTP
- `PluginInstallService.installFromSource`:
  - happy path (mocked fetcher) calls `installFromLocalRoot` with correct sourceMeta
  - failure path: cleanup is invoked, no row persisted
  - oversize fetch → `install-io-failed`, cleanup invoked
- Diagnostics redaction strips tokens/auth.
- IPC handler:
  - AI-disabled gate
  - per-kind validation
  - redacts secrets in error responses

### 11.2 Integration tests
- End-to-end install from a fixture local folder (no network).
- End-to-end install from a fixture local zip (regression).
- Install + uninstall + reinstall to confirm provenance columns are written.

### 11.3 Manual verification
`yarn dev` → System Settings → Plugins → Install from each source kind with a known-good public sample (e.g. an aiFetchly sample plugin repo).

## 12. Implementation Phases

1. **Types & persistence** — `PluginSourceKind`, `PluginSourceRequest`, `FetchedPluginSource`, new entity columns, model/module plumbing.
2. **Refactor `PluginImportService`** — extract `installFromLocalRoot` and a `sourceMeta` param; keep `importFromZip` working.
3. **Fetchers** — implement in this order: `LocalZip` (move existing), `LocalFolder`, `Git`, `GitHub`, `Npm`, `Url` (dispatcher). Add `PluginSourceRegistry` and `PluginInstallService`.
4. **IPC** — new channel + per-kind validation + redaction.
5. **UI** — `PluginInstallSourceDialog.vue`, toolbar entry, `PluginDetail` provenance display, i18n in all six languages.
6. **Tests & hardening** — unit tests for each fetcher (mocked child_process/https), URL classifier, redaction, oversize/timeout, integration test for folder/zip end-to-end.

## 13. Acceptance Criteria

- Plugin Manager can install a plugin from each of: local zip, local folder, git URL, GitHub repo URL, GitHub release asset URL, npm package (public), npm package (scoped/private via auth token), and arbitrary HTTPS zip URL.
- Source kind/URI/ref are recorded on the installed plugin row and visible in the detail panel.
- Validation, rollback, ownership, effective-enablement, and uninstall behavior match the existing zip flow.
- HTTP URLs, `file://`, and plugin code execution during fetch are impossible.
- Oversized / timed-out fetches roll back cleanly with no partial row.
- All new UI strings are translated to en/zh/es/fr/de/ja.
- Unit + integration tests pass via `yarn test` / `yarn testmain`.

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `npm pack --ignore-scripts` removed in future npm | Pin via try/catch; fail closed with explicit error if flag is rejected. |
| GitHub rate-limits unauthenticated API calls | Document the limit; advise using `git` source for private/frequent installs. |
| User has no SSH agent / credential helper | Diagnostics show a clear hint pointing to the git source + OS keychain setup doc. |
| Tarball `.tar.gz` from GitHub source archive | Treat release asset `.zip` as primary; for source archives, accept `.tar.gz` via the URL fetcher's tar path (added if needed in Phase 3). |
| Credential leak via `ps` | Never pass tokens on CLI; use temp `.npmrc` / inherited SSH agent. |

## 15. Out of Scope (recap)

- Auto-update / "check for updates" button.
- Marketplace browsing UI.
- Plugin dependency resolution.
- SSH key management UI.
- Long-term secret storage in app secure storage.
