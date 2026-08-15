# Tested Installer Promotion Design

## Goal

Publish the exact Windows and macOS packages that were produced from a successful `master` build and tested by a release engineer. Promotion must not rebuild or modify the packages.

The public GitHub Release must include:

- Windows WiX installer (`.msi`)
- Windows Squirrel installer (`.exe`)
- Windows Squirrel update metadata (`RELEASES` and `.nupkg`)
- macOS installer (`.dmg`)
- macOS update archive (`.zip`)
- SHA-256 checksums for every published asset

Microsoft Store `.msix` packages remain a separate, manually selected Store build and are not part of the direct-download GitHub Release.

## Current State

`.github/workflows/release.yml` builds on pushes to `master` and also supports manual `test`, `production`, and `store` runs. The current push path builds Windows in Store mode, then creates an additional unsigned MSI for local testing. It does not configure the Squirrel maker, so no Windows `Setup.exe`, `RELEASES`, or `.nupkg` files are produced.

The workflow already contains a production-only job that creates a draft GitHub Release. That job downloads artifacts from the same workflow run, but it rebuilds packages when the manual workflow is started and currently omits `.msi` files when collecting release assets.

## Chosen Design

### 1. Produce a signed release candidate on `master`

A push to `master` will use the production direct-download Windows configuration instead of Store mode. The Windows job will require the existing signing certificate secrets and produce signed WiX and Squirrel installers from the same packaged application.

The macOS push path already uses the production signing and notarization configuration and will continue to produce the DMG and ZIP.

Manual `store` runs will continue to build the unsigned Store submission `.msix` using the Partner Center identity variables.

### 2. Add Windows Squirrel packaging

`forge.config.js` will configure `@electron-forge/maker-squirrel` for direct Windows builds only. Production Squirrel output will use the existing Windows certificate and password so both the application and installer are signed.

The existing WiX maker remains enabled. A production Windows release-candidate build therefore produces both `.msi` and `.exe`, plus the Squirrel `RELEASES` and `.nupkg` update files.

### 3. Create an immutable candidate manifest

After each platform build, the workflow will generate a machine-readable candidate manifest containing:

- application version
- source commit SHA
- source branch
- workflow run ID
- build platform and architecture
- SHA-256 checksum and filename for each artifact

Each platform artifact upload will include its manifest/checksum data. Checksums are calculated only after packaging is complete. Promotion verifies the files against this data before publishing them.

### 4. Promote a selected successful build

A separate manually dispatched workflow, named `Promote Tested Build`, will accept the source GitHub Actions run ID. It will:

1. Query the source run using GitHub's API.
2. Require that the source workflow is the release-candidate workflow, its branch is `master`, and its conclusion is `success`.
3. Download the Windows and macOS artifacts from that run.
4. Verify every artifact against the stored SHA-256 values.
5. Require the MSI, EXE, Squirrel updater files, DMG, and macOS ZIP.
6. Require Windows and macOS manifests to agree on version, commit SHA, and source run ID.
7. Create or update a draft release tagged `v<version>` at the tested commit.
8. Attach the exact verified files and a combined `SHA256SUMS.txt`.

The promotion job will never run a package or build command. It will refuse to overwrite an already-published release.

### 5. Human publication gate

Promotion creates a draft GitHub Release. The release engineer reviews its version, commit, assets, and checksum table, then uses GitHub's existing **Publish release** button to make it public.

Release notes will include the source commit and a Markdown checksum table. `SHA256SUMS.txt` will also be attached so users can verify downloads with standard command-line tools.

## Permissions and Safety

The candidate build keeps the default `contents: read` permission. The promotion workflow receives only:

- `actions: read` to inspect and download artifacts from the selected run
- `contents: write` to create the tag and draft release

Promotion validates repository-owned run metadata rather than trusting user-supplied filenames, versions, branches, or commit SHAs. Existing published releases are immutable from this workflow.

GitHub Actions artifact retention limits how long a candidate can be promoted. The workflow will report a clear error when the selected run or its artifacts have expired.

## Failure Handling

The build fails when a required installer or updater file is missing. Promotion fails before creating or changing a release when:

- the run does not exist, is not successful, or was not built from `master`
- an artifact is missing or expired
- a checksum does not match
- platform manifests disagree
- a required file type is absent
- the target version is already published

An existing draft for the same version may be refreshed only with assets verified from the same source commit and run.

## Verification

Automated verification will cover:

- workflow YAML parsing
- direct, Store, and macOS maker selection in Forge configuration
- candidate manifest/checksum generation using fixture artifacts
- rejection of missing files, changed files, mismatched manifests, non-`master` runs, and unsuccessful runs
- release asset collection including `.msi`, `.exe`, `RELEASES`, `.nupkg`, `.dmg`, `.zip`, and `SHA256SUMS.txt`

The first end-to-end operational check will run the candidate workflow on `master`, verify Windows signatures and macOS notarization, download and install both packages, run the promotion workflow with that run ID, compare published asset hashes with the downloaded candidates, and then publish the draft manually.

## Success Criteria

- The Windows master build produces signed MSI and Squirrel installers plus updater metadata.
- The macOS master build produces signed/notarized DMG and ZIP files.
- A release engineer can promote a successful master run by run ID without rebuilding.
- Every GitHub Release asset is byte-for-byte identical to the tested candidate.
- Users can verify every published download using SHA-256 values shown in the release and attached as `SHA256SUMS.txt`.
- Microsoft Store packaging remains available through the manual `store` build mode.
