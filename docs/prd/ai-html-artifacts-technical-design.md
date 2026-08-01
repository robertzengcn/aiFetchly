# AI HTML Artifacts - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-07-17 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/ai-html-artifacts-prd.md` |
| Primary code paths | `src/config/skillsRegistry.ts`, `src/service/SkillExecutor.ts`, `src/modules/AIChatV2Module.ts`, `src/main-process/communication/ai-chat-v2-ipc.ts`, `src/views/layout/layout.vue`, `src/views/components/aiChatV2/AiChatV2.vue`, `src/views/components/aiChatV2/AiChatV2Message.vue` |

## 1. Purpose

This document translates `docs/prd/ai-html-artifacts-prd.md` into an implementation-facing technical design.

The feature lets AiChatV2 create visual HTML artifacts through a controlled tool call and display them in the main application workspace:

```text
User: "Generate statistical information and show it in the main area"
  -> model calls create_html_artifact({ title, html, openImmediately })
  -> SkillExecutor runs the built-in tool
  -> AIArtifactModule validates and stores the artifact
  -> tool_result streams artifact metadata to the renderer
  -> AiChatV2 renders an artifact card
  -> layout.vue opens AiArtifactWorkspace
  -> AiArtifactWorkspace renders iframe sandbox="" with srcdoc
```

The hard boundary is:

```text
AI/tool/main process
  -> creates validated artifact records and metadata

Renderer
  -> decides how to display artifact metadata
  -> renders artifact content only inside a sandboxed iframe
```

Normal assistant text remains plain text. Do not render assistant message content with `v-html`.

## 2. Current System Summary

### 2.1 AiChatV2 Layout

`src/views/layout/layout.vue` already uses a split content area:

```text
app_main__body
  -> .router
       -> <RouterView />
  -> .ai-chat-dock
       -> <AiChatV2 />
```

This design adds an artifact workspace inside `.router`, owned by `layout.vue`, so the main app area can temporarily show generated content without giving the AI control over Vue Router or page components.

### 2.2 Tool Execution

`src/main-process/communication/ai-chat-v2-ipc.ts` builds the Chat V2 query loop with:

```typescript
executeTool: (name, args, context) => SkillExecutor.execute(name, args, context)
```

`SkillExecutor`:

1. Resolves the skill in `SkillRegistry`.
2. Validates sensitive inputs.
3. Applies permission checks.
4. Executes the skill.
5. Returns a `ToolExecutionResult`.

`src/config/skillsRegistry.ts` already registers built-in tools in `BUILT_IN_SKILLS`, including `open_app_page`. `create_html_artifact` should follow the same built-in `SkillDefinition` pattern.

### 2.3 Stream Events

`ai-chat-v2-ipc.ts` converts `AIChatQueryEvent` tool results into `ChatV2StreamChunk`:

```typescript
{
  eventType: "tool_result",
  conversationId,
  messageId,
  toolCallId,
  toolName,
  fullContent,
  toolResult
}
```

`src/views/components/aiChatV2/AiChatV2.vue` handles this event in `onSend()` and calls `upsertToolResultMessage()`.

`src/views/components/aiChatV2/AiChatV2Message.vue` renders tool results. It currently shows summary text and details. This is the correct insertion point for an artifact card.

### 2.4 Persistence

Chat messages are stored in `ai_chat_messages` through:

```text
AIChatV2Module
  -> AIChatModule
  -> AIChatMessageModel
  -> AIChatMessageEntity
```

The artifact feature needs separate persistence because full HTML should not be duplicated into chat message metadata.

The repo rules require:

```text
IPC handler
  -> Module
  -> Model
  -> TypeORM Entity
```

No TypeORM repository access belongs in IPC handlers.

## 3. Target Architecture

### 3.1 New Files

```text
src/entity/AIArtifact.entity.ts
src/entityTypes/aiArtifactTypes.ts
src/model/AIArtifact.model.ts
src/modules/AIArtifactModule.ts
src/service/AIArtifactValidationService.ts
src/service/AIHtmlArtifactToolService.ts
src/views/api/aiArtifacts.ts
src/views/components/aiArtifacts/AiArtifactWorkspace.vue
src/views/components/aiArtifacts/AiArtifactCard.vue
```

### 3.2 Modified Files

```text
src/config/SqliteDb.ts
src/config/channellist.ts
src/config/skillsRegistry.ts
src/entityTypes/aiChatV2Types.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/views/layout/layout.vue
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Message.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

### 3.3 Runtime Flow

```text
1. User sends a prompt.
2. Remote model chooses create_html_artifact.
3. AIChatQueryLoop calls SkillExecutor.execute("create_html_artifact", args, context).
4. SkillExecutor runs the built-in skill registered in skillsRegistry.ts.
5. Built-in skill calls AIHtmlArtifactToolService.create(args, context).
6. AIHtmlArtifactToolService validates input and calls AIArtifactModule.
7. AIArtifactModule persists via AIArtifactModel.
8. Tool returns artifact metadata only.
9. StreamEventProcessor / AIChatQueryEngine saves the tool result message.
10. ai-chat-v2-ipc.ts sends tool_result chunk to renderer.
11. AiChatV2 converts chunk into a tool result message.
12. AiChatV2Message renders AiArtifactCard.
13. AiChatV2 emits open-artifact if openImmediately is true.
14. layout.vue fetches artifact content through views/api/aiArtifacts.ts.
15. AiArtifactWorkspace renders iframe sandbox="" with srcdoc.
```

### 3.4 Data Ownership

| Data | Owner | Notes |
| --- | --- | --- |
| Artifact content | `AIArtifactEntity` | Stored once per artifact version. |
| Artifact metadata in chat | `ChatV2MessageMetadata.artifact` | Small pointer only. |
| Artifact preview state | `layout.vue` | Renderer-only UI state. |
| Artifact display | `AiArtifactWorkspace.vue` | Sandbox iframe. |
| Artifact card | `AiArtifactCard.vue` | Chat action surface. |
| Tool registration | `skillsRegistry.ts` | Built-in pure tool. |

## 4. Shared Types

Create:

```text
src/entityTypes/aiArtifactTypes.ts
```

Recommended types:

```typescript
export type AIArtifactType = "html";

export interface CreateHtmlArtifactInput {
  title: string;
  html: string;
  description?: string;
  openImmediately?: boolean;
}

export interface AIArtifactRecord {
  id: string;
  conversationId: string;
  type: AIArtifactType;
  title: string;
  description?: string;
  mimeType: "text/html";
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AIArtifactSummary {
  id: string;
  conversationId: string;
  type: AIArtifactType;
  title: string;
  description?: string;
  mimeType: "text/html";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AIArtifactToolMetadata extends AIArtifactSummary {
  openImmediately: boolean;
}

export interface CreateHtmlArtifactToolResult {
  success: boolean;
  artifact?: AIArtifactToolMetadata;
  summary: string;
  error?: string;
}

export interface GetAIArtifactRequest {
  artifactId: string;
}

export interface ListAIArtifactsRequest {
  conversationId: string;
}
```

Rules:

1. Use explicit interfaces. Do not use `any`.
2. Tool result metadata should use `AIArtifactToolMetadata`, not the full record.
3. The full HTML content only leaves the main process through artifact-read IPC.

## 5. Chat Metadata Extension

Modify:

```text
src/entityTypes/aiChatV2Types.ts
```

Add:

```typescript
import type { AIArtifactToolMetadata } from "@/entityTypes/aiArtifactTypes";
```

Extend `ChatV2MessageMetadata`:

```typescript
export interface ChatV2MessageMetadata {
  // existing fields...
  artifact?: AIArtifactToolMetadata;
}
```

Tool result messages should populate both:

```typescript
metadata.toolResult.artifact
metadata.artifact
```

Rationale:

1. `toolResult.artifact` preserves the raw tool result shape.
2. `metadata.artifact` gives renderer components a stable, typed shortcut.

## 6. Database Design

### 6.1 Entity

Create:

```text
src/entity/AIArtifact.entity.ts
```

Recommended entity:

```typescript
import "reflect-metadata";
import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import { Order } from "@/entity/order.decorator";

@Entity("ai_artifacts")
@Index(["conversationId", "createdAt"])
@Index(["artifactId"], { unique: true })
export class AIArtifactEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  artifactId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("varchar", { length: 20, nullable: false, default: "html" })
  type: "html";

  @Order(4)
  @Column("varchar", { length: 160, nullable: false })
  title: string;

  @Order(5)
  @Column("varchar", { length: 500, nullable: true })
  description?: string;

  @Order(6)
  @Column("varchar", { length: 80, nullable: false, default: "text/html" })
  mimeType: "text/html";

  @Order(7)
  @Column("text", { nullable: false })
  content: string;

  @Order(8)
  @Column("int", { nullable: false, default: 1 })
  version: number;
}
```

`AuditableEntity` already supplies created and updated timestamps in this codebase. If its actual property names differ from `createdAt` and `updatedAt`, the model mapper should use the existing names.

### 6.2 SqliteDb Registration

Modify:

```text
src/config/SqliteDb.ts
```

Add import:

```typescript
import { AIArtifactEntity } from "@/entity/AIArtifact.entity";
```

Add `AIArtifactEntity` to the `entities` array near the other AI chat entities:

```typescript
AIChatMessageEntity,
AIChatAttachmentEntity,
AIArtifactEntity,
```

The project currently uses `synchronize: true`, so adding the entity will create the table on initialization.

### 6.3 Model

Create:

```text
src/model/AIArtifact.model.ts
```

Responsibilities:

1. Save artifact records.
2. Fetch by `artifactId`.
3. List summaries by `conversationId`.
4. Get latest version number by conversation and normalized title if versioning by title is selected.
5. Delete artifacts by conversation when chat history is cleared.

Recommended methods:

```typescript
export class AIArtifactModel extends BaseDb {
  public repository: Repository<AIArtifactEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(AIArtifactEntity);
  }

  async saveArtifact(entity: AIArtifactEntity): Promise<AIArtifactEntity>;
  async getByArtifactId(artifactId: string): Promise<AIArtifactEntity | null>;
  async listByConversation(conversationId: string): Promise<AIArtifactEntity[]>;
  async deleteByConversation(conversationId: string): Promise<number>;
}
```

### 6.4 Module

Create:

```text
src/modules/AIArtifactModule.ts
```

Responsibilities:

1. Own artifact business rules.
2. Ensure DB connection.
3. Generate `artifactId`.
4. Determine next version.
5. Map entity to `AIArtifactRecord` and `AIArtifactSummary`.
6. Enforce conversation ownership when reading by id and conversation id.

Recommended methods:

```typescript
export class AIArtifactModule extends BaseModule {
  async createHtmlArtifact(input: {
    conversationId: string;
    title: string;
    description?: string;
    html: string;
  }): Promise<AIArtifactRecord>;

  async getArtifact(artifactId: string): Promise<AIArtifactRecord | null>;

  async listArtifacts(conversationId: string): Promise<AIArtifactSummary[]>;

  async deleteByConversation(conversationId: string): Promise<number>;
}
```

`AIChatV2Module.clearConversation()` should call `AIArtifactModule.deleteByConversation(conversationId)` so clearing chat also clears associated generated HTML.

## 7. Validation Design

Create:

```text
src/service/AIArtifactValidationService.ts
```

### 7.1 Constants

Recommended MVP limits:

```typescript
export const AI_HTML_ARTIFACT_MAX_TITLE_LENGTH = 160;
export const AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH = 500;
export const AI_HTML_ARTIFACT_MAX_HTML_BYTES = 512 * 1024;
```

512 KB is enough for inline CSS and substantial reports while limiting renderer memory risk. If manual testing shows real dashboards exceed this, raise it deliberately.

### 7.2 Input Validation

Validation returns a discriminated union:

```typescript
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
```

Validated payload:

```typescript
interface ValidatedHtmlArtifactInput {
  title: string;
  description?: string;
  html: string;
  openImmediately: boolean;
}
```

Rules:

1. `title` must be a non-empty string after trim.
2. `title` length <= 160.
3. `description`, if present, length <= 500.
4. `html` must be a non-empty string after trim.
5. UTF-8 byte length of `html` <= 512 KB.
6. `openImmediately` defaults to `true`.
7. Reject obvious external network resource references.
8. Reject scripts in MVP.
9. Reject form submission in MVP.
10. Reject navigation features in MVP.

### 7.3 Unsafe Pattern Rejection

The validator is not the primary security boundary. The iframe sandbox is. The validator is a product and performance guard.

Reject these patterns in MVP:

```typescript
const DISALLOWED_HTML_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /<script\b/i, reason: "Scripts are not supported in HTML artifacts." },
  { pattern: /\bon\w+\s*=/i, reason: "Inline event handlers are not supported." },
  { pattern: /\bjavascript\s*:/i, reason: "javascript: URLs are not supported." },
  { pattern: /<iframe\b/i, reason: "Nested iframes are not supported." },
  { pattern: /<object\b/i, reason: "Object embeds are not supported." },
  { pattern: /<embed\b/i, reason: "Embeds are not supported." },
  { pattern: /<link\b[^>]*href\s*=\s*["']?https?:\/\//i, reason: "Remote stylesheets are not supported." },
  { pattern: /<img\b[^>]*src\s*=\s*["']?https?:\/\//i, reason: "Remote images are not supported." },
  { pattern: /<form\b/i, reason: "Forms are not supported in HTML artifacts." },
  { pattern: /\btarget\s*=\s*["']?_parent/i, reason: "Parent navigation is not supported." },
  { pattern: /\btarget\s*=\s*["']?_top/i, reason: "Top navigation is not supported." }
];
```

Notes:

1. Regex rejection is intentionally conservative.
2. Do not claim this fully sanitizes HTML.
3. The renderer must still sandbox every artifact.
4. If a future phase allows scripts or charts, move that through a separate security review.

### 7.4 Output Normalization

The validator should normalize fragments into a full document:

```typescript
function ensureHtmlDocument(html: string, title: string): string {
  const trimmed = html.trim();
  if (/<!doctype html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(title)}</title>
</head>
<body>
${trimmed}
</body>
</html>`;
}
```

Escaping helpers must be explicit and typed.

## 8. Tool Service Design

Create:

```text
src/service/AIHtmlArtifactToolService.ts
```

Responsibilities:

1. Accept raw tool args and execution context.
2. Validate args with `AIArtifactValidationService`.
3. Require `context.conversationId`.
4. Create artifact through `AIArtifactModule`.
5. Return `CreateHtmlArtifactToolResult`.

Recommended shape:

```typescript
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type {
  CreateHtmlArtifactInput,
  CreateHtmlArtifactToolResult,
} from "@/entityTypes/aiArtifactTypes";

export class AIHtmlArtifactToolService {
  async create(
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ): Promise<CreateHtmlArtifactToolResult> {
    if (!context.conversationId) {
      return {
        success: false,
        summary: "Could not create the HTML artifact.",
        error: "Missing conversation id.",
      };
    }

    const validation = AIArtifactValidationService.validateCreateInput(args);
    if (!validation.ok) {
      return {
        success: false,
        summary: "Could not create the HTML artifact.",
        error: validation.error,
      };
    }

    const module = new AIArtifactModule();
    const artifact = await module.createHtmlArtifact({
      conversationId: context.conversationId,
      title: validation.value.title,
      description: validation.value.description,
      html: validation.value.html,
    });

    return {
      success: true,
      artifact: {
        id: artifact.id,
        conversationId: artifact.conversationId,
        type: artifact.type,
        title: artifact.title,
        description: artifact.description,
        mimeType: artifact.mimeType,
        version: artifact.version,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        openImmediately: validation.value.openImmediately,
      },
      summary: `Created HTML artifact: ${artifact.title}`,
    };
  }
}
```

Do not return `content` from this tool. The tool result should stay small.

## 9. Skill Registry Integration

Modify:

```text
src/config/skillsRegistry.ts
```

Add import:

```typescript
import { AIHtmlArtifactToolService } from "@/service/AIHtmlArtifactToolService";
```

Add a built-in skill:

```typescript
{
  name: "create_html_artifact",
  description:
    "Create a standalone HTML artifact and display it in the application's main content area. " +
    "Use this tool when the user asks for information that is better presented visually or interactively, such as dashboards, statistical reports, comparison tables, charts, summaries with layout, generated landing-page previews, visual plans, or formatted documents. " +
    "The HTML must be self-contained and safe to render in a sandboxed iframe. Use semantic HTML and inline CSS. Do not rely on external network resources, remote scripts, remote stylesheets, cookies, localStorage, Electron APIs, filesystem access, or navigation. Do not include forms that submit data, login fields, payment fields, tracking scripts, or code intended to escape the sandbox. " +
    "Do not use this tool for ordinary conversational answers, short explanations, code snippets, command output, private/internal reasoning, or content that the user did not ask to visualize. If a simple text response is enough, respond in chat instead.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short user-facing title for the artifact.",
      },
      html: {
        type: "string",
        description:
          "Complete standalone HTML document or safe fragment to render in the main workspace.",
      },
      description: {
        type: "string",
        description: "Brief summary of what the artifact shows.",
      },
      openImmediately: {
        type: "boolean",
        description:
          "Whether to open the artifact in the main workspace immediately. Default true.",
        default: true,
      },
    },
    required: ["title", "html"],
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "pure",
  source: "built-in",
  execute: async (args, context) => {
    const service = new AIHtmlArtifactToolService();
    const result = await service.create(args, context);
    return {
      success: result.success,
      result: result as unknown as Record<string, unknown>,
    };
  },
}
```

Permission category should be `pure` for MVP because the tool only writes an artifact record associated with the active AI conversation and does not perform external network access or user-visible app mutation beyond a renderer preview. If product later treats artifact creation as a persisted side effect requiring approval, change this to a confirmation category and update UX.

## 10. IPC Design

### 10.1 New Channels

Modify:

```text
src/config/channellist.ts
```

Add:

```typescript
export const AI_ARTIFACT_GET = "ai-artifact:get";
export const AI_ARTIFACT_LIST = "ai-artifact:list";
```

### 10.2 Main Process Handlers

Modify:

```text
src/main-process/communication/ai-chat-v2-ipc.ts
```

or create a focused file:

```text
src/main-process/communication/ai-artifact-ipc.ts
```

Recommended: create `ai-artifact-ipc.ts` and register it with the same startup path used by other communication modules. Keep artifact read handlers separate from chat stream code.

Handlers:

```typescript
ipcMain.handle(AI_ARTIFACT_GET, async (_e, data: unknown) =>
  handleGetArtifact(data)
);

ipcMain.handle(AI_ARTIFACT_LIST, async (_e, data: unknown) =>
  handleListArtifacts(data)
);
```

Handler rules:

1. Validate request shape before calling module methods.
2. Return `CommonMessage<AIArtifactRecord | null>` and `CommonMessage<AIArtifactSummary[]>`.
3. Do not directly access TypeORM repositories.
4. Do not require `USER_AI_ENABLED` for reading an already-created artifact. Artifact creation is already gated through Chat V2 stream. If product wants artifacts hidden when AI is disabled, add this as an explicit product rule.

Example:

```typescript
async function handleGetArtifact(data: unknown): Promise<CommonMessage<AIArtifactRecord | null>> {
  const req = parseGetArtifactRequest(data);
  if (!req.ok) return { status: false, msg: req.error, data: null };

  const module = new AIArtifactModule();
  const artifact = await module.getArtifact(req.value.artifactId);
  return { status: true, msg: "", data: artifact };
}
```

### 10.3 Renderer API

Create:

```text
src/views/api/aiArtifacts.ts
```

Recommended functions:

```typescript
export async function getAIArtifact(
  artifactId: string
): Promise<AIArtifactRecord | null>;

export async function listAIArtifacts(
  conversationId: string
): Promise<AIArtifactSummary[]>;
```

Use `windowInvoke`, matching `src/views/api/aiChatV2.ts`.

## 11. Chat V2 Stream Integration

### 11.1 Metadata Extraction

Modify `upsertToolResultMessage()` in:

```text
src/views/components/aiChatV2/AiChatV2.vue
```

Add a typed helper:

```typescript
function extractArtifactMetadata(
  toolResult: Record<string, unknown>
): AIArtifactToolMetadata | undefined {
  const artifact = toolResult.artifact;
  if (!artifact || typeof artifact !== "object") return undefined;
  const raw = artifact as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    raw.type !== "html" ||
    typeof raw.title !== "string" ||
    raw.mimeType !== "text/html"
  ) {
    return undefined;
  }
  return {
    id: raw.id,
    conversationId: typeof raw.conversationId === "string" ? raw.conversationId : "",
    type: "html",
    title: raw.title,
    description: typeof raw.description === "string" ? raw.description : undefined,
    mimeType: "text/html",
    version: typeof raw.version === "number" ? raw.version : 1,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    openImmediately: raw.openImmediately !== false,
  };
}
```

When building metadata:

```typescript
const artifact = extractArtifactMetadata(toolResult);

const metadata = {
  source: "chat-v2" as const,
  // existing fields...
  artifact,
};
```

### 11.2 Auto-Open

After `upsertToolResultMessage()` handles a `tool_result` chunk, if the artifact is present and `openImmediately` is true, emit an event to the parent:

```typescript
const emit = defineEmits<{
  (e: "open-artifact", artifactId: string): void;
}>();
```

In the stream handler:

```typescript
} else if (chunk.eventType === "tool_result") {
  const artifact = extractArtifactMetadata(chunk.toolResult ?? {});
  upsertToolResultMessage(...);
  if (artifact?.openImmediately) {
    emit("open-artifact", artifact.id);
  }
}
```

Avoid double-opening on history load. Auto-open only during live `tool_result` handling, not when rendering loaded messages.

### 11.3 Parent Wiring

Modify:

```text
src/views/layout/layout.vue
```

Current:

```vue
<AiChatV2 v-show="v2ChatPanelOpen" :prompt-request="pendingAiPromptRequest" />
```

Change:

```vue
<AiChatV2
  v-show="v2ChatPanelOpen"
  :prompt-request="pendingAiPromptRequest"
  @open-artifact="openAiArtifact"
/>
```

## 12. Renderer Components

### 12.1 AiArtifactWorkspace

Create:

```text
src/views/components/aiArtifacts/AiArtifactWorkspace.vue
```

Props:

```typescript
const props = defineProps<{
  artifact: AIArtifactRecord;
  loading?: boolean;
  error?: string;
}>();
```

Emits:

```typescript
const emit = defineEmits<{
  (e: "close"): void;
  (e: "copy-html"): void;
}>();
```

Template:

```vue
<section class="ai-artifact-workspace">
  <header class="ai-artifact-workspace__header">
    <div class="ai-artifact-workspace__title">
      <v-icon size="small">mdi-file-code-outline</v-icon>
      <span>{{ artifact.title }}</span>
    </div>
    <div class="ai-artifact-workspace__actions">
      <v-btn icon="mdi-content-copy" variant="text" size="small" @click="emit('copy-html')" />
      <v-btn icon="mdi-close" variant="text" size="small" @click="emit('close')" />
    </div>
  </header>
  <iframe
    class="ai-artifact-workspace__frame"
    sandbox=""
    :srcdoc="artifact.content"
    referrerpolicy="no-referrer"
  />
</section>
```

Rules:

1. Do not use `v-html`.
2. Do not add `allow-same-origin`.
3. Do not add `allow-forms`.
4. Do not add `allow-popups`.
5. Do not add `allow-top-navigation`.
6. Default to `sandbox=""`.
7. Use `referrerpolicy="no-referrer"`.

### 12.2 AiArtifactCard

Create:

```text
src/views/components/aiArtifacts/AiArtifactCard.vue
```

Props:

```typescript
const props = defineProps<{
  artifact: AIArtifactToolMetadata;
  disabled?: boolean;
}>();
```

Emits:

```typescript
const emit = defineEmits<{
  (e: "open", artifactId: string): void;
  (e: "copy-html", artifactId: string): void;
}>();
```

Behavior:

1. Display title, type, version, and description.
2. Provide icon buttons for open and copy.
3. Use translated labels and tooltips.
4. Keep card compact enough for the chat dock.
5. Do not fetch full HTML unless the user clicks copy.

### 12.3 AiChatV2Message Integration

Modify:

```text
src/views/components/aiChatV2/AiChatV2Message.vue
```

Add import:

```typescript
import AiArtifactCard from "@/views/components/aiArtifacts/AiArtifactCard.vue";
```

Extend emits:

```typescript
(e: "open-artifact", artifactId: string): void;
(e: "copy-artifact-html", artifactId: string): void;
```

Inside the `TOOL_RESULT` template, before generic details:

```vue
<AiArtifactCard
  v-if="message.metadata?.artifact"
  :artifact="message.metadata.artifact"
  :disabled="disabled"
  @open="(id) => emit('open-artifact', id)"
  @copy-html="(id) => emit('copy-artifact-html', id)"
/>
```

If an artifact is present, hide the raw JSON details by default or collapse them behind details. The user should not see the full escaped JSON unless they expand technical details.

### 12.4 AiChatV2Messages Event Pass-Through

Modify:

```text
src/views/components/aiChatV2/AiChatV2Messages.vue
```

Pass events from `AiChatV2Message` to `AiChatV2.vue`:

```vue
@open-artifact="(id) => emit('open-artifact', id)"
@copy-artifact-html="(id) => emit('copy-artifact-html', id)"
```

### 12.5 Layout Workspace State

Modify:

```text
src/views/layout/layout.vue
```

Add state:

```typescript
const activeArtifact = ref<AIArtifactRecord | null>(null);
const artifactLoading = ref(false);
const artifactError = ref<string | null>(null);
```

Add method:

```typescript
const openAiArtifact = async (artifactId: string): Promise<void> => {
  artifactLoading.value = true;
  artifactError.value = null;
  try {
    const artifact = await getAIArtifact(artifactId);
    if (!artifact) {
      artifactError.value =
        t("aiArtifacts.not_found") || "Artifact not found.";
      return;
    }
    activeArtifact.value = artifact;
  } catch (error: unknown) {
    artifactError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    artifactLoading.value = false;
  }
};

const closeAiArtifact = (): void => {
  activeArtifact.value = null;
  artifactError.value = null;
};
```

Change `.router` content:

```vue
<div class="router">
  <AiArtifactWorkspace
    v-if="activeArtifact"
    :artifact="activeArtifact"
    :loading="artifactLoading"
    :error="artifactError ?? undefined"
    @close="closeAiArtifact"
    @copy-html="copyActiveArtifactHtml"
  />
  <RouterView v-else />
</div>
```

## 13. Copy HTML

`copyActiveArtifactHtml()` can use the browser clipboard API:

```typescript
const copyActiveArtifactHtml = async (): Promise<void> => {
  if (!activeArtifact.value) return;
  try {
    await navigator.clipboard.writeText(activeArtifact.value.content);
    showSuccessMessage(t("aiArtifacts.copy_success") || "HTML copied.");
  } catch {
    showErrorMessage(t("aiArtifacts.copy_error") || "Could not copy HTML.");
  }
};
```

If clipboard permission fails in Electron, add a main-process clipboard IPC later. For MVP, renderer clipboard is acceptable if it works in the existing Electron config.

## 14. Security Model

### 14.1 Primary Boundary

The primary security boundary is iframe sandboxing:

```html
<iframe sandbox="" srcdoc="..."></iframe>
```

With an empty sandbox attribute:

1. Scripts do not run.
2. Forms cannot submit.
3. Popups cannot open.
4. Top navigation is blocked.
5. Same-origin access is not granted.

### 14.2 Secondary Boundary

Validation rejects unsupported HTML patterns before persistence.

Validation is not a complete sanitizer. It reduces accidental bad output, keeps artifacts simple, and prevents obvious unsupported features.

### 14.3 Electron Constraints

Artifact HTML must never receive:

1. Node.js integration.
2. Preload APIs.
3. Electron APIs.
4. App IPC APIs.
5. File paths.
6. Cookies or localStorage from the parent renderer.

Using `srcdoc` plus `sandbox=""` protects this boundary. Do not switch to `file://` artifact loading.

### 14.4 Future Scripts

If future chart artifacts need JavaScript:

1. Add a new artifact mode, not a silent change to HTML artifacts.
2. Require a separate security review.
3. Use `sandbox="allow-scripts"` only.
4. Do not add `allow-same-origin`.
5. Bundle approved chart code locally.
6. Continue blocking external scripts and network resources.

## 15. AI Prompting And Tool Choice

The tool description is the main model-level guard. Add one more system-level instruction wherever built-in tool guidance is assembled:

```text
Prefer normal chat responses by default. Use create_html_artifact only when a rendered visual artifact would materially improve the user experience or when the user explicitly asks to display generated content in the main area.
```

Do not rely on frontend heuristics to suppress artifacts. The model should learn correct usage from the tool description, and the app should handle incorrect usage safely.

## 16. Internationalization

Add `aiArtifacts` keys to all supported language files:

```typescript
aiArtifacts: {
  preview_title: "AI Artifact",
  open: "Open artifact",
  close: "Close artifact",
  copy_html: "Copy HTML",
  copy_success: "HTML copied.",
  copy_error: "Could not copy HTML.",
  not_found: "Artifact not found.",
  generated_by_ai: "Generated by AI",
  html_artifact: "HTML artifact",
  version_label: "Version {version}",
}
```

Files:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

Every user-facing string in `AiArtifactWorkspace.vue` and `AiArtifactCard.vue` must use `t()`.

## 17. Clearing And History Behavior

### 17.1 Clear Current Conversation

Modify:

```text
src/modules/AIChatV2Module.ts
```

Inside `clearConversation()`:

```typescript
try {
  const artifactModule = new AIArtifactModule();
  await artifactModule.deleteByConversation(conversationId);
} catch (err) {
  console.error("[ai-chat-v2] clearConversation: artifact clear failed:", err);
}
```

### 17.2 Clear All V2 History

`clearAllV2History()` already loops through V2 conversations. Calling `clearConversation()` for each conversation would centralize cleanup, but it currently calls `chatModule.clearConversation()` directly inside the loop. Either:

1. Refactor `clearAllV2History()` to call `this.clearConversation(s.conversationId)`, or
2. Add artifact deletion inside the loop.

Recommended: refactor to call `this.clearConversation()` so attachments, compact summaries, session memory, and artifacts follow one cleanup path.

### 17.3 History Load

When history loads, artifact metadata should render cards, but the artifact should not auto-open. Auto-open is only for live tool results.

## 18. Error Handling

### 18.1 Tool Validation Errors

Tool validation failure should return a normal tool result:

```json
{
  "success": false,
  "summary": "Could not create the HTML artifact.",
  "error": "Scripts are not supported in HTML artifacts."
}
```

The LLM can then explain the failure and optionally retry with simpler HTML.

### 18.2 Artifact Fetch Errors

Renderer should show:

1. Snackbar error through existing layout message helpers.
2. Inline empty state if the workspace was already open.

Do not crash the layout if artifact fetch fails.

### 18.3 Missing Artifact Content

If a chat message references an artifact id that no longer exists, the card should show a disabled or error state:

```text
Artifact unavailable
```

This can happen if the conversation was partially cleared or database migration failed.

## 19. Testing Plan

### 19.1 Unit Tests

Add:

```text
test/vitest/utilitycode/aiArtifactValidation.test.ts
```

Cases:

1. Valid full HTML document passes.
2. Valid fragment is wrapped into a document.
3. Empty title fails.
4. Empty HTML fails.
5. Oversized HTML fails.
6. `<script>` fails.
7. Inline event handler fails.
8. Remote script/style/image fails.
9. Form fails.
10. `openImmediately` defaults to true.

### 19.2 Module Tests

Add:

```text
test/modules/AIArtifactModule.test.ts
```

Cases:

1. Create artifact stores content.
2. Get artifact returns full content.
3. List artifacts returns summaries only.
4. Delete by conversation removes artifacts.
5. Version increments on repeated generation if title-based versioning is implemented.

### 19.3 Main Process Tests

Add:

```text
test/vitest/main/aiArtifactIpc.test.ts
test/vitest/main/createHtmlArtifactTool.test.ts
```

Cases:

1. Tool returns metadata without content.
2. Tool requires conversation id.
3. IPC get returns full artifact content.
4. IPC list returns summaries.
5. Invalid IPC payload returns `{ status: false }`.

### 19.4 Renderer Tests

Add:

```text
test/vitest/utilitycode/aiArtifactMetadata.test.ts
```

If Vue component testing is available, add:

```text
test/vitest/main/AiArtifactCard.test.ts
test/vitest/main/AiArtifactWorkspace.test.ts
```

Cases:

1. Artifact card renders title and actions.
2. Workspace renders iframe with `sandbox=""`.
3. Workspace uses `srcdoc`.
4. Workspace does not use `v-html`.
5. Long titles truncate.

### 19.5 Manual QA

Prompts:

```text
Generate a statistical report with three cards, one table, and a short insight section. Show it in the main area.
```

```text
What is open rate?
```

Expected: first prompt creates an artifact. Second prompt answers in chat only.

Security payloads:

```html
<script>alert(1)</script>
```

```html
<img src="https://example.com/pixel.png">
```

```html
<button onclick="alert(1)">Click</button>
```

Expected: validation rejects them, or they cannot execute in the iframe sandbox.

## 20. Implementation Sequence

### Step 1: Types And Entity

1. Add `aiArtifactTypes.ts`.
2. Add `AIArtifact.entity.ts`.
3. Register entity in `SqliteDb.ts`.

Commit:

```text
feat: add ai artifact persistence types
```

### Step 2: Model And Module

1. Add `AIArtifact.model.ts`.
2. Add `AIArtifactModule.ts`.
3. Add module tests.

Commit:

```text
feat: add ai artifact storage module
```

### Step 3: Validation And Tool Service

1. Add `AIArtifactValidationService.ts`.
2. Add `AIHtmlArtifactToolService.ts`.
3. Add validation tests.

Commit:

```text
feat: add html artifact validation service
```

### Step 4: Built-In Tool Registration

1. Register `create_html_artifact` in `skillsRegistry.ts`.
2. Add tool tests.

Commit:

```text
feat: register html artifact ai tool
```

### Step 5: IPC Read APIs

1. Add channels.
2. Add main-process handlers.
3. Add renderer API.

Commit:

```text
feat: expose ai artifact read api
```

### Step 6: Renderer Artifact Workspace

1. Add `AiArtifactWorkspace.vue`.
2. Add `AiArtifactCard.vue`.
3. Add i18n keys.

Commit:

```text
feat: add ai artifact preview components
```

### Step 7: AiChatV2 Wiring

1. Extend metadata types.
2. Extract artifact metadata from tool results.
3. Render artifact card.
4. Emit open events.
5. Wire layout preview state.

Commit:

```text
feat: open ai artifacts from chat results
```

### Step 8: Cleanup And QA

1. Clear artifacts with conversations.
2. Run type checks and targeted tests.
3. Manual QA generated artifacts and simple answers.

Commit:

```text
test: cover ai html artifact flow
```

## 21. Open Technical Decisions

1. **Versioning strategy**: Use title-based version increments or always create version `1` with a unique id. Recommendation: unique id plus version number scoped by conversation and normalized title.
2. **Maximum HTML size**: Start at 512 KB. Raise only after real artifact examples need it.
3. **Sanitization dependency**: Do not add a sanitizer for MVP unless the app later renders outside a sandbox. Validation plus sandbox is enough for the MVP constraints.
4. **Artifact preview placement**: Replace `RouterView` while open. Overlay can come later if users need to compare route content and artifact content.
5. **Read gating**: Artifact creation is AI-gated. Artifact reads can remain available after AI is disabled because they are local stored content.

## 22. Done Definition

The feature is complete when:

1. `create_html_artifact` appears in the tool list with the PRD-approved description.
2. A live AiChatV2 turn can create an artifact and open it in the main area.
3. Chat shows an artifact card instead of raw HTML.
4. The preview iframe uses `sandbox=""` and `srcdoc`.
5. No generated HTML is rendered with `v-html`.
6. Artifacts persist and can be reopened from chat history.
7. Clearing a conversation removes its artifacts.
8. All new UI text is translated in six language files.
9. Targeted validation, module, IPC, and renderer tests pass.
10. Manual malicious HTML payloads cannot execute or access app state.
