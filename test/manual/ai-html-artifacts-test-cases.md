# AI HTML Artifacts — Test Cases

## Document Information

- **Version**: 1.0
- **Created**: 2026-07-20
- **PRD**: `docs/prd/ai-html-artifacts-prd.md`
- **Technical design**: `docs/prd/ai-html-artifacts-technical-design.md`
- **Purpose**: Verify every PRD requirement (ART-001…ART-014), acceptance criterion (#1–#10), security requirement (§11), and testing requirement (§16) is implemented. Use this as both an executable checklist (automated) and a QA script (manual).

## How To Use This Document

- Each test case has a **stable ID** (`TC-<AREA>-<nn>`), the **PRD requirement(s)** it covers, a **type**, preconditions, steps, and an expected result.
- **Automated** blocks are drop-in Vitest specs that match the existing style in `test/vitest/utilitycode/aiArtifactMetadata.test.ts`. Place main-process tests under `test/vitest/main/` and renderer/utility tests under `test/vitest/utilitycode/`.
- **Manual** blocks are step-by-step QA scripts you run in `yarn dev`.
- Fill the **Status / Notes** column as you go. A requirement is "done" only when **every** test case mapped to it is green.

### Running the automated suites

```bash
# Main-process tests (validation, tool service, module, IPC)
AIFETCHLY_SKIP_TSC=1 yarn testmain --run test/vitest/main/aiArtifact*.test.ts

# Utility/renderer tests (metadata extraction, static v-html guard)
AIFETCHLY_SKIP_TSC=1 yarn testmain --run \
  test/vitest/utilitycode/aiArtifactMetadata.test.ts \
  test/vitest/utilitycode/aiArtifactStatic.test.ts
```

> Do not commit code that needs `AIFETCHLY_SKIP_TSC=1`. Use it only for tight inner loops when types are already clean.

---

## 1. Requirement → Test Case Traceability

| PRD ID / Criterion | Description | Test Case IDs | Priority |
|---|---|---|---|
| ART-001 | Register `create_html_artifact` built-in tool | TC-U-001, TC-M-001 | P0 |
| ART-002 | Validate `title`, `html`, `description`, `openImmediately` | TC-U-010…TC-U-022 | P0 |
| ART-003 | Persist artifacts via Model + Module layers | TC-U-030, TC-U-031, TC-I-001, TC-I-002 | P0 |
| ART-004 | Return artifact metadata in tool result | TC-U-040, TC-U-041 | P0 |
| ART-005 | Render artifact cards in AiChatV2 messages | TC-R-010, TC-R-011, TC-M-002 | P0 |
| ART-006 | Open artifacts in main workspace from tool result | TC-R-020, TC-M-003 | P0 |
| ART-007 | Render HTML through a sandboxed iframe | TC-R-030, TC-S-010 | P0 |
| ART-008 | Prevent `v-html` rendering of artifact HTML | TC-R-040 | P0 |
| ART-009 | Reopen prior artifacts from chat history | TC-U-050…TC-U-054, TC-M-004 | P1 |
| ART-010 | Copy HTML action | TC-R-050, TC-M-005 | P1 |
| ART-011 | Versioning / regeneration history | TC-U-060, TC-U-061, TC-M-006 | P1 |
| ART-012 | Translated UI strings (en/zh/es/fr/de/ja) | TC-I18N-001…TC-I18N-006, TC-M-007 | P1 |
| ART-013 | Validation errors for rejected artifacts | TC-U-070, TC-M-008 | P1 |
| ART-014 | Tests for tool validation + renderer metadata | (this whole document) | P1 |
| §11 Security | Sandbox, no same-origin, block remote/form/nav | TC-S-001…TC-S-020 | P0 |
| Acceptance #1–#10 | End-to-end acceptance | TC-A-001…TC-A-010 | P0/P1 |

---

## 2. Unit Tests — Main Process

> Target files: `src/service/AIArtifactValidationService.ts`, `src/service/AIHtmlArtifactToolService.ts`, `src/modules/AIArtifactModule.ts`, `src/main-process/communication/ai-artifact-ipc.ts`.

### 2.1 Tool registration (ART-001)

#### TC-U-001 — `create_html_artifact` is registered as a built-in tool with the PRD shape

- **Covers**: ART-001, §8.2, §8.3, §8.4
- **Type**: Unit
- **File**: `test/vitest/main/aiArtifactToolRegistration.test.ts`
- **Preconditions**: `skillsRegistry` loads built-in skills at module import.
- **Steps / Expected**:
  1. Import the registry and look up `create_html_artifact`.
  2. Expect the tool to exist with `source: "built-in"`, `tier: "main"`, `permissionCategory: "pure"`, `requiresConfirmation: false`.
  3. Expect `parameters.required` to equal `["title", "html"]`.
  4. Expect `parameters.properties.openImmediately.default` to be `true`.
  5. Expect the description to contain the non-use guidance phrase `"Do not use this tool for ordinary conversational answers"`.

```ts
import { describe, it, expect } from "vitest";
// Import the registry accessor exposed by skillsRegistry (adjust to actual export)
import { BUILT_IN_SKILLS } from "@/config/skillsRegistry";

describe("create_html_artifact registration (ART-001)", () => {
  const tool = BUILT_IN_SKILLS.find((s) => s.name === "create_html_artifact");
  it("is registered as a built-in tool", () => {
    expect(tool).toBeDefined();
    expect(tool?.source).toBe("built-in");
    expect(tool?.permissionCategory).toBe("pure");
    expect(tool?.requiresConfirmation).toBe(false);
  });
  it("requires only title and html", () => {
    expect(tool?.parameters.required).toEqual(["title", "html"]);
  });
  it("defaults openImmediately to true", () => {
    expect(tool?.parameters.properties.openImmediately.default).toBe(true);
  });
  it("ships the PRD non-use guidance in the description", () => {
    expect(tool?.description).toContain(
      "Do not use this tool for ordinary conversational answers"
    );
  });
});
```

### 2.2 Input validation (ART-002, ART-013)

> Implementation: `validateCreateInput(args)` → `{ ok: true; value } | { ok: false; error }`.
> Limits: title ≤ 160 chars, description ≤ 500 chars, html ≤ 512 KB (UTF-8 bytes), `openImmediately` defaults to `true`.

#### TC-U-010 — Accepts a valid minimal artifact

- **Covers**: ART-002, §8.4 (req 1–4), §16.1.1
- **Type**: Unit
- **Steps / Expected**: `validateCreateInput({ title: "Report", html: "<p>hi</p>" })` returns `ok: true`; `value.title === "Report"`; `value.openImmediately === true`; `value.html` is wrapped into a full document containing `<!doctype html>`.

#### TC-U-011 — `openImmediately: false` is honored

- **Covers**: §8.4 req 4
- **Steps / Expected**: Passing `openImmediately: false` yields `value.openImmediately === false`.

#### TC-U-012 — Optional description is trimmed and accepted

- **Covers**: §8.4 req 3
- **Steps / Expected**: `description: "  summary  "` → `value.description === "summary"`; empty/whitespace description → `value.description === undefined`.

#### TC-U-013 — Rejects empty / missing title

- **Covers**: ART-002, §16.1.2
- **Steps / Expected**: `title: ""`, `title: "   "`, and missing `title` each return `ok: false` with an error mentioning "title".

#### TC-U-014 — Rejects title over 160 characters

- **Covers**: §8.4 req 1, ART-013
- **Steps / Expected**: A 161-char title returns `ok: false` with an error that mentions the 160 limit. A 160-char title passes.

#### TC-U-015 — Rejects empty / missing HTML

- **Covers**: ART-002, §8.4 req 5, §16.1.3
- **Steps / Expected**: `html: ""`, `html: "   \n"`, and missing `html` each return `ok: false` with an error mentioning "HTML".

#### TC-U-016 — Rejects oversized HTML (> 512 KB)

- **Covers**: §8.4 req 6, §16.1.4, §11.7
- **Steps / Expected**: An HTML string whose UTF-8 byte length exceeds `AI_HTML_ARTIFACT_MAX_HTML_BYTES` (524288) returns `ok: false` with `"The HTML artifact exceeds the maximum allowed size."`.

#### TC-U-017 — Rejects description over 500 characters

- **Covers**: §8.4 req 3, ART-013
- **Steps / Expected**: A 501-char description returns `ok: false` with an error that mentions the 500 limit.

#### TC-U-018 — Rejects non-string / wrong-type fields

- **Covers**: ART-002
- **Steps / Expected**: `title: 123`, `html: null`, `description: { x: 1 }`, and `args` not being an object each return `ok: false`.

#### TC-U-019 — Rejects disallowed dangerous patterns (security guard)

- **Covers**: §11.5, §11.6, ART-013 (see §5 Security for the full matrix; each pattern is also a TC-S-xxx)
- **Steps / Expected**: Each disallowed pattern (`<script>`, `onerror=`, `javascript:`, `<iframe>`, `<object>`, `<embed>`, remote `<link>/<img>/<audio>/<video>/<source>`, `<form>`, `target=_parent`, `target=_top`) returns `ok: false`. See TC-S-001…TC-S-013.

#### TC-U-020 — Preserves a full HTML document as-is

- **Covers**: §8.4 req 2
- **Steps / Expected**: An input starting with `<!doctype html>` or `<html>` is returned verbatim (not double-wrapped).

#### TC-U-021 — Wraps a fragment in a safe document

- **Covers**: §8.4 req 2
- **Steps / Expected**: A bare fragment `<table>…</table>` is wrapped so `value.html` includes `<meta charset="utf-8">`, a viewport meta, and a `<title>` containing the escaped title.

#### TC-U-022 — Escapes the title when wrapping

- **Covers**: §11.9
- **Steps / Expected**: A title containing `<img src=x onerror=alert(1)>` injected into the document `<title>` is escaped (no raw `<` survives in the title element).

**Drop-in spec** (`test/vitest/main/aiArtifactValidation.test.ts`) covering TC-U-010…TC-U-022:

```ts
import { describe, it, expect } from "vitest";
import {
  validateCreateInput,
  AI_HTML_ARTIFACT_MAX_TITLE_LENGTH,
  AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH,
  AI_HTML_ARTIFACT_MAX_HTML_BYTES,
} from "@/service/AIArtifactValidationService";

const ok = { title: "Report", html: "<p>hi</p>" } as Record<string, unknown>;

describe("validateCreateInput (ART-002 / ART-013)", () => {
  it("accepts a valid minimal artifact and wraps it", () => {
    const r = validateCreateInput(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.openImmediately).toBe(true);
      expect(r.value.html).toContain("<!doctype html>");
    }
  });
  it("honors openImmediately=false", () => {
    const r = validateCreateInput({ ...ok, openImmediately: false });
    expect(r.ok && r.value.openImmediately).toBe(false);
  });
  it("trims description and drops empty", () => {
    const a = validateCreateInput({ ...ok, description: "  s  " });
    const b = validateCreateInput({ ...ok, description: "   " });
    expect(a.ok && a.value.description).toBe("s");
    expect(b.ok && b.value.description).toBeUndefined();
  });
  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["missing", undefined],
  ])("rejects title=%s", (_label, title) => {
    const r = validateCreateInput({ ...ok, title });
    expect(r.ok).toBe(false);
  });
  it("rejects title over the limit and accepts at the limit", () => {
    const over = "x".repeat(AI_HTML_ARTIFACT_MAX_TITLE_LENGTH + 1);
    const at = "x".repeat(AI_HTML_ARTIFACT_MAX_TITLE_LENGTH);
    expect(validateCreateInput({ ...ok, title: over }).ok).toBe(false);
    expect(validateCreateInput({ ...ok, title: at }).ok).toBe(true);
  });
  it.each([
    ["empty", ""],
    ["whitespace", "  \n "],
    ["missing", undefined],
  ])("rejects html=%s", (_label, html) => {
    expect(validateCreateInput({ ...ok, html }).ok).toBe(false);
  });
  it("rejects html over the byte limit with the size error", () => {
    const huge = "<p>" + "a".repeat(AI_HTML_ARTIFACT_MAX_HTML_BYTES + 10) + "</p>";
    const r = validateCreateInput({ ...ok, html: huge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("maximum allowed size");
  });
  it("rejects description over the limit", () => {
    const long = "d".repeat(AI_HTML_ARTIFACT_MAX_DESCRIPTION_LENGTH + 1);
    expect(validateCreateInput({ ...ok, description: long }).ok).toBe(false);
  });
  it.each([
    ["title number", { title: 1 }],
    ["html null", { html: null }],
    ["args not object", "nope"],
  ])("rejects wrong types: %s", (_label, bad) => {
    expect(validateCreateInput(bad as Record<string, unknown>).ok).toBe(false);
  });
  it("keeps a full document as-is", () => {
    const doc = "<!doctype html><html><body>x</body></html>";
    const r = validateCreateInput({ title: "T", html: doc });
    expect(r.ok && r.value.html).toBe(doc);
  });
  it("wraps a fragment and escapes the title", () => {
    const evil = `<img src=x onerror=alert(1)>`;
    const r = validateCreateInput({ title: evil, html: "<p>x</p>" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.html).toContain('<meta charset="utf-8">');
      // Title text must be escaped inside <title>…</title>
      expect(r.value.html).not.toMatch(/<title><img[^>]*>/);
    }
  });
});
```

### 2.3 Tool service (ART-003, ART-004)

> Implementation: `AIHtmlArtifactToolService.create(args, context)`.
> Requires a `SkillExecutionContext` with `conversationId`. Delegates persistence to `AIArtifactModule`. The module is an integration concern (touches SQLite), so isolate it with a stub.

#### TC-U-040 — Returns typed metadata (no content) on success

- **Covers**: ART-004, §8.5, §16.1.5
- **Type**: Unit (module stubbed)
- **Steps / Expected**:
  1. Stub `AIArtifactModule.prototype.createHtmlArtifact` to resolve a fake `AIArtifactRecord`.
  2. Call `service.create({ title: "T", html: "<p>x</p>" }, { conversationId: "c-1" })`.
  3. Expect `result.success === true`, `result.artifact` to be defined, `result.artifact.id` to match, `result.artifact.openImmediately === true`, and `result.summary` to start with `"Created HTML artifact:"`.
  4. **Critical**: `result.artifact` must NOT contain a `content` field (only metadata is returned to the model).

```ts
import { describe, it, expect, vi } from "vitest";
import { AIHtmlArtifactToolService } from "@/service/AIHtmlArtifactToolService";
import { AIArtifactModule } from "@/modules/AIArtifactModule";

describe("AIHtmlArtifactToolService (ART-003 / ART-004)", () => {
  it("returns success + metadata only (no content) on a valid call", async () => {
    const fake = {
      id: "artifact-1",
      conversationId: "c-1",
      type: "html",
      title: "T",
      description: undefined,
      mimeType: "text/html",
      content: "<p>x</p>",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    vi.spyOn(AIArtifactModule.prototype, "createHtmlArtifact").mockResolvedValue(fake);
    const service = new AIHtmlArtifactToolService();
    const result = await service.create(
      { title: "T", html: "<p>x</p>" },
      { conversationId: "c-1" } as never
    );
    expect(result.success).toBe(true);
    expect(result.artifact?.id).toBe("artifact-1");
    expect(result.artifact?.openImmediately).toBe(true);
    expect(result.summary).toMatch(/^Created HTML artifact:/);
    expect((result.artifact as Record<string, unknown>).content).toBeUndefined();
  });
});
```

#### TC-U-041 — Fails fast without a conversation id

- **Covers**: §10.1 req 3 (context requirement)
- **Steps / Expected**: `service.create(validArgs, { conversationId: "" })` returns `success: false` with `"Missing conversation id."` and does NOT call the module.

#### TC-U-042 — Surfaces validation failures as tool failures

- **Covers**: ART-013, §8.5 failure shape
- **Steps / Expected**: `service.create({ title: "", html: "x" }, ctx)` returns `success: false` with the validation error and a `"Could not create the HTML artifact."` summary; module is not called.

### 2.4 Module + Model persistence (ART-003)

> Implementation: `AIArtifactModule.createHtmlArtifact`, `AIArtifactModel` (TypeORM).
> These are **integration** tests — they need a real SQLite DB. Follow the repo's DB-test setup pattern (temp `USERSDBPATH`, `SqliteDb` initialized for the entity). See memory note `aiFetchly-testbuild-commands.md`.

#### TC-U-030 / TC-I-001 — Module stores and retrieves an artifact

- **Covers**: ART-003, §9, §16.1.6, §10.3
- **Type**: Integration (temp DB)
- **Steps / Expected**:
  1. `createHtmlArtifact({ conversationId, title, html })` returns a record with `id` starting with `artifact-`, `version: 1`, `type: "html"`, `mimeType: "text/html"`.
  2. `getArtifact(id)` returns the same record including `content`.
  3. `listArtifacts(conversationId)` includes the summary; the summary must NOT include `content`.

#### TC-U-031 — Persistence path goes through Model (no direct repo access in IPC)

- **Covers**: §10.3 req 1–2, §10.1 req 4
- **Type**: Static / architecture
- **Steps / Expected**: A grep over `src/main-process/communication/ai-artifact-ipc.ts` shows NO `getRepository(` and NO `SqliteDb.getInstance` — only `new AIArtifactModule()`.

```ts
// test/vitest/main/aiArtifactArchitecture.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

describe("Artifact architecture (§10.3)", () => {
  const ipc = readFileSync(
    resolve("src/main-process/communication/ai-artifact-ipc.ts"),
    "utf8"
  );
  it("IPC handlers never touch repositories directly", () => {
    expect(ipc).not.toContain("getRepository(");
    expect(ipc).not.toContain("SqliteDb.getInstance");
    expect(ipc).toContain("new AIArtifactModule()");
  });
  it("read IPC is intentionally not gated on AI enablement (creation is)", () => {
    // Per tech design §10.2: creation is gated via the Chat V2 stream.
    expect(ipc).toContain("USER_AI_ENABLED");
  });
});
```

> **Note**: the second assertion documents the design decision. If the architecture assertion for `USER_AI_ENABLED` does not hold, treat it as a finding to confirm against the tech design rather than an automatic failure — the gate may live in the Chat V2 stream handler (`ai-chat-v2-ipc.ts`) instead.

---

## 3. Renderer Tests

> Target files: `src/views/components/aiChatV2/artifactMetadata.ts`, `src/views/components/aiArtifacts/AiArtifactCard.vue`, `src/views/components/aiArtifacts/AiArtifactWorkspace.vue`, `src/views/layout/layout.vue`, `src/views/api/aiArtifacts.ts`.

### 3.1 Metadata extraction (ART-005, ART-009)

> `extractArtifactMetadata` and `ensureArtifactMetadata` are pure functions — already covered by `test/vitest/utilitycode/aiArtifactMetadata.test.ts`. Confirm that suite exists and passes; the cases below close any gaps.

#### TC-U-050 — (existing) valid metadata round-trips — already in repo

- **Covers**: ART-005, §16.2.1
- **Steps / Expected**: `yarn testmain --run test/vitest/utilitycode/aiArtifactMetadata.test.ts` is green.

#### TC-U-051 — Defaults `openImmediately` to `true` when absent — already in repo

- **Covers**: §8.4 req 4, §15.3

#### TC-U-052 — Returns `undefined` for malformed payloads — already in repo

- **Covers**: ART-005 (card never renders from invalid data), §11.10

#### TC-U-053 — `ensureArtifactMetadata` re-derives the card from history — already in repo

- **Covers**: ART-009, §15.5 (regression found by `/qa` on 2026-07-20)

#### TC-U-054 — Immutability: `ensureArtifactMetadata` does not mutate input — already in repo

- **Covers**: Coding-style immutability rule

### 3.2 Artifact card rendering (ART-005)

#### TC-R-010 — Card renders title, type, and actions for a valid metadata pointer

- **Covers**: ART-005, §8.8 (req 1–5)
- **Type**: Component (mount `AiArtifactCard` with `@vue/test-utils`)
- **Steps / Expected**:
  1. Mount with `artifact` = a valid `AIArtifactToolMetadata`.
  2. The rendered text contains the title, the localized type label, and an "Open" button.
  3. Clicking the Open button emits `open` with `artifact.id`.
  4. Clicking the copy icon emits `copy-html` with `artifact.id`.

#### TC-R-011 — Card shows a version chip only when `version > 1`

- **Covers**: §8.8 req 6, ART-011
- **Steps / Expected**: With `version: 1` the version chip is absent; with `version: 3` the chip text matches `Version 3`.

### 3.3 Workspace rendering & security (ART-007, ART-008)

#### TC-R-020 — Workspace renders an iframe with `srcdoc` (not `v-html`)

- **Covers**: ART-007, ART-008, §16.2.3, §16.2.4, §16.2.5
- **Type**: Component + static
- **Steps / Expected**:
  1. Mount `AiArtifactWorkspace` with an `artifact` whose `content` is `<p>hi</p>`.
  2. The rendered DOM contains an `<iframe>` whose `srcdoc` attribute equals the content.
  3. The iframe `sandbox` attribute is present and its value does **not** contain `allow-same-origin`.

#### TC-R-021 — Static guard: artifact components never use `v-html`

- **Covers**: ART-008, §11.1, §16.2.5
- **Type**: Static
- **File**: `test/vitest/utilitycode/aiArtifactStatic.test.ts`

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const FILES = [
  "src/views/components/aiArtifacts/AiArtifactWorkspace.vue",
  "src/views/components/aiArtifacts/AiArtifactCard.vue",
];

describe("ART-008: no v-html on artifact HTML", () => {
  for (const f of FILES) {
    it(`${f} does not render artifact content with v-html`, () => {
      const src = readFileSync(resolve(f), "utf8");
      expect(src).not.toMatch(/\bv-html\b/);
    });
  }
  it("AiArtifactWorkspace uses a sandboxed iframe srcdoc", () => {
    const src = readFileSync(
      resolve("src/views/components/aiArtifacts/AiArtifactWorkspace.vue"),
      "utf8"
    );
    expect(src).toMatch(/<iframe\b/);
    expect(src).toMatch(/sandbox=""/);
    expect(src).toMatch(/:srcdoc="artifact\.content"/);
    expect(src).not.toMatch(/allow-same-origin/);
  });
});
```

#### TC-R-030 — Long title truncates without breaking layout

- **Covers**: §12.7, §15.7, ART-007
- **Type**: Component / visual
- **Steps / Expected**: A 200-char title renders inside `.ai-artifact-workspace__title-text` (which has `text-overflow: ellipsis`) and the header row does not overflow the viewport. (Automate the class/attr assertion; verify visually in TC-M-009.)

### 3.4 Layout wiring (ART-006)

#### TC-R-040 — `layout.vue` opens the workspace on `open-artifact` and restores the route on close

- **Covers**: ART-006, §8.9 (req 1–4), §15.4
- **Type**: Component (mount layout with `AiChatV2` stubbed) + static
- **Steps / Expected**:
  1. Static: `layout.vue` imports `AiArtifactWorkspace` and binds `v-if="activeArtifact"` while `<RouterView v-else />` is the fallback. (Confirm by reading the template.)
  2. When `AiChatV2` emits `open-artifact`, `openAiArtifact` calls `getAIArtifact` and sets `activeArtifact` → workspace replaces `<RouterView>`.
  3. When the workspace emits `close`, `closeAiArtifact` clears `activeArtifact` → `<RouterView>` is shown again.

#### TC-R-041 — Opening a second artifact replaces the first

- **Covers**: §8.9 req 6
- **Steps / Expected**: After opening artifact A then artifact B, `activeArtifact.id === B.id` (no stacking).

### 3.5 Copy HTML (ART-010)

#### TC-R-050 — Copy path writes artifact content to the clipboard

- **Covers**: ART-010, §15.5 (copy)
- **Type**: Unit (stub `getAIArtifact` + `navigator.clipboard`)
- **Steps / Expected**: `copyArtifactHtml(id)` resolves the artifact, calls `navigator.clipboard.writeText(content)`, and shows the success message; a missing artifact shows the "not found" message and does not write.

---

## 4. Integration Tests

#### TC-I-001 — End-to-end create → read through Model/Module (temp DB)

- **Covers**: ART-003, §16.1.6
- **Steps / Expected**: `create → getArtifact → listArtifacts` round-trip returns consistent data; summaries omit content.

#### TC-I-002 — Versioning increments by (conversationId, title)

- **Covers**: ART-011, §9 req 3, §13.3
- **Steps / Expected**:
  1. Create artifact with title "Report" in conversation C → `version: 1`.
  2. Create again with the same title (case-insensitive) → new row, `version: 2`, fresh `artifactId`; the version-1 row is still retrievable by its id.
  3. A different title in the same conversation starts at `version: 1`.

#### TC-I-003 — IPC read handlers parse JSON-string or object payloads

- **Covers**: §10.2 (renderer API contract)
- **Type**: Integration (stub `ipcMain`/`AIArtifactModule`)
- **Steps / Expected**: `AI_ARTIFACT_GET` with `'{"artifactId":"x"}'` and with `{ artifactId: "x" }` both resolve; missing/empty `artifactId` returns `{ status: false }`. Same for `AI_ARTIFACT_LIST` with `conversationId`.

#### TC-I-004 — Deleting a conversation cascades to its artifacts

- **Covers**: §10.3 (lifecycle), data integrity
- **Steps / Expected**: After `AIChatV2Module.clearConversation(C)`, `listArtifacts(C)` returns `[]`. (Confirmed by wiring in `AIChatV2Module.ts`.)

---

## 5. Security Tests (§11)

> The sandboxed iframe (`sandbox=""`) is the real boundary. `validateCreateInput` is a product/performance guard that steers the model — it is NOT a sanitizer. Test both layers.

### 5.1 Validation-layer rejections (ART-013, §11.5, §11.6)

| ID | Payload (html) | Expected validation error reason | §11 ref |
|---|---|---|---|
| TC-S-001 | `<script>alert(1)</script>` | "Scripts are not supported…" | §11.5 |
| TC-S-002 | `<div onclick="x()">` | "Inline event handlers are not supported." | §11.5 |
| TC-S-003 | `<a href="javascript:alert(1)">` | "javascript: URLs are not supported." | §11.5 |
| TC-S-004 | `<iframe src="https://evil"></iframe>` | "Nested iframes are not supported." | §11.5 |
| TC-S-005 | `<object data="x"></object>` | "Object embeds are not supported." | §11.5 |
| TC-S-006 | `<embed src="x">` | "Embeds are not supported." | §11.5 |
| TC-S-007 | `<link rel="stylesheet" href="//cdn/x.css">` | "Remote stylesheets are not supported." | §11.5 |
| TC-S-008 | `<img src="//cdn/x.png">` | "Remote images are not supported." | §11.5 |
| TC-S-009 | `<audio src="//cdn/x.mp3">` | "Remote audio is not supported." | §11.5 |
| TC-S-010 | `<video src="//cdn/x.mp4">` | "Remote video is not supported." | §11.5 |
| TC-S-011 | `<source src="//cdn/x">` | "Remote media sources are not supported." | §11.5 |
| TC-S-012 | `<form action="x"><input></form>` | "Forms are not supported…" | §11.6 |
| TC-S-013 | `<a href="x" target="_parent">` / `target="_top"` | "Parent/Top navigation is not supported." | §11.6 |

**Drop-in spec** (`test/vitest/main/aiArtifactSecurityValidation.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { validateCreateInput } from "@/service/AIArtifactValidationService";

const base = { title: "T" } as Record<string, unknown>;

describe("Security validation (§11.5 / §11.6)", () => {
  it.each<string>([
    "<script>alert(1)</script>",
    '<div onclick="x()">x</div>',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil"></iframe>',
    '<object data="x"></object>',
    '<embed src="x">',
    '<link rel="stylesheet" href="//cdn/x.css">',
    '<img src="//cdn/x.png">',
    '<audio src="//cdn/x.mp3">',
    '<video src="//cdn/x.mp4">',
    '<source src="//cdn/x">',
    '<form action="x"><input name="u"/></form>',
    '<a href="x" target="_parent">x</a>',
    '<a href="x" target="_top">x</a>',
  ])("rejects disallowed payload %j", (html) => {
    const r = validateCreateInput({ ...base, html });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});
```

### 5.2 Sandbox-layer guarantees (§11.1–§11.4, §11.8)

#### TC-S-020 — Iframe sandbox attributes block privileged access

- **Covers**: §11.1–§11.4, §11.8, §15.10
- **Type**: Static + runtime
- **Steps / Expected**:
  1. Static: `AiArtifactWorkspace.vue` iframe has `sandbox=""` and `referrerpolicy="no-referrer"`; no `allow-same-origin`, no `allow-scripts`. (Covered by TC-R-021.)
  2. Runtime (manual/e2e): render a payload that, if unsandboxed, would (a) read `localStorage`, (b) call `window.parent`, (c) navigate `top.location`. In the sandbox each attempt throws or is a no-op; the parent app is unaffected. (See TC-M-010.)

#### TC-S-021 — Title/description are never rendered as raw HTML in the Vue UI

- **Covers**: §11.9
- **Steps / Expected**: A title `<img src=x onerror=alert(1)>` passed to `AiArtifactCard`/`AiArtifactWorkspace` renders as visible text (interpolation `{{ artifact.title }}`), never executes. The wrapping `<title>` in stored HTML is escaped (TC-U-022).

#### TC-S-022 — Validation failures are logged without leaking full content

- **Covers**: §11.11
- **Steps / Expected**: Inspect `console.error("[ai-artifact] …")` paths and the tool service error surface; errors carry a reason string, never the full HTML payload.

---

## 6. i18n Tests (ART-012, §12.9, §15.9)

> Required keys live under `aiArtifacts.*` in `src/views/lang/{en,zh,es,fr,de,ja}.ts`:
> `preview_title, open, close, copy_html, copy_success, copy_error, not_found, unavailable, generated_by_ai, html_artifact, version_label`.

#### TC-I18N-001…TC-I18N-006 — Every language defines every key

- **Covers**: ART-012, §12.9
- **Type**: Static
- **File**: `test/vitest/utilitycode/aiArtifactI18n.test.ts`

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const LANGS = ["en", "zh", "es", "fr", "de", "ja"] as const;
const REQUIRED = [
  "preview_title",
  "open",
  "close",
  "copy_html",
  "copy_success",
  "copy_error",
  "not_found",
  "unavailable",
  "generated_by_ai",
  "html_artifact",
  "version_label",
] as const;

describe("ART-012: aiArtifacts i18n keys for all languages", () => {
  for (const lang of LANGS) {
    it(`${lang}.ts defines every required aiArtifacts key`, () => {
      const src = readFileSync(resolve(`src/views/lang/${lang}.ts`), "utf8");
      for (const key of REQUIRED) {
        expect(src, `missing ${lang}.aiArtifacts.${key}`).toContain(`${key}:`);
      }
    });
  }
});
```

> If any language is missing a key, the English fallback in the component (`t("…") || "English Text"`) keeps the app working, but the i18n rule is violated — add the translation.

---

## 7. Manual QA Scripts (§16.3)

> Run in `yarn dev`. For each, set `USER_AI_ENABLED = 'true'` so artifact creation is permitted.

### TC-M-001 — Tool is available to the model (ART-001)
1. Open AiChatV2. Ask: *"Generate a small HTML table showing 3 rows of sample campaign stats and show it in the main area."*
2. **Expected**: The assistant calls `create_html_artifact`; chat shows an artifact card; the main area opens the workspace with the rendered table.

### TC-M-002 — Artifact card appears and is compact (ART-005, §8.8)
1. After TC-M-001, inspect the chat.
2. **Expected**: A card with the title, "HTML artifact" type label, "Generated by AI", an Open button, and a copy icon. The full HTML is NOT inlined into the message bubble.

### TC-M-003 — `openImmediately` auto-opens (§15.3, ART-006)
1. Trigger artifact creation.
2. **Expected**: The workspace opens automatically without clicking Open.

### TC-M-004 — Reopen from history (ART-009, §15.5)
1. Create an artifact. Close the workspace (X). Close and reopen the conversation.
2. **Expected**: The artifact card reappears (regression ART-009). Click Open → workspace loads the stored content via `getAIArtifact`.

### TC-M-005 — Copy HTML (ART-010)
1. Click the copy icon on the card and on the workspace header.
2. **Expected**: A success toast "HTML copied."; pasting into a text editor yields the full standalone HTML.

### TC-M-006 — Revision creates a new version (ART-011, §13.3)
1. Generate "Campaign Report". Then ask: *"Make the report focus on conversion rate."*
2. **Expected**: A new artifact opens with a "Version 2" chip; the version-1 artifact remains openable from history.

### TC-M-007 — All languages (ART-012, §15.9, §16.3.7)
1. Switch the app language to zh, es, fr, de, ja one at a time.
2. **Expected**: Card, workspace header, copy/close tooltips, and error toasts are fully translated (no raw English keys). `version_label` interpolates the number.

### TC-M-008 — Validation errors surface clearly (ART-013, §15.6)
1. Convince the model to emit an artifact with an empty body or a `<script>` (or unit-test the path).
2. **Expected**: The card shows an error state; the tool result summary is "Could not create the HTML artifact." with a clear reason.

### TC-M-009 — Themes + long-title truncation (§12.7, §12.8, §15.7, §15.8)
1. Toggle dark mode. Open an artifact with a very long title.
2. **Expected**: The workspace shell stays readable in dark mode; the long title truncates with an ellipsis; layout does not overlap. Chat dock remains usable while the artifact is open.

### TC-M-010 — Malicious payloads are neutralized (§16.3.8, §15.10)
1. Generate an artifact whose body tries: `<script>localStorage.setItem('x',1)</script>`, `<img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">`, `<form>` submit, and `window.parent.postMessage`.
2. **Expected**:
   - Validation rejects the obvious ones at creation (script/form/javascript:).
   - Anything that reaches the iframe is sandboxed: no `localStorage` write, no `alert`, no parent navigation, no script execution. Confirm there is no `allow-same-origin`.

### TC-M-011 — Simple chat answer creates no artifact (§13.2, §15.2, Success Metric #2)
1. Ask: *"What is a bounce rate?"*
2. **Expected**: A plain text answer in chat. No card, no workspace opened.

### TC-M-012 — Close restores the route (§15.4, §15.1)
1. Navigate to any route (e.g., a list page). Open an artifact. Close it.
2. **Expected**: The previous route is shown again, unchanged.

---

## 8. Acceptance Criteria Mapping (§15)

| # | Criterion | Primary test cases |
|---|---|---|
| 1 | Visual report → tool call → main area shows HTML | TC-A-001 = TC-M-001 + TC-U-040 |
| 2 | Short factual question → chat, no artifact | TC-A-002 = TC-M-011 |
| 3 | `openImmediately: true` → opens automatically | TC-A-003 = TC-M-003 + TC-U-011/051 |
| 4 | Close preview → prior route visible | TC-A-004 = TC-M-012 + TC-R-040 |
| 5 | Reopen from history → stored content loads | TC-A-005 = TC-M-004 + TC-U-053 |
| 6 | Disallowed scripts/unsafe → rejected/sanitized | TC-A-006 = TC-S-001…TC-S-013 |
| 7 | Very long title → truncates, no overlap | TC-A-007 = TC-M-009 + TC-R-030 |
| 8 | Dark mode → preview shell readable | TC-A-008 = TC-M-009 |
| 9 | Any supported language → strings translated | TC-A-009 = TC-I18N-001…006 + TC-M-007 |
| 10 | Malicious artifact cannot access parent/Electron/localStorage | TC-A-010 = TC-M-010 + TC-S-020/021 |

---

## 9. Test Execution Checklist

- [ ] `test/vitest/utilitycode/aiArtifactMetadata.test.ts` green (TC-U-050…054).
- [ ] New `aiArtifactValidation.test.ts` green (TC-U-010…022).
- [ ] New `aiArtifactSecurityValidation.test.ts` green (TC-S-001…013).
- [ ] New `aiArtifactToolRegistration.test.ts` green (TC-U-001).
- [ ] New `aiArtifactToolService.test.ts` green (TC-U-040…042).
- [ ] New `aiArtifactStatic.test.ts` green (TC-R-021).
- [ ] New `aiArtifactI18n.test.ts` green (TC-I18N-001…006).
- [ ] New `aiArtifactArchitecture.test.ts` green (TC-U-031).
- [ ] Integration: create/get/list/version round-trip on temp DB (TC-I-001/002/003/004).
- [ ] Manual QA TC-M-001…TC-M-012 all pass in `yarn dev`.
- [ ] No `v-html` on artifact content anywhere (grep clean).
- [ ] No direct `getRepository`/`SqliteDb.getInstance` in artifact IPC handlers.

> When every box above is checked, every PRD requirement (ART-001…ART-014), acceptance criterion (#1–#10), and security requirement (§11) is verified as implemented.
