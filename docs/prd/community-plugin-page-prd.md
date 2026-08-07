# Community Plugin Page - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-04
- **Owner**: AiFetchly Desktop Engineering
- **Scope**: Stage 1 — add a Community Plugins page to the AiFetchly desktop app that browses the AiFetchly Plugin Hub. Free (Community) viewers and Subscription (Go / Plus / Pro) viewers see different plugin lists. The Hub derives the viewer's plan by introspecting the desktop's existing marketing JWT — the desktop only needs to forward it.
- **Primary repository**: `/home/robertzeng/project/aiFetchly` (this repo)
- **Related docs**:
  - Hub counterpart: `/home/robertzeng/project/aifetch-hub/docs/plugin-hub-community-tier-prd.md`
  - `docs/prd/plugin-marketplace-support-prd.md` (existing marketplace PRD)
  - `docs/prd/aifetchly-local-extensibility-prd.md`
  - `docs/prd/claude-code-plugin-compatibility-prd.md`
  - `AGENTS.md` (IPC layer rules, worker-process rules, i18n rules, auto-commit rule)
- **Code anchors** (verified):
  - Existing marketplace: `src/service/PluginMarketplaceService.ts`, `src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts`, `src/main-process/communication/plugin-marketplace-ipc.ts`
  - Auth + plan: `src/modules/lib/httpclient.ts:54-103`, `src/controller/UserController.ts:89-125, 464-570`, `src/config/usersetting.ts`, `src/service/AiFeatureGate.ts:17-22`
  - IPC patterns: `src/main-process/communication/_shared/registerValidatedHandler.ts`, `src/main-process/communication/plugin-ipc.ts:56-60`
  - Live plan changes: `src/modules/WebSocketClient.ts:21-26, 357-429`

## 1. Executive Summary

AiFetchly already supports plugin installation from many sources, a Plugin Marketplace system, Claude Code-compatible plugin formats, and an AI-gated Plugin Manager UI. The missing capability is a **first-party Community Plugins page** backed by the standalone AiFetchly Plugin Hub (`aifetch-hub`), where Free (Community) and Subscription (Go / Plus / Pro) users see different catalogs.

This PRD defines Stage 1 of the desktop side of that feature:

- A new **Community Plugins** page under `src/views/pages/` that browses the Hub catalog.
- A new **authenticated Hub fetcher** (new `PluginMarketplaceSourceKind = "aifetch-hub"`) that reuses the existing `HttpClient` so the user's marketing JWT is forwarded as `Authorization: Bearer …`. The Hub introspects it against marketing's `GET /api/user/info` to learn the plan and returns a segment-appropriate catalog.
- A new **non-AI-gated IPC handler** (Free users must see the catalog; the precedent is `plugin-ipc.ts:56-60` — "plugin management is NOT an AI feature").
- Locked paid plugins render with an **Upgrade** CTA (`access.status: subscription_required`); the desktop treats `installMode: ticket` as "install not available in this release".
- The page re-fetches on live plan changes by subscribing to the existing `user_info_updated` broadcast (`WebSocketClient.ts:410-421`).

The desktop side does **not** add a new login flow, does **not** mint new tokens, and does **not** send plan information to the Hub — the plan is derived server-side. No marketing repo change is required.

## 2. Background & Current State

What **already exists** in this repo (verified):

- **Plugin Marketplace system** — `src/entity/PluginMarketplace.entity.ts`, `src/service/PluginMarketplaceService.ts`, `src/main-process/communication/plugin-marketplace-ipc.ts`, `src/views/api/pluginMarketplaces.ts`.
- **Marketplace source kinds** — `PluginMarketplaceSourceKind = "github" | "git" | "local-folder" | "local-file" | "url"` (`src/entityTypes/pluginMarketplaceTypes.ts:7-12`). There is **no** `"aifetch-hub"` kind.
- **`UrlMarketplaceFetcher`** (`src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts:15-93`) — the closest analog, but it is **anonymous**: it uses raw `https.get` with **no `Authorization` header and no plan info**.
- **Fetcher registry** — `src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts:37-47` pluggable by `kind`.
- **`HttpClient`** (`src/modules/lib/httpclient.ts:54-103`) — already injects `Authorization: Bearer <TOKENNAME>` from the encrypted `Token` store and auto-refreshes on 401 via `TokenRefreshService`. The Hub call should reuse this client rather than bare `https.get`.
- **User plan already known locally** — `UserController.updateUserInfo()` writes `USERPLANS` + `USER_AI_ENABLED` to the `Token` store (`UserController.ts:485-512`), and `isAiEnabled()` is the single gate (`src/service/AiFeatureGate.ts:17-22`). Free plans contain `"community"`/`"free"`; paid plans contain `"aifetch-plus"`/`"aifetch-pro"`/`"aifetch-go"` or `planId` ∈ `{BASE,PLUS,PRO}` (`UserController.ts:89-125`).
- **Live plan updates** — WebSocket `subscription_*` notifications already trigger `refreshUserInfoOnSubscriptionChange()` and broadcast `user_info_updated` to the renderer with the new `{ plans, aiEnabled }` (`WebSocketClient.ts:357-429`). The layout already reacts (`src/views/layout/layout.vue:602-612`).
- **IPC handler wrappers** — `registerValidatedHandler` (non-gated) and `registerAiValidatedHandler` (AI-gated, calls `isAiEnabled()` first) at `src/main-process/communication/_shared/registerValidatedHandler.ts:18-95`.
- **Preload allowlist** — `contextBridge.exposeInMainWorld("api", {invoke...})` with hard-coded `validChannels` arrays at `src/preload.ts:996-1019` (invoke) and elsewhere. New channels MUST be added here or they will be unreachable from the renderer.
- **Frontend API layer + transport seam** — `windowInvoke` (`src/views/utils/apirequest.ts:15-27`) unwraps the `CommonMessage<T>` envelope and throws on `status:false`. `ipcTransport.ts` has an Electron path and a dev-browser bridge path.
- **i18n workflow** — six language files at `src/views/lang/{en,zh,es,fr,de,ja}.ts`; AGENTS.md mandates updating all six for any user-facing text.

What is **missing** (this PRD's scope to build):

1. No `"aifetch-hub"` marketplace source kind / fetcher.
2. No `PLUGIN_COMMUNITY_*` IPC channels, handlers, preload allowlisting, or frontend API module.
3. No Community Plugins page.
4. No i18n strings for the page.
5. No wiring of the community catalog to `user_info_updated` for upgrade-driven re-fetch.

## 3. Architecture Decision (Stage 1 = Option A)

**Chosen: Forward + Introspect.** The desktop forwards its existing marketing access JWT to the Hub; the Hub introspects it against marketing's existing `GET /api/user/info`, reads the Kill Bill plan, and returns a segment-appropriate catalog.

**Why this for Stage 1:**

- The desktop already holds a valid marketing JWT (encrypted in the `Token` store under `TOKENNAME`, injected by `HttpClient`). No new login, no new token, no new secret.
- The desktop already trusts marketing as the plan authority (`UserController.updateUserInfo`). The Hub doing the same via the same endpoint is consistent.
- No marketing repo change — `GET /api/user/info` already exists and returns `plans` from Kill Bill (`controllers/account.go:180`, `services/killbill/account.go:141`).
- Keeps the desktop thin: the desktop does NOT decide free-vs-paid. The Hub decides. The desktop only renders `access.status` / `installMode` as the Hub returns them. This prevents client-side plan spoofing.

**Why not (yet):**

- **Option B (token-exchange with embedded plan claim)** — requires a marketing change (new exchange endpoint, audience-scoped tokens). Deferred to Stage 3.
- **Option C (Hub-owned OAuth session)** — would double the login UX for desktop users who are already logged into marketing via the desktop handoff (`UserController.prepareDesktopLogin()`, `src/modules/desktopLoginCompletion.ts`). Not appropriate.

Stage 2 (Hub-side webhook push) and Stage 3 (RS256/JWKS offline verification) are referenced in §12 but out of scope here.

## 4. Goals

1. Browse the Hub community plugin catalog from a new desktop page.
2. Show Free (Community) viewers and Subscription viewers different plugin lists, driven entirely by Hub response (the desktop never self-classifies).
3. Render locked paid plugins with an Upgrade CTA when the Hub returns `access.status = subscription_required` (or `login_required` when the local session is somehow anonymous).
4. Reuse the existing `HttpClient` so auth headers + 401 refresh are automatic — no new auth code in the desktop.
5. Re-fetch the catalog when the user upgrades/downgrades mid-session, by subscribing to the existing `user_info_updated` broadcast.
6. Fit cleanly into the existing marketplace / fetcher-registry / IPC / preload / i18n patterns.
7. Be usable by **Free** users (do NOT gate the page on `isAiEnabled()`). Free users are the primary audience for the upgrade funnel.

## 5. Non-Goals (Stage 1)

1. **No install of subscription/marketplace plugins.** Locked (`installMode: ticket`) plugins are display-only with an Upgrade CTA. Free/public plugins (`installMode: direct`) are installable through the existing `PluginInstallService` pipeline. The `install-ticket` redemption flow is v2.
2. **No new login or token-minting flow.** The page is reachable only when the user is already logged in (same as other pages). If not logged in, the page shows the existing login prompt.
3. **No client-side plan classification.** The desktop MUST NOT send `USER_AI_ENABLED`, `USERPLANS`, or any plan string to the Hub. The plan is derived server-side.
4. **No new entitlement logic on the desktop.** The desktop renders whatever `access.status` / `installMode` the Hub returns; it does not re-derive tier.
5. **No worker-process Hub calls.** Per AGENTS.md and `httpclient.ts:78-83`, workers cannot refresh tokens or access the `Token` store. All Hub calls originate from the main process.
6. **No marketing repo change.** Stage 1 ships entirely in the desktop repo (plus the hub repo).
7. **No per-plugin detail page in v1** — list + inline summary only. Detail page deferred.
8. **No search/filter UI in v1** beyond what the Hub already supports via query params.

## 6. Trust & Security Model

- **Auth header reuse**: the Hub fetcher uses `HttpClient`, which reads `TOKENNAME` from the encrypted `Token` store (`src/modules/token.ts:12-82`) and attaches `Authorization: Bearer …`. The token never leaves the main process — the renderer only receives already-unwrapped catalog data via IPC.
- **Renderer never calls the Hub directly.** All Hub HTTP calls are main-process only. The renderer calls only the new `PLUGIN_COMMUNITY_*` IPC channels.
- **No plan data crosses the IPC boundary upward.** The IPC handler returns catalog entries with `access.status` / `installMode` per row; it does NOT expose the user's `plan_code` or `USER_AI_ENABLED` to the community page (the layout already shows the plan badge elsewhere).
- **Fail-safe rendering**: if the Hub is unreachable or returns 401, the page shows an error/empty state with a retry button — never a "fake" paid catalog. If the Hub returns 401 specifically, the desktop's `HttpClient` auto-refreshes once via `TokenRefreshService.refreshOnce()` and retries; if it still fails, the page surfaces a "Sign in again" affordance.
- **Open source catalog metadata is not sensitive**: public plugin names/descriptions are not secrets. Locked-preview metadata (title/description of paid plugins) is treated the same as public metadata for rendering; only the install is gated.

## 7. Component Specification

### 7.1 New marketplace source kind `"aifetch-hub"`

Add `"aifetch-hub"` to `PluginMarketplaceSourceKind` at `src/entityTypes/pluginMarketplaceTypes.ts:7-12`.

Unlike the existing `url`/`git`/`github` kinds, the Hub kind is **first-party and implicit**: the desktop does not require the user to "add a marketplace by URL". The Hub marketplace is pre-registered on first launch (or on app startup) as a built-in marketplace row with `sourceKind: "aifetch-hub"`, `sourceUri: <HUB_BASE_URL>` (env-configured, see §7.6). The user cannot delete or edit it; they can only refresh it.

### 7.2 Hub marketplace fetcher

New `src/service/pluginMarketplaces/AiFetchHubMarketplaceFetcher.ts` implementing `PluginMarketplaceFetcher` (interface pattern at `UrlMarketplaceFetcher.ts:15-93`). Key differences from `UrlMarketplaceFetcher`:

- Uses `HttpClient` (NOT raw `https.get`) so `Authorization: Bearer` is attached and 401-refresh works.
- Fetches the Hub catalog endpoint (`GET <HUB_BASE_URL>/api/v1/plugins/catalog`, see §7.4) and writes the response to the existing `PluginMarketplace.entity` manifest cache (`manifestJson`). The Hub response is already a JSON object the marketplace code can consume.
- No SSRF guard needed (the Hub URL is a fixed first-party env value, not user-controlled) — but keep the `https://` requirement from `UrlMarketplaceFetcher.ts:30` as a hardening sanity check.
- Respects a configurable timeout (default 10s) via the existing fetcher timeout config.

Register in `src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts:37-47` under `kind: "aifetch-hub"`.

### 7.3 IPC layer (non-AI-gated)

Create `src/main-process/communication/community-plugin-ipc.ts` mirroring `plugin-marketplace-ipc.ts` but using **`registerValidatedHandler`** (NOT `registerAiValidatedHandler`), following the precedent at `plugin-ipc.ts:56-60` ("plugin management is NOT an AI feature"). Free users must be able to list the catalog.

Channels (add to `src/config/channellist.ts`):

- `PLUGIN_COMMUNITY_LIST` — `"plugin:community:list"` — list/refresh the catalog. Input: `{ forceRefresh?: boolean, category?: string, search?: string }`. Output: `PluginCommunityEntry[]`.
- `PLUGIN_COMMUNITY_DETAIL` — `"plugin:community:detail"` — fetch one plugin's detail. Input: `{ slug: string }`. Output: `PluginCommunityDetail`.
- `PLUGIN_COMMUNITY_INSTALL` — `"plugin:community:install"` — install a free/public plugin via the existing `PluginInstallService` pipeline. Input: `{ slug: string }`. Output: install result. **Reject with a clear error if the plugin's `installMode !== "direct"`** (locked/ticket plugins are not installable in Stage 1).

All three handlers MUST follow AGENTS.md's three-layer rule: no direct DB access; route through Module/Service classes. Specifically, they should call `PluginMarketplaceService` (extended for the Hub kind) and a new `CommunityPluginModule` (business logic) / `CommunityPluginModel` if DB state is needed (e.g. cached catalog rows). The Hub fetcher is invoked by the service layer, not by the IPC handler.

Register the handlers in `src/main-process/communication/index.ts` next to the existing `registerPluginMarketplaceIpcHandlers()` call.

### 7.4 Preload allowlisting

Add the three new channels to the invoke `validChannels` array in `src/preload.ts` (around line 996-1019 where the `PLUGIN_MARKETPLACE_*` channels are already allowlisted). Without this, `windowInvoke` will silently fail.

### 7.5 Frontend API module

New `src/views/api/communityPlugins.ts` mirroring `src/views/api/pluginMarketplaces.ts:95-124`:

```ts
export async function listCommunityPlugins(filter?: PluginCommunityFilter): Promise<PluginCommunityEntry[] | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_LIST, filter ?? {});
}
export async function getCommunityPluginDetail(slug: string): Promise<PluginCommunityDetail | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_DETAIL, { slug });
}
export async function installCommunityPlugin(slug: string): Promise<unknown> {
  return await windowInvoke(PLUGIN_COMMUNITY_INSTALL, { slug });
}
```

Types in a new `src/entityTypes/communityPluginTypes.ts`:

```ts
export type PluginCommunityAccessStatus = "allowed" | "login_required" | "subscription_required" | "forbidden" | "unavailable";
export type PluginCommunityInstallMode = "direct" | "ticket";
export interface PluginCommunityEntry {
  slug: string;
  name: string;
  displayName: string;
  description: string;
  owner?: string;
  category?: string;
  tags?: string[];
  access: { status: PluginCommunityAccessStatus; installMode: PluginCommunityInstallMode };
  installed?: boolean;
}
export interface PluginCommunityDetail extends PluginCommunityEntry { /* detail fields */ }
```

### 7.6 Hub base URL config

Add `VITE_PLUGIN_HUB_URL` to `.env.example` (default `https://plugins.aifetchly.com` for prod) and a `resolvePluginHubUrl()` helper in `src/config/` following the pattern of `resolveViteLoginUrl()` at `src/config/viteLoginUrl.ts:45-53` (with the same safe fallback to a dev URL when unset). The fetcher reads only from this helper, never from user input.

### 7.7 Community Plugins page

New page `src/views/pages/communityPlugins/index.vue` (registered in the router next to other plugin pages). Layout:

- Header: page title + "Refresh" button.
- Plan badge: reuse the existing layout plan badge (do not re-derive). The plan badge is informational only; it does NOT drive gating.
- List: `PluginCommunityEntry[]` rendered as cards. Each card shows name, owner, description, tags, category.
- Card affordance by `access.status`:
  - `allowed` + `installMode=direct` → **Install** button (calls `installCommunityPlugin(slug)`; on success, marks `installed=true`).
  - `allowed` + `installMode=ticket` → **Preview** label disabled (Stage 1: ticket install not supported). Tooltip: "Installable in a future release."
  - `subscription_required` → **Upgrade** button. Clicking opens the marketing plan page in the user's default browser via `shell.openExternal(<marketing-plans-url>)` (use a constant, never user input). The row is not installable.
  - `login_required` → **Sign in** button (should not normally appear since the page requires login; included for safety).
  - `forbidden` / `unavailable` → render greyed out, no action.
- Empty state: "No plugins available" + refresh.
- Error state: "Couldn't reach the Plugin Hub" + retry. On 401 specifically: "Your session expired" + "Sign in again" (`getLoginUrl()` from `src/views/api/users.ts:66-74`).
- Loading state: skeleton cards.

### 7.8 Live re-fetch on plan change

In `src/views/pages/communityPlugins/index.vue` `onMounted`, subscribe to the existing `user_info_updated` broadcast (the layout already listens; expose a renderer-side subscription via `window.api.receive("user_info_updated", cb)` — check the preload `receive` allowlist at `src/preload.ts:536`-ish and add the channel if not already present). On the event, re-invoke `listCommunityPlugins({ forceRefresh: true })` so the catalog re-fetches from the Hub with the new plan-derived segment. This is the upgrade funnel: a user who upgrades mid-session sees the expanded catalog within seconds.

### 7.9 i18n (MANDATORY per AGENTS.md)

Add the following keys (and any additional user-facing strings) to **all six** language files at `src/views/lang/{en,zh,es,fr,de,ja}.ts` under a new `communityPlugins` namespace:

- `communityPlugins.title` — "Community Plugins"
- `communityPlugins.refresh` — "Refresh"
- `communityPlugins.install` — "Install"
- `communityPlugins.preview` — "Preview"
- `communityPlugins.upgrade` — "Upgrade"
- `communityPlugins.signIn` — "Sign in"
- `communityPlugins.installFuture` — "Installable in a future release."
- `communityPlugins.empty` — "No plugins available"
- `communityPlugins.error` — "Couldn't reach the Plugin Hub"
- `communityPlugins.retry` — "Retry"
- `communityPlugins.sessionExpired` — "Your session expired"
- `communityPlugins.signInAgain` — "Sign in again"
- `communityPlugins.loading` — "Loading plugins…"

All components MUST use `useI18n()`'s `t('communityPlugins.x') || 'English fallback'` pattern — never hard-code user-facing strings.

## 8. Data Flow

```text
User clicks "Community Plugins"
  └─ Renderer invokes windowInvoke(PLUGIN_COMMUNITY_LIST, {})

    └─ IPC handler (registerValidatedHandler, NON-AI-gated)
        └─ PluginMarketplaceService.refreshHubMarketplace()
            └─ AiFetchHubMarketplaceFetcher.fetch()
                └─ HttpClient.get(<HUB>/api/v1/plugins/catalog)
                    └─ Authorization: Bearer <marketing-JWT>  (auto-attached from Token store)
                    └─ [401 → TokenRefreshService.refreshOnce() → retry once]
                └─ Hub introspects JWT vs marketing /api/user/info
                └─ Hub returns catalog with per-row access/installMode
        └─ Returns CommonMessage<PluginCommunityEntry[]>
  └─ windowInvoke unwraps, returns PluginCommunityEntry[]
  └─ Page renders cards by access.status
```

On plan change mid-session:

```text
WebSocket subscription_activated
  └─ WebSocketClient.refreshUserInfoOnSubscriptionChange()
      └─ updateUserInfo() (re-fetches /api/user/info, updates USERPLANS)
      └─ broadcasts user_info_updated to renderer
  └─ Community page's window.api.receive("user_info_updated") fires
      └─ windowInvoke(PLUGIN_COMMUNITY_LIST, { forceRefresh: true })
          └─ Hub re-introspects → returns expanded catalog
```

## 9. Failure & Fail-Safe Semantics on the Desktop

| Event | Page Behavior |
|---|---|
| `windowInvoke(PLUGIN_COMMUNITY_LIST)` throws (network/5xx) | Error state with "Retry" button. |
| Hub returns 401 on first call | `HttpClient` auto-refreshes marketing JWT once and retries. If retry still 401, page shows "Your session expired" + "Sign in again". |
| User not logged in (no `TOKENNAME`) | `HttpClient` attaches no Bearer; Hub sees anonymous viewer; returns public+free catalog with `login_required` rows. Page renders normally; Install/Upgrade CTAs work; Sign-in CTA shown where appropriate. (Optional Stage 1.1: gate page entry on login for clarity — see Open Question §13.1.) |
| Hub returns `access.status = subscription_required` | Upgrade CTA; no install. |
| Hub returns `installMode = ticket` with `allowed` | "Preview" disabled label; no install. |
| User clicks Install on a `direct` free plugin | `installCommunityPlugin(slug)` → handler checks `installMode === "direct"`; passes to `PluginInstallService`; on success the card flips to `installed=true`. |

## 10. Acceptance Criteria

1. A logged-in **Community** user opening the Community Plugins page sees the free/public plugin list, all with an enabled **Install** button, and any higher-tier plugins rendered with an **Upgrade** button (no install).
2. A logged-in **Plus** user sees the Community list PLUS all `required_plans∋plus` plugins with an enabled **Install**/**Preview** affordance per `installMode`.
3. A logged-in **Pro** user sees Plus-tier plugins AND Pro-exclusive plugins.
4. Given an installed free plugin, the card renders an "Installed" state and the Install button is disabled.
5. Clicking **Upgrade** opens the marketing plans page in the default browser via `shell.openExternal`.
6. When the user's plan changes (simulated by triggering the `user_info_updated` broadcast), the catalog re-fetches within ~2s and the expanded list appears without a manual refresh.
7. If the Hub is unreachable for 30s, the page shows the error state (never partially-paid content). On recovery, refresh works.
8. The Hub request made by the fetcher carries `Authorization: Bearer <TOKENNAME>` (verified by main-process log or a mock Hub test).
9. The renderer never receives the raw JWT or the viewer's `plan_code` — only `PluginCommunityEntry[]` with `access.status`/`installMode` (verified by inspecting the IPC response shape in a test).
10. A worker process (if any community logic ever runs in one) CANNOT call the Hub directly — only the main process can (verified by a unit test that monkeypatches `HttpClient` to throw when `process.env.WORKER_TYPE` is set, per `httpclient.ts:78-83`). For Stage 1 the community page runs entirely in the main process, so this is a guardrail.
11. All six i18n files (`en/zh/es/fr/de/ja`) contain the `communityPlugins.*` keys with accurate translations; running the app in any supported language renders the page correctly with no English fallback bleed-through (except where a translation is intentionally identical).
12. `yarn vue-check` (Vue TypeScript type-check) passes.
13. No changes in the marketing repo (verified by `git diff` being empty on that repo at ship time).

## 11. Dependencies & Cross-Repo Coordination

- **Hub** (`/home/robertzeng/project/aifetch-hub`): implements the server side per `docs/plugin-hub-community-tier-prd.md`. The desktop↔hub contract is: `GET /api/v1/plugins/catalog` with `Authorization: Bearer`, returning the existing `PluginCatalogEntry` shape (extended with populated `access`/`installMode`/`user.segment`). Coordinate launch timing.
- **Marketing** (`/home/robertzeng/project/marketing`): none for code. The desktop already holds a valid marketing JWT; the Hub already introspects it against the already-live `GET /api/user/info`. No coordination needed except confirming the desktop's Hub-bound traffic is expected on marketing's `/api/user/info` rate limits (the Hub makes that call, not the desktop — but worth a heads-up).
- **Plugin Hub URL**: production `https://plugins.aifetchly.com` (placeholder — confirm with product). Set `VITE_PLUGIN_HUB_URL` in `.env` for dev (`http://localhost:8080` per `aifetch-hub/docker-compose.yml`).

## 12. Phasing

- **Stage 1 (this PRD)**: Community page + Hub fetcher + non-gated IPC + Upgrade CTA for locked plugins. Install works for free `direct` plugins only; `ticket` plugins are preview-only.
- **Stage 2**: when the Hub ships install-ticket + signed-artifact download (v2 PRIV-10), the desktop wires `installCommunityPlugin` to redeem a ticket and download a signed artifact for `installMode=ticket` plugins. The Upgrade CTA changes to Install for viewers who meet `required_plans`.
- **Stage 3**: when marketing migrates to RS256 + JWKS, the desktop changes nothing (it still forwards the same JWT); the Hub verifies offline. Desktop-side Stage 3 is a no-op except for a Hub URL/env update if the JWKS endpoint is at a different origin.
- **Future**: per-plugin detail page, search/filter UI, reviews UI, install-state sync across devices.

## 13. Open Questions

1. **§9 Should the Community Plugins page require login to enter, or allow anonymous browsing (public catalog only)?** Recommended: allow anonymous browsing (matches the Hub's anonymous segment), with Sign-in/Upgrade CTAs on locked rows. Lets prospective users see value before logging in.
2. **§7.2 Should the Hub fetcher be a first-class marketplace row (user-visible in the Plugin Manager) or hidden/implicit?** Recommended: implicit/hidden for Stage 1 — the Hub is a first-party curated catalog, not a user-added marketplace. The Plugin Manager continues to show user-added marketplaces as today.
3. **§7.7 Marketing plans URL for the Upgrade CTA**: confirm the exact URL (e.g. `https://www.sellart-online.com/pricing` or `https://www.aifetchly.com/pricing`). Hard-code as a constant, never from user input.
4. **Auto-commit rule (AGENTS.md)**: each unit of work (entity type, fetcher, IPC handler, preload allowlist entry, frontend API module, page component, i18n keys) is a separate commit per the AGENTS.md MANDATORY rule. The PRD does not change the commit workflow; implementer should follow the auto-commit-per-unit rule during build.

## 14. Risks

- **R-1 (inherited)**: the Hub's per-viewer introspection adds one `/api/user/info` call per viewer per ~10 min (Hub-side cache). The desktop itself adds zero per-viewer load on marketing. No desktop risk.
- **R-2**: the forwarded JWT is the user's full-privilege 24h access token; if the desktop fetcher were ever to call a non-first-party URL, it would leak the token. Mitigation: the fetcher only calls `VITE_PLUGIN_HUB_URL` (a first-party env constant), never user input; and `HttpClient` is only constructed in the main process.
- **R-3**: a stale `USER_AI_ENABLED` / `USERPLANS` in the local store could mislead the layout badge, but the community page does NOT use those values — it trusts only the Hub response. So local-store staleness does not affect the community catalog correctness.
- **R-4 (display is soft gating)**: Stage 1 only gates the *display list* + install affordance. A determined user could still read paid plugin metadata (title/description) from the Hub response. Real enforcement arrives with the install-ticket flow (Stage 2/v2). Communicate this to product so expectations are set.