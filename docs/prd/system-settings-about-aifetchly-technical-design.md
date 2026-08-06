# System Settings About aiFetchly - Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-07
- **Companion PRD**: [`system-settings-about-aifetchly-prd.md`](system-settings-about-aifetchly-prd.md)
- **Primary owners**: Electron main process and System Settings maintainers
- **Affected runtime boundaries**: renderer (Vue), Electron main process, preload bridge

## 1. Purpose

Add an **About aiFetchly** page to System Settings that shows the installed app
version and official website, and exposes a **Check for updates** action that
flows into the existing GitHub Releases auto-update path.

This design follows the same layering and IPC rules as the rest of the app:
side effects (open website, check/download updates, quit-to-install) live only
in the main process; the renderer renders state and fires validated IPC.

## 2. Verified Current State (divergences from the PRD)

The PRD was written assuming the *Windows/macOS GitHub Auto Upgrade* initiative
had already shipped. On the `dev` branch this worktree is based on, that is
**not true**. Verified facts that change the design:

| PRD premise | Verified reality on `dev` |
| --- | --- |
| `AppUpdateService` + `update-electron-app` already exist (PRD §2.1, §11.2) | Neither the dependency, the service, nor `src/main-process/updater/` exist. `background.ts` still contains the **legacy** `UPDATESERVER`-based `autoUpdater.setFeedURL` block (lines ~417–424). |
| The auto-upgrade work is reusable | It lived on `worktree-appupgrade`, which is **deleted from disk** and **never pushed** to origin. The proven code is unavailable; the service must be recreated. |
| `src/config/aiNavigationRouteManifest.ts` exists (FR-1.5) | Does **not** exist; no `aiNavigable` symbol anywhere. FR-1.5 cannot be satisfied on this branch. |
| `GET_APP_INFO` resolves version reliably (PRD §2.3) | `MainProcessAppInfoModule` reads `process.cwd()/package.json` and falls back to a hardcoded `'1.0.0'`, not `app.getVersion()`. |

**Scope decision (confirmed with product owner):** build a **minimal updater
here**. Add `update-electron-app@^3.3.0` (already physically present in the
repo's `node_modules`, version 3.3.0), create `AppUpdateService`, wire
`initializeAppUpdates()` into `background.ts`, and delete the legacy
`UPDATESERVER` feed block. Release CI / signing / artifact validation stays in
the separate auto-upgrade PRD and is explicitly out of scope.

### 2.1 What does exist and is reused

- `src/modules/MainProcessAppInfoModule.ts` (hardened here to use `app.getVersion()`).
- `src/views/api/app.ts` `getAppInfo()` → `GET_APP_INFO` (`app:info`).
- `src/views/pages/systemsetting/index.vue` dedicated-page nav pattern (MCP / Skills buttons).
- `src/main-process/communication/_shared/registerValidatedHandler.ts` envelope contract.
- `src/modules/Logger` (`log.info/warn/error`) for `[auto-update]` tagged logging.
- Dedicated-page siblings `mcp.vue` / `skills.vue` (Vuetify card + back-button layout).

## 3. Architecture

```text
Renderer (Vue About page)
  -> views/api/app.ts          getAppInfo / openWebsite / getUpdateStatus
                               / checkForUpdates / installUpdate
                               + onUpdateStatus subscription
  -> preload invoke whitelist  (4 invoke channels + 1 event channel)
  -> about-ipc.ts handlers
       APP_OPEN_WEBSITE      -> shell.openExternal(AIFETCHLY_WEBSITE_URL)
       APP_GET_UPDATE_STATUS -> AppUpdateService.getStatus()
       APP_CHECK_FOR_UPDATES -> AppUpdateService.checkForUpdatesNow()
       APP_INSTALL_UPDATE    -> AppUpdateService.quitAndInstall()
Main process
  -> AppUpdateService (new, src/main-process/updater/)
       initializeAppUpdates()  -> update-electron-app({repo, interval, logger})
       autoUpdater events      -> status state machine -> webContents.send(EVENT)
  -> background.ts             calls initializeAppUpdates(); legacy UPDATESERVER block removed
```

### 3.1 Trust boundaries

| Boundary | Input | Protection |
| --- | --- | --- |
| Renderer → main (open website) | none | Dedicated channel opens a **fixed, allowlisted** URL constant. The renderer cannot supply an arbitrary URL, so FR-3.3 is satisfied structurally. |
| Renderer → main (check/install) | none | No caller-supplied feed URL (FR-7.3). Feed repo is a main-process constant. |
| Main → renderer (status event) | `UpdateStatusSnapshot` | Bounded enum + version string; no credentials, URLs beyond the website, or feed details. |
| Updater feed → main | GitHub release metadata | Only `update-electron-app` over `https://update.electronjs.org`; SemVer comparison stays inside the library. |

## 4. Module Layout

| File | Change |
| --- | --- |
| `src/config/appInfo.ts` | **New.** `AIFETCHLY_WEBSITE_URL`, `AIFETCHLY_UPDATE_REPO` (`robertzengcn/aiFetchly`), `AIFETCHLY_UPDATE_INTERVAL` (`'1 hour'`). Pure constants, renderer-safe. |
| `src/config/channellist.ts` | **Add** `APP_OPEN_WEBSITE`, `APP_CHECK_FOR_UPDATES`, `APP_GET_UPDATE_STATUS`, `APP_INSTALL_UPDATE`, `APP_UPDATE_STATUS_EVENT`. |
| `src/modules/MainProcessAppInfoModule.ts` | **Harden**: `version` from `app.getVersion()` (fallback package.json then `'1.0.0'`). |
| `src/main-process/updater/UpdateStatus.ts` | **New.** Status enums, `UpdateStatusSnapshot`, `UpdateUnsupportedReason`, pure `computeUpdateSupport()` + `mapAutoUpdaterEvent()`. |
| `src/main-process/updater/AppUpdateService.ts` | **New.** DI-based service: `initializeAppUpdates`, `checkForUpdatesNow` (cooldown + concurrency), `quitAndInstall`, `getStatus`, `setStatusSink`. |
| `src/main-process/communication/about-ipc.ts` | **New.** `registerAboutIpcHandlers(win)` for the 4 invoke channels; wires `AppUpdateService` status → `APP_UPDATE_STATUS_EVENT`. |
| `src/main-process/communication/index.ts` | **Register** `registerAboutIpcHandlers(win)`. |
| `src/background.ts` | Call `appUpdateService.initializeAppUpdates()` after window creation; **remove** legacy `UPDATESERVER` block + unused `autoUpdater` require. |
| `package.json` | **Add** `update-electron-app@^3.3.0` to `dependencies`. |
| `src/preload.ts` | Whitelist the 4 invoke channels + `APP_UPDATE_STATUS_EVENT` in `invoke`/`receive`/`removeListener`/`removeAllListeners` + imports. |
| `src/views/api/app.ts` | Add `openWebsite`, `getUpdateStatus`, `checkForUpdates`, `installUpdate`, `onUpdateStatus`, `offUpdateStatus`, `removeAllUpdateStatusListeners`. |
| `src/views/pages/systemsetting/about.vue` | **New.** Version/website rows + Check-for-updates button + status text (state matrix). |
| `src/views/pages/systemsetting/index.vue` | Add **About aiFetchly** nav button → `system_setting_about`. |
| `src/views/router/index.ts` | Add `about` child route under `/systemsetting` (`system_setting_about`). |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add `about.*` + `route.about` keys. |
| `test/vitest/main/updater/AppUpdateService.test.ts` | **New.** Unit tests for gating, idempotency, cooldown, concurrency, event mapping. |

## 5. Update Status Model

```ts
type UpdateStatusState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready-to-restart'
  | 'unsupported'
  | 'error';

type UpdateUnsupportedReason = 'development' | 'store' | 'platform';

interface UpdateStatusSnapshot {
  state: UpdateStatusState;
  /** Present when state === 'unsupported'. */
  unsupportedReason?: UpdateUnsupportedReason;
  /** Current installed version (app.getVersion()). */
  currentVersion: string;
  /** Version available for download, when known. */
  availableVersion?: string;
  /** Epoch ms of the last completed check; used for cooldown display. */
  lastCheckedAt?: number;
  /** Stable, localized-friendly error code (never raw exception text). */
  errorCode?: string;
}
```

### 5.1 Channel gating (pure)

```ts
function computeUpdateSupport(input: {
  isPackaged: boolean;
  platform: string;
  isWindowsStore: boolean;
}): { supported: true } | { supported: false; reason: UpdateUnsupportedReason };
```

Rules (FR-5): `!isPackaged` → `development`; `isWindowsStore` → `store`;
`platform` not in `['win32','darwin']` → `platform`; else `supported`.

### 5.2 Event → state mapping (pure)

| `autoUpdater` event | resulting state |
| --- | --- |
| `checking-for-update` | `checking` |
| `update-available` | `downloading` (autoUpdater auto-downloads) |
| `update-not-available` | `up-to-date`, stamp `lastCheckedAt` |
| `update-downloaded` | `ready-to-restart`, stamp `lastCheckedAt`, set `availableVersion` if present |
| `error` | `error`, stamp `lastCheckedAt`, set `errorCode` |

## 6. AppUpdateService

### 6.1 Dependency injection

The service depends on Electron (`app`, `autoUpdater`) and `update-electron-app`,
none of which are importable from vitest without a real Electron runtime. The
service therefore takes an injectable deps object; the production singleton
supplies real Electron, tests supply fakes.

```ts
interface AutoUpdaterLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown> | void;
  quitAndInstall(): void;
}

interface UpdateElectronAppLike {
  (options: UpdateElectronAppOptions): void;
}

interface AppUpdateServiceDeps {
  isPackaged: () => boolean;
  platform: () => string;
  isWindowsStore: () => boolean;
  getAppVersion: () => string;
  getAutoUpdater: () => AutoUpdaterLike;
  getUpdateElectronApp: () => UpdateElectronAppLike;
  now: () => number;                 // injectable clock (scripts cannot use Date.now)
}
```

### 6.2 Public surface

```ts
class AppUpdateService {
  constructor(deps: AppUpdateServiceDeps);
  initializeAppUpdates(): void;                 // idempotent; subscribes events once
  getStatus(): UpdateStatusSnapshot;            // synchronous snapshot
  checkForUpdatesNow(): Promise<UpdateStatusSnapshot>; // cooldown + concurrency guarded
  quitAndInstall(): void;
  setStatusSink(fn: ((s: UpdateStatusSnapshot) => void) | null): void;
}
```

### 6.3 Manual check guards

- **Unsupported**: `checkForUpdatesNow` returns the unsupported snapshot without touching `autoUpdater` (FR-5.4, NFR for Store/dev).
- **Concurrency** (NFR-2): if `state === 'checking' || state === 'downloading'`, return the current snapshot instead of starting a second check.
- **Cooldown** (FR-4.4, 60 s): if `now - lastCheckedAt < 60_000` and state is terminal, return the current snapshot.
- Otherwise set `checking`, call `autoUpdater.checkForUpdates()`, and let the event subscribers drive further transitions.

### 6.4 Idempotent initialization

`initializeAppUpdates()` short-circuits if already called. When supported it
invokes `updateElectronApp({ repo, updateInterval, logger })` exactly once and
subscribes the five `autoUpdater` event handlers exactly once. The logger
adapter routes single-string messages to `log.info/warn/error('[auto-update] …')`
(`update-electron-app`'s `ILogger` requires single-string methods).

## 7. IPC Design

All four channels are **no-input** `ipcMain.handle` handlers (like
`LANGUAGE_PREFERENCE_GET`). Because the renderer passes no payload, there is no
schema to bypass and no caller-supplied URL/feed (FR-7.2, FR-7.3 satisfied
structurally). Each returns the standard `CommonMessage<T>` envelope.

| Channel | Direction | Returns |
| --- | --- | --- |
| `app:open:website` | invoke | `{ status, msg }` — opens `AIFETCHLY_WEBSITE_URL` via `shell.openExternal`; failure → `status:false`. |
| `app:update:status` | invoke | `UpdateStatusSnapshot`. |
| `app:check-for-updates` | invoke | `UpdateStatusSnapshot` after attempting the check. |
| `app:install-update` | invoke | `{ status, msg }`; calls `quitAndInstall()` only when `ready-to-restart`. |
| `app:update:status:event` | main→renderer push | `UpdateStatusSnapshot`, fired on every state transition. |

## 8. Background.ts Wiring

In the production `else` branch (where the legacy block lived), call
`appUpdateService.initializeAppUpdates()` once the window exists. Remove:

```ts
const autoUpdater = require("electron").autoUpdater;   // line ~6
const server = import.meta.env.UPDATESERVER as string;  // ~418
if (server) { autoUpdater.setFeedURL({ url }); autoUpdater.checkForUpdates(); } // ~419-424
```

`initializeAppUpdates()` internally no-ops on dev/Store/Linux, so calling it
unconditionally is safe and preserves "automatic checks intact" (NFR-5).

## 9. UX / State Matrix (Phase 1)

Matches PRD §10.2. The About page computes button enable + status text from
`UpdateStatusSnapshot.state`:

| `state` | Button | Status text key |
| --- | --- | --- |
| `idle` | enabled | `about.status_idle` |
| `checking` | disabled + loading | `about.status_checking` |
| `up-to-date` | enabled (cooldown) | `about.status_up_to_date` (with version) |
| `downloading` | disabled | `about.status_downloading` |
| `ready-to-restart` | show Restart action | `about.status_ready_to_restart` |
| `unsupported` | hidden | `about.unsupported_<reason>` |
| `error` | enabled (cooldown) | `about.status_error` |

First paint reads version/website synchronously from `getAppInfo()` + the
website constant; the update status is fetched on mount and then driven by the
event subscription (NFR-3).

## 10. Internationalization

Add `about.*` (title, version label, website label, open-website button, all
status keys, unsupported reasons, restart button) and `route.about` to
`en/zh/es/fr/de/ja.ts`. The page uses `t('about.x') || 'English fallback'`.

## 11. Non-Reuse / Explicit Omissions

- No `SystemSetting` DB rows for About fields.
- No `autoUpdater` / `shell` calls from renderer or preload beyond the narrow whitelist.
- No GitHub Releases REST from the renderer.
- `aiNavigationRouteManifest.ts` does not exist on this branch; **FR-1.5 is
  deferred** until the AI-navigation feature lands. Tracked as a known gap.
- Release CI, code signing, and artifact validation remain in the auto-upgrade PRD.

## 12. Test Plan

### 12.1 Unit (`test/vitest/main/updater/AppUpdateService.test.ts`)

- `computeUpdateSupport`: dev → `development`; `windowsStore` → `store`; linux → `platform`; packaged win/mac → supported.
- `initializeAppUpdates` is idempotent: `updateElectronApp` called once; event handlers subscribed once; no-op when unsupported.
- `checkForUpdatesNow`: unsupported returns snapshot without calling `autoUpdater.checkForUpdates`; concurrency guard prevents double calls during `checking`/`downloading`; cooldown blocks re-check within 60 s of a terminal result.
- Event → state mapping produces correct snapshots and stamps `lastCheckedAt`.
- `quitAndInstall` delegates to the injected autoUpdater.
- `setStatusSink` receives every transition.

### 12.2 Manual QA (out of automation scope here)

Packaged Windows/macOS GitHub build: version equality, website open, up-to-date,
newer-release detection → download → native restart dialog. Dev run: About
works, check unsupported. Language switch: all strings present.

## 13. Implementation Sequence

1. Config + channel constants; harden `MainProcessAppInfoModule`.
2. `UpdateStatus` (pure) + tests.
3. `AppUpdateService` (DI) + tests.
4. `about-ipc.ts` + registration.
5. `background.ts` wiring + legacy removal + `package.json` dep.
6. Preload whitelist + renderer API.
7. About page + router + nav button.
8. i18n (6 languages).
9. Run tests + `tsc` + `vue-tsc`; commit per logical unit.

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| `update-electron-app` not in `package.json` | Add `^3.3.0`; it is already in `node_modules`. |
| Updater runs on Store/dev builds | `computeUpdateSupport` gates before any `autoUpdater` call; remove legacy block so `UPDATESERVER` no longer triggers. |
| Stale About version in packaged builds | `app.getVersion()` replaces cwd `package.json` read. |
| Manual-check spam | Cooldown (60 s) + in-flight concurrency guard. |
| `ILogger` variadic vs single-string | Adapter calls `log.x('[auto-update] ' + message)` with one string. |
| Lost `worktree-appupgrade` work | Recreated minimally here; release-pipeline parts intentionally deferred to the auto-upgrade PRD. |
