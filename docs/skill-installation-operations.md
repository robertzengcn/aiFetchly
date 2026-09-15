# Skill Installation — Operations Runbook

Audience: operators and developers supporting the natural-language skill
installer and prompt-skill runtime in deployed AiFetchly builds.
PRD: `docs/prd/natural-language-skill-installation-prd.md`. Plan:
`docs/plans/2026-08-24-natural-language-skill-installation.md`.

## Feature switch

| Env var | Effect |
|---|---|
| `AIFETCHLY_SKILL_INSTALL_ENABLED` | `true`/`1` enables installer tools + routing policy injection; absent or invalid disables (kill switch). Restart required. |
| `AIFETCHLY_CONFIG_HOME` | Overrides `~/.aifetchly` (config + skills root). Tests/advanced deployments only. |
| `AIFETCHLY_SKILL_STAGING_ROOT` | Overrides acquisition staging root (default: `<userData>/skill-installation`). |
| `AIFETCHLY_SKILL_CREDENTIAL_STORE` | Overrides the credential store directory (default: `~/.aifetchly/skill-state`). |

When the switch is OFF: no installer tools are exposed, no routing policy is
injected, and existing prompt skills continue to load and invoke normally
(the runtime is not gated by the installer switch).

## On-disk layout

```
~/.aifetchly/
  skills/<name>/                    # managed copy (default) or symlink/junction
    .aifetchly-install.json         # ownership metadata (installationId, revision)
  skill-state/credentials.json      # safeStorage-encrypted; mode 0600
<userData>/skill-installation/
  sessions/<session-id>/source/     # staging (removed on cancel/cleanup)
```

Uninstall removes a directory ONLY when `.aifetchly-install.json` proves
ownership and the realpath sits inside the skills root. Links are unlinked;
external targets always survive.

## The install flow

```
prepare  -> acquire into staging -> inspect (SKILL.md/manifest/plugin) ->
            plan (revisioned, hashed instructions) -> awaiting_approval
approve  -> (renderer card only; opaque approval token) ->
            [awaiting_secret -> secure input -> resume] ->
            activate (atomic managed copy / symlink) -> verify -> ready
status   -> session-correlated snapshot with next_action
cancel   -> pre-activation: staging removed; during activation: rollback_required
```

Key invariants:

- **Approval is human-bound.** `skill_install:approval-token` is a
  renderer-only IPC channel; the model-facing approve tool cannot supply the
  token and receives `APPROVAL_REQUIRED`.
- **Secrets never enter chat.** `SKILL_INSTALL_SUBMIT_SECRET` is the only
  accepted channel; `rejectSecretShaped` blocks credential-shaped values in
  ordinary tool arguments (installer AND `use_skill`).
- **Idempotency.** Repeated `prepare` for a healthy installed source reports
  ready (`sessionId: installation:<id>`), never re-acquires. Activation
  upserts by installation identity (source+revision+scope+mode).
- **Rollback.** Verification failure unregisters the catalog entry, marks the
  installation row `failed`, and restores the previous activation.

## Update / repair / disable / uninstall

| Operation | Behavior |
|---|---|
| `update` | Re-acquires the recorded source into fresh staging, returns a NEW plan revision at `awaiting_approval` — expanded capabilities require renewed approval. |
| `repair` | Rechecks activation readability, SKILL.md presence, catalog registration, status; re-registers the catalog entry when lost. Never moves to a newer revision. |
| `disable`/`enable` | Toggles model discovery + invocation immediately; files, provenance, secrets preserved. |
| `uninstall` | Ownership-verified removal (above). Credential deletion defaults ON; pass `deleteSecrets: false` to retain. |

## Linked (development) mode

`mode: "linked"` creates a POSIX directory symlink / Windows junction in
`~/.aifetchly/skills` pointing at the source checkout. AiFetchly owns the
link, never the target. External edits change the active skill: the content
hash check (`SKILL_CONTEXT_HASH_MISMATCH`) blocks silent instruction swaps at
invocation time — the user must reload to review new instructions.

## Secure credentials

`SkillCredentialService` wraps Electron `safeStorage` (DPAPI / Keychain /
libsecret). When OS encryption is unavailable the store FAILS CLOSED with
`SECURE_STORAGE_UNAVAILABLE` — there is no plaintext downgrade. Values are
keyed by installation identity + environment variable; only an opaque
binding is persisted in SQLite. Injection into an approved child process is
the documented consumer of `retrieve()` (see the CONSUMER NOTE in the
source — the approved-command execution path is future work).

## Troubleshooting

| Symptom | Check |
|---|---|
| Installer tools absent from the model | `AIFETCHLY_SKILL_INSTALL_ENABLED` not set; ToolLoadPolicyService gates on it at classify time |
| `APPROVAL_REQUIRED` on model-side approve | Expected — approval happens on the install card |
| `WORKSPACE_NOT_APPROVED` from shell/file tools | Conversation has no approved workspace; home is never a fallback |
| `SOURCE_LIMIT_EXCEEDED` | Package exceeded 5,000 files / 250 MiB / depth 20 |
| Skill vanished after OS restart | Run `skill_install_repair` (re-registers the catalog) |
| `SKILL_CONTEXT_HASH_MISMATCH` on invoke | Linked skill changed externally — reload to review |
| Empty PowerShell output flagged | `PROCESS_OUTPUT_EMPTY_UNEXPECTED` sentinel — see `src/service/process/` |

## Git-free GitHub plugin installation

PRD: `docs/prd/git-free-github-plugin-installation-prd.md`. Applies to the
**GitHub** source in *Plugins → Install from Source* (and GitHub URLs pasted
into the **URL** source).

**What an operator should know first:**

- **Public GitHub needs no Git and no token.** A public repository installs
  by resolving the ref to an immutable commit SHA through the GitHub REST
  API and downloading that commit's zipball. No `git` executable is
  spawned, no account is used, and no credential is requested or stored.
- **Private repositories are NOT supported on the GitHub source in v1.**
  There is no OAuth flow and no token field. A 404/401 for a private repo
  surfaces as `github-repository-unavailable` — this is expected, not an
  outage. (Users with private repos can still clone locally with their own
  credential helper and import the folder/zip.)
- **`tree/<ref>` / `commit/<sha>` browser URLs are rejected** with guidance:
  enter the plain repository URL and put the branch/tag/commit in the
  **Ref** field. This prevents silently installing a different revision
  than the one shown in the browser.
- **GitHub archives omit submodules and Git LFS content.** The zipball
  GitHub serves contains the repository tree only — submodule directories
  are empty and LFS files are pointer text. Authors who need those files
  should publish a release asset zip instead (see
  `docs/plugin-author-github-distribution.md`).
- **Rate limits.** Public API access is unauthenticated (60 req/h per IP).
  When the quota is exhausted installs fail with `github-rate-limited`
  (recoverable) — wait and retry, or import a ZIP.

**Rollback flag:** the Token key `github_archive_install_enabled` controls
the archive path. It defaults to ENABLED; setting it to the exact string
`false` makes repository URLs fall back to the legacy native-Git clone
(requires a local Git installation). Release-asset and `releases/latest`
URLs always use the archive download path.

**Stable error codes** (renderer maps these to localized guidance):

| Code | Meaning |
|---|---|
| `git-not-installed` | Git source selected but no `git` on PATH; guidance offers GitHub/ZIP alternatives |
| `github-repository-unavailable` | Repo/release not found or not public (includes private repos) |
| `github-ref-not-found` | Repo reachable, branch/tag/commit does not exist |
| `github-rate-limited` | Unauthenticated GitHub quota exhausted — retry later |
| `source-timeout` / `source-download-failed` | Network stalled / download failed |
| `source-redirect-rejected` | Redirect left the trusted host set — blocked, non-recoverable |
| `source-cancelled` | User cancelled (no failure alert in the UI) |

**Provenance.** The installed plugin row stores `sourceKind`,
`sourceUri` (canonical `https://github.com/<owner>/<repo>`), `sourceRef`
(the requested ref), and `sourceMeta` with `acquisition`
(`github-archive` | `github-release-asset`) and `resolvedCommitSha`. The
Plugin Manager overview shows the resolved SHA shortened to 7 characters.
These keys are generated by the main-process fetcher and take precedence
over any renderer-supplied values, so the pinned revision cannot be
spoofed. (PRD name mapping: PRD `resolvedRevision` == design
`resolvedCommitSha`; PRD `archiveType` == design `acquisition`.)

**All GitHub and ZIP downloads — release assets included — share one
bounded HTTPS transport** (`src/service/pluginSources/PluginHttpDownloadService.ts`):
HTTPS-only redirects validated against per-source host allowlists, one
overall deadline, streamed byte ceiling, exclusive `.part` + rename, and
cleanup on every failure/cancel path. A security review of this path is
recorded in `docs/security-reviews/2026-09-16-gitfree-github-acquisition.md`.

## Telemetry / observability fields

Installer snapshots carry `sessionId`, `state`, `nextAction`,
`planRevision`, `recoverable`, `errorCode`. Progress events are monotonic
per session. No secrets, full URLs, or repository content are ever logged.
