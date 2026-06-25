# Research: AI-Assisted Email Template Creation

**Feature**: AI-Assisted Email Template Creation
**Branch**: `001-ai-email-template`
**Date**: 2025-02-16
**Status**: Phase 0 - Research & Technical Decisions

## Overview

This document captures technical research findings and architecture decisions for implementing AI-assisted email template generation in aiFetchly. All decisions align with the tech stack architecture documented in [docs/ai-email-template-tech-stack-architecture.md](../../docs/ai-email-template-tech-stack-architecture.md).

---

## Decision 1: AI Endpoint Strategy

### Decision: **Phase 1 - Option B (Reuse Chat Stream), Phase 2 - Option A (Dedicated Endpoint)**

### Rationale

**Phase 1 (MVP)**: Use existing `/api/ai/ask/stream` endpoint with custom system prompt
- **Zero backend changes** required - can ship immediately
- Leverages proven streaming infrastructure
- Client-side parsing sufficient for initial release
- Faster time-to-market for core functionality

**Phase 2 (Production)**: Migrate to dedicated `/api/ai/email-template/generate` endpoint
- **Structured output** with guaranteed `{ title, content }` schema
- Server-side validation of template variables
- Email-specific prompt engineering and guardrails
- Independent versioning and tuning
- Better error handling and retry logic

### Implementation Approach

#### Phase 1 Implementation (Option B)

**System Prompt for Email Template Generation**:
```typescript
const EMAIL_TEMPLATE_SYSTEM_PROMPT = `
You are an expert email marketing copywriter. Generate professional email templates based on user descriptions.

CRITICAL RULES:
1. Use ONLY these template variables (exactly as shown):
   - {$send_time} - Current timestamp
   - {$sender} - Sender email/name
   - {$receiver_email} - Recipient email address
   - {$receiver_name} - Recipient's first name for personalization
   - {$url} - Source URL or landing page
   - {$description} - Contextual description
   - {$company_name} - Recipient's company name
   - {$campaign_name} - Campaign reference name
   - {$unsubscribe_link} - Unsubscribe URL (mandatory for compliance)

2. NEVER invent new variable names like {$first_name} or {$date}
3. Always include {$unsubscribe_link} at the bottom for CAN-SPAM/GDPR compliance
4. Output format:
   Subject: [email subject line]

   [email body content]

5. Match the requested tone: {tone}
6. Follow {templateType} best practices
7. Keep emails concise (150-300 words)
8. Use professional formatting (short paragraphs, clear CTAs)
`;
```

**Request Structure**:
```typescript
interface ChatRequest {
    message: string;  // User prompt + RAG context
    systemPrompt: string;  // EMAIL_TEMPLATE_SYSTEM_PROMPT
    useRAG: boolean;
    ragLimit: number;
    stream: true;  // Enable streaming
}
```

**Response Parsing**:
```typescript
function parseEmailTemplateFromStream(streamContent: string): { title: string; content: string } {
    const lines = streamContent.split('\n');
    let title = '';
    let content = '';
    let foundSubject = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.toLowerCase().startsWith('subject:')) {
            title = line.replace(/^subject:\s*/i, '').trim();
            foundSubject = true;
        } else if (foundSubject) {
            content += line + '\n';
        }
    }

    return { title: title.trim(), content: content.trim() };
}
```

#### Phase 2 Migration Path (Option A)

**Dedicated Endpoint Request**:
```typescript
interface EmailTemplateGenerateRequest {
    prompt: string;
    tone: 'formal' | 'casual' | 'friendly' | 'professional';
    templateType: 'cold_outreach' | 'follow_up' | 'newsletter' | 'promotion' | 'custom';
    useRAG: boolean;
    ragLimit: number;
    existingTitle?: string;  // For refinement mode
    existingContent?: string;  // For refinement mode
}
```

**Dedicated Endpoint Response**:
```typescript
interface EmailTemplateGenerateResponse {
    title: string;
    content: string;
    description?: string;
    variablesUsed: string[];  // List of {$varname} used
    status: 'success' | 'partial' | 'error';
}
```

### Migration Checklist

- [ ] Add `generateEmailTemplate()` method to `AiChatApi`
- [ ] Update IPC handler to use new endpoint
- [ ] Add response schema validation (zod)
- [ ] Update error handling for structured responses
- [ ] Add logging for `variablesUsed`
- [ ] Remove client-side parsing logic
- [ ] Update tests for new contract

---

## Decision 2: RAG Integration Pattern

### Decision: **Local RAG via RagSearchModule with Context Enhancement**

### Rationale

- **Consistent with existing AI chat** pattern (ai-chat-ipc.ts lines 178-210)
- **Local processing** - no need for remote RAG calls
- **Fast fallback** if RAG fails or returns no results
- **User control** via RAG toggle in UI
- **Privacy-preserving** - documents stay local

### Implementation Pattern

```typescript
// In IPC handler (ai-email-template-ipc.ts)
const ragSearchModule = new RagSearchModule();
await ragSearchModule.initialize();

// Build RAG query from user prompt
const ragQuery = `email template: ${requestData.prompt}`;

let enhancedPrompt = requestData.prompt;
if (requestData.useRAG) {
    try {
        const searchRequest: SearchRequest = {
            query: ragQuery,
            options: {
                limit: requestData.ragLimit || 5
            }
        };

        const searchResponse = await ragSearchModule.search(searchRequest);

        if (searchResponse.results.length > 0) {
            // Format RAG context
            const ragContext = searchResponse.results
                .map((result, index) => {
                    return `[Context ${index + 1}: ${result.document.name}]\n${result.content}`;
                })
                .join('\n\n');

            // Prepend context to user prompt
            enhancedPrompt = `You are generating an email template using the following contextual information from the user's knowledge base:\n\n${ragContext}\n\n---\n\nUser request: ${requestData.prompt}`;
        }
    } catch (ragError) {
        console.error('RAG search failed, proceeding without RAG context:', ragError);
        // Continue with original prompt
    }
}

// Send enhanced prompt to AI
const chatRequest = {
    message: enhancedPrompt,
    systemPrompt: EMAIL_TEMPLATE_SYSTEM_PROMPT,
    // ... other params
};
```

### RAG Content Types to Index

| Document Type | Purpose | Example Filename |
|---------------|---------|------------------|
| Past successful templates | Style/tone reference | `successful-templates.md` |
| Brand guidelines | Voice and terminology | `brand-voice-guide.pdf` |
| Product descriptions | Accurate claims | `product-catalog.csv` |
| Industry best practices | Format/structure | `email-best-practices.md` |
| Compliance rules | Legal requirements | `email-compliance.md` |

### RAG Query Enhancement Strategies

**Basic**: `email template: {userPrompt}`
**Enriched**: `email template tone:{tone} type:{templateType} - {userPrompt}`
**Context-Aware**: Include campaign info, target audience, industry

---

## Decision 3: Template Variable System

### Decision: **Central Variable Registry + Post-Process Validation**

### Rationale

- **Single source of truth** for allowed variables
- **Type-safe** access across frontend/backend
- **Validation at multiple layers** (AI output, UI display, email sending)
- **Easy to extend** with new variables
- **Backward compatible** with existing templates

### Variable Registry

```typescript
// src/config/emailTemplateVariables.ts
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

export type EmailTemplateVariable = typeof EMAIL_TEMPLATE_VARIABLES[keyof typeof EMAIL_TEMPLATE_VARIABLES];

export const EMAIL_TEMPLATE_VARIABLE_LIST: EmailTemplateVariable[] = Object.values(EMAIL_TEMPLATE_VARIABLES);

export const VARIABLE_DESCRIPTIONS: Record<EmailTemplateVariable, string> = {
    [EMAIL_TEMPLATE_VARIABLES.SEND_TIME]: 'Replaced with send timestamp (YYYY-MM-DD HH:mm:ss)',
    [EMAIL_TEMPLATE_VARIABLES.SENDER]: 'Replaced with sender email/name',
    [EMAIL_TEMPLATE_VARIABLES.RECEIVER_EMAIL]: 'Replaced with recipient email address',
    [EMAIL_TEMPLATE_VARIABLES.RECEIVER_NAME]: 'Replaced with recipient name for personalization',
    [EMAIL_TEMPLATE_VARIABLES.URL]: 'Replaced with source URL or landing page',
    [EMAIL_TEMPLATE_VARIABLES.DESCRIPTION]: 'Replaced with contextual description',
    [EMAIL_TEMPLATE_VARIABLES.COMPANY_NAME]: 'Replaced with recipient company name',
    [EMAIL_TEMPLATE_VARIABLES.CAMPAIGN_NAME]: 'Replaced with campaign name',
    [EMAIL_TEMPLATE_VARIABLES.UNSUBSCRIBE_LINK]: 'Replaced with functional unsubscribe URL (required for compliance)'
};
```

### Validation Strategy

**Layer 1: AI Output Validation**
```typescript
function validateAIOutputVariables(content: string): { isValid: boolean; invalidVariables: string[]; sanitizedContent: string } {
    const invalidVariables: string[] = [];

    // Extract all {$...} patterns
    const variablePattern = /\{\$([^}]+)\}/g;
    let match;

    while ((match = variablePattern.exec(content)) !== null) {
        const variable = `{$${match[1]}}`;
        if (!EMAIL_TEMPLATE_VARIABLE_LIST.includes(variable as EmailTemplateVariable)) {
            invalidVariables.push(variable);
        }
    }

    // Auto-correction: strip invalid variables
    let sanitizedContent = content;
    if (invalidVariables.length > 0) {
        console.warn(`Invalid variables found: ${invalidVariables.join(', ')}`);
        sanitizedContent = content.replace(variablePattern, (matched) => {
            return EMAIL_TEMPLATE_VARIABLE_LIST.includes(matched as EmailTemplateVariable) ? matched : '';
        });
    }

    return {
        isValid: invalidVariables.length === 0,
        invalidVariables,
        sanitizedContent
    };
}
```

**Layer 2: UI Display Validation**
```typescript
// In Vue component, warn user about invalid variables
const { isValid, invalidVariables } = validateAIOutputVariables(generatedContent);
if (!isValid) {
    showWarning(`Template contains invalid variables: ${invalidVariables.join(', ')}. They have been removed.`);
}
```

**Layer 3: Email Sending Validation**
```typescript
// Ensure all variables are populated before sending
function validateTemplateVariables(previewData: EmailTemplatePreviewdata): { isValid: boolean; missing: string[] } {
    const required: (keyof EmailTemplatePreviewdata)[] = ['TplTitle', 'TplContent', 'Sender', 'Receiver'];
    const missing: string[] = [];

    for (const field of required) {
        if (!previewData[field]) {
            missing.push(field);
        }
    }

    return { isValid: missing.length === 0, missing };
}
```

### Extended Variable Implementation

**Current Variables** (existing):
- `{$send_time}`, `{$sender}`, `{$receiver_email}`, `{$url}`, `{$description}`

**New Variables** (to add):
- `{$receiver_name}` - Recipient's first name
- `{$company_name}` - Recipient's company
- `{$campaign_name}` - Campaign reference
- `{$unsubscribe_link}` - Compliance requirement

**Implementation Plan**:

1. **Type Definitions** (`src/entityTypes/emailmarketingType.ts`):
   ```typescript
   export interface EmailTemplatePreviewdata {
       TplTitle: string;
       TplContent: string;
       Sender: string;
       Receiver: string;
       Url?: string;
       Description?: string;
       // NEW FIELDS:
       ReceiverName?: string;
       CompanyName?: string;
       CampaignName?: string;
       UnsubscribeLink?: string;
   }
   ```

2. **Replacement Logic** (`src/views/utils/emailFun.ts`):
   ```typescript
   export function convertVariableInTemplate(data: EmailTemplatePreviewdata): EmailTemplatedata {
       let content = data.TplContent;
       let title = data.TplTitle;

       // Existing replacements
       content = content.replace(/{\$sender}/g, data.Sender);
       content = content.replace(/{\$receiver_email}/g, data.Receiver);
       content = content.replace(/{\$send_time}/g, formatSendTime());
       content = content.replace(/{\$url}/g, data.Url || '');
       content = content.replace(/{\$description}/g, data.Description || '');

       // NEW replacements
       content = content.replace(/{\$receiver_name}/g, data.ReceiverName || '');
       content = content.replace(/{\$company_name}/g, data.CompanyName || '');
       content = content.replace(/{\$campaign_name}/g, data.CampaignName || '');
       content = content.replace(/{\$unsubscribe_link}/g, data.UnsubscribeLink || generateUnsubscribeLink());

       // Apply same replacements to title
       title = applyReplacements(title, data);

       return { TplTitle: title, TplContent: content };
   }
   ```

3. **UI Buttons** (`templatedetail.vue`):
   - Add buttons for new variables in variable insertion panel
   - Organize by category: "Required", "Optional", "Compliance"

---

## Decision 4: Streaming UI Implementation

### Decision: **Real-time Character-by-Character Display with Stop Button**

### Rationale

- **Reduced perceived latency** - users see progress immediately
- **Early stopping** - users can abort if generation goes off-track
- **Industry standard** - matches ChatGPT, Claude, other AI tools
- **Better UX** for long-form content (email templates can be 150-300 words)

### Implementation Pattern

**Backend (IPC Handler)**:
```typescript
// In ai-email-template-ipc.ts
ipcMain.on(AI_EMAIL_TEMPLATE_GENERATE_STREAM, async (event, requestData): Promise<void> => {
    // 1. Check AI enable
    const tokenService = new Token();
    const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
    if (!aiEnabled || aiEnabled === 'false' || aiEnabled === '0') {
        event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
            status: false,
            msg: 'AI features are not enabled. Please upgrade your plan.',
            data: null
        });
        return;
    }

    // 2. Initialize RAG if enabled
    let enhancedPrompt = requestData.prompt;
    if (requestData.useRAG) {
        // ... RAG search logic
    }

    // 3. Stream generation
    const aiChatApi = new AiChatApi();
    let fullContent = '';
    let isStopped = false;

    // Stop handler
    const stopHandler = (): void => {
        isStopped = true;
        console.log('Generation stopped by user');
    };

    // Listen for stop event
    ipcMain.once(AI_EMAIL_TEMPLATE_STOP, stopHandler);

    try {
        await aiChatApi.streamMessage({
            message: enhancedPrompt,
            systemPrompt: EMAIL_TEMPLATE_SYSTEM_PROMPT,
            useRAG: requestData.useRAG
        }, (streamEvent: StreamEvent) => {
            if (isStopped) return;

            if (streamEvent.type === 'chunk') {
                fullContent += streamEvent.content;

                // Send chunk to renderer
                event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, {
                    content: streamEvent.content,
                    fullContent: fullContent
                });
            } else if (streamEvent.type === 'complete') {
                // Parse final result
                const { title, content } = parseEmailTemplateFromStream(fullContent);

                // Validate variables
                const { isValid, invalidVariables, sanitizedContent } = validateAIOutputVariables(content);

                event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, {
                    status: true,
                    data: {
                        title,
                        content: sanitizedContent,
                        variablesUsed: extractVariables(sanitizedContent),
                        hasInvalidVariables: !isValid,
                        invalidVariables
                    }
                });
            }
        });
    } catch (error) {
        event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
            status: false,
            msg: error instanceof Error ? error.message : 'Generation failed',
            data: null
        });
    } finally {
        ipcMain.removeListener(AI_EMAIL_TEMPLATE_STOP, stopHandler);
    }
});
```

**Frontend (Vue Component)**:
```vue
<template>
  <v-expansion-panels v-model="panelOpen" class="ai-generation-panel">
    <v-expansion-panel>
      <v-expansion-panel-title>
        <v-btn @click.stop="togglePanel" color="primary">
          {{ t('emailMarketing.generateWithAI') || 'Generate with AI' }}
        </v-btn>
      </v-expansion-panel-title>

      <v-expansion-panel-text>
        <!-- Prompt Input -->
        <v-textarea
          v-model="prompt"
          :label="t('emailMarketing.promptLabel') || 'Describe your email template'"
          rows="4"
          counter="500"
        />

        <!-- Configuration -->
        <v-row>
          <v-col cols="6">
            <v-select
              v-model="tone"
              :items="toneOptions"
              :label="t('emailMarketing.tone') || 'Tone'"
            />
          </v-col>
          <v-col cols="6">
            <v-select
              v-model="templateType"
              :items="templateTypeOptions"
              :label="t('emailMarketing.templateType') || 'Template Type'"
            />
          </v-col>
        </v-row>

        <!-- Advanced Section -->
        <v-expansion-annels>
          <v-expansion-panel>
            <v-expansion-panel-title>
              {{ t('emailMarketing.advanced') || 'Advanced Options' }}
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-checkbox
                v-model="useRAG"
                :label="t('emailMarketing.useKnowledgeBase') || 'Use knowledge base for context'"
              />
              <v-checkbox
                v-if="hasExistingContent"
                v-model="refineMode"
                :label="t('emailMarketing.refineExisting') || 'Refine existing template'"
              />
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- Streaming Output -->
        <div v-if="isStreaming" class="streaming-output">
          <v-progress-linear indeterminate color="primary" />
          <div class="streamed-content">{{ streamedContent }}</div>
          <v-btn @click="stopGeneration" color="error">
            {{ t('emailMarketing.stopGenerating') || 'Stop Generating' }}
          </v-btn>
        </div>

        <!-- Action Buttons -->
        <v-row class="mt-4">
          <v-col>
            <v-btn
              @click="generateTemplate"
              :loading="isStreaming"
              :disabled="!prompt"
              color="primary"
              block
            >
              {{ t('emailMarketing.generate') || 'Generate' }}
            </v-btn>
          </v-col>
        </v-row>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { windowInvoke } from '@/views/api/preload';

const { t } = useI18n();

const panelOpen = ref(false);
const prompt = ref('');
const tone = ref('professional');
const templateType = ref('cold_outreach');
const useRAG = ref(false);
const refineMode = ref(false);

const isStreaming = ref(false);
const streamedContent = ref('');

// Listen for streaming chunks
const handleChunk = (_event: unknown, data: { content: string; fullContent: string }): void => {
    streamedContent.value = data.fullContent;
};

// Listen for completion
const handleComplete = (_event: unknown, response: { status: boolean; data: GeneratedTemplate }): void => {
    isStreaming.value = false;
    if (response.status) {
        // Populate template fields
        emit('generated', response.data);
        panelOpen.value = false; // Collapse panel
    }
};

// Listen for errors
const handleError = (_event: unknown, error: { status: boolean; msg: string }): void => {
    isStreaming.value = false;
    alert(error.msg || t('emailMarketing.generationFailed') || 'Generation failed');
};

const generateTemplate = async (): Promise<void> => {
    isStreaming.value = true;
    streamedContent.value = '';

    // Detect if refinement mode (existing content)
    const hasContent = tplTitle.value || tplcontent.value;

    windowInvoke('AI_EMAIL_TEMPLATE_GENERATE_STREAM', {
        prompt: prompt.value,
        tone: tone.value,
        templateType: templateType.value,
        useRAG: useRAG.value,
        refineMode: hasContent ? refineMode.value : false,
        existingTitle: hasContent ? tplTitle.value : undefined,
        existingContent: hasContent ? tplcontent.value : undefined
    });
};

const stopGeneration = (): void => {
    windowInvoke('AI_EMAIL_TEMPLATE_STOP');
};

onMounted(() => {
    window.api.on(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
    window.api.on(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
    window.api.on(AI_EMAIL_TEMPLATE_ERROR, handleError);
});

onUnmounted(() => {
    window.api.removeListener(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, handleChunk);
    window.api.removeListener(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, handleComplete);
    window.api.removeListener(AI_EMAIL_TEMPLATE_ERROR, handleError);
});
</script>
```

### Performance Considerations

- **Chunk size**: Aim for 10-50 character chunks for smooth display
- **Frame rate**: Throttle UI updates to 30-60 FPS (avoid excessive re-renders)
- **Memory**: Clear streaming buffer after generation completes
- **Timeout**: Set 30-second timeout for generation

---

## Decision 5: Auto-Detect Refinement Mode

### Decision: **Automatic Detection Based on Existing Content + Manual Override**

### Rationale

- **Intuitive UX** - users don't need to think about "create" vs "refine"
- **Reduces clicks** - one button works for both scenarios
- **Explicit override** - "Start fresh" option when auto-detect is wrong

### Detection Logic

```typescript
function shouldUseRefinementMode(template: EmailTemplate): boolean {
    // Has meaningful content (not just whitespace)
    const hasTitle = template.TplTitle && template.TplTitle.trim().length > 0;
    const hasContent = template.TplContent && template.TplContent.trim().length > 50;

    return hasTitle || hasContent;
}
```

### User Flow

1. **User opens empty template** → Auto: Create mode
2. **User opens existing template** → Auto: Refine mode
3. **User wants to start over** → Click "Start fresh" button → Switches to Create mode

### Implementation

```typescript
// In IPC handler
const isRefinementMode = shouldUseRefinementMode(existingTemplate);

if (isRefinementMode && !requestData.startFresh) {
    // Refinement mode: send existing content as context
    const refinementContext = `
Current template title: ${existingTemplate.TplTitle}
Current template content: ${existingTemplate.TplContent}

User wants to: ${requestData.prompt}

Please improve/rewrite the template based on the user's request while maintaining the template variable structure.
    `;

    enhancedPrompt = refinementContext;
}
```

---

## Decision 6: Error Handling & Resilience

### Decision: **Multi-Layer Error Handling with Graceful Degradation**

### Error Scenarios

| Scenario | Detection | Response | User Experience |
|----------|-----------|----------|------------------|
| **AI disabled** | Check USER_AI_ENABLED at IPC entry | Return error immediately | Show upgrade prompt with link |
| **RAG failure** | Catch block in RAG search | Log warning, continue without RAG | Proceed with generation (may mention "basic mode") |
| **Network timeout** | Stream timeout after 30s | Return partial content | Show "Generation incomplete, retry?" |
| **Invalid variables** | Post-process validation | Strip invalid variables | Warn user about removed variables |
| **AI service error** | HTTP error response | Return structured error | Show "Service unavailable, please try again" |
| **Malformed response** | Parse fails | Retry once, then fail | Show "Generation failed, please try again" |
| **User stops generation** | Listen for stop event | Cancel stream, keep partial | Show partial result with "Continue?" option |

### Error Message Strategy

**User-Facing Messages** (i18n):
```typescript
const ERROR_MESSAGES = {
    AI_DISABLED: 'AI features are not enabled. Please upgrade your plan to access AI template generation.',
    RAG_FAILED: 'Knowledge base search failed. Generating with basic template.',
    TIMEOUT: 'Generation timed out. Partial content saved. Would you like to retry?',
    INVALID_VARIABLES: 'Template contained unsupported variables: {variables}. They have been removed.',
    SERVICE_UNAVAILABLE: 'AI service is temporarily unavailable. Please try again in a few moments.',
    NETWORK_ERROR: 'Network connection failed. Please check your internet and try again.',
    PARSE_ERROR: 'Generation produced invalid format. Please try again with a clearer prompt.'
};
```

### Retry Strategy

```typescript
async function generateWithRetry(request: GenerateRequest, maxRetries = 1): Promise<GenerateResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await generateTemplate(request);
        } catch (error) {
            lastError = error as Error;

            // Don't retry on certain errors
            if (error instanceof AIDisabledError) {
                throw error;  // Won't help to retry
            }

            if (attempt < maxRetries) {
                console.warn(`Generation attempt ${attempt + 1} failed, retrying...`);
                await delay(1000 * (attempt + 1));  // Exponential backoff
            }
        }
    }

    throw lastError;
}
```

---

## Decision 7: Testing Strategy

### Decision: **Multi-Layer Testing with Streaming Support**

### Test Layers

**1. Unit Tests (Vitest - test/vitest/main/)**
- IPC handler logic (AI enable check, RAG integration)
- Variable validation functions
- Template parsing functions
- Error handlers

**2. Integration Tests (Vitest - test/vitest/main/)**
- Full IPC flow with mocked AI API
- RAG search integration
- Variable replacement end-to-end
- Streaming with mocked events

**3. E2E Tests (Playwright - test/e2e/)**
- User workflow: open template → click Generate → enter prompt → see streaming → save
- Refinement mode workflow
- Error scenarios (AI disabled, network failure)
- Variable validation UI
- Internationalization (test with multiple languages)

### Streaming Test Pattern

```typescript
// test/vitest/main/ai-email-template-ipc.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import { mockAiChatApi } from '../mocks/aiChatApi';

describe('AI Email Template Generation - Streaming', () => {
    beforeEach(() => {
        // Mock IPC
        vi.mock('electron', () => ({
            ipcMain: {
                on: vi.fn(),
                once: vi.fn(),
                removeListener: vi.fn()
            }
        }));

        // Mock AI API
        mockAiChatApi.streamMessage = vi.fn(async (request, callback) => {
            // Simulate streaming chunks
            callback({ type: 'chunk', content: 'Subject: ' });
            await delay(10);
            callback({ type: 'chunk', content: 'Welcome' });
            await delay(10);
            callback({ type: 'chunk', content: ' to our product!' });
            await delay(10);
            callback({ type: 'complete' });
        });
    });

    it('should stream content character-by-character', async () => {
        const chunks: string[] = [];
        const mockEvent = {
            sender: {
                send: vi.fn((channel, data) => {
                    if (channel === 'AI_EMAIL_TEMPLATE_GENERATE_CHUNK') {
                        chunks.push(data.content);
                    }
                })
            }
        };

        // Trigger IPC handler
        const handler = getAIEmailTemplateHandler();
        await handler(mockEvent, { prompt: 'test', tone: 'professional' });

        // Verify chunks received
        expect(chunks).toEqual(['Subject: ', 'Welcome', ' to our product!']);
    });

    it('should stop generation when user clicks stop', async () => {
        const mockEvent = {
            sender: {
                send: vi.fn()
            }
        };

        const handler = getAIEmailTemplateHandler();
        const promise = handler(mockEvent, { prompt: 'test' });

        // Simulate stop event
        ipcMain.emit('AI_EMAIL_TEMPLATE_STOP');

        await promise;

        // Verify generation stopped early
        expect(mockEvent.sender.send).not.toHaveBeenCalledWith(
            'AI_EMAIL_TEMPLATE_GENERATE_COMPLETE',
            expect.any(Object)
        );
    });
});
```

### E2E Test Pattern

```typescript
// test/e2e/ai-template-generation.spec.ts
import { test, expect } from '@playwright/test';

test.describe('AI Email Template Generation', () => {
    test.beforeEach(async ({ page }) => {
        // Login as AI-enabled user
        await page.goto('/emailmarketing/template');
        await page.fill('[data-testid="email"]', 'test@example.com');
        await page.click('[data-testid="login"]');
    });

    test('should generate template from prompt', async ({ page }) => {
        // Open new template
        await page.click('[data-testid="new-template"]');
        await page.waitForSelector('[data-testid="template-detail"]');

        // Click AI Generate button
        await page.click('[data-testid="ai-generate-button"]');
        await page.waitForSelector('[data-testid="ai-generation-panel"]');

        // Enter prompt
        await page.fill('[data-testid="ai-prompt"]', 'Cold outreach email for SaaS product');
        await page.selectOption('[data-testid="ai-tone"]', 'professional');
        await page.selectOption('[data-testid="ai-type"]', 'cold_outreach');

        // Click Generate
        await page.click('[data-testid="ai-generate"]');

        // Wait for streaming to start
        await page.waitForSelector('[data-testid="streaming-output"]', { timeout: 5000 });

        // Wait for completion
        await page.waitForSelector('[data-testid="template-title"][value!=""', { timeout: 30000 });
        await page.waitForSelector('[data-testid="template-content"][value!=""', { timeout: 5000 });

        // Verify generated content
        const title = await page.inputValue('[data-testid="template-title"]');
        const content = await page.inputValue('[data-testid="template-content"]');

        expect(title).toBeTruthy();
        expect(content).toBeTruthy();
        expect(content).toContain(/\{\$[a-z_]+\}/);  // Contains variables

        // Verify no invalid variables
        const invalidVariables = content.match(/\{\$[^}]+\}/g)?.filter(
            v => !EMAIL_TEMPLATE_VARIABLE_LIST.includes(v)
        );
        expect(invalidVariables?.length || 0).toBe(0);
    });

    test('should show upgrade prompt when AI disabled', async ({ page }) => {
        // Login as free user (no AI)
        await page.goto('/emailmarketing/template');
        await page.fill('[data-testid="email"]', 'free@example.com');
        await page.click('[data-testid="login"]');

        // Open new template
        await page.click('[data-testid="new-template"]');

        // Click AI Generate button
        await page.click('[data-testid="ai-generate-button"]');

        // Verify upgrade prompt shown
        await page.waitForSelector('[data-testid="upgrade-prompt"]');
        await expect(page.textContent('[data-testid="upgrade-prompt"]')).toContain('upgrade');
    });
});
```

---

## Summary of Key Decisions

| Decision | Choice | Impact |
|----------|--------|--------|
| **AI Endpoint** | Phase 1: Option B (chat stream), Phase 2: Option A (dedicated) | Fast MVP, structured production |
| **RAG Integration** | Local RagSearchModule with context enhancement | Privacy, fast fallback |
| **Variable System** | Central registry + post-process validation | Type-safe, extensible |
| **Streaming UI** | Real-time character display with stop button | Better UX, early stopping |
| **Refinement Mode** | Auto-detect + manual override | Intuitive, flexible |
| **Error Handling** | Multi-layer with graceful degradation | Resilient, user-friendly |
| **Testing** | Unit + Integration + E2E with streaming support | Comprehensive coverage |

---

## Next Steps

With research complete and decisions made, proceed to **Phase 1: Design & Contracts**

1. Generate `data-model.md` - Define all types and entities
2. Generate `contracts/` directory - IPC channels, type definitions
3. Generate `quickstart.md` - Developer setup guide
4. Update agent context - Add new technologies to Claude context

All technical unknowns have been resolved. Architecture is aligned with existing aiFetchly patterns and documented tech stack.
