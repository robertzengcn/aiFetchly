---
phase: 12-translations-and-validation
plan: 01
subsystem: i18n
tags: [translations, yandex-maps, i18n]
dependency_graph:
  requires: []
  provides: [yandexMaps-i18n-namespace]
  affects: [yandex-maps-scraper-ui]
tech-stack:
  added: []
  patterns: [vue-i18n translation namespace]
key-files:
  created: []
  modified:
    - src/views/lang/en.ts
    - src/views/lang/zh.ts
    - src/views/lang/es.ts
    - src/views/lang/fr.ts
    - src/views/lang/de.ts
    - src/views/lang/ja.ts
decisions:
  - Placed yandexMaps namespace after googleMaps, before fileOperations in all language files
  - Mirrored googleMaps key structure for shared keys, added Yandex-specific keys (language_label, region_label, status_captcha)
metrics:
  duration: 5m
  completed: "2026-05-26"
  tasks: 2
  files: 6
---

# Phase 12 Plan 01: Yandex Maps Translation Namespace Summary

Added yandexMaps i18n translation namespace with all 49 UI text keys to all 6 language files, enabling the Yandex Maps Scraper page to display localized text.

## Completed Tasks

| Task | Name | Commit | Files Modified |
|------|------|--------|----------------|
| 1 | Add yandexMaps namespace to en.ts | 9939c45 | src/views/lang/en.ts |
| 2 | Add yandexMaps namespace to zh, es, fr, de, ja | c1e0283 | src/views/lang/zh.ts, es.ts, fr.ts, de.ts, ja.ts |

## What Was Done

### Task 1: en.ts
Inserted yandexMaps namespace object after the googleMaps closing brace and before fileOperations. Contains all 49 translation keys extracted from the Vue page t() calls, including:
- Yandex-specific keys not in Google Maps: language_label, language_placeholder, language_hint, region_label, region_placeholder, region_hint, status_captcha
- Yandex-specific values: status_loading ("Loading Yandex Maps..."), view_on_maps ("View on Yandex Maps"), description references Yandex Maps
- Location placeholders changed to Yandex-relevant examples (Moscow, Saint Petersburg, Russia)

### Task 2: zh.ts, es.ts, fr.ts, de.ts, ja.ts
Added the same yandexMaps namespace with all 49 keys and accurate native translations to each language file. All keys match en.ts structure exactly.

## Verification Results

1. yandexMaps: namespace exists exactly once in each of the 6 language files
2. yandexMaps.title key found in all 6 files
3. All 49 t('yandexMaps.X') keys from the Vue page have matching entries in en.ts
4. Key count is consistent: 49 keys in all 6 files

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- All 6 modified files verified present on disk
- Commit 9939c45 (en.ts) verified in git log
- Commit c1e0283 (zh,es,fr,de,ja) verified in git log
