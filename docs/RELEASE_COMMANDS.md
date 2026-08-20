# Release & Package Build Commands

Quick reference for building Windows/macOS packages (direct installers and
Store submissions) and publishing GitHub Releases, via GitHub Actions or
locally. Workflow definition: `.github/workflows/release.yml`.

## Quick reference

| Goal | Command |
|---|---|
| Production installers + **auto-published** GitHub Release | `gh workflow run release.yml -f build_mode=production` |
| Store submission packages (Windows MSIX + macOS PKG) | `gh workflow run release.yml -f build_mode=store` |
| Test installers (test backend, unsigned) | `gh workflow run release.yml -f build_mode=test` |
| Watch a run | `gh run watch` |
| Download a run's artifacts | `gh run download <run-id>` |

All `gh workflow run` commands accept `--ref <branch>` (default: the branch's
HEAD you run from; use `master` for releases).

---

## 1. Store submission packages (`build_mode=store`)

Produces **unsigned** submission packages for both Stores:

- **Windows**: `.msix` — Microsoft re-signs it after Partner Center
  certification, so no code-signing certificate is needed.
- **macOS**: `.pkg` — signed with the Mac Installer Distribution certificate
  for direct upload to App Store Connect.

### Build and retrieve

```bash
# 1. Trigger (or use Actions UI: "Manual Release Build" → build_mode=store)
gh workflow run release.yml --ref master -f build_mode=store

# 2. Watch progress
gh run watch

# 3. List artifacts of the finished run
gh run view <run-id> --json jobs  # or open the run URL printed by `gh run watch`

# 4. Download both store artifacts
gh run download <run-id> -n electron-app-windows-store-v<version>
gh run download <run-id> -n electron-app-macos-store-v<version>
```

### Submit to the Stores (manual, outside CI)

- **Microsoft Store**: Partner Center → your app → **Packages** → upload the
  `.msix`. Details: `docs/windows-store-publishing.md`.
- **Mac App Store**: App Store Connect → your app → **Activities/Builds** (or
  Transporter app) → upload the `.pkg`.

A push to `master` also builds the Windows Store package automatically (plus a
validation MSI), but never publishes anything.

### Required repository configuration

- Variables (Partner Center → Product identity, see
  `docs/windows-store-publishing.md`): `WINDOWS_STORE_PACKAGE_IDENTITY`,
  `WINDOWS_STORE_PUBLISHER`, `WINDOWS_STORE_PUBLISHER_DISPLAY_NAME`.
- Secrets: `VITE_LOGIN_URL_PROD` and the full Apple signing set
  (`APPLE_DISTRIBUTION_CERTIFICATE_BASE64`,
  `MAC_INSTALLER_DISTRIBUTION_CERTIFICATE_BASE64`,
  `MAC_STORE_PROVISIONING_PROFILE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`,
  `MAC_STORE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`).

---

## 2. Production installers + GitHub Release (`build_mode=production`)

```bash
gh workflow run release.yml --ref master -f build_mode=production
gh run watch   # wait for build-windows, build-macos, publish-github-release
```

This is the **release** path. The final `publish-github-release` job:

1. Validates auto-update artifacts (`scripts/validate-update-artifacts.js`):
   Windows `RELEASES` + `*-full.nupkg` + `.exe`; macOS signed `.zip` + `.dmg`.
2. Collects installers + local-AI-runtime catalog.
3. Creates the release tagged `v<version>` and **publishes it immediately**
   (no draft step). Once published, `update.electronjs.org` serves it to
   installed apps via `update-electron-app`.

> The human gate is the `workflow_dispatch` production trigger itself — the
> release goes live the moment the build passes. If you want to inspect
> artifacts first, download them from the run page while it runs, or trigger
> `test` mode instead.

### Required secrets (production)

- `VITE_LOGIN_URL_PROD`
- `MACOS_CERTIFICATE_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (macOS signing/notarization —
  still required)

**Windows signing is currently disabled** (no certificate available). The
production Windows `.exe`/`.msi` are built unsigned; Windows will show a
SmartScreen warning ("unknown publisher") when users install them. To
re-enable, add secrets `WINDOWS_CERTIFICATE_BASE64` (base64 `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD` and restore the certificate-restore step in
`release.yml` — `forge.config.js` signs automatically whenever `cert.pfx` +
`CERTIFICATE_PASSWORD` are present.

### Version caveat

The build derives the version from the run number (e.g. `1.0.11.42`), which is
**not strict SemVer**; `update.electronjs.org` may not serve such tags. For
auto-update to work end-to-end, bump `package.json` to a clean SemVer version
before triggering the production build (the run-number suffix then produces
`1.0.12.N` — still non-strict, so prefer coordinating the tag manually or
retagging). See `docs/RELEASE_WORKFLOW.md` § Versioning caveat.

---

## 3. Managing GitHub Releases (`gh` CLI)

```bash
gh release list                              # all releases
gh release view v1.0.12                      # one release + assets
gh release download v1.0.12                  # download assets
gh release download v1.0.12 -p '*.exe'       # filter by pattern
gh release edit v1.0.12 --draft=false        # publish a draft
gh release edit v1.0.12 --draft=true         # unpublish back to draft
gh release delete v1.0.12 --yes              # delete (also delete the tag)
gh release create v1.0.13 ./out/make/**/*.exe --title "AiFetchly v1.0.13" --generate-notes
gh release upload v1.0.13 ./new-asset.zip --clobber   # add/replace assets
```

Rollback of a bad release: `gh release edit <tag> --draft=true` immediately
hides it from the updater, then fix or `gh release delete` it.

---

## 4. Local builds (no CI)

Run on the matching OS (`package.json` scripts):

| Command | Output |
|---|---|
| `yarn make-win:test` | Windows test installers (Squirrel `.exe` + MSI) |
| `yarn make-win:prod` | Windows production installers (signed only if `cert.pfx` + `CERTIFICATE_PASSWORD` set) |
| `yarn make-win:store` | Windows Store `.msix` (needs `WINDOWS_STORE_*` env vars) |
| `yarn make-mac:test` | macOS test `.zip` (+ `.dmg` when `MAKE_MAC_DMG=true`) |
| `yarn make-mac:prod` | macOS signed+notarized `.zip`/`.dmg` (needs Apple env vars) |
| `yarn package-mac:store` | Mac App Store `.app` (then `yarn verify-mac:store <path>`) |

Local env for store/prod builds mirrors the CI secrets (see the job steps in
`release.yml` for the exact variable list). Output lands in `out/make/`.

Forge-native publishing (`yarn publish` / `electron-forge publish`, configured
in `forge.config.js` → `publishers`) uploads to GitHub Releases as **draft** —
safe for local use; CI uses the `publish-github-release` job instead.

---

## Related docs

- `docs/RELEASE_WORKFLOW.md` — full workflow guarantees, secrets, auto-update feed details
- `docs/windows-store-publishing.md` — Microsoft Store submission walkthrough
- `docs/gh_release_package.md` — local-AI-runtime release commands
