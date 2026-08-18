# Tested Installer Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build signed direct-download release candidates on `master` and promote the exact tested MSI, EXE, Squirrel updater files, DMG, and ZIP to a draft GitHub Release with verified SHA-256 hashes.

**Architecture:** The existing release build becomes a candidate producer only. A dependency-free Node.js manifest tool hashes and verifies platform artifacts, while a separate manually dispatched workflow validates a selected successful `master` run, downloads its artifacts without rebuilding, prepares release assets, and creates a draft release at the tested commit.

**Tech Stack:** GitHub Actions YAML, Electron Forge 7, `@electron-forge/maker-squirrel`, dependency-free Node.js CommonJS scripts, Mocha/Chai, `js-yaml`, GitHub CLI.

## Global Constraints

- Promotion must publish the exact bytes from the selected successful `master` run and must never invoke a build or packaging command.
- Direct Windows candidates must include signed `.msi` and Squirrel `.exe` installers plus `RELEASES` and `*-full.nupkg`.
- macOS candidates must include signed/notarized `.dmg` and `.zip` files.
- The public release must attach a combined `SHA256SUMS.txt` and show SHA-256 values in its notes.
- Manual Microsoft Store builds must remain available as unsigned `.msix` packages using Partner Center identity variables.
- Promotion may refresh a draft only for the same source run and commit; it must never overwrite a published release.
- Use explicit types in TypeScript tests; never introduce `any`.

---

### Task 1: Immutable release-candidate manifests

**Files:**
- Create: `scripts/release-candidate-manifest.js`
- Create: `test/modules/releaseCandidateManifest.test.ts`

**Interfaces:**
- Produces `create --platform <win32|darwin> --arch <arch> --root <dir> --output <file> --version <version> --commit <sha> --branch <branch> --run-id <id>`.
- Produces `prepare --windows-root <dir> --macos-root <dir> --output <dir> --checksums <file> --notes <file> --metadata <file>`.
- JSON schema version `1` stores build identity plus sorted `{ fileName, relativePath, sha256, size }` entries.

- [ ] **Step 1: Write failing creation tests**

Create temporary Windows/macOS fixture trees and invoke the CLI with `spawnSync(process.execPath, args)`. Define this test-only type and assert complete fixtures produce deterministic hashes while missing MSI, EXE, `RELEASES`, full NUPKG, DMG, or ZIP files fail:

```ts
interface CandidateManifest {
  schemaVersion: 1;
  version: string;
  commit: string;
  branch: string;
  runId: string;
  platform: "win32" | "darwin";
  arch: string;
  files: Array<{
    fileName: string;
    relativePath: string;
    sha256: string;
    size: number;
  }>;
}
```

- [ ] **Step 2: Verify the creation tests fail**

Run: `yarn test test/modules/releaseCandidateManifest.test.ts`

Expected: FAIL because the manifest script does not exist.

- [ ] **Step 3: Implement manifest creation**

Implement dependency-free argument parsing, recursive collection, SHA-256 hashing, required-file validation, duplicate-basename rejection, deterministic sorting, and atomic JSON output. Windows allowlists MSI, non-uninstaller EXE, `RELEASES`, and NUPKG; macOS allowlists DMG and ZIP.

- [ ] **Step 4: Verify creation tests pass**

Run: `yarn test test/modules/releaseCandidateManifest.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing preparation tests**

Assert `prepare` rejects changed bytes, mismatched version/commit/branch/run ID, and duplicate output names. Assert success copies byte-identical fixtures and writes sorted GNU-style `<sha256>  <filename>` lines, a Markdown checksum table, and machine-readable promotion metadata.

- [ ] **Step 6: Verify preparation tests fail**

Run: `yarn test test/modules/releaseCandidateManifest.test.ts`

Expected: FAIL because `prepare` is not implemented.

- [ ] **Step 7: Implement preparation**

Verify both manifests before creating output. Recalculate every hash and size, compare build identity, copy with exclusive creation, then write checksums, release notes with source markers, and metadata only after all validation succeeds.

- [ ] **Step 8: Verify and commit Task 1**

Run: `yarn test test/modules/releaseCandidateManifest.test.ts`

Expected: PASS.

```bash
git add scripts/release-candidate-manifest.js test/modules/releaseCandidateManifest.test.ts
git commit -m "feat: verify immutable release candidate artifacts"
```

### Task 2: Signed Windows Squirrel and WiX candidates

**Files:**
- Modify: `forge.config.js:592-784`
- Modify: `test/modules/forgeWindowsStorePackaging.test.ts`

**Interfaces:**
- Consumes existing `isProductionBuild`, `isWindowsStoreBuild`, `windowsCertificatePath`, and `CERTIFICATE_PASSWORD` values.
- Produces direct Windows makers `@electron-forge/maker-squirrel` and `@electron-forge/maker-wix`.
- Preserves Store-only `@electron-forge/maker-msix` with `sign: false`.

- [ ] **Step 1: Write failing maker-selection tests**

Load Forge under isolated environments and clear its module cache between loads. Assert production/direct has signed Squirrel and WiX but no MSIX; production/store has unsigned MSIX but no direct installers; test/direct has unsigned Squirrel and WiX. Require Squirrel metadata:

```ts
{
  name: "aifetchly",
  authors: "Robert Zeng",
  description: "AI-powered marketing automation",
  setupIcon: "./src/assets/images/icon.ico"
}
```

- [ ] **Step 2: Verify maker-selection tests fail**

Run: `yarn test test/modules/forgeWindowsStorePackaging.test.ts`

Expected: FAIL because Squirrel is absent and direct makers are not isolated from Store builds.

- [ ] **Step 3: Configure Squirrel and direct WiX selection**

Add `@electron-forge/maker-squirrel` and WiX only when `!isWindowsStoreBuild`. Apply the existing production certificate file/password condition to both. Preserve unsigned MSIX for Store builds.

- [ ] **Step 4: Verify and commit Task 2**

Run: `yarn test test/modules/forgeWindowsStorePackaging.test.ts`

Expected: PASS.

```bash
git add forge.config.js test/modules/forgeWindowsStorePackaging.test.ts
git commit -m "feat: build signed Windows release installers"
```

### Task 3: Make the master workflow a candidate producer

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `test/modules/forgeWindowsStorePackaging.test.ts`
- Create: `test/modules/releaseCandidateWorkflow.test.ts`

**Interfaces:**
- Consumes Task 1 `create` command.
- Produces `electron-app-windows-production-v<version>` and `electron-app-macos-production-v<version>` artifacts on `master` pushes.
- Includes `windows-manifest.json` or `macos-manifest.json` with each platform artifact.

- [ ] **Step 1: Write failing workflow tests**

Parse the workflow with `js-yaml`. Assert master uses Windows production/direct, Store remains manual, the unsigned push-only MSI step is absent, both platforms validate artifacts and create manifests using GitHub SHA/ref/run ID, uploads include manifests, and no job creates a GitHub Release.

- [ ] **Step 2: Verify workflow tests fail**

Run: `yarn test test/modules/forgeWindowsStorePackaging.test.ts test/modules/releaseCandidateWorkflow.test.ts`

Expected: FAIL against current Store-on-push and same-run publication behavior.

- [ ] **Step 3: Update Windows candidate production**

Route pushes through production/direct, restore signing credentials, remove the unsigned MSI step, validate MSI/EXE/Squirrel output, create `out/release-candidate/windows-manifest.json`, and upload it with the installers.

- [ ] **Step 4: Update macOS candidate production**

Keep push builds production-signed/notarized, run strict artifact validation, create `out/release-candidate/macos-manifest.json`, and upload it with DMG/ZIP.

- [ ] **Step 5: Remove same-run publication**

Remove `publish-github-release`. Candidate workflows stop after artifact upload. Preserve manual `test`, `production`, and `store` packaging modes.

- [ ] **Step 6: Verify and commit Task 3**

Run: `yarn test test/modules/forgeWindowsStorePackaging.test.ts test/modules/releaseCandidateWorkflow.test.ts`

Expected: PASS.

```bash
git add .github/workflows/release.yml test/modules/forgeWindowsStorePackaging.test.ts test/modules/releaseCandidateWorkflow.test.ts
git commit -m "feat: produce promotable release candidates on master"
```

### Task 4: Promote the selected tested run

**Files:**
- Create: `.github/workflows/promote-tested-build.yml`
- Create: `test/modules/releasePromotionWorkflow.test.ts`

**Interfaces:**
- Consumes required manual input `run_id`.
- Consumes Task 1 `prepare` and the two candidate artifacts.
- Produces a draft `v<version>` release targeted at the tested commit.

- [ ] **Step 1: Write failing promotion workflow tests**

Assert the workflow is manual-only, grants exactly `actions: read` and `contents: write`, queries the selected run, requires the release workflow path/event/master/success/repository, checks out the verified SHA, downloads only both production artifact patterns, invokes `prepare`, rejects published tags, refreshes only same-source drafts, targets the tested commit, attaches prepared assets, and contains no packaging command.

- [ ] **Step 2: Verify the promotion test fails**

Run: `yarn test test/modules/releasePromotionWorkflow.test.ts`

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Implement source-run validation and download**

Create `Promote Tested Build`. Validate numeric run ID, fetch run JSON with `gh api`, fail closed on metadata mismatch, expose verified SHA, check out that commit, and download only Windows/macOS production artifact patterns from that run.

- [ ] **Step 4: Implement draft creation**

Run Task 1 preparation, load metadata outputs, and create a draft with `--target <tested-sha>`, generated notes, and all assets. For an existing draft, require same-run and same-commit marker lines before uploading with `--clobber`; reject published releases.

- [ ] **Step 5: Verify and commit Task 4**

Run: `yarn test test/modules/releasePromotionWorkflow.test.ts`

Expected: PASS.

```bash
git add .github/workflows/promote-tested-build.yml test/modules/releasePromotionWorkflow.test.ts
git commit -m "feat: promote an exact tested build to GitHub Releases"
```

### Task 5: Integrated verification

**Files:**
- Verify only; modify earlier files only if a check exposes a defect.

- [ ] **Step 1: Run focused release tests**

Run: `yarn test test/modules/releaseCandidateManifest.test.ts test/modules/forgeWindowsStorePackaging.test.ts test/modules/releaseCandidateWorkflow.test.ts test/modules/releasePromotionWorkflow.test.ts`

Expected: all pass.

- [ ] **Step 2: Parse workflows and run type checks**

Run: `node -e "const fs=require('fs');const yaml=require('js-yaml');for(const file of ['.github/workflows/release.yml','.github/workflows/promote-tested-build.yml']) yaml.load(fs.readFileSync(file,'utf8'));" && yarn typecheck && yarn vue-typecheck`

Expected: YAML parses and both type checks succeed.

- [ ] **Step 3: Run lint and inspect repository state**

Run: `yarn lint && git diff --check HEAD~4..HEAD && git status --short`

Expected: no lint errors, no whitespace errors, and only intentional changes.

- [ ] **Step 4: Provide operational handoff**

Final instructions: push to `master`; wait for `Manual Release Build`; download and test both artifacts; copy the successful run ID; run `Promote Tested Build`; review hashes/assets in the draft; click **Publish release**.
