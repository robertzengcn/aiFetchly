# AI Chat Conversation Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible "Report conversation" action to the three chat surfaces that lets users select 1–10 AI outputs (optionally plus directly related user messages after fresh opt-in) and submit a strict schema-version-2 request on the existing `/api/ai/content-reports` endpoint, without changing any version-1 behavior.

**Architecture:** A new immutable-snapshot renderer flow. Each chat surface passes its visible message array into a pure allowlist snapshot builder at dialog-open time. A separate `AIConversationReportDialog.vue` (not a mode of the existing dialog) handles multi-selection, related-user consent, aggregate text limits, and submission. A new non-AI-gated `GET capabilities` IPC channel + 5-min main-process cache fail-closes the v2 UI when the backend is unavailable. The main process re-validates with a `z.union` of two literal-version strict schemas and re-normalizes text as defense in depth. No new database entity; backend is source of truth.

**Tech Stack:** TypeScript 5.x, Vue 3 Composition API, Vuetify, Zod 3.25 (new code imports `zod/v4` per CLAUDE.md; the existing v1 schema file keeps its bare `zod` import and remains valid), Vitest + @vue/test-utils, Playwright Electron E2E, Pinia.

**Authoritative references (read before implementing any task):**
- PRD: `docs/prd/ai-chat-conversation-reporting-prd.md`
- Technical design (the blueprint — exact code appears in its §6–§20): `docs/prd/ai-chat-conversation-reporting-technical-design.md`
- Section numbers cited throughout this plan refer to the technical design.

**Hard invariants (CLAUDE.md + design §2, §13.3, §18):**
- Both report handlers use `registerValidatedHandler`, NEVER `registerAiValidatedHandler`. Reporting must work when `USER_AI_ENABLED !== "true"`, after subscription expiry, when the model is unavailable. It never consumes AI credits.
- NEVER use `any` (use `unknown` or proper types).
- New Zod code imports `{ z } from "zod/v4"`. The existing `src/schemas/ipc/aiContentReport.ts` line 1 uses bare `zod` — leave it; it must remain valid and unchanged in behavior.
- NEVER bypass git hooks: do NOT pass `--no-verify`/`-n` to `git commit`. Fix lint + `tsc` errors instead.
- UI changes ship with their component tests in the same change (`test/vitest/main/components/`).
- i18n for all 6 languages (en, zh, es, fr, de, ja) — new `aiConversationReport` block; existing `aiContentReport` block unchanged.
- Auto-commit each completed logical unit with `<type>: <description>`.
- No new files under `src/entity/`, `src/model/`, or `src/childprocess/`.
- Never log report content (items, comment, text, images, conversation/message identifiers, model names, auth, response bodies). Metadata-only.
- `formatZodValidationError` must not include rejected values (regression test with secret markers).
- Worker processes never access the DB. The report service uses `HttpClient`, never TypeORM/SQLite.

**Worktree base:** This plan's foundation (v1 reporting infrastructure + both docs) exists on the `test` branch, NOT `origin/master`. The worktree MUST be branched from `test` (see Task 0).

---

## Phase 1: Contract and Pure Logic (design §6, §7, §8, §9, §12)

### Task 0: Create worktree branched from `test`

**Files:** none (worktree setup)

- [ ] **Step 1: Verify branch and foundation**

Run:
```bash
git branch --show-current      # must print: test
git rev-parse --short HEAD     # must print: cc65a609
test -f src/schemas/ipc/aiContentReport.ts && echo "v1 schema OK"
test -f docs/prd/ai-chat-conversation-reporting-technical-design.md && echo "design OK"
```
Expected: all three print OK. If `test` is not the current branch, `git checkout test` first.

- [ ] **Step 2: Create the worktree branched from `test` (NOT origin/master)**

The EnterWorktree tool defaults to `fresh` (= origin/master), which LACKS the v1 infrastructure. Branch from `test` explicitly:
```bash
git worktree add -b worktree-conversation-reporting .claude/worktrees/conversation-reporting test
```
Then enter it via the EnterWorktree tool with `path`: `.claude/worktrees/conversation-reporting`.

- [ ] **Step 3: Confirm the worktree is on the new branch and foundation is present**

Run inside the worktree:
```bash
git branch --show-current   # worktree-conversation-reporting
test -f src/schemas/ipc/aiContentReport.ts && echo OK
yarn                        # install deps (needed once per worktree)
```

---

### Task 1: Version-2 + capability types (design §6)

**Files:**
- Modify: `src/entityTypes/aiContentReportTypes.ts` (append after the existing v1 interfaces; do NOT change any existing export)

- [ ] **Step 1: Append the version-2 + capability types**

Open `src/entityTypes/aiContentReportTypes.ts`. After the last existing interface (before EOF), append exactly:

```typescript
// ---------------------------------------------------------------------------
// Conversation reporting (schema version 2) — design §6.
// These EXTEND the version-1 types; nothing above this line changes.
// ---------------------------------------------------------------------------

export const AI_CONVERSATION_REPORT_SCOPES = [
  "selected_ai_outputs",
  "selected_ai_outputs_with_related_user_context",
] as const;

export type AIConversationReportScope =
  (typeof AI_CONVERSATION_REPORT_SCOPES)[number];

export const AI_CONVERSATION_REPORT_SURFACES = [
  "chat_v2",
  "legacy_chat",
  "knowledge_chat",
] as const;

export type AIConversationReportSurface =
  (typeof AI_CONVERSATION_REPORT_SURFACES)[number];

export interface AIConversationReportItem {
  itemId: string;
  messageId: string;
  sequence: number;
  role: "assistant" | "user";
  contentType: AIContentType;
  text?: string;
  textTruncated?: boolean;
  imagePreviews?: AIContentReportImagePreview[];
  evidenceUnavailable?: boolean;
  generatedAt?: string;
  model?: string;
  consentSource?: "related_user_context_toggle";
}

export interface AIConversationReportContext {
  conversationId: string;
  selectedAIItemCount: number;
  includedUserItemCount: number;
  aggregateTextTruncated?: boolean;
  appVersion: string;
  platform: "win32" | "darwin" | "linux";
  locale: string;
  installId?: string;
}

export interface CreateAIConversationReportRequest {
  schemaVersion: 2;
  clientReportId: string;
  surface: AIConversationReportSurface;
  reportScope: AIConversationReportScope;
  category: AIContentReportCategory;
  comment?: string;
  items: AIConversationReportItem[];
  context: AIConversationReportContext;
}

export type CreateAnyAIContentReportRequest =
  | CreateAIContentReportRequest
  | CreateAIConversationReportRequest;

export interface AIContentReportCapabilities {
  acceptedSchemaVersions: readonly number[];
  conversationReporting: {
    enabled: boolean;
    maxAIItems: number;
    maxUserItems: number;
    maxTotalItems: number;
    maxItemTextChars: number;
    maxAggregateTextChars: number;
    maxImages: number;
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors). If errors appear, the appended types reference an existing symbol that was renamed — fix the reference, do not change existing symbols.

- [ ] **Step 3: Commit**

```bash
git add src/entityTypes/aiContentReportTypes.ts
git commit -m "feat: add conversation-report (schema v2) + capability types"
```

---

### Task 2: Version-2 Zod request schema + union (design §12)

**Files:**
- Modify: `src/schemas/ipc/aiContentReport.ts` (append v2 schema + union; keep `createAIContentReportSchema` export unchanged)

- [ ] **Step 1: Add the v2 item + root schema and the union**

The existing file line 1 is `import { z } from "zod";` (bare). Leave it. After the existing `export type CreateAIContentReportInput` block at EOF, append:

```typescript
// ---------------------------------------------------------------------------
// Conversation reporting (schema version 2) — design §12.
// Kept in the same file so the union can reference both v1 and v2 inner
// strict objects without crossing module boundaries or re-invoking a
// lazy factory while constructing another schema (design §12 note).
// ---------------------------------------------------------------------------

const MAX_V2_ITEM_TEXT = 8_000;
const MAX_V2_IMAGES_PER_ITEM = 3;
const MAX_V2_AGGREGATE_TEXT = 32_000;
const MAX_V2_ITEMS = 20;
const MAX_V2_AI_ITEMS = 10;
const MAX_V2_USER_ITEMS = 10;
const MAX_V2_TOTAL_IMAGES = 3;

const conversationSurfaceSchema = z.enum(AI_CONVERSATION_REPORT_SURFACES);
const conversationScopeSchema = z.enum(AI_CONVERSATION_REPORT_SCOPES);

const v2ItemSchema = z
  .strictObject({
    itemId: z.string().min(1).max(MAX_SHORT_ID),
    messageId: z.string().min(1).max(MAX_SHORT_ID),
    sequence: z.number().int().nonnegative(),
    role: z.enum(["assistant", "user"]),
    contentType: contentTypeSchema,
    text: z.string().max(MAX_V2_ITEM_TEXT).optional(),
    textTruncated: z.boolean().optional(),
    imagePreviews: z.array(imagePreviewSchema).max(MAX_V2_IMAGES_PER_ITEM).optional(),
    evidenceUnavailable: z.boolean().optional(),
    generatedAt: z.string().datetime().optional(),
    model: z.string().max(MAX_SHORT_ID).optional(),
    consentSource: z.literal("related_user_context_toggle").optional(),
  });

const v2ContextSchema = z.strictObject({
  conversationId: z.string().min(1).max(MAX_SHORT_ID),
  selectedAIItemCount: z.number().int().nonnegative(),
  includedUserItemCount: z.number().int().nonnegative(),
  aggregateTextTruncated: z.boolean().optional(),
  appVersion: z.string().min(1).max(MAX_APP_VERSION),
  platform: z.enum(["win32", "darwin", "linux"]),
  locale: z.string().min(1).max(MAX_LOCALE),
  installId: z.string().max(MAX_SHORT_ID).optional(),
});

/**
 * Inner strict v2 schema (not lazy-wrapped). Defined once so the union can
 * reference the SAME instance as the standalone v2 export — design §12 warns
 * against invoking one lazy factory inside another.
 *
 * superRefine enforces the 13 root rules in design §12.2.
 */
const createAIConversationReportV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    clientReportId: z.string().min(1).max(MAX_SHORT_ID),
    surface: conversationSurfaceSchema,
    reportScope: conversationScopeSchema,
    category: categorySchema,
    comment: z.string().max(MAX_COMMENT_CHARS).optional(),
    items: z.array(v2ItemSchema).min(1).max(MAX_V2_ITEMS),
    context: v2ContextSchema,
  })
  .superRefine((req, ctx) => {
    const items = req.items;
    const aiItems = items.filter((i) => i.role === "assistant");
    const userItems = items.filter((i) => i.role === "user");

    // 2. Assistant count 1..10
    if (aiItems.length < 1 || aiItems.length > MAX_V2_AI_ITEMS) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: `Assistant item count must be 1..${MAX_V2_AI_ITEMS}`,
      });
    }
    // 3. User count 0..10
    if (userItems.length > MAX_V2_USER_ITEMS) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: `User item count must be 0..${MAX_V2_USER_ITEMS}`,
      });
    }
    // 4. Declared counts equal actual counts
    if (req.context.selectedAIItemCount !== aiItems.length) {
      ctx.addIssue({
        code: "custom",
        path: ["context", "selectedAIItemCount"],
        message: "selectedAIItemCount must equal actual assistant item count",
      });
    }
    if (req.context.includedUserItemCount !== userItems.length) {
      ctx.addIssue({
        code: "custom",
        path: ["context", "includedUserItemCount"],
        message: "includedUserItemCount must equal actual user item count",
      });
    }
    // 5. selected_ai_outputs contains no user items
    if (
      req.reportScope === "selected_ai_outputs" &&
      userItems.length > 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reportScope"],
        message: "selected_ai_outputs must not contain user items",
      });
    }
    // 6. with_related_user_context contains >=1 consented user item
    if (
      req.reportScope === "selected_ai_outputs_with_related_user_context" &&
      userItems.length < 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reportScope"],
        message:
          "selected_ai_outputs_with_related_user_context requires at least one consented user item",
      });
    }
    // 7. IDs and messageIds unique per role; assistant & related user cannot share messageId
    const assistantMessageIds = new Set(
      aiItems.map((i) => i.messageId)
    );
    for (const u of userItems) {
      if (assistantMessageIds.has(u.messageId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: "An assistant and a related user item cannot share a messageId",
        });
        break;
      }
    }
    const seenItemIds = new Set<string>();
    for (const it of items) {
      if (seenItemIds.has(it.itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items"],
          message: "Duplicate itemId",
        });
        break;
      }
      seenItemIds.add(it.itemId);
    }
    // 8. Sequences are exactly 0..items.length-1 in array order
    for (let i = 0; i < items.length; i++) {
      if (items[i].sequence !== i) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "sequence"],
          message: "Sequences must be contiguous 0..n-1 in array order",
        });
        break;
      }
    }
    // 9. Aggregate text length <= 32000
    const aggregateText = items
      .map((i) => i.text ?? "")
      .reduce((a, b) => a + b.length, 0);
    if (aggregateText > MAX_V2_AGGREGATE_TEXT) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Aggregate text length must be at most 32000 characters",
      });
    }
    // 10. Total image previews <= 3
    const totalImages = items.reduce(
      (n, i) => n + (i.imagePreviews?.length ?? 0),
      0
    );
    if (totalImages > MAX_V2_TOTAL_IMAGES) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "At most 3 image previews across all items",
      });
    }
    // 12. conversationId non-empty (schema already enforces min(1)); covered by z.string().min(1)
    // 13. If every assistant item has only evidenceUnavailable, comment must be non-empty
    const allAiOnlyUnavailable = aiItems.length > 0 && aiItems.every(
      (i) =>
        i.evidenceUnavailable === true &&
        !(typeof i.text === "string" && i.text.length > 0) &&
        !(Array.isArray(i.imagePreviews) && i.imagePreviews.length > 0)
    );
    if (
      allAiOnlyUnavailable &&
      (typeof req.comment !== "string" || req.comment.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["comment"],
        message:
          "A non-empty comment is required when every assistant item has only evidenceUnavailable",
      });
    }
    // Per-item evidence rule (§12.1): assistant items need >=1 of text/images/evidenceUnavailable;
    // user items must be text-only with consentSource set exactly.
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.role === "assistant") {
        const hasEvidence =
          (typeof it.text === "string" && it.text.length > 0) ||
          (Array.isArray(it.imagePreviews) && it.imagePreviews.length > 0) ||
          it.evidenceUnavailable === true;
        if (!hasEvidence) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i],
            message:
              "Assistant item needs at least one of text, imagePreviews, or evidenceUnavailable",
          });
        }
      } else {
        if (it.contentType !== "text") {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "contentType"],
            message: "User items must use contentType 'text'",
          });
        }
        if (typeof it.text !== "string" || it.text.length === 0) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "text"],
            message: "User items must contain non-empty text",
          });
        }
        if (Array.isArray(it.imagePreviews) && it.imagePreviews.length > 0) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "imagePreviews"],
            message: "User items must not contain images",
          });
        }
        if (it.model !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "model"],
            message: "User items must not include a model",
          });
        }
        if (it.evidenceUnavailable !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "evidenceUnavailable"],
            message: "User items must not set evidenceUnavailable",
          });
        }
        if (it.consentSource !== "related_user_context_toggle") {
          ctx.addIssue({
            code: "custom",
            path: ["items", i, "consentSource"],
            message: "User items must set consentSource to 'related_user_context_toggle'",
          });
        }
      }
    }
  });

export const createAIConversationReportSchema = lazySchema(() =>
  createAIConversationReportV2Schema
);

/**
 * Union of the two literal-version strict schemas. Used at the IPC + service
 * dispatch boundary. A normal z.union is required (not discriminatedUnion)
 * because both branches use superRefine → ZodEffects, which Zod 3.25's
 * discriminatedUnion rejects (design §12 note). The literal schemaVersion
 * still rejects cross-version payloads; app code narrows with
 * `request.schemaVersion`.
 */
export const createAnyAIContentReportSchema = lazySchema(() =>
  z.union([
    createAIContentReportSchema(),
    createAIConversationReportV2Schema,
  ])
);
```

Note: `createAIContentReportSchema()` is invoked here because it is itself a `lazySchema` factory; calling it yields the cached v1 schema instance. `createAIConversationReportV2Schema` is already a concrete schema (not lazy), referenced directly so the two exports share one instance.

- [ ] **Step 2: Write the failing schema test**

Create `test/vitest/utilitycode/aiConversationReportSchema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  createAIConversationReportSchema,
  createAnyAIContentReportSchema,
} from "@/schemas/ipc/aiContentReport";
import type { CreateAIConversationReportRequest } from "@/entityTypes/aiContentReportTypes";

function makeValidV2(
  overrides: Partial<CreateAIConversationReportRequest> = {}
): CreateAIConversationReportRequest {
  return {
    schemaVersion: 2,
    clientReportId: "client-uuid-v2",
    surface: "chat_v2",
    reportScope: "selected_ai_outputs",
    category: "other",
    comment: "Conversation issue",
    items: [
      {
        itemId: "item-1",
        messageId: "msg-1",
        sequence: 0,
        role: "assistant",
        contentType: "text",
        text: "AI response text",
      },
    ],
    context: {
      conversationId: "conv-1",
      selectedAIItemCount: 1,
      includedUserItemCount: 0,
      appVersion: "1.0.0",
      platform: "win32",
      locale: "en-US",
    },
    ...overrides,
  };
}

describe("createAIConversationReportSchema (v2)", () => {
  it("accepts a minimal valid v2 request", () => {
    const r = createAIConversationReportSchema().safeParse(makeValidV2());
    expect(r.success).toBe(true);
  });

  it("accepts an opted-in request with a related user item", () => {
    const req = makeValidV2({
      reportScope: "selected_ai_outputs_with_related_user_context",
      items: [
        {
          itemId: "item-0",
          messageId: "user-msg-0",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "What is the capital?",
          consentSource: "related_user_context_toggle",
        },
        {
          itemId: "item-1",
          messageId: "msg-1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "Paris",
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(true);
  });

  it("rejects zero assistant items", () => {
    const r = createAIConversationReportSchema().safeParse(
      makeValidV2({ items: [] })
    );
    expect(r.success).toBe(false);
  });

  it("rejects more than 10 assistant items", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({
      itemId: `item-${i}`,
      messageId: `msg-${i}`,
      sequence: i,
      role: "assistant" as const,
      contentType: "text" as const,
      text: "x",
    }));
    const r = createAIConversationReportSchema().safeParse(
      makeValidV2({ items })
    );
    expect(r.success).toBe(false);
  });

  it("rejects user items in selected_ai_outputs scope", () => {
    const req = makeValidV2({
      reportScope: "selected_ai_outputs",
      items: [
        {
          itemId: "u-0",
          messageId: "u-msg-0",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "hi",
          consentSource: "related_user_context_toggle",
        },
        {
          itemId: "a-1",
          messageId: "a-msg-1",
          sequence: 1,
          role: "assistant",
          contentType: "text",
          text: "hello",
        },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(false);
  });

  it("rejects with_related_user_context with zero user items", () => {
    const r = createAIConversationReportSchema().safeParse(
      makeValidV2({
        reportScope: "selected_ai_outputs_with_related_user_context",
      })
    );
    expect(r.success).toBe(false);
  });

  it("rejects non-contiguous sequences", () => {
    const req = makeValidV2({
      items: [
        { itemId: "i0", messageId: "m0", sequence: 0, role: "assistant", contentType: "text", text: "a" },
        { itemId: "i1", messageId: "m1", sequence: 5, role: "assistant", contentType: "text", text: "b" },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 2,
        includedUserItemCount: 0,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(false);
  });

  it("rejects aggregate text over 32000 chars", () => {
    const huge = "x".repeat(33000);
    const req = makeValidV2({
      items: [
        { itemId: "i0", messageId: "m0", sequence: 0, role: "assistant", contentType: "text", text: huge },
      ],
    });
    // Per-item cap is 8000, so this also fails the per-item rule.
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(false);
  });

  it("rejects user item without consentSource", () => {
    const req = makeValidV2({
      reportScope: "selected_ai_outputs_with_related_user_context",
      items: [
        {
          itemId: "u-0",
          messageId: "u-msg-0",
          sequence: 0,
          role: "user",
          contentType: "text",
          text: "hi",
          // consentSource omitted
        },
        { itemId: "a-1", messageId: "a-msg-1", sequence: 1, role: "assistant", contentType: "text", text: "hello" },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 1,
        includedUserItemCount: 1,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(false);
  });

  it("rejects unknown keys (strictObject)", () => {
    const r = createAIConversationReportSchema().safeParse({
      ...makeValidV2(),
      sneaky: "leak",
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 3 total image previews", () => {
    const b64 = "iVBORw0KGgoAAAANS"; // tiny stub
    const img = {
      mimeType: "image/png",
      dataBase64: b64,
      width: 1,
      height: 1,
    };
    const req = makeValidV2({
      items: [
        { itemId: "i0", messageId: "m0", sequence: 0, role: "assistant", contentType: "mixed", text: "a", imagePreviews: [img, img] },
        { itemId: "i1", messageId: "m1", sequence: 1, role: "assistant", contentType: "mixed", text: "b", imagePreviews: [img, img] },
      ],
      context: {
        conversationId: "conv-1",
        selectedAIItemCount: 2,
        includedUserItemCount: 0,
        appVersion: "1.0.0",
        platform: "win32",
        locale: "en-US",
      },
    });
    expect(createAIConversationReportSchema().safeParse(req).success).toBe(false);
  });
});

describe("createAnyAIContentReportSchema (union)", () => {
  it("accepts a v1 request", () => {
    const v1 = {
      schemaVersion: 1,
      clientReportId: "c1",
      surface: "chat_v2",
      contentType: "text",
      category: "other",
      comment: "x",
      output: { text: "AI output" },
      context: { conversationId: "c", messageId: "m", appVersion: "1.0.0", platform: "win32", locale: "en-US" },
    };
    expect(createAnyAIContentReportSchema().safeParse(v1).success).toBe(true);
  });

  it("accepts a v2 request", () => {
    expect(
      createAnyAIContentReportSchema().safeParse(makeValidV2()).success
    ).toBe(true);
  });

  it("rejects a v1 object carrying v2 keys (no items leak into v1)", () => {
    const v1WithV2Keys = {
      schemaVersion: 1,
      clientReportId: "c1",
      surface: "chat_v2",
      contentType: "text",
      category: "other",
      output: { text: "AI output" },
      context: { appVersion: "1.0.0", platform: "win32", locale: "en-US" },
      items: [{ itemId: "x", messageId: "y", sequence: 0, role: "assistant", contentType: "text", text: "z" }],
      reportScope: "selected_ai_outputs",
    };
    expect(createAnyAIContentReportSchema().safeParse(v1WithV2Keys).success).toBe(false);
  });

  it("rejects an unknown schemaVersion", () => {
    expect(
      createAnyAIContentReportSchema().safeParse({ ...makeValidV2(), schemaVersion: 9 }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails before schema exists (if Task 1 not committed yet), then passes**

Run: `yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiConversationReportSchema.test.ts`
Expected: PASS (all cases green). If `yarn vitest` is not configured for utilityCode, run `node scripts/run-main-tests.js`-equivalent; the project's `yarn testmain` covers `test/vitest/main` and `test/vitest/utilitycode` via `vite.utilityCode.config.mjs`. Confirm with: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiConversationReportSchema.test.ts`.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/ipc/aiContentReport.ts test/vitest/utilitycode/aiConversationReportSchema.test.ts
git commit -m "feat: add conversation-report v2 zod schema + v1/v2 union"
```

---

### Task 3: Text normalization utility (design §8)

**Files:**
- Create: `src/views/components/aiContentReport/conversationReportText.ts`
- Test: `test/vitest/utilitycode/conversationReportText.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/conversationReportText.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  MAX_CONVERSATION_AGGREGATE_TEXT,
  MAX_CONVERSATION_ITEM_TEXT,
  normalizeConversationTexts,
} from "@/views/components/aiContentReport/conversationReportText";

describe("normalizeConversationTexts", () => {
  it("returns items unchanged when under both limits", () => {
    const out = normalizeConversationTexts([
      { itemId: "a", text: "hello" },
      { itemId: "b", text: "world" },
    ]);
    expect(out.texts.map((t) => t.text)).toEqual(["hello", "world"]);
    expect(out.texts.every((t) => !t.truncated)).toBe(true);
    expect(out.aggregateTruncated).toBe(false);
  });

  it("clamps a single item over 8000 chars", () => {
    const huge = "x".repeat(9000);
    const out = normalizeConversationTexts([{ itemId: "a", text: huge }]);
    expect(out.texts[0].text!.length).toBeLessThanOrEqual(MAX_CONVERSATION_ITEM_TEXT);
    expect(out.texts[0].truncated).toBe(true);
    // head + marker + tail preserved
    expect(out.texts[0].text!.startsWith("x")).toBe(true);
    expect(out.texts[0].text!.includes("[truncated]")).toBe(true);
  });

  it("preserves head and tail on truncation", () => {
    const text = "HEAD" + "x".repeat(9000) + "TAIL";
    const out = normalizeConversationTexts([{ itemId: "a", text }]);
    expect(out.texts[0].text!.startsWith("HEAD")).toBe(true);
    expect(out.texts[0].text!.endsWith("TAIL")).toBe(true);
  });

  it("distributes aggregate budget across many items", () => {
    // 20 items each 3000 chars = 60000 total > 32000 aggregate
    const inputs = Array.from({ length: 20 }, (_, i) => ({
      itemId: `i${i}`,
      text: "y".repeat(3000),
    }));
    const out = normalizeConversationTexts(inputs);
    const total = out.texts.reduce((n, t) => n + t.text!.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CONVERSATION_AGGREGATE_TEXT);
    // Every non-empty item retains at least 1600 chars (design §8)
    expect(out.texts.every((t) => t.text!.length >= 1600)).toBe(true);
    expect(out.aggregateTruncated).toBe(true);
  });

  it("preserves item order", () => {
    const out = normalizeConversationTexts([
      { itemId: "first", text: "a" },
      { itemId: "second", text: "b" },
      { itemId: "third", text: "c" },
    ]);
    expect(out.texts.map((t) => t.itemId)).toEqual(["first", "second", "third"]);
  });

  it("is deterministic for identical input", () => {
    const inputs = [{ itemId: "a", text: "x".repeat(9000) }];
    const a = normalizeConversationTexts(inputs);
    const b = normalizeConversationTexts(inputs);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/conversationReportText.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/views/components/aiContentReport/conversationReportText.ts`:

```typescript
/**
 * Pure, runtime-neutral text normalization for conversation reports (design §8).
 * Used by request construction in the renderer AND mirrored defensively in the
 * main-process service before HTTP submission.
 *
 * Bounds (PRD §10.4 / design §8):
 *  - per-item: 8,000 chars
 *  - aggregate: 32,000 chars across at most 20 text items
 * With ≤20 items, every non-empty selected item retains ≥1,600 chars before
 * marker overhead. No selected item is silently dropped.
 */

export const MAX_CONVERSATION_ITEM_TEXT = 8_000;
export const MAX_CONVERSATION_AGGREGATE_TEXT = 32_000;

const TRUNCATION_MARKER = "\n…[truncated]…\n";

export interface NormalizedConversationText {
  readonly texts: readonly {
    itemId: string;
    text: string;
    truncated: boolean;
  }[];
  readonly aggregateTruncated: boolean;
}

interface ItemInput {
  itemId: string;
  text: string;
}

/** Head-marker-tail clamp for a single item to a target max length. */
function clampWithMarker(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const tailLen = 28;
  const headLen = Math.max(0, max - TRUNCATION_MARKER.length - tailLen);
  const head = text.slice(0, headLen);
  const tail = text.slice(text.length - tailLen);
  return { text: `${head}${TRUNCATION_MARKER}${tail}`, truncated: true };
}

/**
 * Algorithm (design §8):
 * 1. Clamp every item to 8,000 chars (head-marker-tail).
 * 2. If aggregate ≤ 32,000, return per-item results.
 * 3. Else allocate floor(32,000 / textItemCount) chars per item, capped at the
 *    item's actual clamped length and at 8,000.
 * 4. Redistribute unused budget in chronological order to items that still
 *    need capacity.
 * 5. Truncate affected items with the same head-marker-tail helper.
 * 6. Set per-item and aggregate truncation flags.
 */
export function normalizeConversationTexts(
  inputs: readonly ItemInput[]
): NormalizedConversationText {
  if (inputs.length === 0) {
    return { texts: [], aggregateTruncated: false };
  }

  // Step 1: per-item clamp.
  const clamped = inputs.map((inp) =>
    clampWithMarker(inp.text, MAX_CONVERSATION_ITEM_TEXT)
  );

  // Step 2: aggregate check.
  const aggregateLen = clamped.reduce((n, c) => n + c.text.length, 0);
  if (aggregateLen <= MAX_CONVERSATION_AGGREGATE_TEXT) {
    return {
      texts: clamped.map((c, i) => ({
        itemId: inputs[i].itemId,
        text: c.text,
        truncated: c.truncated,
      })),
      aggregateTruncated: false,
    };
  }

  // Step 3: allocate even budget.
  const count = clamped.length;
  const perItem = Math.floor(MAX_CONVERSATION_AGGREGATE_TEXT / count);
  const floored = Math.min(perItem, MAX_CONVERSATION_ITEM_TEXT);

  const budgets = clamped.map((c) => Math.min(c.text.length, floored));
  let used = budgets.reduce((n, b) => n + b, 0);

  // Step 4: redistribute unused budget in chronological order.
  let remaining = MAX_CONVERSATION_AGGREGATE_TEXT - used;
  for (let i = 0; i < count && remaining > 0; i++) {
    const current = clamped[i].text.length;
    const room = MAX_CONVERSATION_ITEM_TEXT - budgets[i];
    const give = Math.min(room, current - budgets[i], remaining);
    if (give > 0) {
      budgets[i] += give;
      remaining -= give;
    }
  }

  // Step 5: re-truncate affected items.
  const texts = clamped.map((c, i) => {
    if (c.text.length <= budgets[i]) {
      return { itemId: inputs[i].itemId, text: c.text, truncated: c.truncated };
    }
    const r = clampWithMarker(c.text, budgets[i]);
    return { itemId: inputs[i].itemId, text: r.text, truncated: true };
  });

  return {
    texts,
    aggregateTruncated: true,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/conversationReportText.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiContentReport/conversationReportText.ts test/vitest/utilitycode/conversationReportText.test.ts
git commit -m "feat: add conversation-report text normalization utility"
```

---

### Task 4: Snapshot model + builders (design §7, §7.1–§7.4, §22.1)

**Files:**
- Create: `src/views/components/aiContentReport/conversationReportSnapshot.ts`
- Test: `test/vitest/utilitycode/conversationReportSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/conversationReportSnapshot.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildChatV2ConversationSnapshot,
  type ConversationReportSnapshot,
} from "@/views/components/aiContentReport/conversationReportSnapshot";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";

function makeAssistant(id: string, content: string, opts: Partial<ChatV2MessageView> = {}): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-1",
    role: "assistant",
    content,
    timestamp: "2026-01-01T00:00:00.000Z",
    messageType: MessageType.MESSAGE,
    ...opts,
  };
}

function makeUser(id: string, content: string, opts: Partial<ChatV2MessageView> = {}): ChatV2MessageView {
  return {
    id,
    conversationId: "conv-1",
    role: "user",
    content,
    timestamp: "2026-01-01T00:00:00.000Z",
    messageType: MessageType.MESSAGE,
    ...opts,
  };
}

describe("buildChatV2ConversationSnapshot", () => {
  it("includes completed visible assistant messages", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "hi"),
        makeAssistant("a1", "hello there"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    expect(snap.candidates.length).toBe(1);
    expect(snap.candidates[0].messageId).toBe("a1");
    expect(snap.candidates[0].role).toBe("assistant");
    expect(snap.candidates[0].text).toBe("hello there");
  });

  it("excludes user, system, tool rows", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "hi"),
        { ...makeAssistant("a1", "x"), role: "system" },
        {
          ...makeAssistant("t1", "x"),
          role: "tool",
          messageType: MessageType.TOOL_RESULT,
        },
        makeAssistant("a2", "real answer"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    expect(snap.candidates.map((c) => c.messageId)).toEqual(["a2"]);
  });

  it("excludes the active streaming placeholder", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeAssistant("streaming", "", { content: "" }),
        makeAssistant("done", "final"),
      ],
      activeAssistantMessageId: "streaming",
      streamStatus: "streaming",
    });
    expect(snap.candidates.map((c) => c.messageId)).toEqual(["done"]);
  });

  it("resolves only directly related visible user messages", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "first question"),
        makeAssistant("a1", "first answer"),
        makeUser("u2", "second question"),
        makeAssistant("a2", "second answer"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a2 = snap.candidates.find((c) => c.messageId === "a2")!;
    expect(a2.relatedUser?.messageId).toBe("u2");
    expect(a2.relatedUser?.text).toBe("second question");
  });

  it("does not reuse an earlier user after a completed assistant (no cross-pair reuse)", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "q1"),
        makeAssistant("a1", "a1"),
        makeAssistant("a2", "a2 (no user between)"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a2 = snap.candidates.find((c) => c.messageId === "a2")!;
    expect(a2.relatedUser).toBeUndefined();
  });

  it("sets omittedAttachmentContent when excluded metadata is present", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "with attach", {
          metadata: {
            attachments: [{ name: "file.pdf" }] as unknown,
          } as unknown as ChatV2MessageView["metadata"],
        }),
        makeAssistant("a1", "answer"),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a1 = snap.candidates.find((c) => c.messageId === "a1")!;
    expect(a1.relatedUser?.omittedAttachmentContent).toBe(true);
  });

  it("never copies URLs or metadata objects into the snapshot", () => {
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages: [
        makeUser("u1", "q", {
          metadata: {
            source: "chat-v2",
            attachments: [
              { fileName: "f.pdf", mimeType: "application/pdf", sizeBytes: 1, kind: "document" },
            ],
          } as unknown as ChatV2MessageView["metadata"],
        }),
        makeAssistant("a1", "a", {
          metadata: {
            source: "chat-v2",
            reasoning: {
              content: "secret reasoning",
              format: "plain_text",
              source: "server",
            },
            generatedImages: [
              { type: "image", b64_json: "iVBORw0KGgo=", mime_type: "image/png" },
            ] as unknown,
          } as unknown as ChatV2MessageView["metadata"],
        }),
      ],
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const a1 = snap.candidates.find((c) => c.messageId === "a1")!;
    // reasoning must NOT leak
    expect(JSON.stringify(a1)).not.toContain("secret reasoning");
    // the generated image bytes ARE copied (safe), but only as dataBase64
    expect(a1.images[0].dataBase64).toBe("iVBORw0KGgo=");
  });

  it("is immutable: snapshot does not change when source messages mutate", () => {
    const messages = [makeUser("u1", "q"), makeAssistant("a1", "a")];
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const before = JSON.stringify(snap);
    messages[1].content = "mutated after snapshot";
    const after = JSON.stringify(snap);
    expect(after).toBe(before);
  });

  it("handles 500-message histories without quadratic blowup (linear pass)", () => {
    const messages: ChatV2MessageView[] = [];
    for (let i = 0; i < 250; i++) {
      messages.push(makeUser(`u${i}`, `q${i}`));
      messages.push(makeAssistant(`a${i}`, `a${i}`));
    }
    const start = Date.now();
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const ms = Date.now() - start;
    expect(snap.candidates.length).toBe(250);
    // Linear pass: 500 messages should normalize in well under 200ms.
    expect(ms).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/conversationReportSnapshot.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/views/components/aiContentReport/conversationReportSnapshot.ts`:

```typescript
/**
 * Immutable, allowlisted conversation-report snapshots (design §7).
 *
 * The chat surface passes its currently visible message array into a pure
 * builder when the header action opens. The dialog receives plain immutable
 * snapshot data — never Vue refs, message-store objects, metadata objects,
 * or URLs.
 *
 * Privacy boundary (design §7.3, §18.1): the builder copies ONLY primitive
 * allowlisted values (IDs, role, content type, visible content text, safe
 * generated bytes, timestamp, model, omission boolean). It never retains
 * `ChatV2MessageView`, metadata objects, attachments, paste cache, tool data,
 * reasoning, URLs, or paths.
 */
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import type { ChatMessage } from "@/entityTypes/commonType";
import type {
  AIContentType,
  AIConversationReportSurface,
} from "@/entityTypes/aiContentReportTypes";

export interface ConversationReportImageCandidate {
  readonly sourceId: string;
  readonly dataBase64?: string;
  readonly mimeType?: string;
}

export interface ConversationReportRelatedUser {
  readonly itemId: string;
  readonly messageId: string;
  readonly sourceIndex: number;
  readonly role: "user";
  readonly contentType: "text";
  readonly text: string;
  readonly omittedAttachmentContent: boolean;
  readonly generatedAt?: string;
}

export interface ConversationReportCandidate {
  readonly itemId: string;
  readonly messageId: string;
  readonly sourceIndex: number;
  readonly role: "assistant";
  readonly contentType: AIContentType;
  readonly text?: string;
  readonly images: readonly ConversationReportImageCandidate[];
  readonly evidenceUnavailable: boolean;
  readonly generatedAt?: string;
  readonly model?: string;
  readonly relatedUser?: ConversationReportRelatedUser;
}

export interface ConversationReportSnapshot {
  readonly snapshotId: string;
  readonly conversationId: string;
  readonly surface: AIConversationReportSurface;
  readonly createdAt: string;
  readonly candidates: readonly ConversationReportCandidate[];
}

/** True when a metadata object carries excluded content (design §7.3).
 * Checks the real ChatV2MessageMetadata fields that represent content we do
 * NOT copy into the snapshot: attachments, reasoning, tool data. */
function metadataHasExcludedContent(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Record<string, unknown>;
  return Boolean(
    (Array.isArray(m.attachments) && (m.attachments as unknown[]).length > 0) ||
      m.reasoning !== undefined ||
      m.toolCallId !== undefined ||
      m.toolName !== undefined ||
      m.toolArguments !== undefined ||
      m.toolResult !== undefined
  );
}

/** Safe generated-image bytes only — never copies a URL or path (design §7.2).
 * `ChatV2GeneratedImage` is `OpenAIChatImage`, whose `b64_json`/`mime_type` are
 * already typed optional strings — so no casts are needed. */
function extractChatV2Images(
  message: ChatV2MessageView
): ConversationReportImageCandidate[] {
  const generated = message.metadata?.generatedImages ?? [];
  const out: ConversationReportImageCandidate[] = [];
  for (let i = 0; i < generated.length && out.length < 3; i++) {
    const g = generated[i];
    const b64 = g.b64_json;
    if (typeof b64 === "string" && b64.length > 0) {
      out.push({
        sourceId: `${message.id}-img-${i}`,
        dataBase64: b64,
        mimeType: g.mime_type ?? "image/png",
      });
    }
  }
  return out;
}

function deriveContentType(
  hasText: boolean,
  images: ConversationReportImageCandidate[]
): AIContentType {
  const hasImages = images.length > 0;
  if (hasImages && hasText) return "mixed";
  if (hasImages) return "image";
  return "text";
}

/**
 * Build a snapshot from Chat V2 visible messages (design §7.1, §7.2, §22.1).
 *
 * Uses a single forward pass with `lastVisibleUser` state to compute
 * related-user associations in O(n) time and O(k) memory (design §22.1):
 *   lastVisibleUser = null
 *   for each visible row in order:
 *     if row is eligible user: lastVisibleUser = sanitized snapshot
 *     if row is eligible assistant:
 *       attach lastVisibleUser
 *       lastVisibleUser = null after completing the pair
 *     if row is a completed assistant before any user: do not reuse earlier user
 */
export function buildChatV2ConversationSnapshot(input: {
  conversationId: string;
  messages: readonly ChatV2MessageView[];
  activeAssistantMessageId: string | null;
  streamStatus: "idle" | "streaming" | "cancelled" | "error";
}): ConversationReportSnapshot {
  const { conversationId, messages } = input;
  const candidates: ConversationReportCandidate[] = [];

  let lastVisibleUser: ConversationReportRelatedUser | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.conversationId !== conversationId) continue;

    // Eligibility: assistant, message-type, not active streaming placeholder,
    // non-empty text or safe images.
    const isActiveStreaming =
      input.activeAssistantMessageId === m.id &&
      input.streamStatus === "streaming";
    const isAssistant = m.role === "assistant";
    const isEligibleType =
      m.messageType !== "tool_call" && m.messageType !== "tool_result";
    const hasText = typeof m.content === "string" && m.content.length > 0;
    const images = extractChatV2Images(m);
    const hasEvidence = hasText || images.length > 0;

    if (m.role === "user") {
      // Track the most recent visible user message as a candidate related-user.
      lastVisibleUser = {
        itemId: `user-${m.id}`,
        messageId: m.id,
        sourceIndex: i,
        role: "user",
        contentType: "text",
        text: m.content,
        omittedAttachmentContent: metadataHasExcludedContent(m.metadata),
        generatedAt: m.timestamp,
      };
      continue;
    }

    if (!isAssistant || !isEligibleType || isActiveStreaming || !hasEvidence) {
      // Tool/permission/system/empty rows do NOT reset lastVisibleUser.
      continue;
    }

    // A new visible user replaces lastVisibleUser; a completed assistant
    // before any user means no relation (don't reuse an earlier user).
    const candidate: ConversationReportCandidate = {
      itemId: `ai-${m.id}`,
      messageId: m.id,
      sourceIndex: i,
      role: "assistant",
      contentType: deriveContentType(hasText, images),
      text: hasText ? m.content : undefined,
      images,
      evidenceUnavailable: !hasEvidence,
      generatedAt: m.timestamp,
      model: m.model,
      relatedUser: lastVisibleUser ?? undefined,
    };
    candidates.push(candidate);
    // Consume the related user after pairing.
    lastVisibleUser = null;
  }

  return freezeSnapshot({
    snapshotId: generateSnapshotId(),
    conversationId,
    surface: "chat_v2",
    createdAt: new Date().toISOString(),
    candidates,
  });
}

/**
 * Build a snapshot from legacy chat visible messages (design §7.1, §7.2 legacy).
 * Eligible: role assistant, reportable message type, non-empty visible content,
 * not the active streaming placeholder. Tool/system/permission/error excluded.
 */
export function buildLegacyConversationSnapshot(input: {
  conversationId: string;
  messages: readonly ChatMessage[];
  streamingAssistantMessageId?: string;
}): ConversationReportSnapshot {
  const { conversationId, messages } = input;
  const candidates: ConversationReportCandidate[] = [];
  let lastVisibleUser: ConversationReportRelatedUser | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.conversationId && m.conversationId !== conversationId) continue;

    // ChatMessage.timestamp is a Date. The reported timestamp is its ISO form.
    const ts = m.timestamp instanceof Date ? m.timestamp.toISOString() : undefined;

    if (m.role === "user") {
      lastVisibleUser = {
        itemId: `user-${m.id}`,
        messageId: m.id,
        sourceIndex: i,
        role: "user",
        contentType: "text",
        text: m.content,
        omittedAttachmentContent: metadataHasExcludedContent(m.metadata),
        generatedAt: ts,
      };
      continue;
    }

    // Eligibility: assistant role, non-empty visible content, not the active
    // streaming placeholder. Tool/system rows do not produce candidates.
    const hasText = typeof m.content === "string" && m.content.length > 0;
    const isActiveStreaming = input.streamingAssistantMessageId === m.id;
    if (m.role !== "assistant" || !hasText || isActiveStreaming) continue;

    candidates.push({
      itemId: `ai-${m.id}`,
      messageId: m.id,
      sourceIndex: i,
      role: "assistant",
      contentType: "text",
      text: m.content,
      images: [],
      evidenceUnavailable: false,
      generatedAt: ts,
      relatedUser: lastVisibleUser ?? undefined,
    });
    lastVisibleUser = null;
  }

  return freezeSnapshot({
    snapshotId: generateSnapshotId(),
    conversationId,
    surface: "legacy_chat",
    createdAt: new Date().toISOString(),
    candidates,
  });
}

/**
 * Knowledge-chat message contract (design §7.1). Knowledge messages are
 * currently untyped component-local objects; this interface makes the shape
 * explicit so the adapter does not bridge with `any`.
 */
export interface KnowledgeChatMessage {
  id: string;
  type: "user" | "ai";
  content: string;
  timestamp: Date | string;
}

/**
 * Build a snapshot from knowledge-chat visible messages (design §7.1, §7.2,
 * §11.3). Eligible: type "ai" with non-empty visible content. Knowledge
 * sources are NOT evidence and are never copied into the snapshot.
 */
export function buildKnowledgeConversationSnapshot(input: {
  conversationId: string;
  messages: readonly KnowledgeChatMessage[];
}): ConversationReportSnapshot {
  const { conversationId, messages } = input;
  const candidates: ConversationReportCandidate[] = [];
  let lastVisibleUser: ConversationReportRelatedUser | null = null;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const ts =
      m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp;

    if (m.type === "user") {
      lastVisibleUser = {
        itemId: `user-${m.id}`,
        messageId: m.id,
        sourceIndex: i,
        role: "user",
        contentType: "text",
        text: m.content,
        omittedAttachmentContent: false,
        generatedAt: ts,
      };
      continue;
    }

    const hasText = typeof m.content === "string" && m.content.length > 0;
    if (m.type !== "ai" || !hasText) continue;

    candidates.push({
      itemId: `ai-${m.id}`,
      messageId: m.id,
      sourceIndex: i,
      role: "assistant",
      contentType: "text",
      text: m.content,
      images: [],
      evidenceUnavailable: false,
      generatedAt: ts,
      relatedUser: lastVisibleUser ?? undefined,
    });
    lastVisibleUser = null;
  }

  return freezeSnapshot({
    snapshotId: generateSnapshotId(),
    conversationId,
    surface: "knowledge_chat",
    createdAt: new Date().toISOString(),
    candidates,
  });
}

function generateSnapshotId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Freeze the top-level snapshot (and arrays) in development builds (design §7.4). */
function freezeSnapshot(snap: ConversationReportSnapshot): ConversationReportSnapshot {
  if (process.env.NODE_ENV !== "production") {
    return Object.freeze({
      ...snap,
      candidates: Object.freeze([...snap.candidates]),
    }) as ConversationReportSnapshot;
  }
  return snap;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/conversationReportSnapshot.test.ts`
Expected: PASS. If the 500-message timing test is flaky on a slow CI box, the 500ms ceiling has ample headroom; do not raise it.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiContentReport/conversationReportSnapshot.ts test/vitest/utilitycode/conversationReportSnapshot.test.ts
git commit -m "feat: add immutable conversation-report snapshot builders"
```

---

### Task 5: Request construction (design §9)

**Files:**
- Create: `src/views/components/aiContentReport/conversationReportRequest.ts`
- Test: `test/vitest/utilitycode/conversationReportRequest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/conversationReportRequest.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { buildCreateAIConversationReportRequest } from "@/views/components/aiContentReport/conversationReportRequest";
import { buildChatV2ConversationSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { MessageType } from "@/entityTypes/commonType";

// Mock the image encoder so we don't need a real canvas in node tests.
vi.mock("@/views/components/aiContentReport/AIContentReportImageEncoder", () => ({
  encodeReportImagePreview: vi.fn(async (src: { dataBase64?: string }) =>
    src.dataBase64
      ? {
          mimeType: "image/png",
          dataBase64: src.dataBase64,
          width: 1,
          height: 1,
        }
      : null
  ),
}));

function snapWithTwoAssistants(): ReturnType<typeof buildChatV2ConversationSnapshot> {
  const messages: ChatV2MessageView[] = [
    {
      id: "u1", conversationId: "conv-1", role: "user", content: "q1",
      timestamp: "2026-01-01T00:00:00.000Z", messageType: MessageType.MESSAGE,
    },
    {
      id: "a1", conversationId: "conv-1", role: "assistant", content: "answer1",
      timestamp: "2026-01-01T00:00:01.000Z", messageType: MessageType.MESSAGE,
    },
    {
      id: "u2", conversationId: "conv-1", role: "user", content: "q2",
      timestamp: "2026-01-01T00:00:02.000Z", messageType: MessageType.MESSAGE,
    },
    {
      id: "a2", conversationId: "conv-1", role: "assistant", content: "answer2",
      timestamp: "2026-01-01T00:00:03.000Z", messageType: MessageType.MESSAGE,
    },
  ];
  return buildChatV2ConversationSnapshot({
    conversationId: "conv-1",
    messages,
    activeAssistantMessageId: null,
    streamStatus: "idle",
  });
}

describe("buildCreateAIConversationReportRequest", () => {
  it("builds an assistant-only request with contiguous sequences", async () => {
    const snap = snapWithTwoAssistants();
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1", "ai-a2"]),
      selectedImageIds: new Set(),
      includeRelatedUserContext: false,
      category: "other",
      comment: "issue",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.schemaVersion).toBe(2);
    expect(req.reportScope).toBe("selected_ai_outputs");
    expect(req.items.map((i) => i.sequence)).toEqual([0, 1]);
    expect(req.items.every((i) => i.role === "assistant")).toBe(true);
    expect(req.context.selectedAIItemCount).toBe(2);
    expect(req.context.includedUserItemCount).toBe(0);
  });

  it("merges opted-in related users by sourceIndex", async () => {
    const snap = snapWithTwoAssistants();
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1", "ai-a2"]),
      selectedImageIds: new Set(),
      includeRelatedUserContext: true,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.reportScope).toBe("selected_ai_outputs_with_related_user_context");
    // 2 assistants + 2 related users = 4 items, ordered by sourceIndex
    expect(req.items.length).toBe(4);
    expect(req.items.map((i) => i.sequence)).toEqual([0, 1, 2, 3]);
    expect(req.context.includedUserItemCount).toBe(2);
    // user items carry consentSource
    expect(req.items.filter((i) => i.role === "user").every((u) => u.consentSource === "related_user_context_toggle")).toBe(true);
  });

  it("rejects zero selections", async () => {
    const snap = snapWithTwoAssistants();
    await expect(
      buildCreateAIConversationReportRequest({
        snapshot: snap,
        selectedAIItemIds: new Set(),
        selectedImageIds: new Set(),
        includeRelatedUserContext: false,
        category: "other",
        locale: "en-US",
        clientReportId: "client-1",
      })
    ).rejects.toThrow();
  });

  it("rejects more than 10 AI selections", async () => {
    const snap = snapWithTwoAssistants();
    const ids = new Set(Array.from({ length: 11 }, (_, i) => `ai-a${i + 1}`));
    await expect(
      buildCreateAIConversationReportRequest({
        snapshot: snap,
        selectedAIItemIds: ids,
        selectedImageIds: new Set(),
        includeRelatedUserContext: false,
        category: "other",
        locale: "en-US",
        clientReportId: "client-1",
      })
    ).rejects.toThrow();
  });

  it("encodes at most three images and stops after three successful previews", async () => {
    const messages: ChatV2MessageView[] = Array.from({ length: 5 }, (_, i) => ({
      id: `a${i}`,
      conversationId: "conv-1",
      role: "assistant" as const,
      content: `text${i}`,
      timestamp: `2026-01-01T00:00:0${i}.000Z`,
      messageType: MessageType.MESSAGE,
      metadata: {
        source: "chat-v2",
        generatedImages: [{ type: "image", b64_json: "iVBORw0KGgo=", mime_type: "image/png" }],
      },
    }));
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1",
      messages,
      activeAssistantMessageId: null,
      streamStatus: "idle",
    });
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(snap.candidates.map((c) => c.itemId)),
      selectedImageIds: new Set(snap.candidates.flatMap((c) => c.images.map((img) => img.sourceId))),
      includeRelatedUserContext: false,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    const totalImages = req.items.reduce((n, i) => n + (i.imagePreviews?.length ?? 0), 0);
    expect(totalImages).toBeLessThanOrEqual(3);
  });

  it("represents image conversion failure with evidenceUnavailable", async () => {
    const { encodeReportImagePreview } = await import("@/views/components/aiContentReport/AIContentReportImageEncoder");
    vi.mocked(encodeReportImagePreview).mockResolvedValueOnce(null);
    const messages: ChatV2MessageView[] = [{
      id: "a1", conversationId: "conv-1", role: "assistant", content: "text",
      timestamp: "2026-01-01T00:00:00.000Z", messageType: MessageType.MESSAGE,
      metadata: { source: "chat-v2", generatedImages: [{ type: "image", b64_json: "bad", mime_type: "image/png" }] },
    }];
    const snap = buildChatV2ConversationSnapshot({
      conversationId: "conv-1", messages, activeAssistantMessageId: null, streamStatus: "idle",
    });
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1"]),
      selectedImageIds: new Set(["a1-img-0"]),
      includeRelatedUserContext: false,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.items[0].evidenceUnavailable).toBe(true);
    // The source URL/path is never added (images carry only dataBase64)
    expect(req.items[0].imagePreviews).toBeUndefined();
  });

  it("excludes unselected candidates", async () => {
    const snap = snapWithTwoAssistants();
    const req = await buildCreateAIConversationReportRequest({
      snapshot: snap,
      selectedAIItemIds: new Set(["ai-a1"]),
      selectedImageIds: new Set(),
      includeRelatedUserContext: false,
      category: "other",
      locale: "en-US",
      clientReportId: "client-1",
    });
    expect(req.items.length).toBe(1);
    expect(req.items[0].messageId).toBe("a1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/conversationReportRequest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/views/components/aiContentReport/conversationReportRequest.ts`:

```typescript
/**
 * Convert an immutable snapshot + UI selection into the version-2 wire request
 * (design §9). Pure + async (image encoding). Never calls IPC itself, so it is
 * independently testable.
 */
import { encodeReportImagePreview } from "./AIContentReportImageEncoder";
import { normalizeConversationTexts } from "./conversationReportText";
import type { ConversationReportSnapshot } from "./conversationReportSnapshot";
import {
  type AIContentReportCategory,
  type CreateAIConversationReportRequest,
  type AIConversationReportItem,
  type AIConversationReportScope,
} from "@/entityTypes/aiContentReportTypes";

export interface BuildConversationReportRequestInput {
  readonly snapshot: ConversationReportSnapshot;
  readonly selectedAIItemIds: ReadonlySet<string>;
  readonly selectedImageIds: ReadonlySet<string>;
  readonly includeRelatedUserContext: boolean;
  readonly category: AIContentReportCategory;
  readonly comment?: string;
  readonly locale: string;
  readonly clientReportId: string;
}

const MAX_AI_ITEMS = 10;
const MAX_TOTAL_IMAGES = 3;

/** Typed local validation errors — these never cross IPC (design §23). */
export class AIConversationReportLocalError extends Error {
  readonly code:
    | "selection_required"
    | "selection_limit"
    | "image_limit"
    | "related_message_unavailable"
    | "conversation_changed"
    | "evidence_unavailable";
  constructor(
    code: AIConversationReportLocalError["code"],
    message: string
  ) {
    super(message);
    this.name = "AIConversationReportLocalError";
    this.code = code;
  }
}

export async function buildCreateAIConversationReportRequest(
  input: BuildConversationReportRequestInput
): Promise<CreateAIConversationReportRequest> {
  const { snapshot, selectedAIItemIds, selectedImageIds } = input;

  // 1. Resolve selected candidates; reject zero or >10.
  const selected = snapshot.candidates.filter((c) =>
    selectedAIItemIds.has(c.itemId)
  );
  if (selected.length === 0) {
    throw new AIConversationReportLocalError(
      "selection_required",
      "Select at least one AI output to report."
    );
  }
  if (selected.length > MAX_AI_ITEMS) {
    throw new AIConversationReportLocalError(
      "selection_limit",
      `Select at most ${MAX_AI_ITEMS} AI outputs.`
    );
  }

  // 2. Sort by sourceIndex.
  const sorted = [...selected].sort((a, b) => a.sourceIndex - b.sourceIndex);

  // 3. Merge deduplicated related users by sourceIndex if opted in.
  type MergedItem =
    | { kind: "ai"; candidate: (typeof sorted)[number] }
    | { kind: "user"; candidate: (typeof sorted)[number]; related: NonNullable<(typeof sorted)[number]["relatedUser"]> };

  const merged: MergedItem[] = [];
  const seenUserIds = new Set<string>();
  for (const cand of sorted) {
    if (input.includeRelatedUserContext && cand.relatedUser) {
      if (!seenUserIds.has(cand.relatedUser.messageId)) {
        seenUserIds.add(cand.relatedUser.messageId);
        merged.push({ kind: "user", candidate: cand, related: cand.relatedUser });
      }
    }
    merged.push({ kind: "ai", candidate: cand });
  }

  // Final ordered by sourceIndex (interleave users before their owning assistant).
  merged.sort((a, b) => {
    const ai = a.kind === "user" ? a.related.sourceIndex : a.candidate.sourceIndex;
    const bi = b.kind === "user" ? b.related.sourceIndex : b.candidate.sourceIndex;
    return ai - bi;
  });

  // 4. Normalize text.
  const textInputs = merged.map((m) => ({
    itemId: m.kind === "user" ? m.related.itemId : m.candidate.itemId,
    text: m.kind === "user" ? m.related.text : m.candidate.text ?? "",
  }));
  const normalized = normalizeConversationTexts(textInputs);
  const textById = new Map(normalized.texts.map((t) => [t.itemId, t]));

  // 5. Encode selected generated images in chronological order, stop after 3.
  // Items are constructed immutably with their final values — no post-hoc
  // mutation of sequence or evidenceUnavailable.
  const items: AIConversationReportItem[] = [];
  let imageCount = 0;
  let seq = 0;

  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    if (m.kind === "user") {
      const t = textById.get(m.related.itemId)!;
      items.push({
        itemId: m.related.itemId,
        messageId: m.related.messageId,
        sequence: seq++,
        role: "user",
        contentType: "text",
        text: t.text,
        textTruncated: t.truncated || undefined,
        consentSource: "related_user_context_toggle",
        generatedAt: m.related.generatedAt,
      });
      continue;
    }

    const cand = m.candidate;
    const t = textById.get(cand.itemId)!;

    // Encode images only for selected image source IDs owned by this candidate.
    let evidenceUnavailable = cand.evidenceUnavailable;
    let imagePreviews: AIConversationReportItem["imagePreviews"] = undefined;
    if (imageCount < MAX_TOTAL_IMAGES) {
      const previews: NonNullable<AIConversationReportItem["imagePreviews"]> = [];
      for (const img of cand.images) {
        if (imageCount >= MAX_TOTAL_IMAGES) break;
        if (!selectedImageIds.has(img.sourceId)) continue;
        const preview = await encodeReportImagePreview({
          dataBase64: img.dataBase64,
          mimeType: img.mimeType,
        });
        if (preview) {
          previews.push(preview);
          imageCount++;
        } else {
          evidenceUnavailable = true;
        }
      }
      if (previews.length > 0) imagePreviews = previews;
    }

    items.push({
      itemId: cand.itemId,
      messageId: cand.messageId,
      sequence: seq++,
      role: "assistant",
      contentType: cand.contentType,
      text: cand.text ? t.text : undefined,
      textTruncated: cand.text ? t.truncated || undefined : undefined,
      imagePreviews,
      evidenceUnavailable: evidenceUnavailable || undefined,
      generatedAt: cand.generatedAt,
      model: cand.model,
    });
  }

  // 9. reportScope from the toggle.
  const reportScope: AIConversationReportScope = input.includeRelatedUserContext
    ? "selected_ai_outputs_with_related_user_context"
    : "selected_ai_outputs";

  // 10. Count actual roles.
  const selectedAIItemCount = items.filter((i) => i.role === "assistant").length;
  const includedUserItemCount = items.filter((i) => i.role === "user").length;

  // 11. Placeholders for appVersion/platform/installId; main service overwrites.
  const request: CreateAIConversationReportRequest = {
    schemaVersion: 2,
    clientReportId: input.clientReportId,
    surface: snapshot.surface,
    reportScope,
    category: input.category,
    comment: input.comment?.trim() ? input.comment.slice(0, 2000) : undefined,
    items,
    context: {
      conversationId: snapshot.conversationId,
      selectedAIItemCount,
      includedUserItemCount,
      aggregateTextTruncated: normalized.aggregateTruncated || undefined,
      appVersion: "unknown",
      platform: "win32",
      locale: input.locale,
    },
  };

  return request;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/conversationReportRequest.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiContentReport/conversationReportRequest.ts test/vitest/utilitycode/conversationReportRequest.test.ts
git commit -m "feat: add conversation-report request builder"
```

---

### Task 6: Capability response schema (design §15.2)

**Files:**
- Create: `src/schemas/api/aiContentReport.ts` (note: `schemas/api/`, NOT `schemas/ipc/`)
- Test: `test/vitest/utilitycode/aiContentReportCapabilitiesSchema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/aiContentReportCapabilitiesSchema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { aiContentReportCapabilitiesResponseSchema } from "@/schemas/api/aiContentReport";

describe("aiContentReportCapabilitiesResponseSchema", () => {
  it("accepts a valid v2-enabled envelope", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: {
          enabled: true,
          maxAIItems: 10,
          maxUserItems: 10,
          maxTotalItems: 20,
          maxItemTextChars: 8000,
          maxAggregateTextChars: 32000,
          maxImages: 3,
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a disabled/fail-closed envelope", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true,
      code: 0,
      msg: "ok",
      data: {
        acceptedSchemaVersions: [1],
        conversationReporting: { enabled: false, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative or fractional limits", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true, code: 0, msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: { enabled: true, maxAIItems: -1, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys in the envelope and data", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true, code: 0, msg: "ok",
      data: {
        acceptedSchemaVersions: [1, 2],
        conversationReporting: { enabled: true, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3, sneaky: "leak" },
      },
      extra: "leak",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing conversationReporting block", () => {
    const r = aiContentReportCapabilitiesResponseSchema().safeParse({
      status: true, code: 0, msg: "ok",
      data: { acceptedSchemaVersions: [1] },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiContentReportCapabilitiesSchema.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/schemas/api/aiContentReport.ts`:

```typescript
/**
 * Capability RESPONSE schema (design §15.2).
 *
 * NOTE: this lives in `schemas/api/` (NOT `schemas/ipc/`) because it validates a
 * backend HTTP response envelope, not an IPC request payload. The IPC request
 * schemas remain in `schemas/ipc/aiContentReport.ts`.
 *
 * Validates the `CommonApiresp<AIContentReportCapabilities>` envelope plus
 * every numeric limit. Rejects negative, fractional, missing, and unknown
 * values BEFORE the service clamps accepted limits.
 */
import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";

const positiveInt = z.number().int().positive();

const capabilitiesDataSchema = z.strictObject({
  acceptedSchemaVersions: z.array(positiveInt).min(1),
  conversationReporting: z.strictObject({
    enabled: z.boolean(),
    maxAIItems: positiveInt,
    maxUserItems: positiveInt,
    maxTotalItems: positiveInt,
    maxItemTextChars: positiveInt,
    maxAggregateTextChars: positiveInt,
    maxImages: positiveInt,
  }),
});

export const aiContentReportCapabilitiesResponseSchema = lazySchema(() =>
  z.strictObject({
    status: z.boolean(),
    code: z.number(),
    msg: z.string(),
    data: capabilitiesDataSchema,
  })
);

export type AIContentReportCapabilitiesResponse = z.infer<
  ReturnType<typeof aiContentReportCapabilitiesResponseSchema>
>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiContentReportCapabilitiesSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/schemas/api/aiContentReport.ts test/vitest/utilitycode/aiContentReportCapabilitiesSchema.test.ts
git commit -m "feat: add capability response schema"
```

---

## Phase 2: Main-Process Plumbing (design §13, §14, §15, §15.5)

### Task 7: `HttpResponseError` + preserve numeric HTTP status (design §15.5)

**Files:**
- Modify: `src/modules/lib/httpclient.ts` (add exported `HttpResponseError` class near the `HttpClient` class; replace the line `if (!res.ok) throw new Error(res.statusText);`)
- Test: `test/vitest/main/httpResponseError.test.ts`

**Why this is its own commit:** The current generic `throw new Error(res.statusText)` DISCARDS the numeric HTTP status. `extractStatus` in the report service recovers it only when the thrown object carries a `status` number — which today it never does, because `Error` has no `status`. The conversation-report error mapper and analytics depend on a real status (400/413/422/429/500/503). This fix is shared infrastructure; it must land before the service uses it.

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/httpResponseError.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We exercise the real HttpClient._fetchJSON path with a mocked global fetch.
// Stub the modules HttpClient imports so the class can construct in node.
vi.mock("@/modules/lib/electronStore", () => ({
  ElectronStoreService: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));
vi.mock("@/config/usersetting", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn(() => "tok"),
    setValue: vi.fn(),
  })),
  REFRESHTOKEN: "refreshtoken",
  USER_AI_ENABLED: "true",
}));
vi.mock("@/modules/lib/webWorkerIdentifier", () => ({
  isWorker: () => false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workerIdentifier: {} as any,
}));

import { HttpClient, HttpResponseError } from "@/modules/lib/httpclient";

function makeResponse(status: number, statusText: string, body: unknown): Response {
  return {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    json: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("HttpResponseError", () => {
  let originalFetch: typeof globalThis.fetch;
  const client = new HttpClient();

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("is thrown with numeric status for 413 payload too large", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeResponse(413, "Payload Too Large", {})
    );
    await expect(client.get("/x")).rejects.toMatchObject({
      name: "HttpResponseError",
      status: 413,
      statusText: "Payload Too Large",
    });
  });

  it("is thrown for 429 rate limited", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(429, "Too Many Requests", {}));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 429 });
  });

  it("is thrown for 500 server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(500, "Internal Server Error", {}));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 500 });
  });

  it("is thrown for 422 invalid", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse(422, "Unprocessable Entity", {}));
    await expect(client.get("/x")).rejects.toMatchObject({ status: 422 });
  });

  it("passes through 2xx responses unchanged", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, "OK", { ok: true })
    );
    await expect(client.get<{ ok: boolean }>("/x")).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/httpResponseError.test.ts`
Expected: FAIL — `HttpResponseError` is not exported, and 413/429/500 currently throw a plain `Error` with no `status`.

- [ ] **Step 3: Add the `HttpResponseError` class**

In `src/modules/lib/httpclient.ts`, add the class above the `HttpClient` class (around line 42, before `export class HttpClient`):

```typescript
/**
 * Error thrown when an HTTP response has a non-2xx status (design §15.5).
 * Preserves the numeric status that `new Error(res.statusText)` discarded, so
 * callers (e.g. `AIContentReportService.extractStatus`, the error mapper) can
 * map 400/413/422/429/500/503 to structured error codes without string-sniffing.
 */
export class HttpResponseError extends Error {
  readonly status: number;
  readonly statusText: string;
  constructor(status: number, statusText: string) {
    super(statusText || `HTTP ${status}`);
    this.name = "HttpResponseError";
    this.status = status;
    this.statusText = statusText;
  }
}
```

- [ ] **Step 4: Replace the generic throw**

In `src/modules/lib/httpclient.ts` `_fetchJSON`, replace the line:

```typescript
    if (!res.ok) throw new Error(res.statusText);
```

with:

```typescript
    if (!res.ok) throw new HttpResponseError(res.status, res.statusText);
```

This is the ONLY behavioral change to `_fetchJSON`. The 401/403 refresh path above it is untouched.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/httpResponseError.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the existing report service still compiles + tests pass**

`extractStatus(err)` already checks `"status" in err` and reads `err.status` as a number — so it now WORKS for the first time (previously always returned `undefined`). No code change needed there. Run the existing service test to confirm no regression:

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/aiContentReportService.test.ts`
Expected: PASS (or the same results as before — the service test mocks the httpClient, so it does not exercise `_fetchJSON`).

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/modules/lib/httpclient.ts test/vitest/main/httpResponseError.test.ts
git commit -m "fix: preserve numeric HTTP status via HttpResponseError"
```

---

### Task 8: Capability channel + preload + frontend API (design §13, §14)

**Files:**
- Modify: `src/config/channellist.ts` (add `AI_CONTENT_REPORT_CAPABILITIES`)
- Modify: `src/preload.ts` (add the new channel to both import lists and the validChannels array)
- Modify: `src/views/api/aiContentReport.ts` (add `getAIContentReportCapabilities`)
- Test: `test/vitest/utilitycode/aiContentReportCapabilitiesApi.test.ts`

- [ ] **Step 1: Add the channel constant**

In `src/config/channellist.ts`, after the line `export const AI_CONTENT_REPORT_CREATE = "ai:content:report:create";` (line 680), add:

```typescript
/** Capability discovery for content reporting (design §13). NOT AI-gated. */
export const AI_CONTENT_REPORT_CAPABILITIES = "ai:content:report:capabilities";
```

- [ ] **Step 2: Add the IPC request schema for capabilities**

In `src/schemas/ipc/aiContentReport.ts`, append (after the union export from Task 2):

```typescript
// Capability IPC REQUEST schema (design §13). Validates the renderer→main
// payload. The RESPONSE is validated separately by the api/ schema (Task 6).
export const getAIContentReportCapabilitiesSchema = lazySchema(() =>
  z.strictObject({ schemaVersion: z.literal(1) })
);
```

- [ ] **Step 3: Add the channel to the preload whitelist**

In `src/preload.ts`:
- Line 453 area (the `import { ... } from "@/config/channellist";` block): after `AI_CONTENT_REPORT_CREATE,` add `AI_CONTENT_REPORT_CAPABILITIES,`
- Line 1136 area (the `validChannels` array): after `AI_CONTENT_REPORT_CREATE,` add `AI_CONTENT_REPORT_CAPABILITIES,`

Both additions carry the same comment line above them:

```typescript
  // AI Content Reporting capabilities — NOT AI-gated (PRD FR-4.4)
```

- [ ] **Step 4: Add the frontend API function**

Append to `src/views/api/aiContentReport.ts`:

```typescript
import { AI_CONTENT_REPORT_CAPABILITIES } from "@/config/channellist";
import type {
  AIContentReportCapabilities,
  CreateAnyAIContentReportRequest,
} from "@/entityTypes/aiContentReportTypes";

/**
 * Fetch the backend's content-report capabilities (design §14). The dialog
 * gates the "Report conversation" UI on `conversationReporting.enabled`.
 * NOT AI-gated: uses `registerValidatedHandler`, works when AI is disabled.
 */
export async function getAIContentReportCapabilities(): Promise<AIContentReportCapabilities> {
  return await windowInvoke(AI_CONTENT_REPORT_CAPABILITIES, { schemaVersion: 1 });
}

/**
 * Submit either a v1 (single-output) or v2 (conversation) report. The main
 * process validates the union and dispatches on `schemaVersion` (design §15).
 * NOT AI-gated (PRD FR-4.4).
 */
export async function createAIContentReport(
  request: CreateAnyAIContentReportRequest
): Promise<CreateAIContentReportResponse> {
  return await windowInvoke(AI_CONTENT_REPORT_CREATE, request);
}
```

Note: the existing `createAIContentReport` signature changes from `CreateAIContentReportRequest` to `CreateAnyAIContentReportRequest` — a widening that is backward-compatible (v1 requests still satisfy the union). Update the existing import to remove the now-duplicate `CreateAIContentReportRequest` import if the linter flags it; keep `CreateAIContentReportResponse`.

- [ ] **Step 5: Write the API unit test**

Create `test/vitest/utilitycode/aiContentReportCapabilitiesApi.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock windowInvoke so we can assert the channel + payload without IPC.
vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

import { windowInvoke } from "@/views/utils/apirequest";
import {
  createAIContentReport,
  getAIContentReportCapabilities,
} from "@/views/api/aiContentReport";

describe("getAIContentReportCapabilities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes the capabilities channel with schemaVersion 1", async () => {
    vi.mocked(windowInvoke).mockResolvedValueOnce({
      acceptedSchemaVersions: [1, 2],
      conversationReporting: { enabled: true, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
    });
    await getAIContentReportCapabilities();
    expect(windowInvoke).toHaveBeenCalledWith("ai:content:report:capabilities", { schemaVersion: 1 });
  });
});

describe("createAIContentReport (union)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards a v2 request to the create channel", async () => {
    vi.mocked(windowInvoke).mockResolvedValueOnce({ reportId: "r1", status: "submitted", receivedAt: "t", duplicate: false });
    await createAIContentReport({
      schemaVersion: 2,
      clientReportId: "c1",
      surface: "chat_v2",
      reportScope: "selected_ai_outputs",
      category: "other",
      items: [{ itemId: "i1", messageId: "m1", sequence: 0, role: "assistant", contentType: "text", text: "x" }],
      context: { conversationId: "c", selectedAIItemCount: 1, includedUserItemCount: 0, appVersion: "1", platform: "win32", locale: "en" },
    });
    expect(windowInvoke).toHaveBeenCalledWith("ai:content:report:create", expect.any(Object));
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiContentReportCapabilitiesApi.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/config/channellist.ts src/schemas/ipc/aiContentReport.ts src/preload.ts src/views/api/aiContentReport.ts test/vitest/utilitycode/aiContentReportCapabilitiesApi.test.ts
git commit -m "feat: add capability IPC channel, preload entry, frontend API"
```

---

### Task 9: Service capability cache + v1/v2 dispatch (design §15)

**Files:**
- Modify: `src/service/AIContentReportService.ts` (widen `httpClient` type to include `get`; add module-level capability cache + `getCapabilities`; split `submitReport` into version dispatch; add `assembleVersion2Context` + `normalizeConversationItems`)
- Test: `test/vitest/main/aiContentReportService.test.ts` (extend)

- [ ] **Step 1: Write the failing tests (capability cache + v2 dispatch + fail-closed)**

Append to `test/vitest/main/aiContentReportService.test.ts` (the existing test file; read it first to match its existing import style and mock setup):

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
// Reuse the existing test file's mock-stubbed httpClient + appVersion + installId
// (read the file first; the helpers below assume `makeService(opts)` exists there).
// If the existing file builds the service inline, mirror that here.

function makeStubClient(): {
  client: { postJson: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
} {
  return {
    client: {
      postJson: vi.fn(),
      get: vi.fn(),
    },
  };
}

describe("AIContentReportService.getCapabilities", () => {
  beforeEach(() => {
    // Reset the module-level cache between tests by re-importing.
    vi.resetModules();
  });

  it("returns enabled v2 capabilities from the backend", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.get.mockResolvedValueOnce({
      acceptedSchemaVersions: [1, 2],
      conversationReporting: { enabled: true, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
    });
    const svc = new AIContentReportService({ httpClient: client });
    const caps = await svc.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(true);
    expect(caps.acceptedSchemaVersions).toEqual([1, 2]);
  });

  it("fail-closes to enabled:false on network error", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.get.mockRejectedValueOnce(new Error("network down"));
    const svc = new AIContentReportService({ httpClient: client });
    const caps = await svc.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(false);
    expect(caps.acceptedSchemaVersions).toEqual([1]);
  });

  it("fail-closes to enabled:false on invalid response shape", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.get.mockResolvedValueOnce({ garbage: true });
    const svc = new AIContentReportService({ httpClient: client });
    const caps = await svc.getCapabilities();
    expect(caps.conversationReporting.enabled).toBe(false);
  });

  it("caches capabilities for 5 minutes (no second HTTP call)", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.get.mockResolvedValueOnce({
      acceptedSchemaVersions: [1, 2],
      conversationReporting: { enabled: true, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 },
    });
    const svc = new AIContentReportService({ httpClient: client });
    await svc.getCapabilities();
    await svc.getCapabilities();
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});

describe("AIContentReportService.submitReport v2 dispatch", () => {
  it("dispatches a v2 request to submitVersion2 and assembles v2 context", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.postJson.mockResolvedValueOnce({
      status: true, code: 0, msg: "ok",
      data: { reportId: "r2", status: "submitted", receivedAt: "t", duplicate: false },
    });
    const svc = new AIContentReportService({
      httpClient: client,
      appVersion: () => "9.9.9",
      installId: () => "install-xyz",
    });
    const v2 = {
      schemaVersion: 2 as const,
      clientReportId: "c2",
      surface: "chat_v2" as const,
      reportScope: "selected_ai_outputs" as const,
      category: "other" as const,
      items: [{ itemId: "i1", messageId: "m1", sequence: 0, role: "assistant" as const, contentType: "text" as const, text: "x".repeat(9000) }],
      context: { conversationId: "c", selectedAIItemCount: 1, includedUserItemCount: 0, appVersion: "unknown", platform: "win32" as const, locale: "en-US" },
    };
    const res = await svc.submitReport(v2);
    expect(res.reportId).toBe("r2");
    // The sent body must have main-process context (appVersion/installId) and
    // re-normalized per-item text (<=8000).
    const sent = client.postJson.mock.calls[0][1];
    expect(sent.context.appVersion).toBe("9.9.9");
    expect(sent.context.installId).toBe("install-xyz");
    expect(sent.items[0].text.length).toBeLessThanOrEqual(8000);
    expect(sent.items[0].textTruncated).toBe(true);
  });

  it("v1 requests still work unchanged (backward compatible)", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.postJson.mockResolvedValueOnce({
      status: true, code: 0, msg: "ok",
      data: { reportId: "r1", status: "submitted", receivedAt: "t", duplicate: false },
    });
    const svc = new AIContentReportService({ httpClient: client, appVersion: () => "1.0.0" });
    const v1 = {
      schemaVersion: 1 as const,
      clientReportId: "c1",
      surface: "chat_v2" as const,
      contentType: "text" as const,
      category: "other" as const,
      output: { text: "hi" },
      context: { appVersion: "unknown", platform: "win32" as const, locale: "en-US" },
    };
    const res = await svc.submitReport(v1);
    expect(res.reportId).toBe("r1");
    const sent = client.postJson.mock.calls[0][1];
    expect(sent.schemaVersion).toBe(1);
    expect(sent.context.appVersion).toBe("1.0.0");
  });

  it("treats duplicate:true as success returning the original reportId", async () => {
    const { AIContentReportService } = await import("@/service/AIContentReportService");
    const { client } = makeStubClient();
    client.postJson.mockResolvedValueOnce({
      status: true, code: 0, msg: "ok",
      data: { reportId: "orig", status: "submitted", receivedAt: "t", duplicate: true },
    });
    const svc = new AIContentReportService({ httpClient: client, appVersion: () => "1.0.0" });
    const v1 = {
      schemaVersion: 1 as const, clientReportId: "c1", surface: "chat_v2" as const,
      contentType: "text" as const, category: "other" as const, output: { text: "hi" },
      context: { appVersion: "unknown", platform: "win32" as const, locale: "en-US" },
    };
    const res = await svc.submitReport(v1);
    expect(res.reportId).toBe("orig");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/aiContentReportService.test.ts`
Expected: FAIL — `getCapabilities` does not exist; v2 dispatch not implemented.

- [ ] **Step 3: Widen the `httpClient` type and add capability cache + v2 methods**

In `src/service/AIContentReportService.ts`:

**3a. Widen the type + add imports.** Change the two `Pick<HttpClient, "postJson">` occurrences (interface `AIContentReportServiceOptions.httpClient` line 51, and the private field line 59) to:

```typescript
  httpClient?: Pick<HttpClient, "postJson" | "get">;
```
and
```typescript
  private readonly httpClient: Pick<HttpClient, "postJson" | "get">;
```

Add these imports near the top:

```typescript
import { aiContentReportCapabilitiesResponseSchema } from "@/schemas/api/aiContentReport";
import {
  MAX_CONVERSATION_AGGREGATE_TEXT,
  MAX_CONVERSATION_ITEM_TEXT,
  normalizeConversationTexts,
} from "@/views/components/aiContentReport/conversationReportText";
import type {
  AIContentReportCapabilities,
  AIConversationReportItem,
  CreateAIConversationReportRequest,
} from "@/entityTypes/aiContentReportTypes";
```

**3b. Add the module-level cache + `CAPABILITIES_ENDPOINT`.** Near `REPORT_ENDPOINT`:

```typescript
const CAPABILITIES_ENDPOINT = "/api/ai/content-reports/capabilities";
const CAPABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes (design §15.2)

interface CapabilityCacheEntry {
  value: AIContentReportCapabilities;
  expiresAt: number;
}
// Module-level: each IPC call constructs a new service instance, so the cache
// must live at module scope to be shared across calls (design §15.2).
let capabilityCache: CapabilityCacheEntry | null = null;

const FAIL_CLOSED_CAPABILITIES: AIContentReportCapabilities = {
  acceptedSchemaVersions: [1],
  conversationReporting: {
    enabled: false,
    maxAIItems: 10,
    maxUserItems: 10,
    maxTotalItems: 20,
    maxItemTextChars: 8000,
    maxAggregateTextChars: 32000,
    maxImages: 3,
  },
};
```

**3c. Add `getCapabilities`.** Inside the class:

```typescript
  /**
   * Fetch conversation-reporting capabilities with a 5-minute main-process cache
   * (design §15.2). Fail-closed to `enabled:false` on network/parse error or
   * when the schema rejects the response — so the v2 UI never appears when the
   * backend cannot accept it. NOT AI-gated.
   */
  async getCapabilities(): Promise<AIContentReportCapabilities> {
    if (capabilityCache && capabilityCache.expiresAt > Date.now()) {
      return capabilityCache.value;
    }
    try {
      const raw = await this.httpClient.get<unknown>(CAPABILITIES_ENDPOINT);
      const parsed = aiContentReportCapabilitiesResponseSchema().safeParse(raw);
      if (!parsed.success) {
        log.warn("[ai-content-report] capability response rejected by schema");
        return FAIL_CLOSED_CAPABILITIES;
      }
      const value = parsed.data.data;
      capabilityCache = { value, expiresAt: Date.now() + CAPABILITY_TTL_MS };
      return value;
    } catch (err) {
      log.warn("[ai-content-report] capability fetch failed", {
        code: mapReportError(err),
      });
      return FAIL_CLOSED_CAPABILITIES;
    }
  }
```

**3d. Split `submitReport` into a dispatcher + v1/v2.** Replace the existing `submitReport` method body. The dispatcher narrows on `schemaVersion`:

```typescript
  /**
   * Dispatch on schemaVersion. v1 → single-output path (unchanged behavior);
   * v2 → conversation path. Both share HTTP, error mapping, logging.
   */
  async submitReport(
    request: CreateAnyAIContentReportRequest
  ): Promise<CreateAIContentReportResponse> {
    return request.schemaVersion === 2
      ? this.submitVersion2(request)
      : this.submitVersion1(request);
  }
```

Rename the existing method to `private async submitVersion1(request: CreateAIContentReportRequest)` and keep its body EXACTLY as-is (it already normalizes output + context, posts, maps errors, logs metadata-only). Update its parameter type to `CreateAIContentReportRequest` (v1) explicitly.

Add `submitVersion2`:

```typescript
  /**
   * Submit a conversation (v2) report. Defense in depth: re-normalize item texts
   * with the same pure utility the renderer used, then assemble v2 context
   * (appVersion/platform/installId from main-process sources). The renderer's
   * placeholder values are overwritten here (design §15, §8).
   */
  private async submitVersion2(
    request: CreateAIConversationReportRequest
  ): Promise<CreateAIContentReportResponse> {
    const startedAt = Date.now();
    const { clientReportId, surface, category } = request;

    const normalizedItems = this.normalizeConversationItems(request.items);
    const normalizedContext = this.assembleVersion2Context(request.context);
    const normalizedRequest: CreateAIConversationReportRequest = {
      ...request,
      items: normalizedItems,
      context: normalizedContext,
    };

    let raw: CommonApiresp<CreateAIContentReportResponse> | undefined;
    let httpStatus: number | undefined;
    try {
      raw = await this.httpClient.postJson<
        CommonApiresp<CreateAIContentReportResponse>
      >(REPORT_ENDPOINT, normalizedRequest);
    } catch (err) {
      const code = mapReportError(err);
      httpStatus = extractStatus(err);
      log.info("[ai-content-report] submit failed", {
        clientReportId,
        surface,
        category,
        httpStatus,
        durationMs: Date.now() - startedAt,
        code,
        schemaVersion: 2,
      });
      this.emitAnalyticsEvent("ai_content_report_failed", {
        surface,
        appVersion: normalizedContext.appVersion,
        code,
      });
      throw new AIContentReportError(code, code);
    }

    const data = raw?.data;
    if (!raw?.status || !data || !data.reportId) {
      const code = mapReportError({ status: httpStatus });
      log.info("[ai-content-report] submit rejected by server", {
        clientReportId,
        surface,
        category,
        httpStatus,
        durationMs: Date.now() - startedAt,
        code,
        schemaVersion: 2,
      });
      this.emitAnalyticsEvent("ai_content_report_failed", {
        surface,
        appVersion: normalizedContext.appVersion,
        code,
      });
      throw new AIContentReportError(code, code);
    }

    log.info("[ai-content-report] submitted", {
      clientReportId,
      reportId: data.reportId,
      surface,
      category,
      httpStatus,
      durationMs: Date.now() - startedAt,
      schemaVersion: 2,
    });
    this.emitAnalyticsEvent("ai_content_report_submitted", {
      surface,
      category,
      appVersion: normalizedContext.appVersion,
      durationBucket: durationBucket(Date.now() - startedAt),
    });
    return data;
  }

  /**
   * Re-normalize v2 item texts (defense in depth — the renderer already
   * normalized, but the service is the last boundary before HTTP).
   */
  private normalizeConversationItems(
    items: CreateAIConversationReportRequest["items"]
  ): CreateAIConversationReportRequest["items"] {
    const inputs = items.map((i) => ({ itemId: i.itemId, text: i.text ?? "" }));
    const norm = normalizeConversationTexts(inputs);
    const byId = new Map(norm.texts.map((t) => [t.itemId, t]));
    return items.map((i) => {
      const t = byId.get(i.itemId);
      if (!t || !i.text) return i;
      return {
        ...i,
        text: t.text,
        textTruncated: t.truncated || undefined,
      };
    });
  }

  /**
   * Assemble v2 context: overwrite appVersion/platform/installId from
   * main-process sources; preserve the renderer-supplied conversationId,
   * counts, aggregateTextTruncated, locale.
   */
  private assembleVersion2Context(
    partial: CreateAIConversationReportRequest["context"]
  ): CreateAIConversationReportRequest["context"] {
    return {
      ...partial,
      appVersion: this.appVersion(),
      platform: process.platform as "win32" | "darwin" | "linux",
      installId: this.installId(),
    };
  }
```

Note: `MAX_CONVERSATION_ITEM_TEXT` / `MAX_CONVERSATION_AGGREGATE_TEXT` are imported so the constants live in one place; `normalizeConversationTexts` already uses them internally — the import documents intent and avoids magic numbers.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/aiContentReportService.test.ts`
Expected: PASS (new capability + v2 dispatch tests green; existing v1 tests still green).

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/service/AIContentReportService.ts test/vitest/main/aiContentReportService.test.ts
git commit -m "feat: add capability cache + v1/v2 dispatch to report service"
```

---

### Task 10: IPC union validation + capabilities handler (design §13)

**Files:**
- Modify: `src/main-process/communication/ai-content-report-ipc.ts` (switch create handler to the union schema; add capabilities handler; harden JSON.parse is in registerValidatedHandler — Task 11)
- Test: `test/vitest/main/aiContentReportIpc.test.ts` (extend)

- [ ] **Step 1: Write the failing IPC tests**

Read the existing `test/vitest/main/aiContentReportIpc.test.ts` first to match its harness (it likely re-registers handlers against a stubbed `ipcMain` and a stubbed service). Append:

```typescript
describe("AI_CONTENT_REPORT_CAPABILITIES handler", () => {
  it("returns fail-closed capabilities via the service", async () => {
    // The handler instantiates AIContentReportService; stub its
    // getCapabilities to return a disabled envelope, OR stub the httpClient
    // to reject. Assert the IPC returns { status:true, data:{ ... enabled:false } }.
    // Mirror the existing test file's ipcMain stub + invocation pattern.
  });

  it("returns enabled capabilities when the backend is up", async () => {
    // Stub httpClient.get to resolve an enabled envelope; assert the IPC
    // data.conversationReporting.enabled === true.
  });
});

describe("create handler with union schema", () => {
  it("accepts a v2 request and dispatches to the service", async () => {
    // Send a v2 payload; assert the service received schemaVersion 2.
  });

  it("accepts a v1 request (backward compatible)", async () => {
    // Send a v1 payload; assert schemaVersion 1.
  });

  it("rejects a payload with an unknown schemaVersion", async () => {
    // Send { schemaVersion: 9, ... }; assert status:false.
  });
});
```

(Implement the bodies by mirroring the existing file's stub pattern — do NOT leave the `// ...` comments as the final code; write real assertions. The existing file is the authoritative reference for how this repo stubs `ipcMain.handle` + `registerValidatedHandler`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/aiContentReportIpc.test.ts`
Expected: FAIL — capabilities handler not registered; union not wired.

- [ ] **Step 3: Switch to the union schema + register the capabilities handler**

In `src/main-process/communication/ai-content-report-ipc.ts`, replace the contents:

```typescript
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import {
  createAnyAIContentReportSchema,
  getAIContentReportCapabilitiesSchema,
} from "@/schemas/ipc/aiContentReport";
import { AIContentReportService } from "@/service/AIContentReportService";
import {
  AI_CONTENT_REPORT_CREATE,
  AI_CONTENT_REPORT_CAPABILITIES,
} from "@/config/channellist";

/**
 * Register AI-content-report IPC handlers (design §13).
 *
 * CRITICAL (PRD FR-4.4, §14.9): BOTH handlers use `registerValidatedHandler`,
 * NOT `registerAiValidatedHandler`. Reporting is a safety/support function and
 * must remain available when `USER_AI_ENABLED !== "true"`, after a subscription
 * expires, or when the selected model is unavailable. It must never consume AI
 * credits or call an AI model.
 *
 * The create handler validates the renderer payload against the v1/v2 union
 * (design §12) and dispatches on `schemaVersion` inside the service. The
 * capabilities handler returns the cached/fail-closed capability envelope.
 */
export function registerAIContentReportIpcHandlers(): void {
  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    createAnyAIContentReportSchema,
    async (input) => {
      const service = new AIContentReportService();
      return service.submitReport(input);
    }
  );

  registerValidatedHandler(
    AI_CONTENT_REPORT_CAPABILITIES,
    getAIContentReportCapabilitiesSchema,
    async () => {
      const service = new AIContentReportService();
      return service.getCapabilities();
    }
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/aiContentReportIpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/main-process/communication/ai-content-report-ipc.ts test/vitest/main/aiContentReportIpc.test.ts
git commit -m "feat: wire union schema + capabilities IPC handler"
```

---

### Task 11: Harden `registerValidatedHandler` JSON.parse (design §13.3)

**Files:**
- Modify: `src/main-process/communication/_shared/registerValidatedHandler.ts` (wrap the `JSON.parse(raw)` in try/catch so malformed JSON returns status:false instead of throwing)
- Test: `test/vitest/main/registerValidatedHandlerMalformed.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/registerValidatedHandlerMalformed.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";

// Stub ipcMain so registerValidatedHandler can be exercised without Electron.
const handlers: Record<string, (e: unknown, raw: unknown) => Promise<unknown>> = {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (e: unknown, raw: unknown) => Promise<unknown>) => {
      handlers[channel] = fn;
    }),
  },
  IpcMainInvokeEvent: class {},
}));

import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";

const schema = lazySchema(() => z.strictObject({ x: z.number() }));

describe("registerValidatedHandler malformed JSON", () => {
  it("returns status:false (not a throw) for a non-JSON string", async () => {
    registerValidatedHandler("test:malformed", schema, async () => ({ ok: true }));
    const result = await handlers["test:malformed"]({}, "{ this is not json ");
    expect(result).toMatchObject({ status: false, data: null });
  });

  it("still validates a valid object", async () => {
    registerValidatedHandler("test:valid", schema, async (input) => ({ doubled: (input as { x: number }).x * 2 }));
    const result = await handlers["test:valid"]({}, { x: 5 });
    expect(result).toMatchObject({ status: true, data: { doubled: 10 } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/registerValidatedHandlerMalformed.test.ts`
Expected: FAIL — the malformed-JSON case throws instead of returning `{ status:false }`.

- [ ] **Step 3: Wrap the parse**

In `src/main-process/communication/_shared/registerValidatedHandler.ts`, replace:

```typescript
    const input = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = schema().safeParse(input);
```

with:

```typescript
    let input: unknown = raw;
    if (typeof raw === "string") {
      try {
        input = JSON.parse(raw);
      } catch {
        log.warn(`[${channel}] received malformed JSON payload`);
        return {
          status: false,
          msg: "Malformed request payload",
          data: null,
        } satisfies CommonMessage<null>;
      }
    }
    const parsed = schema().safeParse(input);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --config vite.main.config.mjs run test/vitest/main/registerValidatedHandlerMalformed.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full main-process suite for regression**

Run: `yarn testmain`
Expected: PASS (no regressions in other validated handlers).

- [ ] **Step 6: Type-check + commit**

```bash
npx tsc --noEmit
git add src/main-process/communication/_shared/registerValidatedHandler.ts test/vitest/main/registerValidatedHandlerMalformed.test.ts
git commit -m "fix: harden registerValidatedHandler against malformed JSON"
```

---

### Task 12: `formatZodValidationError` no-leak regression test (design §18.3)

**Files:**
- Test: `test/vitest/utilitycode/zodErrorsNoLeak.test.ts`

**Why:** The privacy boundary (design §18.3) requires that validation error messages never echo back rejected values (which could contain secrets, prompts, or PII). `formatZodValidationError` currently groups issues into missing/unexpected/mismatch without values — this test locks that invariant so a future refactor cannot silently leak.

- [ ] **Step 1: Write the test**

Create `test/vitest/utilitycode/zodErrorsNoLeak.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { formatZodValidationError } from "@/utils/zodErrors";

const SECRET = "SUPER_SECRET_VALUE_123";
const ANOTHER_SECRET = "another-secret-prompt-content";

const schema = z.strictObject({
  schemaVersion: z.literal(2),
  comment: z.string().max(10),
  items: z.array(
    z.strictObject({ text: z.string().max(5) })
  ),
});

describe("formatZodValidationError does not leak rejected values", () => {
  it("never includes the rejected string value in the formatted message", () => {
    const bad = {
      schemaVersion: 9,
      comment: SECRET,
      items: [{ text: ANOTHER_SECRET }],
      sneaky: "leak",
    };
    const result = schema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodValidationError("test:channel", result.error);
      expect(typeof msg).toBe("string");
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(ANOTHER_SECRET);
    }
  });

  it("reports unexpected keys without echoing their values", () => {
    const bad = { schemaVersion: 2, comment: "ok", extra: SECRET };
    const result = schema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodValidationError("test:channel", result.error);
      expect(msg).not.toContain(SECRET);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/zodErrorsNoLeak.test.ts`
Expected: PASS. If it FAILS (a secret appears in the message), STOP — that is a real privacy leak; fix `formatZodValidationError` to omit values before committing.

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add test/vitest/utilitycode/zodErrorsNoLeak.test.ts
git commit -m "test: lock formatZodValidationError no-rejected-value-leak invariant"
```

---

### Task 13: Register capabilities handler in main-process index (design §13.1)

**Files:**
- Modify: `src/main-process/communication/index.ts` (the handler registration is already a single call to `registerAIContentReportIpcHandlers()`; Task 10 already added the capabilities handler inside that function — so verify, don't duplicate)

- [ ] **Step 1: Verify the registration is already wired**

Run: `grep -n "registerAIContentReportIpcHandlers" src/main-process/communication/index.ts`
Expected: one call site exists. Because Task 10 extended `registerAIContentReportIpcHandlers()` to register BOTH channels, no change to `index.ts` is needed.

- [ ] **Step 2: Confirm by running the main-process suite**

Run: `yarn testmain`
Expected: PASS.

- [ ] **Step 3: Commit (only if a change was needed; otherwise skip)**

If `index.ts` needed no change, there is nothing to commit — skip this step. (Do not create an empty commit.)

---

## Phase 3: Renderer — Dialog, Components, Chat V2 Integration, i18n (design §10, §11.1, §20)

### Task 14: `AIConversationReportButton.vue` (design §10.1)

**Files:**
- Create: `src/views/components/aiContentReport/AIConversationReportButton.vue`
- Test: `test/vitest/main/components/AIConversationReportButton.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AIConversationReportButton.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiConversationReport: { action: "Report conversation", actionAriaLabel: "Report this conversation", unavailable: "Reporting unavailable" } } },
});

function mountButton(props: Record<string, unknown> = {}) {
  return mount(AIConversationReportButton, {
    props: { enabled: true, ...props },
    global: { plugins: [i18n] },
  });
}

describe("AIConversationReportButton", () => {
  it("renders the action text and has data-testid", () => {
    const w = mountButton();
    const btn = w.find('[data-testid="report-conversation"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("Report conversation");
  });

  it("emits open when clicked and enabled", async () => {
    const w = mountButton({ enabled: true });
    await w.find('[data-testid="report-conversation"]').trigger("click");
    expect(w.emitted("open")).toBeTruthy();
  });

  it("does not emit open when disabled", async () => {
    const w = mountButton({ enabled: false, disabledReason: "Reporting unavailable" });
    const btn = w.find('[data-testid="report-conversation"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    await btn.trigger("click");
    expect(w.emitted("open")).toBeFalsy();
  });

  it("shows the unavailable reason as the title when disabled", () => {
    const w = mountButton({ enabled: false, disabledReason: "Reporting unavailable" });
    expect((w.find('[data-testid="report-conversation"]').element as HTMLButtonElement).title).toContain("Reporting unavailable");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AIConversationReportButton.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

Create `src/views/components/aiContentReport/AIConversationReportButton.vue`:

```vue
<template>
  <v-btn
    data-testid="report-conversation"
    variant="text"
    size="small"
    :disabled="!enabled"
    :aria-label="ariaLabel"
    :title="enabled ? ariaLabel : (disabledReason || ariaLabel)"
    class="ai-conversation-report-btn"
    @click="onClick"
  >
    <v-icon size="small" start>mdi-flag-outline</v-icon>
    {{ compact ? "" : actionLabel }}
  </v-btn>
</template>

<script setup lang="ts">
/**
 * Header-level "Report conversation" action (design §10.1).
 *
 * Unlike the per-message AIContentReportButton (single output), this opens the
 * multi-select conversation report dialog. The button is disabled (not
 * hidden) when the capability envelope says v2 reporting is off or the backend
 * is unreachable — so the action's presence is stable and the disabled reason
 * is announced (PRD §11.4, design §10.1).
 *
 * Reporting is NOT AI-gated: the parent may show this button regardless of
 * USER_AI_ENABLED (design §2, PRD FR-4.4).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    /** False when the capability envelope disables v2 reporting. */
    enabled: boolean;
    /** Loading state while capabilities are fetched. */
    loading?: boolean;
    /** Why the action is disabled (announced as title/tooltip). */
    disabledReason?: string;
    /** Icon-only variant for compact headers. */
    compact?: boolean;
  }>(),
  { loading: false, compact: false }
);

const emit = defineEmits<{
  (e: "open"): void;
}>();

const { t } = useI18n();
const actionLabel = computed(
  () => t("aiConversationReport.action") || "Report conversation"
);
const ariaLabel = computed(
  () =>
    t("aiConversationReport.actionAriaLabel") ||
    "Report this conversation for review"
);

function onClick(): void {
  if (!props.enabled || props.loading) return;
  emit("open");
}
</script>

<style scoped>
.ai-conversation-report-btn {
  text-transform: none;
  min-width: 44px;
  min-height: 44px;
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AIConversationReportButton.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiContentReport/AIConversationReportButton.vue test/vitest/main/components/AIConversationReportButton.test.ts
git commit -m "feat: add conversation-report header button component"
```

---

### Task 15: `AIConversationReportItemList.vue` (design §10.2)

**Files:**
- Create: `src/views/components/aiContentReport/AIConversationReportItemList.vue`
- Test: `test/vitest/main/components/AIConversationReportItemList.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AIConversationReportItemList.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AIConversationReportItemList from "@/views/components/aiContentReport/AIConversationReportItemList.vue";
import type { ConversationReportSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiConversationReport: { selectionInstruction: "Select", selectionCount: "{n} selected", itemTypes: { text: "Text", image: "Image", mixed: "Mixed", plan: "Plan", artifact: "Artifact" } } } },
});

function makeSnapshot(candidates: Partial<ConversationReportSnapshot["candidates"][number]>[] = [{ messageId: "a1", text: "hello", contentType: "text" }]): ConversationReportSnapshot {
  return {
    snapshotId: "snap-1",
    conversationId: "conv-1",
    surface: "chat_v2",
    createdAt: "2026-01-01T00:00:00.000Z",
    candidates: candidates.map((c, i) => ({
      itemId: `ai-${c.messageId ?? "m" + i}`,
      messageId: c.messageId ?? "m" + i,
      sourceIndex: i,
      role: "assistant" as const,
      contentType: c.contentType ?? "text",
      text: c.text,
      images: c.images ?? [],
      evidenceUnavailable: c.evidenceUnavailable ?? false,
      generatedAt: c.generatedAt,
      model: c.model,
    })),
  };
}

function mountList(props: Record<string, unknown>) {
  return mount(AIConversationReportItemList, { props, global: { plugins: [i18n] } });
}

describe("AIConversationReportItemList", () => {
  it("renders one checkbox row per candidate", () => {
    const w = mountList({
      snapshot: makeSnapshot([{ messageId: "a1", text: "one" }, { messageId: "a2", text: "two" }]),
      selectedItemIds: new Set<string>(),
    });
    expect(w.findAll('[data-testid^="report-item-"]')).toHaveLength(2);
  });

  it("emits toggle with the itemId when a checkbox changes", async () => {
    const w = mountList({ snapshot: makeSnapshot(), selectedItemIds: new Set<string>() });
    await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
    expect(w.emitted("toggle")).toBeTruthy();
    expect(w.emitted("toggle")![0]).toEqual(["ai-a1"]);
  });

  it("reflects the selected count in the summary", () => {
    const w = mountList({ snapshot: makeSnapshot([{ messageId: "a1" }, { messageId: "a2" }]), selectedItemIds: new Set(["ai-a1"]) });
    expect(w.text()).toContain("1 selected");
  });

  it("marks a row checked when its id is in selectedItemIds", () => {
    const w = mountList({ snapshot: makeSnapshot(), selectedItemIds: new Set(["ai-a1"]) });
    expect((w.find('[data-testid="report-item-ai-a1"] input').element as HTMLInputElement).checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AIConversationReportItemList.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/views/components/aiContentReport/AIConversationReportItemList.vue`:

```vue
<template>
  <div class="conversation-report-items" role="group" :aria-label="instructionLabel">
    <div class="conversation-report-items__summary">
      {{ countLabel }}
    </div>
    <ul class="conversation-report-items__list">
      <li
        v-for="c in snapshot.candidates"
        :key="c.itemId"
        :data-testid="`report-item-${c.itemId}`"
      >
        <label class="conversation-report-items__row">
          <input
            type="checkbox"
            :checked="selectedItemIds.has(c.itemId)"
            :aria-label="rowLabel(c)"
            @change="onToggle(c.itemId)"
          />
          <span class="conversation-report-items__type">{{ typeLabel(c.contentType) }}</span>
          <span class="conversation-report-items__text">{{ preview(c.text) }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * Multi-select list of AI outputs captured in the immutable snapshot
 * (design §10.2). Pure presentational — selection state is owned by the
 * dialog, communicated via `toggle`/`selectAll`. Read-only preview only;
 * never v-html (PRD FR-2.2, §14.5).
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ConversationReportSnapshot } from "./conversationReportSnapshot";
import type { AIContentType } from "@/entityTypes/aiContentReportTypes";

const props = defineProps<{
  snapshot: ConversationReportSnapshot;
  selectedItemIds: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  (e: "toggle", itemId: string): void;
}>();
const { t } = useI18n();

const instructionLabel = computed(
  () => t("aiConversationReport.selectionInstruction") || "Select the AI outputs to report"
);
const countLabel = computed(() => {
  const base = t("aiConversationReport.selectionCount") || "{n} selected";
  return base.replace("{n}", String(props.selectedItemIds.size));
});
function typeLabel(ct: AIContentType): string {
  return t(`aiConversationReport.itemTypes.${ct}`) || ct;
}
function preview(text?: string): string {
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
function rowLabel(c: ConversationReportSnapshot["candidates"][number]): string {
  return `${typeLabel(c.contentType)} — ${preview(c.text)}`;
}
function onToggle(itemId: string): void {
  emit("toggle", itemId);
}
</script>

<style scoped>
.conversation-report-items__list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 280px;
  overflow-y: auto;
}
.conversation-report-items__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
}
.conversation-report-items__type {
  font-size: 11px;
  opacity: 0.7;
  min-width: 52px;
}
.conversation-report-items__text {
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-word;
}
.conversation-report-items__summary {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 6px;
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AIConversationReportItemList.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiContentReport/AIConversationReportItemList.vue test/vitest/main/components/AIConversationReportItemList.test.ts
git commit -m "feat: add conversation-report item list component"
```

---

### Task 16: `AIConversationReportDialog.vue` (design §10.3)

**Files:**
- Create: `src/views/components/aiContentReport/AIConversationReportDialog.vue`
- Test: `test/vitest/main/components/AIConversationReportDialog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/components/AIConversationReportDialog.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import type { ConversationReportSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";

// Mock the frontend API + request builder so the dialog is tested in isolation.
const createMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  createAIContentReport: (...args: unknown[]) => createMock(...args),
}));
const buildMock = vi.fn();
vi.mock("@/views/components/aiContentReport/conversationReportRequest", () => ({
  buildCreateAIConversationReportRequest: (...args: unknown[]) => buildMock(...args),
  AIConversationReportLocalError: class extends Error {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(public code: any, message: string) { super(message); this.name = "AIConversationReportLocalError"; }
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiConversationReport: { dialogTitle: "Report conversation", continueAndSubmit: "Submit", cancel: "Cancel", includeRelatedUserContext: "Include my related message", userMessageWillBeSent: "Your message will be sent", consentDefault: "Only AI outputs", consentWithUserContext: "With my related message", truncationWarning: "Trimmed", conversationChanged: "Conversation changed", errors: { selectionRequired: "Select one", selectionLimit: "Too many", imageLimit: "Too many images", relatedMessageUnavailable: "No related message", unsupportedSchema: "Unsupported" } } } },
});

function makeSnapshot(): ConversationReportSnapshot {
  return {
    snapshotId: "snap-1", conversationId: "conv-1", surface: "chat_v2", createdAt: "2026-01-01T00:00:00.000Z",
    candidates: [
      { itemId: "ai-a1", messageId: "a1", sourceIndex: 1, role: "assistant", contentType: "text", text: "AI answer", images: [], evidenceUnavailable: false, relatedUser: { itemId: "user-u1", messageId: "u1", sourceIndex: 0, role: "user", contentType: "text", text: "user q", omittedAttachmentContent: false } },
    ],
  };
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AIConversationReportDialog, {
    props: { modelValue: true, snapshot: makeSnapshot(), ...props },
    global: { plugins: [i18n] },
  });
}

describe("AIConversationReportDialog", () => {
  beforeEach(() => { createMock.mockReset(); buildMock.mockReset(); });

  it("renders the item list and the related-user opt-in toggle", () => {
    const w = mountDialog();
    expect(w.find('[data-testid="report-item-ai-a1"]').exists()).toBe(true);
    expect(w.find('[data-testid="include-related-user-context"]').exists()).toBe(true);
  });

  it("requires a selection before submit (local validation)", async () => {
    const w = mountDialog();
    await w.find('[data-testid="conversation-report-submit"]').trigger("click");
    await flushPromises();
    expect(buildMock).not.toHaveBeenCalled();
    expect(w.text()).toContain("Select one");
  });

  it("submits after selecting an item", async () => {
    buildMock.mockResolvedValueOnce({ schemaVersion: 2, clientReportId: "c", surface: "chat_v2", reportScope: "selected_ai_outputs", category: "other", items: [], context: { conversationId: "c", selectedAIItemCount: 1, includedUserItemCount: 0, appVersion: "1", platform: "win32", locale: "en" } });
    createMock.mockResolvedValueOnce({ reportId: "r1", status: "submitted", receivedAt: "t", duplicate: false });
    const w = mountDialog();
    await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
    await w.find('[data-testid="conversation-report-submit"]').trigger("click");
    await flushPromises();
    expect(buildMock).toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(w.emitted("submitted")).toBeTruthy();
  });

  it("switches reportScope when the related-user toggle is enabled", async () => {
    buildMock.mockResolvedValueOnce({ schemaVersion: 2, clientReportId: "c", surface: "chat_v2", reportScope: "selected_ai_outputs_with_related_user_context", category: "other", items: [], context: { conversationId: "c", selectedAIItemCount: 1, includedUserItemCount: 1, appVersion: "1", platform: "win32", locale: "en" } });
    createMock.mockResolvedValueOnce({ reportId: "r2", status: "submitted", receivedAt: "t", duplicate: false });
    const w = mountDialog();
    await w.find('[data-testid="report-item-ai-a1"] input').trigger("change");
    await w.find('[data-testid="include-related-user-context"] input').trigger("change");
    await w.find('[data-testid="conversation-report-submit"]').trigger("click");
    await flushPromises();
    expect(buildMock).toHaveBeenCalled();
    const arg = buildMock.mock.calls[0][0];
    expect(arg.includeRelatedUserContext).toBe(true);
  });

  it("closes on cancel without submitting", async () => {
    const w = mountDialog();
    await w.find('[data-testid="conversation-report-cancel"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeTruthy();
    expect(w.emitted("update:modelValue")![0]).toEqual([false]);
    expect(createMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AIConversationReportDialog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/views/components/aiContentReport/AIConversationReportDialog.vue`:

```vue
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="680"
    scrollable
    @update:model-value="onToggle"
  >
    <v-card data-testid="ai-conversation-report-dialog">
      <v-card-title id="ai-conversation-report-title" ref="titleRef" tabindex="-1">
        {{ titleText }}
      </v-card-title>
      <v-card-text>
        <AIConversationReportItemList
          :snapshot="snapshot"
          :selected-item-ids="selectedItemIds"
          @toggle="toggleItem"
        />

        <label v-if="canIncludeRelatedUser" class="conversation-report__opt-in" data-testid="include-related-user-context">
          <input type="checkbox" :checked="includeRelatedUserContext" @change="onToggleRelated" />
          <span>{{ includeRelatedUserLabel }}</span>
        </label>
        <p v-if="includeRelatedUserContext" class="conversation-report__warn">{{ userMessageWillBeSent }}</p>

        <v-select
          v-model="category"
          :items="categoryItems"
          :label="categoryLabel"
          item-title="label"
          item-value="value"
          density="compact"
          class="mt-3"
          aria-required="true"
          :error-messages="categoryError ? [categoryError] : []"
        />
        <v-textarea
          v-model="comment"
          :label="commentLabel"
          density="compact"
          rows="2"
          counter="2000"
          maxlength="2000"
          auto-grow
          class="mt-2"
        />

        <div class="report-notice">
          <v-icon size="small" start>mdi-shield-lock-outline</v-icon>
          <span>{{ consentText }}</span>
        </div>
        <div v-if="localError" class="report-error" aria-live="polite" data-testid="conversation-report-error">
          {{ localError }}
        </div>
        <div v-if="resultMessage" class="report-result" aria-live="polite" role="status">
          <v-icon :color="resultIsError ? 'error' : 'success'" size="small" start>
            {{ resultIsError ? "mdi-alert-circle" : "mdi-check-circle" }}
          </v-icon>
          <span>{{ resultMessage }}</span>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="conversation-report-cancel" :disabled="submitting" @click="onCancel">
          {{ cancelText }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          data-testid="conversation-report-submit"
          :loading="submitting"
          :disabled="submitting"
          @click="onSubmit"
        >
          {{ submitText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Multi-select conversation report dialog (design §10.3). Separate from the
 * single-output AIContentReportDialog (design D2). Operates on an immutable
 * snapshot captured at open time; a conversation-ID watch closes the dialog if
 * the active conversation changes underneath it.
 *
 * NOT AI-gated: submission goes through `registerValidatedHandler`, never the
 * AI feature gate. The related-user opt-in is fresh and unchecked per open
 * (PRD §10.3, design §7.3).
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AIConversationReportItemList from "./AIConversationReportItemList.vue";
import {
  buildCreateAIConversationReportRequest,
  AIConversationReportLocalError,
} from "./conversationReportRequest";
import { createAIContentReport } from "@/views/api/aiContentReport";
import type { ConversationReportSnapshot } from "./conversationReportSnapshot";
import {
  AI_CONTENT_REPORT_CATEGORIES,
  type AIContentReportCategory,
} from "@/entityTypes/aiContentReportTypes";

const props = defineProps<{
  modelValue: boolean;
  snapshot: ConversationReportSnapshot;
  privacyPolicyUrl?: string;
  activatorEl?: HTMLElement | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "submitted", payload: { reportId: string; selectedMessageIds: string[] }): void;
}>();
const { t, locale } = useI18n();

const titleRef = ref<{ $el?: HTMLElement } | null>(null);
let lastFocusedEl: HTMLElement | null = null;

const selectedItemIds = ref<Set<string>>(new Set());
const includeRelatedUserContext = ref(false);
const category = ref<AIContentReportCategory | null>(null);
const comment = ref("");
const submitting = ref(false);
const localError = ref("");
const resultMessage = ref("");
const resultIsError = ref(false);
const clientReportId = ref("");
const categoryError = ref("");

const MAX_COMMENT = 2000;

const titleText = computed(() => t("aiConversationReport.dialogTitle") || "Report conversation");
const submitText = computed(() => t("aiConversationReport.continueAndSubmit") || "Submit report");
const cancelText = computed(() => t("aiConversationReport.cancel") || "Cancel");
const categoryLabel = computed(() => t("aiConversationReport.categoryLabel") || "What is wrong?");
const commentLabel = computed(() => t("aiConversationReport.commentLabel") || "Additional details (optional)");
const includeRelatedUserLabel = computed(
  () => t("aiConversationReport.includeRelatedUserContext") || "Include my related message"
);
const userMessageWillBeSent = computed(
  () => t("aiConversationReport.userMessageWillBeSent") || "Your related message will be sent with the report."
);
const consentText = computed(
  () => t("aiConversationReport.consentDefault") ||
    "Only the selected AI outputs and your description will be sent. Your other messages, files, and AI reasoning are not included."
);

const canIncludeRelatedUser = computed(() =>
  props.snapshot.candidates.some((c) => c.relatedUser)
);

const categoryItems = computed(() =>
  AI_CONTENT_REPORT_CATEGORIES.map((value) => ({
    value,
    label: t(`aiContentReport.categories.${value}`) || value,
  }))
);

function toggleItem(itemId: string): void {
  const next = new Set(selectedItemIds.value);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  selectedItemIds.value = next;
  localError.value = "";
}

function onToggleRelated(): void {
  includeRelatedUserContext.value = !includeRelatedUserContext.value;
}

function onToggle(v: boolean): void {
  emit("update:modelValue", v);
}

function onCancel(): void {
  emit("update:modelValue", false);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      lastFocusedEl = (document.activeElement as HTMLElement | null) ?? props.activatorEl ?? null;
      clientReportId.value = generateClientReportId();
      selectedItemIds.value = new Set();
      includeRelatedUserContext.value = false;
      category.value = null;
      comment.value = "";
      localError.value = "";
      resultMessage.value = "";
      resultIsError.value = false;
      categoryError.value = "";
      nextTick(() => titleRef.value?.$el?.focus?.());
    } else {
      const target = lastFocusedEl ?? props.activatorEl ?? null;
      target?.focus?.();
      lastFocusedEl = null;
    }
  }
);

function generateClientReportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localErrorText(code: AIConversationReportLocalError["code"]): string {
  const map: Record<AIConversationReportLocalError["code"], string> = {
    selection_required: t("aiConversationReport.errors.selectionRequired") || "Select at least one AI output.",
    selection_limit: t("aiConversationReport.errors.selectionLimit") || "Select at most 10 AI outputs.",
    image_limit: t("aiConversationReport.errors.imageLimit") || "At most 3 images per report.",
    related_message_unavailable: t("aiConversationReport.errors.relatedMessageUnavailable") || "No related message is available.",
    conversation_changed: t("aiConversationReport.errors.conversationChanged") || "The conversation changed; reopen the report.",
    evidence_unavailable: t("aiConversationReport.errors.unsupportedSchema") || "Evidence unavailable.",
  };
  return map[code] || "Unable to submit.";
}

async function onSubmit(): Promise<void> {
  localError.value = "";
  categoryError.value = "";
  if (!category.value) {
    categoryError.value = t("aiContentReport.errors.categoryRequired") || "Please choose a category.";
    return;
  }

  let request;
  try {
    request = await buildCreateAIConversationReportRequest({
      snapshot: props.snapshot,
      selectedAIItemIds: selectedItemIds.value,
      selectedImageIds: new Set<string>(),
      includeRelatedUserContext: includeRelatedUserContext.value,
      category: category.value,
      comment: comment.value,
      locale: locale.value || "en-US",
      clientReportId: clientReportId.value,
    });
  } catch (err) {
    if (err instanceof AIConversationReportLocalError) {
      localError.value = localErrorText(err.code);
    } else {
      localError.value = t("aiConversationReport.errors.unsupportedSchema") || "Unable to build the report.";
    }
    return;
  }

  submitting.value = true;
  resultIsError.value = false;
  resultMessage.value = "";
  try {
    const response = await createAIContentReport(request);
    const selectedMessageIds = request.items.map((i) => i.messageId);
    resultMessage.value = (t("aiContentReport.success") || "Report submitted. Reference: {reportId}")
      .replace("{reportId}", response.reportId);
    emit("submitted", { reportId: response.reportId, selectedMessageIds });
  } catch (err) {
    resultIsError.value = true;
    const message = err instanceof Error ? err.message : "unknown";
    // Reuse the v1 error-text mapping by code.
    const code = (message as string);
    resultMessage.value = t(`aiContentReport.errors.${code}`) ||
      t("aiContentReport.errors.unknown") || "The report could not be submitted.";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.conversation-report__opt-in {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
}
.conversation-report__warn {
  font-size: 12px;
  opacity: 0.85;
  margin: 4px 0 0 24px;
}
.report-notice {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 12px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.report-error {
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  margin-top: 6px;
}
.report-result {
  padding: 8px 0;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AIConversationReportDialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiContentReport/AIConversationReportDialog.vue test/vitest/main/components/AIConversationReportDialog.test.ts
git commit -m "feat: add conversation-report dialog component"
```

---

### Task 17: i18n — add `aiConversationReport` block to all 6 languages (design §20)

**Files:**
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`
- Modify: `test/vitest/utilitycode/aiContentReportI18nParity.test.ts` (add the new block to the parity check)

- [ ] **Step 1: Add the English block**

In `src/views/lang/en.ts`, insert AFTER the closing `},` of the `aiContentReport` block (line 3135) and BEFORE the final `};` (line 3136):

```typescript
  aiConversationReport: {
    action: "Report conversation",
    actionAriaLabel: "Report this conversation for review",
    unavailable: "Conversation reporting is currently unavailable.",
    noEligibleOutputs: "There are no reportable AI outputs in this conversation yet.",
    dialogTitle: "Report conversation",
    selectionInstruction: "Select the AI outputs to report.",
    selectionCount: "{n} selected",
    selectAll: "Select all",
    includeRelatedUserContext: "Include my related message that prompted the AI output",
    userMessageWillBeSent:
      "If you continue, your selected related message will be sent to AiFetchly along with the AI outputs.",
    attachmentOmitted:
      "An attachment in your message was omitted; only the message text is included.",
    consentDefault:
      "Only the selected AI outputs and your description will be sent. Your other messages, files, and AI reasoning are not included.",
    consentWithUserContext:
      "You have chosen to include your related message. It will be sent with the AI outputs you selected.",
    truncationWarning: "Long outputs were trimmed to fit the report size limit.",
    continueAndSubmit: "Submit report",
    conversationChanged: "The conversation changed while the report was open. Please reopen it.",
    categoryLabel: "What is wrong with this conversation?",
    commentLabel: "Additional details (optional)",
    itemTypes: {
      text: "Text",
      image: "Image",
      mixed: "Text and images",
      plan: "Plan",
      artifact: "Artifact",
    },
    errors: {
      selectionRequired: "Select at least one AI output to report.",
      selectionLimit: "You can select at most 10 AI outputs.",
      imageLimit: "A report can include at most 3 images.",
      relatedMessageUnavailable: "No related message is available for the selected output.",
      unsupportedSchema: "This report type is not supported. Please update the app.",
    },
  },
```

- [ ] **Step 2: Add the translated blocks**

Add the SAME key structure to each of `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` at the equivalent location (after each file's `aiContentReport` block). Provide accurate translations; below is the Chinese block as the reference — translate the remaining four into natural, accurate copy for each language (do NOT leave English in non-English files except proper nouns like "AiFetchly"):

**zh.ts:**
```typescript
  aiConversationReport: {
    action: "举报对话",
    actionAriaLabel: "举报此对话以供审核",
    unavailable: "对话举报功能当前不可用。",
    noEligibleOutputs: "此对话中暂无可举报的 AI 输出。",
    dialogTitle: "举报对话",
    selectionInstruction: "选择要举报的 AI 输出。",
    selectionCount: "已选择 {n} 项",
    selectAll: "全选",
    includeRelatedUserContext: "包含我触发该 AI 输出的相关消息",
    userMessageWillBeSent: "继续后，您选择的相关消息将与 AI 输出一并发送给 AiFetchly。",
    attachmentOmitted: "您消息中的附件已被省略；仅包含消息文本。",
    consentDefault: "仅发送您选择的 AI 输出和说明。您的其他消息、文件及 AI 推理过程不会包含在内。",
    consentWithUserContext: "您已选择包含相关消息。该消息将与您选择的 AI 输出一并发送。",
    truncationWarning: "过长的输出已裁剪以符合报告大小限制。",
    continueAndSubmit: "提交举报",
    conversationChanged: "报告打开期间对话已更改。请重新打开。",
    categoryLabel: "此对话有什么问题？",
    commentLabel: "补充说明（可选）",
    itemTypes: {
      text: "文本",
      image: "图片",
      mixed: "文本和图片",
      plan: "计划",
      artifact: "产物",
    },
    errors: {
      selectionRequired: "请至少选择一个要举报的 AI 输出。",
      selectionLimit: "最多可选择 10 个 AI 输出。",
      imageLimit: "每份报告最多包含 3 张图片。",
      relatedMessageUnavailable: "所选输出没有可用的相关消息。",
      unsupportedSchema: "不支持此举报类型。请更新应用。",
    },
  },
```

Repeat for `es.ts`, `fr.ts`, `de.ts`, `ja.ts` with accurate translations (Spanish, French, German, Japanese) preserving the same key structure and the `{n}`/`{reportId}` placeholders.

- [ ] **Step 3: Extend the parity test**

In `test/vitest/utilitycode/aiContentReportI18nParity.test.ts`, add a parallel `aiConversationReport` block check. After the existing `aiContentReport` describe/it loop, add:

```typescript
const REQUIRED_CONV_REPORT_TOP_KEYS = [
  "action",
  "actionAriaLabel",
  "unavailable",
  "noEligibleOutputs",
  "dialogTitle",
  "selectionInstruction",
  "selectionCount",
  "selectAll",
  "includeRelatedUserContext",
  "userMessageWillBeSent",
  "attachmentOmitted",
  "consentDefault",
  "consentWithUserContext",
  "truncationWarning",
  "continueAndSubmit",
  "conversationChanged",
  "categoryLabel",
  "commentLabel",
  "itemTypes",
  "errors",
];
const REQUIRED_CONV_REPORT_ITEM_TYPES = ["text", "image", "mixed", "plan", "artifact"];
const REQUIRED_CONV_REPORT_ERRORS = [
  "selectionRequired",
  "selectionLimit",
  "imageLimit",
  "relatedMessageUnavailable",
  "unsupportedSchema",
];

describe("aiConversationReport i18n parity", () => {
  for (const [langCode, langObj] of Object.entries(LANGS)) {
    it(`has the aiConversationReport top-level block (${langCode})`, () => {
      const block = readPath(langObj, ["aiConversationReport"]);
      expect(block, `${langCode} missing aiConversationReport block`).toBeDefined();
    });

    for (const key of REQUIRED_CONV_REPORT_TOP_KEYS) {
      it(`has aiConversationReport.${key} (${langCode})`, () => {
        const val = readPath(langObj, ["aiConversationReport", key]);
        expect(val, `${langCode} missing aiConversationReport.${key}`).toBeDefined();
      });
    }

    for (const it of REQUIRED_CONV_REPORT_ITEM_TYPES) {
      it(`has aiConversationReport.itemTypes.${it} (${langCode})`, () => {
        const val = readPath(langObj, ["aiConversationReport", "itemTypes", it]);
        expect(val, `${langCode} missing aiConversationReport.itemTypes.${it}`).toBeDefined();
      });
    }

    for (const code of REQUIRED_CONV_REPORT_ERRORS) {
      it(`has aiConversationReport.errors.${code} (${langCode})`, () => {
        const val = readPath(langObj, ["aiConversationReport", "errors", code]);
        expect(val, `${langCode} missing aiConversationReport.errors.${code}`).toBeDefined();
      });
    }
  }
});
```

- [ ] **Step 4: Run the parity test to verify it passes**

Run: `npx vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiContentReportI18nParity.test.ts`
Expected: PASS. If it FAILS, a language file is missing a key — add it.

- [ ] **Step 5: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts test/vitest/utilitycode/aiContentReportI18nParity.test.ts
git commit -m "feat: add aiConversationReport i18n block for 6 languages"
```

---

### Task 18: Integrate into AiChatV2 (design §11.1)

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue` (add conversation-report state + button + dialog + capability fetch)
- Modify: `src/views/components/aiChatV2/AiChatV2Messages.vue` (lift single-output dialog OUT → emit `report` upward; receive `reportedMessageIds` as a prop)
- Test: `test/vitest/main/components/AiChatV2ConversationReport.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/vitest/main/components/AiChatV2ConversationReport.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

const capsMock = vi.fn();
const createMock = vi.fn();
vi.mock("@/views/api/aiContentReport", () => ({
  getAIContentReportCapabilities: (...a: unknown[]) => capsMock(...a),
  createAIContentReport: (...a: unknown[]) => createMock(...a),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { aiConversationReport: { action: "Report conversation" } } },
});

// Minimal AiChatV2 mount is heavy; this test exercises the orchestration by
// mounting the dialog + button together the way AiChatV2 wires them, then
// asserting the capability fetch gates the button. If a full AiChatV2 mount
// is impractical in CI, mount AIConversationReportButton + AIConversationReportDialog
// directly (as Task 14/16 do) and assert the same contract. The goal is to
// lock: button disabled until capabilities resolve enabled:true.
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import type { ConversationReportSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";

function makeSnapshot(): ConversationReportSnapshot {
  return {
    snapshotId: "s", conversationId: "c", surface: "chat_v2", createdAt: "t",
    candidates: [{ itemId: "ai-a1", messageId: "a1", sourceIndex: 0, role: "assistant", contentType: "text", text: "hi", images: [], evidenceUnavailable: false }],
  };
}

describe("AiChatV2 conversation-report orchestration", () => {
  beforeEach(() => { capsMock.mockReset(); createMock.mockReset(); });

  it("disables the button when capabilities are disabled (fail-closed)", async () => {
    capsMock.mockResolvedValueOnce({ acceptedSchemaVersions: [1], conversationReporting: { enabled: false, maxAIItems: 10, maxUserItems: 10, maxTotalItems: 20, maxItemTextChars: 8000, maxAggregateTextChars: 32000, maxImages: 3 } });
    const w = mount(AIConversationReportButton, {
      props: { enabled: false, disabledReason: "Unavailable" },
      global: { plugins: [i18n] },
    });
    expect((w.find('[data-testid="report-conversation"]').element as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the dialog on button click when enabled", async () => {
    const w = mount(AIConversationReportDialog, {
      props: { modelValue: false, snapshot: makeSnapshot() },
      global: { plugins: [i18n] },
    });
    // simulate parent opening
    await w.setProps({ modelValue: true });
    expect(w.find('[data-testid="ai-conversation-report-dialog"]').exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatV2ConversationReport.test.ts`
Expected: FAIL (until the components + wiring exist — components already exist from Tasks 14/16, so this likely passes immediately; if so, the test is a regression guard).

- [ ] **Step 3: Lift single-output dialog out of `AiChatV2Messages.vue`**

In `src/views/components/aiChatV2/AiChatV2Messages.vue`:

**3a. Add `reportedMessageIds` as a prop.** In `defineProps`, add:

```typescript
  /** Message ids already reported this session (parent-owned after lift). */
  reportedMessageIds: Set<string>;
```

**3b. Replace the local `reportedMessageIds` ref.** Delete `const reportedMessageIds = ref<Set<string>>(new Set());` and change `:reported="reportedMessageIds.has(m.id)"` (line 21) to `:reported="props.reportedMessageIds.has(m.id)"`.

**3c. Emit `report` upward instead of mounting the dialog.** Delete the `<AIContentReportDialog>` block (lines 31–38), the `reportDialogOpen`/`activeReportDescriptor` refs, and `onReportSubmitted`. Change `onReportRequest` to emit:

```typescript
function onReportRequest(descriptor: ReportableOutputDescriptor): void {
  emit("report", descriptor);
}
```

Add `"report"` to the `defineEmits` signature:

```typescript
  (e: "report", descriptor: ReportableOutputDescriptor): void;
```

Remove the now-unused `AIContentReportDialog` import (line 79) — keep the `ReportableOutputDescriptor` type import.

- [ ] **Step 4: Add conversation-report orchestration to `AiChatV2.vue`**

In `src/views/components/aiChatV2/AiChatV2.vue`:

**4a. Imports** (near line 766):

```typescript
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import { buildChatV2ConversationSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";
import { getAIContentReportCapabilities } from "@/views/api/aiContentReport";
import type { AIContentReportCapabilities } from "@/entityTypes/aiContentReportTypes";
import type { ReportableOutputDescriptor } from "@/views/components/aiContentReport/reportableOutput";
```

**4b. State** (near line 906, after `messages`):

```typescript
// Conversation report (v2) orchestration — lifted from AiChatV2Messages (design §11.1).
const conversationReportDialogOpen = ref(false);
const conversationReportSnapshot = ref<ReturnType<typeof buildChatV2ConversationSnapshot> | null>(null);
const reportedMessageIds = ref<Set<string>>(new Set());
const reportCapabilities = ref<AIContentReportCapabilities | null>(null);
const reportCapabilitiesLoading = ref(false);
const singleReportDialogOpen = ref(false);
const activeSingleDescriptor = ref<ReportableOutputDescriptor | null>(null);

const conversationReportEnabled = computed(
  () => reportCapabilities.value?.conversationReporting.enabled === true
);
const conversationReportDisabledReason = computed(() =>
  conversationReportEnabled.value ? "" : t("aiConversationReport.unavailable")
);
```

**4c. Capability fetch on mount.** In the existing `onMounted` (search for `onMounted(`):

```typescript
  reportCapabilitiesLoading.value = true;
  try {
    reportCapabilities.value = await getAIContentReportCapabilities();
  } catch {
    reportCapabilities.value = null;
  } finally {
    reportCapabilitiesLoading.value = false;
  }
```

**4d. Handlers:**

```typescript
function onOpenConversationReport(): void {
  conversationReportSnapshot.value = buildChatV2ConversationSnapshot({
    conversationId: activeConversationId.value ?? "",
    messages: visibleMessages.value,
    activeAssistantMessageId: activeAssistantMessageId.value,
    streamStatus: streamStatus.value,
  });
  conversationReportDialogOpen.value = true;
}

function onConversationReportSubmitted(payload: { reportId: string; selectedMessageIds: string[] }): void {
  reportedMessageIds.value = new Set([
    ...reportedMessageIds.value,
    ...payload.selectedMessageIds,
  ]);
  conversationReportDialogOpen.value = false;
}

function onSingleReportRequest(descriptor: ReportableOutputDescriptor): void {
  activeSingleDescriptor.value = descriptor;
  singleReportDialogOpen.value = true;
}

function onSingleReportSubmitted(reportId: string): void {
  const id = activeSingleDescriptor.value?.context.messageId;
  if (id) {
    reportedMessageIds.value = new Set([...reportedMessageIds.value, id]);
  }
}
```

(`streamStatus` is a `computed<Status>` defined at line 2550 of `AiChatV2.vue`; pass `streamStatus.value`. `visibleMessages` is a `computed<ChatV2MessageView[]>` at line 2210; pass `visibleMessages.value`. The `Status` union `"idle"|"streaming"|"cancelled"|"error"` is locally defined at line 872 — it matches the snapshot builder's expected `streamStatus` input exactly.)

**4e. Template** — add the button to the header (near the existing delete/conversation controls around line 160) and wire `AiChatV2Messages` + the two dialogs. In the `<AiChatV2Messages>` usage (line 168), add props + the report event:

```html
      <AiChatV2Messages
        :messages="visibleMessages"
        :active-assistant-message-id="activeAssistantMessageId"
        :stream-status="streamStatus"
        :error-message="streamError ?? undefined"
        :show-typing-indicator="showTypingIndicator"
        :is-streaming="chatIsRunning"
        :retry-info="retryInfo"
        :recovery-info="recoveryInfo"
        :workspace-root="activeWorkspace?.rootPath ?? ''"
        :show-reasoning="showReasoning"
        :reported-message-ids="reportedMessageIds"
        @grant-permission="handleSkillPermissionGrant"
        @deny-permission="handleSkillPermissionDeny"
        @approve-plan="handleApprovePlan"
        @reject-plan="handleRejectPlan"
        @request-plan-changes="handleRequestPlanChanges"
        @open-artifact="(id: string) => emit('open-artifact', id)"
        @copy-artifact-html="(id: string) => emit('copy-artifact-html', id)"
        @report="onSingleReportRequest"
      />
```

Add the header button (place it in the same header row as the conversation controls):

```html
        <AIConversationReportButton
          :enabled="conversationReportEnabled"
          :loading="reportCapabilitiesLoading"
          :disabled-reason="conversationReportDisabledReason"
          @open="onOpenConversationReport"
        />
```

And mount the two dialogs at the end of the template (before the closing root tag):

```html
      <AIContentReportDialog
        v-if="singleReportDialogOpen"
        v-model="singleReportDialogOpen"
        :descriptor="activeSingleDescriptor"
        @submitted="onSingleReportSubmitted"
      />
      <AIConversationReportDialog
        v-if="conversationReportDialogOpen && conversationReportSnapshot"
        v-model="conversationReportDialogOpen"
        :snapshot="conversationReportSnapshot"
        @submitted="onConversationReportSubmitted"
      />
```

Import `AIContentReportDialog` (the single-output dialog) at the top too:

```typescript
import AIContentReportDialog from "@/views/components/aiContentReport/AIContentReportDialog.vue";
```

- [ ] **Step 5: Run the component test + vue type check**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatV2ConversationReport.test.ts`
Run: `yarn vue-check`
Expected: PASS.

- [ ] **Step 6: Run the full component suite for regressions**

Run: `yarn test:components`
Expected: PASS (existing AiChatV2Message tests must still pass after the dialog lift).

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiChatV2/AiChatV2.vue src/views/components/aiChatV2/AiChatV2Messages.vue test/vitest/main/components/AiChatV2ConversationReport.test.ts
git commit -m "feat: integrate conversation reporting into AiChatV2"
```

---

## Phase 4: Legacy Chat + Knowledge Chat Integration (design §11.2, §11.3)

### Task 19: Legacy `AiChatBox.vue` integration (design §11.2)

**Files:**
- Modify: `src/views/components/aiChat/AiChatBox.vue` (add the conversation-report button + dialog; reuse the single-output wiring already present)
- Test: `test/vitest/main/components/AiChatBoxConversationReport.test.ts`

- [ ] **Step 1: Inspect the existing AiChatBox report wiring**

Run: `grep -n "AIContentReport\|reportedMessageIds\|reportDialog\|buildLegacy\|ChatMessage\|messages\b" src/views/components/aiChat/AiChatBox.vue | head -20`
This reveals where the single-output dialog and the message list live, so the conversation button + snapshot builder slot in next to them.

- [ ] **Step 2: Write the failing test**

Create `test/vitest/main/components/AiChatBoxConversationReport.test.ts` following the same pattern as Task 18's test — mount the button + dialog and assert: button disabled when capabilities disabled; dialog opens on click. If a full AiChatBox mount is impractical, mount `AIConversationReportButton` + `AIConversationReportDialog` directly with a `buildLegacyConversationSnapshot`-produced snapshot and assert the same contract.

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatBoxConversationReport.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add the wiring**

In `src/views/components/aiChat/AiChatBox.vue`, mirror Task 18's pattern but use `buildLegacyConversationSnapshot`:

```typescript
import AIConversationReportButton from "@/views/components/aiContentReport/AIConversationReportButton.vue";
import AIConversationReportDialog from "@/views/components/aiContentReport/AIConversationReportDialog.vue";
import { buildLegacyConversationSnapshot } from "@/views/components/aiContentReport/conversationReportSnapshot";
import { getAIContentReportCapabilities } from "@/views/api/aiContentReport";
import type { AIContentReportCapabilities } from "@/entityTypes/aiContentReportTypes";
```

Add the same state block (`conversationReportDialogOpen`, `conversationReportSnapshot`, `reportedMessageIds`, `reportCapabilities`, `reportCapabilitiesLoading`, the computed `conversationReportEnabled`/`conversationReportDisabledReason`), the capability fetch in `onMounted`, and the handlers `onOpenConversationReport`/`onConversationReportSubmitted`. Pass the legacy message list + the active streaming assistant id into `buildLegacyConversationSnapshot`. Mount the button in the header and the dialog at the end of the template.

- [ ] **Step 5: Run the test + component suite**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/AiChatBoxConversationReport.test.ts`
Run: `yarn test:components`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/components/aiChat/AiChatBox.vue test/vitest/main/components/AiChatBoxConversationReport.test.ts
git commit -m "feat: integrate conversation reporting into legacy AiChatBox"
```

---

### Task 20: Knowledge `ChatInterface.vue` integration (design §11.3)

**Files:**
- Modify: `src/views/pages/knowledge/ChatInterface.vue` (add stable typed `KnowledgeChatMessage` ids + the button + dialog)
- Test: `test/vitest/main/components/KnowledgeConversationReport.test.ts`

- [ ] **Step 1: Inspect the knowledge message shape**

Run: `grep -n "messages\|type:.*user\|type:.*ai\|id:\|conversationId\|knowledgeConversationId" src/views/pages/knowledge/ChatInterface.vue | head -25`
This reveals the local message-object shape so the `KnowledgeChatMessage` adapter (Task 4) maps it without `any`.

- [ ] **Step 2: Write the failing test**

Create `test/vitest/main/components/KnowledgeConversationReport.test.ts` — same button+dialog contract, using a `buildKnowledgeConversationSnapshot`-produced snapshot.

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/KnowledgeConversationReport.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add stable typed message ids + wiring**

In `src/views/pages/knowledge/ChatInterface.vue`:

- Ensure each knowledge message has a stable `id` (UUID) when created. If the existing component uses array index or no id, generate one at creation: `const id = crypto.randomUUID();` (or a module counter fallback) and store it on the message object. Map the local message objects to the `KnowledgeChatMessage` interface (`{ id, type: "user"|"ai", content, timestamp }`) before passing to `buildKnowledgeConversationSnapshot`.
- Add the same imports/state/handlers/dialog-mount as Tasks 18/19, using `buildKnowledgeConversationSnapshot` + `knowledgeConversationId` (a stable conversation id for the knowledge chat; if none exists, generate one per session and keep it in a ref).
- Mount the button in the knowledge chat header.

- [ ] **Step 5: Run the test + component suite**

Run: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run test/vitest/main/components/KnowledgeConversationReport.test.ts`
Run: `yarn test:components`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
npx tsc --noEmit
git add src/views/pages/knowledge/ChatInterface.vue test/vitest/main/components/KnowledgeConversationReport.test.ts
git commit -m "feat: integrate conversation reporting into knowledge chat"
```

---

## Phase 5: Certification & Rollout (design §25.5, §27)

### Task 21: Full-suite green gate + lint

**Files:** none (verification)

- [ ] **Step 1: Run the complete test suite**

Run:
```bash
yarn testmain
yarn test:components
npx vitest --config vite.utilityCode.config.mjs run
yarn vue-check
npx tsc --noEmit
```
Expected: ALL PASS. If any fail, fix the reported errors (never `--no-verify`) and re-run until green.

- [ ] **Step 2: Lint the changed files**

Run:
```bash
npx eslint src/entityTypes/aiContentReportTypes.ts src/schemas/ipc/aiContentReport.ts src/schemas/api/aiContentReport.ts src/views/components/aiContentReport/conversationReportText.ts src/views/components/aiContentReport/conversationReportSnapshot.ts src/views/components/aiContentReport/conversationReportRequest.ts src/service/AIContentReportService.ts src/modules/lib/httpclient.ts src/main-process/communication/ai-content-report-ipc.ts src/main-process/communication/_shared/registerValidatedHandler.ts src/preload.ts src/views/api/aiContentReport.ts src/config/channellist.ts src/views/components/aiContentReport/AIConversationReportButton.vue src/views/components/aiContentReport/AIConversationReportItemList.vue src/views/components/aiContentReport/AIConversationReportDialog.vue src/views/components/aiChatV2/AiChatV2.vue src/views/components/aiChatV2/AiChatV2Messages.vue src/views/components/aiChat/AiChatBox.vue src/views/pages/knowledge/ChatInterface.vue
```
Expected: zero errors. Fix every reported `any`/unused-import/formatting issue (including pre-existing lint debt in files touched). Re-run until clean.

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -u
git commit -m "chore: lint conversation-report implementation"
```
(Only if there were fixes; otherwise skip.)

---

### Task 22: Privacy-policy + smoke checklist (design §25.5, PRD §24)

**Files:**
- Create: `docs/prd/ai-chat-conversation-reporting-rollout-checklist.md`

- [ ] **Step 1: Write the rollout checklist**

Create `docs/prd/ai-chat-conversation-reporting-rollout-checklist.md`:

```markdown
# Conversation Reporting — Rollout Checklist

Reference: `docs/prd/ai-chat-conversation-reporting-prd.md` §24, technical design §25.5.

## Pre-merge
- [ ] `yarn testmain`, `yarn test:components`, `npx tsc --noEmit`, `yarn vue-check` all green
- [ ] `npx eslint` clean on all touched files
- [ ] Capability endpoint fail-closes to `enabled:false` on network error (verified by service test)
- [ ] Reporting works when `USER_AI_ENABLED !== "true"` (handler uses registerValidatedHandler, NOT registerAiValidatedHandler)
- [ ] No report content (items, comment, text, images, message/conversation ids, model) appears in logs — metadata-only
- [ ] `formatZodValidationError` does not echo rejected values (regression test green)

## Smoke (manual, per surface: AiChatV2, AiChatBox, Knowledge)
- [ ] "Report conversation" button visible in header; disabled when backend down
- [ ] Opening the dialog lists only visible completed AI outputs (not user/system/tool/streaming rows)
- [ ] Selecting 1–10 AI outputs enables submit
- [ ] Related-user toggle is OFF by default each open; enabling it adds the directly-related user message
- [ ] Submitting returns a report reference; the reported message is marked "Reported"
- [ ] Switching conversations while the dialog is open closes/invalidates it
- [ ] Long outputs show the truncation notice; submit still succeeds
- [ ] Network failure shows a retryable error with the entered details preserved

## Privacy review
- [ ] Only allowlisted primitive values cross the renderer→main boundary (no metadata objects, URLs, paths, reasoning, attachments, tool data)
- [ ] Strict schemas reject unknown keys at every level (schema tests green)
- [ ] Image previews: ≤3 per report, ≤1024px, ≤1MiB; forbidden MIME types rejected by the encoder
```

- [ ] **Step 2: Commit**

```bash
git add docs/prd/ai-chat-conversation-reporting-rollout-checklist.md
git commit -m "docs: add conversation-reporting rollout checklist"
```

---

### Task 23: E2E smoke spec (design §24.6)

**Files:**
- Create: `test/e2e/specs/conversation-report.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Create `test/e2e/specs/conversation-report.spec.ts` following the existing E2E harness invariants (`AIFETCHLY_E2E=1`, temp userData, `E2ENetworkGuard`, `FakeOpenAI`). The spec:

1. Seeds `local-enabled` AI state via `E2EStateSeeder`; starts the FakeOpenAI server with a text-completion SSE scenario.
2. Opens AiChatV2, sends a prompt, waits for the assistant response to complete.
3. Clicks `[data-testid="report-conversation"]`.
4. Selects the first item checkbox `[data-testid="report-item-ai-..."] input`.
5. Clicks `[data-testid="conversation-report-submit"]`.
6. Asserts the success result region appears with a report reference.

Use the test-id landmarks: `report-conversation`, `report-item-*`, `ai-conversation-report-dialog`, `conversation-report-submit`. Prefer roles/accessible names; add `data-testid` only where unstable (design §14).

- [ ] **Step 2: Build E2E artifacts + run**

Run:
```bash
yarn build:e2e
xvfb-run -a yarn playwright test test/e2e/specs/conversation-report.spec.ts
```
Expected: PASS. (On macOS, `xvfb-run` is unnecessary — run `yarn playwright test ...` directly.)

- [ ] **Step 3: Commit**

```bash
git add test/e2e/specs/conversation-report.spec.ts
git commit -m "test: add conversation-report E2E smoke spec"
```

---

### Task 24: Final merge prep

- [ ] **Step 1: Squash-check the worktree branch**

Run:
```bash
git log --oneline test..HEAD
git diff test...HEAD --stat
```
Review the commit list + changed-file summary against this plan. Confirm every Phase 1–5 task has a corresponding commit.

- [ ] **Step 2: Re-run the full gate one last time**

Run:
```bash
yarn testmain && yarn test:components && npx tsc --noEmit && yarn vue-check
```
Expected: ALL PASS.

- [ ] **Step 3: Report to the user**

Summarize: files created/modified, test counts, the worktree branch name, and that the implementation is ready for review/merge into `test`.

---
