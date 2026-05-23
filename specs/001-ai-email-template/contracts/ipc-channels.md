# IPC Channel Definitions

**Feature**: AI-Assisted Email Template Creation
**Branch**: `001-ai-email-template`
**Date**: 2025-02-16

## Overview

This document defines all IPC channels for AI email template generation feature. Channels follow the naming convention `ai-email-template:*` for clarity and consistency.

---

## Channel Constants

**Location**: `src/config/channellist.ts`

```typescript
// AI Email Template Generation Channels
export const AI_EMAIL_TEMPLATE_GENERATE_STREAM = 'ai-email-template:generate-stream';
export const AI_EMAIL_TEMPLATE_GENERATE_CHUNK = 'ai-email-template:generate-chunk';
export const AI_EMAIL_TEMPLATE_GENERATE_COMPLETE = 'ai-email-template:generate-complete';
export const AI_EMAIL_TEMPLATE_ERROR = 'ai-email-template:error';
export const AI_EMAIL_TEMPLATE_STOP = 'ai-email-template:stop';
export const AI_EMAIL_TEMPLATE_VALIDATE = 'ai-email-template:validate';

// Non-streaming variant (for batch/future use)
export const AI_EMAIL_TEMPLATE_GENERATE = 'ai-email-template:generate';
```

---

## Channel Specifications

### 1. AI_EMAIL_TEMPLATE_GENERATE_STREAM

**Type**: `ipcMain.on` (one-way communication for streaming)

**Purpose**: Initiate streaming AI email template generation

**Request Payload**:
```typescript
interface AIEmailTemplateStreamRequest {
    prompt: string;                    // Required: User's email template description
    tone: EmailTemplateTone;           // Required: formal, casual, friendly, professional
    templateType: EmailTemplateType;   // Required: cold_outreach, follow_up, newsletter, promotion, custom
    useRAG?: boolean;                  // Optional: Enable knowledge base search (default: false)
    ragLimit?: number;                 // Optional: Max RAG results (default: 5, range: 1-20)
    startFresh?: boolean;              // Optional: Ignore existing content (default: false)
}
```

**Response Events**:
- `AI_EMAIL_TEMPLATE_GENERATE_CHUNK` - Streaming content chunks
- `AI_EMAIL_TEMPLATE_GENERATE_COMPLETE` - Generation complete with result
- `AI_EMAIL_TEMPLATE_ERROR` - Generation failed

**Handler Location**: `src/main-process/communication/ai-email-template-ipc.ts`

**Example Usage** (Renderer):
```typescript
windowInvoke(AI_EMAIL_TEMPLATE_GENERATE_STREAM, {
    prompt: 'Cold outreach email for SaaS marketing automation tool',
    tone: 'professional',
    templateType: 'cold_outreach',
    useRAG: true,
    ragLimit: 5
});
```

---

### 2. AI_EMAIL_TEMPLATE_GENERATE_CHUNK

**Type**: `ipcRenderer.on` (event from main to renderer)

**Purpose**: Deliver streaming content chunk during generation

**Payload**:
```typescript
interface AIEmailTemplateChunkEvent {
    type: 'chunk';
    content: string;           // New content chunk (10-50 characters)
    fullContent: string;       // Accumulated content so far
}
```

**Example Usage** (Renderer):
```typescript
window.api.on(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, (_event: unknown, data: AIEmailTemplateChunkEvent) => {
    streamedContent.value = data.fullContent;
});
```

---

### 3. AI_EMAIL_TEMPLATE_GENERATE_COMPLETE

**Type**: `ipcRenderer.on` (event from main to renderer)

**Purpose**: Signal generation completion with final result

**Payload**:
```typescript
interface AIEmailTemplateCompleteEvent {
    type: 'complete';
    status: boolean;
    data: {
        title: string;                        // Generated email subject
        content: string;                      // Generated email body
        description?: string;                 // Optional description
        variablesUsed: EmailTemplateVariable[];  // Variables used in template
        hasInvalidVariables: boolean;         // True if invalid vars were removed
        invalidVariables: string[];           // List of removed invalid vars
    };
}
```

**Example Usage** (Renderer):
```typescript
window.api.on(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, (_event: unknown, response: AIEmailTemplateCompleteEvent) => {
    if (response.status) {
        // Populate template fields
        templateTitle.value = response.data.title;
        templateContent.value = response.data.content;

        // Warn about invalid variables if any
        if (response.data.hasInvalidVariables) {
            showWarning(`Removed invalid variables: ${response.data.invalidVariables.join(', ')}`);
        }
    }
});
```

---

### 4. AI_EMAIL_TEMPLATE_ERROR

**Type**: `ipcRenderer.on` (event from main to renderer)

**Purpose**: Report generation errors

**Payload**:
```typescript
interface AIEmailTemplateErrorEvent {
    type: 'error';
    status: false;
    msg: string;          // Human-readable error message
    data: null;
}
```

**Error Messages**:
- `'AI features are not enabled. Please upgrade your plan to access AI features.'`
- `'Generation timed out. Partial content saved.'`
- `'AI service is temporarily unavailable. Please try again later.'`
- `'Network connection failed. Please check your internet and try again.'`
- `'Generation produced invalid format. Please try again with a clearer prompt.'`

**Example Usage** (Renderer):
```typescript
window.api.on(AI_EMAIL_TEMPLATE_ERROR, (_event: unknown, error: AIEmailTemplateErrorEvent) => {
    alert(error.msg);
});
```

---

### 5. AI_EMAIL_TEMPLATE_STOP

**Type**: `ipcMain.on` (one-way from renderer to main)

**Purpose**: Cancel ongoing generation

**Payload**: None (event trigger only)

**Example Usage** (Renderer):
```typescript
const stopGeneration = (): void => {
    windowInvoke(AI_EMAIL_TEMPLATE_STOP);
};
```

---

### 6. AI_EMAIL_TEMPLATE_VALIDATE

**Type**: `ipcMain.handle` (request/response)

**Purpose**: Validate AI-generated content for variable compliance

**Request Payload**:
```typescript
interface AIEmailTemplateValidateRequest {
    title: string;
    content: string;
}
```

**Response Payload**:
```typescript
interface AIEmailTemplateValidateResponse {
    status: boolean;
    data: {
        isValid: boolean;
        invalidVariables: string[];
        sanitizedContent?: string;     // Content with invalid vars removed
        sanitizedTitle?: string;        // Title with invalid vars removed
    } | null;
    msg: string;
}
```

**Example Usage** (Renderer):
```typescript
const validation = await windowInvoke(AI_EMAIL_TEMPLATE_VALIDATE, {
    title: generatedTitle,
    content: generatedContent
});

if (validation.data.isValid) {
    console.log('All variables valid!');
} else {
    console.warn('Invalid variables:', validation.data.invalidVariables);
}
```

---

### 7. AI_EMAIL_TEMPLATE_GENERATE (Non-Streaming)

**Type**: `ipcMain.handle` (request/response, for future use)

**Purpose**: Batch/non-streaming generation (Phase 2)

**Request Payload**: Same as `AI_EMAIL_TEMPLATE_STREAM` request

**Response Payload**:
```typescript
interface AIEmailTemplateGenerateResponse {
    status: boolean;
    data: AIEmailTemplateResponse | null;
    msg: string;
}
```

**Note**: Not used in Phase 1 (streaming approach). Reserved for Phase 2 dedicated endpoint.

---

## Channel Flow Diagram

```
Renderer Process                         Main Process
      │                                        │
      │  AI_EMAIL_TEMPLATE_GENERATE_STREAM     │
      │───────────────────────────────────────>│
      │     { prompt, tone, templateType }     │
      │                                        │
      │                                        │ Check AI enable
      │                                        │ Validate request
      │                                        │ Search RAG (if useRAG)
      │                                        │ Call AI API
      │                                        │
      │  AI_EMAIL_TEMPLATE_GENERATE_CHUNK      │
      │<───────────────────────────────────────│
      │     { content: "Wel", fullContent }    │
      │                                        │
      │  AI_EMAIL_TEMPLATE_GENERATE_CHUNK      │
      │<───────────────────────────────────────│
      │     { content: "come", fullContent }   │
      │                                        │
      │  AI_EMAIL_TEMPLATE_GENERATE_CHUNK      │
      │<───────────────────────────────────────│
      │     { content: " to our...", }         │
      │                                        │
      │  [User clicks Stop]                    │
      │  AI_EMAIL_TEMPLATE_STOP                │
      │───────────────────────────────────────>│
      │                                        │ Cancel stream
      │                                        │
      │  OR                                    │
      │                                        │
      │  AI_EMAIL_TEMPLATE_GENERATE_COMPLETE   │
      │<───────────────────────────────────────│
      │     { title, content, variablesUsed }   │
      │                                        │
```

---

## Error Handling Flow

```
Renderer                              Main Process
   │                                        │
   │  GENERATE_STREAM                      │
   │───────────────>                       │
   │                                        │ Check USER_AI_ENABLED
   │                                        │
   │  ERROR                                │
   │<──────────────────────────────────────│
   │  { msg: "AI features not enabled..." } │
   │                                        │
   [User sees upgrade prompt]              │
```

---

## IPC Handler Template

**Location**: `src/main-process/communication/ai-email-template-ipc.ts`

```typescript
import { ipcMain, IpcMainEvent } from 'electron';
import { Token } from '@/modules/token';
import { USER_AI_ENABLED } from '@/config/usersetting';
import { RagSearchModule } from '@/modules/RagSearchModule';
import { AiChatApi } from '@/api/aiChatApi';
import {
    AI_EMAIL_TEMPLATE_GENERATE_STREAM,
    AI_EMAIL_TEMPLATE_GENERATE_CHUNK,
    AI_EMAIL_TEMPLATE_GENERATE_COMPLETE,
    AI_EMAIL_TEMPLATE_ERROR,
    AI_EMAIL_TEMPLATE_STOP,
    AI_EMAIL_TEMPLATE_VALIDATE
} from '@/config/channellist';

export function registerAIEmailTemplateHandlers(): void {
    // Streaming generation handler
    ipcMain.on(AI_EMAIL_TEMPLATE_GENERATE_STREAM, async (event: IpcMainEvent, requestData: AIEmailTemplateStreamRequest) => {
        try {
            // 1. Check AI enable (MANDATORY - first check)
            const tokenService = new Token();
            const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
            if (!aiEnabled || aiEnabled === 'false' || aiEnabled === '0') {
                event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
                    type: 'error',
                    status: false,
                    msg: 'AI features are not enabled. Please upgrade your plan to access AI features.',
                    data: null
                });
                return;
            }

            // 2. Validate request
            const validation = validateRequest(requestData);
            if (!validation.isValid) {
                event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
                    type: 'error',
                    status: false,
                    msg: validation.errors.join(', '),
                    data: null
                });
                return;
            }

            // 3. Initialize RAG if enabled
            let enhancedPrompt = requestData.prompt;
            if (requestData.useRAG) {
                const ragModule = new RagSearchModule();
                await ragModule.initialize();

                try {
                    const searchResponse = await ragModule.search({
                        query: `email template: ${requestData.prompt}`,
                        options: { limit: requestData.ragLimit || 5 }
                    });

                    if (searchResponse.results.length > 0) {
                        const ragContext = searchResponse.results
                            .map(r => `[${r.document.name}]\n${r.content}`)
                            .join('\n\n');
                        enhancedPrompt = `Based on:\n${ragContext}\n\n---\n\n${requestData.prompt}`;
                    }
                } catch (ragError) {
                    console.error('RAG search failed, proceeding without RAG:', ragError);
                    // Continue without RAG context
                }
            }

            // 4. Stream generation
            const aiChatApi = new AiChatApi();
            let fullContent = '';
            let isStopped = false;

            const stopHandler = (): void => { isStopped = true; };
            ipcMain.once(AI_EMAIL_TEMPLATE_STOP, stopHandler);

            await aiChatApi.streamMessage({
                message: enhancedPrompt,
                systemPrompt: EMAIL_TEMPLATE_SYSTEM_PROMPT,
                useRAG: requestData.useRAG
            }, (streamEvent) => {
                if (isStopped) return;

                if (streamEvent.type === 'chunk') {
                    fullContent += streamEvent.content;
                    event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, {
                        type: 'chunk',
                        content: streamEvent.content,
                        fullContent: fullContent
                    });
                } else if (streamEvent.type === 'complete') {
                    // Parse and validate result
                    const { title, content } = parseEmailTemplate(fullContent);
                    const { isValid, invalidVariables, sanitizedContent } = validateVariables(content);

                    event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, {
                        type: 'complete',
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
                type: 'error',
                status: false,
                msg: error instanceof Error ? error.message : 'Generation failed',
                data: null
            });
        }
    });

    // Validation handler
    ipcMain.handle(AI_EMAIL_TEMPLATE_VALIDATE, async (_event, requestData: AIEmailTemplateValidateRequest) => {
        const { isValid, invalidVariables, sanitizedContent, sanitizedTitle } = validateVariables(requestData.content);

        return {
            status: true,
            data: {
                isValid,
                invalidVariables,
                sanitizedContent,
                sanitizedTitle
            },
            msg: isValid ? 'Validation passed' : 'Invalid variables found'
        };
    });
}
```

---

## Testing Channels

### Unit Test Example

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

describe('AI Email Template IPC Channels', () => {
    beforeEach(() => {
        vi.mock('electron', () => ({
            ipcMain: {
                on: vi.fn(),
                handle: vi.fn(),
                once: vi.fn()
            }
        }));
    });

    it('should register streaming channel handler', () => {
        registerAIEmailTemplateHandlers();

        expect(ipcMain.on).toHaveBeenCalledWith(
            'ai-email-template:generate-stream',
            expect.any(Function)
        );
    });

    it('should register validation channel handler', () => {
        registerAIEmailTemplateHandlers();

        expect(ipcMain.handle).toHaveBeenCalledWith(
            'ai-email-template:validate',
            expect.any(Function)
        );
    });
});
```

---

## Migration Notes

### Phase 1 (Current)
- Implement streaming channels only
- Use `AI_EMAIL_TEMPLATE_GENERATE_STREAM` for all generation
- Keep `AI_EMAIL_TEMPLATE_GENERATE` reserved for future

### Phase 2 (Future)
- Add `AI_EMAIL_TEMPLATE_GENERATE` for batch/non-streaming
- Implement dedicated endpoint with structured output
- Add retry logic and caching

---

## Summary

**Total Channels**: 7 (6 active, 1 reserved)
**Streaming**: Yes (primary interaction pattern)
**Bidirectional**: Yes (renderer ↔ main)
**Error Handling**: Dedicated error channel
**Cancellation**: Supported via stop channel

All channels follow aiFetchly naming conventions and integrate with existing IPC infrastructure.
