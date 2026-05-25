# Phase 7: Frontend Badges and UI - Discussion Log

**Date:** 2026-05-25
**Areas discussed:** 4 of 4

---

## Area 1: Badge rendering approach

### Q1: How should file operation badges appear in the AI chat?
- Options: After message content (Vue component), New message type (FILE_OPERATION), Inline in v-html content
- **Selected:** After message content (Recommended) — Clean separation from v-html, testable component, minimal AiChatBox changes

### Q2: How should badges be laid out when multiple operations occur?
- Options: Horizontal chip row, Vertical card stack, Collapsible group
- **Selected:** Horizontal chip row (Recommended) — Compact like GitHub commit status badges, good for 1-5 operations

---

## Area 2: Diff data availability

### Q1: How should diff content be available for expandable diff preview?
- Options: Extend record with diff field, Compute diff on demand, Skip diff and show count only
- **Selected:** Extend record with diff field (Recommended) — FileEditResult.diff already exists, minimal backend change (add diff?: string to FileOperationRecord and thread result.diff in ToolExecutor emit)

---

## Area 3: Badge-to-message correlation

### Q1: How should records be correlated to the correct assistant message?
- Options: Real-time subscription + most recent, toolCallId matching, Separate changes panel
- **Selected:** Real-time subscription + most recent (Recommended) — Subscribe to AI_FILE_OPERATION in AiChatBox, store in reactive Map, attach to active/most-recent assistant message

---

## Area 4: Click-to-open mechanism

### Q1: How should clicking a badge open a file in the system editor?
- Options: New dedicated IPC channel, Extend existing OPENDIRECTORY
- **Selected:** New dedicated IPC channel (Recommended) — AI_FILE_OPEN with shell.openPath(), add to preload invoke whitelist. OPENDIRECTORY is a directory picker, not suitable.

---

## Summary

All 4 selected areas discussed. Key decisions:
- Separate Vue component after message content (horizontal chip row)
- Extend FileOperationRecord with diff field (backward compatible)
- Real-time IPC subscription with reactive Map storage
- New AI_FILE_OPEN IPC channel for click-to-open

## Deferred Ideas

None — discussion stayed within phase scope.

---

*Discussion completed: 2026-05-25*
