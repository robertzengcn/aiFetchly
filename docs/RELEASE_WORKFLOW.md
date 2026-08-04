# Release Workflow

This document explains how AiFetchly is built, signed, and published to GitHub
Releases so that installed desktop apps can auto-update through
[`update.electronjs.org`](https://update.electronjs.org).

> The legacy custom update server (`UPDATESERVER`) has been removed. The update
> source is now compiled into the app at `src/main-process/updater/AppUpdateService.ts`
> and targets the public repository `robertzengcn/aiFetchly`. There is no
> build-time update-server configuration to maintain.

## How auto-update works

1. `AppUpdateService.initializeAppUpdates()` runs once at packaged startup
   (Windows + macOS only; skipped for Microsoft Store / MSIX builds and dev runs).
2. It calls `update-electron-app` with `repo: "robertzengcn/aiFetchly"` and a
   1-hour check interval.
3. `update-electron-app` polls feeds equivalent to:
   - `https://update.electronjs.org/robertzengcn/aiFetchly/win32-x64/<version>`
   - `https://update.electronjs.org/robertzengcn/aiFetchly/darwin-x64/<version>`
   - `https://update.electronjs.org/robertzengcn/aiFetchly/darwin-arm64/<version>`
4. The service only considers the latest **non-draft, non-prerelease** GitHub
   Release whose assets satisfy the platform requirements below.

## Required release artifacts

A GitHub Release is auto-updatable only when it contains the right assets.

### Windows (Squirrel.Windows)

- `RELEASES` (non-empty)
- `*-full.nupkg` (at least one)
- `*.exe` (the Squirrel installer)
- `*-delta.nupkg` — optional, generated when available (faster updates)

These are produced by `@electron-forge/maker-squirrel`. Windows installers must
be signed with the existing `cert.pfx` certificate flow (FR-6.6).

### macOS (Squirrel.Mac)

- `*.zip` — **required**; must contain a code-signed, notarized `.app` bundle.
  Auto-update works from the ZIP, not the DMG.
- `*.dmg` — recommended for manual download.

macOS auto-update **requires** code signing and notarization (FR-7.3/7.4).
`forge.config.js` enables `osxSign` / `osxNotarize` only when the Apple secrets
below are present, so dev/test builds stay unsigned.

## Required GitHub secrets

Go to **Settings → Secrets and variables → Actions** and configure:

| Secret | Purpose | Required for |
| --- | --- | --- |
| `VITE_LOGIN_URL_PROD` (or `VITE_LOGIN_URL_TEST`) | Login URL embedded at build time | All builds |
| `CERTIFICATE_PFX_B64` | Windows signing cert (`cert.pfx`), base64-encoded | Signed Windows releases |
| `CERTIFICATE_PASSWORD` | Password for the Windows cert | Signed Windows releases |
| `OSX_SIGN_IDENTITY` | "Developer ID Application: ..." identity name | Signed macOS releases |
| `APPLE_ID` | Apple ID used for notarization | Signed macOS releases |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization | Signed macOS releases |
| `APPLE_TEAM_ID` | Apple Developer Team ID | Signed macOS releases |

`GITHUB_TOKEN` is provided automatically by GitHub Actions; no extra secret is
needed for release creation. Repository **Settings → Actions → General →
Workflow permissions** must allow **Read and write permissions**.

> If the signing secrets are absent, builds still succeed but produce **unsigned**
> artifacts, and the macOS `--strict-signing` validation step fails for tag
> releases. Configure the secrets before cutting a public release.

## Cutting a release

The workflow (`.github/workflows/release.yml`) is **tag-driven**.

1. Bump the version in `package.json` (e.g. `1.0.11` → `1.0.12`).
2. Commit the version bump.
3. Tag the commit with a SemVer tag matching the version: `git tag v1.0.12`.
4. Push the tag: `git push origin v1.0.12`.

The workflow then:

1. `prepare-release` — reads the committed `package.json` version and derives the tag.
2. `build` — builds Windows x64, macOS arm64, and macOS x64 on native-arch
   runners, signs them, and runs `scripts/validate-update-artifacts.js`
   (presence always; `--strict-signing` on macOS tag releases).
3. `publish-release` — creates a **DRAFT** GitHub Release tagged `v<version>`
   with `RELEASES`, `*.nupkg`, `*.exe`, `*.zip`, and `*.dmg` attached.

Pushes to `main` also build and validate all platforms, but do **not** publish a
release — this gives CI signal on every merge without creating releases.

## Publish the draft

Draft releases are invisible to `update.electronjs.org`, so users do not see
them until you publish:

1. Open the release on GitHub (Releases → the draft tagged `v<version>`).
2. Inspect that all required assets are attached and that the macOS ZIPs are
   signed/notarized.
3. Click **Publish release**.

Only after publishing does the release become an auto-update target.

## Artifact validation

`scripts/validate-update-artifacts.js` runs in CI after every build and fails
closed when required artifacts are missing:

```
node scripts/validate-update-artifacts.js --platform win32 --arch x64 --root out/make
node scripts/validate-update-artifacts.js --platform darwin --arch arm64 --root out/make [--strict-signing]
```

- **Windows**: requires `RELEASES` (non-empty), `*-full.nupkg`, `*.exe`; warns on
  missing `*-delta.nupkg`.
- **macOS**: requires `*.zip` containing an `.app` bundle; warns on missing
  `*.dmg`. `--strict-signing` additionally runs `codesign --verify --deep --strict`
  and `spctl -a -vv` on the extracted bundle (macOS host only).

## Versioning policy

- Every auto-updatable release must increment `package.json` (FR-8.1).
- Tags must be valid SemVer, e.g. `v1.0.12` (FR-8.2).
- Draft and prerelease releases are not treated as stable update targets.
- Downgrades are not supported; rollback means forward-fixing with a higher
  version (see the PRD rollback plan).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Users don't see an update | Release must be published (not draft/prerelease) and contain required assets. |
| Windows update silently fails | `RELEASES` / `*-full.nupkg` missing or `RELEASES` empty. |
| macOS update fails | Release has a DMG but no signed `*.zip`, or the ZIP is unsigned/not notarized. |
| macOS build is unsigned in CI | Apple signing secrets not set; `forge.config.js` skips signing without them. |
| Wrong repo in updater | `repo` is hard-coded to `robertzengcn/aiFetchly` in `AppUpdateService.ts`. |
| Microsoft Store build self-updates | Should not — gating is on `process.windowsStore` in `AppUpdateService`. |

## Security notes

- No GitHub tokens, Apple credentials, or Windows cert material are bundled into
  the app. `repo: "robertzengcn/aiFetchly"` is public metadata.
- The updater runs only in the Electron main process and never touches SQLite,
  TypeORM, Models, Modules, or IPC handlers.
- Release publication is the critical trust boundary — protect the release
  workflow with branch/tag protection and environment approvals.
