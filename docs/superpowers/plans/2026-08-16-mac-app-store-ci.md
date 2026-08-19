# Mac App Store CI Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a manually dispatched `store` release build produce a signed Mac App Store `.pkg` for manual Transporter upload.

**Architecture:** Keep the existing direct macOS release job unchanged and add a dedicated `build-macos-store` job. The job imports application and installer certificates into a temporary keychain, decodes the provisioning profile, builds a distribution-signed Electron `mas` app, creates and verifies a signed flat installer, and uploads only the `.pkg`.

**Tech Stack:** GitHub Actions YAML, Electron Forge 7, `@electron/osx-sign`, macOS `security`, `codesign`, `productbuild`, `pkgutil`, Mocha/Chai, `js-yaml`.

## Global Constraints

- The Store job runs only for `workflow_dispatch` with `build_mode=store`.
- The app bundle identifier remains exactly `com.aifetchly.desktop`.
- MAS app signing uses `type: "distribution"`.
- The existing Developer ID signing and notarization path remains unchanged.
- Credentials and decoded files exist only under `RUNNER_TEMP`.
- Upload remains manual; CI does not send a build to App Store Connect.
- The temporary signing keychain is removed under `always()`.

---

### Task 1: Distribution signing contract

**Files:**
- Modify: `test/modules/forgeMacStorePackaging.test.ts`
- Modify: `forge.config.js`

**Interfaces:**
- Consumes: `MAC_DISTRIBUTION=store`, `MAC_STORE_SIGNING_IDENTITY`, and `MAC_STORE_PROVISIONING_PROFILE`.
- Produces: `packagerConfig.osxSign.type === "distribution"` for Store builds.

- [ ] **Step 1: Update the Forge test to require distribution signing**

Change the MAS test identity to an Apple Distribution identity and assert:

```typescript
expect(result.projection?.type).to.equal("distribution");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
yarn test test/modules/forgeMacStorePackaging.test.ts
```

Expected: FAIL because `forge.config.js` still returns `type: "development"`.

- [ ] **Step 3: Implement the minimal configuration change**

Set the Store signing option in `forge.config.js` to:

```javascript
type: "distribution",
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 test again. Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add forge.config.js test/modules/forgeMacStorePackaging.test.ts
git commit -m "fix: use distribution signing for Mac App Store builds"
```

### Task 2: GitHub Actions Store package job

**Files:**
- Create: `test/modules/macAppStoreReleaseWorkflow.test.ts`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: the eight documented GitHub Actions secrets and the existing `package-mac:store` and `verify-mac:store` commands.
- Produces: the `build-macos-store` job and `out/mac-app-store/AiFetchly-mac-app-store-<version>.pkg` artifact.

- [ ] **Step 1: Write a failing workflow contract test**

Parse `release.yml` with `js-yaml`, locate `jobs.build-macos-store`, and assert its condition, secret wiring, Store build command, verification command, `productbuild`, `.pkg` upload path, and `always()` cleanup condition.

- [ ] **Step 2: Run the workflow test and verify RED**

Run:

```bash
yarn test test/modules/macAppStoreReleaseWorkflow.test.ts
```

Expected: FAIL because `build-macos-store` does not exist.

- [ ] **Step 3: Add the Store job**

Copy the native macOS setup used by `build-macos`, then add credential validation and decoding, temporary keychain creation, identity checks, Store packaging, signed `.pkg` creation, signature validation, artifact upload, and `always()` cleanup.

Use these build commands:

```bash
yarn package-mac:store
yarn verify-mac:store "$app_path"
productbuild --component "$app_path" /Applications --sign "$installer_identity" "$pkg_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
pkgutil --check-signature "$pkg_path"
```

- [ ] **Step 4: Run the workflow test and verify GREEN**

Run the Task 2 test again. Expected: all cases pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml test/modules/macAppStoreReleaseWorkflow.test.ts
git commit -m "ci: build signed Mac App Store package"
```

### Task 3: Cross-check release configuration

**Files:**
- Modify only files required to fix failures directly caused by Tasks 1-2.

**Interfaces:**
- Consumes: completed Forge and workflow changes.
- Produces: fresh verification evidence and a clean committed worktree.

- [ ] **Step 1: Run focused Store tests together**

```bash
yarn test test/modules/forgeMacStorePackaging.test.ts test/modules/verifyMacStoreApp.test.ts test/modules/macAppStoreReleaseWorkflow.test.ts
```

- [ ] **Step 2: Parse the workflow independently**

```bash
node -e "const fs=require('fs'); const yaml=require('js-yaml'); yaml.load(fs.readFileSync('.github/workflows/release.yml','utf8')); console.log('release.yml parsed')"
```

- [ ] **Step 3: Run repository verification**

```bash
yarn lint
yarn typecheck
yarn vue-typecheck
git diff --check
```

Expected: zero errors; existing lint warnings may remain.

- [ ] **Step 4: Inspect committed state**

Confirm no certificate, provisioning profile, password, generated `.app`, or
generated `.pkg` is tracked. Confirm all logical units are committed.
