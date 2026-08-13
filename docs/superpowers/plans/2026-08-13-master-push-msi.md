# Master Push MSI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every push to `master` publish an unsigned, production-configured Windows MSI in the same workflow artifact as the existing Store MSIX.

**Architecture:** Keep the existing Store packaging pass as the source of the packaged Windows application. On `master` pushes, install WiX, invoke only the WiX maker with `--skip-package`, then explicitly verify that both MSI and MSIX files exist before artifact upload.

**Tech Stack:** GitHub Actions YAML, Electron Forge 7, Electron Forge WiX and MSIX makers, Mocha/Chai, `js-yaml`.

## Global Constraints

- Keep manual Store builds MSIX-only.
- Keep the added MSI unsigned and production-configured.
- Reuse the packaged Windows application; do not run a second packaging pass.
- Upload the MSI and MSIX in the same Windows workflow artifact.
- Do not modify unrelated files already present in the working tree.

---

### Task 1: Add Master Push MSI Workflow Coverage

**Files:**
- Modify: `test/modules/forgeWindowsStorePackaging.test.ts`

**Interfaces:**
- Consumes: `.github/workflows/release.yml` as parsed YAML.
- Produces: Regression coverage for the `build-windows` step conditions, commands, validation, and uploaded paths.

- [ ] **Step 1: Write the failing test**

Add a test that parses the workflow with `js-yaml`, locates `jobs.build-windows.steps`, and asserts these observable workflow contracts:

```typescript
expect(stepByName("Install WiX Toolset").if).to.equal(
  "github.event_name == 'push' || env.BUILD_MODE != 'store'"
);
expect(stepByName("Build MSI for local testing").if).to.equal(
  "github.event_name == 'push'"
);
expect(stepByName("Build MSI for local testing").run).to.include(
  "electron-forge make --skip-package --platform=win32 --targets @electron-forge/maker-wix"
);
expect(stepByName("Validate master Windows installers").run).to.include(
  "Get-ChildItem -Path out/make -Recurse -Filter *.msix"
);
expect(stepByName("Validate master Windows installers").run).to.include(
  "Get-ChildItem -Path out/make -Recurse -Filter *.msi"
);
expect(uploadStep.with.path).to.include("out/make/**/*.msix");
expect(uploadStep.with.path).to.include("out/make/**/*.msi");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node scripts/run-module-tests.js test/modules/forgeWindowsStorePackaging.test.ts
```

Expected: FAIL because the `Build MSI for local testing` and `Validate master Windows installers` steps do not exist and the WiX condition still excludes Store-mode pushes.

- [ ] **Step 3: Commit the regression test together with Task 2**

The test describes behavior that does not exist yet, so keep it uncommitted until the implementation passes.

### Task 2: Generate and Validate MSI on Master Pushes

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `test/modules/forgeWindowsStorePackaging.test.ts`

**Interfaces:**
- Consumes: the packaged Windows application created by `yarn make-win:store`.
- Produces: `out/make/**/*.msi` alongside `out/make/**/*.msix` on push events.

- [ ] **Step 1: Expand the WiX installation condition**

Use this condition on `Install WiX Toolset`:

```yaml
if: ${{ github.event_name == 'push' || env.BUILD_MODE != 'store' }}
```

- [ ] **Step 2: Add the MSI maker pass after application verification**

Add this push-only step after `Build application`:

```yaml
- name: Build MSI for local testing
  if: ${{ github.event_name == 'push' }}
  shell: bash
  run: |
    set -euo pipefail
    yarn electron-forge make --skip-package --platform=win32 --targets @electron-forge/maker-wix
```

The job-level `NODE_ENV=production` environment written earlier and `WINDOWS_DISTRIBUTION=store` keep the package production-configured while suppressing direct-distribution certificate requirements.

- [ ] **Step 3: Require both installer formats before upload**

Add this push-only PowerShell step before `Upload Windows installers`:

```yaml
- name: Validate master Windows installers
  if: ${{ github.event_name == 'push' }}
  shell: pwsh
  run: |
    $msixFiles = @(Get-ChildItem -Path out/make -Recurse -Filter *.msix)
    $msiFiles = @(Get-ChildItem -Path out/make -Recurse -Filter *.msi)
    if ($msixFiles.Count -eq 0) {
      throw "Master build did not produce an MSIX package."
    }
    if ($msiFiles.Count -eq 0) {
      throw "Master build did not produce an MSI package."
    }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node scripts/run-module-tests.js test/modules/forgeWindowsStorePackaging.test.ts
```

Expected: all Windows Store packaging tests pass.

- [ ] **Step 5: Validate YAML parsing and whitespace**

Run:

```bash
node -e "require('js-yaml').load(require('node:fs').readFileSync('.github/workflows/release.yml', 'utf8')); console.log('release.yml parsed')"
git diff --check -- .github/workflows/release.yml test/modules/forgeWindowsStorePackaging.test.ts
```

Expected: YAML parser prints `release.yml parsed`; diff check exits with status 0.

- [ ] **Step 6: Commit the implementation**

```bash
git add .github/workflows/release.yml test/modules/forgeWindowsStorePackaging.test.ts
git commit -m "feat(ci): generate MSI for master push testing"
```
