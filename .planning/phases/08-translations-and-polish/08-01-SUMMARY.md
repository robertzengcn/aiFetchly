---
phase: 08-translations-and-polish
plan: 01
status: complete
completed: 2026-05-25
commits:
  - 28d1be0: feat(08-01): add fileOperations i18n namespace to all 6 language files
  - 7476847: feat(08-01): replace hardcoded strings in FileOperationBadge with i18n t() calls
---

# Plan 08-01 Summary

All 2 tasks completed with zero TypeScript errors.

## Task 1: Add fileOperations namespace to all 6 language files
- Added `fileOperations` namespace with 3 keys (show_full_diff, collapse_diff, open_file_tooltip) to en, zh, es, fr, de, ja
- Followed googleMaps namespace pattern — flat snake_case, inserted after googleMaps block
- Parameterized show_full_diff with `{count}` placeholder for vue-i18n

## Task 2: Replace hardcoded strings in FileOperationBadge.vue
- Added `useI18n` import and `const { t } = useI18n()`
- Replaced "Show full diff (N lines)" with `t('fileOperations.show_full_diff', { count })` call
- Replaced "Collapse diff" with `t('fileOperations.collapse_diff')` call
- Added `:title` tooltip to v-chip with `t('fileOperations.open_file_tooltip')`
- All t() calls include English fallback via `||` operator
