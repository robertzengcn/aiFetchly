# System Settings About aiFetchly - Product Requirements Document

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Proposed |
| Created | 2026-08-06 |
| Owner | AiFetchly engineering |
| Product areas | System Settings, desktop identity, auto-upgrade UX |
| Target platforms | Windows x64, macOS x64, macOS arm64 (About page on all platforms; GitHub upgrade actions gated) |
| Website URL | `https://www.sellart-online.com` |
| Related PRD | [Windows and macOS GitHub Auto Upgrade PRD](./windows-macos-github-auto-upgrade-prd.md) |
| Related technical design | [Windows and macOS GitHub Auto Upgrade Technical Design](./windows-macos-github-auto-upgrade-technical-design.md) |
| Related code | `src/views/pages/systemsetting/`, `src/main-process/updater/AppUpdateService.ts`, `src/modules/MainProcessAppInfoModule.ts`, `src/views/api/app.ts`, `src/config/channellist.ts`, `src/config/aiNavigationRouteManifest.ts` |

## 1. Summary

AiFetchly already performs GitHub Releases based auto-updates for packaged Windows and macOS GitHub builds through `AppUpdateService` and `update-electron-app`. Users can receive updates at startup and on a periodic interval, then restart through the native download-complete dialog.

What is missing is a clear in-app place to see product identity and trigger a manual update check. This PRD adds an **About aiFetchly** surface inside System Settings that shows:

1. The current application version
2. The company / product website (`https://www.sellart-online.com`)
3. A **Check for updates** action that can detect a newer release and continue into the existing upgrade path

This feature reuses the existing GitHub updater. It does not introduce a custom update server, does not replace automatic checks, and does not move upgrade logic into the renderer.

## 2. Problem

### 2.1 Users cannot find version or upgrade controls

System Settings currently exposes configuration groups and management entry points (MCP, Skills, AI Provider, Hooks, Subagents, Diagnostics). There is no About page for:

- current installed version
- official website
- manual "check for updates"

Support and users therefore have no in-app answer to "what version am I on?" or "is there a newer build?"

### 2.2 Manual check was deferred from the auto-upgrade initiative

The GitHub auto-upgrade PRD left this open:

> Should the app expose a manual "Check for updates" UI action in v1, or rely on startup/periodic checks only?

Automatic checks are implemented. Product now needs the manual UI path so users can verify updates on demand without waiting for the next periodic poll or restarting the app.

### 2.3 Version source must match the updater

`GET_APP_INFO` / `MainProcessAppInfoModule` currently may read `package.json` from `process.cwd()`, which is unreliable in packaged builds. The About page and upgrade comparison must use the same version Electron reports for the installed app (`app.getVersion()`), which is also what the public update feed expects.

### 2.4 Upgrade is not available on every channel

GitHub self-update is intentionally skipped for:

- unpackaged development runs
- unsupported platforms (for example Linux in current updater policy)
- Microsoft Store / MSIX builds

The About page must still show identity information on those builds, but must not pretend GitHub upgrade is available.

## 3. Goals

1. Add an About aiFetchly entry point in System Settings.
2. Show the current installed app version accurately.
3. Show the official website URL and open it in the system browser.
4. Provide a **Check for updates** button that triggers a manual update check.
5. When a newer version exists on a supported GitHub channel, allow the user to upgrade through the existing download + restart flow.
6. Reuse `AppUpdateService` / Electron `autoUpdater`; do not invent a second update client.
7. Communicate clear status: checking, up to date, downloading, ready to restart, unsupported, or error.
8. Internationalize all user-facing About / update strings in all supported languages.
9. Register the About route for AI app navigation where safe.
10. Keep upgrade and website-open logic in the main process with validated IPC.

## 4. Non-Goals

1. Do not build a custom update server or restore the legacy `UPDATESERVER` runtime path.
2. Do not migrate to `electron-updater` or Electron Builder in this PRD.
3. Do not implement staged rollout, beta channels, or force-install without restart consent.
4. Do not build a full custom download-progress / changelog UI in Phase 1.
5. Do not enable GitHub self-update for Microsoft Store / MSIX builds.
6. Do not enable GitHub self-update for unpackaged development runs.
7. Do not add Linux auto-upgrade in this PRD (About page may still render).
8. Do not store update state in SQLite / TypeORM / Models.
9. Do not put version discovery or `autoUpdater` calls directly in Vue components.
10. Do not turn the About page into a general diagnostics or settings dump.

## 5. Users

### 5.1 End Users

Users need a trusted place to confirm they are on a current version, visit the product website, and upgrade when a newer GitHub Release exists.

### 5.2 Support Operators

Support needs users to report an accurate installed version from the About page and to attempt a manual update check before filing "I'm stuck on an old build" tickets.

### 5.3 Release Engineers

Release engineers need the manual check path to exercise the same GitHub Releases feed and SemVer constraints already required by the auto-upgrade pipeline.

## 6. Product Principles

### 6.1 One Updater

The About page is a UI entry point into the existing GitHub updater. Startup / hourly checks and manual checks share one feed configuration and one download path.

### 6.2 About Is Always Useful

Version and website remain useful even when upgrade is unavailable. Upgrade controls degrade gracefully by channel.

### 6.3 Accurate Version First

Displayed version must match the packaged app version used by Electron's auto-updater. Incorrect About version is worse than no About page.

### 6.4 Main Process Owns Side Effects

Opening external websites, checking for updates, downloading updates, and quitting to install remain main-process responsibilities.

### 6.5 Match Existing Settings Navigation Patterns

About should follow dedicated System Settings pages (AI Provider, MCP, Skills), not the DB-backed settings tree of key/value preferences.

## 7. User Stories

### US-1: View About Information

As a user, I want an About aiFetchly page in System Settings so I can see the product version and official website without leaving the app settings area.

Acceptance criteria:

- System Settings left navigation includes an About aiFetchly entry.
- The page shows product name, current version, and website URL.
- The page is reachable from System Settings without requiring a selected settings-tree group.

### US-2: Open Official Website

As a user, I want to open `https://www.sellart-online.com` from About so I can reach product / company information in my system browser.

Acceptance criteria:

- Clicking the website link or button opens the URL via main-process `shell.openExternal`.
- Only the allowlisted website URL is opened.
- The renderer never calls Node/`shell` APIs directly.

### US-3: Check for Updates on Supported Builds

As a Windows or macOS user on a GitHub-distributed packaged build, I want to click **Check for updates** so I can learn immediately whether a newer release exists.

Acceptance criteria:

- Button triggers a manual check through the main-process updater service.
- While checking, the UI shows a checking state and disables repeat spam.
- If no newer version exists, the UI reports that the app is up to date and shows the current version.
- If a newer version exists, the existing download path starts and the UI reflects downloading / ready-to-restart status.
- After download, the user can restart to apply the update through the existing consent dialog (native dialog acceptable in Phase 1).

### US-4: Unsupported Channel Messaging

As a user on a development build, Linux build, or Microsoft Store build, I want About to explain why Check for updates is unavailable so I am not left with a silent failure.

Acceptance criteria:

- About still shows version and website.
- Check for updates is disabled or replaced with an explanatory message for unsupported channels.
- Microsoft Store builds must not call the GitHub updater.

### US-5: Support Asks for Version

As support, I want users to open About and report the displayed version so we can compare it against published GitHub Releases.

Acceptance criteria:

- Version text is visible without scrolling past unrelated settings.
- Version equals `app.getVersion()` for packaged builds.

## 8. Functional Requirements

### FR-1 About Entry Point

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Add a System Settings left-nav action labeled About aiFetchly (or localized equivalent). | P0 |
| FR-1.2 | Navigate to a dedicated route such as `/systemsetting/about` with route name `system_setting_about`. | P0 |
| FR-1.3 | Follow the dedicated-page pattern used by AI Provider / MCP / Skills, not the DB settings tree. | P0 |
| FR-1.4 | Provide a back action to System Settings index. | P1 |
| FR-1.5 | Add the About route to `aiNavigationRouteManifest.ts` with `aiNavigable: true` and natural-language aliases such as "about", "app version", "check for updates". | P1 |

### FR-2 Version Display

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Display the current installed app version on the About page. | P0 |
| FR-2.2 | Resolve version from Electron `app.getVersion()` in the main process for packaged builds. | P0 |
| FR-2.3 | Reuse or harden `GET_APP_INFO` / app-info module so About does not invent a second version channel. | P0 |
| FR-2.4 | Do not display a version sourced only from renderer `package.json` imports. | P0 |

### FR-3 Website

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Display website URL `https://www.sellart-online.com`. | P0 |
| FR-3.2 | Opening the website uses main-process `shell.openExternal` through a validated IPC path. | P0 |
| FR-3.3 | Reject non-allowlisted URLs if a generic open-external IPC is reused. | P0 |
| FR-3.4 | Website open failures surface a user-visible error toast/message. | P1 |

### FR-4 Manual Update Check

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Provide a **Check for updates** button on the About page. | P0 |
| FR-4.2 | Manual check calls into `AppUpdateService` (or an extension of it), not a new updater package. | P0 |
| FR-4.3 | On supported packaged Win/macOS GitHub builds, manual check invokes Electron `autoUpdater.checkForUpdates()` after the feed is already configured by `initializeAppUpdates()`. | P0 |
| FR-4.4 | Debounce / disable the button while a check or download is in progress (recommended minimum cooldown: 60 seconds after a completed check). | P0 |
| FR-4.5 | Report distinct UI states: `idle`, `checking`, `up-to-date`, `downloading`, `ready-to-restart`, `unsupported`, `error`. | P0 |
| FR-4.6 | When up to date, show a clear message including the current version. | P0 |
| FR-4.7 | When an update downloads successfully, reuse the existing restart consent path (`notifyUser` / native dialog is acceptable in Phase 1). | P0 |
| FR-4.8 | Push status updates to the renderer through typed IPC events or invoke responses; do not poll filesystem update artifacts from Vue. | P0 |
| FR-4.9 | Log manual check outcomes in main-process logs with the `[auto-update]` tag. | P1 |

### FR-5 Channel Gating

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Unpackaged / development builds: About works; manual GitHub check is unsupported. | P0 |
| FR-5.2 | Microsoft Store / MSIX (`process.windowsStore`): About works; GitHub check is unsupported. | P0 |
| FR-5.3 | Platforms outside current updater support (for example Linux): About works; GitHub check is unsupported unless a later PRD expands platform support. | P0 |
| FR-5.4 | Unsupported states must show a localized explanation, not a generic failure. | P0 |

### FR-6 Internationalization

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | Add all About / update UI strings to `en`, `zh`, `es`, `fr`, `de`, and `ja`. | P0 |
| FR-6.2 | Use `t(...)` with English fallbacks in the Vue page. | P0 |
| FR-6.3 | Route title / menu labels follow existing System Settings i18n patterns. | P0 |

### FR-7 Security and Architecture

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | No direct database access from the About page, updater IPC, or `AppUpdateService`. | P0 |
| FR-7.2 | IPC payloads for open-website and update-check are validated on the receiving side. | P0 |
| FR-7.3 | Renderer cannot pass an arbitrary update feed URL. | P0 |
| FR-7.4 | Keep context isolation; no Node integration in renderer for this feature. | P0 |

## 9. Non-Functional Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| NFR-1 | Manual check must not block app startup or freeze the UI thread. | P0 |
| NFR-2 | Repeated clicks must not create unbounded concurrent update checks. | P0 |
| NFR-3 | About page first paint should not wait on network; version/website render immediately. | P0 |
| NFR-4 | Update errors must be diagnosable from main-process logs without exposing credentials. | P0 |
| NFR-5 | Feature must not regress automatic startup / hourly update checks. | P0 |

## 10. UX Specification (Phase 1)

### 10.1 Layout

One composition page with:

- Title: About aiFetchly
- Current version row
- Website row / link
- Primary action: Check for updates
- Status text under the action

No dashboard cards, no diagnostics dump, no settings editors on this page.

### 10.2 Button State Matrix

| Condition | Button | Status text |
| --- | --- | --- |
| Supported + idle | Enabled: Check for updates | Empty or last-checked summary |
| Supported + checking | Disabled + loading | Checking for updates… |
| Supported + up to date | Enabled after cooldown | You're on the latest version (x.y.z) |
| Supported + downloading | Disabled | Downloading update… |
| Supported + ready to restart | Optional Restart action / native dialog already shown | Update downloaded. Restart to apply. |
| Unsupported channel | Disabled or hidden | Explanation for this channel |
| Error | Enabled after cooldown | Could not check for updates. Try again later. |

### 10.3 Phase 1 vs Later

Phase 1:

- About page
- Accurate version
- Website open
- Manual check
- Reuse native restart dialog

Later (out of Phase 1 scope unless pulled in):

- In-app changelog / release notes
- Detailed download progress bar
- Fully translated custom restart dialog via `onNotifyUser`
- "Open download page" fallback button to website or GitHub Releases

## 11. Architecture Constraints

### 11.1 Recommended shape

```text
System Settings index
  → About aiFetchly page (Vue)
      → getAppInfo() / version IPC
      → openWebsite IPC (allowlisted URL)
      → checkForUpdatesNow IPC
Main process
  → AppUpdateService (extended)
      → initializeAppUpdates() already configured feed
      → autoUpdater.checkForUpdates() for manual check
      → status events to renderer
  → shell.openExternal(allowlisted website)
```

### 11.2 Existing building blocks to reuse

- `src/main-process/updater/AppUpdateService.ts`
- `update-electron-app` initialization already called from `src/background.ts`
- `GET_APP_INFO` / `src/views/api/app.ts` (harden version source)
- System Settings dedicated-page navigation pattern
- i18n files under `src/views/lang/`

### 11.3 Explicit non-reuse

- Do not add About fields as `SystemSetting` DB rows.
- Do not call `autoUpdater` from renderer or preload beyond exposing a narrow IPC API.
- Do not query GitHub Releases REST from the renderer as the primary upgrade path.

## 12. Release and Operational Dependencies

Manual check quality depends on the auto-upgrade release pipeline already documented in:

- `docs/prd/windows-macos-github-auto-upgrade-prd.md`
- `docs/RELEASE_WORKFLOW.md`

Hard dependencies:

1. Production releases published as non-draft, non-prerelease GitHub Releases.
2. Required platform assets present (`RELEASES` + nupkg on Windows; signed ZIP on macOS).
3. Strict SemVer release tags compatible with `update.electronjs.org`.

If SemVer / asset requirements are not met, the About button can correctly report "up to date" or error while a newer installer exists on the website. Release hygiene is therefore a product acceptance dependency, not only an ops convenience.

## 13. Acceptance Criteria

1. User can open System Settings → About aiFetchly.
2. Packaged app shows the same version as `app.getVersion()`.
3. Website opens `https://www.sellart-online.com` in the system browser.
4. On a packaged GitHub Windows/macOS build with a newer published SemVer release, Check for updates detects the update and proceeds through download + restart consent.
5. On the same build with no newer release, UI reports up to date.
6. On unsupported channels, UI explains unavailability and does not call GitHub updater.
7. Automatic updater behavior remains intact.
8. All About / update strings exist in en/zh/es/fr/de/ja.
9. Unit tests cover updater gating + manual-check status transitions.
10. Route/manifest wiring allows AI navigation to the About page by aliases such as "app version" / "check for updates".

## 14. Testing Strategy

### 14.1 Automated

- Extend `test/vitest/main/updater/AppUpdateService.test.ts` for manual-check entry points and unsupported reasons.
- Add IPC contract tests for open-website allowlist and check-for-updates invoke/event payloads.
- Add renderer/unit coverage for button state mapping where practical.
- Verify AI navigation manifest includes `system_setting_about` if added.

### 14.2 Manual

1. Packaged Windows GitHub build: About version, website open, check up-to-date, check with newer release, restart install.
2. Packaged macOS GitHub build: same matrix for the supported arch.
3. Dev/`yarn dev`: About works; check unsupported.
4. Store/MSIX if available: About works; GitHub check unsupported.
5. Switch UI language and confirm About strings.

## 15. Rollout Plan

### Phase 1 — Ship

- About page + nav entry
- Accurate version
- Website open
- Manual check + status messaging
- Reuse native restart dialog
- i18n + tests

### Phase 2 — Enrich

- Last-checked timestamp
- Available version label when known
- Optional open website / releases fallback when updater cannot run

### Phase 3 — Polish

- Custom translated restart dialog
- Download progress details
- Release notes summary when available from updater metadata

## 16. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Incorrect version from cwd `package.json` | Users/support trust wrong build identity | Use `app.getVersion()` for packaged About display |
| Non-SemVer release tags | Manual check never sees newer builds | Enforce SemVer tags in release process before claiming upgrade UX complete |
| Missing release assets | Download fails after "update available" | Keep release artifact validation; show actionable error |
| Users spam Check for updates | Rate pressure / noisy logs | Disable during in-flight work + cooldown |
| Store builds accidentally call GitHub updater | Channel policy violation | Reuse existing `process.windowsStore` gate |
| Dual updater implementations | Divergent behavior | Extend `AppUpdateService` only |

## 17. Open Questions

1. Final nav label: **About aiFetchly** vs **About**?
2. Should unsupported channels show a secondary **Open website** / **Open releases** fallback button in Phase 1, or only in Phase 2?
3. Should Phase 1 expose an in-app Restart button after download, or rely solely on the native dialog from `update-electron-app`?
4. Should Linux show only About identity in this PRD, with upgrade deferred indefinitely until a Linux updater PRD exists?
5. Should About also show platform/arch (for support), or keep Phase 1 limited to version + website + check?

## 18. Recommended Defaults for Open Questions

| Question | Recommended default |
| --- | --- |
| Nav label | About aiFetchly |
| Unsupported fallback button | Phase 2 |
| Restart UX | Native dialog in Phase 1 |
| Linux | About only; no GitHub upgrade action |
| Platform/arch | Optional Phase 2 support detail |

## 19. Success Metrics

1. Users can self-serve version identification without support screenshots of unrelated pages.
2. Manual check converts into successful upgrade on supported channels when a valid newer GitHub Release exists.
3. Support tickets of the form "how do I update?" decrease after the About entry ships.
4. No increase in Store-channel GitHub updater initialization.

## 20. References

- [Windows and macOS GitHub Auto Upgrade PRD](./windows-macos-github-auto-upgrade-prd.md)
- [Windows and macOS GitHub Auto Upgrade Technical Design](./windows-macos-github-auto-upgrade-technical-design.md)
- [Release Workflow](../RELEASE_WORKFLOW.md)
- `src/main-process/updater/AppUpdateService.ts`
- `src/views/pages/systemsetting/index.vue`
- `update-electron-app` package API
- Electron `autoUpdater` documentation
