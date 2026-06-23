# Custom Context Directive — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstormed)
**Owner:** robertzeng

## Goal

Give users a single, editable blob of text that is injected into every AI chat v2 request, semantically similar to how `CLAUDE.md` is injected into every Claude Code request. The content is stored in the existing `SystemSetting` table and edited through the existing System Setting UI.

Reference: `docs/claudemd-injection.md` (in the claude-code source) — the CLAUDE.md injection pipeline.

## Non-Goals

- No injection into AI surfaces other than AI chat v2 (keyword generation, AI tools, etc. are out of scope).
- No multiple named slots / per-conversation presets. Single global textarea only.
- No separate enable/disable toggle. Clearing the textarea disables the feature.
- No caching layer. The setting is read fresh on each request, matching the existing `ai_memory_injection_enabled` pattern.

## Architecture

Four components, all changes to existing files:

1. **Setting definition** — A new row seeded in `src/config/settinggroupInit.ts` under the existing `ai_preferences` group.
2. **Injection logic** — In `src/service/AIChatContextAssembler.ts`, inside `assemble()`, immediately after the base system prompt is pushed and before the durable-memory block.
3. **UI support** — Add a `'textarea'` case to `src/views/pages/systemsetting/index.vue` rendering a `v-textarea`. Reuses the existing `SYSTEM_SETTING_UPDATE` IPC.
4. **Type & i18n** — Add `'textarea'` to the `SettingType` union in `src/entityTypes/systemsettingType.ts`. Add new keys to all 6 language files (en/zh/es/fr/de/ja).

### Data Flow

**Read path (every AI chat request):**

```
AI_CHAT_V2_STREAM IPC
  → AIChatQueryEngine.submitMessage()
  → AIChatContextAssembler.assemble()
       1. push base system prompt             (existing)
       2. NEW: read 'ai_custom_context_directive'
            if non-empty → push {role:'system', content: directive}
       3. push durable memory block           (existing)
       4. push history + current user message (existing)
  → AIChatQueryLoop → streaming response
```

**Write path (user edits textarea):** unchanged — `SYSTEM_SETTING_UPDATE` IPC → `SystemSettingModule.updateSetting()` → row updated. The next AI request picks up the new value (no caching; SQLite read is sub-ms).

## Components

### Setting seed (`src/config/settinggroupInit.ts`)

Added to the `ai_preferences` group's `items` array, next to the existing `ai_memory_injection_enabled` entry:

```typescript
{
    key: 'ai_custom_context_directive',
    value: '',
    description: 'ai-custom-context-directive-description',
    type: 'textarea',
},
```

Key naming rationale: `ai_custom_context_directive` (not `_injection`) because the value *is* the directive content, not a toggle. Aligns with the existing `ai_memory_injection_enabled` (the toggle) naming style.

### Type union (`src/entityTypes/systemsettingType.ts`)

```typescript
export type SettingType =
    | 'input' | 'select' | 'radio' | 'checkbox' | 'toggle' | 'file'
    | 'textarea';
```

### Injection logic (`src/service/AIChatContextAssembler.ts`)

Inserted inside `assemble()` after the base system prompt is pushed, before the durable-memory block:

```typescript
// User-defined custom context directive (CLAUDE.md-style).
// Sits between the base prompt and retrieved memories so static
// user instructions take precedence over conversation-specific recall.
const customDirective = await this.systemSettings.getSettingValue(
    'ai_custom_context_directive'
);
if (customDirective && customDirective.trim().length > 0) {
    messages.push({ role: 'system', content: customDirective });
}
```

**Positioning rationale** — Static user-defined instructions sit closer to the base system prompt than dynamically retrieved memories. Memories are conversation-specific and rotated; the directive is stable. This mirrors CLAUDE.md's stable-prefix design (the synthetic message never moves).

**No caching.** `getSettingValue` hits SQLite directly on each `assemble()` call, exactly like the existing `ai_memory_injection_enabled` read. Sub-millisecond; no need to introduce cache invalidation for one row.

**No new IPC channel.** Read happens inside the main process via the injected `systemSettings` dependency; write happens through the existing `SYSTEM_SETTING_UPDATE` channel.

### UI (`src/views/pages/systemsetting/index.vue`)

New branch in the dynamic renderer:

```vue
<v-textarea
    v-else-if="setting.type === 'textarea'"
    v-model="editedValue"
    :label="t('systemsetting.ai-custom-context-directive-description') || 'Custom Context Directive'"
    :placeholder="t('systemsetting.ai-custom-context-directive-placeholder') || 'Static instructions prepended to every AI chat request (like CLAUDE.md)...'"
    variant="outlined"
    density="comfortable"
    rows="8"
    auto-grow
    counter
    maxlength="8000"
    hide-details="auto"
/>
```

The existing save button and `SYSTEM_SETTING_UPDATE` handler work unchanged — they already serialize `editedValue` regardless of input type. **To verify during implementation**: the existing edit/save flow uses a single `editedValue` string ref; confirm it round-trips multi-line content through the IPC layer (expected to work, since IPC payloads are JSON).

### i18n

New keys added to all 6 files (`en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`) under the `systemsetting` namespace:

| Key | English value (other files translated accordingly) |
|---|---|
| `ai-custom-context-directive-description` | `"Custom Context Directive — Static text injected into every AI chat request, after the system prompt. Clear the box to disable."` |
| `ai-custom-context-directive-placeholder` | `"e.g. Always answer concisely. Prefer bullet points. We sell shoes to US customers."` |

Per the project's i18n rule, the English source is the fallback and all 6 files must be updated in the same commit.

## Edge Cases

| Case | Handling |
|---|---|
| Setting row missing (fresh install before seed runs) | `getSettingValue` returns `null` → skip injection |
| Empty string `""` | Skip — never push an empty system message |
| Whitespace-only `"   \n  "` | `.trim().length > 0` guard → skip |
| Read failure (SQLite error) | Catch, log via existing logger, skip. **Never break the AI chat** over a settings read — degrade to no-injection. |
| Very large value (>4k chars) | No hard enforcement in code. UI shows a soft hint and live char count (`counter`, `maxlength="8000"`). Token budget is the model's concern. |
| Concurrent edit during a streaming request | Not a concern — the value is read once per `assemble()` call, before streaming starts. Mid-stream edits apply to the next request. |

## Toggle Semantics

Per the brainstormed decision, there is **no separate enable toggle**. Clearing the textarea disables the feature. This is intentional and keeps the data model to a single row. Mirrors the user's "Single textarea" choice over "Single textarea + enable toggle".

## Testing Strategy

Per the project's 80% coverage rule and TDD workflow (write tests first).

| Layer | Test | Location |
|---|---|---|
| Unit | `AIChatContextAssembler` — given `getSettingValue` returns a non-empty string, the assembled messages array contains a `{role:'system'}` with that content in position 1 (right after base prompt); given `""` or `null`, no such message appears | `test/vitest/main/AIChatContextAssembler.test.ts` (new) |
| Unit | `AIChatContextAssembler` — given a whitespace-only value, no injection message appears (guards the `.trim()` branch) | same file |
| Unit | `AIChatContextAssembler` — given `getSettingValue` rejects, `assemble()` still resolves and the rest of the array is unaffected | same file |
| Integration | Set the SystemSetting row via `SystemSettingModule`, call `assemble()`, assert directive present; clear the row, call again, assert absent | same file or `test/modules/` |
| Manual | UI: open System Settings → ai_preferences → edit textarea → save → send a chat message → observe directive content in the assembled messages (via debug log or test panel) | manual QA |

No new entity, no new IPC channel, no new API method → no new e2e flow to wire up. Existing system-setting IPC tests continue to pass; only a new value of an existing union is added.

## Files Touched

1. `src/config/settinggroupInit.ts` — new setting row in `ai_preferences` group
2. `src/entityTypes/systemsettingType.ts` — add `'textarea'` to `SettingType` union
3. `src/views/pages/systemsetting/index.vue` — new `v-textarea` branch
4. `src/service/AIChatContextAssembler.ts` — injection block (~6 lines) after base system prompt
5. `src/views/lang/{en,zh,es,fr,de,ja}.ts` — 2 keys × 6 files
6. `test/vitest/main/AIChatContextAssembler.test.ts` — new test file

## Why This Approach

- **Approach A (chosen)**: Mirror the existing `ai_memory_injection_enabled` pattern file-for-file. Smallest blast radius, proven pattern, the new `'textarea'` primitive is reusable.
- **Approach B (rejected)**: Generalize the durable-memory injection into a chain of injectors. Cleaner long-term but refactors working code that isn't asking to be refactored — violates YAGNI.
- **Approach C (rejected)**: Store outside SystemSetting in a dedicated entity. Duplicates Model/Module/IPC/UI for one blob; contradicts the stated requirement.

## Open Questions

None at spec time. Implementation may need to confirm:
- Whether the existing `editedValue` ref in `systemsetting/index.vue` round-trips multi-line content through IPC (expected yes; JSON transport).
- Whether `systemSettings` is already injected into `AIChatContextAssembler`'s constructor (the existing memory-injection code on line 107 suggests yes — verify before wiring).
