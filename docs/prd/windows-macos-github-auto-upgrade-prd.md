# Windows and macOS GitHub Auto Upgrade - Product Requirements Document

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Proposed |
| Created | 2026-08-01 |
| Owner | AiFetchly engineering |
| Product areas | Electron desktop app, release engineering, Windows packaging, macOS packaging |
| Target platforms | Windows x64, macOS x64, macOS arm64 |
| Distribution channel | Public GitHub Releases |
| GitHub repository | `https://github.com/robertzengcn/aiFetchly` |
| Update service | `update-electron-app` with `update.electronjs.org` |
| Related code | `src/background.ts`, `forge.config.js`, `package.json`, `.github/workflows/release.yml` |

## 1. Summary

AiFetchly currently checks for desktop application updates through a legacy custom update server configured by `UPDATESERVER` in `src/background.ts`. The runtime code constructs a feed URL from the custom server, platform, and app version, then calls Electron's `autoUpdater.setFeedURL()` and `autoUpdater.checkForUpdates()` directly.

This initiative replaces that old upgrade path with a GitHub Releases based auto-upgrade system for public Windows and macOS desktop builds. The new updater will use `update-electron-app`, configured explicitly for the public repository `robertzengcn/aiFetchly`. Release artifacts will be published to GitHub Releases through Electron Forge and CI. Windows upgrades will use Squirrel.Windows release assets. macOS upgrades will use signed and notarized app ZIP assets.

The old `UPDATESERVER` update flow must be removed, not kept as a fallback. AiFetchly should have one authoritative updater for GitHub-distributed desktop builds, while Microsoft Store/MSIX builds remain outside this PRD and must not self-update through GitHub.

## 2. Problem

### 2.1 Legacy update server is the wrong product model

The current production updater depends on this pattern in `src/background.ts`:

```typescript
const server = import.meta.env.UPDATESERVER as string;
if (server) {
  const url = `${server}/update/${process.platform}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url });
  autoUpdater.checkForUpdates();
}
```

This creates several problems:

1. A custom update service must be operated and secured even though the app is distributed from a public GitHub repository.
2. The update source is hidden behind build-time environment configuration.
3. Release assets and updater metadata can drift because GitHub Releases are not the single source of truth.
4. There is no clear separation between GitHub-distributed builds and Microsoft Store builds.
5. The update behavior is embedded directly in `background.ts`, which makes testing and channel-specific branching harder.

### 2.2 GitHub Releases need complete platform artifacts

`update-electron-app` does not update from arbitrary installer assets. The GitHub Release must contain the assets expected by Electron's public update service.

For Windows, every auto-updatable release must include:

- `RELEASES`
- `*-full.nupkg`
- `*.exe`
- `*-delta.nupkg` when generated

For macOS, every auto-updatable release must include:

- a signed and notarized app ZIP asset for each supported architecture
- a DMG may also be uploaded for manual installation, but the updater requires ZIP

### 2.3 macOS update eligibility depends on signing

macOS auto-update is built on Squirrel.Mac and requires the application to be code signed. AiFetchly already has production macOS signing and notarization configuration in `forge.config.js`. This PRD requires that release CI produce signed, notarized ZIP assets, not only DMG files.

### 2.4 Windows update eligibility depends on Squirrel startup handling

Windows Squirrel update/install/uninstall events can launch the app with special arguments. The app already depends on `electron-squirrel-startup`, but startup handling must be installed at the beginning of the main process before normal app initialization work. Without this, update operations can open extra app windows or execute normal startup code during installer events.

## 3. Goals

1. Remove the legacy `UPDATESERVER` update path from production runtime code.
2. Add GitHub Releases auto-upgrade support for Windows x64 desktop builds.
3. Add GitHub Releases auto-upgrade support for macOS x64 and macOS arm64 desktop builds.
4. Use `update-electron-app` configured with `repo: "robertzengcn/aiFetchly"`.
5. Keep update code out of renderer process code.
6. Create a dedicated main-process updater service instead of keeping feed construction inside `src/background.ts`.
7. Automatically check for updates at app startup and periodically after startup.
8. Download updates in the background and prompt users to restart after download.
9. Publish all required Windows and macOS update artifacts to non-draft, non-prerelease GitHub Releases.
10. Keep Microsoft Store/MSIX builds from using the GitHub self-updater.
11. Add logging so update failures can be diagnosed from main-process logs.
12. Add automated and manual verification steps that prove older installed builds can upgrade to newer GitHub Release builds.

## 4. Non-Goals

1. Do not build or operate a custom update server.
2. Do not keep `UPDATESERVER` as a fallback after migration.
3. Do not use `electron-updater` or migrate the project from Electron Forge to Electron Builder in this phase.
4. Do not support Linux auto-upgrade in this PRD.
5. Do not support private GitHub repository update checks.
6. Do not implement staged rollout percentages in v1.
7. Do not force-install updates without user restart consent in v1.
8. Do not make Microsoft Store/MSIX builds self-update from GitHub Releases.
9. Do not introduce update-related database entities.
10. Do not put update state persistence directly in IPC handlers.

## 5. Users

### 5.1 End Users

Users who installed AiFetchly from GitHub Releases need bug fixes and new features without manually downloading every new installer. They should receive a normal desktop update prompt after a compatible release is available.

### 5.2 Support Operators

Support needs a predictable way to tell users which version they are running and whether update checks are working. Update failures should appear in logs with enough context to diagnose missing release assets, signing issues, or network failures.

### 5.3 Release Engineers

Release engineers need a deterministic GitHub Release pipeline that produces the correct Windows and macOS artifacts, validates them before publication, and makes the release visible to the public update service only after it is ready.

## 6. Product Principles

### 6.1 GitHub Release Is the Source of Truth

The latest public non-prerelease, non-draft GitHub Release with valid required artifacts is the update source for GitHub-distributed builds.

### 6.2 Distribution Channels Must Not Cross

GitHub installer builds may self-update from GitHub. Microsoft Store/MSIX builds must rely on the Store update mechanism and must not use GitHub self-update behavior.

### 6.3 Explicit Runtime Configuration

The updater must explicitly declare:

```typescript
repo: "robertzengcn/aiFetchly"
```

The app should not rely only on package metadata discovery for this repo.

### 6.4 Release Assets Are Part of the Product

Auto-upgrade support is not complete until the CI release produces and uploads the required Squirrel and macOS ZIP assets.

### 6.5 No Hidden Update Server

Build-time environment variables must not silently change the binary update source for GitHub builds.

## 7. User Stories

### US-1: Windows User Receives an Update

As a Windows user who installed AiFetchly from GitHub Releases, I want the app to detect a newer release, download it in the background, and ask me to restart so I can upgrade without manually visiting GitHub.

Acceptance criteria:

- User installs version `1.0.11` from the Windows GitHub installer.
- Release `v1.0.12` is published with required Windows Squirrel assets.
- On startup or scheduled update check, the app detects version `1.0.12`.
- The app downloads the update in the background.
- The app shows the default restart prompt after download.
- After restart, the app reports version `1.0.12`.

### US-2: macOS User Receives an Update

As a macOS user who installed AiFetchly from GitHub Releases, I want a signed update to be downloaded and applied without manually downloading a new DMG.

Acceptance criteria:

- User installs version `1.0.11` from a signed/notarized macOS release.
- Release `v1.0.12` is published with a signed/notarized ZIP asset for the user's architecture.
- The app detects, downloads, and prompts for restart.
- After restart, the app reports version `1.0.12`.

### US-3: Microsoft Store User Does Not Use GitHub Updater

As a Microsoft Store user, I want updates to be handled by the Store instead of the app downloading GitHub Release binaries.

Acceptance criteria:

- If `process.windowsStore` is true or the build channel is `microsoft-store`, GitHub update initialization is skipped.
- No request is made to `update.electronjs.org`.
- No GitHub update prompt is shown.

### US-4: Release Engineer Publishes One Valid Release

As a release engineer, I want one GitHub Release to contain all required update assets so both Windows and macOS users can upgrade from the same app version.

Acceptance criteria:

- Release tag is valid SemVer, for example `v1.0.12`.
- Release is not a draft and not a prerelease when made available to users.
- Windows assets include `RELEASES`, `*-full.nupkg`, and `*.exe`.
- macOS assets include signed ZIP files for each supported architecture.
- CI fails before publication if required artifacts are missing.

## 8. Functional Requirements

### FR-1: Remove Legacy Update Server Flow

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Remove `UPDATESERVER` usage from runtime updater code in `src/background.ts`. | P0 |
| FR-1.2 | Remove direct custom feed construction using `${server}/update/${process.platform}/${app.getVersion()}`. | P0 |
| FR-1.3 | Remove direct `autoUpdater.setFeedURL()` calls for the old custom server path. | P0 |
| FR-1.4 | Remove `UPDATESERVER` from required production desktop release documentation. | P0 |
| FR-1.5 | Add a migration note explaining that GitHub Releases now own GitHub build updates. | P1 |

### FR-2: Add Main-Process Updater Service

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Add `src/main-process/updater/AppUpdateService.ts`. | P0 |
| FR-2.2 | The service must expose one startup method, for example `initializeAppUpdates()`. | P0 |
| FR-2.3 | The service must run only in packaged apps. | P0 |
| FR-2.4 | The service must run only on `win32` and `darwin`. | P0 |
| FR-2.5 | The service must skip when the app is running as a Microsoft Store build. | P0 |
| FR-2.6 | The service must call `updateElectronApp()` exactly once per main-process lifetime. | P0 |
| FR-2.7 | The service must log updater initialization and errors through the existing logger. | P1 |

Recommended implementation shape:

```typescript
import { app } from "electron";
import { log } from "@/modules/Logger";

type ProcessWithWindowsStore = NodeJS.Process & {
  windowsStore?: boolean;
};

let updatesInitialized = false;

function isMicrosoftStoreBuild(): boolean {
  return Boolean((process as ProcessWithWindowsStore).windowsStore);
}

export function initializeAppUpdates(): void {
  if (updatesInitialized) {
    return;
  }

  if (!app.isPackaged) {
    return;
  }

  if (process.platform !== "win32" && process.platform !== "darwin") {
    return;
  }

  if (isMicrosoftStoreBuild()) {
    log.info("[auto-update] Skipping GitHub updater for Microsoft Store build");
    return;
  }

  const {
    updateElectronApp,
    UpdateSourceType,
  } = require("update-electron-app") as typeof import("update-electron-app");

  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: "robertzengcn/aiFetchly",
    },
    updateInterval: "1 hour",
    logger: {
      log: (...args: unknown[]) => {
        log.info("[auto-update]", ...args);
      },
    },
    notifyUser: true,
  });

  updatesInitialized = true;
}
```

### FR-3: Wire Service Into App Startup

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Import and call `initializeAppUpdates()` from `src/background.ts`. | P0 |
| FR-3.2 | Call updater initialization after basic process guards are registered and before or during packaged app window startup. | P1 |
| FR-3.3 | Do not initialize updates during development server runs. | P0 |
| FR-3.4 | Do not initialize updates from renderer or preload code. | P0 |

### FR-4: Handle Windows Squirrel Startup Events

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Add `electron-squirrel-startup` handling at the top of the main process before normal app initialization. | P0 |
| FR-4.2 | The app must quit immediately for Squirrel install, updated, uninstall, and obsolete events. | P0 |
| FR-4.3 | The handling must not interfere with normal app startup. | P0 |

Recommended implementation shape:

```typescript
if (require("electron-squirrel-startup")) {
  app.quit();
}
```

### FR-5: Configure Electron Forge GitHub Publisher

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Add `@electron-forge/publisher-github` as a development dependency. | P0 |
| FR-5.2 | Add top-level `publishers` configuration in `forge.config.js`. | P0 |
| FR-5.3 | Configure repository owner as `robertzengcn`. | P0 |
| FR-5.4 | Configure repository name as `aiFetchly`. | P0 |
| FR-5.5 | Default release publication should create a draft first so assets can be inspected before public update visibility. | P1 |

Recommended Forge publisher configuration:

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

### FR-6: Windows Release Artifact Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | Windows GitHub Release builds must use Squirrel maker for auto-updatable artifacts. | P0 |
| FR-6.2 | Each Windows release must upload `RELEASES`. | P0 |
| FR-6.3 | Each Windows release must upload `*-full.nupkg`. | P0 |
| FR-6.4 | Each Windows release must upload the installer `*.exe`. | P0 |
| FR-6.5 | Delta packages should be uploaded when generated, but are not required for v1. | P1 |
| FR-6.6 | Windows production builds must be signed with the existing Windows certificate flow. | P0 |
| FR-6.7 | CI must fail before publication if required Windows artifacts are missing. | P0 |

### FR-7: macOS Release Artifact Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | macOS GitHub Release builds must include the Forge ZIP maker for `darwin`. | P0 |
| FR-7.2 | macOS GitHub Release builds should also include DMG for manual installation. | P1 |
| FR-7.3 | macOS app bundles must be code signed. | P0 |
| FR-7.4 | macOS app bundles must be notarized for public distribution. | P0 |
| FR-7.5 | Release artifacts must include a ZIP for macOS x64 if x64 is supported. | P0 |
| FR-7.6 | Release artifacts must include a ZIP for macOS arm64 if arm64 is supported. | P0 |
| FR-7.7 | CI must fail before publication if the ZIP artifact for a supported architecture is missing. | P0 |

### FR-8: Release Version and Tag Policy

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-8.1 | Every auto-updatable release must increment `package.json` version. | P0 |
| FR-8.2 | GitHub Release tags must be valid SemVer tags, for example `v1.0.12`. | P0 |
| FR-8.3 | Draft releases must not be expected to appear in update checks. | P0 |
| FR-8.4 | Prerelease releases must not be expected to appear in stable update checks. | P0 |
| FR-8.5 | Version downgrades are not supported in v1. | P1 |

### FR-9: Release Workflow Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-9.1 | Add or update GitHub Actions release workflow to build Windows x64 on Windows runners. | P0 |
| FR-9.2 | Add or update GitHub Actions release workflow to build macOS x64 and macOS arm64 on macOS runners. | P0 |
| FR-9.3 | Release workflow must use a locked dependency install. | P0 |
| FR-9.4 | Release workflow must run type checks or packaging checks before publishing. | P1 |
| FR-9.5 | Release workflow must publish required artifacts to the same GitHub Release tag. | P0 |
| FR-9.6 | Release workflow must verify artifact names and required patterns before publishing or before marking a draft release public. | P0 |

### FR-10: Logging and Diagnostics

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-10.1 | Log when GitHub updater initializes. | P1 |
| FR-10.2 | Log when updater is skipped due to development mode. | P2 |
| FR-10.3 | Log when updater is skipped due to Microsoft Store build. | P1 |
| FR-10.4 | Log errors reported by `update-electron-app` logger. | P1 |
| FR-10.5 | Do not log access tokens or GitHub credentials. | P0 |

## 9. Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | New TypeScript must not use `any`; use explicit types, `unknown`, or package-provided types. |
| NFR-2 | Updater initialization must not block app window creation for a long network operation. |
| NFR-3 | The updater must not run in renderer or preload process. |
| NFR-4 | The updater must not require a user login. |
| NFR-5 | The updater must not access the local SQLite database. |
| NFR-6 | The updater must be testable without making live update requests. |
| NFR-7 | The release pipeline must fail closed when artifacts are missing. |
| NFR-8 | Microsoft Store builds must not make GitHub updater network requests. |
| NFR-9 | Manual app usage must remain possible when update checks fail. |

## 10. Suggested File Ownership

```text
src/
+-- background.ts
|   +-- remove legacy UPDATESERVER update block
|   +-- add electron-squirrel-startup guard near top
|   +-- call initializeAppUpdates()
+-- main-process/
|   +-- updater/
|       +-- AppUpdateService.ts
+-- modules/
    +-- Logger.ts

forge.config.js
+-- add @electron-forge/publisher-github config
+-- ensure maker-squirrel and maker-zip remain configured

package.json
+-- add update-electron-app runtime dependency
+-- add @electron-forge/publisher-github dev dependency
+-- add release scripts if needed

.github/workflows/
+-- release.yml
```

## 11. Configuration Contract

### 11.1 Runtime Updater Configuration

The GitHub updater must use:

```typescript
updateSource: {
  type: UpdateSourceType.ElectronPublicUpdateService,
  repo: "robertzengcn/aiFetchly",
}
```

### 11.2 Effective Update Feed URLs

The public update service will check feeds equivalent to:

```text
https://update.electronjs.org/robertzengcn/aiFetchly/win32-x64/<current-version>
https://update.electronjs.org/robertzengcn/aiFetchly/darwin-x64/<current-version>
https://update.electronjs.org/robertzengcn/aiFetchly/darwin-arm64/<current-version>
```

### 11.3 Package Metadata

The existing package metadata should remain compatible with repository discovery:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/robertzengcn/aiFetchly.git"
  }
}
```

The implementation should still set `repo` explicitly to avoid ambiguity.

### 11.4 Build Channel Detection

The v1 implementation must skip GitHub updates when:

- `app.isPackaged` is false
- `process.platform` is not `win32` or `darwin`
- `process.windowsStore` is true

If a future build-channel environment variable is added, it may also skip when:

```text
AIFETCHLY_DISTRIBUTION_CHANNEL=microsoft-store
```

## 12. Release Workflow

### 12.1 Standard Release Steps

1. Update `package.json` version.
2. Commit the version bump.
3. Tag the commit with a SemVer tag, for example `v1.0.12`.
4. Run CI release workflow for Windows x64, macOS x64, and macOS arm64.
5. Produce signed Windows Squirrel artifacts.
6. Produce signed and notarized macOS ZIP and DMG artifacts.
7. Upload all artifacts to a draft GitHub Release.
8. Validate release artifact completeness.
9. Manually publish the release after inspection.
10. Verify update checks from an older installed version.

### 12.2 Windows Artifact Validation

CI must validate at least these patterns in the release upload set:

```text
RELEASES
*-full.nupkg
*.exe
```

Recommended optional pattern:

```text
*-delta.nupkg
```

### 12.3 macOS Artifact Validation

CI must validate at least these patterns in the release upload set:

```text
*.zip
*.dmg
```

The ZIP must contain a signed app bundle. If both x64 and arm64 are supported, validation must confirm one ZIP for each architecture.

### 12.4 GitHub Token Requirements

The release workflow must have permission to create releases and upload assets. Recommended GitHub Actions permissions:

```yaml
permissions:
  contents: write
```

Local release publishing should use `GITHUB_TOKEN` or an equivalent token with the minimum required release permissions.

## 13. Migration Plan

### Phase 1: Runtime Code Migration

1. Add `update-electron-app`.
2. Add `AppUpdateService`.
3. Add Squirrel startup guard.
4. Remove old `UPDATESERVER` update block from `src/background.ts`.
5. Keep app startup behavior unchanged outside updater initialization.
6. Add tests for platform and channel gating.

Exit criteria:

- No runtime reference to `import.meta.env.UPDATESERVER` remains in updater code.
- App starts in development without update checks.
- Packaged non-Store `win32` and `darwin` builds initialize updater once.
- Store/MSIX build detection skips updater.

### Phase 2: Forge and Dependency Configuration

1. Add `@electron-forge/publisher-github`.
2. Configure GitHub publisher for `robertzengcn/aiFetchly`.
3. Verify Squirrel maker still produces required Windows assets.
4. Verify ZIP maker still produces macOS ZIP assets.
5. Update release documentation.

Exit criteria:

- `yarn publish` or CI equivalent can create a draft GitHub Release.
- Draft release contains all update assets required for the target platform.

### Phase 3: CI Release Workflow

1. Update `.github/workflows/release.yml` or create it if absent.
2. Build Windows x64 on Windows.
3. Build macOS x64 and macOS arm64 on macOS.
4. Upload artifacts to one GitHub Release.
5. Add artifact validation step.
6. Keep releases as draft until validation and manual inspection pass.

Exit criteria:

- One release tag contains Windows and macOS update assets.
- CI fails if any required artifact is missing.

### Phase 4: End-to-End Upgrade Verification

1. Install version `N` on Windows from GitHub Release.
2. Publish version `N+1`.
3. Confirm Windows version `N` updates to `N+1`.
4. Install version `N` on macOS x64 from GitHub Release.
5. Publish version `N+1`.
6. Confirm macOS x64 version `N` updates to `N+1`.
7. Repeat for macOS arm64.

Exit criteria:

- Windows x64 upgrade succeeds.
- macOS x64 upgrade succeeds.
- macOS arm64 upgrade succeeds.
- Logs are sufficient to diagnose failure.

## 14. Test Plan

### 14.1 Unit Tests

Add main-process unit tests for `AppUpdateService`:

- Does not initialize when `app.isPackaged` is false.
- Does not initialize on unsupported platforms.
- Does not initialize for Microsoft Store builds.
- Initializes exactly once on packaged `win32`.
- Initializes exactly once on packaged `darwin`.
- Passes `repo: "robertzengcn/aiFetchly"` to `updateElectronApp`.
- Uses update interval configured by product requirement.

### 14.2 Static Checks

Add or document static verification:

```bash
rg -n "UPDATESERVER|setFeedURL\\(|/update/\\$\\{process.platform\\}" src
```

Expected result after migration:

- No active legacy update server implementation remains.
- References may exist only in migration documentation or tests explicitly asserting removal.

### 14.3 Release Artifact Checks

Windows:

- Verify `RELEASES` exists.
- Verify at least one `*-full.nupkg` exists.
- Verify installer `*.exe` exists.
- Verify executable is signed.

macOS:

- Verify ZIP exists.
- Verify DMG exists for manual download.
- Verify app bundle is signed.
- Verify notarization succeeded.
- Verify supported architectures are present.

### 14.4 Manual End-to-End Checks

Windows:

1. Install version `N` using `aiFetchlySetup.exe`.
2. Publish version `N+1`.
3. Launch version `N`.
4. Wait for update check and download.
5. Accept restart prompt.
6. Confirm version `N+1`.

macOS:

1. Install version `N` from DMG or ZIP.
2. Publish version `N+1`.
3. Launch version `N`.
4. Wait for update check and download.
5. Accept restart prompt.
6. Confirm version `N+1`.

Microsoft Store/MSIX:

1. Install Store/MSIX build.
2. Launch app.
3. Confirm GitHub updater is skipped.
4. Confirm no `update.electronjs.org` request is made.

## 15. Acceptance Criteria

1. The legacy custom update-server code is removed from `src/background.ts`.
2. No production runtime code uses `UPDATESERVER` to configure app updates.
3. `update-electron-app` is installed and initialized from a dedicated main-process service.
4. Updater uses `repo: "robertzengcn/aiFetchly"`.
5. Windows packaged GitHub build initializes auto-updates.
6. macOS packaged GitHub build initializes auto-updates.
7. Microsoft Store/MSIX build skips GitHub auto-updates.
8. Windows GitHub Release contains required Squirrel assets.
9. macOS GitHub Release contains signed ZIP assets.
10. Draft and prerelease GitHub Releases are not treated as stable update targets.
11. At least one end-to-end Windows upgrade test passes.
12. At least one end-to-end macOS upgrade test passes per supported architecture.
13. Release documentation explains how to publish update-compatible releases.

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Missing Windows `RELEASES` or `.nupkg` assets | Windows update silently fails | Add CI artifact validation before publication |
| macOS release includes DMG but no ZIP | macOS update fails | Keep `maker-zip` and validate ZIP asset |
| macOS app is unsigned or not notarized | Update fails or app is blocked by Gatekeeper | Enforce signing/notarization in production CI |
| Release stays draft | Users do not receive update | Document manual publish step and validation checklist |
| Release is marked prerelease | Stable updater ignores it | Use prerelease only for explicit future beta channels |
| Store build self-updates from GitHub | Store policy/channel conflict | Gate on `process.windowsStore` and future channel variable |
| App launches during Squirrel events | Duplicate startup or update problems | Add `electron-squirrel-startup` guard at top of main process |
| Repository metadata changes | Updater points to wrong repo | Set `repo` explicitly in updater config |

## 17. Open Questions

1. Should AiFetchly support macOS universal builds, separate x64/arm64 builds, or both?
2. Should update checks use the default 10 minute interval or a product-selected interval such as 1 hour?
3. Should the app expose a manual "Check for updates" UI action in v1, or rely on startup/periodic checks only?
4. Should beta/prerelease channels be added later for internal testing?
5. Should release publication remain manually approved after draft validation, or should CI publish automatically after all checks pass?

## 18. References

- `update-electron-app` requirements and API: `https://github.com/electron/update-electron-app`
- Electron publishing and GitHub Releases updater flow: `https://www.electronjs.org/docs/latest/tutorial/tutorial-publishing-updating`
- Electron `autoUpdater` platform notes: `https://www.electronjs.org/docs/latest/api/auto-updater`
- Electron Forge auto update guide: `https://www.electronforge.io/advanced/auto-update`
