# Custom Context Directive — Test Manual

## Overview

The Custom Context Directive is static text (up to 8000 chars) that the user can set in **Settings → AI Settings**. It is injected as a `{ role: "system" }` message into every AI chat request, placed **right after** the base system prompt but **before** durable memory and compact/conversation summaries.

## Files involved

| Layer | File | Role |
|---|---|---|
| Setting definition | `src/config/settinggroupInit.ts:247-253` | Key `user_ai_custom_context_directive`, type `textarea` |
| UI | `src/views/pages/systemsetting/index.vue:131-143` | `v-textarea` saves on blur |
| Assembly | `src/service/AIChatContextAssembler.ts:110-126` | Reads setting, injects as system message |
| Engine | `src/service/AIChatQueryEngine.ts:145-146` | Calls `AIChatContextAssembler.assemble()` on every turn |

## Test cases

### 1. Save & persist

1. Open **Settings → AI Settings**.
2. Scroll to **"Custom Context Directive"** textarea.
3. Enter: `Always prioritize code readability and maintainability.`
4. **Blur** the textarea (click elsewhere) — save fires on `@blur`.
5. Close and re-open settings.
6. **Verify**: text is still present.

### 2. Functional — AI respects directive

1. Set directive to an observable rule, e.g.: `Start every response with the word PINEAPPLE.`
2. Go to **AI Chat v2**.
3. Send a message.
4. **Verify**: response starts with `PINEAPPLE`.
5. Change directive to: `Respond only in German.`
6. Send another message.
7. **Verify**: response is in German.

### 3. Empty directive = no injection

1. Clear the textarea, blur to save.
2. Start a new **AI Chat v2** conversation.
3. **Verify**: AI behaves normally with no extra static instructions.

### 4. Ordering relative to other context

The directive sits between the base system prompt and durable/compact context.

1. Set directive: `CRITICAL RULE: You always speak like a pirate.`
2. Send a message in an existing conversation that has durable memories.
3. **Verify**: the AI follows the pirate rule even when later context (memories, compact summaries) might conflict.

### 5. Long / multi-line directive

1. Paste a block of structured markdown rules (e.g., 10 bullet points, ~2000 chars).
2. Blur to save.
3. Send a message covering multiple topics.
4. **Verify**: LLM follows all rules.

### 6. Directive change mid-conversation

1. Set directive: `Always use short answers (<3 sentences).`
2. Send a message → verify short answer.
3. Change directive to: `Always write long, detailed answers.`
4. Send another message in **the same conversation**.
5. **Verify**: the new directive applies (the old one is replaced for the new turn).

### 7. Edge — setting read failure degrades gracefully

1. Manually corrupt or remove the `system_setting` row for key `user_ai_custom_context_directive`.
2. Send a message in AI Chat v2.
3. **Verify**: no crash, no injection, chat works normally.
4. Console logs show: `[ai-chat-context] failed to read custom context directive: ...`

### 8. Unit test — `AIChatContextAssembler.assemble()`

```typescript
const assembler = new AIChatContextAssembler();
const result = await assembler.assemble({
  conversationId: "v2-test-1",
  currentUserMessage: "Hello",
  baseSystemPrompt: "You are a helpful assistant.",
  mode: "chat",
});

// result.messages[0].role === "system"         // base system prompt
// result.messages[1].role === "system"         // custom directive (if set)
// result.messages[2].role === "system"         // durable memory / compact
// last message === user message
```

## UAT criteria

- [ ] Directive text persists across app restarts.
- [ ] AI behavior observably changes per the directive content.
- [ ] Empty directive produces no extra system message.
- [ ] Directive changes take effect immediately on the next turn (no restart needed).
- [ ] 8000-char limit enforced in UI.
- [ ] Setting read failure does not break the chat.
