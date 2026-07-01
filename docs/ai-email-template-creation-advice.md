# AI-Assisted Email Template Creation — Implementation Advice

This document captures comprehensive advice for implementing AI-assisted email template creation in aiFetchly, leveraging the remote AI server and the existing RAG library.

---

## 1. Architecture Overview Recommendation

The aiFetchly codebase has a mature, consistent pattern for AI features. The recommendation is to follow it closely for email template generation.

---

## 2. AI Integration Pattern Options

### Option A: Dedicated Remote Endpoint (Recommended)

Follow the same pattern as keyword generation, website analysis, and contact extraction — each has its own remote endpoint and dedicated `AiChatApi` method:

```
templatedetail.vue
  → src/views/api/emailmarketing.ts (new function: generateAITemplate)
    → IPC channel AI_EMAIL_TEMPLATE_GENERATE
      → src/main-process/communication/ (new IPC handler)
        → RagSearchModule.search() (local RAG enhancement)
        → AiChatApi.generateEmailTemplate() (new method)
          → POST /api/ai/email-template/generate (remote)
```

**Benefits:**
- The remote server can implement a purpose-built prompt, structured output schema, and guardrails
- Template generation can be versioned and tuned independently

### Option B: Reuse the Streaming Chat Endpoint

Use the existing `streamMessage` with a carefully crafted system prompt. The remote endpoint is `/api/ai/ask/stream` — no server-side changes needed:

```
templatedetail.vue
  → src/views/api/aiChat.ts (streamChatMessage with system prompt)
    → IPC channel AI_CHAT_STREAM
      → existing ai-chat-ipc.ts handler (with useRAG=true)
        → RagSearchModule.search() + AiChatApi.streamMessage()
```

**Benefits:**
- Zero backend changes
- Faster to implement
- Drawback: Less control over output structure

---

## 3. RAG Integration Strategy

### Existing Pattern (ai-chat-ipc.ts lines 178–210)

```
User prompt → RagSearchModule.search(prompt) → format results → prepend to message → send to remote AI
```

### What to Index in RAG

Upload these document types so vector search can retrieve them:

| Document Type | Purpose | Example |
|---------------|---------|---------|
| Past successful templates | Style/tone reference | "Product launch email that got 30% open rate" |
| Brand guidelines | Consistent voice | "We always sign off with 'Best regards'" |
| Product/service descriptions | Accurate claims | "Our SaaS product features..." |
| Industry best practices | Format/structure | "B2B cold outreach best practices" |
| Compliance rules | Legal requirements | "GDPR footer requirements" |

### RAG Search Query Design

Use the user's prompt as the RAG search query. Optionally enrich it:

```typescript
// In the new IPC handler
const ragQuery = `email template: ${userPrompt}`;
// Or:
const ragQuery = `${userPrompt} tone:${tone} industry:${industry}`;
```

The RAG search must run in the IPC handler (main process), same as `AI_CHAT_MESSAGE`.

---

## 4. Variable System Redesign

### Current Gap in emailSend.ts

`Url` and `Description` are never passed into `EmailTemplatePreviewdata`:

```typescript
const previewData: EmailTemplatePreviewdata = {
    TplTitle: randEmailtpl.TplTitle,
    TplContent: randEmailtpl.TplContent,
    Sender: randomEmailservice.from,
    Receiver: item.address
    // Url and Description are missing!
};
```

`EmailItem` has `title` and `source` fields that are not used.

### Recommended Variable Set

| Variable | Source at Send Time | Use Case |
|----------|---------------------|----------|
| `{$send_time}` | Auto-generated | Timestamp |
| `{$sender}` | `EmailServiceEntitydata.from` | Sender identity |
| `{$receiver_email}` | `EmailItem.address` | Recipient email |
| `{$receiver_name}` | New field or `EmailItem.title` | Personalized greeting |
| `{$url}` | `EmailItem.source` | Source/landing page |
| `{$description}` | Campaign description or contact context | Context |
| `{$company_name}` | New: from campaign/contact data | B2B personalization |
| `{$campaign_name}` | New: from campaign metadata | Campaign reference |
| `{$unsubscribe_link}` | New: from config/settings | Compliance (CAN-SPAM, GDPR) |

### Variable Specification for AI System Prompt

Include in the system prompt:

```
You must use ONLY these template variables (use them exactly as shown):
- {$send_time} - Replaced with send timestamp
- {$sender} - Replaced with sender email/name  
- {$receiver_email} - Replaced with recipient email address
- {$receiver_name} - Replaced with recipient name (personalization)
- {$url} - Replaced with source URL or landing page
- {$description} - Replaced with contextual description
- {$company_name} - Replaced with recipient's company name
- {$campaign_name} - Replaced with campaign name
- {$unsubscribe_link} - Replaced with unsubscribe URL

RULES:
- Do NOT invent new variable names
- Use {$receiver_name} for greetings when personalization is requested
- Always include {$unsubscribe_link} at the bottom for compliance
```

### Implementation Changes for Variables

1. **`EmailTemplatePreviewdata`** — add new fields
2. **`convertVariableInTemplate`** in `emailFun.ts` — add replacement logic for new variables
3. **`emailSend.ts`** — pass `item.source` as `Url`, `item.title` as `ReceiverName`, and campaign data into the preview struct

---

## 5. Implementation Layers (Following Project Architecture)

### Layer 1: Channel Definition

Add to `src/config/channellist.ts`:

```typescript
export const AI_EMAIL_TEMPLATE_GENERATE = 'ai-email-template:generate'
export const AI_EMAIL_TEMPLATE_GENERATE_CHUNK = 'ai-email-template:generate-chunk'
export const AI_EMAIL_TEMPLATE_GENERATE_COMPLETE = 'ai-email-template:generate-complete'
```

### Layer 2: API Types

Add to `src/entityTypes/emailmarketingType.ts`:

```typescript
export type AIEmailTemplateRequest = {
    prompt: string;
    tone?: 'formal' | 'casual' | 'friendly' | 'professional';
    industry?: string;
    templateType?: 'cold_outreach' | 'follow_up' | 'newsletter' | 'promotion' | 'custom';
    useRAG?: boolean;
    ragLimit?: number;
    existingTitle?: string;    // If user wants to refine existing template
    existingContent?: string;
}

export type AIEmailTemplateResponse = {
    title: string;
    content: string;
    description?: string;
    variablesUsed: string[];
}
```

### Layer 3: AiChatApi Method

Add to `src/api/aiChatApi.ts` (Option A):

```typescript
async generateEmailTemplate(
    request: AIEmailTemplateRequest
): Promise<CommonApiresp<AIEmailTemplateResponse>>
```

For Option B, reuse `streamMessage` with a system prompt.

### Layer 4: IPC Handler

Create or extend in `src/main-process/communication/`:

- **Mandatory:** Check `USER_AI_ENABLED` first (per project constitution)
- Initialize `RagSearchModule`
- If `useRAG`, run `ragSearchModule.search(prompt)` and build enhanced message
- Call remote API (dedicated endpoint or stream)
- Parse structured response
- Return `{ title, content, description, variablesUsed }` to renderer

### Layer 5: Frontend API

Add to `src/views/api/emailmarketing.ts`:

```typescript
export async function generateAIEmailTemplate(
    data: AIEmailTemplateRequest
): Promise<AIEmailTemplateResponse>
```

### Layer 6: UI in templatedetail.vue

- Add "Generate with AI" button in the right column alongside variable buttons
- Add a dialog/drawer for AI generation:
  - Prompt input
  - Tone selector
  - Template type selector
  - RAG toggle
- Show streaming output or loading state
- On completion, populate `tplTitle` and `tplcontent` with generated result
- User can edit and save as usual

### Layer 7: i18n

Add translation keys in all 6 language files: `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`.

---

## 6. UX Flow Recommendation

1. User clicks "Generate with AI"
2. Dialog opens with:
   - **Prompt textarea:** "Describe what email you want..."
   - **Tone dropdown:** Formal / Casual / Friendly / Professional
   - **Template type dropdown:** Cold Outreach / Follow-up / Newsletter / Promotion
   - **RAG toggle:** "Use knowledge base for context"
   - **"Refine existing" checkbox:** If checked, send current `tplTitle` + `tplcontent` to AI for refinement
3. User clicks "Generate" → loading state
4. AI response fills `tplTitle` and `tplcontent` (streaming if Option B)
5. User reviews, edits, and saves

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| AI generates invalid variable names | Validate output against allowed variable list before applying |
| AI generates HTML when plain text expected | Specify format in system prompt; or auto-detect and convert |
| RAG returns irrelevant documents | Use document tags when indexing; filter by tag |
| Long generation time | Use streaming (Option B) for real-time feedback |
| AI not enabled for user | `ensureAIEnabled()` at IPC layer; show "upgrade plan" in UI |
| Inconsistent variable format | Post-process AI output to normalize `{$var}` syntax |

---

## 8. Priority Order

1. **Fix existing gap:** Pass `Url` and `Description` in `emailSend.ts` (current bug)
2. **Add new variables:** `{$receiver_name}`, `{$company_name}`, `{$unsubscribe_link}` to types, `convertVariableInTemplate`, and UI
3. **Implement AI generation:** Option A (dedicated endpoint) or Option B (stream with system prompt)
4. **Index RAG content:** Upload brand docs, past templates, product descriptions
5. **Add "Refine existing" mode:** Let users iterate on AI-generated templates
6. **Update i18n:** Add new strings to all 6 language files

---

## References

- `src/views/pages/emailmarketing/template/templatedetail.vue` — template detail UI
- `src/api/aiChatApi.ts` — AI API client, RAG params
- `src/main-process/communication/ai-chat-ipc.ts` — RAG integration pattern
- `src/views/utils/emailFun.ts` — variable replacement
- `src/childprocess/emailSend.ts` — email sending flow
- `src/entityTypes/emailmarketingType.ts` — type definitions
