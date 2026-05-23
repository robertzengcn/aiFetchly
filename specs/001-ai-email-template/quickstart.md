# Quickstart Guide: AI-Assisted Email Template Creation

**Feature**: AI-Assisted Email Template Creation
**Branch**: `001-ai-email-template`
**Date**: 2025-02-16
**For**: Developers implementing this feature

## Overview

This guide helps developers quickly understand and implement the AI-assisted email template generation feature. For detailed architecture and data models, see [research.md](./research.md) and [data-model.md](./data-model.md).

---

## What You're Building

A feature that allows marketing users to generate professional email templates using AI natural language prompts. Users describe what they want, and the system generates complete email templates (subject + body) with proper template variables.

**Key Capabilities**:
- ✅ Generate email templates from text descriptions
- ✅ Real-time streaming output (see text appear as it generates)
- ✅ Optional RAG integration (brand guidelines, past templates)
- ✅ Auto-detect refinement mode (improve existing templates)
- ✅ Variable validation (only use approved variables)
- ✅ AI feature access control (subscription-based)
- ✅ 6-language support (en, zh, es, fr, de, ja)

---

## Prerequisites

### Development Environment

```bash
# Node.js version
node --version  # Should be v18+ (check package.json)

# Install dependencies
yarn install

# Verify Electron builds
yarn build
```

### Required Knowledge

- **Electron IPC** - Main/renderer process communication
- **Vue 3 Composition API** - Frontend components
- **Vuetify 3** - UI components
- **TypeScript** - Type-safe development
- **Streaming APIs** - Server-Sent Events (SSE)
- **RAG (Retrieval-Augmented Generation)** - Vector search basics

---

## Architecture in 3 Minutes

### Three-Layer Architecture

```
┌──────────────────────────────────────────────────┐
│  Renderer Process (Vue UI)                      │
│  templatedetail.vue                             │
│  - Inline expansion panel with textarea         │
│  - Tone/type selectors, RAG toggle              │
│  - Streaming content display                    │
└──────────────┬───────────────────────────────────┘
               │ IPC calls
               ▼
┌──────────────────────────────────────────────────┐
│  Main Process (Business Logic)                  │
│  ai-email-template-ipc.ts                       │
│  - Check USER_AI_ENABLED (MANDATORY)            │
│  - RagSearchModule.search() if enabled          │
│  - AiChatApi.streamMessage()                    │
│  - Parse streaming response                     │
│  - Validate template variables                  │
└──────────────┬───────────────────────────────────┘
               │ HTTP/SSE
               ▼
┌──────────────────────────────────────────────────┐
│  Remote AI Server                               │
│  /api/ai/ask/stream                             │
│  (Phase 1: reuse chat stream)                   │
└──────────────────────────────────────────────────┘
```

### Key Patterns

1. **AI Enable Check**: MUST be first line in IPC handler
2. **Module/Model Pattern**: Never access DB directly in IPC
3. **Error Handling**: Always return `CommonMessage<T>` format
4. **Streaming**: Use `ipcMain.on` for streaming, `ipcMain.handle` for request/response
5. **i18n**: Use `useI18n()` with fallback: `t('key') || 'English text'`

---

## Implementation Checklist

### Phase 1: Core Generation (P1)

#### Infrastructure

- [ ] **Add IPC channels** (`src/config/channellist.ts`)
  ```typescript
  export const AI_EMAIL_TEMPLATE_GENERATE_STREAM = 'ai-email-template:generate-stream';
  export const AI_EMAIL_TEMPLATE_GENERATE_CHUNK = 'ai-email-template:generate-chunk';
  export const AI_EMAIL_TEMPLATE_GENERATE_COMPLETE = 'ai-email-template:generate-complete';
  export const AI_EMAIL_TEMPLATE_ERROR = 'ai-email-template:error';
  export const AI_EMAIL_TEMPLATE_STOP = 'ai-email-template:stop';
  ```

- [ ] **Create variable registry** (`src/config/emailTemplateVariables.ts`)
  ```typescript
  export const EMAIL_TEMPLATE_VARIABLES = {
      SEND_TIME: '{$send_time}',
      SENDER: '{$sender}',
      RECEIVER_EMAIL: '{$receiver_email}',
      RECEIVER_NAME: '{$receiver_name}',
      URL: '{$url}',
      DESCRIPTION: '{$description}',
      COMPANY_NAME: '{$company_name}',
      CAMPAIGN_NAME: '{$campaign_name}',
      UNSUBSCRIBE_LINK: '{$unsubscribe_link}'
  } as const;
  ```

- [ ] **Add TypeScript types** (`src/entityTypes/emailmarketingType.ts`)
  - `AIEmailTemplateRequest`
  - `AIEmailTemplateResponse`
  - `EmailTemplateTone` (enum)
  - `EmailTemplateType` (enum)

#### Backend (Main Process)

- [ ] **Create IPC handler** (`src/main-process/communication/ai-email-template-ipc.ts`)
  ```typescript
  import { Token } from '@/modules/token';
  import { USER_AI_ENABLED } from '@/config/usersetting';

  ipcMain.on(AI_EMAIL_TEMPLATE_GENERATE_STREAM, async (event, data) => {
      // 1. Check AI enable FIRST
      const tokenService = new Token();
      const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
      if (!aiEnabled || aiEnabled === 'false') {
          event.sender.send(AI_EMAIL_TEMPLATE_ERROR, { msg: 'AI features not enabled...' });
          return;
      }

      // 2. RAG integration (if useRAG=true)
      // 3. Call AiChatApi.streamMessage()
      // 4. Parse response, validate variables
      // 5. Send chunks via AI_EMAIL_TEMPLATE_GENERATE_CHUNK
  });
  ```

- [ ] **Add variable validation**
  ```typescript
  function validateAIOutputVariables(content: string): ValidationResult {
      const invalidVars = content.match(/\{\$[^}]+\}/g)?.filter(
          v => !EMAIL_TEMPLATE_VARIABLE_LIST.includes(v)
      );
      return { isValid: invalidVars.length === 0, invalidVariables: invalidVars };
  }
  ```

- [ ] **Parse email from stream**
  ```typescript
  function parseEmailTemplateFromStream(content: string): { title, content } {
      // Split by "Subject:" line
      // First line = title, rest = content
  }
  ```

#### Frontend (Renderer)

- [ ] **Add AI generation UI** (`src/views/pages/emailmarketing/template/templatedetail.vue`)
  ```vue
  <v-expansion-annels v-model="aiPanelOpen">
    <v-expansion-panel>
      <v-expansion-panel-title>
        <v-btn @click="toggleAIPanel">Generate with AI</v-btn>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-textarea v-model="prompt" label="Describe your email" />
        <v-select v-model="tone" :items="['formal','casual','friendly','professional']" />
        <v-select v-model="templateType" :items="['cold_outreach','follow_up','newsletter','promotion']" />

        <!-- Advanced section -->
        <v-expansion-annels>
          <v-expansion-panel title="Advanced">
            <v-checkbox v-model="useRAG" label="Use knowledge base" />
          </v-expansion-panel>
        </v-expansion-annels>

        <!-- Streaming output -->
        <div v-if="isStreaming" class="streaming-output">
          <div class="content">{{ streamedContent }}</div>
          <v-btn @click="stopGeneration" color="error">Stop</v-btn>
        </div>

        <v-btn @click="generate" :loading="isStreaming">Generate</v-btn>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-annels>
  ```

- [ ] **Add frontend API** (`src/views/api/emailmarketing.ts`)
  ```typescript
  export async function generateAIEmailTemplate(data: AIEmailTemplateRequest) {
      return new Promise((resolve, reject) => {

          // Listen for chunks
          window.api.on(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, (event, data) => {
              updateStreamingContent(data.fullContent);
          });

          // Listen for complete
          window.api.on(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, (event, response) => {
              resolve(response.data);
          });

          // Listen for error
          window.api.on(AI_EMAIL_TEMPLATE_ERROR, (event, error) => {
              reject(error);
          });

          // Send request
          windowInvoke(AI_EMAIL_TEMPLATE_GENERATE_STREAM, data);
      });
  }
  ```

#### Testing

- [ ] **Unit tests** (`test/vitest/main/ai-email-template-ipc.test.ts`)
  - Test AI enable check
  - Test RAG integration
  - Test variable validation
  - Test parsing logic

- [ ] **E2E tests** (`test/e2e/ai-template-generation.spec.ts`)
  - Test full user workflow
  - Test streaming display
  - Test error scenarios
  - Test AI disable behavior

---

## Common Tasks

### Add a New Template Variable

**1. Update registry** (`src/config/emailTemplateVariables.ts`):
```typescript
export const EMAIL_TEMPLATE_VARIABLES = {
    // ... existing variables
    NEW_VARIABLE: '{$new_variable}'
} as const;
```

**2. Add replacement logic** (`src/views/utils/emailFun.ts`):
```typescript
content = content.replace(/{\$new_variable}/g, data.NewVariable || '');
```

**3. Add UI button** (`templatedetail.vue`):
```vue
<v-btn @click="insertVariable('{$new_variable}')">Insert New Variable</v-btn>
```

**4. Update AI system prompt** to include new variable in allowed list

### Debug Streaming Issues

**1. Check IPC events are firing**:
```typescript
// In renderer, add logging
window.api.on(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, (event, data) => {
    console.log('Chunk received:', data);
});
```

**2. Check main process is sending**:
```typescript
// In IPC handler
console.log('Sending chunk:', { content, fullContent });
event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, { content, fullContent });
```

**3. Verify AI enable check**:
```typescript
const tokenService = new Token();
console.log('AI enabled:', tokenService.getValue(USER_AI_ENABLED));
```

### Test RAG Integration

**1. Verify RAG module initializes**:
```typescript
const ragModule = new RagSearchModule();
await ragModule.initialize();
console.log('RAG initialized');
```

**2. Test search manually**:
```typescript
const results = await ragModule.search({
    query: 'email template',
    options: { limit: 5 }
});
console.log('RAG results:', results);
```

**3. Check context formatting**:
```typescript
const ragContext = results.map(r => `[${r.document.name}]\n${r.content}`).join('\n\n');
console.log('RAG context:', ragContext);
```

---

## Localization

### Adding Translation Keys

**English** (`src/views/lang/en.ts`):
```typescript
export default {
    aiTemplateGeneration: {
        title: 'AI Template Generation',
        generateButton: 'Generate Template',
        generating: 'Generating template...',
        stopButton: 'Stop Generating',
        advanced: 'Advanced Options',
        useKnowledgeBase: 'Use knowledge base for context',
        error: {
            aiDisabled: 'AI features are not enabled. Please upgrade your plan.',
            timeout: 'Generation timed out. Partial content saved.',
            serviceUnavailable: 'AI service is temporarily unavailable.'
        }
    }
}
}
```

**Chinese** (`src/views/lang/zh.ts`):
```typescript
export default {
    aiTemplateGeneration: {
        title: 'AI 模板生成',
        generateButton: '生成模板',
        generating: '正在生成模板...',
        // ... translate all other keys
    }
}
```

**Repeat for**: `es.ts`, `fr.ts`, `de.ts`, `ja.ts`

**Usage in component**:
```vue
<script setup>
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
</script>

<template>
    <v-btn>{{ t('aiTemplateGeneration.generateButton') || 'Generate Template' }}</v-btn>
</template>
```

---

## Development Workflow

### 1. Setup Development Environment

```bash
# Ensure you're on the feature branch
git checkout 001-ai-email-template

# Install dependencies
yarn install

# Start development server
yarn dev
```

### 2. Run Tests

```bash
# Unit tests for IPC handler
yarn testmain  # or vitest - run test/vitest/main/

# E2E tests
yarn test     # or playwright test

# TypeScript type check
yarn tsc
```

### 3. Build and Test Electron App

```bash
# Build for production
yarn build

# Run Electron app
yarn start

# Package for distribution
yarn make
```

### 4. Debug Tips

**Enable verbose logging**:
```typescript
// In main process
console.log('[AI Template] Request:', requestData);

// In renderer
console.log('[AI Template] Streaming:', chunk);
```

**Use Electron DevTools**:
- Press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows/Linux)
- Check Console tab for errors
- Check Network tab for HTTP/SSE traffic
- Use Vue DevTools for component inspection

---

## Common Issues & Solutions

### Issue: "AI features are not enabled" but user has AI access

**Solution**: Check `USER_AI_ENABLED` value in ElectronStore
```typescript
const tokenService = new Token();
console.log('AI enabled value:', tokenService.getValue(USER_AI_ENABLED));
// Should be 'true' (string), not boolean
```

### Issue: Streaming stops mid-generation

**Possible causes**:
1. Network timeout → Check remote server status
2. AI service error → Check error logs in main process
3. RAG search failure → Should fallback gracefully

**Debugging**:
```typescript
// Add timeout handling
const timeout = setTimeout(() => {
    if (!complete) {
        event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
            msg: 'Generation timed out after 30s'
        });
    }
}, 30000);
```

### Issue: Invalid variables not being removed

**Solution**: Check regex pattern in validation
```typescript
// Should match {$variable_name}
const pattern = /\{\$([^}]+)\}/g;
// Ensure replacement logic runs on both title AND content
```

### Issue: RAG returns no results

**Solution**: This is expected - system should continue without RAG
```typescript
if (searchResponse.results.length === 0) {
    console.log('No RAG results, proceeding without context');
    // Continue with original prompt (graceful degradation)
}
```

---

## Performance Considerations

### Streaming Optimization

- **Chunk size**: 10-50 characters for smooth display
- **Frame rate**: Throttle UI updates to 30-60 FPS
- **Memory**: Clear streaming buffer after completion

```typescript
// Throttle UI updates
let lastUpdate = 0;
const throttleMs = 33; // ~30 FPS

if (Date.now() - lastUpdate > throttleMs) {
    event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, { content, fullContent });
    lastUpdate = Date.now();
}
```

### RAG Performance

- **Limit results**: Default to 5, max 20
- **Cache searches**: Consider caching frequent queries
- **Async processing**: Don't block UI during RAG search

---

## Security & Compliance

### AI Feature Access Control

**MANDATORY**: Always check `USER_AI_ENABLED` first in IPC handler
```typescript
// This must be the FIRST check
const tokenService = new Token();
const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
if (!aiEnabled || aiEnabled === 'false' || aiEnabled === '0') {
    return errorResponse;
}
```

### Template Variables

**Validate all variables** to prevent injection attacks:
```typescript
// Only allow predefined variables
const validPattern = /^\{\$[a-z_]+\}$/;
if (!validPattern.test(variable)) {
    throw new Error(`Invalid variable format: ${variable}`);
}
```

### Unsubscribe Link

**Required for compliance** (CAN-SPAM, GDPR):
```typescript
// System prompt must include:
"Always include {$unsubscribe_link} at the bottom for compliance"

// Replacement logic must generate valid URL:
const unsubscribeLink = `https://example.com/unsubscribe?email=${encodeURIComponent(receiver)}`;
```

---

## Next Steps

### After Core Implementation

1. **Add refinement mode** - Detect existing content and auto-switch
2. **Add "Start fresh" button** - Manual override for auto-detect
3. **Enhance RAG** - Index brand docs, past templates, product info
4. **Add analytics** - Log generation requests for metrics
5. **Optimize performance** - Cache, debounce, lazy loading

### Phase 2 Migration (Future)

1. **Dedicated endpoint** - Implement `/api/ai/email-template/generate`
2. **Structured output** - Use zod for response validation
3. **Retry logic** - Automatic retry on transient failures
4. **Versioning** - Track prompt versions, A/B test variations

---

## Resources

### Documentation
- [Feature Specification](./spec.md) - Complete requirements
- [Research Document](./research.md) - Technical decisions
- [Data Model](./data-model.md) - Entity definitions
- [IPC Channels](./contracts/ipc-channels.md) - Channel specs
- [Tech Stack Architecture](../../doc/ai-email-template-tech-stack-architecture.md) - Architecture choices

### Code References
- Existing AI chat: `src/main-process/communication/ai-chat-ipc.ts`
- RAG module: `src/modules/RagSearchModule.ts`
- AI API: `src/api/aiChatApi.ts`
- Variable system: `src/views/utils/emailFun.ts`
- Template UI: `src/views/pages/emailmarketing/template/templatedetail.vue`

### External Documentation
- Vue 3: https://vuejs.org/
- Vuetify 3: https://vuetifyjs.com/
- Electron: https://www.electronjs.org/
- vue-i18n: https://vue-i18n.intlify.dev/

---

## Getting Help

### Stuck? Check These First

1. **Constitution** - Are you following all mandatory patterns? (see CLAUDE.md)
2. **Existing code** - Look at `ai-chat-ipc.ts` for similar patterns
3. **Tests** - Check if existing tests cover similar scenarios
4. **Logs** - Enable verbose logging and check console

### Common Mistakes

- ❌ Accessing database directly in IPC handler → Use Module/Model pattern
- ❌ Forgetting AI enable check → Must be FIRST line in handler
- ❌ Using `any` type → Use proper TypeScript types
- ❌ Not updating all 6 language files → Must update en, zh, es, fr, de, ja
- ❌ Using modal instead of inline expansion → Spec requires inline panel

---

## Summary

This quickstart covers the essentials. For comprehensive details, refer to the full specification and research documents. The feature is well-specified, technically sound, and ready for implementation.

**Estimated Implementation Time**: 2-3 weeks for core feature (Phase 1)
**Testing Time**: 1 week for unit + integration + E2E tests
**Documentation Time**: 2-3 days for code comments and API docs

Good luck with implementation! 🚀
