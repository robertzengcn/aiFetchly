# Plugin Marketplace Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add a plugin marketplace (catalog), browse its plugin entries in a Discover tab, and install a selected plugin via `plugin-name@marketplace-name` — without creating a second plugin installer. Marketplace entries resolve into the existing `PluginInstallService.installFromSource()` pipeline.

**Architecture:** Marketplace support sits *above* the existing plugin system. A marketplace is untrusted catalog data: parse → validate → cache on disk → persist via a new `PluginMarketplaceEntity`/`Model`/`Module` triple (mirrors `InstalledPlugin`). Installing a marketplace plugin converts one catalog entry into a `PluginSourceRequest` and hands it to `PluginInstallService`, which ends at the same `PluginImportService.installFromLocalRoot()` used by direct installs. Marketplace provenance is stored on the installed-plugin row's existing `sourceMetaJson`.

**Tech Stack:** TypeScript 5.x, Electron main process, TypeORM + better-sqlite3, zod 3.24, Vue 3 + Vuetify 3 + vue-i18n, vitest (`vite.utilityCode.config.mjs` + `vite.main.config.mjs`), mocha (`test/modules/`).

**Source documents:**
- PRD: `docs/prd/plugin-marketplace-support-prd.md`
- Technical design: `docs/prd/plugin-marketplace-support-technical-design.md`

---

## Verified codebase facts (confirmed on `worktree-marketplace`, 2026-07-10)

These override anything in the technical design that contradicts them.

1. **`src/service/pluginSources/` exists** with `GitPluginFetcher`, `GitHubPluginFetcher`, `UrlPluginFetcher`, `NpmPluginFetcher`, `LocalZipPluginFetcher`, `LocalFolderPluginFetcher`, `PluginSourceRegistry`, plus `pluginSourceTypes.ts`, `pluginSourceRedact.ts`, `pluginSourceLimits.ts`.
2. **Fetcher contract** is `acquire(req): Promise<{success:true; source:{localRoot; cleanup}} | {success:false; errors}>`. Marketplace fetchers mirror this shape but expose `fetch()` returning a marketplace manifest (different target).
3. **`PluginSourceRequest`** lives in `src/service/pluginSources/pluginSourceTypes.ts` (NOT `pluginTypes.ts`). All fields `readonly`.
4. **`PluginInstallService.installFromSource`** builds `PluginSourceProvenance` from the request (lines ~80-86) and calls `installFromLocalRoot`. We extend it to thread `source` + `sourceMeta`.
5. **`PluginImportService.installFromLocalRoot(root, {overwrite, provenance})`** sets the installed row's `source` from `(manifest.source ?? "local")` (step 8). We change this to `(provenance?.source ?? manifest.source ?? "local")` so marketplace installs record `source = "marketplace"`.
6. **`parsePluginIdentifier` does NOT exist in this worktree** (only in the main checkout). This plan **creates** it at `src/service/pluginMarketplaces/parsePluginIdentifier.ts`.
7. **IPC handlers return RAW values.** `registerAiValidatedHandler(channel, schema, handler)` (in `src/main-process/communication/_shared/registerValidatedHandler.ts`) does the AI-gate first (fail-closed via `new Token().getValue(USER_AI_ENABLED) === "true"`), then `schema().safeParse`, then wraps the handler's return into `{status:true,msg:"ok",data}` and thrown errors into `{status:false,msg,data:null}`. **Do not** write try/catch or AI-gate code in handlers.
8. **Entity registration is EXPLICIT** in `src/config/SqliteDb.ts`: a hand-maintained `entities: [...]` array + top-of-file import. `synchronize: true` → no migration file. Forgetting either step throws at runtime.
9. **Models extend `BaseDb`** (`constructor(filepath)`, `ensureConnection()`, read repo via `this.sqliteDb.connection.getRepository(Entity)`). **Modules extend `BaseModule`** (`this.dbpath` from `new Token().getValue(USERSDBPATH)`, new-up models with `this.dbpath`).
10. **Schemas** use `lazySchema(() => z.strictObject({...}))` from `@/utils/lazySchema`; `noInputSchema` from `@/schemas/ipc/_shared/common`. Strings carry `.min(1).max(N)`.
11. **Channels** are `export const NAME = "domain:action";` in `src/config/channellist.ts`.
12. **Renderer API** uses `windowInvoke(CHANNEL, {obj})` from `@/views/utils/apirequest`; types co-located and exported; reads return `Promise<T|null>`, mutations `Promise<void>`.
13. **Reuse, don't duplicate:** `redactMessage`/`redactUri` from `@/service/pluginSources/pluginSourceRedact`; `applyDirectoryLimits` from `@/service/pluginSources/pluginSourceLimits`; path helpers via `getElectronUserDataPath()` from `@/service/SkillEnvironmentManager`.
14. **v-tabs pattern** (from `PluginDetailPanel.vue`): `<v-tabs v-model="tab">` + `<v-window v-model="tab">` sharing one string ref; `<v-tab value="x">` / `<v-window-item value="x">` (NOT `v-tab-item`).
15. **i18n** `en.ts` is one `export default {...}`; the `plugins:` block nests sub-objects (e.g. `install_source:`) — add a `marketplace:` sub-group. Replicate across `en,zh,es,fr,de,ja`.
16. **IPC registration** in `src/main-process/communication/index.ts` is a flat manifest; add `registerPluginMarketplaceIpcHandlers()` right after `registerPluginIpcHandlers()`.

---

## File structure

### New files

| File | Responsibility |
|---|---|
| `src/entityTypes/pluginMarketplaceTypes.ts` | All marketplace type contracts (source, manifest, entry, errors, DTOs). |
| `src/service/pluginMarketplaces/parsePluginIdentifier.ts` | Parse `name@marketplace` (created — missing in worktree). |
| `src/service/pluginMarketplaces/pluginMarketplacePaths.ts` | Cache dir helpers under `<userData>/plugins/marketplaces/`. |
| `src/service/pluginMarketplaces/pluginMarketplaceValidation.ts` | zod manifest schema + post-schema checks + limits. |
| `src/service/pluginMarketplaces/parseMarketplaceSource.ts` | Parse user source string → `PluginMarketplaceSource`. |
| `src/service/pluginMarketplaces/marketplaceFetcherTypes.ts` | Fetcher `fetch()` contract + result types. |
| `src/service/pluginMarketplaces/GitMarketplaceFetcher.ts` | Shallow `git clone`, locate `marketplace.json`. |
| `src/service/pluginMarketplaces/GitHubMarketplaceFetcher.ts` | `owner/repo` shorthand → git. |
| `src/service/pluginMarketplaces/LocalMarketplaceFetcher.ts` | local-folder / local-file → cache copy. |
| `src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts` | HTTPS → download `marketplace.json`. |
| `src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts` | kind → fetcher map. |
| `src/service/pluginMarketplaces/resolveMarketplaceEntrySource.ts` | Entry → `PluginSourceRequest` + `MarketplaceInstallMeta`. |
| `src/service/PluginMarketplaceService.ts` | Orchestrates add/list/get/refresh/remove/discover/install. |
| `src/entity/PluginMarketplace.entity.ts` | `plugin_marketplaces` row. |
| `src/model/PluginMarketplace.model.ts` | Data access (extends `BaseDb`). |
| `src/modules/PluginMarketplaceModule.ts` | Business logic (extends `BaseModule`). |
| `src/schemas/ipc/pluginMarketplace.ts` | zod input schemas for the 8 channels. |
| `src/main-process/communication/plugin-marketplace-ipc.ts` | 8 `registerAiValidatedHandler` handlers. |
| `src/views/api/pluginMarketplaces.ts` | Renderer API + DTO types. |
| `src/views/components/plugins/PluginDiscoverTab.vue` | Browse catalog entries. |
| `src/views/components/plugins/PluginMarketplacesTab.vue` | Manage marketplaces. |
| `src/views/components/plugins/PluginMarketplaceAddDialog.vue` | Add-marketplace form. |
| `src/views/components/plugins/PluginMarketplacePluginDetailDialog.vue` | Pre-install review + risk flags. |

### Modified files

| File | Change |
|---|---|
| `src/entityTypes/pluginTypes.ts` | Add `plugin-identifier-invalid` to `PluginErrorCode`; add `source?: PluginSource` to `PluginSourceProvenance`. |
| `src/service/pluginSources/pluginSourceTypes.ts` | Add `source?: PluginSource` and `sourceMeta?: Record<string, unknown>` to `PluginSourceRequest`. |
| `src/service/PluginInstallService.ts` | Merge `req.source` + `req.sourceMeta` into provenance. |
| `src/service/PluginImportService.ts` | `installFromLocalRoot`: `source: provenance?.source ?? manifest.source ?? "local"`. |
| `src/config/SqliteDb.ts` | Register `PluginMarketplaceEntity`. |
| `src/config/channellist.ts` | Add 8 `PLUGIN_MARKETPLACE_*` channels. |
| `src/main-process/communication/index.ts` | Call `registerPluginMarketplaceIpcHandlers()`. |
| `src/views/components/plugins/PluginManager.vue` | Refactor to tabs; render new tab components. |
| `src/views/components/plugins/PluginOverviewTab.vue` | Show marketplace provenance. |
| `src/views/api/plugins.ts` | Add optional `marketplaceName?` provenance fields to `PluginDetail`. |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add `plugins.marketplace.*` keys. |

### New test files

| File | Runner |
|---|---|
| `test/vitest/utilitycode/parsePluginIdentifier.test.ts` | vitest utilitycode |
| `test/vitest/utilitycode/installPipelineProvenance.test.ts` | vitest utilitycode |
| `test/vitest/utilitycode/parseMarketplaceSource.test.ts` | vitest utilitycode |
| `test/vitest/utilitycode/pluginMarketplaceValidation.test.ts` | vitest utilitycode |
| `test/vitest/utilitycode/pluginMarketplacePaths.test.ts` | vitest utilitycode |
| `test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts` | vitest utilitycode |
| `test/vitest/utilitycode/pluginMarketplaceService.test.ts` | vitest utilitycode |
| `test/modules/PluginMarketplaceModule.test.ts` | mocha |
| `test/vitest/main/plugin-marketplace-ipc.test.ts` | vitest main |

### Run commands (memorize these)

```bash
# utility code unit tests
npx vitest --config vite.utilityCode.config.mjs <file>
# main process / IPC tests
npx vitest --config vite.main.config.mjs <file>
# module tests (mocha, real DB temp fallback)
yarn test <file>
# vue type check
yarn vue-check
```

If `tsc` globalSetup is slow during a tight loop, bypass with `AIFETCHLY_SKIP_TSC=1` — but never commit code that needs it.

## Task 1: Marketplace type contracts + plugin identifier parser

**Files:**
- Create: `src/entityTypes/pluginMarketplaceTypes.ts`
- Create: `src/service/pluginMarketplaces/parsePluginIdentifier.ts`
- Modify: `src/entityTypes/pluginTypes.ts` (add error code)
- Test: `test/vitest/utilitycode/parsePluginIdentifier.test.ts`

- [ ] **Step 1: Add the missing error code to `PluginErrorCode`**

In `src/entityTypes/pluginTypes.ts`, add `"plugin-identifier-invalid"` to the `PluginErrorCode` union (before `"unknown"`):

```typescript
  | "uninstall-failed"
  | "missing_files"
  | "plugin-identifier-invalid"
  | "unknown";
```

- [ ] **Step 2: Create `src/entityTypes/pluginMarketplaceTypes.ts`**

This file holds every marketplace type contract. Other tasks import from here.

```typescript
import type { PluginSourceKind } from "@/entityTypes/pluginTypes";

// ---------------------------------------------------------------------------
// Marketplace source (PRD §8.1)
// ---------------------------------------------------------------------------

export type PluginMarketplaceSourceKind =
  | "github"
  | "git"
  | "local-folder"
  | "local-file"
  | "url";

export interface PluginMarketplaceSource {
  readonly kind: PluginMarketplaceSourceKind;
  readonly uri: string;
  readonly ref?: string;
}

// ---------------------------------------------------------------------------
// Manifest (PRD §8.2, tech design §5.2)
// ---------------------------------------------------------------------------

export interface PluginMarketplaceOwner {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
}

export interface PluginMarketplaceMetadata {
  readonly pluginRoot?: string;
  readonly description?: string;
  readonly version?: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Plugin entry + entry sources (PRD §8.3, tech design §5.3)
// ---------------------------------------------------------------------------

export interface PluginMarketplaceGithubSource {
  readonly source: "github";
  readonly repo: string;
  readonly ref?: string;
  readonly sha?: string;
}
export interface PluginMarketplaceGitUrlSource {
  readonly source: "url";
  readonly url: string;
  readonly ref?: string;
  readonly sha?: string;
}
export interface PluginMarketplaceGitSubdirSource {
  readonly source: "git-subdir";
  readonly url: string;
  readonly path: string;
  readonly ref?: string;
  readonly sha?: string;
}
export interface PluginMarketplaceNpmSource {
  readonly source: "npm";
  readonly package: string;
  readonly version?: string;
  readonly registry?: string;
}

export type PluginMarketplaceEntrySource =
  | string
  | PluginMarketplaceGithubSource
  | PluginMarketplaceGitUrlSource
  | PluginMarketplaceGitSubdirSource
  | PluginMarketplaceNpmSource;

export interface PluginMarketplaceEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly version?: string;
  readonly author?: string | PluginMarketplaceOwner;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source: PluginMarketplaceEntrySource;
  readonly defaultEnabled?: boolean;
  readonly strict?: boolean;
  readonly relevance?: unknown;
  readonly skills?: unknown;
  readonly commands?: unknown;
  readonly agents?: unknown;
  readonly hooks?: unknown;
  readonly mcpServers?: unknown;
  readonly lspServers?: unknown;
  readonly outputStyles?: unknown;
  readonly experimental?: unknown;
}

export interface PluginMarketplaceManifest {
  readonly name: string;
  readonly owner: PluginMarketplaceOwner;
  readonly description?: string;
  readonly version?: string;
  readonly metadata?: PluginMarketplaceMetadata;
  readonly plugins: readonly PluginMarketplaceEntry[];
  readonly renames?: Record<string, string | null>;
  readonly allowCrossMarketplaceDependenciesOn?: readonly string[];
}

// ---------------------------------------------------------------------------
// Health + errors (tech design §4.1, §6)
// ---------------------------------------------------------------------------

export type PluginMarketplaceHealth =
  | "healthy"
  | "disabled"
  | "invalid"
  | "fetch_failed"
  | "missing_files";

export type PluginMarketplaceErrorCode =
  | "marketplace-source-invalid"
  | "marketplace-fetch-failed"
  | "marketplace-manifest-not-found"
  | "marketplace-manifest-invalid-json"
  | "marketplace-schema-invalid"
  | "marketplace-name-conflict"
  | "marketplace-plugin-entry-invalid"
  | "marketplace-plugin-source-unsupported"
  | "marketplace-plugin-source-outside-root"
  | "marketplace-cache-missing"
  | "marketplace-remove-failed"
  | "unknown";

export interface PluginMarketplaceError {
  readonly code: PluginMarketplaceErrorCode;
  readonly marketplaceName?: string;
  readonly pluginName?: string;
  readonly path?: string;
  readonly message: string;
  readonly recoverable: boolean;
}

// ---------------------------------------------------------------------------
// DTOs (tech design §5.4)
// ---------------------------------------------------------------------------

export interface PluginMarketplaceSummary {
  readonly id: number;
  readonly name: string;
  readonly displayName?: string;
  readonly ownerName: string;
  readonly description?: string;
  readonly version?: string;
  readonly sourceKind: PluginMarketplaceSourceKind;
  readonly sourceUri: string;
  readonly sourceRef?: string;
  readonly pluginCount: number;
  readonly enabled: boolean;
  readonly autoUpdate: boolean;
  readonly health: PluginMarketplaceHealth;
  readonly lastFetchedAt?: string;
  readonly updatedAt?: string;
}

export interface PluginMarketplaceDetail extends PluginMarketplaceSummary {
  readonly ownerEmail?: string;
  readonly ownerUrl?: string;
  readonly manifest: PluginMarketplaceManifest;
  readonly errors: readonly PluginMarketplaceError[];
  readonly installPath?: string;
  readonly sourceMeta: Record<string, unknown>;
}

export interface PluginMarketplaceCapabilitySummary {
  readonly hasSkills: boolean;
  readonly hasCommands: boolean;
  readonly hasAgents: boolean;
  readonly hasHooks: boolean;
  readonly hasMcpServers: boolean;
  readonly hasLspServers: boolean;
  readonly hasOutputStyles: boolean;
  readonly hasMonitors: boolean;
}

export type PluginMarketplacePluginStatus =
  | "not_installed"
  | "installed"
  | "different_version"
  | "unsupported"
  | "error";

export interface PluginMarketplacePluginSummary {
  readonly pluginId: string; // `${entry.name}@${marketplace.name}`
  readonly name: string;
  readonly displayName?: string;
  readonly marketplaceName: string;
  readonly marketplaceDisplayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly sourceKind: string;
  readonly capabilitySummary: PluginMarketplaceCapabilitySummary;
  readonly installed: boolean;
  readonly installedVersion?: string;
  readonly status: PluginMarketplacePluginStatus;
  readonly errors: readonly PluginMarketplaceError[];
}

export interface PluginMarketplacePluginDetail extends PluginMarketplacePluginSummary {
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly entry: PluginMarketplaceEntry;
  readonly resolvedSourceKind?: PluginSourceKind;
  readonly resolvedSourceUri?: string;
  readonly resolvedSourceRef?: string;
  readonly pinnedToCommit: boolean;
}

// ---------------------------------------------------------------------------
// Request types (tech design §11, §13)
// ---------------------------------------------------------------------------

export interface AddPluginMarketplaceRequest {
  readonly source: string;
  readonly ref?: string;
  readonly overwrite?: boolean;
}

export interface InstallMarketplacePluginRequest {
  readonly pluginId: string; // `name@marketplace`
  readonly overwrite?: boolean;
  readonly enableAfterInstall?: boolean;
  readonly npmAuthToken?: string;
}

export interface PluginMarketplacePluginFilter {
  readonly search?: string;
  readonly marketplaceName?: string;
  readonly category?: string;
  readonly installed?: boolean;
  readonly hasSkills?: boolean;
  readonly hasMcpServers?: boolean;
  readonly hasHooks?: boolean;
}

/** Provenance stored on the installed plugin row under sourceMetaJson.marketplace. */
export interface MarketplaceInstallMeta {
  readonly marketplaceName: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
  readonly entryName: string;
  readonly entryVersion?: string;
  readonly entrySource: PluginMarketplaceEntrySource;
  readonly resolvedSourceKind: PluginSourceKind;
  readonly resolvedSourceUri?: string;
  readonly resolvedSourceRef?: string;
  readonly resolvedAt: string;
}
```

- [ ] **Step 3: Write the failing test for `parsePluginIdentifier`**

Create `test/vitest/utilitycode/parsePluginIdentifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parsePluginIdentifier } from "@/service/pluginMarketplaces/parsePluginIdentifier";

describe("parsePluginIdentifier", () => {
  it("parses a bare plugin name", () => {
    const r = parsePluginIdentifier("lead-tools");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: "lead-tools" });
  });

  it("parses name@marketplace", () => {
    const r = parsePluginIdentifier("lead-tools@anthropics");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: "lead-tools", marketplace: "anthropics" });
  });

  it("rejects empty input", () => {
    expect(parsePluginIdentifier("").ok).toBe(false);
  });

  it("rejects multiple @ separators", () => {
    expect(parsePluginIdentifier("a@b@c").ok).toBe(false);
  });

  it("rejects empty marketplace segment", () => {
    expect(parsePluginIdentifier("foo@").ok).toBe(false);
  });

  it("rejects invalid name characters", () => {
    expect(parsePluginIdentifier("Bad Name@mkt").ok).toBe(false);
    expect(parsePluginIdentifier("UPPER@mkt").ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/parsePluginIdentifier.test.ts`
Expected: FAIL — module `@/service/pluginMarketplaces/parsePluginIdentifier` not found.

- [ ] **Step 5: Implement `parsePluginIdentifier`**

Create `src/service/pluginMarketplaces/parsePluginIdentifier.ts`:

```typescript
import type { PluginError } from "@/entityTypes/pluginTypes";

/**
 * Parses Claude-style plugin identifiers.
 *   "lead-tools"            -> { name: "lead-tools" }
 *   "lead-tools@anthropics" -> { name: "lead-tools", marketplace: "anthropics" }
 *
 * Both segments must match NAME_REGEX. Multiple "@" and empty marketplace
 * are rejected.
 */
export interface ParsedPluginIdentifier {
  readonly name: string;
  readonly marketplace?: string;
}

const NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function parsePluginIdentifier(
  id: string
): { ok: true; value: ParsedPluginIdentifier } | { ok: false; error: PluginError } {
  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: "Plugin identifier is empty.",
        recoverable: false,
      },
    };
  }

  const atCount = (id.match(/@/g) ?? []).length;
  if (atCount > 1) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: `Plugin identifier "${id}" contains multiple "@" separators.`,
        recoverable: false,
      },
    };
  }

  const [name, marketplace] = id.split("@");

  if (!NAME_REGEX.test(name)) {
    return {
      ok: false,
      error: {
        code: "plugin-identifier-invalid",
        message: `Plugin name "${name}" must match /^[a-z0-9][a-z0-9_-]*$/.`,
        recoverable: false,
      },
    };
  }

  if (marketplace !== undefined) {
    if (marketplace.length === 0) {
      return {
        ok: false,
        error: {
          code: "plugin-identifier-invalid",
          message: `Plugin identifier "${id}" has empty marketplace.`,
          recoverable: false,
        },
      };
    }
    if (!NAME_REGEX.test(marketplace)) {
      return {
        ok: false,
        error: {
          code: "plugin-identifier-invalid",
          message: `Plugin marketplace "${marketplace}" must match /^[a-z0-9][a-z0-9_-]*$/.`,
          recoverable: false,
        },
      };
    }
    return { ok: true, value: { name, marketplace } };
  }

  return { ok: true, value: { name } };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/parsePluginIdentifier.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/entityTypes/pluginMarketplaceTypes.ts \
        src/service/pluginMarketplaces/parsePluginIdentifier.ts \
        src/entityTypes/pluginTypes.ts \
        test/vitest/utilitycode/parsePluginIdentifier.test.ts
git commit -m "feat(plugin): add marketplace type contracts and identifier parser"
```

---

## Task 2: Install-pipeline hooks (source + sourceMeta threading)

Marketplace installs must record `source = "marketplace"` and stash marketplace provenance in `sourceMetaJson.marketplace`. The install pipeline currently derives `source` from the plugin's own manifest; we thread an optional override through `PluginSourceRequest` → `PluginSourceProvenance` → `installFromLocalRoot`. Backward-compatible: when unset, behavior is unchanged.

**Files:**
- Modify: `src/service/pluginSources/pluginSourceTypes.ts`
- Modify: `src/entityTypes/pluginTypes.ts`
- Modify: `src/service/PluginInstallService.ts`
- Modify: `src/service/PluginImportService.ts`
- Test: `test/vitest/utilitycode/installPipelineProvenance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/installPipelineProvenance.test.ts`. It asserts the provenance-builder logic and the source-override precedence without touching the DB:

```typescript
import { describe, it, expect } from "vitest";

/**
 * The provenance merge lives inline in PluginInstallService.installFromSource.
 * To keep this a pure unit test, we replicate the exact merge expression here
 * and also assert the public contract: PluginSourceRequest now carries
 * `source` and `sourceMeta`. If the production merge drifts, the
 * pluginMarketplaceService integration test (Task 7) catches it.
 */
function buildProvenance(req: {
  kind: string;
  uri?: string;
  zipPath?: string;
  folderPath?: string;
  npmPackage?: string;
  ref?: string;
  npmVersion?: string;
  npmRegistry?: string;
  source?: string;
  sourceMeta?: Record<string, unknown>;
}) {
  return {
    sourceKind: req.kind,
    sourceUri: req.uri ?? req.zipPath ?? req.folderPath ?? req.npmPackage,
    sourceRef: req.ref ?? req.npmVersion,
    source: req.source,
    sourceMeta: {
      ...(req.npmRegistry ? { registry: req.npmRegistry } : {}),
      ...(req.sourceMeta ?? {}),
    },
  };
}

describe("install pipeline provenance merge", () => {
  it("threads marketplace source + sourceMeta", () => {
    const p = buildProvenance({
      kind: "github",
      uri: "owner/repo",
      source: "marketplace",
      sourceMeta: { marketplace: { marketplaceName: "team", entryName: "x" } },
    });
    expect(p.source).toBe("marketplace");
    expect(p.sourceMeta).toHaveProperty("marketplace");
  });

  it("preserves npm registry alongside sourceMeta", () => {
    const p = buildProvenance({
      kind: "npm",
      npmPackage: "pkg",
      npmRegistry: "https://registry.example.com",
      sourceMeta: { marketplace: { marketplaceName: "team" } },
    });
    expect(p.sourceMeta).toMatchObject({
      registry: "https://registry.example.com",
      marketplace: { marketplaceName: "team" },
    });
  });

  it("defaults source to undefined when caller omits it (backward compatible)", () => {
    const p = buildProvenance({ kind: "local-folder", folderPath: "/tmp/x" });
    expect(p.source).toBeUndefined();
    expect(p.sourceMeta).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/installPipelineProvenance.test.ts`
Expected: FAIL (test references fields not yet on the type, but since it uses a local shape it may pass immediately — that's fine; the real guard is the type change below + Task 7 integration). If it passes already, proceed; the type edits are still required for Task 7 to compile.

- [ ] **Step 3: Add `source` + `sourceMeta` to `PluginSourceRequest`**

In `src/service/pluginSources/pluginSourceTypes.ts`, add two fields to the `PluginSourceRequest` interface (import `PluginSource`):

```typescript
import type {
  PluginError,
  PluginSource,
  PluginSourceKind,
} from "@/entityTypes/pluginTypes";

export interface PluginSourceRequest {
  readonly kind: PluginSourceKind;
  readonly overwrite?: boolean;
  /** Optional override for the installed row's `source` (e.g. "marketplace"). */
  readonly source?: PluginSource;
  /** Optional extra provenance merged into sourceMetaJson. */
  readonly sourceMeta?: Record<string, unknown>;
  readonly zipPath?: string;
  readonly folderPath?: string;
  readonly uri?: string;
  readonly ref?: string;
  readonly npmPackage?: string;
  readonly npmVersion?: string;
  readonly npmRegistry?: string;
  readonly npmAuthScope?: string;
  readonly npmAuthToken?: string;
  readonly onProgress?: (msg: string, pct?: number) => void;
}
```

- [ ] **Step 4: Add `source` to `PluginSourceProvenance`**

In `src/entityTypes/pluginTypes.ts`:

```typescript
export interface PluginSourceProvenance {
  readonly sourceKind: PluginSourceKind;
  readonly sourceUri?: string;
  readonly sourceRef?: string;
  readonly source?: PluginSource;
  readonly sourceMeta?: Record<string, unknown>;
}
```

- [ ] **Step 5: Merge into provenance in `PluginInstallService.installFromSource`**

In `src/service/PluginInstallService.ts`, replace the existing `provenance` object (lines ~80-86) with:

```typescript
      const provenance: PluginSourceProvenance = {
        sourceKind: req.kind,
        sourceUri:
          req.uri ?? req.zipPath ?? req.folderPath ?? req.npmPackage,
        sourceRef: req.ref ?? req.npmVersion,
        source: req.source,
        sourceMeta: {
          ...(req.npmRegistry ? { registry: req.npmRegistry } : {}),
          ...(req.sourceMeta ?? {}),
        },
      };
```

- [ ] **Step 6: Honor `provenance.source` in `installFromLocalRoot`**

In `src/service/PluginImportService.ts`, inside `installFromLocalRoot`, step 8 (the `pluginModule.createPlugin({...})` call), change the `source` line from:

```typescript
        source: (manifest.source ?? "local") as PluginSource,
```

to:

```typescript
        source: (provenance?.source ?? manifest.source ?? "local") as PluginSource,
```

- [ ] **Step 7: Run the test + existing plugin tests to confirm no regression**

```bash
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/installPipelineProvenance.test.ts
npx vitest --config vite.main.config.mjs test/vitest/main/plugin-ipc.test.ts
```
Expected: PASS. The existing `plugin-ipc.test.ts` mocks `PluginImportService`, so it is unaffected; direct installs omit `source` so behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/service/pluginSources/pluginSourceTypes.ts \
        src/entityTypes/pluginTypes.ts \
        src/service/PluginInstallService.ts \
        src/service/PluginImportService.ts \
        test/vitest/utilitycode/installPipelineProvenance.test.ts
git commit -m "feat(plugin): thread source override and sourceMeta through install pipeline"
```

## Task 3: Entity, registration, Model, Module

Mirror the `InstalledPlugin` triple exactly. The Module owns DB-facing logic only (no fetch, no JSON parsing beyond its own rows).

**Files:**
- Create: `src/entity/PluginMarketplace.entity.ts`
- Modify: `src/config/SqliteDb.ts` (register entity — import + array entry)
- Create: `src/model/PluginMarketplace.model.ts`
- Create: `src/modules/PluginMarketplaceModule.ts`
- Test: `test/modules/PluginMarketplaceModule.test.ts`

- [ ] **Step 1: Create the entity**

Create `src/entity/PluginMarketplace.entity.ts`:

```typescript
import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "@/entity/order.decorator";

/**
 * Persisted plugin marketplace (catalog) record.
 * Source of truth: PRD §9.1, tech design §4.1.
 */
@Entity("plugin_marketplaces")
@Index(["name"], { unique: true })
@Index(["enabled"])
@Index(["health"])
export class PluginMarketplaceEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("text")
  name: string;

  @Order(2)
  @Column("text", { nullable: true })
  displayName?: string;

  @Order(3)
  @Column("text")
  ownerName: string;

  @Order(4)
  @Column("text", { nullable: true })
  ownerEmail?: string;

  @Order(5)
  @Column("text", { nullable: true })
  ownerUrl?: string;

  @Order(6)
  @Column("text", { nullable: true })
  description?: string;

  @Order(7)
  @Column("text", { nullable: true })
  version?: string;

  @Order(8)
  @Column("text")
  sourceKind: string; // PluginMarketplaceSourceKind

  @Order(9)
  @Column("text")
  sourceUri: string; // redacted for display

  @Order(10)
  @Column("text", { nullable: true })
  sourceRef?: string;

  @Order(11)
  @Column("text", { nullable: true })
  installPath?: string; // marketplace cache root

  @Order(12)
  @Column("text")
  manifestJson: string; // validated marketplace manifest

  @Order(13)
  @Column("integer", { default: 0 })
  pluginCount: number;

  @Order(14)
  @Column("integer", { default: 1 })
  enabled: number;

  @Order(15)
  @Column("integer", { default: 0 })
  autoUpdate: number; // MVP: stored, not acted on

  @Order(16)
  @Column("text", { default: "healthy" })
  health: string; // PluginMarketplaceHealth

  @Order(17)
  @Column("text", { default: "[]" })
  lastErrorJson: string;

  @Order(18)
  @Column("datetime", { nullable: true })
  lastFetchedAt?: Date;

  @Order(19)
  @Column("text", { default: "{}" })
  sourceMetaJson: string; // non-secret source metadata
}
```

- [ ] **Step 2: Register the entity in `SqliteDb.ts`**

In `src/config/SqliteDb.ts`:

(a) Add the import next to the `InstalledPluginEntity` import (line ~68):
```typescript
import { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";
import { PluginMarketplaceEntity } from "@/entity/PluginMarketplace.entity";
```

(b) Add `PluginMarketplaceEntity,` to the `entities: [...]` array immediately after `InstalledPluginEntity,` (line ~479). With `synchronize: true`, the table auto-creates on next boot — no migration file.

- [ ] **Step 3: Create the Model**

Create `src/model/PluginMarketplace.model.ts`:

```typescript
import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { PluginMarketplaceEntity } from "@/entity/PluginMarketplace.entity";

/**
 * Data access for plugin marketplaces. Mirrors InstalledPluginModel.
 * Source of truth: PRD §9.2, tech design §10.1.
 */
export class PluginMarketplaceModel extends BaseDb {
  private repository: Repository<PluginMarketplaceEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<PluginMarketplaceEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(PluginMarketplaceEntity);
    }
    return this.repository;
  }

  async findAll(): Promise<PluginMarketplaceEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({ order: { createdAt: "DESC" } });
  }

  async findEnabled(): Promise<PluginMarketplaceEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({ where: { enabled: 1 } });
  }

  async findByName(name: string): Promise<PluginMarketplaceEntity | null> {
    const repo = await this.getRepository();
    return await repo.findOne({ where: { name } });
  }

  async create(
    marketplace: Partial<PluginMarketplaceEntity>
  ): Promise<number> {
    const repo = await this.getRepository();
    const entity = repo.create(marketplace);
    const saved = await repo.save(entity);
    return saved.id;
  }

  async updateByName(
    name: string,
    data: Partial<PluginMarketplaceEntity>
  ): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, data);
    return (result.affected ?? 0) > 0;
  }

  async toggle(name: string, enabled: boolean): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, { enabled: enabled ? 1 : 0 });
    return (result.affected ?? 0) > 0;
  }

  async remove(name: string): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.delete({ name });
    return (result.affected ?? 0) > 0;
  }
}
```

- [ ] **Step 4: Create the Module**

Create `src/modules/PluginMarketplaceModule.ts`:

```typescript
import { BaseModule } from "@/modules/baseModule";
import { PluginMarketplaceModel } from "@/model/PluginMarketplace.model";
import { PluginMarketplaceEntity } from "@/entity/PluginMarketplace.entity";
import type { PluginMarketplaceError } from "@/entityTypes/pluginMarketplaceTypes";

/**
 * Business logic for plugin marketplaces. DB-facing only: no fetching,
 * no manifest parsing beyond this table's own columns.
 * Source of truth: PRD §9.3, tech design §10.2.
 */
export class PluginMarketplaceModule extends BaseModule {
  private marketplaceModel: PluginMarketplaceModel;

  constructor() {
    super();
    this.marketplaceModel = new PluginMarketplaceModel(this.dbpath);
  }

  async listMarketplaces(): Promise<PluginMarketplaceEntity[]> {
    return this.marketplaceModel.findAll();
  }

  async listEnabledMarketplaces(): Promise<PluginMarketplaceEntity[]> {
    return this.marketplaceModel.findEnabled();
  }

  async getMarketplaceByName(
    name: string
  ): Promise<PluginMarketplaceEntity | null> {
    return this.marketplaceModel.findByName(name);
  }

  async createMarketplace(
    input: Partial<PluginMarketplaceEntity>
  ): Promise<number> {
    return this.marketplaceModel.create({
      name: input.name,
      displayName: input.displayName,
      ownerName: input.ownerName ?? "unknown",
      ownerEmail: input.ownerEmail,
      ownerUrl: input.ownerUrl,
      description: input.description,
      version: input.version,
      sourceKind: input.sourceKind ?? "url",
      sourceUri: input.sourceUri ?? "",
      sourceRef: input.sourceRef,
      installPath: input.installPath,
      manifestJson: input.manifestJson ?? "{}",
      pluginCount: input.pluginCount ?? 0,
      enabled: input.enabled ?? 1,
      autoUpdate: input.autoUpdate ?? 0,
      health: input.health ?? "healthy",
      lastErrorJson: input.lastErrorJson ?? "[]",
      lastFetchedAt: input.lastFetchedAt,
      sourceMetaJson: input.sourceMetaJson ?? "{}",
    });
  }

  async updateMarketplaceState(
    input: Partial<PluginMarketplaceEntity> & { name: string }
  ): Promise<boolean> {
    const patch: Partial<PluginMarketplaceEntity> = {};
    for (const key of [
      "displayName", "ownerName", "ownerEmail", "ownerUrl", "description",
      "version", "sourceKind", "sourceUri", "sourceRef", "installPath",
      "manifestJson", "pluginCount", "enabled", "autoUpdate", "health",
      "lastErrorJson", "lastFetchedAt", "sourceMetaJson",
    ] as const) {
      if (input[key] !== undefined) {
        // immutable-friendly shallow copy into patch
        (patch as Record<string, unknown>)[key] = input[key];
      }
    }
    return this.marketplaceModel.updateByName(input.name, patch);
  }

  async toggleMarketplace(name: string, enabled: boolean): Promise<boolean> {
    const ok = await this.marketplaceModel.toggle(name, enabled);
    if (ok) {
      await this.marketplaceModel.updateByName(name, {
        health: enabled ? "healthy" : "disabled",
      });
    }
    return ok;
  }

  async setMarketplaceErrors(
    name: string,
    errors: readonly PluginMarketplaceError[]
  ): Promise<boolean> {
    return this.marketplaceModel.updateByName(name, {
      lastErrorJson: JSON.stringify(errors),
      health: errors.length === 0 ? "healthy" : "invalid",
    });
  }

  async removeMarketplace(name: string): Promise<boolean> {
    return this.marketplaceModel.remove(name);
  }
}
```

- [ ] **Step 5: Write the module test (mocha)**

Create `test/modules/PluginMarketplaceModule.test.ts`:

```typescript
import { expect } from "chai";
import { PluginMarketplaceModule } from "@/modules/PluginMarketplaceModule";

/**
 * Mirrors test/modules/PluginManagementModule.test.ts (Mocha pattern).
 * BaseModule falls back to a temp DB when USERSDBPATH is unset.
 */
describe("PluginMarketplaceModule", function () {
  this.timeout(15000);

  const NAME = "test-mkt-pmm";

  afterEach(async () => {
    const mod = new PluginMarketplaceModule();
    await mod.removeMarketplace(NAME);
    await mod.removeMarketplace("toggle-mkt-pmm");
  });

  it("creates a marketplace and finds it by name", async () => {
    const mod = new PluginMarketplaceModule();
    const id = await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/marketplace.json",
      manifestJson: JSON.stringify({ name: NAME, owner: { name: "Tester" }, plugins: [] }),
    });
    expect(id).to.be.a("number");

    const found = await mod.getMarketplaceByName(NAME);
    expect(found).to.not.equal(null);
    expect(found?.ownerName).to.equal("Tester");
    expect(found?.enabled).to.equal(1);
    expect(found?.health).to.equal("healthy");
  });

  it("lists enabled marketplaces", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    const enabled = await mod.listEnabledMarketplaces();
    expect(enabled.some((m) => m.name === NAME)).to.equal(true);
  });

  it("toggles enabled and health", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: "toggle-mkt-pmm",
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    expect(await mod.toggleMarketplace("toggle-mkt-pmm", false)).to.equal(true);
    const off = await mod.getMarketplaceByName("toggle-mkt-pmm");
    expect(off?.enabled).to.equal(0);
    expect(off?.health).to.equal("disabled");
  });

  it("persists structured errors and flips health", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    await mod.setMarketplaceErrors(NAME, [
      { code: "marketplace-schema-invalid", message: "bad", recoverable: false },
    ]);
    const found = await mod.getMarketplaceByName(NAME);
    expect(found?.lastErrorJson).to.contain("marketplace-schema-invalid");
    expect(found?.health).to.equal("invalid");
  });

  it("removes a marketplace", async () => {
    const mod = new PluginMarketplaceModule();
    await mod.createMarketplace({
      name: NAME,
      ownerName: "Tester",
      sourceKind: "url",
      sourceUri: "https://example.com/m.json",
      manifestJson: "{}",
    });
    expect(await mod.removeMarketplace(NAME)).to.equal(true);
    expect(await mod.getMarketplaceByName(NAME)).to.equal(null);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `yarn test test/modules/PluginMarketplaceModule.test.ts`
Expected: PASS (5 tests). If it fails with a repository error, you forgot Step 2 (entity registration).

- [ ] **Step 7: Commit**

```bash
git add src/entity/PluginMarketplace.entity.ts \
        src/model/PluginMarketplace.model.ts \
        src/modules/PluginMarketplaceModule.ts \
        src/config/SqliteDb.ts \
        test/modules/PluginMarketplaceModule.test.ts
git commit -m "feat(plugin): persist plugin marketplaces"
```

---

## Task 4: Paths, validation, source parser (reuse redaction)

Pure helpers — no DB, no network. Reuse `redactMessage` instead of duplicating a redactor (deviation from tech design §10.2, justified: the existing helper already covers basic-auth, query tokens, `_authToken`, bearer).

**Files:**
- Create: `src/service/pluginMarketplaces/pluginMarketplacePaths.ts`
- Create: `src/service/pluginMarketplaces/pluginMarketplaceValidation.ts`
- Create: `src/service/pluginMarketplaces/parseMarketplaceSource.ts`
- Test: `test/vitest/utilitycode/pluginMarketplacePaths.test.ts`
- Test: `test/vitest/utilitycode/parseMarketplaceSource.test.ts`
- Test: `test/vitest/utilitycode/pluginMarketplaceValidation.test.ts`

- [ ] **Step 1: Create path helpers**

Create `src/service/pluginMarketplaces/pluginMarketplacePaths.ts`:

```typescript
import * as path from "path";
import { getElectronUserDataPath } from "@/service/SkillEnvironmentManager";

/**
 * Marketplace cache layout lives under <userData>/plugins/marketplaces/.
 * Marketplace files are NOT installed plugins (those live under .../installed/).
 */
export function getPluginMarketplacesRoot(): string {
  return path.join(getElectronUserDataPath(), "plugins", "marketplaces");
}

export function getPluginMarketplaceCacheRoot(name: string): string {
  return path.join(getPluginMarketplacesRoot(), "cache", name);
}

export function getPluginMarketplaceTempRoot(): string {
  return path.join(getPluginMarketplacesRoot(), "tmp");
}

/** git / local-folder style manifest location. */
export function getPluginMarketplaceManifestPath(name: string): string {
  return path.join(getPluginMarketplaceCacheRoot(name), ".claude-plugin", "marketplace.json");
}

/** direct URL download manifest location. */
export function getPluginMarketplaceDownloadedManifestPath(name: string): string {
  return path.join(getPluginMarketplaceCacheRoot(name), "marketplace.json");
}

/**
 * Resolve a relative entry source against the marketplace root and verify it
 * stays inside. Throws when the path escapes. Mirrors resolvePluginRelativePath
 * but operates against the marketplace root.
 */
export function assertPathInsideBase(base: string, target: string): void {
  const rel = path.relative(base, target);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return;
  throw new Error("Path escapes marketplace root.");
}
```

- [ ] **Step 2: Create the validation module**

Create `src/service/pluginMarketplaces/pluginMarketplaceValidation.ts`:

```typescript
import { z } from "zod";
import type {
  PluginMarketplaceError,
  PluginMarketplaceManifest,
} from "@/entityTypes/pluginMarketplaceTypes";

export const MARKETPLACE_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const MARKETPLACE_PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
export const MARKETPLACE_LIMITS = {
  maxManifestBytes: 5 * 1024 * 1024,
  maxPlugins: 5000,
  maxStringLength: 4096,
} as const;

const shaRegex = /^[a-f0-9]{40}$/i;

const ownerSchema = z
  .object({
    name: z.string().min(1).max(256),
    email: z.string().email().max(320).optional(),
    url: z.string().url().max(2048).optional(),
  })
  .passthrough();

const entrySourceSchema = z.union([
  z.string().min(1).max(4096),
  z
    .object({
      source: z.literal("github"),
      repo: z.string().min(1).max(512),
      ref: z.string().max(256).optional(),
      sha: z.string().regex(shaRegex).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("url"),
      url: z.string().min(1).max(4096),
      ref: z.string().max(256).optional(),
      sha: z.string().regex(shaRegex).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("git-subdir"),
      url: z.string().min(1).max(4096),
      path: z.string().min(1).max(2048),
      ref: z.string().max(256).optional(),
      sha: z.string().regex(shaRegex).optional(),
    })
    .passthrough(),
  z
    .object({
      source: z.literal("npm"),
      package: z.string().min(1).max(512),
      version: z.string().max(256).optional(),
      registry: z.string().url().max(2048).optional(),
    })
    .passthrough(),
]);

const entrySchema = z
  .object({
    name: z.string().regex(MARKETPLACE_PLUGIN_NAME_REGEX).max(256),
    displayName: z.string().max(256).optional(),
    description: z.string().max(2048).optional(),
    version: z.string().max(128).optional(),
    source: entrySourceSchema,
    tags: z.array(z.string().max(64)).max(64).optional(),
    keywords: z.array(z.string().max(64)).max(64).optional(),
    category: z.string().max(128).optional(),
  })
  .passthrough();

const marketplaceSchema = z
  .object({
    name: z.string().regex(MARKETPLACE_NAME_REGEX).max(256),
    owner: ownerSchema,
    description: z.string().max(2048).optional(),
    version: z.string().max(128).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(entrySchema).max(MARKETPLACE_LIMITS.maxPlugins),
    renames: z.record(z.string(), z.string().nullable()).optional(),
    allowCrossMarketplaceDependenciesOn: z.array(z.string()).optional(),
  })
  .passthrough();

export type ValidationResult =
  | { success: true; manifest: PluginMarketplaceManifest }
  | { success: false; errors: PluginMarketplaceError[] };

function marketError(
  code: PluginMarketplaceError["code"],
  message: string,
  extras: Partial<PluginMarketplaceError> = {}
): PluginMarketplaceError {
  return { code, message, recoverable: false, ...extras };
}

/**
 * Two-stage: (1) zod parse of the raw JSON string, (2) post-schema checks
 * (duplicate entry names, relative-source shape, control chars). Unknown
 * fields are preserved (passthrough) for future Claude compatibility.
 */
export function validateMarketplaceManifest(
  rawJson: string
): ValidationResult {
  if (rawJson.length > MARKETPLACE_LIMITS.maxManifestBytes) {
    return {
      success: false,
      errors: [
        marketError(
          "marketplace-schema-invalid",
          `Manifest exceeds ${MARKETPLACE_LIMITS.maxManifestBytes} bytes.`
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      success: false,
      errors: [marketError("marketplace-manifest-invalid-json", "Manifest is not valid JSON.")],
    };
  }

  const zodResult = marketplaceSchema.safeParse(parsed);
  if (!zodResult.success) {
    const msg = zodResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      success: false,
      errors: [marketError("marketplace-schema-invalid", msg)],
    };
  }

  const manifest = zodResult.data as PluginMarketplaceManifest;

  // Post-schema checks.
  const errors: PluginMarketplaceError[] = [];
  const seen = new Set<string>();
  for (const entry of manifest.plugins) {
    if (seen.has(entry.name)) {
      errors.push(
        marketError(
          "marketplace-plugin-entry-invalid",
          `Duplicate plugin entry name "${entry.name}".`,
          { pluginName: entry.name }
        )
      );
    }
    seen.add(entry.name);

    if (typeof entry.source === "string") {
      if (!entry.source.startsWith("./")) {
        errors.push(
          marketError(
            "marketplace-plugin-entry-invalid",
            `Entry "${entry.name}" source must start with "./".`,
            { pluginName: entry.name }
          )
        );
      }
      if (/[\r\n\x00-\x1f]/.test(entry.source)) {
        errors.push(
          marketError(
            "marketplace-plugin-entry-invalid",
            `Entry "${entry.name}" source contains control characters.`,
            { pluginName: entry.name }
          )
        );
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, manifest };
}
```

- [ ] **Step 3: Create the source parser**

Create `src/service/pluginMarketplaces/parseMarketplaceSource.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type {
  PluginMarketplaceError,
  PluginMarketplaceSource,
  PluginMarketplaceSourceKind,
} from "@/entityTypes/pluginMarketplaceTypes";

export type ParseSourceResult =
  | { success: true; source: PluginMarketplaceSource }
  | { success: false; errors: PluginMarketplaceError[] };

function err(message: string): PluginMarketplaceError {
  return { code: "marketplace-source-invalid", message, recoverable: false };
}

/**
 * Parse a user-provided marketplace source string into a structured source.
 * Rules: trim; reject empty / control chars; classify by shape; resolve
 * relative local paths to absolute.
 */
export function parseMarketplaceSource(raw: string, ref?: string): ParseSourceResult {
  const input = (raw ?? "").trim();
  if (input.length === 0) {
    return { success: false, errors: [err("Marketplace source is empty.")] };
  }
  if (/[\r\n\x00-\x1f]/.test(input)) {
    return { success: false, errors: [err("Marketplace source contains control characters.")] };
  }
  if (ref && /[\r\n\x00-\x1f]/.test(ref)) {
    return { success: false, errors: [err("Marketplace ref contains control characters.")] };
  }

  const withRef = (kind: PluginMarketplaceSourceKind, uri: string): PluginMarketplaceSource => ({
    kind,
    uri,
    ...(ref ? { ref } : {}),
  });

  // Plain http:// is always rejected.
  if (input.startsWith("http://")) {
    return { success: false, errors: [err("Plain HTTP marketplace sources are not allowed. Use HTTPS.")] };
  }

  // git@ ssh style
  if (input.startsWith("git@")) {
    return { success: true, source: withRef("git", input) };
  }

  // https:// ... .git
  if (input.startsWith("https://") && input.endsWith(".git")) {
    return { success: true, source: withRef("git", input) };
  }

  // ssh:// or git://
  if (input.startsWith("ssh://") || input.startsWith("git://")) {
    return { success: true, source: withRef("git", input) };
  }

  // GitHub shorthand owner/repo (no slashes elsewhere, no spaces).
  if (/^[a-z0-9][a-z0-9.-]*\/[a-z0-9_.-]+$/i.test(input) && !input.includes("://")) {
    return { success: true, source: withRef("github", input) };
  }

  // https://.../marketplace.json (direct URL)
  if (input.startsWith("https://") && /marketplace\.json(\?.*)?$/i.test(input)) {
    return { success: true, source: withRef("url", input) };
  }

  // Local existing file named marketplace.json
  try {
    const abs = path.resolve(input);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile() && input.toLowerCase().endsWith("marketplace.json")) {
      return { success: true, source: withRef("local-file", abs) };
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return { success: true, source: withRef("local-folder", abs) };
    }
  } catch {
    // fall through to ambiguous error
  }

  // Ambiguous https URL (not .git, not marketplace.json)
  if (input.startsWith("https://")) {
    return {
      success: false,
      errors: [
        err(
          "Ambiguous HTTPS source. Use a URL ending in .git or a direct marketplace.json URL."
        ),
      ],
    };
  }

  return { success: false, errors: [err(`Unrecognized marketplace source: "${input}".`)] };
}
```

- [ ] **Step 4: Write the tests**

Create `test/vitest/utilitycode/pluginMarketplacePaths.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getPluginMarketplacesRoot,
  getPluginMarketplaceCacheRoot,
  getPluginMarketplaceManifestPath,
  assertPathInsideBase,
} from "@/service/pluginMarketplaces/pluginMarketplacePaths";
import * as path from "path";

describe("pluginMarketplacePaths", () => {
  it("nests under userData/plugins/marketplaces", () => {
    expect(getPluginMarketplacesRoot()).toEqual(
      expect.stringContaining(path.join("plugins", "marketplaces"))
    );
  });

  it("cache root is namespaced by marketplace name", () => {
    expect(getPluginMarketplaceCacheRoot("team-tools")).toEqual(
      expect.stringContaining(path.join("cache", "team-tools"))
    );
  });

  it("manifest path uses .claude-plugin/marketplace.json", () => {
    expect(getPluginMarketplaceManifestPath("team-tools")).toEqual(
      expect.stringContaining(path.join(".claude-plugin", "marketplace.json"))
    );
  });

  it("assertPathInsideBase allows nested paths", () => {
    const base = "/tmp/mkt";
    expect(() => assertPathInsideBase(base, path.join(base, "plugins", "x"))).not.toThrow();
  });

  it("assertPathInsideBase rejects traversal", () => {
    const base = "/tmp/mkt";
    expect(() => assertPathInsideBase(base, "/tmp/elsewhere")).toThrow();
    expect(() => assertPathInsideBase(base, path.join(base, "..", "escape"))).toThrow();
  });
});
```

Create `test/vitest/utilitycode/parseMarketplaceSource.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseMarketplaceSource } from "@/service/pluginMarketplaces/parseMarketplaceSource";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("parseMarketplaceSource", () => {
  it("owner/repo -> github", () => {
    const r = parseMarketplaceSource("owner/repo");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("github");
  });

  it("https .git -> git", () => {
    const r = parseMarketplaceSource("https://gitlab.com/team/plugins.git");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("git");
  });

  it("git@ -> git", () => {
    const r = parseMarketplaceSource("git@github.com:team/plugins.git");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("git");
  });

  it("https marketplace.json -> url", () => {
    const r = parseMarketplaceSource("https://example.com/marketplace.json");
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("url");
  });

  it("local folder -> local-folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-src-"));
    const r = parseMarketplaceSource(dir);
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("local-folder");
  });

  it("local marketplace.json file -> local-file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-file-"));
    const file = path.join(dir, "marketplace.json");
    fs.writeFileSync(file, "{}");
    const r = parseMarketplaceSource(file);
    expect(r.success).toBe(true);
    if (r.success) expect(r.source.kind).toBe("local-file");
  });

  it("rejects http://", () => {
    expect(parseMarketplaceSource("http://insecure.com/m.json").success).toBe(false);
  });

  it("rejects CRLF", () => {
    expect(parseMarketplaceSource("owner/repo\r\n--config=evil").success).toBe(false);
  });

  it("rejects ambiguous https", () => {
    expect(parseMarketplaceSource("https://example.com/something").success).toBe(false);
  });

  it("threads optional ref", () => {
    const r = parseMarketplaceSource("owner/repo", "main");
    if (r.success) expect(r.source.ref).toBe("main");
  });
});
```

Create `test/vitest/utilitycode/pluginMarketplaceValidation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateMarketplaceManifest } from "@/service/pluginMarketplaces/pluginMarketplaceValidation";

const VALID = {
  name: "team-tools",
  owner: { name: "Team" },
  plugins: [
    {
      name: "lead-research",
      version: "1.0.0",
      source: "./plugins/lead-research",
    },
  ],
};

describe("validateMarketplaceManifest", () => {
  it("accepts a valid manifest and preserves unknown fields", () => {
    const r = validateMarketplaceManifest(JSON.stringify({ ...VALID, extra: 1 }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.manifest.plugins[0].name).toBe("lead-research");
      expect((r.manifest as { extra?: number }).extra).toBe(1);
    }
  });

  it("rejects invalid JSON", () => {
    const r = validateMarketplaceManifest("{not json");
    expect(r.success).toBe(false);
  });

  it("rejects bad marketplace name", () => {
    const r = validateMarketplaceManifest(JSON.stringify({ ...VALID, name: "Bad Name" }));
    expect(r.success).toBe(false);
  });

  it("rejects duplicate plugin entry names", () => {
    const dup = {
      ...VALID,
      plugins: [
        { name: "dup", source: "./a" },
        { name: "dup", source: "./b" },
      ],
    };
    const r = validateMarketplaceManifest(JSON.stringify(dup));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === "marketplace-plugin-entry-invalid")).toBe(true);
  });

  it("rejects relative source not starting with ./", () => {
    const bad = { ...VALID, plugins: [{ name: "p", source: "plugins/x" }] };
    const r = validateMarketplaceManifest(JSON.stringify(bad));
    expect(r.success).toBe(false);
  });

  it("accepts github entry source with sha", () => {
    const m = {
      ...VALID,
      plugins: [
        { name: "p", source: { source: "github", repo: "o/r", sha: "a".repeat(40) } },
      ],
    };
    const r = validateMarketplaceManifest(JSON.stringify(m));
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplacePaths.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/parseMarketplaceSource.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceValidation.test.ts
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/service/pluginMarketplaces/pluginMarketplacePaths.ts \
        src/service/pluginMarketplaces/pluginMarketplaceValidation.ts \
        src/service/pluginMarketplaces/parseMarketplaceSource.ts \
        test/vitest/utilitycode/pluginMarketplacePaths.test.ts \
        test/vitest/utilitycode/parseMarketplaceSource.test.ts \
        test/vitest/utilitycode/pluginMarketplaceValidation.test.ts
git commit -m "feat(plugin): add marketplace paths, validation, and source parser"
```

## Task 5: Marketplace fetchers

Mirror the plugin source fetchers' safety posture (`shell: false`, swallow stderr, reject `http://`, 60s timeout, directory limits) but the target is a `marketplace.json`, not a plugin package. Marketplace fetchers expose `fetch()` (distinct from the plugin fetchers' `acquire()`) because the result is a manifest, not a plugin root.

**Files:**
- Create: `src/service/pluginMarketplaces/marketplaceFetcherTypes.ts`
- Create: `src/service/pluginMarketplaces/GitMarketplaceFetcher.ts`
- Create: `src/service/pluginMarketplaces/GitHubMarketplaceFetcher.ts`
- Create: `src/service/pluginMarketplaces/LocalMarketplaceFetcher.ts`
- Create: `src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts`
- Create: `src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts`

(No dedicated unit tests here — the fetchers are exercised through the service integration test in Task 7 with injected seams. The pure logic — source parsing, manifest location rules — is already covered in Task 4.)

- [ ] **Step 1: Fetcher contract + result types**

Create `src/service/pluginMarketplaces/marketplaceFetcherTypes.ts`:

```typescript
import type {
  PluginMarketplaceError,
  PluginMarketplaceSource,
  PluginMarketplaceSourceKind,
} from "@/entityTypes/pluginMarketplaceTypes";

export interface PluginMarketplaceFetchRequest {
  readonly source: PluginMarketplaceSource;
  readonly onProgress?: (msg: string, pct?: number) => void;
}

export interface FetchedPluginMarketplace {
  /** Absolute path to the marketplace root (repo root or cache dir). */
  readonly marketplaceRoot: string;
  /** Absolute path to the located marketplace.json. */
  readonly manifestPath: string;
  /** Raw manifest JSON string. */
  readonly manifestJson: string;
  /** Caller MUST invoke after persist/rollback, even on failure. */
  readonly cleanup: () => Promise<void>;
}

export type PluginMarketplaceFetchResult =
  | { success: true; marketplace: FetchedPluginMarketplace }
  | { success: false; errors: readonly PluginMarketplaceError[] };

export interface PluginMarketplaceFetcher {
  readonly kind: PluginMarketplaceSourceKind;
  fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult>;
}

export function mktErr(
  code: PluginMarketplaceError["code"],
  message: string,
  extras: Partial<PluginMarketplaceError> = {}
): PluginMarketplaceError {
  return { code, message, recoverable: false, ...extras };
}
```

- [ ] **Step 2: Git fetcher**

Create `src/service/pluginMarketplaces/GitMarketplaceFetcher.ts`. It mirrors `GitPluginFetcher` (injectable `SpawnFn`, `shell: false`, 60s timeout, swallow stdout/stderr) but locates `marketplace.json` instead of `plugin.json`.

```typescript
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn as realSpawn } from "child_process";
import { redactUri } from "@/service/pluginSources/pluginSourceRedact";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

const DEFAULT_TIMEOUT_MS = 60_000;

export interface SpawnChildLike {
  on(event: "close", cb: (e?: { code: number }) => void): unknown;
  on(event: "error", cb: (e: Error) => void): unknown;
  stderr: { on(ev: "data", cb: (chunk: Buffer) => void): unknown };
  stdout: { on(ev: "data", cb: (chunk: Buffer) => void): unknown };
  kill(signal?: NodeJS.Signals): boolean;
}
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv }
) => SpawnChildLike;

/** Locate the marketplace manifest: .claude-plugin/marketplace.json or ./marketplace.json. */
export function locateMarketplaceManifest(root: string): string | null {
  const candidates = [
    path.join(root, ".claude-plugin", "marketplace.json"),
    path.join(root, "marketplace.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export class GitMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "git" as const;

  constructor(private readonly spawnFn: SpawnFn = defaultSpawn) {}

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const uri = req.source.uri?.trim();
    if (!uri) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", "git source requires a uri.")] };
    }
    if (uri.startsWith("http://")) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", "Plain HTTP git URLs are not allowed.")] };
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-git-"));
    const target = path.join(tmp, "repo");
    const args = ["clone", "--depth", "1"];
    if (req.source.ref) args.push("--branch", req.source.ref);
    args.push(uri, target);

    await runUntilSettled(this.spawnFn("git", args, { cwd: tmp, env: process.env }), DEFAULT_TIMEOUT_MS);

    if (!fs.existsSync(target)) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        success: false,
        errors: [mktErr("marketplace-fetch-failed", `git clone failed for ${redactUri(uri)}.`)],
      };
    }

    const manifestPath = locateMarketplaceManifest(target);
    if (!manifestPath) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return {
        success: false,
        errors: [mktErr("marketplace-manifest-not-found", "No .claude-plugin/marketplace.json found in repository.")],
      };
    }

    const manifestJson = fs.readFileSync(manifestPath, "utf-8");
    return {
      success: true,
      marketplace: {
        marketplaceRoot: target,
        manifestPath,
        manifestJson,
        cleanup: async () => {
          try {
            fs.rmSync(tmp, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}

function runUntilSettled(child: SpawnChildLike, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* best-effort */
      }
      finish();
    }, timeoutMs);
    child.stderr?.on("data", () => {
      /* swallow — stderr may contain auth hints */
    });
    child.stdout?.on("data", () => {
      /* swallow */
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish();
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function defaultSpawn(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv }
): SpawnChildLike {
  return realSpawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  }) as unknown as SpawnChildLike;
}
```

- [ ] **Step 3: GitHub fetcher (delegates to git)**

Create `src/service/pluginMarketplaces/GitHubMarketplaceFetcher.ts`:

```typescript
import type {
  PluginMarketplaceFetchResult,
  PluginMarketplaceFetcher,
  PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";
import { GitMarketplaceFetcher } from "./GitMarketplaceFetcher";

/**
 * GitHub shorthand owner/repo -> https://github.com/owner/repo.git -> git fetch.
 * Relies on the user's git credential helper / SSH agent for private repos.
 */
export class GitHubMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "github" as const;

  constructor(private readonly git: GitMarketplaceFetcher = new GitMarketplaceFetcher()) {}

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const repo = req.source.uri.trim();
    // Convert owner/repo to a cloneable URL.
    const uri = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9_.-]+$/i.test(repo)
      ? `https://github.com/${repo}.git`
      : repo;
    return this.git.fetch({
      ...req,
      source: { ...req.source, kind: "git", uri },
    });
  }
}
```

- [ ] **Step 4: Local fetcher (folder/file)**

Create `src/service/pluginMarketplaces/LocalMarketplaceFetcher.ts`. For folders we copy the whole folder into cache (so relative plugin entries keep working). For a single file, we copy only the manifest and mark relative entries unsupported later (URL-style behavior).

```typescript
import * as fs from "fs";
import * as path from "path";
import { applyDirectoryLimits } from "@/service/pluginSources/pluginSourceLimits";
import { getPluginsRoot } from "@/service/pluginPaths";
import {
  getPluginMarketplaceCacheRoot,
  getPluginMarketplaceTempRoot,
} from "./pluginMarketplacePaths";
import { locateMarketplaceManifest } from "./GitMarketplaceFetcher";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

export class LocalMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "local-folder" as const; // also handles local-file

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const src = req.source.uri;
    if (!src || !fs.existsSync(src)) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", `Path not found: ${src ?? "(none)"}`)] };
    }

    const stat = fs.statSync(src);
    const resolvedRoot = path.resolve(src);
    const pluginsRoot = path.resolve(getPluginsRoot());
    if (resolvedRoot === pluginsRoot || resolvedRoot.startsWith(pluginsRoot + path.sep)) {
      return {
        success: false,
        errors: [mktErr("marketplace-source-invalid", "Marketplace source must not live inside the plugins cache.")],
      };
    }

    // For local-file, just read the manifest; no repo root => relative entries unsupported.
    if (stat.isFile()) {
      const manifestJson = fs.readFileSync(resolvedRoot, "utf-8");
      return {
        success: true,
        marketplace: {
          marketplaceRoot: path.dirname(resolvedRoot),
          manifestPath: resolvedRoot,
          manifestJson,
          cleanup: async () => {
            /* user-owned file — do not delete */
          },
        },
      };
    }

    // local-folder: enforce limits, then copy into cache.
    const limits = applyDirectoryLimits(resolvedRoot);
    if (!limits.ok) {
      const msg =
        limits.reason === "too-many-files"
          ? `Marketplace folder has too many files (${limits.fileCount}).`
          : `Marketplace folder is too large (${limits.totalBytes.toString()} bytes).`;
      return { success: false, errors: [mktErr("marketplace-source-invalid", msg)] };
    }

    const manifestPath = locateMarketplaceManifest(resolvedRoot);
    if (!manifestPath) {
      return {
        success: false,
        errors: [mktErr("marketplace-manifest-not-found", "No .claude-plugin/marketplace.json found in folder.")],
      };
    }

    const nameGuess = path.basename(resolvedRoot);
    const dest = path.join(getPluginMarketplaceTempRoot(), `${nameGuess}-${Date.now()}`);
    fs.mkdirSync(dest, { recursive: true });
    try {
      copyDirSync(resolvedRoot, dest);
    } catch (e: unknown) {
      fs.rmSync(dest, { recursive: true, force: true });
      return {
        success: false,
        errors: [
          mktErr("marketplace-fetch-failed", e instanceof Error ? e.message : "Failed to copy marketplace folder."),
        ],
      };
    }

    const copiedManifest = locateMarketplaceManifest(dest) ?? path.join(dest, "marketplace.json");
    const manifestJson = fs.readFileSync(copiedManifest, "utf-8");
    return {
      success: true,
      marketplace: {
        marketplaceRoot: dest,
        manifestPath: copiedManifest,
        manifestJson,
        cleanup: async () => {
          try {
            fs.rmSync(dest, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}
```

> Note: `getPluginMarketplaceCacheRoot` is imported for future use by the service's atomic cache write (Task 7); the fetcher itself writes to the temp root.

- [ ] **Step 5: URL fetcher**

Create `src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts`:

```typescript
import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { getPluginMarketplaceTempRoot } from "./pluginMarketplacePaths";
import {
  mktErr,
  type PluginMarketplaceFetchResult,
  type PluginMarketplaceFetcher,
  type PluginMarketplaceFetchRequest,
} from "./marketplaceFetcherTypes";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export class UrlMarketplaceFetcher implements PluginMarketplaceFetcher {
  readonly kind = "url" as const;

  async fetch(req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
    const url = req.source.uri?.trim();
    if (!url || !url.startsWith("https://")) {
      return { success: false, errors: [mktErr("marketplace-source-invalid", "Only HTTPS marketplace URLs are allowed.")] };
    }

    const destDir = fs.mkdtempSync(path.join(getPluginMarketplaceTempRoot(), "mkt-url-"));
    const dest = path.join(destDir, "marketplace.json");

    const ok = await downloadTo(url, dest);
    if (!ok) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return { success: false, errors: [mktErr("marketplace-fetch-failed", "Failed to download marketplace.json.")] };
    }

    const manifestJson = fs.readFileSync(dest, "utf-8");
    return {
      success: true,
      marketplace: {
        // No repo root for URL sources: relative plugin entries are unsupported.
        marketplaceRoot: destDir,
        manifestPath: dest,
        manifestJson,
        cleanup: async () => {
          try {
            fs.rmSync(destDir, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        },
      },
    };
  }
}

function downloadTo(url: string, dest: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let redirects = 0;
    let aborted = false;
    const done = (ok: boolean) => {
      if (!aborted) {
        aborted = true;
        resolve(ok);
      }
    };
    const req = (target: string) => {
      const r = https.get(target, { timeout: TIMEOUT_MS }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (++redirects > 5) return done(false);
          res.destroy();
          req(res.headers.location);
          return;
        }
        if (!res.statusCode || res.statusCode !== 200) {
          res.destroy();
          return done(false);
        }
        const out = fs.createWriteStream(dest);
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            r.destroy();
            out.destroy();
            try {
              fs.rmSync(dest, { force: true });
            } catch {
              /* ignore */
            }
            done(false);
          }
        });
        res.pipe(out);
        out.on("finish", () => done(true));
        out.on("error", () => done(false));
      });
      r.on("error", () => done(false));
      r.on("timeout", () => {
        if (!aborted) {
          aborted = true;
          r.destroy(new Error("Request timed out"));
        }
      });
    };
    req(url);
  });
}
```

- [ ] **Step 6: Registry**

Create `src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts`:

```typescript
import type { PluginMarketplaceSourceKind } from "@/entityTypes/pluginMarketplaceTypes";
import type { PluginMarketplaceFetcher } from "./marketplaceFetcherTypes";
import { GitMarketplaceFetcher } from "./GitMarketplaceFetcher";
import { GitHubMarketplaceFetcher } from "./GitHubMarketplaceFetcher";
import { LocalMarketplaceFetcher } from "./LocalMarketplaceFetcher";
import { UrlMarketplaceFetcher } from "./UrlMarketplaceFetcher";

export class PluginMarketplaceFetcherRegistry {
  private readonly fetchers = new Map<PluginMarketplaceSourceKind, PluginMarketplaceFetcher>();

  register(fetcher: PluginMarketplaceFetcher): void {
    this.fetchers.set(fetcher.kind, fetcher);
  }

  get(kind: PluginMarketplaceSourceKind): PluginMarketplaceFetcher {
    const f = this.fetchers.get(kind);
    if (!f) {
      throw new Error(`No fetcher registered for marketplace source kind "${kind}"`);
    }
    return f;
  }
}

export function createDefaultMarketplaceFetcherRegistry(): PluginMarketplaceFetcherRegistry {
  const reg = new PluginMarketplaceFetcherRegistry();
  const git = new GitMarketplaceFetcher();
  reg.register(git);
  reg.register(new GitHubMarketplaceFetcher(git));
  const local = new LocalMarketplaceFetcher();
  reg.register(local);
  reg.register(local); // local-file reuses LocalMarketplaceFetcher
  reg.register(new UrlMarketplaceFetcher());
  return reg;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/service/pluginMarketplaces/marketplaceFetcherTypes.ts \
        src/service/pluginMarketplaces/GitMarketplaceFetcher.ts \
        src/service/pluginMarketplaces/GitHubMarketplaceFetcher.ts \
        src/service/pluginMarketplaces/LocalMarketplaceFetcher.ts \
        src/service/pluginMarketplaces/UrlMarketplaceFetcher.ts \
        src/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry.ts
git commit -m "feat(plugin): add marketplace catalog fetchers"
```

---

## Task 6: Entry source resolver

Converts a validated `PluginMarketplaceEntry` into a `PluginSourceRequest` + `MarketplaceInstallMeta`, applying the path-traversal guard for relative sources. `git-subdir` returns unsupported (Phase 2).

**Files:**
- Create: `src/service/pluginMarketplaces/resolveMarketplaceEntrySource.ts`
- Test: `test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveMarketplaceEntrySource } from "@/service/pluginMarketplaces/resolveMarketplaceEntrySource";
import type {
  PluginMarketplaceEntry,
  PluginMarketplaceSource,
} from "@/entityTypes/pluginMarketplaceTypes";

const ctx = (root: string) => ({
  marketplaceName: "team-tools",
  marketplaceRoot: root,
  marketplaceSource: { kind: "git", uri: "https://example.com/mkt.git" } as PluginMarketplaceSource,
  marketplaceVersion: "1.0.0",
});

describe("resolveMarketplaceEntrySource", () => {
  it("resolves a relative source inside root to local-folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-resolve-"));
    const pluginDir = path.join(root, "plugins", "foo");
    fs.mkdirSync(pluginDir, { recursive: true });
    const entry = { name: "foo", source: "./plugins/foo" } as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx(root));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.resolved.request.kind).toBe("local-folder");
      expect(r.resolved.request.folderPath).toBe(pluginDir);
      expect(r.resolved.request.source).toBe("marketplace");
    }
  });

  it("rejects relative source that escapes root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-resolve-"));
    const entry = { name: "bad", source: "./../escape" } as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx(root));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some((e) => e.code === "marketplace-plugin-source-outside-root")).toBe(true);
    }
  });

  it("converts github source to github request, sha over ref", () => {
    const entry = {
      name: "g",
      source: { source: "github", repo: "o/r", ref: "main", sha: "a".repeat(40) },
    } as unknown as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx("/tmp"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.resolved.request.kind).toBe("github");
      expect(r.resolved.request.ref).toBe("a".repeat(40));
    }
  });

  it("converts npm source", () => {
    const entry = {
      name: "n",
      source: { source: "npm", package: "pkg", version: "1.0.0" },
    } as unknown as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx("/tmp"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.resolved.request.kind).toBe("npm");
      expect(r.resolved.request.npmPackage).toBe("pkg");
    }
  });

  it("returns unsupported for git-subdir", () => {
    const entry = {
      name: "s",
      source: { source: "git-subdir", url: "https://x.git", path: "p" },
    } as unknown as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx("/tmp"));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some((e) => e.code === "marketplace-plugin-source-unsupported")).toBe(true);
    }
  });

  it("rejects relative source when root has no filesystem tree (URL marketplace)", () => {
    // Simulate a URL marketplace: pass a context whose root does not exist.
    const entry = { name: "x", source: "./plugins/x" } as PluginMarketplaceEntry;
    const urlCtx = {
      ...ctx("/this/path/does/not/exist"),
      marketplaceSource: { kind: "url", uri: "https://example.com/marketplace.json" } as PluginMarketplaceSource,
    };
    const r = resolveMarketplaceEntrySource(entry, urlCtx);
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `src/service/pluginMarketplaces/resolveMarketplaceEntrySource.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type { PluginSourceKind } from "@/entityTypes/pluginTypes";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";
import type {
  MarketplaceInstallMeta,
  PluginMarketplaceEntry,
  PluginMarketplaceError,
  PluginMarketplaceMetadata,
  PluginMarketplaceSource,
} from "@/entityTypes/pluginMarketplaceTypes";
import { assertPathInsideBase } from "./pluginMarketplacePaths";

export interface MarketplaceEntryResolutionContext {
  readonly marketplaceName: string;
  readonly marketplaceRoot: string;
  readonly marketplaceSource: PluginMarketplaceSource;
  readonly marketplaceVersion?: string;
  readonly metadata?: PluginMarketplaceMetadata;
}

export interface ResolvedMarketplacePluginSource {
  readonly request: PluginSourceRequest;
  readonly meta: MarketplaceInstallMeta;
  readonly warnings: readonly PluginMarketplaceError[];
}

export type ResolveResult =
  | { success: true; resolved: ResolvedMarketplacePluginSource }
  | { success: false; errors: PluginMarketplaceError[] };

function err(
  code: PluginMarketplaceError["code"],
  message: string,
  pluginName?: string
): PluginMarketplaceError {
  return { code, message, recoverable: false, ...(pluginName ? { pluginName } : {}) };
}

/** metadata.pluginRoot may relocate the plugin root within the marketplace. */
function resolvePluginRoot(marketplaceRoot: string, pluginRoot?: string): string {
  if (!pluginRoot) return marketplaceRoot;
  const candidate = path.resolve(marketplaceRoot, pluginRoot);
  try {
    assertPathInsideBase(marketplaceRoot, candidate);
  } catch {
    return marketplaceRoot;
  }
  return candidate;
}

export function resolveMarketplaceEntrySource(
  entry: PluginMarketplaceEntry,
  context: MarketplaceEntryResolutionContext
): ResolveResult {
  const baseRoot = resolvePluginRoot(context.marketplaceRoot, context.metadata?.pluginRoot);
  const resolvedAt = new Date().toISOString();
  const buildMeta = (resolved: {
    resolvedSourceKind: PluginSourceKind;
    resolvedSourceUri?: string;
    resolvedSourceRef?: string;
  }): MarketplaceInstallMeta => ({
    marketplaceName: context.marketplaceName,
    marketplaceSource: context.marketplaceSource,
    ...(context.marketplaceVersion ? { marketplaceVersion: context.marketplaceVersion } : {}),
    entryName: entry.name,
    ...(entry.version ? { entryVersion: entry.version } : {}),
    entrySource: entry.source,
    ...resolved,
    resolvedAt,
  });

  // Relative string source -> local-folder, must stay inside root AND exist.
  if (typeof entry.source === "string") {
    if (!context.marketplaceSource || context.marketplaceSource.kind === "url") {
      return {
        success: false,
        errors: [err("marketplace-plugin-source-unsupported", "Relative plugin sources require a marketplace repository root.", entry.name)],
      };
    }
    try {
      const candidate = path.resolve(baseRoot, entry.source);
      assertPathInsideBase(baseRoot, candidate);
      if (!fs.existsSync(candidate)) {
        return { success: false, errors: [err("marketplace-plugin-source-outside-root", `Plugin path does not exist: ${entry.source}`, entry.name)] };
      }
      const realBase = fs.realpathSync(baseRoot);
      const realCandidate = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
      assertPathInsideBase(realBase, realCandidate);
      const request: PluginSourceRequest = {
        kind: "local-folder",
        folderPath: realCandidate,
        source: "marketplace",
      };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({ resolvedSourceKind: "local-folder", resolvedSourceUri: realCandidate }),
          warnings: [],
        },
      };
    } catch {
      return { success: false, errors: [err("marketplace-plugin-source-outside-root", `Plugin source escapes marketplace root: ${entry.source}`, entry.name)] };
    }
  }

  // Object sources.
  switch (entry.source.source) {
    case "github": {
      const ref = entry.source.sha ?? entry.source.ref;
      const uri = `https://github.com/${entry.source.repo}`;
      const request: PluginSourceRequest = {
        kind: "github",
        uri,
        ...(ref ? { ref } : {}),
        source: "marketplace",
      };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({ resolvedSourceKind: "github", resolvedSourceUri: uri, resolvedSourceRef: ref }),
          warnings: [],
        },
      };
    }
    case "url": {
      const url = entry.source.url;
      const ref = entry.source.sha ?? entry.source.ref;
      const isGit = url.endsWith(".git") || url.startsWith("git@") || url.startsWith("ssh://");
      const isGithub = /^https:\/\/github\.com\//i.test(url);
      const kind: PluginSourceKind = isGithub ? "github" : isGit ? "git" : "url";
      const request: PluginSourceRequest = { kind, uri: url, ...(ref ? { ref } : {}), source: "marketplace" };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({ resolvedSourceKind: kind, resolvedSourceUri: url, resolvedSourceRef: ref }),
          warnings: [],
        },
      };
    }
    case "npm": {
      const request: PluginSourceRequest = {
        kind: "npm",
        npmPackage: entry.source.package,
        ...(entry.source.version ? { npmVersion: entry.source.version } : {}),
        ...(entry.source.registry ? { npmRegistry: entry.source.registry } : {}),
        source: "marketplace",
      };
      return {
        success: true,
        resolved: {
          request,
          meta: buildMeta({
            resolvedSourceKind: "npm",
            resolvedSourceUri: entry.source.package,
            resolvedSourceRef: entry.source.version,
          }),
          warnings: [],
        },
      };
    }
    case "git-subdir":
      return {
        success: false,
        errors: [err("marketplace-plugin-source-unsupported", "git-subdir plugin sources are not supported in MVP.", entry.name)],
      };
    default:
      return { success: false, errors: [err("marketplace-plugin-source-unsupported", "Unrecognized plugin entry source.", entry.name)] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/pluginMarketplaces/resolveMarketplaceEntrySource.ts \
        test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts
git commit -m "feat(plugin): resolve marketplace plugin entries into install requests"
```

## Task 7: PluginMarketplaceService

Orchestrates everything: parse → fetch → validate → atomic cache write → persist; and resolve → install. Dependencies are constructor-injected so the test can pass mocks.

**Files:**
- Create: `src/service/PluginMarketplaceService.ts`
- Test: `test/vitest/utilitycode/pluginMarketplaceService.test.ts`

- [ ] **Step 1: Write the failing test (mocked module + fetcher + install service)**

Create `test/vitest/utilitycode/pluginMarketplaceService.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock the DB-facing module so no real SQLite is touched.
vi.mock("@/modules/PluginMarketplaceModule", () => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    PluginMarketplaceModule: class {
      async listEnabledMarketplaces() {
        return Array.from(store.values());
      }
      async getMarketplaceByName(name: string) {
        return store.get(name) ?? null;
      }
      async createMarketplace(input: Record<string, unknown>) {
        store.set(input.name as string, { ...input, enabled: 1, health: "healthy" });
        return store.size;
      }
      async updateMarketplaceState(input: Record<string, unknown> & { name: string }) {
        const cur = store.get(input.name) ?? {};
        store.set(input.name, { ...cur, ...input });
        return true;
      }
      async removeMarketplace(name: string) {
        return store.delete(name);
      }
    },
  };
});

import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";
import type {
  PluginMarketplaceFetchRequest,
  PluginMarketplaceFetchResult,
  PluginMarketplaceFetcher,
} from "@/service/pluginMarketplaces/marketplaceFetcherTypes";

const VALID_MANIFEST = JSON.stringify({
  name: "team-tools",
  owner: { name: "Team" },
  plugins: [{ name: "lead-research", version: "1.0.0", source: "./plugins/lead-research" }],
});

function fakeFetcher(root: string): PluginMarketplaceFetcher {
  return {
    kind: "local-folder",
    async fetch(_req: PluginMarketplaceFetchRequest): Promise<PluginMarketplaceFetchResult> {
      return {
        success: true,
        marketplace: {
          marketplaceRoot: root,
          manifestPath: `${root}/marketplace.json`,
          manifestJson: VALID_MANIFEST,
          cleanup: async () => {
            /* noop */
          },
        },
      };
    },
  };
}

describe("PluginMarketplaceService", () => {
  it("adds a marketplace via the local-folder fetcher", async () => {
    const svc = new PluginMarketplaceService(undefined as never, undefined as never, fakeFetcher("/tmp/mkt"));
    const sum = await svc.addMarketplace({ source: "/some/folder" });
    expect(sum.name).toBe("team-tools");
    expect(sum.pluginCount).toBe(1);
    expect(sum.health).toBe("healthy");
  });

  it("rejects add when fetch fails", async () => {
    const bad: PluginMarketplaceFetcher = {
      kind: "local-folder",
      async fetch() {
        return { success: false, errors: [{ code: "marketplace-fetch-failed", message: "boom", recoverable: false }] };
      },
    };
    const svc = new PluginMarketplaceService(undefined as never, undefined as never, bad);
    await expect(svc.addMarketplace({ source: "/x" })).rejects.toThrow();
  });

  it("lists available plugins from cached manifest", async () => {
    const svc = new PluginMarketplaceService(undefined as never, undefined as never, fakeFetcher("/tmp/mkt"));
    await svc.addMarketplace({ source: "/some/folder" });
    const plugins = await svc.listAvailablePlugins({});
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toBe("lead-research");
    expect(plugins[0].marketplaceName).toBe("team-tools");
    // Relative source in a real-rooted marketplace is supported.
    expect(["not_installed", "installed", "different_version"]).toContain(plugins[0].status);
  });

  it("removing a marketplace does not touch installed plugins", async () => {
    const svc = new PluginMarketplaceService(undefined as never, undefined as never, fakeFetcher("/tmp/mkt"));
    await svc.addMarketplace({ source: "/some/folder" });
    await expect(svc.removeMarketplace("team-tools")).resolves.toBeUndefined();
    expect(await svc.getMarketplace("team-tools")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceService.test.ts`
Expected: FAIL — `@/service/PluginMarketplaceService` not found.

- [ ] **Step 3: Implement the service**

Create `src/service/PluginMarketplaceService.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import { PluginMarketplaceModule } from "@/modules/PluginMarketplaceModule";
import { PluginManagementModule } from "@/modules/PluginManagementModule";
import { PluginInstallService } from "@/service/PluginInstallService";
import { redactMessage } from "@/service/pluginSources/pluginSourceRedact";
import type { PluginSummary } from "@/entityTypes/pluginTypes";
import type {
  AddPluginMarketplaceRequest,
  InstallMarketplacePluginRequest,
  MarketplaceInstallMeta,
  PluginMarketplaceCapabilitySummary,
  PluginMarketplaceDetail,
  PluginMarketplaceError,
  PluginMarketplaceHealth,
  PluginMarketplaceManifest,
  PluginMarketplacePluginDetail,
  PluginMarketplacePluginFilter,
  PluginMarketplacePluginSummary,
  PluginMarketplaceSource,
  PluginMarketplaceSourceKind,
  PluginMarketplaceSummary,
} from "@/entityTypes/pluginMarketplaceTypes";
import { parseMarketplaceSource } from "@/service/pluginMarketplaces/parseMarketplaceSource";
import { validateMarketplaceManifest } from "@/service/pluginMarketplaces/pluginMarketplaceValidation";
import {
  createDefaultMarketplaceFetcherRegistry,
  PluginMarketplaceFetcherRegistry,
} from "@/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry";
import type { PluginMarketplaceFetcher } from "@/service/pluginMarketplaces/marketplaceFetcherTypes";
import { resolveMarketplaceEntrySource } from "@/service/pluginMarketplaces/resolveMarketplaceEntrySource";
import { parsePluginIdentifier } from "@/service/pluginMarketplaces/parsePluginIdentifier";
import {
  getPluginMarketplaceCacheRoot,
  getPluginMarketplacesRoot,
} from "@/service/pluginMarketplaces/pluginMarketplacePaths";

/**
 * Orchestrates marketplace add/list/get/refresh/remove/discover/install.
 * All DB access goes through PluginMarketplaceModule. All installs delegate
 * to PluginInstallService. Never accesses TypeORM repositories directly.
 */
export class PluginMarketplaceService {
  constructor(
    private readonly marketplaceModule: PluginMarketplaceModule = new PluginMarketplaceModule(),
    private readonly installService: PluginInstallService = new PluginInstallService(),
    private readonly fetcher: PluginMarketplaceFetcher = createDefaultFetcherForService()
  ) {}

  // --- marketplace lifecycle ---

  async addMarketplace(req: AddPluginMarketplaceRequest): Promise<PluginMarketplaceSummary> {
    const parsed = parseMarketplaceSource(req.source, req.ref);
    if (!parsed.success) {
      throw new Error(parsed.errors.map((e) => e.message).join("; "));
    }
    const fetched = await this.fetcher.fetch({ source: parsed.source });
    if (!fetched.success) {
      throw new Error(fetched.errors.map((e) => e.message).join("; "));
    }

    const validation = validateMarketplaceManifest(fetched.marketplace.manifestJson);
    if (!validation.success) {
      await fetched.marketplace.cleanup();
      throw new Error(validation.errors.map((e) => e.message).join("; "));
    }
    const manifest = validation.manifest;

    const existing = await this.marketplaceModule.getMarketplaceByName(manifest.name);
    if (existing && !req.overwrite) {
      await fetched.marketplace.cleanup();
      throw new Error(`Marketplace "${manifest.name}" already exists. Use overwrite to replace it.`);
    }

    // Atomic cache write under cache/<manifest.name>.
    const cacheRoot = getPluginMarketplaceCacheRoot(manifest.name);
    const next = `${cacheRoot}.next-${Date.now()}`;
    fs.mkdirSync(next, { recursive: true });
    try {
      copyTree(fetched.marketplace.marketplaceRoot, next);
      // Ensure a marketplace.json sits at the cache root for URL-style lookups.
      const rootManifest = path.join(next, "marketplace.json");
      if (!fs.existsSync(rootManifest)) {
        fs.writeFileSync(rootManifest, fetched.marketplace.manifestJson, "utf-8");
      }
      // Swap: move old aside, rename next into place, drop old.
      const old = `${cacheRoot}.old`;
      try { fs.rmSync(old, { recursive: true, force: true }); } catch { /* ignore */ }
      if (fs.existsSync(cacheRoot)) fs.renameSync(cacheRoot, old);
      fs.mkdirSync(path.dirname(cacheRoot), { recursive: true });
      fs.renameSync(next, cacheRoot);
      try { fs.rmSync(old, { recursive: true, force: true }); } catch { /* ignore */ }
    } catch (e: unknown) {
      fs.rmSync(next, { recursive: true, force: true });
      await fetched.marketplace.cleanup();
      throw new Error(e instanceof Error ? e.message : "Failed to write marketplace cache.");
    } finally {
      await fetched.marketplace.cleanup();
    }

    const redactedUri = redactMessage(parsed.source.uri);
    const input = {
      name: manifest.name,
      displayName: manifest.owner?.name,
      ownerName: manifest.owner?.name ?? "unknown",
      ownerEmail: manifest.owner?.email,
      ownerUrl: manifest.owner?.url,
      description: manifest.description,
      version: manifest.version,
      sourceKind: parsed.source.kind as PluginMarketplaceEntitySourceKind,
      sourceUri: redactedUri,
      sourceRef: parsed.source.ref,
      installPath: cacheRoot,
      manifestJson: fetched.marketplace.manifestJson,
      pluginCount: manifest.plugins.length,
      enabled: 1,
      autoUpdate: 0,
      health: "healthy" as PluginMarketplaceHealth,
      lastFetchedAt: new Date(),
      sourceMetaJson: JSON.stringify({ rawSourceKind: parsed.source.kind }),
    };

    if (existing) {
      await this.marketplaceModule.updateMarketplaceState(input);
    } else {
      await this.marketplaceModule.createMarketplace(input);
    }
    const row = await this.marketplaceModule.getMarketplaceByName(manifest.name);
    return toSummary(row!);
  }

  async listMarketplaces(): Promise<PluginMarketplaceSummary[]> {
    const rows = await this.marketplaceModule.listMarketplaces();
    return rows.map(toSummary);
  }

  async getMarketplace(name: string): Promise<PluginMarketplaceDetail | null> {
    const row = await this.marketplaceModule.getMarketplaceByName(name);
    if (!row) return null;
    return toDetail(row);
  }

  async refreshMarketplace(name: string): Promise<PluginMarketplaceSummary> {
    const existing = await this.marketplaceModule.getMarketplaceByName(name);
    if (!existing) throw new Error(`Marketplace "${name}" not found.`);
    // Re-fetch using the stored source.
    const source: PluginMarketplaceSource = {
      kind: existing.sourceKind as PluginMarketplaceSourceKind,
      uri: existing.sourceUri,
      ...(existing.sourceRef ? { ref: existing.sourceRef } : {}),
    };
    const fetched = await this.fetcher.fetch({ source });
    if (!fetched.success) {
      // Keep previous good cache.
      await this.marketplaceModule.setMarketplaceErrors(name, fetched.errors);
      throw new Error(fetched.errors.map((e) => e.message).join("; "));
    }
    const validation = validateMarketplaceManifest(fetched.marketplace.manifestJson);
    if (!validation.success || validation.manifest.name !== name) {
      await fetched.marketplace.cleanup();
      await this.marketplaceModule.setMarketplaceErrors(name, validation.success
        ? [{ code: "marketplace-name-conflict", message: "Refreshed marketplace name changed.", recoverable: false }]
        : validation.errors);
      throw new Error("Refreshed marketplace is invalid or renamed; previous cache retained.");
    }
    // Re-run the add flow's cache write + persist by delegating back through addMarketplace.
    await fetched.marketplace.cleanup();
    return this.addMarketplace({ source: source.uri, ref: source.ref, overwrite: true });
  }

  async removeMarketplace(name: string): Promise<void> {
    const existing = await this.marketplaceModule.getMarketplaceByName(name);
    if (!existing) return;
    await this.marketplaceModule.removeMarketplace(name);
    // Best-effort cache removal. Installed plugins are LEFT intact (MVP).
    try {
      fs.rmSync(getPluginMarketplaceCacheRoot(name), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  // --- discover ---

  async listAvailablePlugins(
    filter: PluginMarketplacePluginFilter = {}
  ): Promise<PluginMarketplacePluginSummary[]> {
    const marketplaces = await this.marketplaceModule.listEnabledMarketplaces();
    const installedRows = await new PluginManagementModule().listInstalledPlugins();
    const installedByEntry = new Map<string, { version?: string }>();
    for (const row of installedRows) {
      try {
        const meta = JSON.parse(row.sourceMetaJson || "{}") as { marketplace?: { marketplaceName?: string; entryName?: string } };
        if (meta.marketplace?.marketplaceName && meta.marketplace?.entryName) {
          installedByEntry.set(`${meta.marketplace.entryName}@${meta.marketplace.marketplaceName}`, {
            version: row.version,
          });
        }
      } catch {
        /* ignore */
      }
    }

    const out: PluginMarketplacePluginSummary[] = [];
    for (const mp of marketplaces) {
      let manifest: PluginMarketplaceManifest;
      try {
        manifest = JSON.parse(mp.manifestJson);
      } catch {
        continue;
      }
      for (const entry of manifest.plugins ?? []) {
        const resolution = resolveMarketplaceEntrySource(entry, {
          marketplaceName: mp.name,
          marketplaceRoot: mp.installPath ?? "",
          marketplaceSource: {
            kind: mp.sourceKind as PluginMarketplaceSourceKind,
            uri: mp.sourceUri,
            ...(mp.sourceRef ? { ref: mp.sourceRef } : {}),
          },
          ...(mp.version ? { marketplaceVersion: mp.version } : {}),
          ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
        });
        const key = `${entry.name}@${mp.name}`;
        const inst = installedByEntry.get(key);
        const status = !resolution.success
          ? (resolution.errors.some((e) => e.code === "marketplace-plugin-source-unsupported") ? "unsupported" : "error")
          : !inst
            ? "not_installed"
            : inst.version && entry.version && inst.version !== entry.version
              ? "different_version"
              : "installed";
        out.push({
          pluginId: key,
          name: entry.name,
          ...(entry.displayName ? { displayName: entry.displayName } : {}),
          marketplaceName: mp.name,
          ...(mp.displayName ? { marketplaceDisplayName: mp.displayName } : {}),
          ...(entry.version ? { version: entry.version } : {}),
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.author ? { author: typeof entry.author === "string" ? entry.author : entry.author.name } : {}),
          ...(entry.category ? { category: entry.category } : {}),
          tags: entry.tags ?? [],
          sourceKind: typeof entry.source === "string" ? "relative" : entry.source.source,
          capabilitySummary: summarizeCapabilities(entry),
          installed: !!inst,
          ...(inst?.version ? { installedVersion: inst.version } : {}),
          status,
          errors: resolution.success ? [] : resolution.errors,
        });
      }
    }

    return applyFilterAndSort(out, filter);
  }

  async getAvailablePlugin(pluginId: string): Promise<PluginMarketplacePluginDetail | null> {
    const parsed = parsePluginIdentifier(pluginId);
    if (!parsed.ok || !parsed.value.marketplace) return null;
    const { name, marketplace } = parsed.value;
    const mp = await this.marketplaceModule.getMarketplaceByName(marketplace);
    if (!mp) return null;
    let manifest: PluginMarketplaceManifest;
    try {
      manifest = JSON.parse(mp.manifestJson);
    } catch {
      return null;
    }
    const entry = (manifest.plugins ?? []).find((p) => p.name === name);
    if (!entry) return null;
    const summaries = await this.listAvailablePlugins({ marketplaceName: marketplace });
    const summary = summaries.find((s) => s.pluginId === pluginId);
    if (!summary) return null;
    const resolution = resolveMarketplaceEntrySource(entry, {
      marketplaceName: mp.name,
      marketplaceRoot: mp.installPath ?? "",
      marketplaceSource: { kind: mp.sourceKind as PluginMarketplaceSourceKind, uri: mp.sourceUri, ...(mp.sourceRef ? { ref: mp.sourceRef } : {}) },
      ...(mp.version ? { marketplaceVersion: mp.version } : {}),
      ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
    });
    return {
      ...summary,
      ...(entry.homepage ? { homepage: entry.homepage } : {}),
      ...(entry.repository ? { repository: entry.repository } : {}),
      ...(entry.license ? { license: entry.license } : {}),
      entry,
      ...(resolution.success ? {
        resolvedSourceKind: resolution.resolved.meta.resolvedSourceKind,
        resolvedSourceUri: resolution.resolved.meta.resolvedSourceUri,
        resolvedSourceRef: resolution.resolved.meta.resolvedSourceRef,
        pinnedToCommit: typeof entry.source === "object" && !!entry.source.sha,
      } : { pinnedToCommit: false }),
    };
  }

  async installMarketplacePlugin(req: InstallMarketplacePluginRequest): Promise<PluginSummary> {
    const parsed = parsePluginIdentifier(req.pluginId);
    if (!parsed.ok || !parsed.value.marketplace) {
      throw new Error("Invalid plugin identifier. Use plugin-name@marketplace-name.");
    }
    const { name, marketplace } = parsed.value;
    const mp = await this.marketplaceModule.getMarketplaceByName(marketplace);
    if (!mp) throw new Error(`Marketplace "${marketplace}" not found.`);
    let manifest: PluginMarketplaceManifest;
    try {
      manifest = JSON.parse(mp.manifestJson);
    } catch {
      throw new Error("Marketplace manifest is corrupt.");
    }
    const entry = (manifest.plugins ?? []).find((p) => p.name === name);
    if (!entry) throw new Error(`Plugin "${name}" not found in marketplace "${marketplace}".`);

    const resolution = resolveMarketplaceEntrySource(entry, {
      marketplaceName: mp.name,
      marketplaceRoot: mp.installPath ?? "",
      marketplaceSource: { kind: mp.sourceKind as PluginMarketplaceSourceKind, uri: mp.sourceUri, ...(mp.sourceRef ? { ref: mp.sourceRef } : {}) },
      ...(mp.version ? { marketplaceVersion: mp.version } : {}),
      ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
    });
    if (!resolution.success) {
      throw new Error(resolution.errors.map((e) => e.message).join("; "));
    }

    const meta: MarketplaceInstallMeta = resolution.resolved.meta;
    const result = await this.installService.installFromSource({
      ...resolution.resolved.request,
      ...(req.overwrite !== undefined ? { overwrite: req.overwrite } : {}),
      ...(req.npmAuthToken ? { npmAuthToken: req.npmAuthToken } : {}),
      source: "marketplace",
      sourceMeta: { marketplace: meta },
    });
    if (!result.success) {
      throw new Error(result.errors.map((e) => e.message).join("; "));
    }
    return result.plugin;
  }
}

// --- helpers ---

type PluginMarketplaceEntitySourceKind = PluginMarketplaceSourceKind;

function createDefaultFetcherForService(): PluginMarketplaceFetcher {
  // Wrap the registry: pick the fetcher matching the parsed source kind at call time.
  const registry: PluginMarketplaceFetcherRegistry = createDefaultMarketplaceFetcherRegistry();
  return {
    kind: "local-folder",
    async fetch(req) {
      return registry.get(req.source.kind).fetch(req);
    },
  };
}

function toSummary(row: {
  id: number; name: string; displayName?: string | null; ownerName: string;
  description?: string | null; version?: string | null; sourceKind: string;
  sourceUri: string; sourceRef?: string | null; pluginCount: number;
  enabled: number; autoUpdate: number; health: string; lastFetchedAt?: Date | null; updatedAt?: Date | null;
}): PluginMarketplaceSummary {
  return {
    id: row.id,
    name: row.name,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ownerName: row.ownerName,
    ...(row.description ? { description: row.description } : {}),
    ...(row.version ? { version: row.version } : {}),
    sourceKind: row.sourceKind as PluginMarketplaceSourceKind,
    sourceUri: row.sourceUri,
    ...(row.sourceRef ? { sourceRef: row.sourceRef } : {}),
    pluginCount: row.pluginCount,
    enabled: row.enabled === 1,
    autoUpdate: row.autoUpdate === 1,
    health: row.health as PluginMarketplaceHealth,
    ...(row.lastFetchedAt ? { lastFetchedAt: new Date(row.lastFetchedAt).toISOString() } : {}),
    ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt).toISOString() } : {}),
  };
}

function toDetail(row: Parameters<typeof toSummary>[0] & {
  ownerEmail?: string | null; ownerUrl?: string | null; installPath?: string | null;
  manifestJson: string; lastErrorJson: string; sourceMetaJson: string;
}): PluginMarketplaceDetail {
  let manifest: PluginMarketplaceManifest = { name: row.name, owner: { name: row.ownerName }, plugins: [] };
  try { manifest = JSON.parse(row.manifestJson); } catch { /* keep default */ }
  let errors: PluginMarketplaceError[] = [];
  try { errors = JSON.parse(row.lastErrorJson); } catch { /* keep default */ }
  let sourceMeta: Record<string, unknown> = {};
  try { sourceMeta = JSON.parse(row.sourceMetaJson); } catch { /* keep default */ }
  return {
    ...toSummary(row),
    ...(row.ownerEmail ? { ownerEmail: row.ownerEmail } : {}),
    ...(row.ownerUrl ? { ownerUrl: row.ownerUrl } : {}),
    manifest,
    errors,
    ...(row.installPath ? { installPath: row.installPath } : {}),
    sourceMeta,
  };
}

function summarizeCapabilities(entry: { skills?: unknown; commands?: unknown; agents?: unknown; hooks?: unknown; mcpServers?: unknown; lspServers?: unknown; outputStyles?: unknown; experimental?: unknown }): PluginMarketplaceCapabilitySummary {
  const has = (v: unknown) => Array.isArray(v) ? v.length > 0 : !!v;
  return {
    hasSkills: has(entry.skills),
    hasCommands: has(entry.commands),
    hasAgents: has(entry.agents),
    hasHooks: has(entry.hooks),
    hasMcpServers: has(entry.mcpServers),
    hasLspServers: has(entry.lspServers),
    hasOutputStyles: has(entry.outputStyles),
    hasMonitors: has((entry.experimental as { monitors?: unknown } | undefined)?.monitors),
  };
}

function applyFilterAndSort(
  items: PluginMarketplacePluginSummary[],
  filter: PluginMarketplacePluginFilter
): PluginMarketplacePluginSummary[] {
  let out = items.slice();
  if (filter.search) {
    const q = filter.search.toLowerCase();
    out = out.filter((p) =>
      [p.name, p.displayName ?? "", p.description ?? "", p.author ?? "", p.category ?? "", p.marketplaceName, ...p.tags]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  if (filter.marketplaceName) out = out.filter((p) => p.marketplaceName === filter.marketplaceName);
  if (filter.category) out = out.filter((p) => p.category === filter.category);
  if (filter.installed !== undefined) out = out.filter((p) => p.installed === filter.installed);
  if (filter.hasSkills) out = out.filter((p) => p.capabilitySummary.hasSkills);
  if (filter.hasMcpServers) out = out.filter((p) => p.capabilitySummary.hasMcpServers);
  if (filter.hasHooks) out = out.filter((p) => p.capabilitySummary.hasHooks);
  out.sort((a, b) => {
    const ea = a.errors.length > 0 ? 1 : 0;
    const eb = b.errors.length > 0 ? 1 : 0;
    if (ea !== eb) return ea - eb;
    const ia = a.installed ? 1 : 0;
    const ib = b.installed ? 1 : 0;
    if (ia !== ib) return ia - ib;
    if (a.marketplaceName !== b.marketplaceName) return a.marketplaceName.localeCompare(b.marketplaceName);
    return (a.displayName || a.name).localeCompare(b.displayName || b.name);
  });
  return out;
}

function copyTree(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// Touch getPluginMarketplacesRoot so the import is used by tooling that scans for path roots.
void getPluginMarketplacesRoot;
```

> `void getPluginMarketplacesRoot;` keeps the import meaningful without an unused-symbol warning; remove it if you add a real call site. The `redactedUri` uses `redactMessage` (reuse) so basic-auth/query tokens never reach the DB.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/PluginMarketplaceService.ts \
        test/vitest/utilitycode/pluginMarketplaceService.test.ts
git commit -m "feat(plugin): add marketplace service"
```

## Task 8: IPC channels, schemas, handlers, renderer API

Handlers are thin: `registerAiValidatedHandler` does the AI-gate + zod parse + envelope wrapping. Handlers instantiate the service and return raw results; thrown errors become `{status:false,msg}`.

**Files:**
- Modify: `src/config/channellist.ts` (8 channels)
- Create: `src/schemas/ipc/pluginMarketplace.ts`
- Create: `src/main-process/communication/plugin-marketplace-ipc.ts`
- Modify: `src/main-process/communication/index.ts` (register)
- Create: `src/views/api/pluginMarketplaces.ts`
- Test: `test/vitest/main/plugin-marketplace-ipc.test.ts`

- [ ] **Step 1: Add channels**

In `src/config/channellist.ts`, append after the Plugin Management section:

```typescript
// ==================== Plugin Marketplace Channels (Marketplace PRD §11.1) ====================
export const PLUGIN_MARKETPLACE_LIST = "plugin:marketplace:list";
export const PLUGIN_MARKETPLACE_GET = "plugin:marketplace:get";
export const PLUGIN_MARKETPLACE_ADD = "plugin:marketplace:add";
export const PLUGIN_MARKETPLACE_REFRESH = "plugin:marketplace:refresh";
export const PLUGIN_MARKETPLACE_REMOVE = "plugin:marketplace:remove";
export const PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS = "plugin:marketplace:available-plugins";
export const PLUGIN_MARKETPLACE_GET_PLUGIN = "plugin:marketplace:get-plugin";
export const PLUGIN_MARKETPLACE_INSTALL_PLUGIN = "plugin:marketplace:install-plugin";
```

- [ ] **Step 2: Create zod schemas**

Create `src/schemas/ipc/pluginMarketplace.ts`:

```typescript
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";
import { noInputSchema } from "@/schemas/ipc/_shared/common";

export const pluginMarketplaceNoInputSchema = noInputSchema;

export const pluginMarketplaceByNameInputSchema = lazySchema(() =>
  z.strictObject({
    name: z.string().min(1, "name is required").max(256).regex(/^[a-z0-9][a-z0-9_-]*$/),
  })
);

export const pluginMarketplaceAddInputSchema = lazySchema(() =>
  z.strictObject({
    source: z.string().min(1, "source is required").max(4096),
    ref: z.string().max(256).optional(),
    overwrite: z.boolean().optional(),
  })
);

export const pluginMarketplaceAvailablePluginsInputSchema = lazySchema(() =>
  z
    .object({
      search: z.string().max(256).optional(),
      marketplaceName: z.string().max(256).optional(),
      category: z.string().max(128).optional(),
      installed: z.boolean().optional(),
      hasSkills: z.boolean().optional(),
      hasMcpServers: z.boolean().optional(),
      hasHooks: z.boolean().optional(),
    })
    .strict()
);

export const pluginMarketplacePluginByIdInputSchema = lazySchema(() =>
  z.strictObject({
    pluginId: z.string().min(1, "pluginId is required").max(512),
  })
);

export const pluginMarketplaceInstallInputSchema = lazySchema(() =>
  z.strictObject({
    pluginId: z.string().min(1, "pluginId is required").max(512),
    overwrite: z.boolean().optional(),
    enableAfterInstall: z.boolean().optional(),
    npmAuthToken: z.string().max(4096).optional(),
  })
);
```

- [ ] **Step 3: Create the IPC handlers**

Create `src/main-process/communication/plugin-marketplace-ipc.ts`. Handlers return raw values; the wrapper builds the `{status,msg,data}` envelope and runs the AI gate.

```typescript
import {
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_GET,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
  PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
  PLUGIN_MARKETPLACE_GET_PLUGIN,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
} from "@/config/channellist";
import { registerAiValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  pluginMarketplaceNoInputSchema,
  pluginMarketplaceByNameInputSchema,
  pluginMarketplaceAddInputSchema,
  pluginMarketplaceAvailablePluginsInputSchema,
  pluginMarketplacePluginByIdInputSchema,
  pluginMarketplaceInstallInputSchema,
} from "@/schemas/ipc/pluginMarketplace";
import { PluginMarketplaceService } from "@/service/PluginMarketplaceService";

/**
 * Marketplace IPC handlers. All AI-gated + schema-validated via the shared
 * wrapper. CRLF rejection for strings that may reach spawn stays inside the
 * service (parseMarketplaceSource rejects control chars), not the schema.
 */
export function registerPluginMarketplaceIpcHandlers(): void {
  console.log("Plugin Marketplace IPC handlers registered");

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_LIST, pluginMarketplaceNoInputSchema, async () => {
    return await new PluginMarketplaceService().listMarketplaces();
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_GET, pluginMarketplaceByNameInputSchema, async (input) => {
    return await new PluginMarketplaceService().getMarketplace(input.name);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_ADD, pluginMarketplaceAddInputSchema, async (input) => {
    return await new PluginMarketplaceService().addMarketplace(input);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_REFRESH, pluginMarketplaceByNameInputSchema, async (input) => {
    return await new PluginMarketplaceService().refreshMarketplace(input.name);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_REMOVE, pluginMarketplaceByNameInputSchema, async (input) => {
    await new PluginMarketplaceService().removeMarketplace(input.name);
    return null;
  });

  registerAiValidatedHandler(
    PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
    pluginMarketplaceAvailablePluginsInputSchema,
    async (input) => {
      return await new PluginMarketplaceService().listAvailablePlugins(input);
    }
  );

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_GET_PLUGIN, pluginMarketplacePluginByIdInputSchema, async (input) => {
    return await new PluginMarketplaceService().getAvailablePlugin(input.pluginId);
  });

  registerAiValidatedHandler(PLUGIN_MARKETPLACE_INSTALL_PLUGIN, pluginMarketplaceInstallInputSchema, async (input) => {
    return await new PluginMarketplaceService().installMarketplacePlugin(input);
  });
}
```

- [ ] **Step 4: Register in `communication/index.ts`**

In `src/main-process/communication/index.ts`:

(a) Add the import next to the `plugin-ipc` import:
```typescript
import { registerPluginIpcHandlers } from "@/main-process/communication/plugin-ipc";
import { registerPluginMarketplaceIpcHandlers } from "@/main-process/communication/plugin-marketplace-ipc";
```

(b) Add the call immediately after `registerPluginIpcHandlers();` inside `registerCommunicationIpcHandlers(win)`:
```typescript
    registerPluginIpcHandlers();
    registerPluginMarketplaceIpcHandlers();
```

- [ ] **Step 5: Create the renderer API**

Create `src/views/api/pluginMarketplaces.ts`. Types mirror `pluginMarketplaceTypes.ts` as plain interfaces (matching `plugins.ts` style).

```typescript
import { windowInvoke } from "@/views/utils/apirequest";
import {
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_GET,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
  PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
  PLUGIN_MARKETPLACE_GET_PLUGIN,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
} from "@/config/channellist";

export type PluginMarketplaceHealth =
  | "healthy" | "disabled" | "invalid" | "fetch_failed" | "missing_files";

export interface PluginMarketplaceSummary {
  id: number;
  name: string;
  displayName?: string;
  ownerName: string;
  description?: string;
  version?: string;
  sourceKind: string;
  sourceUri: string;
  sourceRef?: string;
  pluginCount: number;
  enabled: boolean;
  autoUpdate: boolean;
  health: PluginMarketplaceHealth;
  lastFetchedAt?: string;
  updatedAt?: string;
}

export interface PluginMarketplacePluginSummary {
  pluginId: string;
  name: string;
  displayName?: string;
  marketplaceName: string;
  marketplaceDisplayName?: string;
  version?: string;
  description?: string;
  author?: string;
  category?: string;
  tags: string[];
  sourceKind: string;
  capabilitySummary: {
    hasSkills: boolean; hasCommands: boolean; hasAgents: boolean;
    hasHooks: boolean; hasMcpServers: boolean; hasLspServers: boolean;
    hasOutputStyles: boolean; hasMonitors: boolean;
  };
  installed: boolean;
  installedVersion?: string;
  status: "not_installed" | "installed" | "different_version" | "unsupported" | "error";
  errors: Array<{ code: string; message: string; recoverable: boolean }>;
}

export interface PluginMarketplacePluginDetail extends PluginMarketplacePluginSummary {
  homepage?: string;
  repository?: string;
  license?: string;
  resolvedSourceKind?: string;
  resolvedSourceUri?: string;
  resolvedSourceRef?: string;
  pinnedToCommit: boolean;
}

export interface AddPluginMarketplaceRequest {
  source: string;
  ref?: string;
  overwrite?: boolean;
}

export interface InstallMarketplacePluginRequest {
  pluginId: string;
  overwrite?: boolean;
  enableAfterInstall?: boolean;
  npmAuthToken?: string;
}

export interface PluginMarketplacePluginFilter {
  search?: string;
  marketplaceName?: string;
  category?: string;
  installed?: boolean;
  hasSkills?: boolean;
  hasMcpServers?: boolean;
  hasHooks?: boolean;
}

export async function listPluginMarketplaces(): Promise<PluginMarketplaceSummary[] | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_LIST);
}
export async function getPluginMarketplace(name: string): Promise<unknown> {
  return await windowInvoke(PLUGIN_MARKETPLACE_GET, { name });
}
export async function addPluginMarketplace(
  req: AddPluginMarketplaceRequest
): Promise<PluginMarketplaceSummary | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_ADD, req);
}
export async function refreshPluginMarketplace(name: string): Promise<PluginMarketplaceSummary | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_REFRESH, { name });
}
export async function removePluginMarketplace(name: string): Promise<void> {
  await windowInvoke(PLUGIN_MARKETPLACE_REMOVE, { name });
}
export async function listMarketplacePlugins(
  filter: PluginMarketplacePluginFilter = {}
): Promise<PluginMarketplacePluginSummary[] | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS, filter);
}
export async function getMarketplacePlugin(pluginId: string): Promise<PluginMarketplacePluginDetail | null> {
  return await windowInvoke(PLUGIN_MARKETPLACE_GET_PLUGIN, { pluginId });
}
export async function installMarketplacePlugin(
  req: InstallMarketplacePluginRequest
): Promise<unknown> {
  return await windowInvoke(PLUGIN_MARKETPLACE_INSTALL_PLUGIN, req);
}
```

- [ ] **Step 6: Write the IPC test (mock the service)**

Create `test/vitest/main/plugin-marketplace-ipc.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

let aiEnabledValue = "true";
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return aiEnabledValue;
    }
  },
}));

vi.mock("@/service/PluginMarketplaceService", () => ({
  PluginMarketplaceService: class {
    async listMarketplaces() {
      return [{ id: 1, name: "team-tools", ownerName: "Team", sourceKind: "url", sourceUri: "https://x/marketplace.json", pluginCount: 2, enabled: true, autoUpdate: false, health: "healthy" }];
    }
    async getMarketplace() {
      return null;
    }
    async addMarketplace() {
      return { id: 2, name: "added", ownerName: "T", sourceKind: "url", sourceUri: "", pluginCount: 0, enabled: true, autoUpdate: false, health: "healthy" };
    }
    async refreshMarketplace() {
      return { id: 1, name: "team-tools", ownerName: "Team", sourceKind: "url", sourceUri: "", pluginCount: 2, enabled: true, autoUpdate: false, health: "healthy" };
    }
    async removeMarketplace() {
      return undefined;
    }
    async listAvailablePlugins() {
      return [];
    }
    async getAvailablePlugin() {
      return null;
    }
    async installMarketplacePlugin() {
      return { id: 9, name: "p", version: "1.0.0" };
    }
  },
}));

import { registerPluginMarketplaceIpcHandlers } from "@/main-process/communication/plugin-marketplace-ipc";
import {
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
} from "@/config/channellist";

describe("plugin-marketplace-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    aiEnabledValue = "true";
    registerPluginMarketplaceIpcHandlers();
  });

  it("registers all channels", () => {
    expect(handlers.has(PLUGIN_MARKETPLACE_LIST)).toBe(true);
    expect(handlers.has(PLUGIN_MARKETPLACE_ADD)).toBe(true);
    expect(handlers.has(PLUGIN_MARKETPLACE_REMOVE)).toBe(true);
    expect(handlers.has(PLUGIN_MARKETPLACE_INSTALL_PLUGIN)).toBe(true);
  });

  it("returns AI-not-enabled envelope when AI is disabled", async () => {
    aiEnabledValue = "false";
    const fn = handlers.get(PLUGIN_MARKETPLACE_LIST)!;
    const result = await fn({}, undefined);
    expect(result).toEqual({ status: false, msg: expect.stringContaining("not enabled"), data: null });
  });

  it("rejects add with empty source", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_ADD)!;
    const result = await fn({}, { source: "" });
    expect(result).toMatchObject({ status: false });
  });

  it("rejects install with malformed pluginId (no marketplace)", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_INSTALL_PLUGIN)!;
    const result = await fn({}, { pluginId: "no-at-sign" });
    // schema passes (it's a non-empty string), service throws -> status:false
    expect(result).toMatchObject({ status: false });
  });

  it("remove returns null envelope on success", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_REMOVE)!;
    const result = await fn({}, { name: "team-tools" });
    expect(result).toEqual({ status: true, msg: "ok", data: null });
  });

  it("refresh requires a name", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_REFRESH)!;
    const result = await fn({}, { name: "" });
    expect(result).toMatchObject({ status: false });
  });
});
```

- [ ] **Step 7: Run the IPC test**

Run: `npx vitest --config vite.main.config.mjs test/vitest/main/plugin-marketplace-ipc.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add src/config/channellist.ts \
        src/schemas/ipc/pluginMarketplace.ts \
        src/main-process/communication/plugin-marketplace-ipc.ts \
        src/main-process/communication/index.ts \
        src/views/api/pluginMarketplaces.ts \
        test/vitest/main/plugin-marketplace-ipc.test.ts
git commit -m "feat(plugin): expose marketplace IPC and renderer API"
```

## Task 9: UI — Plugin Manager tabs + marketplace components

Refactor `PluginManager.vue` into tabs using the in-repo `v-tabs`/`v-window` idiom (shared `v-model` string ref). Extract the installed table into the `installed` tab; add Discover, Marketplaces, Errors tabs and the Add + Plugin Detail dialogs.

**Files:**
- Modify: `src/views/components/plugins/PluginManager.vue` (refactor to tabs)
- Create: `src/views/components/plugins/PluginInstalledTab.vue` (extracted)
- Create: `src/views/components/plugins/PluginMarketplacesTab.vue`
- Create: `src/views/components/plugins/PluginDiscoverTab.vue`
- Create: `src/views/components/plugins/PluginMarketplaceAddDialog.vue`
- Create: `src/views/components/plugins/PluginMarketplacePluginDetailDialog.vue`
- Modify: `src/views/components/plugins/PluginOverviewTab.vue` (marketplace provenance)
- Modify: `src/views/api/plugins.ts` (optional marketplace fields on `PluginDetail`)

- [ ] **Step 1: Extract the installed table into `PluginInstalledTab.vue`**

Move the existing installed-plugin table + its `sourceLabel`/`healthLabel`/`healthColor`/toggle/uninstall logic out of `PluginManager.vue`. Create `src/views/components/plugins/PluginInstalledTab.vue`:

```vue
<template>
  <div>
    <div class="d-flex justify-end ga-2 mb-2">
      <v-btn variant="text" size="small" @click="$emit('reload')" :loading="reloading">
        <v-icon left>mdi-refresh</v-icon>
        {{ t("plugins.reload_button") }}
      </v-btn>
      <v-btn color="primary" @click="$emit('import')">
        <v-icon left>mdi-upload</v-icon>
        {{ t("plugins.import_button") }}
      </v-btn>
      <v-btn color="primary" variant="tonal" @click="$emit('install-source')">
        <v-icon left>mdi-source-branch</v-icon>
        {{ t("plugins.install_source.button") || "Install from Source" }}
      </v-btn>
    </div>

    <div v-if="isLoading" class="text-center pa-4">
      <v-progress-circular indeterminate color="primary" />
    </div>
    <div v-else-if="plugins.length === 0" class="text-center pa-4">
      <v-icon size="64" color="grey-lighten-2">mdi-puzzle</v-icon>
      <p class="mt-4 text-grey">{{ t("plugins.empty_state") }}</p>
    </div>
    <div v-else>
      <v-table>
        <thead>
          <tr>
            <th>{{ t("plugins.column_plugin") }}</th>
            <th>{{ t("plugins.column_version") }}</th>
            <th>{{ t("plugins.column_source") }}</th>
            <th>{{ t("plugins.column_status") }}</th>
            <th>{{ t("plugins.column_skills") }}</th>
            <th>{{ t("plugins.column_mcp_servers") }}</th>
            <th>{{ t("plugins.column_actions") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in plugins" :key="p.name" @click="$emit('select', p.name)" style="cursor: pointer">
            <td>{{ p.displayName || p.name }}</td>
            <td>{{ p.version }}</td>
            <td><v-chip size="small">{{ sourceLabel(p.source) }}</v-chip></td>
            <td><v-chip :color="healthColor(p)" size="small">{{ healthLabel(p) }}</v-chip></td>
            <td>{{ p.skillCount }}</td>
            <td>{{ p.mcpServerCount }}</td>
            <td>
              <v-switch :model-value="p.enabled" color="success" hide-details density="compact"
                @click.stop @update:model-value="(v) => $emit('toggle', p.name, v === true)" />
              <v-btn icon size="x-small" variant="text" color="error" @click.stop="$emit('uninstall', p.name)">
                <v-icon>mdi-delete</v-icon>
                <v-tooltip activator="parent" location="top">{{ t("plugins.uninstall_button") }}</v-tooltip>
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { PluginSummary } from "@/views/api/plugins";

defineProps<{
  plugins: PluginSummary[];
  isLoading: boolean;
  reloading: boolean;
}>();
defineEmits<{
  reload: [];
  import: [];
  "install-source": [];
  select: [string];
  toggle: [string, boolean];
  uninstall: [string];
}>();

const { t } = useI18n();
function sourceLabel(source: string): string {
  if (source === "builtin") return t("plugins.source_builtin");
  if (source === "marketplace") return t("plugins.source_marketplace");
  return t("plugins.source_local");
}
function healthLabel(p: PluginSummary): string {
  if (!p.enabled) return t("plugins.status_disabled");
  return t(`plugins.status_${p.health}`);
}
function healthColor(p: PluginSummary): string {
  if (!p.enabled) return "grey";
  if (p.health === "healthy") return "success";
  if (p.health === "missing_files" || p.health === "invalid") return "error";
  return "warning";
}
</script>
```

- [ ] **Step 2: Refactor `PluginManager.vue` to tabs**

Replace the whole file. The manager becomes a thin shell: header + `v-tabs`/`v-window` (shared `tab` ref) + the dialogs. The existing `load/toggle/uninstall/import/install-source` logic is delegated to the Installed tab via events.

```vue
<template>
  <v-container fluid>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ t("plugins.title") }}</span>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-tabs v-model="tab">
          <v-tab value="installed">{{ t("plugins.tab_installed") || "Installed" }}</v-tab>
          <v-tab value="discover">{{ t("plugins.marketplace.tab_discover") || "Discover" }}</v-tab>
          <v-tab value="marketplaces">{{ t("plugins.marketplace.tab_marketplaces") || "Marketplaces" }}</v-tab>
          <v-tab value="errors">{{ t("plugins.marketplace.tab_errors") || "Errors" }}</v-tab>
        </v-tabs>
        <v-window v-model="tab" class="mt-4">
          <v-window-item value="installed">
            <PluginInstalledTab
              :plugins="plugins" :is-loading="isLoading" :reloading="reloading"
              @reload="reload" @import="showImport = true" @install-source="showInstallSource = true"
              @select="selectPlugin" @toggle="toggle" @uninstall="confirmUninstall" />
          </v-window-item>
          <v-window-item value="discover">
            <PluginDiscoverTab ref="discoverRef" />
          </v-window-item>
          <v-window-item value="marketplaces">
            <PluginMarketplacesTab @changed="onMarketplacesChanged" />
          </v-window-item>
          <v-window-item value="errors">
            <PluginMarketplaceErrorsTab />
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>

    <PluginDetailPanel v-if="selectedName" :name="selectedName" @close="selectedName = null" />
    <PluginImportDialog v-model="showImport" @imported="onImported" />
    <PluginInstallSourceDialog v-model="showInstallSource" @imported="onImported" />

    <v-dialog v-model="showUninstall" max-width="500">
      <v-card>
        <v-card-title>{{ t("plugins.uninstall_button") }}</v-card-title>
        <v-card-text>{{ t("plugins.uninstall_confirm") }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showUninstall = false">{{ t("common.cancel") || "Cancel" }}</v-btn>
          <v-btn color="error" @click="doUninstall">{{ t("plugins.uninstall_button") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { listPlugins, togglePlugin, uninstallPlugin, reloadPlugins, type PluginSummary } from "@/views/api/plugins";
import PluginDetailPanel from "./PluginDetailPanel.vue";
import PluginImportDialog from "./PluginImportDialog.vue";
import PluginInstallSourceDialog from "./PluginInstallSourceDialog.vue";
import PluginInstalledTab from "./PluginInstalledTab.vue";
import PluginDiscoverTab from "./PluginDiscoverTab.vue";
import PluginMarketplacesTab from "./PluginMarketplacesTab.vue";
import PluginMarketplaceErrorsTab from "./PluginMarketplaceErrorsTab.vue";

const { t } = useI18n();
const tab = ref("installed");
const plugins = ref<PluginSummary[]>([]);
const isLoading = ref(false);
const reloading = ref(false);
const selectedName = ref<string | null>(null);
const showImport = ref(false);
const showInstallSource = ref(false);
const uninstallTarget = ref<string | null>(null);
const showUninstall = ref(false);
const discoverRef = ref<{ reload: () => Promise<void> } | null>(null);

async function load(): Promise<void> {
  isLoading.value = true;
  try {
    const data = await listPlugins();
    plugins.value = data ?? [];
  } finally {
    isLoading.value = false;
  }
}
async function reload(): Promise<void> {
  reloading.value = true;
  try { await reloadPlugins(); await load(); } finally { reloading.value = false; }
}
function selectPlugin(name: string): void { selectedName.value = name; }
async function toggle(name: string, enabled: boolean): Promise<void> { await togglePlugin(name, enabled); await load(); }
function confirmUninstall(name: string): void { uninstallTarget.value = name; showUninstall.value = true; }
async function doUninstall(): Promise<void> {
  if (!uninstallTarget.value) return;
  const name = uninstallTarget.value;
  uninstallTarget.value = null; showUninstall.value = false;
  await uninstallPlugin(name);
  if (selectedName.value === name) selectedName.value = null;
  await load();
}
async function onImported(): Promise<void> { await load(); await discoverRef.value?.reload(); }
async function onMarketplacesChanged(): Promise<void> { await discoverRef.value?.reload(); }
onMounted(load);
</script>
```

> `PluginMarketplaceErrorsTab.vue` is a simple read-only list of `listPluginMarketplaces()` rows whose `health !== "healthy"` plus their `errors`. If you prefer not to add a 6th component now, inline a minimal version that maps over marketplaces with errors — but keep the tab so the structure is correct.

- [ ] **Step 3: Create `PluginMarketplaceErrorsTab.vue`**

```vue
<template>
  <div>
    <div v-if="loading" class="text-center pa-4"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="rows.length === 0" class="text-center pa-4 text-grey">{{ t("plugins.marketplace.no_errors") || "No marketplace errors." }}</div>
    <v-table v-else>
      <thead><tr>
        <th>{{ t("plugins.marketplace.column_marketplace") }}</th>
        <th>{{ t("plugins.marketplace.health_label") || "Health" }}</th>
        <th>{{ t("plugins.marketplace.errors_label") || "Errors" }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="m in rows" :key="m.name">
          <td>{{ m.name }}</td>
          <td><v-chip size="small" color="error">{{ m.health }}</v-chip></td>
          <td>{{ errorText(m) }}</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { listPluginMarketplaces, type PluginMarketplaceSummary } from "@/views/api/pluginMarketplaces";

const { t } = useI18n();
const rows = ref<PluginMarketplaceSummary[]>([]);
const loading = ref(false);

function errorText(_m: PluginMarketplaceSummary): string {
  // Detailed errors come from getPluginMarketplace(name).errors; show health here.
  return t("plugins.marketplace.health_" + _m.health) || _m.health;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const all = (await listPluginMarketplaces()) ?? [];
    rows.value = all.filter((m) => m.health !== "healthy");
  } finally {
    loading.value = false;
  }
}
defineExpose({ reload: load });
onMounted(load);
</script>
```

- [ ] **Step 4: Create `PluginMarketplacesTab.vue`**

```vue
<template>
  <div>
    <div class="d-flex justify-end ga-2 mb-2">
      <v-btn variant="text" size="small" @click="refreshAll" :loading="refreshingAll">
        <v-icon left>mdi-refresh</v-icon>
        {{ t("plugins.marketplace.refresh_all_button") || "Refresh All" }}
      </v-btn>
      <v-btn color="primary" @click="showAdd = true">
        <v-icon left>mdi-plus</v-icon>
        {{ t("plugins.marketplace.add_button") || "Add Marketplace" }}
      </v-btn>
    </div>

    <div v-if="loading" class="text-center pa-4"><v-progress-circular indeterminate color="primary" /></div>
    <v-table v-else>
      <thead><tr>
        <th>{{ t("plugins.marketplace.column_marketplace") }}</th>
        <th>{{ t("plugins.marketplace.column_owner") }}</th>
        <th>{{ t("plugins.marketplace.column_plugins") }}</th>
        <th>{{ t("plugins.marketplace.health_label") || "Status" }}</th>
        <th>{{ t("plugins.marketplace.column_last_fetched") }}</th>
        <th>{{ t("plugins.column_actions") }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="m in marketplaces" :key="m.name">
          <td>{{ m.displayName || m.name }}</td>
          <td>{{ m.ownerName }}</td>
          <td>{{ m.pluginCount }}</td>
          <td><v-chip size="small" :color="healthColor(m.health)">{{ healthLabel(m.health) }}</v-chip></td>
          <td>{{ m.lastFetchedAt ? new Date(m.lastFetchedAt).toLocaleString() : "—" }}</td>
          <td>
            <v-btn icon size="x-small" variant="text" @click="refresh(m.name)" :loading="refreshingName === m.name">
              <v-icon>mdi-refresh</v-icon>
            </v-btn>
            <v-btn icon size="x-small" variant="text" color="error" @click="confirmRemove(m.name)">
              <v-icon>mdi-delete</v-icon>
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <PluginMarketplaceAddDialog v-model="showAdd" @added="onAdded" />

    <v-dialog v-model="showRemove" max-width="520">
      <v-card>
        <v-card-title>{{ t("plugins.marketplace.remove_button") || "Remove Marketplace" }}</v-card-title>
        <v-card-text>{{ t("plugins.marketplace.confirm_remove") || "Remove this marketplace? Installed plugins from it will remain installed." }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showRemove = false">{{ t("common.cancel") || "Cancel" }}</v-btn>
          <v-btn color="error" @click="doRemove">{{ t("plugins.marketplace.remove_button") || "Remove" }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  listPluginMarketplaces, refreshPluginMarketplace, removePluginMarketplace,
  type PluginMarketplaceSummary,
} from "@/views/api/pluginMarketplaces";
import PluginMarketplaceAddDialog from "./PluginMarketplaceAddDialog.vue";

const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const marketplaces = ref<PluginMarketplaceSummary[]>([]);
const loading = ref(false);
const showAdd = ref(false);
const showRemove = ref(false);
const removeTarget = ref<string | null>(null);
const refreshingName = ref<string | null>(null);
const refreshingAll = ref(false);

function healthLabel(h: string): string { return t(`plugins.marketplace.health_${h}`) || h; }
function healthColor(h: string): string {
  if (h === "healthy") return "success";
  if (h === "disabled") return "grey";
  return "error";
}

async function load(): Promise<void> {
  loading.value = true;
  try { marketplaces.value = (await listPluginMarketplaces()) ?? []; } finally { loading.value = false; }
}
async function refresh(name: string): Promise<void> {
  refreshingName.value = name;
  try { await refreshPluginMarketplace(name); await load(); emit("changed"); } finally { refreshingName.value = null; }
}
async function refreshAll(): Promise<void> {
  refreshingAll.value = true;
  try { for (const m of marketplaces.value) await refreshPluginMarketplace(m.name); await load(); emit("changed"); } finally { refreshingAll.value = false; }
}
function confirmRemove(name: string): void { removeTarget.value = name; showRemove.value = true; }
async function doRemove(): Promise<void> {
  if (!removeTarget.value) return;
  const name = removeTarget.value; removeTarget.value = null; showRemove.value = false;
  await removePluginMarketplace(name); await load(); emit("changed");
}
async function onAdded(): Promise<void> { showAdd.value = false; await load(); emit("changed"); }
onMounted(load);
</script>
```

- [ ] **Step 5: Create `PluginMarketplaceAddDialog.vue`**

Mirrors `PluginInstallSourceDialog.vue` (modelValue + emits, reactive form, working/errorMsg, watch reset, computed canSubmit, spread into API call).

```vue
<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="640">
    <v-card>
      <v-card-title>{{ t("plugins.marketplace.add_title") || "Add Plugin Marketplace" }}</v-card-title>
      <v-card-text>
        <v-text-field v-model="form.source"
          :label="t("plugins.marketplace.source_label") || "Marketplace source (owner/repo, git URL, folder, or marketplace.json URL)" />
        <v-text-field v-model="form.ref"
          :label="t("plugins.marketplace.ref_label") || "Branch / tag / commit (optional)" />
        <div class="text-caption text-medium-emphasis mt-1">
          {{ t("plugins.marketplace.source_hint") || "Examples: owner/repo, https://github.com/owner/repo.git, /local/folder, https://host/marketplace.json" }}
        </div>
        <v-alert v-if="errorMsg" type="error" variant="tonal" class="mt-3">{{ errorMsg }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t("common.cancel") || "Cancel" }}</v-btn>
        <v-btn color="primary" :loading="working" :disabled="!canSubmit" @click="doAdd">
          {{ t("plugins.marketplace.add_button") || "Add" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { addPluginMarketplace, type AddPluginMarketplaceRequest } from "@/views/api/pluginMarketplaces";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ "update:modelValue": [boolean]; added: [] }>();
const { t } = useI18n();
const form = reactive<AddPluginMarketplaceRequest>({ source: "" });
const working = ref(false);
const errorMsg = ref("");
const canSubmit = computed(() => form.source.trim().length > 0);

watch(() => props.modelValue, (open) => {
  if (open) { form.source = ""; form.ref = undefined; form.overwrite = undefined; errorMsg.value = ""; }
});

async function doAdd(): Promise<void> {
  if (!canSubmit.value) return;
  working.value = true; errorMsg.value = "";
  try {
    const r = await addPluginMarketplace({ ...form });
    if (!r) { errorMsg.value = t("plugins.marketplace.add_failed") || "Failed to add marketplace."; return; }
    emit("added"); emit("update:modelValue", false);
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : String(e);
  } finally { working.value = false; }
}
function close(): void { emit("update:modelValue", false); }
</script>
```

- [ ] **Step 6: Create `PluginDiscoverTab.vue` + `PluginMarketplacePluginDetailDialog.vue`**

`PluginDiscoverTab.vue`:

```vue
<template>
  <div>
    <div class="d-flex ga-2 mb-2 flex-wrap">
      <v-text-field v-model="search" density="compact" hide-details style="max-width: 280px"
        :label="t("plugins.marketplace.search_label") || "Search"" @update:model-value="reload" />
      <v-select v-model="marketplaceName" :items="marketplaceItems" item-title="label" item-value="value"
        density="compact" hide-details style="max-width: 220px" clearable
        :label="t("plugins.marketplace.column_marketplace")" @update:model-value="reload" />
      <v-select v-model="installedFilter" :items="installedItems" item-title="label" item-value="value"
        density="compact" hide-details style="max-width: 180px"
        :label="t("plugins.marketplace.column_status")" @update:model-value="reload" />
    </div>

    <div v-if="loading" class="text-center pa-4"><v-progress-circular indeterminate color="primary" /></div>
    <v-table v-else>
      <thead><tr>
        <th>{{ t("plugins.column_plugin") }}</th>
        <th>{{ t("plugins.marketplace.column_marketplace") }}</th>
        <th>{{ t("plugins.column_version") }}</th>
        <th>{{ t("plugins.column_actions") }}</th>
      </tr></thead>
      <tbody>
        <tr v-for="p in items" :key="p.pluginId">
          <td>{{ p.displayName || p.name }}<div class="text-caption text-grey">{{ p.description }}</div></td>
          <td>{{ p.marketplaceDisplayName || p.marketplaceName }}</td>
          <td>{{ p.version || "—" }}</td>
          <td>
            <v-btn size="small" variant="text" @click="openDetail(p.pluginId)">{{ t("plugins.marketplace.view_details") || "Details" }}</v-btn>
            <v-btn v-if="p.status === "not_installed"" size="small" color="primary" :disabled="false" @click="install(p.pluginId)">
              {{ t("plugins.marketplace.install_button") || "Install" }}
            </v-btn>
            <v-btn v-else-if="p.status === "installed"" size="small" disabled>{{ t("plugins.marketplace.status_installed") || "Installed" }}</v-btn>
            <v-btn v-else-if="p.status === "different_version"" size="small" variant="tonal" @click="install(p.pluginId)">{{ t("plugins.marketplace.reinstall_button") || "Reinstall" }}</v-btn>
            <v-btn v-else size="small" disabled>{{ t("plugins.marketplace.status_unsupported") || "Unsupported" }}</v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>

    <PluginMarketplacePluginDetailDialog v-model="showDetail" :plugin-id="detailId" @installed="reload" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import {
  listMarketplacePlugins, listPluginMarketplaces, installMarketplacePlugin,
  type PluginMarketplacePluginSummary,
} from "@/views/api/pluginMarketplaces";
import PluginMarketplacePluginDetailDialog from "./PluginMarketplacePluginDetailDialog.vue";

const { t } = useI18n();
const items = ref<PluginMarketplacePluginSummary[]>([]);
const loading = ref(false);
const search = ref("");
const marketplaceName = ref<string | null>(null);
const installedFilter = ref<"all" | "installed" | "not_installed">("all");
const marketplaceItems = ref<Array<{ label: string; value: string }>>([]);
const installedItems = ref([
  { label: t("plugins.marketplace.status_all") || "All", value: "all" },
  { label: t("plugins.marketplace.status_installed") || "Installed", value: "installed" },
  { label: t("plugins.marketplace.status_not_installed") || "Not installed", value: "not_installed" },
]);
const showDetail = ref(false);
const detailId = ref<string | null>(null);

async function reload(): Promise<void> {
  loading.value = true;
  try {
    const filter: Record<string, unknown> = {};
    if (search.value) filter.search = search.value;
    if (marketplaceName.value) filter.marketplaceName = marketplaceName.value;
    if (installedFilter.value === "installed") filter.installed = true;
    if (installedFilter.value === "not_installed") filter.installed = false;
    items.value = (await listMarketplacePlugins(filter)) ?? [];
  } finally { loading.value = false; }
}
function openDetail(pluginId: string): void { detailId.value = pluginId; showDetail.value = true; }
async function install(pluginId: string): Promise<void> {
  try { await installMarketplacePlugin({ pluginId, overwrite: true }); await reload(); } catch { /* error shown via envelope */ }
}
async function loadMarketplaceOptions(): Promise<void> {
  const list = (await listPluginMarketplaces()) ?? [];
  marketplaceItems.value = list.map((m) => ({ label: m.displayName || m.name, value: m.name }));
}
defineExpose({ reload });
onMounted(async () => { await loadMarketplaceOptions(); await reload(); });
</script>
```

`PluginMarketplacePluginDetailDialog.vue`:

```vue
<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="720">
    <v-card>
      <v-card-title>{{ detail ? (detail.displayName || detail.name) : "..." }}</v-card-title>
      <v-card-text v-if="detail">
        <p>{{ detail.description || "" }}</p>
        <p class="mt-2"><strong>{{ t("plugins.marketplace.column_marketplace") }}:</strong> {{ detail.marketplaceDisplayName || detail.marketplaceName }}</p>
        <p><strong>{{ t("plugins.column_version") }}:</strong> {{ detail.version || "—" }}</p>
        <p v-if="detail.author"><strong>Author:</strong> {{ detail.author }}</p>
        <p v-if="detail.resolvedSourceKind"><strong>{{ t("plugins.install_source.source_kind") || "Source" }}:</strong> {{ detail.resolvedSourceKind }}<span v-if="detail.resolvedSourceUri"> · {{ detail.resolvedSourceUri }}</span></p>
        <p v-if="!detail.pinnedToCommit" class="text-warning">{{ t("plugins.marketplace.risk_unpinned_git") || "This plugin is not pinned to a commit." }}</p>

        <div v-if="riskFlags.length" class="mt-3">
          <v-chip v-for="f in riskFlags" :key="f" color="warning" size="small" class="mr-1">{{ riskLabel(f) }}</v-chip>
        </div>

        <v-checkbox v-if="canInstall" v-model="confirmRisk" :label="t("plugins.marketplace.confirm_risk") || "I understand the risks and want to install."" hide-details density="compact" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">{{ t("common.cancel") || "Close" }}</v-btn>
        <v-btn color="primary" :disabled="!canInstall || (riskFlags.length > 0 && !confirmRisk)" :loading="installing" @click="doInstall">
          {{ t("plugins.marketplace.install_button") || "Install" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getMarketplacePlugin, installMarketplacePlugin, type PluginMarketplacePluginDetail } from "@/views/api/pluginMarketplaces";

const props = defineProps<{ modelValue: boolean; pluginId: string | null }>();
const emit = defineEmits<{ "update:modelValue": [boolean]; installed: [] }>();
const { t } = useI18n();
const detail = ref<PluginMarketplacePluginDetail | null>(null);
const installing = ref(false);
const confirmRisk = ref(false);

const riskFlags = computed<string[]>(() => {
  if (!detail.value) return [];
  const f: string[] = [];
  if (detail.value.capabilitySummary.hasMcpServers) f.push("mcp");
  if (detail.value.capabilitySummary.hasHooks) f.push("hooks");
  if (detail.value.capabilitySummary.hasMonitors) f.push("monitors");
  if (detail.value.sourceKind === "npm") f.push("npm");
  if (!detail.value.pinnedToCommit && (detail.value.sourceKind === "github" || detail.value.sourceKind === "url" || detail.value.sourceKind === "git")) f.push("unpinnedGit");
  return f;
});
const canInstall = computed(() => detail.value && detail.value.status !== "unsupported" && detail.value.status !== "error");
function riskLabel(f: string): string {
  const map: Record<string, string> = {
    mcp: t("plugins.marketplace.risk_mcp") || "MCP servers",
    hooks: t("plugins.marketplace.risk_hooks") || "Hooks",
    monitors: t("plugins.marketplace.risk_monitors") || "Monitors",
    npm: t("plugins.marketplace.risk_npm") || "Installs from npm",
    unpinnedGit: t("plugins.marketplace.risk_unpinned_git") || "Not pinned to commit",
  };
  return map[f] || f;
}

watch(() => [props.modelValue, props.pluginId], async ([open, id]) => {
  if (open && id) {
    detail.value = await getMarketplacePlugin(id as string);
    confirmRisk.value = false;
  }
}, { immediate: true });

async function doInstall(): Promise<void> {
  if (!detail.value) return;
  installing.value = true;
  try {
    await installMarketplacePlugin({ pluginId: detail.value.pluginId, overwrite: true });
    emit("installed"); emit("update:modelValue", false);
  } finally { installing.value = false; }
}
</script>
```

- [ ] **Step 7: Extend `PluginOverviewTab.vue` for marketplace provenance**

Add a sibling paragraph after the existing `sourceKind` block. The current file shows `<p v-if="detail.sourceKind">...</p>`. Add after it:

```vue
    <p v-if="detail.marketplaceName">
      <strong>{{ t("plugins.marketplace.column_marketplace") || "Marketplace" }}:</strong>
      {{ detail.marketplaceName }}<span v-if="detail.entryName"> · {{ detail.entryName }}</span>
    </p>
```

And in `src/views/api/plugins.ts`, add optional fields to the `PluginDetail` interface:

```typescript
export interface PluginDetail extends PluginSummary {
  // ... existing fields ...
  marketplaceName?: string;
  entryName?: string;
  entryVersion?: string;
}
```

(These are populated from `sourceMetaJson.marketplace` when the `PLUGIN_GET` handler builds the detail; if you want them populated, extend the `toSummary`/detail builder in `plugin-ipc.ts` to parse `sourceMetaJson`. This is optional for MVP visibility — the source chip already shows "Marketplace".)

- [ ] **Step 8: Commit**

```bash
git add src/views/components/plugins/PluginManager.vue \
        src/views/components/plugins/PluginInstalledTab.vue \
        src/views/components/plugins/PluginMarketplacesTab.vue \
        src/views/components/plugins/PluginDiscoverTab.vue \
        src/views/components/plugins/PluginMarketplaceAddDialog.vue \
        src/views/components/plugins/PluginMarketplacePluginDetailDialog.vue \
        src/views/components/plugins/PluginMarketplaceErrorsTab.vue \
        src/views/components/plugins/PluginOverviewTab.vue \
        src/views/api/plugins.ts
git commit -m "feat(plugin): add marketplace management UI"
```

## Task 10: Internationalization (6 languages) + final verification

**MANDATORY** (per project CLAUDE.md i18n rule): every new `plugins.marketplace.*` key must exist in `en, zh, es, fr, de, ja`. Translate accurately; English is the fallback.

**Files:**
- Modify: `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`

- [ ] **Step 1: Add the `marketplace` sub-group to `en.ts`**

Inside the `plugins:` object (after the existing `install_source: { ... }` block), add:

```typescript
    marketplace: {
      tab_installed: "Installed",
      tab_discover: "Discover",
      tab_marketplaces: "Marketplaces",
      tab_errors: "Errors",
      add_button: "Add Marketplace",
      add_title: "Add Plugin Marketplace",
      add_failed: "Failed to add marketplace.",
      source_label: "Marketplace source (owner/repo, git URL, folder, or marketplace.json URL)",
      source_hint: "Examples: owner/repo, https://github.com/owner/repo.git, /local/folder, https://host/marketplace.json",
      ref_label: "Branch / tag / commit (optional)",
      search_label: "Search",
      refresh_button: "Refresh",
      refresh_all_button: "Refresh All",
      remove_button: "Remove",
      install_button: "Install",
      reinstall_button: "Reinstall",
      view_details: "Details",
      confirm_remove: "Remove this marketplace? Installed plugins from it will remain installed.",
      confirm_risk: "I understand the risks and want to install.",
      column_marketplace: "Marketplace",
      column_owner: "Owner",
      column_plugins: "Plugins",
      column_last_fetched: "Last fetched",
      health_label: "Status",
      errors_label: "Errors",
      no_errors: "No marketplace errors.",
      status_all: "All",
      status_installed: "Installed",
      status_not_installed: "Not installed",
      status_different_version: "Different version installed",
      status_unsupported: "Unsupported source",
      health_healthy: "Healthy",
      health_disabled: "Disabled",
      health_invalid: "Invalid",
      health_fetch_failed: "Fetch failed",
      health_missing_files: "Missing files",
      risk_mcp: "Starts MCP servers",
      risk_hooks: "Declares hooks",
      risk_monitors: "Declares monitors",
      risk_npm: "Installs from npm",
      risk_unpinned_git: "Not pinned to a commit",
    },
```

Also add the flat key `tab_installed` is reused — but `tab_installed` already maps to the manager tab. To avoid collision, the manager tab uses `t("plugins.tab_installed")` (add `tab_installed: "Installed"` at the flat `plugins:` level if not present).

- [ ] **Step 2: Replicate the block in `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`**

Same keys, translated values. Example for `zh.ts`:

```typescript
    marketplace: {
      tab_installed: "已安装",
      tab_discover: "发现",
      tab_marketplaces: "插件市场",
      tab_errors: "错误",
      add_button: "添加插件市场",
      add_title: "添加插件市场",
      add_failed: "添加插件市场失败。",
      source_label: "插件市场来源（owner/repo、git 地址、文件夹或 marketplace.json 地址）",
      source_hint: "示例：owner/repo、https://github.com/owner/repo.git、/本地/文件夹、https://host/marketplace.json",
      ref_label: "分支 / 标签 / 提交（可选）",
      search_label: "搜索",
      refresh_button: "刷新",
      refresh_all_button: "全部刷新",
      remove_button: "移除",
      install_button: "安装",
      reinstall_button: "重新安装",
      view_details: "详情",
      confirm_remove: "移除该插件市场？来自该市场的已安装插件将保留。",
      confirm_risk: "我了解风险并希望安装。",
      column_marketplace: "插件市场",
      column_owner: "所有者",
      column_plugins: "插件数",
      column_last_fetched: "最近获取",
      health_label: "状态",
      errors_label: "错误",
      no_errors: "没有插件市场错误。",
      status_all: "全部",
      status_installed: "已安装",
      status_not_installed: "未安装",
      status_different_version: "已安装不同版本",
      status_unsupported: "不支持的来源",
      health_healthy: "健康",
      health_disabled: "已禁用",
      health_invalid: "无效",
      health_fetch_failed: "获取失败",
      health_missing_files: "文件缺失",
      risk_mcp: "启动 MCP 服务器",
      risk_hooks: "声明钩子",
      risk_monitors: "声明监视器",
      risk_npm: "从 npm 安装",
      risk_unpinned_git: "未固定到提交",
    },
```

Translate `es`, `fr`, `de`, `ja` similarly. Verify every key matches `en` exactly (missing keys fall back to English silently, which fails the i18n rule).

- [ ] **Step 3: Type-check + run the full focused suite**

```bash
yarn vue-check          # renderer types (Vue/TS)
yarn tsc-result         # backend types (tsc --noEmit)
yarn test test/modules/PluginMarketplaceModule.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/parsePluginIdentifier.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/installPipelineProvenance.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplacePaths.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/parseMarketplaceSource.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceValidation.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/resolveMarketplaceEntrySource.test.ts
npx vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/pluginMarketplaceService.test.ts
npx vitest --config vite.main.config.mjs test/vitest/main/plugin-marketplace-ipc.test.ts
```

Expected: all green. Also run the existing plugin tests to confirm no regression: `npx vitest --config vite.main.config.mjs test/vitest/main/plugin-ipc.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts \
        src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(plugin): add marketplace translations for all supported languages"
```

---

## Manual UAT (before declaring done)

Create a fixture marketplace (tech design §18.5):

```
/tmp/aifetchly-marketplace/
  .claude-plugin/marketplace.json        # { name: "local-test-market", owner:{name:"Test"}, plugins:[{name:"hello-plugin", source:"./plugins/hello-plugin"}] }
  plugins/hello-plugin/
    .claude-plugin/plugin.json           # Claude-format plugin manifest
    skills/hello/SKILL.md
```

Flow:
1. Settings → Plugins → **Marketplaces** tab → **Add Marketplace** → enter `/tmp/aifetchly-marketplace` → Add. Verify it lists with health Healthy, pluginCount 1.
2. **Discover** tab → verify `hello-plugin@local-test-market` appears, status Not installed.
3. Click **Details** → review → **Install**. Confirm the installed-plugin row appears in the **Installed** tab with the **Marketplace** source chip.
4. Disable → re-enable the installed plugin from the Installed tab; confirm it still works.
5. **Marketplaces** tab → **Remove** `local-test-market`. Confirm the installed `hello-plugin` **remains** in the Installed tab and is still manageable.
6. Add a malformed marketplace (bad JSON) → confirm a structured error is shown (not a stack trace) and no marketplace row is created.
7. (If npm available) Add a marketplace with an `npm`-source entry, install it, then inspect the installed row's `sourceMetaJson` in the DB — confirm **no `npmAuthToken`** is persisted.

---

## Definition of Done

- [ ] New `PluginMarketplaceEntity`/`Model`/`Module` follow the DB-architecture rules; entity is registered in `SqliteDb.ts`.
- [ ] `parseMarketplaceSource`, manifest validation, all four fetchers, and atomic cache replacement are tested.
- [ ] Discover list is generated from cached manifests; `installed` status is joined from `sourceMetaJson.marketplace`.
- [ ] `plugin-name@marketplace-name` install delegates to `PluginInstallService.installFromSource`; installed row records `source = "marketplace"` + provenance.
- [ ] Plugin Manager has Installed / Discover / Marketplaces / Errors tabs (shared `v-model` ref).
- [ ] High-risk install flags (MCP/hooks/npm/unpinned-git) are visible and require confirmation.
- [ ] All new UI strings exist in `en, zh, es, fr, de, ja`.
- [ ] Relative paths cannot escape the marketplace root (realpath guard).
- [ ] Refresh failure preserves the previous good cache.
- [ ] Marketplace removal leaves installed plugins intact.
- [ ] No secrets in errors / persisted source metadata (reuses `redactMessage`).
- [ ] Focused module / utility / IPC tests pass; `yarn vue-check` + `tsc --noEmit` clean.

---

## Notes & deliberate deviations from the technical design

These were chosen after verifying the actual `worktree-marketplace` code. They are improvements, not shortcuts:

1. **Reuse `redactMessage`/`redactUri`** from `@/service/pluginSources/pluginSourceRedact` instead of creating `pluginMarketplaceRedact.ts` (DRY — it already covers basic-auth, query tokens, `_authToken`, bearer).
2. **Reuse `applyDirectoryLimits`** from `@/service/pluginSources/pluginSourceLimits` for the local-folder fetcher.
3. **Create `parsePluginIdentifier`** at `src/service/pluginMarketplaces/parsePluginIdentifier.ts` — it does **not** exist in this worktree (the tech design assumed it did; verified missing).
4. **Thread `source` override** through `PluginSourceRequest → PluginSourceProvenance → installFromLocalRoot` so marketplace installs record `source = "marketplace"`. The tech design only mentioned `sourceMeta`; this is required because `installFromLocalRoot` otherwise derives `source` from the plugin's own manifest.
5. **IPC handlers return raw values**; the `registerAiValidatedHandler` wrapper builds the `{status,msg,data}` envelope and runs the AI gate (fail-closed). The tech design's handler snippets already reflect this, but it's called out here to prevent a reviewer adding redundant try/catch.
6. **`git-subdir`** entry sources return `marketplace-plugin-source-unsupported` (Phase 2).
7. **Auto-update** is stored (`autoUpdate` column) but never acted on in MVP; the Marketplaces tab does not surface a toggle (avoids false affordance — tech design open decision #5).
8. **AI gate**: marketplace browsing stays AI-gated for consistency with existing plugin IPC (tech design open decision #1). If product later wants browsing without AI, split browse channels to `registerValidatedHandler`.

---

**Plan complete.** Two execution options:

1. **Subagent-driven (recommended)** — dispatch a fresh subagent per task via `superpowers:subagent-driven-development`, review between tasks.
2. **Inline execution** — execute tasks in this session via `superpowers:executing-plans`, with batch checkpoints.

Pick an approach and the first task to start (Task 1 has no dependencies).

