# Community Plugin Page - Technical Design

## Document Information

- **Version**: 1.0
- **Date**: 2026-08-04
- **Status**: Draft
- **Source PRD**: `docs/prd/community-plugin-page-prd.md`
- **Parent technical design**: `docs/prd/plugin-marketplace-support-technical-design.md`
- **Target repository**: `/home/robertzeng/project/aiFetchly` (this repo)
- **External systems**:
  - AiFetchly Plugin Hub (`/home/robertzeng/project/aifetch-hub`) — see `docs/plugin-hub-community-tier-technical-design.md`
  - Marketing / identity / subscription authority (`/home/robertzeng/project/marketing`) — no code change

## 1. Purpose

This document translates the Community Plugin Page PRD (Stage 1, Option A — Forward + Introspect) into an implementation-facing design for the AiFetchly desktop app. The desktop only needs to:

1. Forward its existing marketing JWT to the Hub via a new authenticated fetcher.
2. Render the Hub's `PluginCommunityEntry[]` into a new page, with install/upgrade affordances driven entirely by the Hub's `access.status` / `installMode`.

The desktop does NOT classify free-vs-paid, does NOT call marketing directly, does NOT mint new tokens. It is a thin consumer over the Hub catalog API.

It is a **delta** over `docs/prd/plugin-marketplace-support-technical-design.md`: it adds a first-party `"aifetch-hub"` marketplace source kind and an authenticated fetcher, reusing the existing fetcher-registry + IPC + preload + frontend patterns. Where this doc is silent, the parent design governs.

## 2. Hard Rules (from AGENTS.md, restated for implementation)

1. **Three-layer architecture**: IPC handlers MUST NOT touch the database directly — they route through Module/Service classes. Database operations use Model classes through the `Token` service's `USERSDBPATH`. The community flow uses the existing `PluginMarketplaceService`; no new Model is needed in Stage 1 (the marketplace row is already a `PluginMarketplace.entity`).
2. **Workers never call the Hub**. Per AGENTS.md and `httpclient.ts:78-83`, workers receive `WORKER_AUTH_TOKEN` via env and cannot refresh tokens or access the `Token` store. The community fetcher is main-process only.
3. **i18n**: every user-facing string added in this feature MUST be added to all six language files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`).
4. **Auto-commit per unit** (AGENTS.md MANDATORY rule): each of the phases in §11 is a separate commit.
5. **`yarn vue-check`** must pass before each commit.
6. **Preload allowlist**: every new IPC channel MUST be added to `src/preload.ts` `validChannels` arrays or `windowInvoke` will silently fail.

## 3. Existing System Anchors (verified)

```text
src/entityTypes/pluginMarketplaceTypes.ts:7-12    # PluginMarketplaceSourceKind enum
src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts:37-47  # fetcher registry
src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts:15-93              # closest analog (anonymous)
src/service/PluginMarketplaceService.ts:238-326    # listAvailablePlugins orchestration
src/entity/PluginMarketplace.entity.ts             # cached catalog row
src/modules/lib/httpclient.ts:54-103              # auth-attached HttpClient (Bearer + 401 refresh)
src/modules/token.ts:12-82                        # encrypted Token store (key: "user-social-market-token")
src/config/usersetting.ts                         # TOKENNAME, USERSERVICE, USER_AI_ENABLED, USERPLANS, USERID
src/config/viteLoginUrl.ts:45-53                  # resolveViteLoginBase() env pattern to copy for Hub URL
src/main-process/communication/_shared/registerValidatedHandler.ts:18-95  # registerValidatedHandler (non-AI), registerAiValidatedHandler (AI)
src/main-process/communication/plugin-ipc.ts:56-60  # precedent: "plugin management is NOT an AI feature"
src/main-process/communication/index.ts:84        # handler registration site
src/preload.ts:996-1019                           # invoke allowlist (PLUGIN_MARKETPLACE_* already listed)
src/views/utils/apirequest.ts:15-27               # windowInvoke (unwraps CommonMessage envelope)
src/views/utils/ipcTransport.ts                   # transport seam (Electron | dev-browser | unavailable)
src/views/api/pluginMarketplaces.ts:95-124        # frontend API pattern to mirror
src/views/api/users.ts:66-74                      # getLoginUrl helper (for Sign-in CTA)
src/modules/WebSocketClient.ts:357-429            # refreshUserInfoOnSubscriptionChange + user_info_updated broadcast
src/views/layout/layout.vue:602-612, 341-350      # existing plan-badge consumption of USERPLANS
src/service/AiFeatureGate.ts:17-22                # isAiEnabled() — NOT used by the community page
```

What is missing (this PRD builds):
- `"aifetch-hub"` source kind + fetcher class.
- `PLUGIN_COMMUNITY_*` channels, handlers, preload entries.
- Frontend API module + types + page component + i18n.
- `user_info_updated` subscription on the community page for upgrade-driven re-fetch.

## 4. Runtime Configuration

Add to `.env.example` (alongside existing `VITE_LOGIN_URL`):

```env
# Plugin Hub (community catalog)
VITE_PLUGIN_HUB_URL=https://plugins.aifetchly.com
# For local dev against the hub's docker-compose:
# VITE_PLUGIN_HUB_URL=http://localhost:8080
```

New `src/config/pluginHubUrl.ts` (copy the `resolveViteLoginBase` pattern at `viteLoginUrl.ts:45-53` — read at build-time via Vite `define`, with a runtime sanity check + a localhost fallback for dev-browser mode):

```typescript
import { isDevBrowser } from "@/views/utils/devBrowser";

export interface PluginHubUrl {
  value: string;
}

function readDefine(): string | undefined {
  // Vite replaces process.env.VITE_PLUGIN_HUB_URL at build time via define in vite.main.config.mjs
  const v = (process.env as { VITE_PLUGIN_HUB_URL?: string }).VITE_PLUGIN_HUB_URL;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function resolvePluginHubBase(): PluginHubUrl {
  let v = readDefine();
  if (!v || v.trim() === "") {
    v = isDevBrowser() ? "http://localhost:8080" : "https://plugins.aifetchly.com";
  }
  try { new URL(v); } catch { v = "https://plugins.aifetchly.com"; }
  return { value: v };
}

export const PLUGIN_HUB_CATALOG_PATH = "/api/v1/plugins/catalog";
export const PLUGIN_HUB_DETAIL_PATH = (slug: string) => `/api/v1/plugins/${encodeURIComponent(slug)}`;
export const MARKETING_PLANS_URL = "https://www.sellart-online.com/pricing"; // §14.3 open question — confirm
```

Update `vite.main.config.mjs` to add the `define` entry: `'process.env.VITE_PLUGIN_HUB_URL': JSON.stringify(process.env.VITE_PLUGIN_HUB_URL ?? '')`.

The fetcher reads ONLY from `resolvePluginHubBase()` — never from user input, never from a marketplace row's `sourceUri` for this kind (this differentiates `"aifetch-hub"` from generic `"url"`).

## 5. New Marketplace Source Kind and Fetcher

### 5.1 Extend `PluginMarketplaceSourceKind`

`src/entityTypes/pluginMarketplaceTypes.ts:7-12`:

```typescript
export type PluginMarketplaceSourceKind =
  | "github"
  | "git"
  | "local-folder"
  | "local-file"
  | "url"
  | "aifetch-hub"; // NEW
```

### 5.2 New `AiFetchHubMarketplaceFetcher`

`src/service/pluginMarketplaces/AiFetchHubMarketplaceFetcher.ts`. Implement the `PluginMarketplaceFetcher` interface (pattern at `UrlMarketplaceFetcher.ts:15-93`):

```typescript
import { HttpClient } from "@/modules/lib/httpclient";
import { resolvePluginHubBase, PLUGIN_HUB_CATALOG_PATH } from "@/config/pluginHubUrl";
import type { PluginMarketplaceFetchResult, PluginMarketplaceFetchRequest } from "@/entityTypes/pluginMarketplaceTypes";
import type { PluginCommunityEntry } from "@/entityTypes/communityPluginTypes";

export class AiFetchHubMarketplaceFetcher implements PluginMarketplaceFetcher {
  public readonly kind = "aifetch-hub" as const;
  private readonly timeoutMs = 10000;

  public async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const base = resolvePluginHubBase().value;
    if (!base.startsWith("https://") && !base.startsWith("http://localhost")) {
      // hardening: Hub URL MUST be https in prod; allow localhost for dev
      return this.fail("Plugin Hub URL must be https (or localhost for dev)");
    }
    const url = base + PLUGIN_HUB_CATALOG_PATH;
    try {
      const client = new HttpClient(); // attaches Authorization: Bearer <TOKENNAME>; refreshes on 401
      const response = await client.get<PluginCommunityEntry[]>(url, { timeout: this.timeoutMs });
      // Wrap into the marketplace manifest shape the existing cache expects:
      const manifestJson = JSON.stringify({
        name: "AiFetchly Plugin Hub",
        owner: { name: "AiFetchly" },
        plugins: response, // already MarketplaceEntry-shaped (see §5.4)
      });
      return { success: true, marketplace: { marketplaceRoot: "", manifestPath: "", manifestJson, cleanup: noop } };
    } catch (err) {
      return this.fail(this.describeError(err));
    }
  }
}
```

Key differences from `UrlMarketplaceFetcher`:
- Uses `HttpClient` (auth Bearer + 401 refresh) instead of raw `https.get`.
- Hardcodes the path via `resolvePluginHubBase()` + constant — never reads `req.source.uri`.
- No SSRF guard needed (URL is a fixed first-party env value), but keep the https-scheme check as hardening.
- No `fs` download step — the Hub response is already in-memory JSON; the "manifest" is synthesized from it.

Register in `PluginMarketplaceFetcherRegistry.ts:37-47`:

```typescript
registry.register(new AiFetchHubMarketplaceFetcher());
```

### 5.3 Pre-register the Hub marketplace (built-in, non-deletable)

Extend `PluginMarketplaceService` to ensure a built-in `plugin_marketplaces` row exists at app startup:

```typescript
// src/service/PluginMarketplaceService.ts (extend the existing init or add ensureBuiltinMarketplaces())
{
  name: "AiFetchly Plugin Hub",
  sourceKind: "aifetch-hub" as const,
  sourceUri: "<HUB_BASE_URL>",  // informational only; fetcher ignores it
  enabled: true,
  builtIn: true,                  // NEW column? or a reserved-name check; see §13.1
}
```

§13.1 open question: add a `builtIn` column vs. treat the reserved name as the built-in marker. Recommended: reserved-name check (`name === "AiFetchly Plugin Hub"`) for zero-entity-schema change.

### 5.4 Catalog entry mapping

The Hub's `PluginCatalogEntry` already includes `access: {status, installMode}` and `user.segment` per `docs/plugin-hub-api-user.md:108-126` and the Hub tech design §9.3. The Hub's `plugins[]` array is a superset of the marketplace manifest shape AiFetchly already parse (`pluginMarketplaceTypes.ts` `MarketplacePluginEntry`). Mapping:

| Hub field | Marketplace manifest field | Notes |
|---|---|---|
| `slug` | `name` | Hub slug is the canonical identifier |
| `displayName` | `display_name` | |
| `description` | `description` | |
| `owner` | `owner.name` | |
| `category` | `category` | |
| `tags` | `tags` | |
| `access.status` | (kept as `access.status` on the entry) | consumed by the new page; ignored by the existing Plugin Manager which only displays installed plugins |
| `access.installMode` | (kept as `access.installMode` on the entry) | same |

The existing `listAvailablePlugins` cross-reference with installed plugins (`PluginMarketplaceService.ts:238-326`) continues to populate `installed` on each entry — no change needed.

## 6. IPC Layer (NON-AI-gated)

### 6.1 New channel constants

`src/config/channellist.ts` (alongside existing `PLUGIN_MARKETPLACE_*`):

```typescript
export const PLUGIN_COMMUNITY_LIST    = "plugin:community:list"   as const;
export const PLUGIN_COMMUNITY_DETAIL = "plugin:community:detail" as const;
export const PLUGIN_COMMUNITY_INSTALL= "plugin:community:install"as const;
```

### 6.2 Input schemas (Zod)

New file `src/schemas/ipc/communityPlugin.ts` (mirror of the existing `src/schemas/ipc/pluginMarketplace.ts`):

```typescript
import { z } from "zod";

export const pluginCommunityListInputSchema = () => z.object({
  forceRefresh: z.boolean().optional().default(false),
  category: z.string().optional(),
  search: z.string().optional(),
}).strict();

export const pluginCommunityDetailInputSchema = () => z.object({
  slug: z.string().min(1).max(200),
}).strict();

export const pluginCommunityInstallInputSchema = () => z.object({
  slug: z.string().min(1).max(200),
}).strict();
```

### 6.3 Handler file

New `src/main-process/communication/community-plugin-ipc.ts`:

```typescript
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  PLUGIN_COMMUNITY_LIST, PLUGIN_COMMUNITY_DETAIL, PLUGIN_COMMUNITY_INSTALL,
} from "@/config/channellist";
import {
  pluginCommunityListInputSchema, pluginCommunityDetailInputSchema, pluginCommunityInstallInputSchema,
} from "@/schemas/ipc/communityPlugin";
import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";
import { PluginInstallService } from "@/service/PluginInstallService";

export function registerCommunityPluginIpcHandlers(): void {
  registerValidatedHandler(PLUGIN_COMMUNITY_LIST, pluginCommunityListInputSchema, async (input) => {
    const svc = new PluginMarketplaceService();
    return await svc.listCommunityPlugins({ forceRefresh: input.forceRefresh, category: input.category, search: input.search });
  });

  registerValidatedHandler(PLUGIN_COMMUNITY_DETAIL, pluginCommunityDetailInputSchema, async (input) => {
    const svc = new PluginMarketplaceService();
    return await svc.getCommunityPluginDetail(input.slug);
  });

  registerValidatedHandler(PLUGIN_COMMUNITY_INSTALL, pluginCommunityInstallInputSchema, async (input) => {
    // 1. fetch the entry from cached catalog; reject if installMode !== "direct"
    const svc = new PluginMarketplaceService();
    const entry = await svc.getCommunityPluginDetail(input.slug);
    if (!entry) throw new Error("Plugin not found in community catalog");
    if (entry.access.installMode !== "direct") {
      throw new Error("This plugin is not installable in this release (subscription required).");
    }
    // 2. resolve into a PluginSourceRequest and delegate to the existing install pipeline
    const installService = new PluginInstallService();
    return await installService.installFromSource(entry.toSourceRequest());
  });
}
```

Uses **`registerValidatedHandler`** (NON-AI-gated) — per the precedent at `plugin-ipc.ts:56-60`. Free users must be able to list the catalog.

Register in `src/main-process/communication/index.ts:84` next to `registerPluginMarketplaceIpcHandlers()`:

```typescript
registerCommunityPluginIpcHandlers();
```

### 6.4 Preload allowlist

`src/preload.ts:996-1019` (invoke allowlist, near `PLUGIN_MARKETPLACE_*`):

```typescript
const validInvokeChannels = [
  // ... existing ...
  "plugin:community:list",
  "plugin:community:detail",
  "plugin:community:install",
];
```

Also add `"user_info_updated"` to the `validReceiveChannels` array if not already present (search `preload.ts` for `LOGIN_STATUS` — it IS present at line 536; add `user_info_updated` alongside).

## 7. Service Layer Extension

Add to `src/service/PluginMarketplaceService.ts`:

```typescript
public async listCommunityPlugins(opts: { forceRefresh?: boolean; category?: string; search?: string }): Promise<PluginCommunityEntry[]> {
  // 1. ensure the built-in Hub marketplace row exists
  await this.ensureBuiltinHubMarketplace();
  // 2. refresh the cached manifest (calls AiFetchHubMarketplaceFetcher); skips if cache fresh and !forceRefresh
  await this.refreshMarketplace(HUB_MARKETPLACE_NAME, { force: opts.forceRefresh });
  // 3. read the cached manifest and filter
  const manifest = await this.readCachedManifest(HUB_MARKETPLACE_NAME);
  let entries = manifest.plugins as PluginCommunityEntry[];
  if (opts.category) entries = entries.filter(p => p.category === opts.category);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    entries = entries.filter(p =>
      p.displayName.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q));
  }
  // 4. cross-reference installed plugins (reuse existing installed lookup)
  const installed = await this.installedPluginSlugs();
  return entries.map(p => ({ ...p, installed: installed.has(p.slug) }));
}

public async getCommunityPluginDetail(slug: string): Promise<PluginCommunityEntry | null> {
  const entries = await this.listCommunityPlugins({ forceRefresh: false });
  return entries.find(p => p.slug === slug) ?? null;
}
```

`ensureBuiltinHubMarketplace()` is idempotent: SELECT by reserved name, INSERT if missing with `sourceKind="aifetch-hub"`, `enabled=true`. Per §13.1, use the reserved-name convention (no entity schema change).

## 8. Frontend Types

New `src/entityTypes/communityPluginTypes.ts`:

```typescript
export type PluginCommunityAccessStatus =
  | "allowed" | "login_required" | "subscription_required" | "forbidden" | "unavailable";

export type PluginCommunityInstallMode = "direct" | "ticket";

export interface PluginCommunityAccess {
  status: PluginCommunityAccessStatus;
  installMode: PluginCommunityInstallMode;
}

export interface PluginCommunityEntry {
  slug: string;
  name: string;            // marketplace canonical name
  displayName: string;
  description: string;
  owner?: string;
  category?: string;
  tags?: string[];
  access: PluginCommunityAccess;
  installed?: boolean;
}

export interface PluginCommunityFilter {
  forceRefresh?: boolean;
  category?: string;
  search?: string;
}

// Conversion helper for the install pipeline (§6.3)
export interface PluginCommunityEntry {
  // ... as above
  toSourceRequest?(): unknown; // implemented in a module-level mapper, NOT on the type (kept pure)
}
```

The `toSourceRequest` is a free function in `src/service/pluginMarketplaces/hubEntryToSourceRequest.ts` (pure), not a method on the interface:

```typescript
import type { PluginSourceRequest } from "@/entityTypes/pluginTypes";

export function hubEntryToSourceRequest(entry: PluginCommunityEntry): PluginSourceRequest {
  // Direct-install path only (caller has already verified installMode === "direct"):
  // The Hub returns a direct source descriptor in the entry; map it onto PluginSourceRequest.
  // For Stage 1, the Hub's "direct" entries are marketplace entries that resolve to a
  // github/git/npm/local URL the existing PluginInstallService already understands.
  return {
    kind: inferKindFromHubSource(entry), // "github" | "git" | "npm" | "url"
    uri: entry.source?.uri,
    ref: entry.source?.ref,
    // ... existing PluginSourceRequest fields
  };
}
```

(Coordinate the `entry.source` shape with the Hub tech design §9.3 — for direct plugins the Hub already emits marketplace-compatible `source`. This is a pure data mapping, not new logic.)

## 9. Frontend API Module

`src/views/api/communityPlugins.ts`:

```typescript
import { windowInvoke } from "@/views/utils/apirequest";
import { PLUGIN_COMMUNITY_LIST, PLUGIN_COMMUNITY_DETAIL, PLUGIN_COMMUNITY_INSTALL } from "@/config/channellist";
import type { PluginCommunityEntry, PluginCommunityFilter } from "@/entityTypes/communityPluginTypes";

export async function listCommunityPlugins(filter?: PluginCommunityFilter): Promise<PluginCommunityEntry[] | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_LIST, filter ?? {});
}

export async function getCommunityPluginDetail(slug: string): Promise<PluginCommunityEntry | null> {
  return await windowInvoke(PLUGIN_COMMUNITY_DETAIL, { slug });
}

export async function installCommunityPlugin(slug: string): Promise<unknown> {
  return await windowInvoke(PLUGIN_COMMUNITY_INSTALL, { slug });
}
```

Pattern mirrors `src/views/api/pluginMarketplaces.ts:95-124`.

## 10. Community Plugins Page

### 10.1 Route

Add to the router (next to `PluginManager.vue` route):

```typescript
{
  path: "/community-plugins",
  name: "community-plugins",
  component: () => import("@/views/pages/communityPlugins/index.vue"),
  meta: { title: "communityPlugins.title", requiresAuth: true }, // §13.1: confirm requiresAuth
}
```

### 10.2 Page component

`src/views/pages/communityPlugins/index.vue` (Composition API + Vuetify, per AGENTS.md stack):

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { listCommunityPlugins, installCommunityPlugin } from "@/views/api/communityPlugins";
import { getLoginUrl } from "@/views/api/users";
import type { PluginCommunityEntry, PluginCommunityAccessStatus } from "@/entityTypes/communityPluginTypes";

const { t } = useI18n();
const loading = ref(true);
const error = ref<string | null>(null);
const entries = ref<PluginCommunityEntry[]>([]);

async function load(force = false) {
  loading.value = true; error.value = null;
  try {
    const data = await listCommunityPlugins({ forceRefresh: force });
    if (data) entries.value = data;
  } catch (e) {
    error.value = (e as Error).message || t("communityPlugins.error") || "Couldn't reach the Plugin Hub";
  } finally {
    loading.value = false;
  }
}

async function onInstall(entry: PluginCommunityEntry) {
  try {
    await installCommunityPlugin(entry.slug);
    entry.installed = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function onUpgrade() {
  const url = await getLoginUrl(); // or the marketing plans URL constant directly
  // opens the marketing plans page in the default browser via the existing shell.openExternal helper used by other pages
  // (look at src/views/pages/.../upgrade button implementations for the exact call site to mirror)
  window.openExternal?.(MARKETING_PLANS_URL); // pseudo — see §13.2 for exact API
}

function onSessionExpired() {
  // shows Sign-in CTA; calls getLoginUrl() + shell.openExternal(loginUrl)
}

// Live re-fetch on plan change (WebSocket-driven broadcast)
const onUserInfoUpdated = () => load(true);

onMounted(() => {
  load();
  window.api.receive("user_info_updated", onUserInfoUpdated);
});
onUnmounted(() => {
  window.api.removeListener?.("user_info_updated", onUserInfoUpdated);
});

function ctaFor(entry: PluginCommunityEntry): { label: string; action: () => void; disabled: boolean; variant: string } {
  switch (entry.access.status) {
    case "allowed":
      if (entry.access.installMode === "direct") {
        return { label: t("communityPlugins.install") || "Install", action: () => onInstall(entry), disabled: !!entry.installed, variant: "primary" };
      }
      return { label: t("communityPlugins.preview") || "Preview", action: () => {}, disabled: true, variant: "disabled" };
    case "subscription_required":
      return { label: t("communityPlugins.upgrade") || "Upgrade", action: onUpgrade, disabled: false, variant: "secondary" };
    case "login_required":
      return { label: t("communityPlugins.signIn") || "Sign in", action: () => window.api.invoke("GET_LOGIN_URL"), disabled: false, variant: "secondary" };
    default:
      return { label: "", action: () => {}, disabled: true, variant: "disabled" };
  }
}
</script>

<template>
  <v-container>
    <v-row>
      <h1>{{ t("communityPlugins.title") || "Community Plugins" }}</h1>
      <v-spacer />
      <v-btn @click="load(true)" :loading="loading">{{ t("communityPlugins.refresh") || "Refresh" }}</v-btn>
    </v-row>

    <v-alert v-if="error" type="error" class="my-4">
      {{ error }}
      <v-btn text @click="load(true)">{{ t("communityPlugins.retry") || "Retry" }}</v-btn>
    </v-alert>

    <v-row v-if="loading">
      <v-skeleton-loader v-for="i in 8" :key="i" type="card" class="ma-2" />
    </v-row>

    <v-row v-else>
      <v-col v-for="entry in entries" :key="entry.slug" cols="12" sm="6" md="4">
        <v-card>
          <v-card-title>{{ entry.displayName }}</v-card-title>
          <v-card-subtitle>{{ entry.owner }} · {{ entry.category }}</v-card-subtitle>
          <v-card-text>{{ entry.description }}</v-card-text>
          <v-card-actions>
            <v-chip v-for="tag in entry.tags" :key="tag" small>{{ tag }}</v-chip>
            <v-spacer />
            <v-btn
              :disabled="ctaFor(entry).disabled"
              :variant="ctaFor(entry).variant"
              @click="ctaFor(entry).action"
              :title="entry.access.installMode === 'ticket' && entry.access.status === 'allowed'
                ? (t('communityPlugins.installFuture') || 'Installable in a future release.') : ''"
            >
              {{ entry.installed && entry.access.installMode === 'direct' && entry.access.status === 'allowed'
                ? (t('communityPlugins.installed') || 'Installed')
                : ctaFor(entry).label }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-row v-if="!loading && entries.length === 0 && !error">
      <v-col>{{ t("communityPlugins.empty") || "No plugins available" }}</v-col>
    </v-row>
  </v-container>
</template>
```

### 10.3 Audit the user-facing strings for i18n

Every `t("communityPlugins.xyz")` call must have a corresponding key in all six language files. Strings used:

- `communityPlugins.title`
- `communityPlugins.refresh`
- `communityPlugins.install`
- `communityPlugins.installed`
- `communityPlugins.preview`
- `communityPlugins.upgrade`
- `communityPlugins.signIn`
- `communityPlugins.empty`
- `communityPlugins.error`
- `communityPlugins.retry`
- `communityPlugins.installFuture`
- `communityPlugins.loading`

## 11. i18n Updates (MANDATORY per AGENTS.md)

Add a new `communityPlugins` namespace to all six language files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`):

```typescript
// en.ts (default / fallback)
communityPlugins: {
  title: "Community Plugins",
  refresh: "Refresh",
  install: "Install",
  installed: "Installed",
  preview: "Preview",
  upgrade: "Upgrade",
  signIn: "Sign in",
  empty: "No plugins available",
  error: "Couldn't reach the Plugin Hub",
  retry: "Retry",
  installFuture: "Installable in a future release.",
  loading: "Loading plugins…",
  sessionExpired: "Your session expired",
  signInAgain: "Sign in again",
},
```

Provide accurate translations for `zh`, `es`, `fr`, `de`, `ja` (the Chinese, Spanish, French, German, Japanese equivalents). Workflow per AGENTS.md:
1. Add to `en.ts` first (source of truth).
2. Replicate the same key structure in the other 5 files with translated values.
3. Use `t('key') || 'English Text'` in components for English fallback safety.
4. Run the app in each language and verify no English bleed-through (except where intentionally identical).

## 12. Live Re-Fetch on Plan Change (§PRD 7.8)

The desktop's `WebSocketClient` already calls `refreshUserInfoOnSubscriptionChange()` (`WebSocketClient.ts:391-429`) on any `subscription_*` notification, which calls `UserController.updateUserInfo()` and broadcasts `user_info_updated` to the renderer with new `{ plans, aiEnabled }`.

The community page subscribes via `window.api.receive("user_info_updated", cb)` (the `receive` API is exposed by `preload.ts:681-1084`; add `"user_info_updated"` to `preload.ts` `validReceiveChannels` if not already there alongside `LOGIN_STATUS` at line 536).

On the event, the page calls `load(true)` (force refresh) → the IPC handler re-invokes the Hub fetcher → the Hub middleware sees a Bearer with a possibly-updated plan → re-introspects (if its 10-min snapshot TTL has elapsed) or returns the cached paid segment → returns the expanded catalog → the page renders it.

End-to-end user-visible latency: ~2-5 seconds from upgrade-email-received to expanded catalog visible. The user does NOT need to relaunch the app or refresh manually.

## 13. Data Flow (executable)

```text
[Page mounted]
  └─ windowInvoke(PLUGIN_COMMUNITY_LIST, {})
      └─ ipcRenderer.invoke("plugin:community:list", JSON.stringify({}))
          └─ registerValidatedHandler parses -> PluginMarketplaceService.listCommunityPlugins({})
              └─ ensureBuiltinHubMarketplace() (idempotent)
              └─ refreshMarketplace(HUB_NAME, {force: false})
                  └─ AiFetchHubMarketplaceFetcher.fetch()
                      └─ new HttpClient().get(`${HUB}/api/v1/plugins/catalog`)
                          └─ [HttpClient attaches Authorization: Bearer <TOKENNAME>]
                          └─ [401 → TokenRefreshService.refreshOnce() → retry once]
                      └─ Hub returns PluginCommunityEntry[] with per-row access.status / installMode
                  └─ manifestJson cached in plugin_marketplaces row
              └─ filtered entries cross-referenced with installed slugs
          └─ returns CommonMessage<PluginCommunityEntry[]> {status:true, msg:"ok", data:[...]}
      └─ windowInvoke unwraps -> returns PluginCommunityEntry[]
  └─ Page renders cards by ctaFor(entry)

[User clicks "Install" on a direct plugin]
  └─ windowInvoke(PLUGIN_COMMUNITY_INSTALL, {slug})
      └─ handler fetches entry.asserts installMode === "direct"
      └─ hubEntryToSourceRequest(entry)
      └─ PluginInstallService.installFromSource(req)
          └─ (existing pipeline: PluginImportService.installFromLocalRoot → SkillRegistry / MCP runtime)
      └─ returns CommonMessage<unknown>
  └─ entry.installed = true; card flips to "Installed"

[Marketing tells the desktop the user upgraded (WebSocket subscription_activated)]
  └─ WebSocketClient -> updateUserInfo() (refreshes USERPLANS / USER_AI_ENABLED locally)
  └─ broadcasts "user_info_updated" to renderer
  └─ Page's window.api.receive("user_info_updated") fires -> load(true)
  └─ (same as mount path, force refresh on Hub)
```

## 14. Failure & Fail-Safe Semantics on the Desktop

| Event | Page behavior |
|---|---|
| `windowInvoke` throws (generic) | Error alert + Retry |
| Hub returns 401 (first call) | `HttpClient` auto-refresh once via `TokenRefreshService.refreshOnce()` and retry; if retry still 401 → render "session expired" state with Sign-in CTA |
| Hub returns 5xx | Error alert + Retry (Hub itself returns Free catalog on marketing outage per its design §11 — desktop does not need a separate fallback) |
| Hub returns `subscription_required` row | Upgrade CTA (disabled install) |
| Hub returns `allowed + ticket` row | Preview/Coming soon label, disabled action, tooltip |
| User clicks Install on `ticket` row | Should never happen — the IPC handler rejects `installMode !== "direct"` with a clear error; the button is disabled too |
| `user_info_updated` fires | Page silently re-loads with `forceRefresh: true` |
| Not logged in (no `TOKENNAME`) | `HttpClient` attaches no Bearer; Hub sees anonymous; `login_required` rows render Sign-in CTA |

## 15. Acceptance Criteria Test Plan

| PRD criterion | Test |
|---|---|
| AC1 Community user sees free + Upgrade CTAs | stub Hub returning mixed `allowed/direct` + `subscription_required`; assert render |
| AC2 Plus user sees expanded list | stub Hub returning extra `allowed/ticket` rows |
| AC3 Pro user sees Pro-exclusive | same |
| AC4 Installed free plugin → "Installed" state | install via the handler; assert `installed=true` flips UI |
| AC5 Upgrade button opens marketing plans URL | spy on `shell.openExternal` |
| AC6 `user_info_updated` triggers refresh within 2s | emit mock broadcast; assert stub Hub call count increments within 2s |
| AC7 30s Hub outage → error state (no partial paid content) | stub Hub 5xx; assert empty/error render |
| AC8 Hub request carries `Authorization: Bearer <TOKEN>` | main-process unit test spying on `HttpClient` headers |
| AC9 Renderer never receives raw JWT / `plan_code` | assert IPC response type is `PluginCommunityEntry[]` only; grep response shape in test |
| AC10 Workers cannot call Hub directly | `process.env.WORKER_TYPE='x'` → `HttpClient` throws (per existing `httpclient.ts:78-83`); document with a guard test |
| AC11 All six i18n files parse + render | `yarn vue-check` passes; run app in each language; assert no English bleed-through |
| AC12 `yarn vue-check` passes | CI gate |
| AC13 No marketing repo diff | `git -C /home/robertzeng/project/marketing diff --exit-code` in CI |

## 16. Security Notes

- **Renderer never holds the JWT.** The renderer only receives `PluginCommunityEntry[]` from IPC; the JWT lives in the encrypted `Token` store and is attached to outbound HTTP by `HttpClient` in the main process.
- **Renderer never calls the Hub directly.** All Hub HTTP is main-process-only via the fetcher; the renderer only invokes IPC channels.
- **Renderer never receives `plan_code` / `USER_AI_ENABLED` / `USERPLANS`.** The IPC handler returns catalog entries with `access.status`/`installMode` only. The layout already shows the plan badge elsewhere via `getUserInfo()`; we do NOT add plan info to the community page response.
- **No client-side gating** of which rows show Upgrade — that decision is entirely the Hub's. The desktop cannot "round up" a Free viewer to a paid list. A spoofed desktop cannot exfiltrate the paid plugin source URLs because (a) the Hub does not return source URLs for `ticket` entries and (b) the desktop never asks for them in Stage 1.
- **`VITE_PLUGIN_HUB_URL` is first-party only.** It is set at build time, never from user input, never persisted from the marketplace row's `sourceUri`. A compromised `sourceUri` cannot redirect Hub traffic to an attacker endpoint.
- **Token-at-rest weakness (out of scope)**: the `Token` store uses AES with a hardcoded key `"ai-fetchly-key"` (`src/modules/token.ts:12-82`), not Electron `safeStorage`. Not introduced by this PRD but flagged for a separate hardening pass; not a blocker because the same protection (or lack thereof) already applies to the existing login tokens.

## 17. Implementation Phases (each = one commit per AGENTS.md auto-commit rule)

1. **Config + URL resolver** — `.env.example` entry, `src/config/pluginHubUrl.ts`, `vite.main.config.mjs` `define`. (compile-only)
2. **Source kind + types** — add `"aifetch-hub"` to enum, new `src/entityTypes/communityPluginTypes.ts`. (compile-only; `yarn vue-check`)
3. **Hub fetcher** — `AiFetchHubMarketplaceFetcher.ts` + registry registration. (unit test with `nock` mocking the Hub)
4. **Service extension** — `listCommunityPlugins` / `getCommunityPluginDetail` on `PluginMarketplaceService`, `ensureBuiltinHubMarketplace`, `hubEntryToSourceRequest`. (unit test)
5. **Zod schemas** — `src/schemas/ipc/communityPlugin.ts`. (compile-only)
6. **IPC handlers** — `community-plugin-ipc.ts`, register in `index.ts`. (IPC integration test)
7. **Preload allowlist** — add three invoke channels + `user_info_updated` receive channel. (smoke test: `windowInvoke` no longer silent-fails)
8. **Frontend API module** — `src/views/api/communityPlugins.ts`. (compile-only)
9. **i18n** — all six language files updated. (verify by running app in each language)
10. **Page component** — `src/views/pages/communityPlugins/index.vue` + router registration. (manual QA in `yarn dev`)
11. **Live re-fetch wiring** — `window.api.receive("user_info_updated")` subscription on the page. (integration test with a mock broadcast)
12. **Docs** — this file updates if any decisions diverge during implementation.

Each phase is self-contained, buildable, test-passing. Per AGENTS.md, stage + commit after each phase.

## 18. Open Questions

1. **§5.3 Built-in marketplaces** — add a `built_in` column to `PluginMarketplace.entity` (Stage 1.1) or use the reserved-name `name === "AiFetchly Plugin Hub"` check (zero entity schema change). Recommended: reserved-name for Stage 1; promote to a column if more built-ins appear.
2. **§13.1 Page `requiresAuth`** — should the page require login to enter, or allow anonymous browsing with Sign-in/Upgrade CTAs on locked rows? Recommended: allow anonymous browsing (matches Hub anonymous segment). Set `meta.requiresAuth = false` if the router enforces it elsewhere.
3. **§5.4 Hub source descriptor** — the Hub tech design §9.3 populates `source` on `direct` entries. Confirm the exact field names (`source.uri`, `source.ref`, `source.kind`) match the existing `PluginSourceRequest` shape in `src/entityTypes/pluginTypes.ts`. Adjust `hubEntryToSourceRequest` accordingly during implementation phase 4.
4. **Marketing plans URL** (`§4`) — confirm `https://www.sellart-online.com/pricing` (referenced in `.env.example` as `VITE_LOGIN_URL=https://www.sellart-online.com`) vs `https://www.aifetchly.com/pricing`. Hard-code as a constant in `pluginHubUrl.ts` after confirmation.

## 19. Out of Scope (defers to later stages)

- **Install-ticket + signed-artifact redemption** (v2 PRIV-10) — when Hub ships `POST /api/v1/plugins/:pluginName/install-ticket` + `GET /api/v1/downloads/:ticketId`, the desktop extends `PLUGIN_COMMUNITY_INSTALL` to redeem a ticket for `installMode: "ticket"` plugins. The Upgrade CTA flips to Install for entitled viewers.
- **Per-plugin detail page** — Stage 1 renders list + inline summary only.
- **Search/filter UI** — Stage 1 only passes `category`/`search` query params to the Hub; no client-side search box beyond what IPC input supports.
- **Reviews UI** — Hub already has `GET /api/v1/plugins/:pluginName/reviews` (`routes.go:433`); desktop consumes it in a later phase.
- **Stage 3 (RS256/JWKS)** — desktop change is a no-op; it still forwards the same JWT. Only update `VITE_PLUGIN_HUB_URL` if the JWKS endpoint lives on a different origin.
## 20. Implementation Notes — Stage 1 As-Built (2026-08-17)

The desktop side shipped on branch `worktree-plugin-hub` (commits `21d4deb2`…).
Divergences from this design discovered during implementation, all verified
against the live codebase:

1. **HttpClient is baseUrl-bound (§5.2 sketch was wrong).** `HttpClient`
   prefixes every request with `loginUrl + "/apis"`, so `client.get(<absolute
   URL>)` cannot reach the Hub. As-built: `_fetchJSON`/`_refreshTokenAndRetry`
   accept an `absolute` flag and a new `HttpClient.getFirstParty(url)` gates it
   behind `assertFirstPartyHubUrl` (origin must equal the configured hub base),
   preserving auth-attach + 401-refresh-retry while making token exfiltration
   to a non-first-party origin impossible.
2. **`user_info_updated` needs no new preload receive channel (§6.4/§12).**
   The broadcast rides the already-allowlisted `WEBSOCKET_EVENT`
   (`websocket:event`) channel with a nested payload
   (`{type:"message", data:{type:"user_info_updated",…}}`); the page
   subscribes there and filters. Only the four `PLUGIN_COMMUNITY_*` invoke
   channels were added to `preload.ts`.
3. **Hub refresh does not reuse `refreshMarketplace()` (§7 sketch).**
   `refreshMarketplace` delegates through `addMarketplace`, which re-parses
   the stored URI as kind `"url"` and performs a filesystem cache-dir swap —
   both wrong for the hub kind. As-built: a dedicated
   `refreshHubMarketplace()` persists `manifestJson` directly into the
   built-in marketplace row (the row IS the cache; no cache dir).
4. **Hub manifests skip `validateMarketplaceManifest`.** That validator
   requires a marketplace-shaped `source` on every entry, but locked (`ticket`)
   hub rows carry none. The hub response is instead validated by its own zod
   schema inside `AiFetchHubMarketplaceFetcher` (first-party contract), and the
   synthesized manifest is persisted without re-running marketplace validation.
5. **Fourth channel `PLUGIN_COMMUNITY_OPEN_PLANS`.** The Upgrade CTA opens
   `MARKETING_PLANS_URL` via `shell.openExternal` in the main process
   (constant, never renderer-supplied), mirroring `APP_OPEN_WEBSITE` — there
   is no renderer `window.openExternal`.
6. **Reserved name is the slug `aifetch-plugin-hub`** (not the display string
   "AiFetchly Plugin Hub") so it always satisfies `MARKETPLACE_NAME_REGEX`;
   display name stays "AiFetchly Plugin Hub". `listMarketplaces()` and
   `listAvailablePlugins()` filter the built-in row out of the Plugin Manager,
   and `removeMarketplace` refuses it (§18.1 recommendation, adopted).
7. **Catalog cache TTL = 10 min** (mirrors the hub's introspection snapshot
   TTL). Normal mounts serve the fresh cache; Refresh and
   `user_info_updated` force a re-fetch; a fetch failure throws (error state)
   rather than serving a stale list as fresh.
8. **Schemas import classic `zod`**, not `zod/v4` — `registerValidatedHandler`
   and the shared zodToJsonSchema machinery type against root-zod `ZodType`,
   same as every other file in `src/schemas/ipc/`.
9. **`.env.example` was not updated** (file is permission-restricted in the
   implementation environment); the default `https://plugins.aifetchly.com`
   and the `http://localhost:8080` dev override are documented in
   `src/config/pluginHubUrl.ts` and baked via the `vite.main.config.mjs`
   `define`. Add the entry manually when convenient.

Test evidence: 40 new tests across config/httpclient/fetcher/service/IPC
suites; full main-process suite green (424 files / 3764 tests);
`tsc --noEmit` and `vue-tsc --noEmit` clean.
