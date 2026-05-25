# Phase 8: Translations and Polish - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `fileOperations` translation namespace to all 6 supported language files (en, zh, es, fr, de, ja) and replace hardcoded strings in FileOperationBadge.vue with `t()` calls using English fallback pattern. This is a mechanical translation phase — no new features, no new components, no backend changes.

</domain>

<decisions>
## Implementation Decisions

### Translation key scope
- **D-01:** Minimal scope — only translate the 2 existing hardcoded strings in FileOperationBadge.vue ("Show full diff (N lines)", "Collapse diff") plus a chip title/tooltip. Approximately 3-4 keys total in the `fileOperations` namespace. No aria-labels or status descriptions.

### Error message translation
- **D-02:** Display backend error messages as-is (English). No error pattern matching or translation of known error types. Error messages come from Node.js/Electron internals and are developer-oriented.

### Operation type labels
- **D-03:** Keep current icon-only design for operation types on badges. No translated text labels for create/overwrite/edit — icons and colors communicate the type. No tooltip text for operation type.

### Claude's Discretion
- Exact key naming convention within `fileOperations` namespace
- Translations quality for zh, es, fr, de, ja (user can review after)

</decisions>

<specifics>
## Specific Ideas

- Follow the `googleMaps` namespace pattern in en.ts (flat key structure, descriptive snake_case names)
- Use `t('fileOperations.key') || 'English fallback'` pattern as mandated by CLAUDE.md

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Feature Specification
- `doc/README.md` — Full PRD for AI Chat File Operation Recording

### Requirements
- `.planning/REQUIREMENTS.md` — v1.1 requirements with I18N-01..07 for this phase
- `.planning/ROADMAP.md` — Phase 8 goal, success criteria, dependency on Phase 7

### Prior Phase Context
- `.planning/phases/07-frontend-badges-and-ui/07-CONTEXT.md` — Badge component decisions, diff preview, click-to-open

### Key Source Files (MUST read)
- `src/views/components/aiChat/FileOperationBadge.vue` — Component with hardcoded strings to replace
- `src/views/lang/en.ts` — English translations, add `fileOperations` namespace here (follow `googleMaps` pattern at line 1475)
- `src/views/lang/zh.ts` — Chinese translations
- `src/views/lang/es.ts` — Spanish translations
- `src/views/lang/fr.ts` — French translations
- `src/views/lang/de.ts` — German translations
- `src/views/lang/ja.ts` — Japanese translations
- `src/views/lang/index.ts` — i18n configuration

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `googleMaps` namespace in en.ts (lines 1475-1527) — pattern to follow: flat key structure, snake_case names, descriptive values
- `useI18n` from `vue-i18n` — already used throughout the app
- `t('key') || 'English fallback'` — established pattern per CLAUDE.md

### Hardcoded Strings to Replace
In `FileOperationBadge.vue`:
1. Line 142: `"Show full diff ({{ getDiffLines(record.diff).length }} lines)"` — needs `t('fileOperations.show_full_diff')` with count parameter
2. Line 149: `"Collapse diff"` — needs `t('fileOperations.collapse_diff')`

Potential additional keys:
3. Chip title/tooltip for the badge — e.g., `t('fileOperations.open_file') || 'Open file'`

### Established Patterns
- All language files export a default object with nested namespaces
- Key names use snake_case
- English file is the source of truth; other languages mirror its structure exactly

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 08-translations-and-polish*
*Context gathered: 2026-05-25*
