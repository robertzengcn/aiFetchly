# System Settings About aiFetchly - Technical Design

## Document Information

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Status | Draft |
| Created | 2026-08-06 |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/system-settings-about-aifetchly-prd.md` |
| Related updater PRD | `docs/prd/windows-macos-github-auto-upgrade-prd.md` |
| Related updater design | `docs/prd/windows-macos-github-auto-upgrade-technical-design.md` |
| Target platforms | All platforms for About UI; GitHub manual check on packaged Win/macOS GitHub builds only |
| Primary implementation language | TypeScript 5.x |
| UI stack | Vue 3 + Vuetify + vue-i18n |
| Update client | Existing `update-electron-app` + Electron `autoUpdater` |
| Website URL | `https://www.sellart-online.com` |
| Update repo | `robertzengcn/aiFetchly` |

## 1. Purpose

This document translates the About aiFetchly PRD into an implementation-ready design.

Phase 1 delivers:

1. A dedicated System Settings **About aiFetchly** page
2. Accurate installed app version display
3. Official website open via main-process allowlisted `shell.openExternal`
4. Manual **Check for updates** wired through an extension of `AppUpdateService`
5. Typed IPC + i18n + AI navigation manifest wiring
6. Tests for gating, manual check status, and IPC contracts

This design reuses the existing GitHub updater. It does not introduce `electron-updater`, a custom update server, database entities, or a full custom download-progress UI.

## 2. Requirements Summary / Invariants

1. About page works on all platforms and channels.
2. Manual GitHub update check runs only when `initializeAppUpdates()` has successfully configured the updater (packaged Win/macOS, non-Store).
3. Dev / Linux / Microsoft Store builds show About identity but return an explicit unsupported reason for manual check.
4. Displayed version for packaged builds comes from Electron `app.getVersion()`.
5. Website open uses a fixed allowlist containing only `https://www.sellart-online.com`.
6. Renderer never imports Electron `autoUpdater`, `shell`, or Node `fs` for this feature.
7. Updater and About IPC never access SQLite / TypeORM / Models / Modules DB paths.
8. Automatic startup + hourly checks remain unchanged and continue to own download + native restart dialog behavior.
9. All user-facing About / update strings are added to en/zh/es/fr/de/ja.
10. About route is AI-navigable via the route manifest.

## 3. Current System

### 3.1 Auto-update runtime

`src/main-process/updater/AppUpdateService.ts` already:

- gates by packaged / platform / Microsoft Store
- initializes `update-electron-app` once with `repo: "robertzengcn/aiFetchly"`
- sets `updateInterval: "1 hour"` and `notifyUser: true`
- exposes only `initializeAppUpdates()`

`update-electron-app` configures Electron `autoUpdater.setFeedURL(...)`, checks immediately, and schedules interval checks. It does **not** expose a public `checkNow()` API. Manual check must call `autoUpdater.checkForUpdates()` after initialization.

### 3.2 App info

- Channel: `GET_APP_INFO` (`app:info`) in `src/config/channellist.ts`
- Handler: `src/main-process/communication/sync-msg.ts`
- Module: `src/modules/MainProcessAppInfoModule.ts`
- Renderer API: `src/views/api/app.ts`
- Type: `src/entityTypes/appInfo-type.ts`

Problem: `MainProcessAppInfoModule` prefers `process.cwd()/package.json`, which is unreliable in packaged apps. About and updater comparison require `app.getVersion()`.

### 3.3 System Settings UI pattern

Dedicated pages are separate routes under `/systemsetting/*`, launched from left-nav buttons in `src/views/pages/systemsetting/index.vue` (MCP, Skills, AI Provider, Hooks, Subagents). They are **not** DB-backed settings-tree items.

### 3.4 IPC transport

Renderer uses:

- `windowInvoke(channel)` for request/response (`CommonMessage<T>`)
- `windowReceive(channel, cb)` / `windowRemoveListener` for push events

Preload whitelists channels; new About/update channels must be registered there.

## 4. Target Architecture

```text
System Settings index.vue
  +-- nav button "About aiFetchly"
        |
        v
/systemsetting/about  (about.vue)
  |-- onMounted: getAboutAppInfo()
  |-- click website: openOfficialWebsite()
  |-- click check: checkForUpdatesNow()
  |-- subscribe: APP_UPDATE_STATUS events
        |
        |  IPC (preload whitelist)
        v
main-process/communication/about-ipc.ts
  |-- GET_ABOUT_APP_INFO / harden GET_APP_INFO
  |-- OPEN_OFFICIAL_WEBSITE
  |-- APP_CHECK_FOR_UPDATES
  |-- APP_GET_UPDATE_STATUS
        |
        +-- MainProcessAppInfoModule (version via app.getVersion)
        +-- openOfficialWebsite() allowlist helper
        +-- AppUpdateService.checkForUpdatesNow()
              |
              +-- if not initialized -> unsupported status
              +-- else autoUpdater.checkForUpdates()
              +-- listen autoUpdater events -> broadcast status
              +-- keep notifyUser native restart dialog
```

## 5. Key Design Decisions

### 5.1 Extend AppUpdateService; do not fork updater

Add manual-check and status-tracking APIs to `AppUpdateService`. Do not create a second update client or call GitHub Releases REST from the renderer.

### 5.2 Dedicated About page, not settings-tree rows

About is product identity + upgrade UX. It does not belong in the DB-backed settings group tree.

### 5.3 Prefer hardening `GET_APP_INFO`, plus an About-specific snapshot if needed

Minimum: fix `MainProcessAppInfoModule` so packaged `version` is `app.getVersion()`.

Recommended About snapshot response also includes update capability metadata so the page can disable the button before the first check:

```typescript
{
  name: string;
  version: string;
  websiteUrl: "https://www.sellart-online.com";
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  updateSupported: boolean;
  updateUnsupportedReason: AppUpdateUnsupportedReason | null;
}
```

Platform/arch are included for support usefulness but may be visually secondary in Phase 1 UI.

### 5.4 Manual check uses Electron autoUpdater events

Because `update-electron-app` already attached listeners and set the feed URL, manual check should:

1. Verify updater initialized
2. Enforce cooldown / in-flight guard
3. Call `autoUpdater.checkForUpdates()`
4. Map `checking-for-update` / `update-available` / `update-not-available` / `error` / `update-downloaded` into About status events

Do not call `setFeedURL` again from About code.

### 5.5 Keep native restart dialog in Phase 1

Leave `notifyUser: true`. Do not build a translated custom restart dialog yet. About may show `ready-to-restart` status text when `update-downloaded` fires; the native dialog remains the consent UX.

### 5.6 Fixed website allowlist

Hardcode:

```typescript
export const OFFICIAL_WEBSITE_URL = "https://www.sellart-online.com";
```

IPC open-website accepts no free-form URL from the renderer in Phase 1 (or ignores any provided URL and always opens the constant).

### 5.7 Zod at IPC boundaries

Validate About/update IPC payloads with `zod/v4` schemas in main process. Derive TypeScript types with `z.infer`.

## 6. Module Layout

### 6.1 Add

```text
src/views/pages/systemsetting/about.vue
src/views/api/about.ts
src/entityTypes/aboutAppTypes.ts
src/schemas/aboutAppSchemas.ts
src/main-process/communication/about-ipc.ts
src/main-process/updater/officialWebsite.ts   # optional small helper
test/vitest/main/updater/AppUpdateManualCheck.test.ts
test/vitest/main/aboutIpc.test.ts
test/vitest/utilitycode/aboutAppNavigation.test.ts  # if manifest assertions live here
```

### 6.2 Modify

```text
src/main-process/updater/AppUpdateService.ts
src/modules/MainProcessAppInfoModule.ts
src/entityTypes/appInfo-type.ts                 # only if AppInfo fields expand
src/config/channellist.ts
src/preload.ts
src/background.ts                               # register about-ipc
src/views/pages/systemsetting/index.vue
src/views/router/index.ts
src/views/router/translatedRoutes.ts            # if still maintained for titles
src/config/aiNavigationRouteManifest.ts
src/views/lang/{en,zh,es,fr,de,ja}.ts
test/vitest/main/updater/AppUpdateService.test.ts
```

### 6.3 Do not modify for Phase 1

- Release workflow / publisher config (already covered by updater PRD)
- Database entities / Models / Modules for settings storage
- `update-electron-app` dependency version unless a bug forces it

## 7. Data Contracts

Place shared renderer-safe types in `src/entityTypes/aboutAppTypes.ts`. Place Zod schemas in `src/schemas/aboutAppSchemas.ts` and import them from main-process IPC.

### 7.1 Update status enum

```typescript
export type AppUpdateUiStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "downloading"
  | "ready-to-restart"
  | "unsupported"
  | "error";

export type AppUpdateUnsupportedReason =
  | "not-packaged"
  | "unsupported-platform"
  | "microsoft-store"
  | "not-initialized"
  | "initialization-error";
```

### 7.2 About snapshot

```typescript
export interface AboutAppInfo {
  name: string;
  version: string;
  websiteUrl: string;
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  updateSupported: boolean;
  updateUnsupportedReason: AppUpdateUnsupportedReason | null;
}
```

### 7.3 Update status event

```typescript
export interface AppUpdateStatusEvent {
  status: AppUpdateUiStatus;
  currentVersion: string;
  availableVersion?: string | null;
  messageKey?: string; // optional i18n key hint; renderer owns final copy
  unsupportedReason?: AppUpdateUnsupportedReason | null;
  errorMessage?: string | null;
  checkedAt?: string | null; // ISO timestamp
}
```

### 7.4 Invoke responses

All invoke handlers return `CommonMessage<T>`:

| Channel | `data` type |
| --- | --- |
| `about:app-info` | `AboutAppInfo` |
| `about:open-website` | `{ opened: true }` |
| `app:check-for-updates` | `AppUpdateStatusEvent` (immediate accepted/unsupported state) |
| `app:update-status` (invoke get) | `AppUpdateStatusEvent` |

Push channel:

| Channel | Payload |
| --- | --- |
| `app:update-status-event` | `AppUpdateStatusEvent` |

### 7.5 Zod schemas (illustrative)

```typescript
import { z } from "zod/v4";

export const appUpdateUiStatusSchema = z.enum([
  "idle",
  "checking",
  "up-to-date",
  "downloading",
  "ready-to-restart",
  "unsupported",
  "error",
]);

export const appUpdateStatusEventSchema = z.object({
  status: appUpdateUiStatusSchema,
  currentVersion: z.string().min(1).max(64),
  availableVersion: z.string().min(1).max(64).nullable().optional(),
  messageKey: z.string().max(128).optional(),
  unsupportedReason: z
    .enum([
      "not-packaged",
      "unsupported-platform",
      "microsoft-store",
      "not-initialized",
      "initialization-error",
    ])
    .nullable()
    .optional(),
  errorMessage: z.string().max(500).nullable().optional(),
  checkedAt: z.string().datetime().nullable().optional(),
});
```

Open-website invoke accepts empty object / no args. Do not accept arbitrary URLs.

## 8. AppUpdateService Extension Design

### 8.1 Additional module state

```typescript
let initializeResult: AppUpdateInitializeResult | null = null;
let listenersAttached = false;
let manualCheckInFlight = false;
let lastManualCheckAtMs = 0;
let latestStatus: AppUpdateStatusEvent = {
  status: "idle",
  currentVersion: readAppVersion(),
};

type StatusListener = (event: AppUpdateStatusEvent) => void;
const statusListeners = new Set<StatusListener>();
```

`initializeAppUpdates()` should store its result in `initializeResult` so later manual checks know the skip reason.

### 8.2 Public API additions

```typescript
export function getAppUpdateCapability(): {
  supported: boolean;
  reason: AppUpdateUnsupportedReason | null;
};

export function getAppUpdateStatus(): AppUpdateStatusEvent;

export function subscribeAppUpdateStatus(
  listener: StatusListener
): () => void;

export function checkForUpdatesNow(options?: {
  cooldownMs?: number;
  nowMs?: number;
}): AppUpdateStatusEvent;
```

Recommended defaults:

- `cooldownMs = 60_000`
- reject overlapping checks while `manualCheckInFlight === true` or status is `checking` / `downloading`

### 8.3 Capability resolution

```typescript
function resolveCapability(options?: AppUpdateServiceOptions): {
  supported: boolean;
  reason: AppUpdateUnsupportedReason | null;
} {
  // Mirror initializeAppUpdates gates.
  // If initialize was attempted and failed, reason = initialization-error.
  // If initialize never ran and environment would skip, return that skip reason.
  // If initialize succeeded / already-initialized, supported = true.
}
```

### 8.4 Manual check algorithm

```text
1. Resolve capability
2. If unsupported:
     set latestStatus = { status: "unsupported", unsupportedReason, currentVersion }
     emit + return
3. If cooldown active or in-flight:
     return latestStatus (or a checking/error with messageKey about cooldown)
4. Set manualCheckInFlight = true
5. Ensure autoUpdater listeners attached once (idempotent)
6. Set status checking, emit
7. autoUpdater.checkForUpdates()
8. On update-not-available -> up-to-date, clear in-flight, set checkedAt
9. On update-available -> downloading
10. On update-downloaded -> ready-to-restart
    (native notifyUser dialog still handled by update-electron-app)
11. On error -> error, clear in-flight, log with [auto-update]
```

### 8.5 Listener attachment notes

`update-electron-app` already registers some `autoUpdater` listeners. Additional About listeners must be:

- attached only once
- additive (do not remove package listeners)
- resilient if events fire from automatic interval checks too

Automatic interval checks may therefore update About status while the page is open. That is desirable: the page reflects real updater state.

### 8.6 Version helper

```typescript
function readAppVersion(): string {
  const fn = (app as unknown as { getVersion?: () => string }).getVersion;
  return typeof fn === "function" ? fn.call(app) : "0.0.0";
}
```

Never use `any`.

### 8.7 No DB / no Token / no USER_AI_ENABLED

This feature is not an AI gated capability. Do not put AI-enable checks on About IPC.

## 9. IPC Design

### 9.1 Channel constants

Add to `src/config/channellist.ts`:

```typescript
export const ABOUT_APP_INFO = "about:app-info";
export const ABOUT_OPEN_WEBSITE = "about:open-website";
export const APP_CHECK_FOR_UPDATES = "app:check-for-updates";
export const APP_GET_UPDATE_STATUS = "app:get-update-status";
export const APP_UPDATE_STATUS_EVENT = "app:update-status-event";
```

Keep existing `GET_APP_INFO` working for other callers; harden its version source.

### 9.2 about-ipc.ts responsibilities

File: `src/main-process/communication/about-ipc.ts`

- register invoke handlers
- subscribe to `subscribeAppUpdateStatus` and forward to focused/all BrowserWindows via `webContents.send(APP_UPDATE_STATUS_EVENT, event)`
- open website through allowlisted helper
- never touch database

Registration: call from `background.ts` near other IPC registrations (same pattern as diagnostics / local-ai-runtime IPC modules).

### 9.3 Website open helper

```typescript
export const OFFICIAL_WEBSITE_URL = "https://www.sellart-online.com";

export async function openOfficialWebsite(): Promise<void> {
  const parsed = new URL(OFFICIAL_WEBSITE_URL);
  if (parsed.protocol !== "https:") {
    throw new Error("Official website must be https");
  }
  await shell.openExternal(OFFICIAL_WEBSITE_URL);
}
```

### 9.4 Preload whitelist

Add the new channels to the preload invoke/receive allowlists in `src/preload.ts`. Push event channel must be receivable.

### 9.5 Renderer API

File: `src/views/api/about.ts`

```typescript
export async function getAboutAppInfo(): Promise<AboutAppInfo>;
export async function openOfficialWebsite(): Promise<void>;
export async function checkForUpdatesNow(): Promise<AppUpdateStatusEvent>;
export async function getUpdateStatus(): Promise<AppUpdateStatusEvent>;
export function onUpdateStatus(
  cb: (event: AppUpdateStatusEvent) => void
): () => void; // subscribe + return unsubscribe
```

`onUpdateStatus` wraps `windowReceive` / `windowRemoveListener`.

## 10. MainProcessAppInfoModule Hardening

### 10.1 Version priority

```text
1. app.getVersion() when available and non-empty
2. package.json version only as development fallback
3. "0.0.0" last resort
```

### 10.2 Name / description

Name may continue to come from `app.getName()` / package metadata. Version is the critical correctness fix for About and support.

### 10.3 Compatibility

Existing `getAppInfo()` consumers should keep receiving `{ name, version, description, author }`. About page should prefer `ABOUT_APP_INFO` for capability fields.

## 11. Renderer About Page Design

### 11.1 Route

```typescript
{
  path: "about",
  name: "system_setting_about",
  meta: {
    title: "route.about_aifetchly",
    icon: "mdi-information-outline",
    keepAlive: false,
    visible: false,
    aiNavigable: true,
    aiAliases: [
      "about",
      "about aifetchly",
      "app version",
      "check for updates",
      "upgrade app",
      "software version",
    ],
    aiDescription:
      "View aiFetchly version, open the official website, and check for updates",
  },
  component: () => import("@/views/pages/systemsetting/about.vue"),
}
```

Also add matching entry to `src/config/aiNavigationRouteManifest.ts` (manifest is authoritative for AI navigation).

### 11.2 System Settings nav button

In `index.vue`, add a block button after existing management buttons:

- icon: `mdi-information-outline`
- label: `t('system_settings.about_aifetchly')`
- navigate to `{ name: 'system_setting_about' }`

### 11.3 Page composition (Phase 1)

```text
[Back]
About aiFetchly

Version: 1.0.12
Website: https://www.sellart-online.com   [Open]

[Check for updates]

Status: You're on the latest version (1.0.12)
```

Use existing Vuetify primitives (`v-card`, `v-btn`, `v-alert` / text). Avoid dashboard card grids.

### 11.4 Client state machine

```typescript
const aboutInfo = ref<AboutAppInfo | null>(null);
const updateStatus = ref<AppUpdateStatusEvent | null>(null);
const actionLoading = ref(false);

const checkDisabled = computed(() => {
  if (!aboutInfo.value?.updateSupported) return true;
  const s = updateStatus.value?.status;
  return s === "checking" || s === "downloading" || actionLoading.value;
});
```

Map status → localized message in the page using `t(...)`.

### 11.5 Lifecycle

- `onMounted`: fetch About info + current update status; subscribe to status events
- `onBeforeUnmount`: unsubscribe

## 12. Internationalization

Add keys under `system_settings` and/or `about_aifetchly` in all of:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Also add route title key `route.about_aifetchly`.

Minimum key set:

```text
system_settings.about_aifetchly
about_aifetchly.title
about_aifetchly.version_label
about_aifetchly.website_label
about_aifetchly.open_website
about_aifetchly.check_for_updates
about_aifetchly.status.idle
about_aifetchly.status.checking
about_aifetchly.status.up_to_date
about_aifetchly.status.downloading
about_aifetchly.status.ready_to_restart
about_aifetchly.status.unsupported_not_packaged
about_aifetchly.status.unsupported_platform
about_aifetchly.status.unsupported_microsoft_store
about_aifetchly.status.unsupported_not_initialized
about_aifetchly.status.error
about_aifetchly.back
```

English examples:

- Check for updates
- Checking for updates…
- You're on the latest version ({version})
- Downloading update…
- Update downloaded. Restart to apply.
- Update checks are unavailable in development builds.
- Update checks are unavailable on this platform.
- Microsoft Store builds update through the Store.
- Could not check for updates. Try again later.

## 13. Security Design

1. Context isolation remains enabled; About uses preload-exposed IPC only.
2. Website open is allowlisted HTTPS constant; no renderer-supplied target URL in Phase 1.
3. Manual check cannot set feed URL, repo, or host from renderer input.
4. Status event payloads are bounded strings validated before send where practical.
5. Logs use `[auto-update]` / `[about]` tags and must not include tokens or cookies.
6. No AI-enable dependency; no privileged data access.

## 14. Error Handling

| Failure | Behavior |
| --- | --- |
| About info IPC fails | Show localized error alert; keep page shell |
| Website open fails | Toast / alert with failure message |
| Updater unsupported | Disabled button + specific unsupported copy |
| Cooldown / in-flight | Keep previous status; do not spam checks |
| `autoUpdater` error | `status=error`, log error, re-enable after cooldown |
| Update available then download fails | `status=error`; automatic path may also log via package |

Never throw across IPC uncaught; always return `CommonMessage` with `status: false` or a structured unsupported/error data payload.

## 15. Testing Strategy

### 15.1 Unit: AppUpdateService manual check

Extend / add tests under `test/vitest/main/updater/`:

1. `checkForUpdatesNow` returns unsupported for not-packaged / linux / windowsStore
2. Supported path calls `autoUpdater.checkForUpdates`
3. Cooldown prevents second check within window
4. Status transitions: checking → up-to-date / downloading → ready-to-restart / error
5. Existing initialize gating tests still pass

Mock Electron `autoUpdater` event emitter in tests.

### 15.2 Unit: about IPC

1. `ABOUT_APP_INFO` returns version from mocked `app.getVersion`
2. `ABOUT_OPEN_WEBSITE` calls `shell.openExternal` with exact allowlisted URL
3. `APP_CHECK_FOR_UPDATES` delegates to service and returns status snapshot

### 15.3 Manifest / route tests

If existing AI navigation tests assert catalog entries, add `system_setting_about` expectations.

### 15.4 Manual verification matrix

| Build | Version shown | Website | Check button |
| --- | --- | --- | --- |
| `yarn dev` | yes | works | unsupported (dev) |
| Packaged Win GitHub | `app.getVersion()` | works | checks feed |
| Packaged macOS GitHub | `app.getVersion()` | works | checks feed |
| Store/MSIX | yes | works | unsupported (store) |
| Linux packaged (if built) | yes | works | unsupported (platform) |

Upgrade happy path still depends on SemVer GitHub Releases + required assets from the updater design.

## 16. Implementation Sequence

1. **Contracts** — `aboutAppTypes.ts` + Zod schemas + channellist constants
2. **App info hardening** — `MainProcessAppInfoModule` uses `app.getVersion()`
3. **AppUpdateService extension** — capability, status, subscribe, `checkForUpdatesNow`
4. **about-ipc + preload whitelist + background registration**
5. **Renderer API** — `src/views/api/about.ts`
6. **About page + route + settings nav button**
7. **AI navigation manifest entry**
8. **i18n all six languages**
9. **Tests**
10. **Manual packaged smoke** on at least one Win or macOS GitHub build if available

Commit after each logical unit per repo auto-commit rule.

## 17. File-Level Change Checklist

### Main process

- [ ] Extend `AppUpdateService.ts`
- [ ] Harden `MainProcessAppInfoModule.ts`
- [ ] Add `about-ipc.ts` and register it
- [ ] Add channel constants
- [ ] Whitelist channels in `preload.ts`

### Renderer

- [ ] Add `about.vue`
- [ ] Add `views/api/about.ts`
- [ ] Wire nav button in `systemsetting/index.vue`
- [ ] Add route in `views/router/index.ts`
- [ ] Update `aiNavigationRouteManifest.ts`
- [ ] Update all language files + route title key

### Tests / docs

- [ ] Updater manual-check tests
- [ ] About IPC tests
- [ ] Optional AI navigation assertion update
- [ ] Keep this design and PRD linked

## 18. Out of Scope (Phase 2+)

1. In-app changelog / release notes panel
2. Detailed download progress percentage UI
3. Custom translated restart dialog via `onNotifyUser`
4. Secondary "Open GitHub Releases" fallback button
5. Linux auto-update support
6. Beta / prerelease channels
7. Persisting last-checked timestamp to disk

## 19. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Duplicate/conflicting autoUpdater listeners | Attach About listeners once; never remove package listeners |
| Incorrect packaged version | Prefer `app.getVersion()`; add unit coverage |
| Non-SemVer releases make check look broken | Document dependency on updater release hygiene; surface generic error/up-to-date honestly |
| Users spam Check | in-flight guard + 60s cooldown |
| Store policy violation | Reuse existing windowsStore gate before any `checkForUpdates` |
| Preload whitelist miss | Explicit checklist + IPC test / runtime invoke failure caught in QA |

## 20. Rollout and Rollback

### Rollout

Ship Phase 1 behind normal app release. No feature flag required if unsupported channels degrade cleanly.

### Rollback

If manual check misbehaves, disable `APP_CHECK_FOR_UPDATES` handler to return unsupported/error while keeping About version/website. Automatic updater can remain intact because it is independently initialized in `background.ts`.

## 21. Open Implementation Questions

1. Should `ABOUT_APP_INFO` replace About's use of `GET_APP_INFO`, or should About call both?  
   **Decision:** use `ABOUT_APP_INFO` as the About page source of truth; harden `GET_APP_INFO` for other callers.
2. Should automatic interval checks update the About status banner while the page is open?  
   **Decision:** yes.
3. Should cooldown return the previous status silently or show "Please wait before checking again"?  
   **Decision:** show a short localized wait message without starting a new check.

## 22. Success Criteria

1. About page reachable from System Settings and AI navigation aliases.
2. Packaged version matches `app.getVersion()`.
3. Website opens only `https://www.sellart-online.com`.
4. Supported builds can manually trigger `autoUpdater.checkForUpdates()` and reflect status.
5. Unsupported builds never initialize or invoke GitHub update checks from About.
6. Automatic updater behavior unchanged.
7. All i18n languages updated.
8. Unit tests cover gating, cooldown, and status transitions.

## 23. References

- `docs/prd/system-settings-about-aifetchly-prd.md`
- `docs/prd/windows-macos-github-auto-upgrade-prd.md`
- `docs/prd/windows-macos-github-auto-upgrade-technical-design.md`
- `docs/RELEASE_WORKFLOW.md`
- `src/main-process/updater/AppUpdateService.ts`
- `src/views/pages/systemsetting/index.vue`
- `src/modules/MainProcessAppInfoModule.ts`
- `update-electron-app` source (`autoUpdater.checkForUpdates` after `setFeedURL`)
- Electron Auto Updater docs: `https://www.electronjs.org/docs/latest/api/auto-updater`
