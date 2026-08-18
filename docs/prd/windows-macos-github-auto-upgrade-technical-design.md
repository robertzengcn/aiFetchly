# Windows and macOS GitHub Auto Upgrade - Technical Design

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Draft |
| Created | 2026-08-01 |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/windows-macos-github-auto-upgrade-prd.md` |
| Target platforms | Windows x64, macOS x64, macOS arm64 |
| Primary implementation language | TypeScript 5.x |
| Primary runtime | Electron 35.x / Node.js |
| Public repository | `https://github.com/robertzengcn/aiFetchly` |
| Update client | `update-electron-app@3.x` |
| Update service | `https://update.electronjs.org` |

## 1. Purpose

This document translates the Windows and macOS GitHub Auto Upgrade PRD into an implementation-ready design.

The implementation replaces AiFetchly's legacy custom update-server path with GitHub Releases based auto-updates through `update-electron-app`. The old runtime logic that reads `UPDATESERVER`, builds a custom feed URL, calls `autoUpdater.setFeedURL()`, and directly calls `autoUpdater.checkForUpdates()` must be removed.

The design covers:

- Main-process updater service architecture
- Windows Squirrel startup handling
- `update-electron-app` configuration for `robertzengcn/aiFetchly`
- Electron Forge dependency and publisher changes
- Windows Squirrel release artifact requirements
- macOS signed ZIP release artifact requirements
- GitHub Actions release workflow changes
- Tests, static checks, and manual upgrade verification
- Microsoft Store/MSIX channel isolation
- Rollout and rollback plan

The design intentionally does not move AiFetchly from Electron Forge to Electron Builder and does not use `electron-updater`.

## 2. Requirements Summary

The implementation must preserve these invariants:

1. Development runs never perform auto-update checks.
2. Packaged Windows GitHub builds initialize GitHub auto-updates exactly once.
3. Packaged macOS GitHub builds initialize GitHub auto-updates exactly once.
4. Microsoft Store/MSIX builds do not initialize GitHub auto-updates.
5. The updater runs only in the Electron main process.
6. The updater does not access SQLite, TypeORM, Models, Modules, or IPC handler database paths.
7. The updater source is explicit: `repo: "robertzengcn/aiFetchly"`.
8. The legacy `UPDATESERVER` runtime update path is removed, not kept as fallback.
9. Windows releases include Squirrel assets required by `update.electronjs.org`.
10. macOS releases include signed and notarized app ZIP assets, not only DMG assets.
11. Release CI validates required artifacts before a release is made public.
12. Existing app startup, protocol registration, single-instance behavior, diagnostics, and IPC registration remain intact.

## 3. Current System

### 3.1 Main-process updater code

`src/background.ts` currently imports Electron's built-in updater through CommonJS:

```typescript
const autoUpdater = require("electron").autoUpdater;
```

Later in packaged startup, it performs the legacy custom feed update check:

```typescript
const server = import.meta.env.UPDATESERVER as string;
if (server) {
  const url = `${server}/update/${process.platform}/${(
    app as any
  ).getVersion()}`;
  autoUpdater.setFeedURL({ url });
  autoUpdater.checkForUpdates();
}
```

This is the code path being removed.

### 3.2 Packaging configuration

`forge.config.js` currently has:

- `@electron-forge/maker-squirrel` for Windows installer and Squirrel packages
- `@electron-forge/maker-zip` for macOS ZIP output
- `@electron-forge/maker-dmg` for macOS manual installer output
- `@electron-forge/maker-wix` for MSI output
- production Windows signing through `cert.pfx`
- production macOS signing/notarization through Apple secrets
- aggressive package pruning through `EXTERNAL_DEPENDENCIES`

Because the package prune logic keeps only dependency trees discovered from `EXTERNAL_DEPENDENCIES`, adding `update-electron-app` only to `package.json` is not enough. It must also be added to `EXTERNAL_DEPENDENCIES` so the packaged app can require it at runtime.

### 3.3 Release workflow

`.github/workflows/release.yml` currently:

- Builds Windows on `windows-2022`
- Builds macOS on `macos-latest`
- Computes a version independently in each platform job
- Writes `UPDATESERVER` into `.env`
- Requires `UPDATESERVER` and `UPDATESERVER_PROD` secrets
- Uploads Windows `.exe` and `.msi` only
- Uploads macOS `.dmg` and `.zip`
- Does not create a GitHub Release
- Does not upload Windows `RELEASES` or `.nupkg` files as artifacts

For GitHub auto-updates, Windows artifact upload must include `RELEASES` and `*.nupkg`. For public auto-update distribution, a publishing step must attach update artifacts to GitHub Releases.

### 3.4 Release documentation

`docs/RELEASE_WORKFLOW.md` still documents `UPDATESERVER` and `UPDATESERVER_PROD` as required secrets. That documentation must be updated when the implementation lands.

## 4. Target Architecture

```text
Main process startup
  |
  +-- electron-squirrel-startup guard
  |
  +-- diagnostics, protocol, single-instance, app setup
  |
  +-- AppUpdateService.initializeAppUpdates()
        |
        +-- skip if not packaged
        +-- skip if not win32/darwin
        +-- skip if Microsoft Store/MSIX channel
        +-- call updateElectronApp({
              updateSource: {
                type: ElectronPublicUpdateService,
                repo: "robertzengcn/aiFetchly"
              }
            })
```

The updater service is a thin adapter around `update-electron-app`. It owns product gating and logger integration. It does not own release discovery, feed URL construction, download logic, or restart dialog behavior. Those remain inside `update-electron-app` and Electron's built-in `autoUpdater`.

## 5. Key Design Decisions

### 5.1 Use `update-electron-app`

Use `update-electron-app` because:

- It is the Electron team's recommended drop-in path for `update.electronjs.org`.
- AiFetchly's repository is public.
- AiFetchly already uses Electron Forge.
- The package handles startup checks, periodic checks, background download, and restart prompt.

Do not use `electron-updater` in this phase. That package fits Electron Builder's metadata workflow better than this repo's current Electron Forge setup.

### 5.2 Use explicit repo configuration

Although `update-electron-app` can discover the repository from `package.json`, this implementation must set the repo explicitly:

```typescript
repo: "robertzengcn/aiFetchly"
```

This prevents accidental updater breakage if package metadata changes.

### 5.3 Keep update logic out of `background.ts`

`background.ts` is already large and owns many unrelated startup responsibilities. Updater policy should live in:

```text
src/main-process/updater/AppUpdateService.ts
```

`background.ts` should only call the service.

### 5.4 Let `update-electron-app` own the dialog

For v1, use:

```typescript
notifyUser: true
```

This means the package displays the native restart prompt after download. AiFetchly does not need a translated in-app update UI in v1. If a future manual "Check for updates" UI is added, it must follow the repo i18n rule and update all language files.

### 5.5 Use one stable update interval

Use:

```typescript
updateInterval: "1 hour"
```

`update-electron-app` defaults to 10 minutes, but 1 hour is quieter and still responsive enough for desktop app updates.

### 5.6 Skip Microsoft Store builds

Microsoft Store/MSIX builds should be serviced by the Store. GitHub auto-updates are skipped when:

- `process.windowsStore` is true
- or future build channel metadata says `microsoft-store`

The first implementation should support `process.windowsStore`. A future MSIX packaging change may add an explicit channel constant.

### 5.7 Keep Windows Squirrel startup handling first

Windows Squirrel events can launch the app during install, update, uninstall, and obsolete operations. The app must call `electron-squirrel-startup` at the top of `src/background.ts`, before expensive startup work.

## 6. Module Layout

Add:

```text
src/main-process/updater/AppUpdateService.ts
test/vitest/main/updater/AppUpdateService.test.ts
```

Modify:

```text
src/background.ts
forge.config.js
package.json
yarn.lock
.github/workflows/release.yml
docs/RELEASE_WORKFLOW.md
```

The implementation should not require renderer, preload, database, or Vue changes.

## 7. AppUpdateService Design

### 7.1 Public API

```typescript
export interface AppUpdateServiceOptions {
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  isWindowsStore?: boolean;
  updateInterval?: string;
}

export interface AppUpdateInitializeResult {
  initialized: boolean;
  reason:
    | "initialized"
    | "already-initialized"
    | "not-packaged"
    | "unsupported-platform"
    | "microsoft-store"
    | "initialization-error";
  stopUpdates?: () => void;
}

export function initializeAppUpdates(
  options?: AppUpdateServiceOptions
): AppUpdateInitializeResult;
```

`options` exists for tests and future channel injection. Production calls should omit it.

### 7.2 Runtime behavior

Pseudo-code:

```typescript
import { app } from "electron";
import { log } from "@/modules/Logger";
import {
  updateElectronApp,
  UpdateSourceType,
} from "update-electron-app";

type ProcessWithWindowsStore = NodeJS.Process & {
  windowsStore?: boolean;
};

let updateStopper: (() => void) | null = null;

export function initializeAppUpdates(
  options: AppUpdateServiceOptions = {}
): AppUpdateInitializeResult {
  if (updateStopper) {
    return {
      initialized: false,
      reason: "already-initialized",
      stopUpdates: updateStopper,
    };
  }

  const isPackaged = options.isPackaged ?? app.isPackaged;
  if (!isPackaged) {
    return { initialized: false, reason: "not-packaged" };
  }

  const platform = options.platform ?? process.platform;
  if (platform !== "win32" && platform !== "darwin") {
    return { initialized: false, reason: "unsupported-platform" };
  }

  const isWindowsStore =
    options.isWindowsStore ??
    Boolean((process as ProcessWithWindowsStore).windowsStore);
  if (isWindowsStore) {
    log.info("[auto-update] Skipping GitHub updater for Microsoft Store build");
    return { initialized: false, reason: "microsoft-store" };
  }

  try {
    const updater = updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "robertzengcn/aiFetchly",
      },
      updateInterval: options.updateInterval ?? "1 hour",
      logger: {
        log: (...args: unknown[]) => {
          log.info("[auto-update]", ...args);
        },
      },
      notifyUser: true,
    });

    updateStopper = updater.stopUpdates;
    log.info("[auto-update] GitHub updater initialized");

    return {
      initialized: true,
      reason: "initialized",
      stopUpdates: updateStopper,
    };
  } catch (error: unknown) {
    log.error("[auto-update] Failed to initialize GitHub updater", error);
    return { initialized: false, reason: "initialization-error" };
  }
}
```

### 7.3 Error handling

Updater initialization errors must not block app startup. The service logs and returns `initialization-error`.

`update-electron-app` receives a logger object with a `log` method. Route it into the existing main-process logger. Do not log credentials or secrets.

### 7.4 Stop function

Store `stopUpdates` returned by `updateElectronApp()`. The app does not need to call it in normal production shutdown, but having the handle improves testability and future lifecycle control.

### 7.5 TypeScript constraints

Do not use `any`. Use:

- package-provided `update-electron-app` types
- `unknown` for error values and variadic logger values
- a local structural type for `process.windowsStore`

## 8. `background.ts` Changes

### 8.1 Remove built-in updater require

Remove:

```typescript
const autoUpdater = require("electron").autoUpdater;
```

No direct use of Electron's `autoUpdater` should remain in `background.ts` for GitHub updates.

### 8.2 Add Squirrel startup guard

At the top of `src/background.ts`, after importing `app` but before normal startup initialization:

```typescript
if (require("electron-squirrel-startup")) {
  app.quit();
}
```

The file currently imports `app` from Electron near the top, so this can be placed immediately after that import and associated CommonJS requires.

### 8.3 Import updater service

Add:

```typescript
import { initializeAppUpdates } from "@/main-process/updater/AppUpdateService";
```

### 8.4 Remove legacy packaged update block

Delete the block that reads `import.meta.env.UPDATESERVER` and calls:

```typescript
autoUpdater.setFeedURL({ url });
autoUpdater.checkForUpdates();
```

### 8.5 Call the new service

Call:

```typescript
initializeAppUpdates();
```

Recommended placement: inside packaged app startup before loading the production HTML file, close to where the old packaged updater block existed. This minimizes behavioral change while removing legacy feed configuration.

Do not call this from renderer code or IPC handlers.

## 9. Dependency and Forge Changes

### 9.1 Runtime dependency

Add:

```bash
yarn add update-electron-app
```

`update-electron-app` currently provides TypeScript declarations through its package metadata.

### 9.2 Development dependency

Add:

```bash
yarn add -D @electron-forge/publisher-github
```

Keep the same Electron Forge major version as the repo's other Forge packages.

### 9.3 Package pruning allowlist

Add `update-electron-app` to `EXTERNAL_DEPENDENCIES` in `forge.config.js`:

```javascript
const EXTERNAL_DEPENDENCIES = [
  "realm",
  "electron-squirrel-startup",
  "update-electron-app",
  "better-sqlite3",
  // ...
];
```

Reason: AiFetchly's packager ignore hook keeps dependency trees discovered from `EXTERNAL_DEPENDENCIES`. Without this, the packaged app may not include `update-electron-app` and runtime require/import can fail.

### 9.4 GitHub publisher configuration

Add top-level `publishers` in `forge.config.js`:

```javascript
publishers: [
  {
    name: "@electron-forge/publisher-github",
    config: {
      repository: {
        owner: "robertzengcn",
        name: "aiFetchly",
      },
      draft: true,
      prerelease: false,
    },
  },
],
```

Use `draft: true` by default. Draft releases do not reach stable update checks, which gives release engineers a review window before users see updates.

### 9.5 Maker configuration

Keep:

```javascript
{
  name: "@electron-forge/maker-squirrel",
  // Windows auto-update artifacts
}
```

Keep:

```javascript
{
  name: "@electron-forge/maker-zip",
  platforms: ["darwin"],
}
```

Keep DMG for manual macOS downloads:

```javascript
{
  name: "@electron-forge/maker-dmg",
  // Manual installer artifact
}
```

Do not rely on WiX MSI for auto-updates in v1. WiX can remain for manual installation if the product still needs it, but Squirrel is the Windows update path.

## 10. Release Artifact Contract

### 10.1 Windows

For each public stable release, upload at least:

```text
RELEASES
*-full.nupkg
*.exe
```

Upload when generated:

```text
*-delta.nupkg
```

The current workflow uploads only:

```text
out/make/**/*.exe
out/make/**/*.msi
```

It must be changed to include:

```text
out/make/**/RELEASES
out/make/**/*.nupkg
out/make/**/*.exe
out/make/**/*.msi
```

### 10.2 macOS

For each public stable release, upload:

```text
*.zip
```

Also upload for manual installation:

```text
*.dmg
```

The ZIP is required for auto-update. The DMG alone is not enough.

### 10.3 Tags and release state

The public updater only considers GitHub Releases that:

- have valid SemVer tags, for example `v1.0.12`
- are not draft releases
- are not prerelease releases
- contain all required binaries for the target platform/architecture

## 11. GitHub Actions Release Design

### 11.1 Remove update-server secrets

Remove these workflow env entries:

```yaml
UPDATESERVER_TEST: ${{ secrets.UPDATESERVER }}
UPDATESERVER_PROD: ${{ secrets.UPDATESERVER_PROD }}
```

Remove validation that fails when update-server secrets are absent.

Remove these `.env` lines:

```bash
echo "UPDATESERVER=$update_server"
```

The updater source is now compiled into the main-process service and does not come from `.env`.

### 11.2 Use one version source

The current Windows and macOS jobs independently mutate `package.json` to:

```bash
new_version="${current_version%.*}.${{ github.run_number }}"
```

This can work if both jobs use the same run number, but a cleaner release flow has one `prepare-release` job that outputs the exact version and tag. Both platform jobs consume that output.

Recommended:

```yaml
jobs:
  prepare-release:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
      tag: ${{ steps.version.outputs.tag }}
    steps:
      - uses: actions/checkout@v4
      - id: version
        shell: bash
        run: |
          set -euo pipefail
          version="$(node -p "require('./package.json').version")"
          echo "version=${version}" >> "$GITHUB_OUTPUT"
          echo "tag=v${version}" >> "$GITHUB_OUTPUT"
```

For production releases, prefer committed `package.json` versions over CI-mutated versions. If CI-mutated versions remain, the workflow must prove every platform job uses the same generated version.

### 11.3 Add release publishing permissions

The workflow currently has:

```yaml
permissions:
  contents: read
```

Publishing GitHub Releases requires:

```yaml
permissions:
  contents: write
```

If the team wants build-only workflows to remain read-only, split publishing into a second protected workflow.

### 11.4 Publish through Electron Forge

Option A: `electron-forge publish`

Use Forge publisher-github to create or update draft releases. This aligns with Forge's publisher configuration.

Example:

```bash
yarn publish -- --platform=win32 --arch=x64
yarn publish -- --platform=darwin --arch=x64
yarn publish -- --platform=darwin --arch=arm64
```

The exact command shape must be verified against the repo's Forge version before implementation. Use this if Forge can publish all makers cleanly in CI.

### 11.5 Publish through GitHub CLI

Option B: keep `electron-forge make`, then upload selected artifacts with GitHub CLI.

Example:

```bash
gh release create "$TAG" \
  --draft \
  --title "AiFetchly ${VERSION}" \
  --notes-file RELEASE_NOTES.md \
  out/make/**/RELEASES \
  out/make/**/*.nupkg \
  out/make/**/*.exe \
  out/make/**/*.zip \
  out/make/**/*.dmg
```

This is more explicit and easier to validate. It is also less dependent on Forge publisher behavior.

Recommendation: use Option B first because the repo already has a manual release workflow that uploads selected artifacts. Add publisher-github to satisfy Forge-native publishing support, but keep CI artifact selection explicit.

### 11.6 Build matrix

Recommended production matrix:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: windows-2022
        platform: win32
        arch: x64
        script: yarn make-win:prod
      - os: macos-14
        platform: darwin
        arch: arm64
        script: yarn make-mac:prod -- --arch=arm64
      - os: macos-13
        platform: darwin
        arch: x64
        script: yarn make-mac:prod -- --arch=x64
```

The exact macOS runner choices should match GitHub-hosted runner availability and native dependency constraints. macOS x64 builds may require an Intel runner or a proven cross-arch configuration.

### 11.7 Artifact validation scripts

Add a script:

```text
scripts/validate-update-artifacts.js
```

Input:

```text
--platform win32 --arch x64 --root out/make
--platform darwin --arch arm64 --root out/make
--platform darwin --arch x64 --root out/make
```

Windows validation:

- find one `RELEASES`
- find at least one `*-full.nupkg`
- find at least one `.exe`
- warn if no `*-delta.nupkg`
- fail if `RELEASES` is empty

macOS validation:

- find at least one `.zip`
- find at least one `.dmg`
- verify `.zip` contains `.app`
- for production, verify signing with `codesign --verify --deep --strict`
- for production, verify notarization with `spctl -a -vv`

The script should be Node.js and use standard `fs`/`path` APIs plus child process calls only where platform tools are required.

## 12. Static Removal Contract

After implementation, this command should find no active runtime updater implementation:

```bash
rg -n "UPDATESERVER|setFeedURL\\(|autoUpdater\\.checkForUpdates\\(" src/background.ts src/main-process
```

Expected:

- no `UPDATESERVER` usage in `src/background.ts`
- no old `${server}/update/${process.platform}` feed construction
- no direct `setFeedURL()` in the GitHub updater path
- no direct `autoUpdater.checkForUpdates()` in `background.ts`

Documentation can still mention the old path in migration notes.

## 13. Tests

### 13.1 Unit test file

Add:

```text
test/vitest/main/updater/AppUpdateService.test.ts
```

### 13.2 Test cases

Required cases:

1. `not-packaged`: returns `not-packaged` and does not call `updateElectronApp`.
2. `unsupported-platform`: returns `unsupported-platform` on `linux`.
3. `microsoft-store`: returns `microsoft-store` when `isWindowsStore` is true.
4. `win32`: initializes once on packaged `win32`.
5. `darwin`: initializes once on packaged `darwin`.
6. `idempotency`: second call returns `already-initialized`.
7. `repo`: passes `repo: "robertzengcn/aiFetchly"`.
8. `interval`: passes `updateInterval: "1 hour"` by default.
9. `notify`: passes `notifyUser: true`.
10. `error`: catches thrown initialization errors and returns `initialization-error`.

### 13.3 Mocking strategy

Mock `update-electron-app` with Vitest:

```typescript
vi.mock("update-electron-app", () => ({
  UpdateSourceType: {
    ElectronPublicUpdateService: "electron-public-update-service",
  },
  updateElectronApp: vi.fn(() => ({
    stopUpdates: vi.fn(),
  })),
}));
```

Use service options to avoid mutating global `process.platform` and Electron `app.isPackaged`.

### 13.4 Type checks

Run:

```bash
yarn tsc-result
```

If the repo's global type-check state is not clean, run the narrower Vitest build/type target used by main-process tests and document unrelated failures.

## 14. Manual End-to-End Verification

### 14.1 Windows

Preconditions:

- GitHub Release `vN` exists with Windows Squirrel assets.
- GitHub Release `vN+1` exists as a public, non-prerelease, non-draft release.
- `vN+1` has `RELEASES`, `*-full.nupkg`, and `.exe`.

Steps:

1. Install `vN` using the Squirrel installer from GitHub Releases.
2. Launch AiFetchly.
3. Confirm logs show GitHub updater initialization.
4. Wait for update check.
5. Confirm update download prompt appears.
6. Choose restart.
7. Confirm `app.getVersion()` reports `N+1`.
8. Confirm user data and SQLite databases remain intact.

Troubleshooting:

- If no update appears, check release is not draft/prerelease.
- Check `RELEASES` and `.nupkg` are attached.
- Check the app version is lower than release version.
- Check `https://update.electronjs.org/robertzengcn/aiFetchly/win32-x64/<version>` manually.

### 14.2 macOS

Preconditions:

- GitHub Release `vN` exists with signed/notarized macOS ZIP and DMG.
- GitHub Release `vN+1` exists with signed/notarized ZIP for the test architecture.

Steps:

1. Install `vN` from DMG or ZIP.
2. Launch AiFetchly.
3. Confirm logs show GitHub updater initialization.
4. Wait for update check.
5. Confirm update download prompt appears.
6. Choose restart.
7. Confirm `app.getVersion()` reports `N+1`.
8. Confirm Gatekeeper does not block the updated app.

Troubleshooting:

- If no update appears, check the release has a ZIP, not only DMG.
- Check code signing and notarization.
- Check architecture-specific asset availability.
- Check `https://update.electronjs.org/robertzengcn/aiFetchly/darwin-arm64/<version>` or `darwin-x64`.

### 14.3 Microsoft Store/MSIX

Steps:

1. Run a Store/MSIX build.
2. Launch AiFetchly.
3. Confirm logs show GitHub updater skipped for Store build.
4. Confirm no request is made to `update.electronjs.org`.

## 15. Release Documentation Updates

Update `docs/RELEASE_WORKFLOW.md`:

- Remove `UPDATESERVER`.
- Remove `UPDATESERVER_PROD`.
- Add `GITHUB_TOKEN` or workflow `contents: write` requirement for publishing.
- State that Windows auto-update requires `RELEASES` and `.nupkg`.
- State that macOS auto-update requires ZIP and signing/notarization.
- Explain draft release review and final public release publication.

Update README release sections if they mention update server configuration.

## 16. Security Considerations

### 16.1 Trust boundary

`update-electron-app` delegates update discovery to `update.electronjs.org`, which reads public GitHub Releases. Release publication permissions become the critical trust boundary.

Mitigations:

- Protect release workflow with GitHub environment approvals.
- Require branch protection for release tags.
- Use signed Windows and macOS artifacts.
- Keep GitHub token permissions minimal.
- Use draft releases for inspection before public visibility.

### 16.2 No secrets in app bundle

The app bundle must not contain:

- GitHub tokens
- Apple credentials
- Windows signing certificate material
- update server secrets

`repo: "robertzengcn/aiFetchly"` is public metadata and safe to include.

### 16.3 No renderer updater API in v1

No renderer-exposed update controls are added in v1. This avoids new IPC attack surface. Future manual update UI must validate channel inputs and must not accept arbitrary update URLs from renderer.

### 16.4 Release asset validation

Do not publish unvalidated assets. Public non-draft releases immediately become eligible for update checks when the update service sees them.

## 17. Rollout Plan

### Phase 1: Code and dependency migration

1. Add `update-electron-app`.
2. Add `AppUpdateService`.
3. Add Squirrel startup guard.
4. Remove old `UPDATESERVER` updater block.
5. Add unit tests.
6. Add static removal check.

Exit criteria:

- Unit tests pass.
- `rg` static check shows no old runtime update path.
- Packaged app includes `update-electron-app`.

### Phase 2: Packaging and release workflow

1. Add GitHub publisher dependency/config.
2. Remove update-server secrets from workflow.
3. Add Windows `.nupkg` and `RELEASES` artifact upload.
4. Add artifact validation script.
5. Add optional release publishing job or documented manual publish step.

Exit criteria:

- Release artifact build includes all required update files.
- Draft GitHub Release can be created with required assets.

### Phase 3: End-to-end validation

1. Publish `vN` test release.
2. Install `vN` on Windows and macOS.
3. Publish `vN+1` test release as public stable.
4. Verify upgrades.
5. Record results in manual test docs.

Exit criteria:

- Windows x64 update succeeds.
- macOS arm64 update succeeds.
- macOS x64 update succeeds if x64 is supported.

### Phase 4: Documentation and cleanup

1. Update release documentation.
2. Remove old update-server references from non-migration docs.
3. Update internal release checklist.
4. Confirm GitHub Actions secrets no longer require update server values.

## 18. Rollback Plan

The old `UPDATESERVER` path should not be restored unless the GitHub updater path is abandoned.

If a release is bad:

1. Remove or draft the bad GitHub Release if it should no longer be an update target.
2. Publish a higher version with a fixed build.
3. Confirm the release is public stable and contains required artifacts.

If updater initialization causes startup problems:

1. Patch `AppUpdateService` to return early for affected channels.
2. Publish a higher version through manual installer download.
3. Re-enable auto-updates after root cause is fixed.

Because auto-updates require a higher version, rollback means forward-fixing with a new version, not downgrading.

## 19. Implementation Checklist

- Add `update-electron-app` dependency.
- Add `@electron-forge/publisher-github` dev dependency.
- Add `update-electron-app` to `EXTERNAL_DEPENDENCIES`.
- Add `src/main-process/updater/AppUpdateService.ts`.
- Add `test/vitest/main/updater/AppUpdateService.test.ts`.
- Remove `autoUpdater` require from `src/background.ts`.
- Add `electron-squirrel-startup` guard in `src/background.ts`.
- Remove `UPDATESERVER` updater block from `src/background.ts`.
- Call `initializeAppUpdates()` in packaged startup.
- Add Forge GitHub publisher config.
- Remove `UPDATESERVER` secrets from `.github/workflows/release.yml`.
- Upload Windows `RELEASES` and `*.nupkg`.
- Validate macOS ZIP presence.
- Update `docs/RELEASE_WORKFLOW.md`.
- Run unit tests and static checks.
- Run end-to-end update checks on Windows and macOS.

## 20. References

- `update-electron-app` README: `https://github.com/electron/update-electron-app`
- Electron updating applications guide: `https://www.electronjs.org/docs/latest/tutorial/updates`
- Electron Forge GitHub publisher docs: `https://www.electronforge.io/config/publishers/github`
- Electron Forge publisher-github API docs: `https://js.electronforge.io/modules/_electron_forge_publisher_github.html`
- Electron Forge auto update guide: `https://www.electronforge.io/advanced/auto-update`

