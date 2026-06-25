# AI Tool Call Timeout Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate spurious `search_maps_businesses` timeouts and add a per-tool-class timeout policy, streaming progress + partial results, and an async job pattern for multi-minute browser-automation tools in `ai-chat-v2`.

**Architecture:** Three coordinated phases shipped in order. Phase 1 replaces the global 90s timeout with a per-tool-class policy table. Phase 2 adds a `tool_progress` event channel and partial-result return on timeout. Phase 3 introduces an in-memory `ToolJobRegistry` and two companion tools (`check_tool_job_status`, `cancel_tool_job`) so multi-minute scrapes run off the synchronous tool-call path.

**Tech Stack:** TypeScript 5.x, Electron main process, Mocha (test/modules), Vitest (test/vitest/main), existing TypeORM/SQLite stack (no schema changes), existing worker-process IPC.

**References:**
- PRD: `docs/superpowers/specs/2026-06-25-ai-tool-timeout-resilience-prd.md`
- Tech design: `docs/superpowers/specs/2026-06-25-ai-tool-timeout-resilience-technical-design.md`

**Testing conventions:**
- Pure-service / module logic → Mocha under `test/modules/**` (run with `yarn test`).
- Main-process service / loop logic → Vitest under `test/vitest/main/**` (run with `yarn testmain`).
- Each task lists the exact command.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/service/ToolTimeoutPolicy.ts` | Types + policy + name-based inferrer + `resolveTimeoutMs` |
| `src/service/ToolJobRegistry.ts` | In-memory async job lifecycle (Phase 3) |
| `test/modules/ToolTimeoutPolicy.test.ts` | Mocha unit tests for Phase 1 |
| `test/modules/ToolJobRegistry.test.ts` | Mocha unit tests for Phase 3 |
| `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts` | Vitest for `executeToolWithTimeout` across classes |
| `test/vitest/main/service/ToolExecutorAsync.test.ts` | Vitest for async dispatch + companion tools |

### Modified files

| File | Phase | Change |
|---|---|---|
| `src/entityTypes/skillTypes.ts` | 1,2,3 | Extend `SkillDefinition` + `SkillExecutionContext` |
| `src/api/aiChatApi.ts` | 2 | Extend `ToolExecutionResult` with partial fields |
| `src/service/AIChatQueryEvents.ts` | 2 | Add `tool_progress` event variant |
| `src/service/AIChatQueryLoop.ts` | 1,2,3 | Replace constant, partial branch, async dispatch |
| `src/service/ToolExecutor.ts` | 2,3 | Wire `emitProgress`, partial snapshot, async dispatch |
| `src/config/skillsRegistry.ts` | 1,2,3 | Annotate tools; add async capability; add 2 new tools |
| `src/modules/GoogleMapsModule.ts` | 2 | Emit progress, handle `collect_and_cancel` |
| `src/modules/YandexMapsModule.ts` | 2 | Same |
| `src/modules/ContactInfoModule.ts` | 2 | Same (for `extract_contact_info`) |
| `src/modules/WebsiteAnalyzerModule.ts` | 2 | Same (for `analyze_website`) |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | 2 | Add i18n keys for progress/partial messages |
| `src/background.ts` | 3 | Registry shutdown hook |

---

## Phase 1: Per-Tool-Class Timeouts

### Task 1: Create `ToolTimeoutPolicy` module

**Files:**
- Create: `src/service/ToolTimeoutPolicy.ts`
- Test: `test/modules/ToolTimeoutPolicy.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `test/modules/ToolTimeoutPolicy.test.ts`:

```typescript
import { expect } from "chai";
import {
  ToolTimeoutClass,
  TOOL_TIMEOUT_POLICY,
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("ToolTimeoutPolicy", () => {
  describe("TOOL_TIMEOUT_POLICY", () => {
    it("exposes fast/network/browser ceilings and omits async", () => {
      expect(TOOL_TIMEOUT_POLICY.fast).to.equal(30_000);
      expect(TOOL_TIMEOUT_POLICY.network).to.equal(90_000);
      expect(TOOL_TIMEOUT_POLICY.browser).to.equal(240_000);
    });
  });

  describe("resolveTimeoutMs", () => {
    it("returns the class ceiling for fast/network/browser", () => {
      expect(resolveTimeoutMs("fast")).to.equal(30_000);
      expect(resolveTimeoutMs("network")).to.equal(90_000);
      expect(resolveTimeoutMs("browser")).to.equal(240_000);
    });
    it("returns null for async (no synchronous ceiling)", () => {
      expect(resolveTimeoutMs("async")).to.equal(null);
    });
  });

  describe("inferTimeoutClassByName", () => {
    it("classifies file tools as fast", () => {
      expect(inferTimeoutClassByName("file_read")).to.equal("fast");
      expect(inferTimeoutClassByName("glob_files")).to.equal("fast");
      expect(inferTimeoutClassByName("grep_files")).to.equal("fast");
      expect(inferTimeoutClassByName("read_url_content")).to.equal("fast");
    });
    it("classifies browser-automation tools as browser", () => {
      expect(inferTimeoutClassByName("search_maps_businesses")).to.equal("browser");
      expect(inferTimeoutClassByName("extract_contact_info")).to.equal("browser");
    });
    it("classifies network tools as network", () => {
      expect(inferTimeoutClassByName("analyze_website")).to.equal("network");
      expect(inferTimeoutClassByName("search_yellow_pages")).to.equal("network");
    });
    it("defaults unknown tools to fast", () => {
      expect(inferTimeoutClassByName("something_new")).to.equal("fast");
    });
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `yarn test test/modules/ToolTimeoutPolicy.test.ts`
Expected: FAIL with "Cannot find module '@/service/ToolTimeoutPolicy'".

- [ ] **Step 1.3: Write minimal implementation**

Create `src/service/ToolTimeoutPolicy.ts`:

```typescript
/**
 * Per-tool-class timeout policy for ai-chat-v2 tool calls.
 *
 * Replaces the single global CHAT_V2_TOOL_TIMEOUT_MS with a class table
 * so that browser-automation tools (search_maps_businesses, extract_contact_info)
 * get a longer ceiling than fast file tools.
 *
 * See docs/superpowers/specs/2026-06-25-ai-tool-timeout-resilience-prd.md
 */

export type ToolTimeoutClass = "fast" | "network" | "browser" | "async";

export interface ToolTimeoutPolicyConfig {
  readonly fast: number;
  readonly network: number;
  readonly browser: number;
}

export const TOOL_TIMEOUT_POLICY: ToolTimeoutPolicyConfig = {
  fast: 30_000,
  network: 90_000,
  browser: 240_000,
};

/**
 * Resolve a timeout class to its millisecond ceiling.
 * Returns null for "async" because async tools have no synchronous ceiling.
 */
export function resolveTimeoutMs(
  cls: ToolTimeoutClass,
  policy: ToolTimeoutPolicyConfig = TOOL_TIMEOUT_POLICY
): number | null {
  if (cls === "async") return null;
  return policy[cls];
}

/**
 * Fallback classifier used when a skill does not declare its timeoutClass.
 * Lets the registry migrate incrementally.
 */
export function inferTimeoutClassByName(name: string): ToolTimeoutClass {
  if (
    name.startsWith("file_") ||
    name === "glob_files" ||
    name === "grep_files" ||
    name === "read_url_content"
  ) {
    return "fast";
  }
  if (
    name === "search_maps_businesses" ||
    name === "extract_contact_info"
  ) {
    return "browser";
  }
  if (
    name === "analyze_website" ||
    name === "search_yellow_pages"
  ) {
    return "network";
  }
  return "fast";
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `yarn test test/modules/ToolTimeoutPolicy.test.ts`
Expected: PASS, all 3 describe blocks green.

- [ ] **Step 1.5: Commit**

```bash
git add src/service/ToolTimeoutPolicy.ts test/modules/ToolTimeoutPolicy.test.ts
git commit -m "feat(tool-timeout): add per-class timeout policy module"
```

---

### Task 2: Extend `SkillDefinition` with timeout class fields

**Files:**
- Modify: `src/entityTypes/skillTypes.ts:70-116` (SkillDefinition)
- Test: `test/modules/ToolTimeoutPolicy.test.ts` (extend)

- [ ] **Step 2.1: Extend the failing test**

Append to `test/modules/ToolTimeoutPolicy.test.ts`:

```typescript
import type { SkillDefinition } from "@/entityTypes/skillTypes";

describe("SkillDefinition timeout-class fields", () => {
  it("allows optional static timeoutClass", () => {
    const skill: SkillDefinition = {
      name: "x",
      description: "",
      parameters: {},
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "network",
      source: "built-in",
      execute: async () => ({ success: true }),
      timeoutClass: "browser",
    };
    expect(skill.timeoutClass).to.equal("browser");
  });

  it("allows optional resolveTimeoutClass for argument-driven routing", () => {
    const skill: SkillDefinition = {
      name: "x",
      description: "",
      parameters: {},
      tier: "main",
      requiresConfirmation: false,
      permissionCategory: "network",
      source: "built-in",
      execute: async () => ({ success: true }),
      resolveTimeoutClass: (args) =>
        (args.max_results as number) > 20 ? "async" : "browser",
    };
    expect(skill.resolveTimeoutClass!({ max_results: 50 })).to.equal("async");
    expect(skill.resolveTimeoutClass!({ max_results: 10 })).to.equal("browser");
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `yarn test test/modules/ToolTimeoutPolicy.test.ts`
Expected: FAIL with TypeScript error: Property `timeoutClass` does not exist on type `SkillDefinition`.

- [ ] **Step 2.3: Extend the type**

In `src/entityTypes/skillTypes.ts`, add the import at the top:

```typescript
import type { ToolTimeoutClass } from "@/service/ToolTimeoutPolicy";
```

Inside `SkillDefinition` (after the `source` field around line 96, before `documentationOnly?`), add:

```typescript
  /**
   * Timeout class for this tool. If absent, the runtime infers a default
   * from the tool name via inferTimeoutClassByName.
   */
  readonly timeoutClass?: ToolTimeoutClass;

  /**
   * Dynamic timeout-class resolver. When present, overrides timeoutClass
   * based on the actual call arguments. Used to route heavy argument
   * combinations to the async path.
   */
  readonly resolveTimeoutClass?: (
    args: Record<string, unknown>
  ) => ToolTimeoutClass;
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `yarn test test/modules/ToolTimeoutPolicy.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Type check the whole project**

Run: `yarn vue-check 2>&1 | tail -20`
Expected: No new type errors introduced.

- [ ] **Step 2.6: Commit**

```bash
git add src/entityTypes/skillTypes.ts test/modules/ToolTimeoutPolicy.test.ts
git commit -m "feat(skill-types): add timeoutClass and resolveTimeoutClass fields"
```

---

### Task 3: Annotate the four slow tools in `skillsRegistry.ts`

**Files:**
- Modify: `src/config/skillsRegistry.ts` (entries for `search_maps_businesses`, `search_yellow_pages`, `extract_contact_info`, `analyze_website`)

- [ ] **Step 3.1: Add `timeoutClass: "browser"` to the four browser/network tools**

For each of these entries in `src/config/skillsRegistry.ts`:
- `search_maps_businesses` (line ~255) → add `timeoutClass: "browser",`
- `extract_contact_info` → add `timeoutClass: "browser",`
- `search_yellow_pages` → add `timeoutClass: "network",`
- `analyze_website` → add `timeoutClass: "network",`

Place the field right after `permissionCategory: ...` in each entry. For example, for `search_maps_businesses`:

```typescript
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "automation",
    source: "built-in",
    timeoutClass: "browser",
    execute: async (args, context) => {
      // ... unchanged ...
    },
  },
```

Repeat with `timeoutClass: "browser"` for `extract_contact_info`, and `timeoutClass: "network"` for `search_yellow_pages` and `analyze_website`.

- [ ] **Step 3.2: Verify build still passes**

Run: `yarn tsc`
Expected: No new errors. The new field is optional so existing entries without it remain valid.

- [ ] **Step 3.3: Commit**

```bash
git add src/config/skillsRegistry.ts
git commit -m "feat(skills-registry): declare timeoutClass for slow browser/network tools"
```

---

### Task 4: Use the policy in `executeToolWithTimeout`

**Files:**
- Modify: `src/service/AIChatQueryLoop.ts:48`, `:809-849`
- Create: `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("executeToolWithTimeout policy integration", () => {
  // The loop reads the policy via inferTimeoutClassByName when no skill
  // resolver is present. Verify the lookup behavior the loop depends on.

  it("uses browser ceiling for search_maps_businesses", () => {
    const cls = inferTimeoutClassByName("search_maps_businesses");
    expect(cls).to.equal("browser");
    expect(resolveTimeoutMs(cls)).to.equal(240_000);
  });

  it("uses fast ceiling for file_read", () => {
    const cls = inferTimeoutClassByName("file_read");
    expect(resolveTimeoutMs(cls)).to.equal(30_000);
  });

  it("uses network ceiling for analyze_website", () => {
    const cls = inferTimeoutClassByName("analyze_website");
    expect(resolveTimeoutMs(cls)).to.equal(90_000);
  });

  it("resolveTimeoutMs(async) returns null so loop dispatches to async path", () => {
    expect(resolveTimeoutMs("async")).to.equal(null);
  });
});
```

- [ ] **Step 4.2: Run test to verify it passes immediately**

Run: `yarn testmain -- AIChatQueryLoopTimeout`
Expected: PASS — these are pure-function assertions that hold today. The test exists to lock the contract before we wire it into the loop.

- [ ] **Step 4.3: Update `executeToolWithTimeout` to use the policy**

In `src/service/AIChatQueryLoop.ts`:

1. Add imports near the existing imports (after line 35):

```typescript
import {
  inferTimeoutClassByName,
  resolveTimeoutMs,
  type ToolTimeoutClass,
} from "@/service/ToolTimeoutPolicy";
```

2. Keep `CHAT_V2_TOOL_TIMEOUT_MS` (line 48) for backwards-compat reference; add a comment marking it as the legacy default.

3. Replace the body of `executeToolWithTimeout` (lines 809-849) to look up the class via the skill registry (if available) and fall back to name-based inference:

```typescript
  private async executeToolWithTimeout(
    input: AIChatQueryLoopInput,
    call: {
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }
  ): Promise<ToolExecutionResult> {
    const startedAt = Date.now();

    // Resolve the timeout class. Explicit declaration on the skill wins;
    // argument-driven resolver wins over static field; otherwise infer by name.
    const skill = input.skillRegistry?.get(call.name);
    let cls: ToolTimeoutClass =
      skill?.resolveTimeoutClass?.(call.arguments ?? {}) ??
      skill?.timeoutClass ??
      inferTimeoutClassByName(call.name);
    const timeoutMs = resolveTimeoutMs(cls);

    // async path is implemented in Phase 3. Until then, fall back to browser
    // ceiling so the loop still terminates.
    const effectiveTimeoutMs =
      timeoutMs ?? resolveTimeoutMs("browser")!;

    const executePromise = this.deps.executeTool(
      call.name,
      call.arguments ?? {},
      {
        conversationId: input.conversationId,
        toolCallId: call.id,
        args: call.arguments,
      }
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<ToolExecutionResult>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve({
          tool_call_id: call.id,
          tool_name: call.name,
          success: false,
          result: {
            error: `Tool "${call.name}" timed out after ${effectiveTimeoutMs}ms.`,
            timedOut: true,
          },
          execution_time_ms: Date.now() - startedAt,
        });
      }, effectiveTimeoutMs);
    });

    try {
      return await Promise.race([executePromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
```

4. Add `skillRegistry?: { get(name: string): SkillDefinition | undefined }` to `AIChatQueryLoopInput` in `src/service/AIChatQueryEvents.ts`. The field is optional so existing callers continue to work; when absent, the loop uses name-based inference.

- [ ] **Step 4.4: Type check**

Run: `yarn tsc`
Expected: No new errors.

- [ ] **Step 4.5: Re-run the test suite**

Run: `yarn testmain -- AIChatQueryLoopTimeout`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/service/AIChatQueryLoop.ts src/service/AIChatQueryEvents.ts test/vitest/main/service/AIChatQueryLoopTimeout.test.ts
git commit -m "feat(ai-chat-loop): use per-tool-class timeout policy in executeToolWithTimeout"
```

---

## Phase 2: Streaming Progress and Partial Results

### Task 5: Add `tool_progress` event to the event sink

**Files:**
- Modify: `src/service/AIChatQueryEvents.ts` (add event interface + extend union)
- Test: `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts` (extend)

- [ ] **Step 5.1: Write the failing test**

Append to `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts`:

```typescript
import type {
  AIChatQueryEvent,
  AIChatQueryToolProgressEvent,
} from "@/service/AIChatQueryEvents";

describe("tool_progress event contract", () => {
  it("supports a tool_progress event with phase/message/progress/counts", () => {
    const event: AIChatQueryToolProgressEvent = {
      type: "tool_progress",
      conversationId: "c1",
      messageId: "m1",
      toolCallId: "tc1",
      toolName: "search_maps_businesses",
      phase: "extracting",
      message: "progress.maps.found",
      progress: 0.4,
      partialCount: 8,
      expectedCount: 20,
      timestamp: Date.now(),
    };
    const unioned: AIChatQueryEvent = event;
    expect(unioned.type).to.equal("tool_progress");
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `yarn testmain -- AIChatQueryLoopTimeout`
Expected: FAIL — `AIChatQueryToolProgressEvent` not exported.

- [ ] **Step 5.3: Add the event type**

In `src/service/AIChatQueryEvents.ts`:

1. Add the interface (place near other `AIChatQueryToolCallEvent` declarations, around line 60):

```typescript
export type ToolProgressPhase =
  | "queued"
  | "running"
  | "fetching"
  | "extracting"
  | "finalizing";

export interface AIChatQueryToolProgressEvent {
  type: "tool_progress";
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  phase: ToolProgressPhase;
  /** i18n key or fallback English string. */
  message: string;
  /** 0..1 when known, null when indeterminate. */
  progress: number | null;
  partialCount: number | null;
  expectedCount: number | null;
  timestamp: number;
}
```

2. Add `| AIChatQueryToolProgressEvent` to the `AIChatQueryEvent` union (around line 143).

- [ ] **Step 5.4: Run test to verify it passes**

Run: `yarn testmain -- AIChatQueryLoopTimeout`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/service/AIChatQueryEvents.ts test/vitest/main/service/AIChatQueryLoopTimeout.test.ts
git commit -m "feat(ai-chat-events): add tool_progress event variant"
```

---

### Task 6: Add `emitProgress` to `SkillExecutionContext` and wire `ToolExecutor`

**Files:**
- Modify: `src/entityTypes/skillTypes.ts:123+` (SkillExecutionContext)
- Modify: `src/service/ToolExecutor.ts` (build context with emitProgress)

- [ ] **Step 6.1: Extend `SkillExecutionContext`**

In `src/entityTypes/skillTypes.ts`, inside `SkillExecutionContext`, append:

```typescript
  /**
   * Emits a progress event for this tool call. Optional — fast tools leave it
   * undefined. Wired by ToolExecutor to a sink that emits AIChatQueryToolProgressEvent.
   */
  readonly emitProgress?: (event: {
    phase:
      | "queued"
      | "running"
      | "fetching"
      | "extracting"
      | "finalizing";
    message: string;
    progress?: number | null;
    partialCount?: number | null;
    expectedCount?: number | null;
  }) => void;
```

- [ ] **Step 6.2: Type check**

Run: `yarn tsc`
Expected: PASS — new optional field is backwards-compatible.

- [ ] **Step 6.3: Wire `emitProgress` in `ToolExecutor.execute`**

In `src/service/ToolExecutor.ts`, find `execute` (line ~125). The current method signature is:

```typescript
static async execute(
  toolName: string,
  args: Record<string, unknown>,
  conversationId: string
): Promise<ToolExecutionResult>
```

We need to thread the progress sink. Add an optional fourth parameter and pass it into the context object built for skills:

```typescript
static async execute(
  toolName: string,
  args: Record<string, unknown>,
  conversationId: string,
  hooks?: {
    emitProgress?: (event: {
      phase:
        | "queued"
        | "running"
        | "fetching"
        | "extracting"
        | "finalizing";
      message: string;
      progress?: number | null;
      partialCount?: number | null;
      expectedCount?: number | null;
    }) => void;
  }
): Promise<ToolExecutionResult>
```

Inside the method, when building the `SkillExecutionContext`, set `emitProgress: hooks?.emitProgress`. The existing internal-tool path (which does not use a SkillExecutionContext) is unaffected.

- [ ] **Step 6.4: Update the loop to pass the sink**

In `src/service/AIChatQueryLoop.ts:executeToolWithTimeout`, update the `executePromise` to thread `emitProgress`:

```typescript
const executePromise = this.deps.executeTool(
  call.name,
  call.arguments ?? {},
  {
    conversationId: input.conversationId,
    toolCallId: call.id,
    args: call.arguments,
  }
);
```

becomes (note: the existing `deps.executeTool` signature already takes `(name, args, ctx)`. We instead pass `emitProgress` via a new optional `deps.emitToolProgress` that the loop wires to the event sink).

Add to `AIChatQueryLoop` deps interface:

```typescript
emitToolProgress?: (
  toolCallId: string,
  toolName: string,
  event: {
    phase: "queued" | "running" | "fetching" | "extracting" | "finalizing";
    message: string;
    progress?: number | null;
    partialCount?: number | null;
    expectedCount?: number | null;
  }
) => void;
```

Then in `executeToolWithTimeout`, wrap the executor:

```typescript
const executePromise = this.deps.executeTool(
  call.name,
  call.arguments ?? {},
  {
    conversationId: input.conversationId,
    toolCallId: call.id,
    args: call.arguments,
  }
).then(
  (r) => r,
  (e) => e
);
```

Replace with:

```typescript
const ctx = {
  conversationId: input.conversationId,
  toolCallId: call.id,
  args: call.arguments,
};

// The deps.executeTool already accepts a context; emitProgress is wired
// inside ToolExecutor.execute based on a hooks parameter the loop passes.
const executePromise = this.deps.executeTool(call.name, call.arguments ?? {}, ctx);
```

Where `deps.executeTool` is updated to a 3-arg form that accepts the context with an optional `emitProgress`. Implementation detail: the loop's `emitProgress` builds an `AIChatQueryToolProgressEvent` and calls `eventSink.emit(...)`. The exact wiring point is `AIChatQueryLoop.runRound` — pass a `progressSink` closure into the deps at loop construction.

- [ ] **Step 6.5: Type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 6.6: Commit**

```bash
git add src/entityTypes/skillTypes.ts src/service/ToolExecutor.ts src/service/AIChatQueryLoop.ts src/service/AIChatQueryEvents.ts
git commit -m "feat(tool-executor): wire emitProgress from SkillExecutionContext to event sink"
```

---

### Task 7: Extend `ToolExecutionResult` with partial fields

**Files:**
- Modify: `src/api/aiChatApi.ts:89-95`

- [ ] **Step 7.1: Extend the type**

In `src/api/aiChatApi.ts`, replace `ToolExecutionResult` with:

```typescript
export interface ToolExecutionResult {
  tool_call_id: string;
  tool_name: string;
  success: boolean;
  result: Record<string, unknown>;
  execution_time_ms: number;
  /** True when the result contains partial data returned after a timeout. */
  readonly partial?: boolean;
  /** How many items the tool collected before returning (partial context). */
  readonly collectedCount?: number;
  /** How many items the tool was aiming for (partial context). */
  readonly expectedCount?: number;
  /** Timeout ceiling that fired, in ms, when partial === true. */
  readonly timedOutAfterMs?: number;
}
```

- [ ] **Step 7.2: Type check**

Run: `yarn tsc`
Expected: PASS — all new fields are optional.

- [ ] **Step 7.3: Commit**

```bash
git add src/api/aiChatApi.ts
git commit -m "feat(ai-chat-api): add partial-result fields to ToolExecutionResult"
```

---

### Task 8: Add `supportsPartialResult` and wire the partial-result branch

**Files:**
- Modify: `src/entityTypes/skillTypes.ts` (SkillDefinition)
- Modify: `src/service/ToolExecutor.ts` (add `requestPartialSnapshot`, snapshot map)
- Modify: `src/service/AIChatQueryLoop.ts:executeToolWithTimeout` (partial branch)
- Modify: `src/config/skillsRegistry.ts` (annotate 4 tools with `supportsPartialResult: true`)

- [ ] **Step 8.1: Add `supportsPartialResult` to `SkillDefinition`**

In `src/entityTypes/skillTypes.ts`, inside `SkillDefinition`, after `resolveTimeoutClass?`, add:

```typescript
  /**
   * When true, the runtime may request whatever partial data the tool has
   * collected when the timeout fires. The tool's execute() must return
   * promptly when its cancellation signal is set.
   */
  readonly supportsPartialResult?: boolean;
```

- [ ] **Step 8.2: Add `requestPartialSnapshot` to `ToolExecutor`**

In `src/service/ToolExecutor.ts`, add a snapshot registry near the top of the class:

```typescript
interface PartialSnapshot {
  collectedCount: number;
  expectedCount: number;
  data: Record<string, unknown>;
}

private static partialSnapshots = new Map<string, PartialSnapshot>();
private static partialEmitters = new Map<
  string,
  (snapshot: PartialSnapshot) => void
>();

static registerPartialSnapshot(
  toolCallId: string,
  emitter: (snapshot: PartialSnapshot) => void
): void {
  ToolExecutor.partialEmitters.set(toolCallId, emitter);
}

static unregisterPartialSnapshot(toolCallId: string): void {
  ToolExecutor.partialEmitters.delete(toolCallId);
  ToolExecutor.partialSnapshots.delete(toolCallId);
}

static updatePartialSnapshot(
  toolCallId: string,
  snapshot: PartialSnapshot
): void {
  ToolExecutor.partialSnapshots.set(toolCallId, snapshot);
}

/**
 * Ask the active module for its current partial result. Returns null if the
 * module doesn't respond within 2s.
 */
static async requestPartialSnapshot(
  toolCallId: string
): Promise<PartialSnapshot | null> {
  const emitter = ToolExecutor.partialEmitters.get(toolCallId);
  if (!emitter) return ToolExecutor.partialSnapshots.get(toolCallId) ?? null;

  return new Promise<PartialSnapshot | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 2_000);
    ToolExecutor.partialSnapshots.set(toolCallId + "__pending_resolve", {
      collectedCount: 0,
      expectedCount: 0,
      data: {},
    });
    // One-shot listener
    const original = emitter;
    const wrapper = (snapshot: PartialSnapshot) => {
      clearTimeout(timeout);
      ToolExecutor.partialSnapshots.delete(toolCallId + "__pending_resolve");
      ToolExecutor.partialSnapshots.set(toolCallId, snapshot);
      resolve(snapshot);
    };
    ToolExecutor.partialEmitters.set(toolCallId, wrapper);
    // Trigger the module to emit its current state
    original({
      collectedCount: -1,
      expectedCount: -1,
      data: {},
    });
  });
}
```

> Note: this is a best-effort protocol. The exact wire format inside each module (Maps/Yandex/Contact/Website) is "module calls `ToolExecutor.updatePartialSnapshot(toolCallId, snapshot)` whenever it has new data". The `requestPartialSnapshot` flow triggers the emitter only if the module chooses to implement on-demand collection. Most modules simply call `updatePartialSnapshot` continuously, and `requestPartialSnapshot` reads the cached value.

A simpler first implementation is fine: drop the emitter mechanism and only use `updatePartialSnapshot` + read from the map:

```typescript
static async requestPartialSnapshot(
  toolCallId: string
): Promise<PartialSnapshot | null> {
  return Promise.resolve(ToolExecutor.partialSnapshots.get(toolCallId) ?? null);
}
```

Use the simpler form. Modules call `updatePartialSnapshot` after each batch.

- [ ] **Step 8.3: Wire the partial-result branch in `executeToolWithTimeout`**

In `src/service/AIChatQueryLoop.ts`, update the `timeoutPromise` body inside `executeToolWithTimeout`. Replace the existing `resolve({ success: false, ... timedOut: true })` call with:

```typescript
timeoutId = setTimeout(async () => {
  if (skill?.supportsPartialResult) {
    const snapshot = await ToolExecutor.requestPartialSnapshot(call.id);
    if (snapshot && snapshot.collectedCount > 0) {
      resolve({
        tool_call_id: call.id,
        tool_name: call.name,
        success: true,
        result: snapshot.data,
        partial: true,
        collectedCount: snapshot.collectedCount,
        expectedCount: snapshot.expectedCount,
        timedOutAfterMs: effectiveTimeoutMs,
        execution_time_ms: Date.now() - startedAt,
      });
      return;
    }
  }
  resolve({
    tool_call_id: call.id,
    tool_name: call.name,
    success: false,
    result: {
      error: `Tool "${call.name}" timed out after ${effectiveTimeoutMs}ms.`,
      timedOut: true,
    },
    execution_time_ms: Date.now() - startedAt,
  });
}, effectiveTimeoutMs);
```

Add the import at the top:

```typescript
import { ToolExecutor } from "@/service/ToolExecutor";
```

Also, in the `try/finally` after the race, call `ToolExecutor.unregisterPartialSnapshot(call.id)` so the map does not leak.

- [ ] **Step 8.4: Annotate the four supporting tools**

In `src/config/skillsRegistry.ts`, add `supportsPartialResult: true` to:
- `search_maps_businesses`
- `search_yellow_pages`
- `extract_contact_info`
- `analyze_website`

- [ ] **Step 8.5: Add a test for the partial-result branch**

Append to `test/vitest/main/service/AIChatQueryLoopTimeout.test.ts`:

```typescript
import { ToolExecutor } from "@/service/ToolExecutor";

describe("partial-result snapshot", () => {
  it("stores and retrieves partial snapshots by toolCallId", async () => {
    const id = "tc-partial-1";
    ToolExecutor.updatePartialSnapshot(id, {
      collectedCount: 5,
      expectedCount: 20,
      data: { businesses: [{ name: "A" }] },
    });
    const snap = await ToolExecutor.requestPartialSnapshot(id);
    expect(snap).to.not.equal(null);
    expect(snap!.collectedCount).to.equal(5);
    ToolExecutor.unregisterPartialSnapshot(id);
    expect(await ToolExecutor.requestPartialSnapshot(id)).to.equal(null);
  });
});
```

- [ ] **Step 8.6: Run tests**

Run: `yarn testmain -- AIChatQueryLoopTimeout`
Expected: PASS.

- [ ] **Step 8.7: Type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 8.8: Commit**

```bash
git add src/entityTypes/skillTypes.ts src/service/ToolExecutor.ts src/service/AIChatQueryLoop.ts src/config/skillsRegistry.ts test/vitest/main/service/AIChatQueryLoopTimeout.test.ts
git commit -m "feat(tool-timeout): return partial results on timeout for supporting tools"
```

---

### Task 9: Emit progress from the four modules + add i18n keys

**Files:**
- Modify: `src/modules/GoogleMapsModule.ts`
- Modify: `src/modules/YandexMapsModule.ts`
- Modify: `src/modules/ContactInfoModule.ts`
- Modify: `src/modules/WebsiteAnalyzerModule.ts`
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 9.1: Add i18n keys to English**

In `src/views/lang/en.ts`, find the existing tool-related section (search for `tool` keys or `aiChat`). Add:

```typescript
toolProgress: {
  maps_starting: "Starting map search...",
  maps_fetching: "Loading results from {platform} Maps...",
  maps_found: "Found {collected} of {expected} businesses",
  maps_extracting: "Extracting details for business {collected} of {expected}",
  maps_finalizing: "Finalizing results...",
  contact_starting: "Starting contact extraction...",
  contact_found: "Extracted {collected} of {expected} contacts",
  contact_finalizing: "Finalizing contacts...",
  website_analyzing: "Analyzing website content...",
  website_finalizing: "Finalizing analysis...",
  partial_result: "Showing partial results ({collected} of {expected}). The tool timed out but returned what it had.",
},
```

- [ ] **Step 9.2: Translate to the other 5 language files**

Add the same `toolProgress` block to each of:
- `src/views/lang/zh.ts` — Chinese translations
- `src/views/lang/es.ts` — Spanish
- `src/views/lang/fr.ts` — French
- `src/views/lang/de.ts` — German
- `src/views/lang/ja.ts` — Japanese

Use natural, accurate translations. Preserve the `{collected}`, `{expected}`, `{platform}` placeholders exactly.

- [ ] **Step 9.3: Emit progress from `GoogleMapsModule`**

In `src/modules/GoogleMapsModule.ts`, find the worker IPC message handler (`child.on("message", ...)`). Add handlers for the new message types emitted by the worker:

```typescript
child.on("message", (msg: { type: string; [key: string]: unknown }) => {
  if (msg.type === "progress") {
    context.emitProgress?.({
      phase: (msg.phase as any) ?? "running",
      message: (msg.i18nKey as string) ?? "progress.maps.found",
      progress: (msg.progress as number | null) ?? null,
      partialCount: (msg.partialCount as number | null) ?? null,
      expectedCount: (msg.expectedCount as number | null) ?? null,
    });
    if (typeof msg.partialCount === "number") {
      ToolExecutor.updatePartialSnapshot(context.toolCallId, {
        collectedCount: msg.partialCount,
        expectedCount: (msg.expectedCount as number) ?? 0,
        data: { businesses: msg.businesses ?? [] },
      });
    }
    return;
  }
  // ... existing message handling unchanged ...
});
```

The `context` parameter here is the `SkillExecutionContext`. The module needs access to it — change the module's `executeSearch` method signature to accept an optional context:

```typescript
async executeSearch(
  params: MapsSearchParams,
  context?: { toolCallId: string; emitProgress?: (...args: any[]) => void }
): Promise<Record<string, unknown>>
```

The caller in `ToolExecutor.executeGoogleMapsSearch` already has the context — pass it through.

- [ ] **Step 9.4: Apply the same pattern to the other three modules**

Repeat Step 9.3 for:
- `src/modules/YandexMapsModule.ts` — same message types
- `src/modules/ContactInfoModule.ts` — phases `running`/`extracting`/`finalizing`
- `src/modules/WebsiteAnalyzerModule.ts` — phases `running`/`finalizing`

- [ ] **Step 9.5: Emit progress messages from the worker side**

The worker files in `src/childprocess/` need to emit `process.send({ type: "progress", ... })` periodically. Add these sends:
- After the worker starts the browser: `process.send({ type: "progress", phase: "running", i18nKey: "toolProgress.maps_starting" })`
- After each batch of N results: `process.send({ type: "progress", phase: "extracting", partialCount: N, expectedCount: total, i18nKey: "toolProgress.maps_found" })`
- Before exiting: `process.send({ type: "progress", phase: "finalizing", i18nKey: "toolProgress.maps_finalizing" })`

> Worker files are out of scope for unit tests in this plan (they require a real browser). Verify manually per the manual test in Task 11.

- [ ] **Step 9.6: Type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 9.7: Run all tests to verify no regressions**

Run: `yarn testmain`
Expected: PASS — no existing tests should break.

- [ ] **Step 9.8: Commit**

```bash
git add src/views/lang/ src/modules/GoogleMapsModule.ts src/modules/YandexMapsModule.ts src/modules/ContactInfoModule.ts src/modules/WebsiteAnalyzerModule.ts
git commit -m "feat(tool-progress): emit progress events from browser tools + i18n keys"
```

---

## Phase 3: Async Job Pattern

### Task 10: Create `ToolJobRegistry`

**Files:**
- Create: `src/service/ToolJobRegistry.ts`
- Test: `test/modules/ToolJobRegistry.test.ts`

- [ ] **Step 10.1: Write the failing test**

Create `test/modules/ToolJobRegistry.test.ts`:

```typescript
import { expect } from "chai";
import { ToolJobRegistry } from "@/service/ToolJobRegistry";

describe("ToolJobRegistry", () => {
  it("starts a job and returns a snapshot with status running", () => {
    const reg = new ToolJobRegistry({ maxConcurrent: 2, staleAfterMs: 60_000, pollMinIntervalMs: 1 });
    let release: () => void = () => {};
    const pending = new Promise<void>((r) => (release = r));
    const { jobId } = reg.start(
      "search_maps_businesses",
      { q: "dentist" },
      { conversationId: "c1", toolCallId: "tc1" },
      async () => {
        await pending;
      }
    );
    const snap = reg.getStatus(jobId);
    expect(snap.status).to.equal("running");
    expect(snap.toolName).to.equal("search_maps_businesses");
    expect(snap.conversationId).to.equal("c1");
    release();
  });

  it("rejects polls tighter than pollMinIntervalMs with rate_limited", async () => {
    const reg = new ToolJobRegistry({ maxConcurrent: 2, staleAfterMs: 60_000, pollMinIntervalMs: 1000 });
    const { jobId } = reg.start(
      "t",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async () => {}
    );
    const first = reg.getStatus(jobId);
    const second = reg.getStatus(jobId);
    expect(first.status).to.equal("running");
    expect(second.status).to.equal("rate_limited");
  });

  it("enforces maxConcurrent and queues overflow", async () => {
    const reg = new ToolJobRegistry({ maxConcurrent: 1, staleAfterMs: 60_000, pollMinIntervalMs: 1 });
    let release1: () => void = () => {};
    reg.start("t", {}, { conversationId: "c", toolCallId: "tc1" }, async () => {
      await new Promise<void>((r) => (release1 = r));
    });
    const { jobId: j2 } = reg.start(
      "t",
      {},
      { conversationId: "c", toolCallId: "tc2" },
      async () => {}
    );
    expect(reg.getStatus(j2).status).to.equal("queued");
    release1();
  });

  it("cancels a running job", async () => {
    const reg = new ToolJobRegistry({ maxConcurrent: 2, staleAfterMs: 60_000, pollMinIntervalMs: 1 });
    let release: () => void = () => {};
    const { jobId } = reg.start(
      "t",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async () => {
        await new Promise<void>((r) => (release = r));
      }
    );
    const result = reg.cancel(jobId);
    expect(result.cancelled).to.equal(true);
    expect(reg.getStatus(jobId).status).to.equal("cancelled");
    release();
  });

  it("returns not_found for cross-conversation access", () => {
    const reg = new ToolJobRegistry({ maxConcurrent: 2, staleAfterMs: 60_000, pollMinIntervalMs: 1 });
    const { jobId } = reg.start(
      "t",
      {},
      { conversationId: "c1", toolCallId: "tc" },
      async () => {}
    );
    const snap = reg.getStatusForConversation(jobId, "other-conv");
    expect(snap.status).to.equal("not_found");
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

Run: `yarn test test/modules/ToolJobRegistry.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 10.3: Write minimal implementation**

Create `src/service/ToolJobRegistry.ts`:

```typescript
import { randomUUID } from "crypto";

export type ToolJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_found"
  | "rate_limited";

export type ToolProgressPhase =
  | "queued"
  | "running"
  | "fetching"
  | "extracting"
  | "finalizing";

export interface ToolJobProgress {
  readonly phase: ToolProgressPhase;
  readonly message: string;
  readonly progress: number | null;
  readonly partialCount: number | null;
  readonly expectedCount: number | null;
}

export interface ToolJobSnapshot {
  readonly jobId: string;
  readonly toolName: string;
  readonly conversationId: string;
  readonly status: ToolJobStatus;
  readonly progress: ToolJobProgress | null;
  readonly partial: {
    data: unknown;
    collectedCount: number;
    expectedCount: number;
  } | null;
  readonly result: unknown;
  readonly error: string | null;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly completedAt: number | null;
  readonly retryAfterMs?: number;
}

export interface ToolJobLimits {
  readonly maxConcurrent: number;
  readonly staleAfterMs: number;
  readonly pollMinIntervalMs: number;
}

export interface ToolJobSpawnHandle {
  readonly onCancel: (handler: () => void) => void;
  readonly onProgress: (handler: (p: ToolJobProgress) => void) => void;
  readonly onPartial: (
    handler: (p: { data: unknown; collectedCount: number; expectedCount: number }) => void
  ) => void;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface InternalJob {
  jobId: string;
  toolName: string;
  conversationId: string;
  status: Exclude<ToolJobStatus, "not_found" | "rate_limited">;
  progress: ToolJobProgress | null;
  partial: { data: unknown; collectedCount: number; expectedCount: number } | null;
  result: unknown;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  cancelHandlers: Array<() => void>;
  lastPolledAt: number;
}

export class ToolJobRegistry {
  private jobs = new Map<string, InternalJob>();
  private queue: string[] = [];
  private running = 0;
  private readonly limits: ToolJobLimits;

  constructor(limits?: Partial<ToolJobLimits>) {
    this.limits = {
      maxConcurrent: limits?.maxConcurrent ?? 4,
      staleAfterMs: limits?.staleAfterMs ?? 5 * 60_000,
      pollMinIntervalMs: limits?.pollMinIntervalMs ?? 5_000,
    };
  }

  start(
    toolName: string,
    args: Record<string, unknown>,
    ctx: { conversationId: string; toolCallId: string },
    spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
  ): { jobId: string; queued: boolean } {
    const jobId = randomUUID();
    const job: InternalJob = {
      jobId,
      toolName,
      conversationId: ctx.conversationId,
      status: "queued",
      progress: null,
      partial: null,
      result: null,
      error: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      cancelHandlers: [],
      lastPolledAt: 0,
    };
    this.jobs.set(jobId, job);

    const handle: ToolJobSpawnHandle = {
      onCancel: (h) => job.cancelHandlers.push(h),
      onProgress: (h) => {
        // Replace progress handler by storing on the job via closure.
        (job as any)._progressHandler = h;
      },
      onPartial: (h) => {
        (job as any)._partialHandler = h;
      },
      resolve: (result) => {
        job.status = "completed";
        job.result = result;
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        this.running--;
        this.drainQueue();
      },
      reject: (err) => {
        job.status = "failed";
        job.error = err.message;
        job.completedAt = Date.now();
        job.updatedAt = Date.now();
        this.running--;
        this.drainQueue();
      },
    };

    if (this.running >= this.limits.maxConcurrent) {
      this.queue.push(jobId);
      // Defer spawn until a slot opens.
      (job as any)._spawn = () => this.runSpawn(job, handle, spawn);
      return { jobId, queued: true };
    }

    this.runSpawn(job, handle, spawn);
    return { jobId, queued: false };
  }

  private runSpawn(
    job: InternalJob,
    handle: ToolJobSpawnHandle,
    spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
  ): void {
    job.status = "running";
    job.updatedAt = Date.now();
    this.running++;
    spawn(handle).catch((err) => handle.reject(err));
  }

  private drainQueue(): void {
    while (this.running < this.limits.maxConcurrent && this.queue.length > 0) {
      const nextId = this.queue.shift()!;
      const next = this.jobs.get(nextId);
      if (!next) continue;
      const spawn = (next as any)._spawn as (() => void) | undefined;
      if (spawn) {
        // Recompute handle: we already stashed spawn which closes over handle.
        spawn();
      }
    }
  }

  updateProgress(jobId: string, progress: ToolJobProgress): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = progress;
      job.updatedAt = Date.now();
    }
  }

  updatePartial(
    jobId: string,
    partial: { data: unknown; collectedCount: number; expectedCount: number }
  ): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.partial = partial;
      job.updatedAt = Date.now();
    }
  }

  getStatus(jobId: string): ToolJobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job) return this.notFound(jobId);
    const now = Date.now();
    if (
      job.status === "running" &&
      job.lastPolledAt > 0 &&
      now - job.lastPolledAt < this.limits.pollMinIntervalMs
    ) {
      return {
        jobId,
        toolName: job.toolName,
        conversationId: job.conversationId,
        status: "rate_limited",
        progress: null,
        partial: null,
        result: null,
        error: null,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        completedAt: null,
        retryAfterMs: this.limits.pollMinIntervalMs - (now - job.lastPolledAt),
      };
    }
    job.lastPolledAt = now;
    return this.snapshot(job);
  }

  getStatusForConversation(jobId: string, conversationId: string): ToolJobSnapshot {
    const job = this.jobs.get(jobId);
    if (!job || job.conversationId !== conversationId) return this.notFound(jobId);
    return this.getStatus(jobId);
  }

  cancel(jobId: string): { cancelled: boolean; reason?: string } {
    const job = this.jobs.get(jobId);
    if (!job) return { cancelled: false, reason: "not_found" };
    if (job.status === "completed") return { cancelled: false, reason: "already_completed" };
    if (job.status === "cancelled") return { cancelled: false, reason: "already_cancelled" };
    for (const h of job.cancelHandlers) {
      try {
        h();
      } catch {
        // Best-effort cancellation.
      }
    }
    job.status = "cancelled";
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    if (job.status === "running") this.running--;
    this.drainQueue();
    return { cancelled: true };
  }

  evictStale(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, job] of this.jobs) {
      const terminal =
        job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled";
      if (terminal && now - job.updatedAt > this.limits.staleAfterMs) {
        this.jobs.delete(id);
        count++;
      }
    }
    return count;
  }

  shutdown(): void {
    for (const job of this.jobs.values()) {
      if (job.status === "running" || job.status === "queued") {
        for (const h of job.cancelHandlers) {
          try {
            h();
          } catch {
            // ignore
          }
        }
        job.status = "cancelled";
        job.completedAt = Date.now();
      }
    }
    this.jobs.clear();
    this.queue = [];
    this.running = 0;
  }

  private snapshot(job: InternalJob): ToolJobSnapshot {
    return {
      jobId: job.jobId,
      toolName: job.toolName,
      conversationId: job.conversationId,
      status: job.status,
      progress: job.progress,
      partial: job.partial,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  }

  private notFound(jobId: string): ToolJobSnapshot {
    return {
      jobId,
      toolName: "",
      conversationId: "",
      status: "not_found",
      progress: null,
      partial: null,
      result: null,
      error: null,
      startedAt: 0,
      updatedAt: 0,
      completedAt: null,
    };
  }
}
```

- [ ] **Step 10.4: Run test to verify it passes**

Run: `yarn test test/modules/ToolJobRegistry.test.ts`
Expected: PASS — all 5 cases green.

- [ ] **Step 10.5: Commit**

```bash
git add src/service/ToolJobRegistry.ts test/modules/ToolJobRegistry.test.ts
git commit -m "feat(tool-jobs): add in-memory ToolJobRegistry with lifecycle, cancel, rate-limit"
```

---

### Task 11: Add async capability fields and the async dispatch branch

**Files:**
- Modify: `src/entityTypes/skillTypes.ts` (SkillDefinition)
- Modify: `src/service/AIChatQueryLoop.ts` (async dispatch in `executeToolWithTimeout`)
- Modify: `src/config/skillsRegistry.ts` (switch `search_maps_businesses` to async-capable)

- [ ] **Step 11.1: Add async fields to `SkillDefinition`**

In `src/entityTypes/skillTypes.ts`, inside `SkillDefinition`, after `supportsPartialResult?`, add:

```typescript
  /** When true (or when resolveAsync returns true), the tool runs async. */
  readonly async?: boolean;
  readonly resolveAsync?: (args: Record<string, unknown>) => boolean;
```

- [ ] **Step 11.2: Add a singleton registry accessor**

In `src/service/ToolJobRegistry.ts`, add at the bottom:

```typescript
let defaultRegistry: ToolJobRegistry | undefined;

export function getDefaultToolJobRegistry(): ToolJobRegistry {
  if (!defaultRegistry) defaultRegistry = new ToolJobRegistry();
  return defaultRegistry;
}

export function setDefaultToolJobRegistry(reg: ToolJobRegistry): void {
  defaultRegistry = reg;
}
```

- [ ] **Step 11.3: Implement `executeAsyncTool` in the loop**

In `src/service/AIChatQueryLoop.ts`, add a new private method:

```typescript
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { Token } from "@/modules/token";

private async executeAsyncTool(
  input: AIChatQueryLoopInput,
  call: { id: string; name: string; arguments?: Record<string, unknown> }
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();

  // Re-check AI enable gate before starting async work.
  const aiEnabled =
    new Token().getValue(USER_AI_ENABLED) === "true";
  if (!aiEnabled) {
    return {
      tool_call_id: call.id,
      tool_name: call.name,
      success: false,
      result: { error: "AI features are not enabled on this plan." },
      execution_time_ms: Date.now() - startedAt,
    };
  }

  const registry = getDefaultToolJobRegistry();
  const { jobId } = registry.start(
    call.name,
    call.arguments ?? {},
    { conversationId: input.conversationId, toolCallId: call.id },
    async (handle) => {
      try {
        const result = await this.deps.executeTool(
          call.name,
          call.arguments ?? {},
          {
            conversationId: input.conversationId,
            toolCallId: call.id,
            args: call.arguments,
          }
        );
        handle.resolve(result);
      } catch (err) {
        handle.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  );

  return {
    tool_call_id: call.id,
    tool_name: call.name,
    success: true,
    result: {
      async: true,
      job_id: jobId,
      status: registry.getStatus(jobId).status,
      message:
        "Tool is running asynchronously. Poll with check_tool_job_status(job_id) every 15-30s.",
    },
    execution_time_ms: Date.now() - startedAt,
  };
}
```

Update `executeToolWithTimeout` so that when `timeoutMs === null` (i.e. `cls === "async"`), it dispatches to `executeAsyncTool` instead of falling back to the browser ceiling:

```typescript
const timeoutMs = resolveTimeoutMs(cls);
if (timeoutMs === null) {
  return await this.executeAsyncTool(input, call);
}
const effectiveTimeoutMs = timeoutMs;
// ... existing race code using effectiveTimeoutMs ...
```

- [ ] **Step 11.4: Switch `search_maps_businesses` to async-capable**

In `src/config/skillsRegistry.ts`, replace the `timeoutClass: "browser"` line on `search_maps_businesses` with:

```typescript
    resolveTimeoutClass: (args) =>
      (args.max_results as number) > 20 || args.include_website === true
        ? "async"
        : "browser",
    resolveAsync: (args) =>
      (args.max_results as number) > 20 || args.include_website === true,
    supportsPartialResult: true,
```

(Keep `timeoutClass: "browser"` removed from this entry; the resolver takes precedence.)

- [ ] **Step 11.5: Type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 11.6: Add an async-dispatch test**

Append to `test/vitest/main/service/ToolExecutorAsync.test.ts` (new file):

```typescript
import { describe, it, expect } from "vitest";
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";
import {
  resolveTimeoutMs,
  inferTimeoutClassByName,
} from "@/service/ToolTimeoutPolicy";

describe("async dispatch contract", () => {
  it("search_maps_businesses resolves to async via name only when no resolver is set", () => {
    // The registry's resolver returns 'async' for heavy args. Without a resolver,
    // name inference returns 'browser'. Verify both branches.
    expect(resolveTimeoutMs("async")).to.equal(null);
    expect(resolveTimeoutMs("browser")).to.equal(240_000);
  });

  it("the default registry starts and returns a job_id", async () => {
    const reg = getDefaultToolJobRegistry();
    const { jobId } = reg.start(
      "x",
      {},
      { conversationId: "c", toolCallId: "tc" },
      async (handle) => handle.resolve({ ok: true })
    );
    expect(jobId).to.be.a("string");
    // Wait a microtask for resolve to land.
    await new Promise((r) => setTimeout(r, 10));
    const snap = reg.getStatus(jobId);
    expect(snap.status === "completed" || snap.status === "running").to.equal(true);
  });
});
```

- [ ] **Step 11.7: Run tests**

Run: `yarn testmain -- ToolExecutorAsync`
Expected: PASS.

- [ ] **Step 11.8: Commit**

```bash
git add src/entityTypes/skillTypes.ts src/service/ToolJobRegistry.ts src/service/AIChatQueryLoop.ts src/config/skillsRegistry.ts test/vitest/main/service/ToolExecutorAsync.test.ts
git commit -m "feat(async-tools): dispatch async-capable tools to ToolJobRegistry"
```

---

### Task 12: Register `check_tool_job_status` and `cancel_tool_job` tools

**Files:**
- Modify: `src/config/skillsRegistry.ts` (append two entries)

- [ ] **Step 12.1: Add `check_tool_job_status` to the registry**

In `src/config/skillsRegistry.ts`, append a new entry to the array (before the closing `]`):

```typescript
  {
    name: "check_tool_job_status",
    description:
      "Check the status of an async tool job. Returns one of: running, queued, completed, failed, cancelled, not_found, rate_limited. When return_partial_if_running=true, includes partial results collected so far. Poll at most once every 5 seconds per job_id.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job_id returned from an async tool call.",
        },
        return_partial_if_running: {
          type: "boolean",
          description:
            "If true and the job is still running, include partial results in the response.",
          default: false,
        },
      },
      required: ["job_id"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    timeoutClass: "fast",
    execute: async (args, context) => {
      const { getDefaultToolJobRegistry } = await import("@/service/ToolJobRegistry");
      const reg = getDefaultToolJobRegistry();
      const jobId = String(args.job_id ?? "");
      const wantPartial = args.return_partial_if_running === true;
      const snap = reg.getStatusForConversation(jobId, context.conversationId);
      const result: Record<string, unknown> = {
        job_id: jobId,
        status: snap.status,
        progress: snap.progress,
        started_at: snap.startedAt,
        completed_at: snap.completedAt,
      };
      if (wantPartial && snap.partial) {
        result.partial = snap.partial;
      }
      if (snap.status === "completed") result.result = snap.result;
      if (snap.status === "failed") result.error = snap.error;
      if (snap.retryAfterMs) result.retry_after_ms = snap.retryAfterMs;
      return { success: true, result };
    },
  },
```

- [ ] **Step 12.2: Add `cancel_tool_job` to the registry**

Append immediately after `check_tool_job_status`:

```typescript
  {
    name: "cancel_tool_job",
    description:
      "Cancel a running async tool job. Returns { cancelled: true } on success or { cancelled: false, reason } when the job has already completed or does not exist.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job_id to cancel.",
        },
      },
      required: ["job_id"],
    },
    tier: "main",
    requiresConfirmation: false,
    permissionCategory: "network",
    source: "built-in",
    timeoutClass: "fast",
    execute: async (args, context) => {
      const { getDefaultToolJobRegistry } = await import("@/service/ToolJobRegistry");
      const reg = getDefaultToolJobRegistry();
      const jobId = String(args.job_id ?? "");
      // Conversation-scoped: verify ownership before cancelling.
      const snap = reg.getStatusForConversation(jobId, context.conversationId);
      if (snap.status === "not_found") {
        return {
          success: true,
          result: { cancelled: false, reason: "not_found" },
        };
      }
      const result = reg.cancel(jobId);
      return { success: true, result };
    },
  },
```

- [ ] **Step 12.3: Type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 12.4: Run full main-process test suite**

Run: `yarn testmain`
Expected: PASS, no regressions.

- [ ] **Step 12.5: Commit**

```bash
git add src/config/skillsRegistry.ts
git commit -m "feat(async-tools): add check_tool_job_status and cancel_tool_job companion tools"
```

---

### Task 13: App shutdown hook to terminate running jobs

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 13.1: Add the shutdown hook**

In `src/background.ts`, find the `app.on("before-quit", ...)` handler (or add one if it does not exist). Add a call to shut down the registry:

```typescript
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";

app.on("before-quit", () => {
  try {
    getDefaultToolJobRegistry().shutdown();
  } catch (err) {
    console.error("[shutdown] ToolJobRegistry shutdown failed", err);
  }
});
```

If `before-quit` already has other handlers, add this at the top so workers are signalled early.

- [ ] **Step 13.2: Type check**

Run: `yarn tsc`
Expected: PASS.

- [ ] **Step 13.3: Commit**

```bash
git add src/background.ts
git commit -m "feat(shutdown): terminate running async tool jobs on app quit"
```

---

### Task 14: End-to-end manual verification + docs

- [ ] **Step 14.1: Build the app**

Run: `yarn build`
Expected: Build succeeds.

- [ ] **Step 14.2: Manual test — sync browser path**

Run `yarn dev`. In the AI chat:
1. Ask the assistant to call `search_maps_businesses` with `max_results: 5, include_website: false`.
2. Verify: progress events appear in the chat UI ("Found N of 5 businesses...").
3. Verify: the call completes within 240s without timeout.

- [ ] **Step 14.3: Manual test — async path**

In the AI chat:
1. Ask the assistant to call `search_maps_businesses` with `max_results: 50, include_website: true`.
2. Verify: the tool returns within ~2 seconds with `{ async: true, job_id: "..." }`.
3. Verify: the assistant calls `check_tool_job_status(job_id)` periodically.
4. Verify: progress events continue to appear while the job runs.
5. Mid-run, call `cancel_tool_job(job_id)`. Verify the worker exits within 5 seconds.

- [ ] **Step 14.4: Manual test — partial result on timeout**

In the AI chat:
1. Temporarily lower the browser ceiling (or call `search_maps_businesses` at `max_results: 5` against a slow network).
2. Verify: on timeout, the result has `partial: true` and `collectedCount > 0`, and the assistant discloses the partial data to the user.

- [ ] **Step 14.5: Update CHANGELOG**

Add an entry to `CHANGELOG.md` (if one exists) describing the new behavior under the next version heading.

- [ ] **Step 14.6: Final commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add timeout-resilience changelog entry"
```

---

## Self-Review Checklist (for the implementer)

After all tasks complete, verify:

- [ ] `yarn tsc` — no type errors.
- [ ] `yarn test` — Mocha suite green.
- [ ] `yarn testmain` — Vitest suite green.
- [ ] No `console.log` debug statements left in production code.
- [ ] Every new English-facing string has translations in `zh`, `es`, `fr`, `de`, `ja`.
- [ ] `git log --oneline` shows atomic commits per task, conventional-commits format.
- [ ] Manual sync/async/partial scenarios from Task 14 pass.

## Risks During Implementation

1. **Worker IPC contract drift.** The new `progress` and `collect_and_cancel` message types must be emitted by the worker processes, not just the modules. If a worker is not updated, the module's progress handler simply never fires — no crash. Verify the worker files in `src/childprocess/` are updated in Task 9.
2. **Race in `ToolExecutor.partialSnapshots`.** If a snapshot is overwritten between `requestPartialSnapshot` and the loop reading it, the loop gets the latest. That's acceptable; we always prefer the most recent partial data.
3. **`maxConcurrent: 4` may need tuning.** Watch CPU/memory during the Task 14 async test; if the machine struggles, lower to 2.
4. **Polling rate-limit edges.** The first poll is never rate-limited (`lastPolledAt === 0`). Subsequent polls tighter than `pollMinIntervalMs` return `rate_limited`. The model is told to retry after `retry_after_ms`.
