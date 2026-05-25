# Phase 8: Translations and Polish — Discussion Log

**Date:** 2026-05-25
**Phase:** 08-translations-and-polish

---

## Areas Discussed

### 1. Translation key scope
**Options presented:**
- Minimal (Recommended) — Only 2 hardcoded strings + tooltip, ~3-4 keys
- Standard — Above plus operation type labels, line count, error prefix
- Comprehensive — Above plus aria-labels, alt text, status descriptions

**User selected:** Minimal (Recommended)

**Notes:** Only "Show full diff (N lines)", "Collapse diff", and a chip tooltip need translation keys.

---

### 2. Error message translation
**Options presented:**
- Show as-is (Recommended) — Display record.error from backend directly
- Translate known patterns — Match error patterns to localized strings

**User selected:** Show as-is (Recommended)

**Notes:** Backend errors are developer-oriented English text. No translation needed.

---

### 3. Operation type labels
**Options presented:**
- Icon-only (Recommended) — Keep current design with icons + colors
- Tooltip on hover — Add translated tooltip showing operation type

**User selected:** Icon-only (Recommended)

**Notes:** Icons and colors already communicate operation type. No additional text needed.

---

## Summary

3 decisions captured (D-01 through D-03). All recommended options selected.
Phase is a mechanical translation task — add ~3-4 keys to 6 language files, replace 2 hardcoded strings.

*Discussion completed: 2026-05-25*
