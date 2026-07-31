# Manual Release Build Workflow

The `.github/workflows/release.yml` workflow builds Windows and macOS installers on demand. It does not create tags or GitHub Releases. Successful installers are retained as GitHub Actions artifacts so they can be downloaded, tested, and released manually.

## Running a build

1. Open the repository's **Actions** tab.
2. Select **Manual Release Build**.
3. Choose **Run workflow**.
4. Select a build mode:
   - `test` (default): uses test services and creates unsigned installers for manual testing.
   - `production`: uses production services and requires signing credentials.
5. Download the Windows and macOS artifacts after both jobs pass.

Only final installer formats are uploaded:

- Windows: `.exe` and `.msi`
- macOS: `.dmg` and `.zip`

The workflow never uploads the entire `out/make` directory and never publishes a release automatically.

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

After testing the downloaded installers, create the GitHub Release manually and attach only the approved installer assets. Do not attach build logs, unpacked application directories, intermediate packages, or the full `out/make` directory.
