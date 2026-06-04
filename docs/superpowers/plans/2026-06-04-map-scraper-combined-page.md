# Combined Map Scraper Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one visible Map Scraper page with a Google/Yandex provider switch and hidden provider deep links.

**Architecture:** Add a small provider helper for route/provider normalization, then create one combined Vue page that dispatches to the existing Google Maps and Yandex Maps frontend API wrappers. Update router entries and translations without changing scraper IPC, workers, or database layers.

**Tech Stack:** Vue 3 Composition API, TypeScript, Vue Router, Vuetify, vue-i18n, Vitest.

---

## File Structure

- Create `src/views/pages/map-scraper/mapScraperProvider.ts`: provider union type, normalization helper, and display metadata.
- Create `test/vitest/utilitycode/mapScraperProvider.test.ts`: focused tests for provider normalization and labels.
- Create `src/views/pages/map-scraper/index.vue`: combined search/history/results page.
- Modify `src/views/router/index.ts`: render the combined page at `/map-scraper`, keep Google/Yandex hidden child links with provider props.
- Modify `src/views/lang/{en,zh,es,fr,de,ja}.ts`: add `mapScraper` strings used by the new page.

### Task 1: Provider Helper

**Files:**
- Create: `test/vitest/utilitycode/mapScraperProvider.test.ts`
- Create: `src/views/pages/map-scraper/mapScraperProvider.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  getMapScraperProviderMeta,
  normalizeMapScraperProvider,
} from "@/views/pages/map-scraper/mapScraperProvider";

describe("map scraper provider helpers", () => {
  test("normalizes supported route provider values", () => {
    expect(normalizeMapScraperProvider("google")).toBe("google");
    expect(normalizeMapScraperProvider("yandex")).toBe("yandex");
  });

  test("defaults unsupported provider values to google", () => {
    expect(normalizeMapScraperProvider(undefined)).toBe("google");
    expect(normalizeMapScraperProvider("bing")).toBe("google");
  });

  test("returns stable display metadata for each provider", () => {
    expect(getMapScraperProviderMeta("google").accountWhere).toBe("Google");
    expect(getMapScraperProviderMeta("yandex").accountWhere).toBe("Yandex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/mapScraperProvider.test.ts`

Expected: fail because `mapScraperProvider.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type MapScraperProvider = "google" | "yandex";

export interface MapScraperProviderMeta {
  value: MapScraperProvider;
  label: "Google Maps" | "Yandex Maps";
  accountWhere: "Google" | "Yandex";
  icon: string;
  filenamePrefix: string;
}

export function normalizeMapScraperProvider(
  provider: unknown
): MapScraperProvider {
  return provider === "yandex" ? "yandex" : "google";
}

export function getMapScraperProviderMeta(
  provider: MapScraperProvider
): MapScraperProviderMeta {
  if (provider === "yandex") {
    return {
      value: "yandex",
      label: "Yandex Maps",
      accountWhere: "Yandex",
      icon: "mdi-map-search-outline",
      filenamePrefix: "yandex-maps",
    };
  }

  return {
    value: "google",
    label: "Google Maps",
    accountWhere: "Google",
    icon: "mdi-map-marker-radius",
    filenamePrefix: "google-maps",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/mapScraperProvider.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add test/vitest/utilitycode/mapScraperProvider.test.ts src/views/pages/map-scraper/mapScraperProvider.ts
git commit -m "test: cover map scraper provider helpers"
```

### Task 2: Combined Vue Page, Routing, And Translations

**Files:**
- Create: `src/views/pages/map-scraper/index.vue`
- Modify: `src/views/router/index.ts`
- Modify: `src/views/lang/en.ts`
- Modify: `src/views/lang/zh.ts`
- Modify: `src/views/lang/es.ts`
- Modify: `src/views/lang/fr.ts`
- Modify: `src/views/lang/de.ts`
- Modify: `src/views/lang/ja.ts`

- [ ] **Step 1: Create combined page**

Create `src/views/pages/map-scraper/index.vue` by merging the existing Google/Yandex page behavior into one provider-aware component. Use `provider` state, provider-specific API dispatch, shared result/history tables, and show Yandex language/region fields only when selected.

- [ ] **Step 2: Update routing**

Point `/map-scraper` at the combined component. Add hidden `google` and `yandex` children that render the same component with `initialProvider` props.

- [ ] **Step 3: Update translations**

Add `mapScraper` keys in all six language files for the new header, provider switch, shared form labels, Yandex-only labels, results, history, and actions.

- [ ] **Step 4: Run verification**

Run:

```bash
./node_modules/.bin/vitest --config vite.utilityCode.config.mjs test/vitest/utilitycode/mapScraperProvider.test.ts
yarn vue-check
```

Expected: provider tests pass; Vue type checking reports no errors for edited files.

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/map-scraper/index.vue src/views/router/index.ts src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat: combine map scraper pages"
```
