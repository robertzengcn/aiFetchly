# AI Chat Batch Worker Sub-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the main AI chat agent process more than 3 images (generically, more than 3 files of any supported type) in one user request by delegating bounded batches of 3 to a new generic `agent-batch-worker` sub-agent, each running as a separate AI request with its own 3-image budget, and surfacing the edited results back in the chat.

**Architecture:** The single load-bearing fix is FR-1: the sub-agent runtime (`AgentRuntime.runSync`) today discards the edited images its loop produces. We capture `result.images`, persist them to disk via the existing `AIChatGeneratedImageStorageService` (paths only, no bytes), and plumb the resulting file paths + image descriptors through `AgentResult` → `run_subagent` return. A new generic built-in `agent-batch-worker` (allowlist `glob_files`/`attach_local_images`/`file_read`) does the per-batch attach+edit. The main chat loop folds the batch workers' output images into the turn's `result.images`, so the existing engine store + render path displays them with **zero renderer changes**. No server change, no cap change, no new runtime.

**Tech Stack:** TypeScript 5.x (Electron main process), Vitest (`test/vitest/main/`), existing `AgentRuntime`/`AIChatQueryLoop`/`AIChatGeneratedImageStorageService` infrastructure.

---

## Preflight (DONE — recorded for context)

- The worktree branch `worktree-ai-chat-batch-worker-subagent` was **1321 commits behind `dev`** and had **0 unique commits**. The entire PRD dependency set (`attach_local_images`, `OpenAIChatImage`, `AIChatGeneratedImageStorageService`, `AiChatV2Message.vue` generated-image rendering, `availableAgentsBlock.ts`, the `source`/`health`/`manifest` fields on `AgentDefinitionView`) exists **only on `dev`**. ✅ Fast-forwarded the branch to `dev` (`c00964ac`) via `git reset --hard dev`. ✅ Symlinked `node_modules` → main repo (worktrees lack it). The PRD was written against `dev`'s state, so this is the correct base.

## Key facts verified on `dev` (c00964ac)

| Fact | Location |
|---|---|
| `AgentResult` has no `outputFilePaths`/`outputImages` | `src/entityTypes/agentTypes.ts:142-158` |
| `AgentTaskPacket` is hard lead-shaped (all required) | `src/entityTypes/agentTypes.ts:99-106` |
| `AgentPromptBuilder.build` forwards only 5 lead keys | `src/service/AgentPromptBuilder.ts:52-65` |
| `AgentRuntime.runSync` captures only `result.fullContent` | `src/service/AgentRuntime.ts:315-318` |
| `AgentResult` assembled | `src/service/AgentRuntime.ts:451-462` |
| `AgentRuntimeDeps` interface | `src/service/AgentRuntime.ts:78-94` |
| `run_subagent` result object | `src/service/agentTools/runSubagentTool.ts:153-164` |
| `BUILT_INS` array (1 entry) | `src/service/AgentDefinitionRegistry.ts:52-84` |
| `AIChatQueryLoopResult.completed.images?: OpenAIChatImage[]` | `src/service/AIChatQueryEvents.ts:256` |
| loop builds `images: finalAccumulator?.state.images` | `src/service/AIChatQueryLoop.ts:1600` |
| round loop obtains `toolResult` | `src/service/AIChatQueryLoop.ts:1407-1409` |
| `AIChatGeneratedImageStorageService.storeImages({conversationId,messageId,images})` returns images with `local_path` (b64 stripped) | `src/service/AIChatGeneratedImageStorageService.ts` |
| allowlist tools registered: `glob_files`, `attach_local_images`, `file_read` (1 each) | `src/config/skillsRegistry.ts` |
| `check_tool_job_status`/`cancel_tool_job` auto-injected via `MANDATORY_INFRASTRUCTURE_TOOLS` | `src/service/AgentToolPolicyService.ts` |
| engine stores `result.images` → `metadata.generatedImages` | `src/service/AIChatQueryEngine.ts:1326-1353` |
| renderer reads `metadata.generatedImages` (existing keys reuse) | `src/views/components/aiChatV2/AiChatV2Message.vue:365-386` |

**Stale-premise corrections to the PRD (do NOT follow the PRD literally here):**
- PRD agent-definition table lists `source`/`health` — these DO exist on `dev`'s `AgentDefinitionView` (lines 69/73); set them to `"built-in"`/`"healthy"`. Also add `manifest: {}` (line 72).
- PRD says `check_tool_job_status` reads "persisted AgentResult" — **false**: it reads the in-memory `ToolJobRegistry` snapshot. `outputFilePaths`/`outputImages` reach it automatically because they ride on the same resolved job result that `run_subagent` returns; no extra work.
- PRD says `AgentPromptBuilder` formats `{files, instruction}` — **false as written**: it hardcodes 5 lead keys. Task 2 generalizes it.
- PRD FR-7 (i18n): the feature introduces **no new hardcoded user-facing strings** (rendering reuses existing `aiChatV2.generated_image_alt`/`open_generated_image`; batch reporting is LLM-generated text). FR-7 is satisfied by reuse — see Task 9's verification.

---

## Task 1: Add output fields to `AgentResult` + generalize `AgentTaskPacket`

**Files:**
- Modify: `src/entityTypes/agentTypes.ts` (top import + `AgentTaskPacket:99-106` + `AgentResult:142-158`)

This is a pure type change; it is covered by the runtime/prompt tests in Tasks 2 & 3. No standalone test.

- [ ] **Step 1: Add the `OpenAIChatImage` type import**

At the top of `src/entityTypes/agentTypes.ts`, after the existing header comment, add:

```typescript
import type { OpenAIChatImage } from "@/api/aiChatApi";
```

- [ ] **Step 2: Generalize `AgentTaskPacket`**

Replace the `AgentTaskPacket` interface (lines 98-106):

```typescript
/** Self-contained task packet handed to a specialist agent.
 *
 * The lead-researcher family fields are optional so generic agents — e.g.
 * the batch worker, which carries `{ files, instruction }` — can reuse the
 * same packet type without lead-shaped boilerplate. Unknown keys are dropped
 * by JSON.stringify when forwarded by AgentPromptBuilder. */
export interface AgentTaskPacket {
  workflowRunId?: string;
  lead?: LeadInput;
  userGoal?: string;
  constraints?: AgentWorkflowConstraints;
  priorFindings?: AgentFinding[];
  requiredOutputSchema?: Record<string, unknown>;
  /** Generic file-batch family: candidate file paths + the single instruction
   * to apply to every file. Used by agent-batch-worker. The main agent caps
   * this at 3 entries before spawning (matches attach_local_images maxItems). */
  files?: string[];
  instruction?: string;
}
```

- [ ] **Step 3: Add `outputFilePaths` + `outputImages` to `AgentResult`**

In the `AgentResult` interface, after the `parseWarning?: string;` field (line 157), add:

```typescript
  /** On-disk paths of artifacts (e.g. edited images) produced by the agent.
   * Paths only — NEVER image bytes (PRD non-goal 8). Populated by
   * AgentRuntime when the sub-agent's loop returns edited images that get
   * persisted to local storage. Undefined for agents that produce no files. */
  outputFilePaths?: string[];
  /** Persisted artifact image descriptors mirroring {@link outputFilePaths}
   * (each carries `local_path` + the `aifetchly-generated-image://` URL, no
   * bytes). Surfaced so the main chat loop can fold them into
   * metadata.generatedImages for rendering. Undefined for agents that
   * produce no images. */
  outputImages?: OpenAIChatImage[];
```

- [ ] **Step 4: Commit**

```bash
git add src/entityTypes/agentTypes.ts
git commit -m "feat(agent-types): add outputFilePaths/outputImages to AgentResult; generalize AgentTaskPacket"
```

---

## Task 2: Generalize `AgentPromptBuilder` to forward the full task packet

**Files:**
- Test: `test/vitest/main/AgentPromptBuilder.test.ts` (Create)
- Modify: `src/service/AgentPromptBuilder.ts:52-65`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/AgentPromptBuilder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentPromptBuilder } from "@/service/AgentPromptBuilder";
import type { AgentDefinitionView, AgentTaskPacket } from "@/entityTypes/agentTypes";

const baseDefinition = (overrides: Partial<AgentDefinitionView> = {}): AgentDefinitionView => ({
  id: "agent-batch-worker",
  name: "Batch Worker",
  description: "test",
  version: 1,
  systemPrompt: "You are the Batch Worker.",
  allowedTools: ["attach_local_images"],
  mode: "specialist",
  maxToolCalls: 6,
  maxRuntimeMs: 240000,
  maxContinueCalls: 4,
  outputSchema: { type: "object", required: ["status"], properties: { status: { type: "string" } } },
  status: "active",
  source: "built-in",
  health: "healthy",
  manifest: {},
  ...overrides,
});

describe("AgentPromptBuilder", () => {
  it("forwards a generic batch-worker packet {files, instruction} into the user message", () => {
    const builder = new AgentPromptBuilder();
    const packet: AgentTaskPacket = {
      files: ["/ws/a.png", "/ws/b.png", "/ws/c.png"],
      instruction: "make the background white",
    };
    const { userMessage } = builder.build({ definition: baseDefinition(), packet });
    const parsed = JSON.parse(userMessage.content) as Record<string, unknown>;
    expect(parsed.files).toEqual(["/ws/a.png", "/ws/b.png", "/ws/c.png"]);
    expect(parsed.instruction).toBe("make the background white");
    // schema is still attached so the model sees the output contract
    expect(parsed.requiredOutputSchema).toBeDefined();
  });

  it("still forwards lead-researcher packets unchanged in shape", () => {
    const builder = new AgentPromptBuilder();
    const packet: AgentTaskPacket = {
      lead: { companyName: "Acme" },
      userGoal: "enrich",
      constraints: {},
      priorFindings: [],
      requiredOutputSchema: { type: "object" },
    };
    const { userMessage } = builder.build({ definition: baseDefinition(), packet });
    const parsed = JSON.parse(userMessage.content) as Record<string, unknown>;
    expect(parsed.lead).toEqual({ companyName: "Acme" });
    expect(parsed.userGoal).toBe("enrich");
  });

  it("injects the output schema reinforcement into the system message", () => {
    const builder = new AgentPromptBuilder();
    const { systemMessage } = builder.build({
      definition: baseDefinition(),
      packet: { files: ["/ws/a.png"], instruction: "x" },
    });
    expect(systemMessage.content).toContain("Output format (MANDATORY)");
    expect(systemMessage.content).toContain("NO markdown fences");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- AgentPromptBuilder 2>&1 | tail -30` (vitest filters by name pattern)
Expected: FAIL — `parsed.files` is undefined because the current builder only forwards lead keys.

- [ ] **Step 3: Generalize the builder**

In `src/service/AgentPromptBuilder.ts`, replace the `userMessage` construction (lines 51-65) inside `build()`:

```typescript
    // Forward the FULL task packet so any agent family — lead-researcher
    // ({lead,userGoal,constraints,...}) or batch-worker ({files,instruction})
    // — receives its packet verbatim. JSON.stringify drops undefined-valued
    // keys, so the message stays clean. The resolved output schema is attached
    // explicitly so the model always sees the output contract regardless of
    // whether the packet carried requiredOutputSchema.
    const userMessage: AgentPromptMessage = {
      role: "user",
      content: JSON.stringify(
        { ...input.packet, requiredOutputSchema: schema },
        null,
        2
      ),
    };
```

Leave the `schema` / `schemaReinforcement` / `systemMessage` blocks above it untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn testmain -- AgentPromptBuilder 2>&1 | tail -30`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/AgentPromptBuilder.ts test/vitest/main/AgentPromptBuilder.test.ts
git commit -m "feat(agent-prompt-builder): forward full task packet so generic agents receive their fields"
```

---

## Task 3: Plumb edited images through `AgentRuntime.runSync` (FR-1 — the enabler)

**Files:**
- Test: `test/vitest/main/AgentRuntimeBatchImages.test.ts` (Create)
- Modify: `src/service/AgentRuntime.ts` (imports + `AgentRuntimeDeps:78-94` + runSync capture/persist/populate)

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/AgentRuntimeBatchImages.test.ts`. This test stubs the loop dep so `runSync` receives a controlled `AIChatQueryLoopResult`, and injects a fake storage service.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAIChatImage } from "@/api/aiChatApi";

// Heavy modules are mocked so AgentRuntime imports cleanly under vitest.
vi.mock("@/service/ToolTimeoutPolicy", () => ({
  inferTimeoutClassByName: () => "fast" as const,
  resolveTimeoutMs: () => 50,
  TOOL_TIMEOUT_POLICY: { fast: 50, network: 90_000, browser: 240_000 },
}));
vi.mock("@/service/AIAutoDreamFactory", () => ({
  getSharedAutoDreamService: () => undefined,
  getSharedWorkspaceAutoDreamService: () => undefined,
}));

const storedImages: OpenAIChatImage[] = [];
const fakeStorage = {
  storeImages: vi.fn(async (): Promise<OpenAIChatImage[]> => storedImages),
};

async function loadRuntime() {
  const mod = await import("@/service/AgentRuntime");
  return new mod.AgentRuntime();
}

describe("AgentRuntime.runSync image plumbing", () => {
  beforeEach(() => {
    storedImages.length = 0;
    fakeStorage.storeImages.mockClear();
  });

  it("captures loop result.images, persists them, and returns outputFilePaths + outputImages", async () => {
    // After storage, images carry local_path + protocol URL, no bytes.
    const persisted: OpenAIChatImage[] = [
      {
        type: "image",
        delivery: "local_file",
        url: "aifetchly-generated-image://local/u/conv/msg/image-1.png",
        local_path: "/userData/ai-chat-generated-images/u/conv/msg/image-1.png",
        file_name: "image-1.png",
        mime_type: "image/png",
      },
    ];
    storedImages.push(...persisted);

    const runtime = await loadRuntime();
    const result = await runtime.runSync(
      {
        agentId: "agent-batch-worker",
        prompt: "make the background white",
        taskPacket: { files: ["/ws/a.png"], instruction: "make the background white" },
        executionMode: "foreground",
      },
      {
        generatedImageStorage: fakeStorage,
        streamChatCompletion: (async function* () {
          /* not used — loop is bypassed below */
        })() as never,
      } as never
    );
    void result;
  });
});
```

**NOTE on test strategy:** `runSync` constructs and calls `AIChatQueryLoop.run` internally; fully driving the loop is heavy. The concrete, robust assertion is added in Step 3 after reading the current runSync. If wiring a fake loop is impractical, fall back to a focused unit test on the new `persistAgentImages` helper extracted in Step 3 (see note there): assert that given `images` + a fake storage, it returns `{ outputFilePaths, outputImages }`, and given empty images returns `{ undefined, undefined }`. The helper is the testable seam. Prefer the helper test if the full runSync harness is too heavy — the goal is coverage of the new logic, not the loop.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- AgentRuntimeBatchImages 2>&1 | tail -40`
Expected: FAIL — no `generatedImageStorage` dep, no `outputFilePaths`/`outputImages`, helper does not exist yet.

- [ ] **Step 3: Implement the plumbing**

(a) Add imports near the top of `src/service/AgentRuntime.ts` (after line 9 `import { AiChatApi }`):

```typescript
import { AIChatGeneratedImageStorageService } from "@/service/AIChatGeneratedImageStorageService";
import type { OpenAIChatImage } from "@/api/aiChatApi";
```

(b) Add the storage seam to `AgentRuntimeDeps` (inside the interface at lines 78-94, after `workspaceAutoDreamService?`):

```typescript
  /** Optional. Persists generated images (e.g. a batch worker's edited
   * outputs) to disk so their file paths can be returned without carrying
   * bytes. Defaults to AIChatGeneratedImageStorageService when images are
   * present. */
  generatedImageStorage?: {
    storeImages(input: {
      conversationId: string;
      messageId: string;
      images: OpenAIChatImage[];
    }): Promise<OpenAIChatImage[]>;
  };
```

(c) Declare the captured-images accumulator alongside `finalText` (line 288 area):

```typescript
    let finalText = "";
    let capturedImages: OpenAIChatImage[] | undefined;
```

(d) In the completed branch (line 317-318), capture images:

```typescript
      if (result.type === "completed") {
        finalText = result.fullContent;
        capturedImages = result.images;
      } else if (result.type === "cancelled") {
```

(e) Insert the persistence block immediately BEFORE `const result: AgentResult = {` (line 451) — i.e. right after the parse if/else ends at line 449. Extract it as a module-level helper so it is unit-testable:

Add this helper near the bottom of the file (after the class, as a module-private function):

```typescript
/**
 * Persist a sub-agent's edited images to local storage and derive the path/
 * descriptor outputs for {@link AgentResult}. Bytes are never persisted —
 * storage strips b64_json and returns local_path + protocol URL descriptors.
 * Returns `{ undefined, undefined }` when there are no images or storage
 * fails (failure is logged and swallowed so an image-storage hiccup never
 * fails an otherwise-successful agent task).
 */
export async function persistAgentImages(input: {
  images?: OpenAIChatImage[];
  conversationId: string;
  messageId: string;
  storage: {
    storeImages(payload: {
      conversationId: string;
      messageId: string;
      images: OpenAIChatImage[];
    }): Promise<OpenAIChatImage[]>;
  };
}): Promise<{ outputFilePaths?: string[]; outputImages?: OpenAIChatImage[] }> {
  if (!input.images || input.images.length === 0) {
    return {};
  }
  try {
    const stored = await input.storage.storeImages({
      conversationId: input.conversationId,
      messageId: input.messageId,
      images: input.images,
    });
    const outputImages = stored.length > 0 ? stored : undefined;
    const paths = outputImages
      ?.map((img) => img.local_path)
      .filter((p): p is string => typeof p === "string");
    const outputFilePaths =
      paths && paths.length > 0 ? paths : undefined;
    return { outputFilePaths, outputImages };
  } catch (err) {
    console.warn(
      `[agent-runtime] failed to store generated images for ${input.conversationId}/${input.messageId}:`,
      err
    );
    return {};
  }
}
```

(f) Call the helper inside `runSync` before the `AgentResult` literal (line 451). Insert:

```typescript
    const { outputFilePaths, outputImages } = await persistAgentImages({
      images: capturedImages,
      conversationId: agentConversationId,
      messageId: `agent-assistant-${agentTaskId}`,
      storage:
        deps?.generatedImageStorage ?? new AIChatGeneratedImageStorageService(),
    });
```

(g) Add the two fields to the `AgentResult` literal (after `...(parseWarning ? { parseWarning } : {})`, line 461):

```typescript
      ...(outputFilePaths ? { outputFilePaths } : {}),
      ...(outputImages ? { outputImages } : {}),
```

**If the full runSync harness in Step 1 is impractical**, replace the test body with a direct test of `persistAgentImages`:

```typescript
import { persistAgentImages } from "@/service/AgentRuntime";

it("persistAgentImages returns paths + descriptors when storage succeeds", async () => {
  const out = await persistAgentImages({
    images: [{ type: "image", b64_json: "x" }],
    conversationId: "c",
    messageId: "m",
    storage: { storeImages: async () => [
      { type: "image", delivery: "local_file", local_path: "/p/image-1.png",
        url: "aifetchly-generated-image://local/u/c/m/image-1.png", mime_type: "image/png" },
    ] },
  });
  expect(out.outputFilePaths).toEqual(["/p/image-1.png"]);
  expect(out.outputImages?.[0]?.local_path).toBe("/p/image-1.png");
});

it("persistAgentImages returns undefined for no images and swallows storage errors", async () => {
  expect(await persistAgentImages({ images: [], conversationId: "c", messageId: "m", storage: { storeImages: async () => [] } })).toEqual({});
  const failing = { storeImages: async () => { throw new Error("disk full"); } };
  expect(await persistAgentImages({ images: [{ type: "image" }], conversationId: "c", messageId: "m", storage: failing })).toEqual({});
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn testmain -- AgentRuntimeBatchImages 2>&1 | tail -40`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AgentRuntime.ts test/vitest/main/AgentRuntimeBatchImages.test.ts
git commit -m "feat(agent-runtime): capture+persist sub-agent edited images to outputFilePaths/outputImages"
```

---

## Task 4: Forward outputs in the `run_subagent` tool result

**Files:**
- Test: `test/vitest/main/runSubagentTool.test.ts` (Create)
- Modify: `src/service/agentTools/runSubagentTool.ts:153-164`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/runSubagentTool.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the runtime registry so run_subagent returns a controlled AgentResult
// without spawning a real sub-agent.
vi.mock("@/service/AgentRuntimeRegistry", () => {
  let fakeResult: unknown = { status: "completed", agentTaskId: "agt-1", agentId: "agent-batch-worker", output: {}, sourceUrls: [], confidence: 0.5 };
  return {
    AgentRuntimeRegistry: {
      getRuntime: () => ({ runSync: async () => fakeResult }),
    },
    getDefaultAgentRuntimeDeps: () => ({}),
    __setFakeResult: (r: unknown) => {
      fakeResult = r;
    },
  };
});

import { RUN_SUBAGENT_TOOL } from "@/service/agentTools/runSubagentTool";
// @ts-expect-error -- access test-only setter on the mock
import { __setFakeResult } from "@/service/AgentRuntimeRegistry";

const ctx = { conversationId: "conv-1" } as never;

describe("run_subagent result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes outputFilePaths + outputImages when the agent produced files", async () => {
    __setFakeResult({
      status: "completed",
      agentTaskId: "agt-1",
      agentId: "agent-batch-worker",
      output: { status: "completed" },
      sourceUrls: [],
      confidence: 0.9,
      outputFilePaths: ["/p/image-1.png", "/p/image-2.png"],
      outputImages: [
        { type: "image", local_path: "/p/image-1.png", url: "aifetchly-generated-image://local/u/c/m/image-1.png", mime_type: "image/png" },
      ],
    });
    const res = await RUN_SUBAGENT_TOOL.execute?.(
      { agentId: "agent-batch-worker", prompt: "edit", taskPacket: { files: ["/p/a.png"], instruction: "white bg" } },
      ctx
    );
    expect(res?.success).toBe(true);
    expect(res?.result.outputFilePaths).toEqual(["/p/image-1.png", "/p/image-2.png"]);
    expect(res?.result.outputImages).toHaveLength(1);
  });

  it("omits output fields when the agent produced none (success false on failure)", async () => {
    __setFakeResult({ status: "failed", agentTaskId: "agt-2", agentId: "agent-batch-worker", output: {}, sourceUrls: [], errorMessage: "boom" });
    const res = await RUN_SUBAGENT_TOOL.execute?.(
      { agentId: "agent-batch-worker", prompt: "edit", taskPacket: { files: [], instruction: "x" } },
      ctx
    );
    expect(res?.success).toBe(false);
    expect(res?.result.error).toBe("boom");
    expect(res?.result.outputFilePaths).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- runSubagentTool 2>&1 | tail -30`
Expected: FAIL — `result.outputFilePaths` is undefined.

- [ ] **Step 3: Forward the fields**

In `src/service/agentTools/runSubagentTool.ts`, add the two fields to the returned `result` object (lines 155-163), after `error: result.errorMessage,`:

```typescript
        outputFilePaths: result.outputFilePaths,
        outputImages: result.outputImages,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn testmain -- runSubagentTool 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/agentTools/runSubagentTool.ts test/vitest/main/runSubagentTool.test.ts
git commit -m "feat(run-subagent): include outputFilePaths/outputImages in the returned result"
```

---

## Task 5: Register the `agent-batch-worker` built-in agent (FR-2)

**Files:**
- Test: `test/vitest/main/AgentDefinitionRegistry.test.ts` (Create)
- Modify: `src/service/AgentDefinitionRegistry.ts` (constants + `BUILT_INS:52-84`)

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/AgentDefinitionRegistry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentDefinitionRegistry } from "@/service/AgentDefinitionRegistry";

describe("AgentDefinitionRegistry built-ins", () => {
  it("exposes agent-batch-worker with the PRD allowlist + output schema", () => {
    const def = AgentDefinitionRegistry.getById("agent-batch-worker");
    expect(def).not.toBeNull();
    expect(def?.name).toBe("Batch Worker");
    expect(def?.mode).toBe("specialist");
    expect(def?.source).toBe("built-in");
    expect(def?.health).toBe("healthy");
    expect(def?.maxRuntimeMs).toBe(240000);
    // file-handling tools; infra tools (check_tool_job_status/cancel_tool_job)
    // are auto-injected by AgentToolPolicyService, not declared here.
    expect(def?.allowedTools).toEqual(["glob_files", "attach_local_images", "file_read"]);
    const schema = def?.outputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(["status", "processedFiles", "summary", "errors"]);
    expect(schema.properties).toHaveProperty("processedFiles");
  });

  it("still exposes agent-lead-researcher (no regression)", () => {
    expect(AgentDefinitionRegistry.getById("agent-lead-researcher")?.id).toBe("agent-lead-researcher");
  });

  it("lists both built-ins", () => {
    const ids = AgentDefinitionRegistry.list().map((a) => a.id);
    expect(ids).toContain("agent-lead-researcher");
    expect(ids).toContain("agent-batch-worker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- AgentDefinitionRegistry 2>&1 | tail -30`
Expected: FAIL — `getById("agent-batch-worker")` returns null.

- [ ] **Step 3: Add the prompt + schema constants**

In `src/service/AgentDefinitionRegistry.ts`, after `LEAD_RESEARCHER_OUTPUT_SCHEMA` (line 50), add:

```typescript
const BATCH_WORKER_PROMPT = `You are the Batch Worker specialist.
Your single responsibility is to process a batch of up to 3 files according to the instruction in the task packet.

Rules:
1. Read the file paths from "files" and the instruction from "instruction" in the task packet.
2. Call attach_local_images with the given file paths (up to 3).
3. The AI server edits each image independently and returns the edited results.
4. Do not ask questions. Do not deviate from the instruction.
5. Do not call run_subagent (nested batch workers are not allowed).
6. If a file fails, record its path in "errors" with the reason and continue with the others.
7. If attach_local_images returns an error, report it in "errors" and return a partial result with an empty "processedFiles" list.
8. Your ENTIRE response MUST be a single raw JSON object — no markdown fences, no prose before or after.`;

const BATCH_WORKER_OUTPUT_SCHEMA = {
  type: "object",
  required: ["status", "processedFiles", "summary", "errors"],
  properties: {
    status: { type: "string", enum: ["completed", "partial", "failed"] },
    processedFiles: {
      type: "array",
      items: { type: "string" },
      description: "File paths of successfully processed output files on disk.",
    },
    summary: { type: "string", description: "One-sentence summary of what was done." },
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};
```

- [ ] **Step 4: Add the entry to `BUILT_INS`**

Add a second element to the `BUILT_INS` array (after the lead-researcher entry's closing `},` at line 83, before the closing `]` at line 84):

```typescript
  {
    id: "agent-batch-worker",
    name: "Batch Worker",
    description:
      "Processes a batch of up to 3 files (images, audio, documents) according to one instruction. Returns output file paths.",
    version: 1,
    systemPrompt: BATCH_WORKER_PROMPT,
    // Generic file-batch allowlist. AgentToolPolicyService intersects
    // these with registered skills and auto-injects check_tool_job_status /
    // cancel_tool_job. Future batch job types (audio, docs, thumbnails) need
    // only an allowlist addition here — no new runtime, no new agent.
    allowedTools: ["glob_files", "attach_local_images", "file_read"],
    mode: "specialist",
    maxToolCalls: 6,
    maxRuntimeMs: 240000,
    maxContinueCalls: 4,
    outputSchema: BATCH_WORKER_OUTPUT_SCHEMA,
    status: "active",
    source: "built-in",
    health: "healthy",
    manifest: {},
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn testmain -- AgentDefinitionRegistry 2>&1 | tail -30`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/service/AgentDefinitionRegistry.ts test/vitest/main/AgentDefinitionRegistry.test.ts
git commit -m "feat(agent-registry): register generic agent-batch-worker built-in"
```

---

## Task 6: Teach the main agent the delegation pattern (FR-3)

**Files:**
- Modify: `src/config/skillsRegistry.ts` (the `attach_local_images` `description`, ~lines 152-167) and `src/service/agentTools/runSubagentTool.ts` (`description`, lines 115-119)

No automated test (description text). Verify via the typecheck gate + manual read.

- [ ] **Step 1: Update `attach_local_images` description**

In `src/config/skillsRegistry.ts`, find the `attach_local_images` skill and replace its `description` string. The current description tells the model to "attach the first 3, wait, then call again with the next batch" — but the server ends the turn after editing, so a same-turn follow-up never runs. Replace the batching paragraph with the delegation pattern. Keep the tool-purpose opening and the format/permission tail. New `description`:

```typescript
    description:
      "REQUIRED for analyzing or editing local workspace images (change background color, " +
      "make background white, remove background, product photo edits, compare images, visual Q&A). " +
      "After glob_files finds image paths, call this tool with exact paths — do NOT use " +
      "shell_execute, Python, Pillow/PIL, ImageMagick, or file_read for image editing. " +
      "HARD LIMIT: at most 3 images per call and per AI request. " +
      "WHEN MORE THAN 3 files need the same edit, do NOT try to attach the next batch yourself within this turn — the AI server ends the turn after editing a batch, so a follow-up attach_local_images call in the same turn will not run. " +
      "Instead, delegate each batch: call run_subagent once per batch of up to 3 paths with agentId 'agent-batch-worker', passing { files: [<up to 3 paths>], instruction: <the edit> } as the taskPacket, and poll each job with check_tool_job_status. " +
      "Each batch worker attaches + edits its own batch under its own 3-image budget and returns the output file paths. " +
      "Only PNG, JPEG, WebP, and GIF are supported. Transfers prepared image content to the " +
      "configured AI server after the user grants permission.",
```

- [ ] **Step 2: Update `run_subagent` description**

In `src/service/agentTools/runSubagentTool.ts`, extend the existing `description` (lines 115-119) to mention batch file processing. Append one sentence (keep the async/poll/cancel guidance already present):

```typescript
  description:
    "Run a built-in marketing specialist agent (e.g. lead researcher) and return its structured result. Use this to delegate a focused research/enrichment task to a specialist with its own narrowed tools. " +
    "Also use it to process batches of files in parallel when a single request is capped — e.g. agent-batch-worker edits up to 3 images per batch (its own 3-image budget) and returns output file paths; spawn one run_subagent per batch of up to 3 paths. " +
    "This tool ALWAYS runs ASYNCHRONOUSLY: it returns { async: true, job_id } within ~2 seconds and continues working in the background. " +
    "Poll the result with check_tool_job_status(job_id) every 15-30 seconds until status is 'completed' or 'failed'. " +
    "Do not call run_subagent again while a job is running. Use cancel_tool_job(job_id) if the user wants to stop the specialist early.",
```

- [ ] **Step 3: Typecheck**

Run: `yarn tsc-result 2>&1 | tail -20`
Expected: no NEW errors (string edits only). If pre-existing errors appear, confirm they are unrelated.

- [ ] **Step 4: Commit**

```bash
git add src/config/skillsRegistry.ts src/service/agentTools/runSubagentTool.ts
git commit -m "feat(ai-tools): teach main agent the batch-worker delegation pattern for >3 images"
```

---

## Task 7: Render batch-edited images in the chat via loop harvest (FR-4)

**Files:**
- Test: `test/vitest/main/AIChatQueryLoopToolImageHarvest.test.ts` (Create)
- Modify: `src/service/AIChatQueryLoop.ts` (declare accumulator; harvest after `toolResult` at ~1409; merge at line 1600)

The renderer already reads `metadata.generatedImages`; the engine already stores `result.images` there. So the whole task is: make the loop fold `run_subagent`'s `outputImages` into the turn's `result.images`. No `.vue` change.

- [ ] **Step 1: Read the exact harvest site**

Run: `grep -n "executePreparedToolWithTimeout\|const toolResult\|role: \"tool\"" src/service/AIChatQueryLoop.ts | sed -n '1,20p'`
Confirm the `const toolResult = ...(await this.executePreparedToolWithTimeout(input, preparedCall));` line (around 1407-1409) and the `role: "tool"` message push that follows it (around 1491). The harvest inserts between them. Also locate the round-loop's opening (`for (let round =`) to place the accumulator declaration just inside it, before any `continue`.

- [ ] **Step 2: Write the failing test**

Create `test/vitest/main/AIChatQueryLoopToolImageHarvest.test.ts`. Rather than drive the full loop (very heavy), test the new pure helper `mergeToolResultImages` (extracted in Step 3) and assert the loop's completed-result merge uses it. If a focused loop integration test is feasible with the existing AIChatQueryLoopCancellation.test.ts mocking pattern, add it; otherwise the helper test is the contract.

```typescript
import { describe, it, expect } from "vitest";
import { mergeToolResultImages } from "@/service/AIChatQueryLoop";
import type { OpenAIChatImage } from "@/api/aiChatApi";

const img = (path: string): OpenAIChatImage => ({
  type: "image",
  delivery: "local_file",
  local_path: path,
  url: `aifetchly-generated-image://local/u/c/m/${path}`,
  mime_type: "image/png",
});

describe("mergeToolResultImages (FR-4 harvest)", () => {
  it("appends tool-result outputImages onto the stream images", () => {
    const stream: OpenAIChatImage[] = [img("/s1.png")];
    const out = mergeToolResultImages(stream, [
      { result: { outputImages: [img("/b1.png"), img("/b2.png")] } },
      { result: {} },
      { result: { outputImages: "not-an-array" } },
    ] as never);
    expect(out.map((i) => i.local_path)).toEqual(["/s1.png", "/b1.png", "/b2.png"]);
  });

  it("handles no stream images and no tool images", () => {
    expect(mergeToolResultImages(undefined, [])).toEqual([]);
    expect(mergeToolResultImages([], [{ result: {} }] as never)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn testmain -- AIChatQueryLoopToolImageHarvest 2>&1 | tail -30`
Expected: FAIL — `mergeToolResultImages` is not exported.

- [ ] **Step 4: Add the helper + accumulator + harvest + merge**

(a) Add a module-private helper near the other module-private helpers in `src/service/AIChatQueryLoop.ts`:

```typescript
/**
 * Fold tool-result images (e.g. a run_subagent batch worker's edited
 * outputs) onto the stream's own images to form the turn's complete
 * `result.images`. Only well-formed `outputImages` arrays on tool results
 * are appended; everything else is ignored. Dedup is the engine's job.
 */
export function mergeToolResultImages(
  streamImages: OpenAIChatImage[] | undefined,
  toolResults: ReadonlyArray<{ result?: { outputImages?: unknown } }>
): OpenAIChatImage[] {
  const out: OpenAIChatImage[] = [...(streamImages ?? [])];
  for (const tr of toolResults) {
    const maybe = tr?.result?.outputImages;
    if (!Array.isArray(maybe)) continue;
    for (const img of maybe) {
      if (img && typeof img === "object") {
        out.push(img as OpenAIChatImage);
      }
    }
  }
  return out;
}
```

(Ensure `OpenAIChatImage` is imported at the top of the file — add `import type { OpenAIChatImage } from "@/api/aiChatApi";` if not already present.)

(b) Declare a turn-level accumulator inside `run()`, just inside the round loop (before the first `continue`), found in Step 1:

```typescript
      const collectedToolImages: OpenAIChatImage[] = [];
      const completedToolResults: Array<{ result?: { outputImages?: unknown } }> = [];
```

(c) After `const toolResult = ...(await this.executePreparedToolWithTimeout(input, preparedCall));` (around 1407-1409), harvest:

```typescript
              completedToolResults.push(toolResult as never);
              const maybeOut = (toolResult as { result?: { outputImages?: unknown } })?.result?.outputImages;
              if (Array.isArray(maybeOut)) {
                for (const im of maybeOut) {
                  if (im && typeof im === "object") collectedToolImages.push(im as OpenAIChatImage);
                }
              }
```

(d) Replace the completed-return `images` field (line 1600):

```typescript
        images: mergeToolResultImages(finalAccumulator?.state.images, completedToolResults),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn testmain -- AIChatQueryLoopToolImageHarvest 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 6: Run the full vitest suite to confirm no loop regressions**

Run: `yarn testmain 2>&1 | tail -40`
Expected: all green (any pre-existing failures must be confirmed pre-existing — see memory `skillexecutor-preexisting-test-failures`).

- [ ] **Step 7: Commit**

```bash
git add src/service/AIChatQueryLoop.ts test/vitest/main/AIChatQueryLoopToolImageHarvest.test.ts
git commit -m "feat(ai-chat-loop): fold run_subagent output images into the turn result for rendering"
```

---

## Task 8: Verify failure isolation + cancellation (FR-5, FR-6)

These are satisfied by the existing async-job infrastructure: each `run_subagent` is an independent `ToolJobRegistry` job; `cancel_tool_job` already cancels them. Verify + add a regression assertion.

**Files:**
- Test: `test/vitest/main/runSubagentTool.test.ts` (Extend — the failure case in Task 4 already covers FR-5's "failed batch returns failure without throwing"; add a cancelled-status assertion here)

- [ ] **Step 1: Extend the run_subagent test with a cancelled case (FR-6)**

Add to `test/vitest/main/runSubagentTool.test.ts`:

```typescript
  it("surfaces a cancelled sub-agent as success=false with status cancelled (FR-6)", async () => {
    __setFakeResult({ status: "cancelled", agentTaskId: "agt-3", agentId: "agent-batch-worker", output: {}, sourceUrls: [] });
    const res = await RUN_SUBAGENT_TOOL.execute?.(
      { agentId: "agent-batch-worker", prompt: "edit", taskPacket: { files: ["/p/a.png"], instruction: "x" } },
      ctx
    );
    expect(res?.success).toBe(false);
    expect(res?.result.status).toBe("cancelled");
  });
```

- [ ] **Step 2: Run the test**

Run: `yarn testmain -- runSubagentTool 2>&1 | tail -30`
Expected: PASS (the cancelled status is forwarded from the existing buildResult path; no code change needed).

- [ ] **Step 3: Document FR-5/FR-6 behavioral guarantees**

FR-5 (failure isolation) and FR-6 (cancellation) require NO new production code:
- FR-5: each batch is a separate `run_subagent` job; a failed batch yields `success:false` + `error` while sibling jobs continue independently. The main agent (LLM) reports per-batch outcomes and can retry a failed batch by spawning a new `run_subagent` for just those paths.
- FR-6: `cancel_tool_job(job_id)` cancels any pending batch job via the existing `ToolJobRegistry`; the runtime's abort controller fires → the loop returns `cancelled` → `run_subagent` returns `status:"cancelled"`.

- [ ] **Step 4: Commit**

```bash
git add test/vitest/main/runSubagentTool.test.ts
git commit -m "test(run-subagent): cover cancelled-status forwarding (FR-6) and failure isolation (FR-5)"
```

---

## Task 9: Internationalization verification (FR-7)

- [ ] **Step 1: Grep for any new user-facing string**

Run: `git diff dev -- 'src/views/**' 'src/**/*.vue'` and `grep -rn "batch" src/views/lang/`
Expected: no new hardcoded renderer strings introduced by this feature. The batch images render via the EXISTING keys `aiChatV2.generated_image_alt` and `aiChatV2.open_generated_image` (already present in all 6 lang files). Batch progress/failure text is generated by the main agent LLM, not hardcoded.

- [ ] **Step 2: If (and only if) Step 1 reveals a new user-facing string**, add it to all six files (`src/views/lang/{en,zh,es,fr,de,ja}.ts`) under the `aiChatV2` section, English as fallback. Per the expected design there should be none.

- [ ] **Step 3: Record outcome**

If no new strings: FR-7 satisfied by reuse; no commit needed. State this in the final summary.

---

## Task 10: Final verification + typecheck gate

- [ ] **Step 1: One-shot TypeScript typecheck (the vitest gate runs this too)**

Run: `AIFETCHLY_SKIP_TSC=0 yarn testmain 2>&1 | tail -50`
Expected: typecheck passes; all new + existing vitest tests green. (Do NOT commit code that needs `AIFETCHLY_SKIP_TSC=1`.)

- [ ] **Step 2: One-shot vue-tsc (renderer type safety)**

Run: `npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: no new errors (no `.vue` changed; sanity check).

- [ ] **Step 3: Confirm `agent-batch-worker` would appear in the available-agents block**

`AIChatContextAssembler` calls `AgentDefinitionModule().listActiveForRuntime()` and formats via `buildAvailableAgentsBlock` (which reads `agent.source` → "Built-in"). Since Task 5 added the agent to `BUILT_INS` (source `"built-in"`, status `"active"`, health `"healthy"`), and `ensureBuiltIns` seeds the DB from `listBuiltIns()`, the main model will see:

```
agent-batch-worker — Processes a batch of up to 3 files ... [Built-in]
```

No code change needed beyond Task 5. Verify by reading `src/service/aifetchlyConfig/availableAgentsBlock.ts` if unsure.

- [ ] **Step 4: Final summary commit (if any cleanup)**

Only if there are uncommitted trailing changes. Otherwise the per-task commits already capture everything.

---

## Self-Review (completed)

- **Spec coverage:** FR-1 → Tasks 1,3,4. FR-2 → Tasks 1,2,5 (generalized packet/builder are FR-2's genericity enabler). FR-3 → Task 6. FR-4 → Task 7. FR-5/6 → Task 8. FR-7 → Task 9. All 9 PRD goals addressed.
- **Placeholder scan:** each step has concrete code or an exact command. The two "read the exact line then insert" sites (Task 3 persistence block, Task 7 harvest) give candidate line numbers + the precise insertion text; the implementer confirms the anchor line at edit time.
- **Type consistency:** `outputFilePaths?: string[]` and `outputImages?: OpenAIChatImage[]` are used identically in agentTypes, AgentRuntime, runSubagentTool, and the loop harvest. `AgentTaskPacket.files`/`instruction` match the batch worker prompt + the test packet.
