# Manual Release Build Workflow

The `.github/workflows/release.yml` workflow builds Windows and macOS installers (plus downloadable local-AI runtimes) on demand. For **production** builds it also runs a `publish-github-release` job that validates the auto-update assets and attaches them to a GitHub Release that is **published immediately**, so installed apps can auto-update via `update.electronjs.org`. The human gate is triggering the production build itself. Test builds only retain installers as GitHub Actions artifacts for manual download and testing; they never publish a release.

## Running a build

1. Open the repository's **Actions** tab.
2. Select **Manual Release Build**.
3. Choose **Run workflow**.
4. Select a build mode:
   - `test` (default): uses test services and creates unsigned installers for manual testing.
   - `production`: uses production services and requires signing credentials.
5. Download the Windows and macOS artifacts after both jobs pass.

Only final installer formats are uploaded (plus the Squirrel auto-update assets the updater needs):

- Windows: `.exe`, `.msi`, `RELEASES`, and `*.nupkg`
- macOS: `.dmg` and `.zip`

The workflow never uploads the entire `out/make` directory. Production builds publish a **draft** GitHub Release automatically (see [GitHub Auto-Update](#github-auto-update)); test builds never publish a release.

## Required GitHub Actions secrets

Test builds require:

- `VITE_LOGIN_URL_TEST`

Production builds require:

- `VITE_LOGIN_URL_PROD`
- `MACOS_CERTIFICATE_BASE64`: base64-encoded Apple Developer ID `.p12` certificate
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Windows code signing is currently **optional and disabled** — no
`WINDOWS_CERTIFICATE_BASE64` / `WINDOWS_CERTIFICATE_PASSWORD` secrets are set.
`forge.config.js` signs automatically whenever `cert.pfx` and
`CERTIFICATE_PASSWORD` are both present, so adding the secrets (and restoring
the certificate-restore step in `release.yml`) re-enables signing without
further code changes. Unsigned installers trigger a Windows SmartScreen
warning.

Missing secrets fail the corresponding job before packaging. The certificates are restored only on ephemeral GitHub-hosted runners and are not uploaded as artifacts.

## Build guarantees

- Dependencies are installed from `yarn.lock` with `--frozen-lockfile`.
- Native modules are rebuilt against the lockfile-installed Electron version using targeted rebuilds.
- Native rebuild failures stop the job instead of being ignored.
- Windows production installers are signed only when a signing certificate is available (currently disabled; see above).
- macOS production applications are signed and notarized before the DMG and ZIP makers run.
- Artifact upload fails if no expected installer is produced.

## Publishing manually

Production builds create and **publish** a GitHub Release (tagged `v<version>`) with the validated installer and auto-update assets attached — no manual publish step remains. To retract a bad release, run `gh release edit <tag> --draft=true` (hides it from the auto-updater) or delete it. Do not attach build logs, unpacked application directories, intermediate packages, or the full `out/make` directory.

## GitHub Auto-Update

Installed Windows and macOS apps self-update from GitHub Releases via `update-electron-app` (configured in `src/main-process/updater/AppUpdateService.ts`), targeting the public repository `robertzengcn/aiFetchly`. The updater polls feeds equivalent to:

- `https://update.electronjs.org/robertzengcn/aiFetchly/win32-x64/<version>`
- `https://update.electronjs.org/robertzengcn/aiFetchly/darwin-arm64/<version>`

The updater considers only the latest **non-draft, non-prerelease** GitHub Release whose assets satisfy the platform requirements below. Microsoft Store / MSIX builds skip the GitHub updater entirely (`process.windowsStore`).

### Required release assets

- **Windows (Squirrel.Windows):** `RELEASES` (non-empty), `*-full.nupkg`, and the `*.exe` installer. `*-delta.nupkg` is optional.
- **macOS (Squirrel.Mac):** a signed, notarized `*.zip` containing the `.app` bundle (the updater requires ZIP, not only DMG). `*.dmg` is for manual download.

The `publish-github-release` job runs `scripts/validate-update-artifacts.js` and fails closed if any required asset is missing or invalid.

### Versioning caveat

`update.electronjs.org` requires strict SemVer release tags. The build pipeline currently derives versions from the GitHub run number (e.g. `1.0.11.42` → tag `v1.0.11.42`), which is **not** strict SemVer and may not be served by the public updater. For auto-update to work, publish releases with strict SemVer tags (e.g. `v1.0.12`) — bump `package.json` to a clean SemVer version before triggering a production build, or retag the draft release before publishing.

### Legacy `UPDATESERVER`

Removed. The build pipeline no longer writes or requires `UPDATESERVER`/`UPDATESERVER_PROD` secrets; auto-update is sourced exclusively from GitHub Releases via `update.electronjs.org`.
