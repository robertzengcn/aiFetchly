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

## Telemetry / observability fields

Installer snapshots carry `sessionId`, `state`, `nextAction`,
`planRevision`, `recoverable`, `errorCode`. Progress events are monotonic
per session. No secrets, full URLs, or repository content are ever logged.
