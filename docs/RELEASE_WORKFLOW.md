# Manual Release Build Workflow

The `.github/workflows/release.yml` workflow builds Windows and macOS installers (plus downloadable local-AI runtimes) on demand. For **production** builds it also runs a `publish-github-release` job that validates the auto-update assets and attaches them to a **DRAFT** GitHub Release so installed apps can auto-update via `update.electronjs.org`. Test builds only retain installers as GitHub Actions artifacts for manual download and testing. Draft releases stay invisible to the auto-updater until a release engineer publishes them manually.

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
- `UPDATESERVER`

Production builds require:

- `VITE_LOGIN_URL_PROD`
- `UPDATESERVER_PROD`
- `WINDOWS_CERTIFICATE_BASE64`: base64-encoded Windows `.pfx` signing certificate
- `WINDOWS_CERTIFICATE_PASSWORD`
- `MACOS_CERTIFICATE_BASE64`: base64-encoded Apple Developer ID `.p12` certificate
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Missing secrets fail the corresponding job before packaging. The certificates are restored only on ephemeral GitHub-hosted runners and are not uploaded as artifacts.

## Build guarantees

- Dependencies are installed from `yarn.lock` with `--frozen-lockfile`.
- Native modules are rebuilt against the lockfile-installed Electron version using targeted rebuilds.
- Native rebuild failures stop the job instead of being ignored.
- Windows production installers are signed using the restored `.pfx` certificate.
- macOS production applications are signed and notarized before the DMG and ZIP makers run.
- Artifact upload fails if no expected installer is produced.

## Publishing manually

Production builds already create a **draft** GitHub Release (tagged `v<version>`) with the validated installer and auto-update assets attached. After inspecting the draft, publish it from the GitHub Releases UI so it becomes visible to the auto-updater. Do not attach build logs, unpacked application directories, intermediate packages, or the full `out/make` directory.

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

The build pipeline still writes `UPDATESERVER`/`UPDATESERVER_PROD` into `.env` (and fails without them), but the runtime no longer reads them — auto-update is sourced exclusively from GitHub Releases. These secrets remain only to satisfy the legacy build step and can be removed once the `.env` writing in `release.yml` is dropped.
