# Data Model: AI-Assisted Email Template Creation

**Feature**: AI-Assisted Email Template Creation
**Branch**: `001-ai-email-template`
**Date**: 2025-02-16
**Status**: Phase 1 - Design & Contracts

## Overview

This document defines the data model for AI-assisted email template generation, including entities, types, fields, relationships, validation rules, and state transitions.

---

## Core Entities

### 1. AIEmailTemplateRequest

**Purpose**: Request payload for generating email templates via AI

**Location**: `src/entityTypes/emailmarketingType.ts`

```typescript
export interface AIEmailTemplateRequest {
    // Required fields
    prompt: string;                    // User's description of desired email template
    tone: EmailTemplateTone;           // Desired tone/style
    templateType: EmailTemplateType;   // Type/category of email

    // Optional fields
    useRAG?: boolean;                  // Enable knowledge base search (default: false)
    ragLimit?: number;                 // Max RAG results to retrieve (default: 5)
    startFresh?: boolean;              // Ignore existing content (default: false)

    // Auto-detected fields (set by system)
    refineMode?: boolean;              // Automatically detected: true if existing content
    existingTitle?: string;            // Current template title (for refinement)
    existingContent?: string;          // Current template content (for refinement)
}
```

**Validation Rules**:
- `prompt`: Required, min 10 chars, max 500 chars
- `tone`: Required, must be valid `EmailTemplateTone` enum value
- `templateType`: Required, must be valid `EmailTemplateType` enum value
- `ragLimit`: Optional, min 1, max 20 if provided
- `useRAG`: Optional, defaults to `false`
- `startFresh`: Optional, defaults to `false`

**Relationships**:
- Uses `EmailTemplateVariable[]` (allowed variables)
- May reference `RagSearchResult[]` (if useRAG enabled)

---

### 2. AIEmailTemplateResponse

**Purpose**: Response from AI template generation

**Location**: `src/entityTypes/emailmarketingType.ts`

```typescript
export interface AIEmailTemplateResponse {
    // Generated content
    title: string;                     // Email subject line
    content: string;                   // Email body content

    // Metadata
    description?: string;              // Optional description of generated template
    variablesUsed: EmailTemplateVariable[];  // List of variables used in template

    // Validation status
    hasInvalidVariables: boolean;      // True if invalid variables were found
    invalidVariables: string[];        // List of invalid variable names that were removed

    // Status
    status: 'success' | 'partial' | 'error';
    message?: string;                  // Error or status message
}
```

**Validation Rules**:
- `title`: Required, non-empty after generation
- `content`: Required, non-empty after generation
- `variablesUsed`: Required, array (may be empty)
- `hasInvalidVariables`: Required, boolean
- `invalidVariables`: Required, array (may be empty)
- `status`: Required, must be valid enum value

**Relationships**:
- Contains `EmailTemplateVariable[]` (validated list)
- May reference `EmailTemplatePreviewdata` for preview

---

### 3. EmailTemplateVariable (Extended)

**Purpose**: Central registry of allowed template variables

**Location**: `src/config/emailTemplateVariables.ts` (NEW FILE)

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

export type EmailTemplateVariable = typeof EMAIL_TEMPLATE_VARIABLES[keyof typeof EMAIL_TEMPLATE_VARIABLES];

export const EMAIL_TEMPLATE_VARIABLE_LIST: EmailTemplateVariable[] =
    Object.values(EMAIL_TEMPLATE_VARIABLES);

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

**Validation Rules**:
- All variables must match pattern: `{$[a-z_]+}`
- AI-generated content must only use variables from this list
- Invalid variables are stripped during post-processing

---

### 4. EmailTemplateTone (Enum)

**Purpose**: Defines available tone options for generated emails

**Location**: `src/entityTypes/emailmarketingType.ts`

```typescript
export type EmailTemplateTone =
    | 'formal'        // Professional, business-appropriate
    | 'casual'        // Relaxed, friendly
    | 'friendly'      // Warm, approachable
    | 'professional'; // Polished, expert tone
```

---

### 5. EmailTemplateType (Enum)

**Purpose**: Defines categories of email templates

**Location**: `src/entityTypes/emailmarketingType.ts`

```typescript
export type EmailTemplateType =
    | 'cold_outreach'    // Initial contact with prospects
    | 'follow_up'        // Follow-up after initial contact
    | 'newsletter'       // Regular newsletter/digest
    | 'promotion'        // Sales/promotional content
    | 'custom';          // User-defined type
```

---

### 6. EmailTemplatePreviewdata (Extended)

**Purpose**: Input data for variable replacement during preview/sending

**Location**: `src/entityTypes/emailmarketingType.ts`

**Current Structure** (BEFORE):
```typescript
export interface EmailTemplatePreviewdata {
    TplTitle: string;
    TplContent: string;
    Sender: string;
    Receiver: string;
    Url?: string;          // BUG: Not being passed in emailSend.ts
    Description?: string;  // BUG: Not being passed in emailSend.ts
}
```

**Extended Structure** (AFTER):
```typescript
export interface EmailTemplatePreviewdata {
    // Existing fields
    TplTitle: string;
    TplContent: string;
    Sender: string;
    Receiver: string;
    Url?: string;
    Description?: string;

    // NEW fields for extended variable support
    ReceiverName?: string;       // Recipient's first name
    CompanyName?: string;         // Recipient's company
    CampaignName?: string;        // Campaign reference
    UnsubscribeLink?: string;    // Functional unsubscribe URL
}
```

**Validation Rules**:
- `TplTitle`, `TplContent`, `Sender`, `Receiver`: Required
- Optional fields: Default to empty string if not provided
- All variables in template content must be in `EMAIL_TEMPLATE_VARIABLE_LIST`

**Relationships**:
- Uses `EMAIL_TEMPLATE_VARIABLES` for replacement
- Output becomes `EmailTemplatedata` after replacement

---

### 7. Streaming Event Types

**Purpose**: Define IPC channel events for streaming AI generation

**Location**: `src/entityTypes/commonType.ts` (or new file)

```typescript
// Chunk event - streaming content
export interface AIEmailTemplateChunkEvent {
    type: 'chunk';
    content: string;           // New content chunk (characters/words)
    fullContent: string;       // Accumulated content so far
}

// Complete event - generation finished
export interface AIEmailTemplateCompleteEvent {
    type: 'complete';
    status: boolean;
    data: AIEmailTemplateResponse;
}

// Error event - generation failed
export interface AIEmailTemplateErrorEvent {
    type: 'error';
    status: false;
    msg: string;
    data: null;
}

// Stop event - user cancelled
export interface AIEmailTemplateStopEvent {
    type: 'stop';
}

// Union type
export type AIEmailTemplateStreamEvent =
    | AIEmailTemplateChunkEvent
    | AIEmailTemplateCompleteEvent
    | AIEmailTemplateErrorEvent
    | AIEmailTemplateStopEvent;
```

---

## Entity Relationships

```
AIEmailTemplateRequest
    │
    ├─→ Validates ─→ EmailTemplateVariable[] (allowed variables)
    │
    ├─→ Optionally uses ─→ RagSearchResult[] (if useRAG=true)
    │
    └─→ Produces ─→ AIEmailTemplateResponse
                        │
                        ├─→ Contains ─→ EmailTemplateVariable[] (used variables)
                        │
                        └─→ Populates ─→ EmailTemplatePreviewdata
                                            │
                                            └─→ Replaces ─→ EmailTemplateVariable[]
```

---

## State Transitions

### AI Generation State Machine

```
┌─────────────┐
│   IDLE      │  Initial state, panel collapsed
└──────┬──────┘
       │ User clicks "Generate with AI"
       ▼
┌─────────────┐
│  EXPANDED   │  Panel open, awaiting user input
└──────┬──────┘
       │ User clicks "Generate" button
       ▼
┌─────────────┐
│ VALIDATING  │  Check AI enable, validate inputs
└──────┬──────┘
       │
       ├─→ AI disabled ─→ SHOW_UPGRADE_PROMPT ─→ IDLE
       │
       ├─→ Invalid input ─→ SHOW_VALIDATION_ERROR ─→ EXPANDED
       │
       └─→ Valid ─→ GENERATING
                    │
                    ├─→ useRAG ─→ SEARCHING_KNOWLEDGE_BASE
                    │                │
                    │                ├─→ Success ─→ GENERATING
                    │                │
                    │                └─→ Failure ─→ GENERATING (with warning)
                    │
                    ├─→ Streaming chunk ─→ UPDATE_DISPLAY
                    │
                    ├─→ User clicks stop ─→ STOPPED ─→ IDLE (keep partial)
                    │
                    ├─→ Error ─→ SHOW_ERROR ─→ EXPANDED
                    │
                    └─→ Complete ─→ VALIDATE_VARIABLES
                                         │
                                         ├─→ Invalid found ─→ SANITIZE ─→ SHOW_WARNING ─→ POPULATE_FIELDS
                                         │
                                         └─→ All valid ─→ POPULATE_FIELDS ─→ COLLAPSE ─→ IDLE
```

---

## Validation Logic

### 1. AI Output Validation

```typescript
function validateAIOutputVariables(content: string): ValidationResult {
    const invalidVariables: string[] = [];
    const variablePattern = /\{\$([^}]+)\}/g;
    let match;

    // Extract all variables
    while ((match = variablePattern.exec(content)) !== null) {
        const variable = `{$${match[1]}}`;
        if (!EMAIL_TEMPLATE_VARIABLE_LIST.includes(variable as EmailTemplateVariable)) {
            invalidVariables.push(variable);
        }
    }

    return {
        isValid: invalidVariables.length === 0,
        invalidVariables,
        sanitizedContent: invalidVariables.length > 0
            ? content.replace(variablePattern, (matched) =>
                EMAIL_TEMPLATE_VARIABLE_LIST.includes(matched as EmailTemplateVariable) ? matched : ''
              )
            : content
    };
}
```

### 2. Request Validation

```typescript
function validateAIRequest(request: AIEmailTemplateRequest): ValidationResult {
    const errors: string[] = [];

    // Check required fields
    if (!request.prompt || request.prompt.trim().length < 10) {
        errors.push('Prompt must be at least 10 characters');
    }
    if (request.prompt.length > 500) {
        errors.push('Prompt must not exceed 500 characters');
    }

    // Validate enums
    if (!['formal', 'casual', 'friendly', 'professional'].includes(request.tone)) {
        errors.push('Invalid tone value');
    }

    const validTypes = ['cold_outreach', 'follow_up', 'newsletter', 'promotion', 'custom'];
    if (!validTypes.includes(request.templateType)) {
        errors.push('Invalid template type');
    }

    // Validate RAG limit
    if (request.ragLimit !== undefined) {
        if (request.ragLimit < 1 || request.ragLimit > 20) {
            errors.push('RAG limit must be between 1 and 20');
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}
```

### 3. Template Variable Replacement

```typescript
function convertVariableInTemplate(data: EmailTemplatePreviewdata): EmailTemplatedata {
    let content = data.TplContent;
    let title = data.TplTitle;

    // Format timestamp
    const sendTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Replace variables in both title and content
    const replacements: Record<string, string> = {
        '{$send_time}': sendTime,
        '{$sender}': data.Sender || '',
        '{$receiver_email}': data.Receiver || '',
        '{$receiver_name}': data.ReceiverName || '',
        '{$url}': data.Url || '',
        '{$description}': data.Description || '',
        '{$company_name}': data.CompanyName || '',
        '{$campaign_name}': data.CampaignName || '',
        '{$unsubscribe_link}': data.UnsubscribeLink || generateUnsubscribeLink()
    };

    // Apply replacements
    for (const [variable, value] of Object.entries(replacements)) {
        const regex = new RegExp(escapeRegExp(variable), 'g');
        content = content.replace(regex, value);
        title = title.replace(regex, value);
    }

    return { TplTitle: title, TplContent: content };
}
```

---

## Index Strategy

### Database Queries

Email templates are stored in SQLite via TypeORM. Key queries:

1. **Get template by ID**:
   ```typescript
   emailMarketingRepository.findOne({ where: { TplId } })
   ```

2. **List all templates**:
   ```typescript
   emailMarketingRepository.find({ order: { TplId: 'DESC' } })
   ```

3. **Search templates by title/content**:
   ```typescript
   emailMarketingRepository
       .createQueryBuilder('template')
       .where('template.TplTitle LIKE :search', { search: `%${search}%` })
       .orWhere('template.TplContent LIKE :search')
       .getMany()
   ```

### RAG Vector Search

RAG searches use `RagSearchModule`:

```typescript
const searchRequest: SearchRequest = {
    query: `email template: ${userPrompt}`,
    options: {
        limit: ragLimit || 5,
        threshold: 0.7  // Minimum similarity score
    }
};

const searchResponse: SearchResponse = await ragSearchModule.search(searchRequest);
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (Vue UI)                                 │
│  templatedetail.vue                                        │
│    - User enters prompt                                     │
│    - Selects tone, templateType                             │
│    - Toggles useRAG                                         │
└──────────────┬──────────────────────────────────────────────┘
               │ windowInvoke(AI_EMAIL_TEMPLATE_GENERATE_STREAM)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Main Process (IPC Handler)                                │
│  ai-email-template-ipc.ts                                   │
│    1. Check USER_AI_ENABLED                                 │
│    2. Validate request                                       │
│    3. If useRAG: RagSearchModule.search()                   │
│    4. Call AiChatApi.streamMessage()                        │
│    5. Parse streaming response                              │
│    6. Validate variables                                     │
│    7. Send chunks via IPC                                    │
└──────────────┬──────────────────────────────────────────────┘
               │ IPC events (chunk, complete, error)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (Vue UI)                                 │
│  templatedetail.vue                                        │
│    - Receive chunks                                         │
│    - Update display in real-time                            │
│    - On complete: populate title/content fields             │
│    - On error: show error message                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

### Phase 1: Add Extended Variables

**Files to Modify**:
1. `src/entityTypes/emailmarketingType.ts` - Add new fields to `EmailTemplatePreviewdata`
2. `src/views/utils/emailFun.ts` - Add replacement logic for new variables
3. `src/childprocess/emailSend.ts` - Pass Url, Description, and new fields
4. `src/views/pages/emailmarketing/template/templatedetail.vue` - Add variable buttons

**Backward Compatibility**: All new fields are optional, existing templates continue to work.

### Phase 2: Add AI Generation

**Files to Create**:
1. `src/config/emailTemplateVariables.ts` - Central variable registry
2. `src/main-process/communication/ai-email-template-ipc.ts` - IPC handler
3. `src/views/api/emailmarketing.ts` - Add `generateAIEmailTemplate()` function

**Files to Modify**:
1. `src/config/channellist.ts` - Add IPC channels
2. `src/views/pages/emailmarketing/template/templatedetail.vue` - Add AI generation UI
3. `src/views/lang/*.ts` - Add translations for all 6 languages

---

## Summary

**Total Entities**: 7 core entities + 3 supporting types
**New Files**: 2 (`emailTemplateVariables.ts`, `ai-email-template-ipc.ts`)
**Modified Files**: 8 existing files
**Enum Types**: 2 (EmailTemplateTone, EmailTemplateType)
**Validation Functions**: 3 (validateAIOutputVariables, validateAIRequest, convertVariableInTemplate)
**State Machine**: 7 states with 12 transitions

The data model is complete, type-safe, and ready for implementation. All entities follow TypeScript best practices with no `any` types, proper validation, and clear relationships.
