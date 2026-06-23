# Custom Context Directive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject a user-editable blob of text (stored in SystemSetting) as a system message into every AI chat v2 request, so the user can give the AI persistent custom instructions like CLAUDE.md does for Claude Code.

**Architecture:** Add a single `textarea`-type row to the existing `system_setting` table (seeded via `settinggroupInit.ts`). Inside `AIChatContextAssembler.assemble()`, read the row via the already-injected `SystemSettingModule` and push a `{role:'system'}` message right after the base system prompt. Add a new `'textarea'` branch to the System Settings UI.

**Tech Stack:** TypeScript, Vue 3 + Vuetify, Vitest, TypeORM, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-06-23-custom-context-directive-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/entityTypes/systemsettingType.ts` | Modify | Add `'textarea'` to type unions |
| `src/config/settinggroupInit.ts` | Modify | Export new key const + seed new row under `ai_preferences` |
| `src/service/AIChatContextAssembler.ts` | Modify | Read setting and inject as system message |
| `src/views/pages/systemsetting/index.vue` | Modify | Render `v-textarea` for `'textarea'` type |
| `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` | Modify | 2 new keys × 6 files |
| `test/vitest/main/AIChatContextAssembler.test.ts` | Create | Unit tests for injection behavior |

---

## Task 1: Add `'textarea'` to type unions and export the new setting key

**Files:**
- Modify: `src/entityTypes/systemsettingType.ts:7`
- Modify: `src/entityTypes/systemsettingType.ts:33`
- Modify: `src/config/settinggroupInit.ts:44` (add new export after existing one)

- [ ] **Step 1: Update `SystemSettingDisplay` type union (line 7)**

Edit `src/entityTypes/systemsettingType.ts` line 7 from:

```typescript
    type: 'input' | 'select' | 'radio' | 'checkbox'|'file';  // new field for input type
```

to:

```typescript
    type: 'input' | 'select' | 'radio' | 'checkbox'|'file'|'textarea';  // new field for input type
```

- [ ] **Step 2: Update `SystemSettingdf` type union (line 33)**

Edit the same file line 33 from:

```typescript
    type: 'input' | 'select' | 'radio' | 'checkbox'|'toggle'|'file';
```

to:

```typescript
    type: 'input' | 'select' | 'radio' | 'checkbox'|'toggle'|'file'|'textarea';
```

- [ ] **Step 3: Add new setting key export**

Edit `src/config/settinggroupInit.ts` — after line 44 (`export const ai_memory_injection_enabled = "user_ai_memory_injection";`) add:

```typescript
export const ai_custom_context_directive = "user_ai_custom_context_directive";
```

Naming follows the existing pattern: const name describes intent, string value uses the `user_ai_*` DB-key prefix.

- [ ] **Step 4: Typecheck**

Run: `yarn vue-check` (or `yarn tsc`)
Expected: PASS, no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/entityTypes/systemsettingType.ts src/config/settinggroupInit.ts
git commit -m "feat(setting): add 'textarea' type and ai_custom_context_directive key"
```

---

## Task 2: Write failing tests for the injection behavior (TDD red phase)

**Files:**
- Create: `test/vitest/main/AIChatContextAssembler.test.ts`

- [ ] **Step 1: Verify vitest config picks up `test/vitest/main/*.test.ts`**

Run: `cat /home/robertzeng/project/aiFetchly/vitest.config.ts 2>/dev/null || cat /home/robertzeng/project/aiFetchly/vite.config.ts 2>/dev/null | head -40`

Confirm the include glob covers `test/vitest/main/**/*.test.ts`. If it does not, ask the user how tests in that directory are typically run before continuing.

- [ ] **Step 2: Write the test file with three cases (inject / empty / whitespace)**

Create `test/vitest/main/AIChatContextAssembler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { SystemSettingModule } from "@/modules/SystemSettingModule";
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import { ai_custom_context_directive } from "@/config/settinggroupInit";

// Disable all external dependencies the constructor news up.
// We only care about the messages array the assembler builds.
function silenceDeps() {
  vi.spyOn(AIChatSessionMemoryModule.prototype, "getByConversation").mockResolvedValue(null);
  vi.spyOn(AIChatCompactModule.prototype, "getActiveSummary").mockResolvedValue(null);
  vi.spyOn(AIChatV2Module.prototype, "getConversationMessages").mockResolvedValue([]);
  vi.spyOn(AIUserMemoryRetrievalService.prototype, "retrieve").mockResolvedValue({
    contextBlock: "",
    memories: [],
  });
}

function baseInput() {
  return {
    conversationId: "conv-test",
    currentUserMessage: "hello",
    baseSystemPrompt: "you are helpful",
    mode: "chat" as const,
  };
}

describe("AIChatContextAssembler — custom context directive", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    silenceDeps();
  });

  it("injects directive as a system message right after the base system prompt", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockResolvedValue(
      "Always answer concisely."
    );

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    expect(result.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(result.messages[1]).toEqual({
      role: "system",
      content: "Always answer concisely.",
    });
    // And the getSettingValue call targeted the new key
    expect(SystemSettingModule.prototype.getSettingValue).toHaveBeenCalledWith(
      ai_custom_context_directive
    );
  });

  it("skips injection when the setting value is null or empty", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockResolvedValue("");

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    expect(result.messages).toHaveLength(2); // base prompt + user message
    expect(result.messages[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
  });

  it("skips injection when the setting value is whitespace-only", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockResolvedValue("   \n  ");

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `yarn vitest run test/vitest/main/AIChatContextAssembler.test.ts`

Expected: **FAIL**. The first test will fail because `messages[1]` will be the user message (`"hello"`), not the directive (it's not yet injected). The other two tests may pass coincidentally — that's fine; the first test failure proves the feature isn't implemented yet.

- [ ] **Step 4: Commit the failing test**

```bash
git add test/vitest/main/AIChatContextAssembler.test.ts
git commit -m "test(ai-context): add failing tests for custom context directive injection"
```

---

## Task 3: Implement the injection logic (TDD green phase)

**Files:**
- Modify: `src/service/AIChatContextAssembler.ts:8` (import)
- Modify: `src/service/AIChatContextAssembler.ts:105` (injection block)

- [ ] **Step 1: Add the import**

Edit `src/service/AIChatContextAssembler.ts` line 8 from:

```typescript
import { ai_memory_injection_enabled } from "@/config/settinggroupInit";
```

to:

```typescript
import {
  ai_memory_injection_enabled,
  ai_custom_context_directive,
} from "@/config/settinggroupInit";
```

- [ ] **Step 2: Add the injection block**

In `src/service/AIChatContextAssembler.ts`, immediately after line 105 (`messages.push({ role: "system", content: systemPrompt });`) and before the comment on line 107 (`// Durable user memory injection.`), insert:

```typescript

    // User-defined custom context directive (CLAUDE.md-style).
    // Placed right after the base system prompt so static user instructions
    // win over conversation-specific retrieved memories. Read failures must
    // never break the AI chat — degrade to no-injection.
    try {
      const customDirective = await this.systemSettings.getSettingValue(
        ai_custom_context_directive
      );
      if (customDirective && customDirective.trim().length > 0) {
        messages.push({ role: "system", content: customDirective });
      }
    } catch (err) {
      console.error(
        "[ai-chat-context] failed to read custom context directive:",
        err
      );
    }
```

- [ ] **Step 3: Run the tests to confirm they pass**

Run: `yarn vitest run test/vitest/main/AIChatContextAssembler.test.ts`

Expected: **PASS** — all 3 tests green.

- [ ] **Step 4: Typecheck**

Run: `yarn vue-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatContextAssembler.ts
git commit -m "feat(ai-context): inject custom context directive as system message"
```

---

## Task 4: Extend tests with error-path coverage

**Files:**
- Modify: `test/vitest/main/AIChatContextAssembler.test.ts`

- [ ] **Step 1: Add a fourth test for the read-failure path**

Append inside the `describe` block in `test/vitest/main/AIChatContextAssembler.test.ts`:

```typescript
  it("skips injection and does not throw when the setting read fails", async () => {
    vi.spyOn(SystemSettingModule.prototype, "getSettingValue").mockRejectedValue(
      new Error("sqlite locked")
    );

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble(baseInput());

    // Should not throw, should not inject the directive
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
  });
```

- [ ] **Step 2: Run the tests**

Run: `yarn vitest run test/vitest/main/AIChatContextAssembler.test.ts`

Expected: **PASS** — all 4 tests green. The error-path test passes because the implementation wraps the read in try/catch.

- [ ] **Step 3: Commit**

```bash
git add test/vitest/main/AIChatContextAssembler.test.ts
git commit -m "test(ai-context): cover custom directive read-failure path"
```

---

## Task 5: Seed the new setting row in `settinggroupInit.ts`

**Files:**
- Modify: `src/config/settinggroupInit.ts:229-245` (the `ai_preferences` group's `items` array)

- [ ] **Step 1: Append the new item to the `ai_preferences.items` array**

Edit `src/config/settinggroupInit.ts` — the `ai_preferences` group starts at line 226. Inside its `items: [ ... ]` array (after the `ai_memory_injection_enabled` entry that ends at line 244, before the closing `]` on line 245), add:

```typescript
      {
        // User-authored static instructions injected into every AI chat
        // request. Empty by default = no injection. Mirrors CLAUDE.md.
        key: ai_custom_context_directive,
        value: "",
        description: "ai-custom-context-directive-description",
        type: "textarea",
      },
```

- [ ] **Step 2: Typecheck**

Run: `yarn vue-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/config/settinggroupInit.ts
git commit -m "feat(setting): seed ai_custom_context_directive row in ai_preferences group"
```

---

## Task 6: Add the `v-textarea` branch to the System Settings UI

**Files:**
- Modify: `src/views/pages/systemsetting/index.vue:116` (insert new branch before the `v-else` default)

- [ ] **Step 1: Insert the `textarea` branch**

Edit `src/views/pages/systemsetting/index.vue`. After the `'toggle'` branch closes on line 125 (`</div>`) and before the default-branch comment on line 128 (`<!-- Default to text input if the type is unrecognized -->`), insert:

```vue

                  <div v-else-if="setting.type === 'textarea'">
                    <!-- NOTE: textarea saves on @blur, not on every keystroke.
                         The 'input' type uses @update:model-value which would
                         fire IPC on every char for a textarea — too noisy. -->
                    <v-textarea
                      :model-value="setting.value"
                      :placeholder="t('system_settings.ai-custom-context-directive-placeholder') || 'Static instructions prepended to every AI chat request (like CLAUDE.md)...'"
                      variant="outlined"
                      density="comfortable"
                      rows="6"
                      auto-grow
                      counter
                      maxlength="8000"
                      hide-details="auto"
                      :loading="loadingSettings[setting.id]"
                      @blur="updateSetting(setting.id, $event.target.value)"
                    ></v-textarea>
                    <v-divider></v-divider>
                  </div>
```

- [ ] **Step 2: Verify Vue template compiles**

Run: `yarn vue-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/systemsetting/index.vue
git commit -m "feat(ui): add textarea branch in System Settings for custom context directive"
```

---

## Task 7: Add i18n keys to all 6 language files

**Files:**
- Modify: `src/views/lang/en.ts` (around line 1144 — inside `system_settings: { ... }`)
- Modify: `src/views/lang/zh.ts` (in the equivalent `system_settings:` block)
- Modify: `src/views/lang/es.ts`
- Modify: `src/views/lang/fr.ts`
- Modify: `src/views/lang/de.ts`
- Modify: `src/views/lang/ja.ts`

**Note:** All six files have a `system_settings: { ... }` namespace (English reference at `src/views/lang/en.ts:1125-1144`). Add three new keys to each file inside that block:
- `"user_ai_custom_context_directive"` — the setting title (used by `t('system_settings.' + setting.key)`)
- `"ai-custom-context-directive-description"` — the description (used by `t('system_settings.' + setting.description)`)
- `"ai-custom-context-directive-placeholder"` — placeholder shown inside the textarea

- [ ] **Step 1: Update `en.ts`**

Add inside `system_settings: { ... }` in `src/views/lang/en.ts`:

```typescript
    "user_ai_custom_context_directive": "Custom Context Directive",
    "ai-custom-context-directive-description": "Static text injected into every AI chat request, after the system prompt. Clear the box to disable.",
    "ai-custom-context-directive-placeholder": "e.g. Always answer concisely. Prefer bullet points. We sell shoes to US customers.",
```

- [ ] **Step 2: Update `zh.ts`**

Add inside `system_settings: { ... }` in `src/views/lang/zh.ts`:

```typescript
    "user_ai_custom_context_directive": "自定义上下文指令",
    "ai-custom-context-directive-description": "在每次 AI 聊天请求中注入的静态文本（位于系统提示词之后）。清空输入框即可停用。",
    "ai-custom-context-directive-placeholder": "例如：始终简洁回答。优先使用要点。我们面向美国客户销售鞋类。",
```

- [ ] **Step 3: Update `es.ts`**

```typescript
    "user_ai_custom_context_directive": "Directiva de Contexto Personalizada",
    "ai-custom-context-directive-description": "Texto estático inyectado en cada solicitud de chat de IA, después del prompt del sistema. Vacía el cuadro para desactivarlo.",
    "ai-custom-context-directive-placeholder": "p.ej. Responde siempre de forma concisa. Prefiere viñetas. Vendemos calzado a clientes en EE.UU.",
```

- [ ] **Step 4: Update `fr.ts`**

```typescript
    "user_ai_custom_context_directive": "Directive de Contexte Personnalisée",
    "ai-custom-context-directive-description": "Texte statique injecté dans chaque requête de chat IA, après le prompt système. Videz le champ pour désactiver.",
    "ai-custom-context-directive-placeholder": "ex. Réponds toujours concis. Préfère les pulettes. Nous vendons des chaussures aux clients américains.",
```

- [ ] **Step 5: Update `de.ts`**

```typescript
    "user_ai_custom_context_directive": "Benutzerdefinierte Kontext-Direktive",
    "ai-custom-context-directive-description": "Statischer Text, der in jede KI-Chat-Anfrage eingefügt wird, nach dem System-Prompt. Feld leeren, um zu deaktivieren.",
    "ai-custom-context-directive-placeholder": "z.B. Antworte immer prägnant. Bevorzuge Aufzählungspunkte. Wir verkaufen Schuhe an US-Kunden.",
```

- [ ] **Step 6: Update `ja.ts`**

```typescript
    "user_ai_custom_context_directive": "カスタムコンテキスト指示",
    "ai-custom-context-directive-description": "AI チャットリクエストに毎回注入される静的テキスト（システムプロンプトの後）。無効にするには入力欄を空にしてください。",
    "ai-custom-context-directive-placeholder": "例：常に簡潔に答える。箇条書きを優先。米国顾客に靴を販売。",
```

- [ ] **Step 7: Typecheck**

Run: `yarn vue-check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(i18n): add custom context directive translations for all 6 languages"
```

---

## Task 8: Manual verification (QA)

This task has no code changes — it is a verification checklist to run after all code is committed.

- [ ] **Step 1: Start the dev server**

Run: `yarn dev`

- [ ] **Step 2: Verify the new setting appears in the UI**

1. Open the app.
2. Navigate to System Settings → `ai_preferences` group.
3. Verify a new item titled "Custom Context Directive" (or translated equivalent) appears.
4. Verify it renders as a multi-line textarea (not a single-line input).

- [ ] **Step 3: Verify save/load round-trip**

1. Type several lines of multi-line text into the textarea.
2. Click elsewhere (trigger blur).
3. Reload the app / refresh the System Settings page.
4. Verify the saved content persists, including newlines.

- [ ] **Step 4: Verify injection actually happens**

1. Set the directive to something distinctive, e.g. `Always start your reply with "BANANA".`
2. Open AI chat v2.
3. Send a simple message like `hello`.
4. Verify the AI's reply starts with `BANANA` (or clearly follows the directive).
5. Optional: enable debug logging in `AIChatContextAssembler` temporarily to confirm the messages array contains the directive at index 1.

- [ ] **Step 5: Verify the disable path**

1. Clear the textarea, trigger blur.
2. Send another chat message.
3. Verify the AI no longer follows the previous directive.

- [ ] **Step 6: Verify other AI surfaces are unaffected**

1. Trigger keyword generation or any other AI IPC handler.
2. Verify it behaves as before (no directive leakage — feature is chat-v2-only by design).

- [ ] **Step 7: Run the full test suite**

Run: `yarn vitest run test/vitest/main/AIChatContextAssembler.test.ts && yarn test`
Expected: All tests pass.

---

## Self-Review Notes

**Spec coverage:**
- ✓ Single textarea in SystemSetting → Tasks 1, 5
- ✓ Type union extension → Task 1
- ✓ Injection right after base prompt, before durable memory → Task 3
- ✓ Skip on empty / whitespace → Task 3 (implementation), Tasks 2 & 4 (tests)
- ✓ Degraceful degradation on read failure → Task 3 (try/catch), Task 4 (test)
- ✓ No new IPC channel → confirmed (reuses `SYSTEM_SETTING_UPDATE`)
- ✓ UI textarea branch → Task 6
- ✓ i18n in all 6 languages → Task 7
- ✓ 80%+ test coverage for the new code → Tasks 2 & 4 (4 test cases covering inject, empty, whitespace, error)
- ✓ Conventional commit format, atomic commits per logical unit → each task ends with its own commit

**Placeholders:** none.

**Type consistency:** `ai_custom_context_directive` used identically in Tasks 1, 2, 3, 5. `'textarea'` used identically in Tasks 1, 5, 6. Setting key string value `"user_ai_custom_context_directive"` matches between Task 1 export and Task 7 i18n key.
