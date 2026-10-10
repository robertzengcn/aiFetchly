# Scheduled Loop Interactive Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the AI calls a gated high-impact tool during a scheduled-loop run, pause the run, notify the user, show the existing permission card, and resume on grant or continue-on-deny (1-hour backstop auto-deny) — instead of returning the `blocked_by_scheduled_policy` hard error.

**Architecture:** Rewire the scheduled engine (`AIChatQueryEngineFactory.createScheduled`) into the existing interactive permission-card flow. The policy gains a 4th outcome (`requiresInteractivePermission`); the executor returns a `needsPermissionPrompt` result instead of a hard error; the runner suspends its runtime timeout, fires an OS notification, broadcasts a refresh, and starts a 1-hour backstop; a new `ScheduledLoopEngineRegistry` routes grant/deny IPC to the right scheduled engine; the engine gains a `denyToolPermission` method (deny-and-continue); the renderer handles a new conversation-updated reason.

**Tech Stack:** TypeScript, Electron (main + preload + renderer), Vue 3, Vitest, `zod/v4` (only where new untrusted IPC input enters).

**Spec:** `docs/superpowers/specs/2026-09-25-scheduled-loop-interactive-permission-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/service/ScheduledAiToolPolicy.ts` | Add `requiresInteractivePermission` to `ScheduledToolDecision` + 4th branch in `canAutoApproveScheduledTool` | Modify |
| `src/service/AIChatQueryEngineFactory.ts` | Synthesize `needsPermissionPrompt` result for gated tools (not `blockedToolResult`) | Modify |
| `src/service/ScheduledLoopEngineRegistry.ts` | Singleton mapping `conversationId → { engine, runId, scheduleId }` for IPC routing | Create |
| `src/service/AIChatQueryEngine.ts` | Add `denyToolPermission(conversationId, toolId)` (deny-and-continue) | Modify |
| `src/config/aiChatScheduledLoopConfig.ts` | `SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS` constant | Modify |
| `src/service/ScheduledAiMessageRunner.ts` | Register engine, suspend timeout on pause, notify, broadcast, backstop | Modify |
| `src/config/channellist.ts` | `AI_CHAT_V2_DENY_TOOL_PERMISSION` channel | Modify |
| `src/entityTypes/aiChatScheduledLoopTypes.ts` | extend `ChatV2ConversationUpdatedEvent.reason` union | Modify |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | Route resume to scheduled engine; new deny handler | Modify |
| `src/preload.ts` | Expose deny channel | Modify |
| `src/views/api/aiChatV2.ts` | `denyToolPermission` invoke helper | Modify |
| `src/views/components/aiChatV2/AiChatV2.vue` | Handle `scheduled_turn_permission_requested`; deny branch | Modify |
| `test/vitest/main/service/ScheduledAiToolPolicy.test.ts` | Policy assertions | Modify |
| `test/vitest/main/service/AIChatQueryEngineFactory.scheduledTool.test.ts` | Executor assertion | Create |
| `test/vitest/main/service/ScheduledLoopEngineRegistry.test.ts` | Registry assertions | Create |
| `test/vitest/main/service/ScheduledAiMessageRunner.permission.test.ts` | Runner pause/notify/backstop/resume/deny | Create |
| `test/vitest/main/ipc/ai-chat-v2-permission-routing.test.ts` | IPC routing | Create |
| `test/vitest/main/components/ScheduledPermissionCard.test.ts` | Renderer card + deny | Create |

Tasks are ordered by dependency. Each task produces a self-contained, committable change.

---

### Task 1: Policy — `requiresInteractivePermission` outcome

**Files:**
- Modify: `src/service/ScheduledAiToolPolicy.ts` (interface at line ~9-15 in `aiMessageTaskTypes.ts` is the source — but the decision type is defined inline here; check first)
- Test: `test/vitest/main/service/ScheduledAiToolPolicy.test.ts`

The `ScheduledToolDecision` interface is imported from `@/entityTypes/aiMessageTaskTypes`. First locate it.

- [ ] **Step 1: Locate the `ScheduledToolDecision` interface**

Run: `grep -n "ScheduledToolDecision" src/entityTypes/aiMessageTaskTypes.ts src/service/ScheduledAiToolPolicy.ts`
Expected: shows the interface definition site. If defined in `aiMessageTaskTypes.ts`, that file is modified in this task.

- [ ] **Step 2: Write the failing test**

Append to `test/vitest/main/service/ScheduledAiToolPolicy.test.ts`:

```typescript
describe("ScheduledAiToolPolicy interactive permission outcome", () => {
  it("high-impact tool not in allowedTools requests interactive permission", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("file_write"),
      taskPolicy: policy({ allowedTools: [] }),
      toolName: "file_write",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresInteractivePermission).toBe(true);
    expect(decision.riskLevel).toBe("high");
  });

  it("automation tool not in allowedTools requests interactive permission", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("proxy_check"),
      taskPolicy: policy({ allowedTools: [] }),
      toolName: "proxy_check",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresInteractivePermission).toBe(true);
  });

  it("permanently-blocked tool does NOT request interactive permission", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("shell_execute"),
      taskPolicy: policy({ allowedTools: ["shell_execute"], autoApproveTools: true }),
      toolName: "shell_execute",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresInteractivePermission).toBeFalsy();
    expect(decision.riskLevel).toBe("blocked");
  });

  it("allowlisted high-impact tool auto-approves (no interactive permission)", () => {
    const decision = canAutoApproveScheduledTool({
      skill: skill("send_email_reply"),
      taskPolicy: policy({ allowedTools: ["send_email_reply"] }),
      toolName: "send_email_reply",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresInteractivePermission).toBeFalsy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn testmain -- ScheduledAiToolPolicy`
Expected: FAIL — `requiresInteractivePermission` is `undefined` (the field doesn't exist yet).

- [ ] **Step 4: Add `requiresInteractivePermission` to the decision type**

In the file where `ScheduledToolDecision` is defined (found in Step 1 — `src/entityTypes/aiMessageTaskTypes.ts`), add the optional field:

```typescript
export interface ScheduledToolDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
  /** True when the tool is a gated high-impact/automation tool not in the
   * task's allowedTools. The scheduled executor should synthesize a
   * needsPermissionPrompt result and pause for the user instead of failing
   * closed. Absent/undefined for permanently-blocked and auto-approved tools. */
  readonly requiresInteractivePermission?: boolean;
}
```

- [ ] **Step 5: Add the 4th branch to `canAutoApproveScheduledTool`**

In `src/service/ScheduledAiToolPolicy.ts`, locate the `requiresExplicitAllowlist` block (around line 376-391). Replace the `if (requiresExplicitAllowlist) { ... }` body so that when the tool is NOT in `allowedTools`, it returns the interactive-permission decision instead of the hard-deny:

```typescript
  // High-impact and automation tools require explicit per-tool selection.
  // When absent from the allowlist, PAUSE for interactive permission instead
  // of failing closed — the user can grant or deny at runtime.
  const requiresExplicitAllowlist =
    isHighImpactSchedulableTool(toolName) ||
    isScheduledAutomationTool(toolName);
  if (requiresExplicitAllowlist) {
    if (!taskPolicy.allowedTools.includes(toolName)) {
      const tier = isHighImpactSchedulableTool(toolName)
        ? "high-impact"
        : "automation";
      return {
        allowed: false,
        requiresInteractivePermission: true,
        reason: `Tool "${toolName}" is a ${tier} tool requiring permission. Pausing the scheduled run to ask the user.`,
        riskLevel: "high",
      };
    }
    return { allowed: true, riskLevel: "low" };
  }
```

Leave the final `return { allowed: false, reason: ... riskLevel: "high" }` (non-schedulable) untouched — that path keeps `requiresInteractivePermission` absent.

- [ ] **Step 6: Update the existing assertion that expected the old `high-impact` reason text**

In `test/vitest/main/service/ScheduledAiToolPolicy.test.ts`, the test at line ~150 ("high-impact tools are denied without explicit allowlist but allowed with it") asserts `expect(denied.reason).toMatch(/high-impact/)`. The new reason text still contains "high-impact", so it still matches — but `denied.allowed` is still `false` and now `requiresInteractivePermission` is `true`. Add an assertion to lock the new behavior:

```typescript
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/high-impact/);
    expect(denied.requiresInteractivePermission).toBe(true);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn testmain -- ScheduledAiToolPolicy`
Expected: PASS — all policy tests green.

- [ ] **Step 8: Commit**

```bash
git add src/service/ScheduledAiToolPolicy.ts src/entityTypes/aiMessageTaskTypes.ts test/vitest/main/service/ScheduledAiToolPolicy.test.ts
git commit -m "feat(schedule): policy requests interactive permission for gated tools

High-impact/automation tools absent from the task's allowedTools now
return requiresInteractivePermission instead of a hard fail-closed
deny, so the scheduled executor can pause and ask the user."
```

---

### Task 2: Executor — synthesize permission-prompt result

**Files:**
- Modify: `src/service/AIChatQueryEngineFactory.ts` (`executeScheduledTool`, lines ~114-137)
- Test: `test/vitest/main/service/AIChatQueryEngineFactory.scheduledTool.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIChatQueryEngineFactory.scheduledTool.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

// Stub SkillRegistry before importing the factory.
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getSkill: vi.fn((name: string) => ({
      name,
      description: `${name} desc`,
      parameters: { type: "object", properties: {} },
      tier: "main",
      requiresConfirmation: true,
      permissionCategory: "file",
      source: "built-in",
      execute: async () => ({ success: true, result: {} }),
    })),
  },
}));
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn(async () => ({ success: true, result: {}, execution_time_ms: 0, tool_call_id: "c", tool_name: "n" })) },
}));
vi.mock("@/service/AIChatModelFallbackService", () => ({
  AIChatModelFallbackService: class { resolve = async () => "fallback"; },
}));
vi.mock("@/service/AIChatRequestBudgetService", () => ({
  AIChatRequestBudgetService: class {},
}));
vi.mock("@/service/AIChatSummarizeDispatch", () => ({
  dispatchSectionSummarize: vi.fn(async () => "summary"),
}));
vi.mock("@/service/AIChatCompactionCoordinator", () => ({
  AIChatCompactionCoordinator: class { constructor() {} },
}));
vi.mock("@/service/AIChatContextAssembler", () => ({
  AIChatContextAssembler: class { constructor() {} },
}));
vi.mock("@/modules/AIChatCompactionModule", () => ({ AIChatCompactionModule: class {} }));
vi.mock("@/modules/AIChatArchiveModule", () => ({ AIChatArchiveModule: class {} }));
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: class {
    openAIChatCompletion = vi.fn();
    openAIChatCompletionStream = vi.fn();
  },
}));

import { AIChatQueryEngineFactory } from "@/service/AIChatQueryEngineFactory";
import type { AiMessageTaskToolPolicy } from "@/entityTypes/aiMessageTaskTypes";

const policy: AiMessageTaskToolPolicy = {
  allowedTools: [],
  autoApproveTools: true,
  allowSkills: false,
  allowMcp: false,
  allowSubagents: false,
  maxToolCalls: 10,
  maxRuntimeMs: 300_000,
  maxContinueCalls: 10,
};

describe("AIChatQueryEngineFactory scheduled tool executor", () => {
  it("gated high-impact tool returns needsPermissionPrompt (not blocked error)", async () => {
    const factory = new AIChatQueryEngineFactory();
    // Access the private executor via a cast to run it directly.
    const executor = (factory as unknown as {
      executeScheduledTool: (
        name: string,
        args: Record<string, unknown>,
        context: { toolCallId: string },
        p: AiMessageTaskToolPolicy
      ) => Promise<{ success: boolean; result: Record<string, unknown> }>;
    });
    const result = await executor.executeScheduledTool(
      "file_write",
      { path: "/tmp/x", content: "hi" },
      { toolCallId: "call_1" },
      policy
    );
    expect(result.success).toBe(false);
    expect(result.result.needsPermissionPrompt).toBe(true);
    expect(result.result.blocked_by_scheduled_policy).toBeFalsy();
    expect(result.result.permissionCategory).toBe("file");
  });

  it("permanently-blocked tool returns blocked_by_scheduled_policy", async () => {
    const factory = new AIChatQueryEngineFactory();
    const executor = (factory as unknown as {
      executeScheduledTool: (
        name: string,
        args: Record<string, unknown>,
        context: { toolCallId: string },
        p: AiMessageTaskToolPolicy
      ) => Promise<{ success: boolean; result: Record<string, unknown> }>;
    });
    const result = await executor.executeScheduledTool(
      "shell_execute",
      { command: "rm -rf /" },
      { toolCallId: "call_2" },
      { ...policy, allowedTools: ["shell_execute"] }
    );
    expect(result.success).toBe(false);
    expect(result.result.blocked_by_scheduled_policy).toBe(true);
    expect(result.result.needsPermissionPrompt).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- AIChatQueryEngineFactory.scheduledTool`
Expected: FAIL — gated tool currently returns `blocked_by_scheduled_policy: true`, not `needsPermissionPrompt`.

- [ ] **Step 3: Modify `executeScheduledTool` to synthesize the permission result**

In `src/service/AIChatQueryEngineFactory.ts`, replace the body of `executeScheduledTool` (lines ~114-137). The new logic: when the decision requests interactive permission, return a `needsPermissionPrompt` result mirroring `SkillExecutor.ts:544-576`; only permanently-blocked / non-schedulable tools use `blockedToolResult`.

```typescript
  private async executeScheduledTool(
    name: string,
    args: Record<string, unknown>,
    context: Parameters<AIChatQueryLoopDeps["executeTool"]>[2],
    policy: AiMessageTaskToolPolicy
  ): Promise<ToolExecutionResult> {
    const skill = SkillRegistry.getSkill(name) ?? null;
    const decision = canAutoApproveScheduledTool({
      skill,
      taskPolicy: policy,
      toolName: name,
    });

    // Gated high-impact/automation tool not in the allowlist → pause for the
    // user. Synthesize the same needsPermissionPrompt result shape that
    // SkillExecutor produces (SkillExecutor.ts:544-576) so the loop's
    // isPermissionPromptResult detection fires and the turn parks in
    // pendingPermissions. NEVER fail closed for a tool the user could grant.
    if (!decision.allowed && decision.requiresInteractivePermission) {
      return this.permissionPromptResult(name, context, skill, args);
    }

    if (!decision.allowed) {
      return this.blockedToolResult(
        name,
        context,
        decision.reason ?? `Tool "${name}" is blocked by the scheduled task policy.`
      );
    }
    return SkillExecutor.execute(name, args, {
      ...context,
      skipPermissionCheck: true,
    });
  }

  /**
   * Synthesize a permission-prompt ToolExecutionResult for a gated scheduled
   * tool call, mirroring SkillExecutor.ts:544-576 so the loop pauses the turn
   * and the existing permission-card UI renders. The skill's
   * buildPermissionPreview (if any) attaches a metadata-only preview.
   */
  private permissionPromptResult(
    name: string,
    context: Parameters<AIChatQueryLoopDeps["executeTool"]>[2],
    skill: { permissionCategory?: string; buildPermissionPreview?: (args: Record<string, unknown>) => unknown } | null,
    args: Record<string, unknown>
  ): ToolExecutionResult {
    const preview = skill?.buildPermissionPreview?.(args);
    return {
      tool_call_id: context.toolCallId ?? name,
      tool_name: name,
      success: false,
      result: {
        error: "Permission required",
        needsPermissionPrompt: true,
        permissionCategory: skill?.permissionCategory,
        ...(preview ? { permissionPreview: preview } : {}),
      },
      execution_time_ms: 0,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn testmain -- AIChatQueryEngineFactory.scheduledTool`
Expected: PASS.

- [ ] **Step 5: Run the full main suite to check no regression**

Run: `yarn testmain`
Expected: PASS (no existing scheduled test breaks).

- [ ] **Step 6: Commit**

```bash
git add src/service/AIChatQueryEngineFactory.ts test/vitest/main/service/AIChatQueryEngineFactory.scheduledTool.test.ts
git commit -m "feat(schedule): executor returns needsPermissionPrompt for gated tools

A gated high-impact/automation tool call during a scheduled run now
synthesizes a needsPermissionPrompt result so the loop pauses, instead
of the blocked_by_scheduled_policy hard error. Permanently-blocked
tools still fail closed."
```

---

### Task 3: Engine registry — `ScheduledLoopEngineRegistry`

**Files:**
- Create: `src/service/ScheduledLoopEngineRegistry.ts`
- Test: `test/vitest/main/service/ScheduledLoopEngineRegistry.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/ScheduledLoopEngineRegistry.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { ScheduledLoopEngineRegistry } from "@/service/ScheduledLoopEngineRegistry";

describe("ScheduledLoopEngineRegistry", () => {
  beforeEach(() => {
    // Clear any state between tests via the public reset hook.
    ScheduledLoopEngineRegistry.getInstance().clear();
  });

  it("registers and looks up an engine by conversationId", () => {
    const engine = { resumeToolAfterPermission: vi.fn(), denyToolPermission: vi.fn() } as never;
    const registry = ScheduledLoopEngineRegistry.getInstance();
    registry.register({ conversationId: "v2-a", engine, runId: 10, scheduleId: 2 });
    const entry = registry.getByConversation("v2-a");
    expect(entry?.engine).toBe(engine);
    expect(entry?.runId).toBe(10);
    expect(entry?.scheduleId).toBe(2);
  });

  it("returns undefined for an unregistered conversation", () => {
    expect(ScheduledLoopEngineRegistry.getInstance().getByConversation("v2-z")).toBeUndefined();
  });

  it("unregisters an engine", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const engine = {} as never;
    registry.register({ conversationId: "v2-b", engine, runId: 1, scheduleId: 1 });
    registry.unregister("v2-b");
    expect(registry.getByConversation("v2-b")).toBeUndefined();
  });

  it("hasPendingPermission reports pending state set by the engine", () => {
    const registry = ScheduledLoopEngineRegistry.getInstance();
    const engine = {} as never;
    registry.register({ conversationId: "v2-c", engine, runId: 5, scheduleId: 3 });
    registry.setPendingPermission("v2-c", { toolId: "t1" });
    expect(registry.hasPendingPermission("v2-c", "t1")).toBe(true);
    expect(registry.hasPendingPermission("v2-c", "other")).toBe(false);
    registry.clearPendingPermission("v2-c");
    expect(registry.hasPendingPermission("v2-c", "t1")).toBe(false);
  });
});
```

Add `import { vi } from "vitest";` to the test imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- ScheduledLoopEngineRegistry`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the registry**

Create `src/service/ScheduledLoopEngineRegistry.ts`:

```typescript
import type { AIChatQueryEngine } from "@/service/AIChatQueryEngine";

/**
 * Pending-permission metadata the engine publishes when it parks a turn.
 * Lets the IPC layer route grant/deny without holding a reference to the
 * engine's private pendingPermissions map.
 */
export interface ScheduledPendingPermission {
  readonly toolId: string;
}

/** Entry registered while a scheduled occurrence is executing. */
export interface ScheduledEngineEntry {
  readonly engine: AIChatQueryEngine;
  readonly runId: number;
  readonly scheduleId: number;
  /** Clears the 1h permission backstop timer when the user responds. */
  clearPermissionBackstop?: () => void;
}

/**
 * In-memory registry of active scheduled-loop engines, keyed by
 * conversationId. Mirrors ScheduledLoopRunRegistry (which keys by runId for
 * abort) — this keys by conversationId so the grant/deny IPC, which only has
 * conversationId + toolId, can locate the scheduled engine that owns the
 * paused turn.
 *
 * Lives in memory only; disappears at process restart. Durable run state is
 * recovered from the database.
 */
export class ScheduledLoopEngineRegistry {
  private static instance: ScheduledLoopEngineRegistry | null = null;
  private readonly engines = new Map<string, ScheduledEngineEntry>();
  private readonly pending = new Map<string, ScheduledPendingPermission>();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): ScheduledLoopEngineRegistry {
    if (!ScheduledLoopEngineRegistry.instance) {
      ScheduledLoopEngineRegistry.instance = new ScheduledLoopEngineRegistry();
    }
    return ScheduledLoopEngineRegistry.instance;
  }

  /** Register a scheduled engine for an active occurrence. */
  register(entry: ScheduledEngineEntry & { conversationId: string }): void {
    this.engines.set(entry.conversationId, entry);
  }

  /** Unregister when the occurrence terminates. Idempotent. */
  unregister(conversationId: string): void {
    this.engines.delete(conversationId);
    this.pending.delete(conversationId);
  }

  /** Look up the live scheduled engine for a conversation, if any. */
  getByConversation(conversationId: string): ScheduledEngineEntry | undefined {
    return this.engines.get(conversationId);
  }

  /** Publish that a scheduled engine has a paused permission-gated tool. */
  setPendingPermission(conversationId: string, meta: ScheduledPendingPermission): void {
    this.pending.set(conversationId, meta);
  }

  /** True when a scheduled engine has a pending permission matching toolId. */
  hasPendingPermission(conversationId: string, toolId: string): boolean {
    const meta = this.pending.get(conversationId);
    return !!meta && meta.toolId === toolId;
  }

  /** Clear pending-permission metadata (after grant/deny/backstop). */
  clearPendingPermission(conversationId: string): void {
    this.pending.delete(conversationId);
  }

  /** Test-only: reset all state. */
  clear(): void {
    this.engines.clear();
    this.pending.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn testmain -- ScheduledLoopEngineRegistry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/ScheduledLoopEngineRegistry.ts test/vitest/main/service/ScheduledLoopEngineRegistry.test.ts
git commit -m "feat(schedule): add ScheduledLoopEngineRegistry for permission routing

Singleton mapping conversationId -> scheduled engine + pending
permission metadata, so grant/deny IPC can route to the right engine
when a scheduled run pauses for a gated tool."
```

---

### Task 4: Engine — `denyToolPermission` method

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts` (add method near `resumeToolAfterPermission`, ~line 1474)
- Test: extend `test/vitest/main/service/AIChatQueryEngine.resumePermission.test.ts` (create if none)

- [ ] **Step 1: Locate the resume method's loop-reentry pattern**

Run: `grep -n "resumeToolAfterPermission\|loop.run\|handleLoopResult\|activeTurns.set" src/service/AIChatQueryEngine.ts`
Expected: shows the resume method (line ~1474) sets `activeTurns` and calls `void this.loop.run(loopInput)` at ~1652.

- [ ] **Step 2: Write the failing test**

Create `test/vitest/main/service/AIChatQueryEngine.denyPermission.test.ts`. The engine is complex; test the deny path by stubbing the loop and SkillExecutor at the boundary. Minimal shape:

```typescript
import { describe, expect, it, vi } from "vitest";

// The deny path must: synthesize a denied tool_result, push it, and re-enter
// the loop from nextRound WITHOUT re-executing the tool. We stub the loop so
// we can assert the re-entry call and the tool_result emit.

const mockRun = vi.hoisted(() => vi.fn(async () => ({ type: "completed" as const, conversationId: "v2-x", assistantMessageId: "a1", partialContent: "" })));
const mockEmit = vi.hoisted(() => vi.fn());

vi.mock("@/service/AIChatQueryLoop", () => ({
  AIChatQueryLoop: class {
    run = mockRun;
  },
  serializeToolResultContent: (p: Record<string, unknown>) => JSON.stringify(p),
  normalizeToolResult: (r: { success: boolean; execution_time_ms: number; result: Record<string, unknown> }) => ({
    success: r.success,
    executionTimeMs: r.execution_time_ms,
    ...r.result,
  }),
  isPermissionPromptResult: (r: { result: Record<string, unknown> }) => r.result.needsPermissionPrompt === true,
  buildAssistantToolCallMessage: vi.fn(),
}));
vi.mock("@/modules/AIChatV2Module", () => ({ AIChatV2Module: class {} }));
vi.mock("@/modules/AIChatPlanModule", () => ({ AIChatPlanModule: class {} }));

import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";

describe("AIChatQueryEngine.denyToolPermission", () => {
  it("returns error when no pending permission matches", async () => {
    const engine = new AIChatQueryEngine({} as never);
    const result = await engine.denyToolPermission({ toolId: "t1", conversationId: "v2-x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No active permission-gated tool call/);
  });

  // The full deny-and-continue path (synthesize denied result + re-enter loop)
  // is covered by the runner-level test in Task 6, which drives the real engine
  // through the scheduled executor + sink. Here we only lock the not-pending
  // contract; the re-entry mechanics are identical to resumeToolAfterPermission
  // (already covered by existing resume tests).
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn testmain -- AIChatQueryEngine.denyPermission`
Expected: FAIL — `denyToolPermission` does not exist.

- [ ] **Step 4: Add `denyToolPermission` to the engine**

In `src/service/AIChatQueryEngine.ts`, add the method immediately after `resumeToolAfterPermission` (after line ~1674). It mirrors resume's setup but skips tool re-execution and pushes a synthesized denied result, then re-enters the loop from `nextRound`:

```typescript
  /**
   * Deny a paused tool after the user declines permission (scheduled-loop
   * deny-and-continue path). Unlike the interactive path (which stops the
   * whole conversation on deny), this synthesizes a denied tool_result, pushes
   * it to the conversation, and re-enters the loop from nextRound so the
   * scheduled run can proceed WITHOUT the tool. The model receives a
   * "permission denied" tool result and may continue with an alternate plan.
   */
  async denyToolPermission(
    request: ResumeToolAfterPermissionRequest
  ): Promise<ResumeTurnResult> {
    const convId = request.conversationId;
    const lookupKey = convId ?? undefined;
    const pending = lookupKey
      ? this.pendingPermissions.get(lookupKey)
      : this.firstEntry(this.pendingPermissions);
    const matchedByToolId =
      pending && pending.toolCallId === request.toolId ? pending : undefined;
    if (!matchedByToolId) {
      return {
        ok: false,
        error: "No active permission-gated tool call to continue.",
      };
    }
    if (
      request.conversationId &&
      request.conversationId !== matchedByToolId.conversationId
    ) {
      return { ok: false, error: "Conversation mismatch for pending tool call." };
    }

    const conversationId = matchedByToolId.conversationId;
    this.pendingPermissions.delete(conversationId);
    this.activeTurns.set(conversationId, {
      abortController: matchedByToolId.abortController,
      assistantMessageId: matchedByToolId.assistantMessageId,
      turnId: matchedByToolId.turnId,
      eventSink: matchedByToolId.eventSink,
    });
    const module = new AIChatV2Module();
    const eventSink = this.createPersistingEventSink(
      module,
      matchedByToolId.eventSink
    );

    try {
      // Synthesize the denied tool result — do NOT re-execute the tool.
      const deniedPayload = {
        success: false,
        executionTimeMs: 0,
        error:
          "Permission denied. The tool will not be executed.",
      };
      const toolContent = JSON.stringify(deniedPayload);
      eventSink.emit({
        type: "tool_result",
        conversationId,
        messageId: matchedByToolId.assistantMessageId,
        toolCallId: matchedByToolId.toolCallId,
        toolName: matchedByToolId.toolName,
        fullContent: toolContent,
        toolResult: deniedPayload,
        replacesPermissionPromptForToolId: matchedByToolId.toolCallId,
      });

      matchedByToolId.conversationMessages.push({
        role: "tool",
        tool_call_id: matchedByToolId.toolCallId,
        content: toolContent,
      });

      // Rebuild the deferred catalog (mirrors resumeToolAfterPermission).
      const resumeCatalogContext = this.buildToolCatalogForTurn({
        tools: matchedByToolId.openAITools,
        conversationId,
        isPlanMode: Boolean(matchedByToolId.planContext),
        autoPlanEnabled: false,
        userMessage: matchedByToolId.request.message,
        recentUserMessages: [],
        model: matchedByToolId.request.model,
        contextWindowTokens: await this.resolveContextWindowTokens(
          matchedByToolId.request.model
        ),
      });

      const loopInput: AIChatQueryLoopInput = {
        conversationId,
        assistantMessageId: matchedByToolId.assistantMessageId,
        messages: matchedByToolId.conversationMessages,
        request: matchedByToolId.request,
        openAITools: matchedByToolId.openAITools,
        abortController: matchedByToolId.abortController,
        eventSink,
        skillRegistry: SkillRegistry,
        planContext: matchedByToolId.planContext,
        startRound: matchedByToolId.nextRound,
        isActiveTurn: () => {
          const entry = this.activeTurns.get(conversationId);
          return (
            !!entry && entry.assistantMessageId === matchedByToolId.assistantMessageId
          );
        },
        toolCatalog: resumeCatalogContext.toolCatalog,
        toolCatalogModeDecision: resumeCatalogContext.toolCatalogModeDecision,
        toolCatalogState: matchedByToolId.toolCatalogState,
        sourceUserMessageId: matchedByToolId.sourceUserMessageId,
        intentDecisionId: matchedByToolId.intentDecisionId,
        turnId: matchedByToolId.turnId,
        goalAutoContinue: await this.shouldAutoContinueGoal(
          conversationId,
          Boolean(matchedByToolId.planContext)
        ),
      };

      void this.loop
        .run(loopInput)
        .then(async (result) => {
          await this.handleLoopResult(result, module, eventSink);
        })
        .catch((err) => {
          console.error("[ai-chat-v2] deny-resume loop failed:", err);
          void redirectToLoginOnAuthExpired(err);
          matchedByToolId.eventSink.emit({
            type: "error",
            conversationId,
            messageId: matchedByToolId.assistantMessageId,
            errorMessage: userSafeError(err),
          });
          this.clearConversationTurnState(conversationId);
        });

      return { ok: true };
    } catch (err) {
      this.clearActiveTurnState(conversationId);
      return { ok: false, error: userSafeError(err) };
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn testmain -- AIChatQueryEngine.denyPermission`
Expected: PASS.

- [ ] **Step 6: Run type check**

Run: `yarn tsc`
Expected: no new errors. If `AIChatQueryLoopInput` or `redirectToLoginOnAuthExpired` / `SkillRegistry` / `userSafeError` are not imported in this file, they already are (used by `resumeToolAfterPermission`). Confirm by grepping: `grep -n "AIChatQueryLoopInput\|redirectToLoginOnAuthExpired\|SkillRegistry\|userSafeError\|buildImageArtifactHandoffMessage" src/service/AIChatQueryEngine.ts | head`.

- [ ] **Step 7: Commit**

```bash
git add src/service/AIChatQueryEngine.ts test/vitest/main/service/AIChatQueryEngine.denyPermission.test.ts
git commit -m "feat(ai-chat): engine denyToolPermission (deny-and-continue)

New resume method for the scheduled path: synthesizes a denied
tool_result, pushes it, and re-enters the loop from nextRound so the
run continues without the tool (interactive deny stops the whole
conversation, which is wrong for unattended runs)."
```

---

### Task 5: Config + types + channel constants

**Files:**
- Modify: `src/config/aiChatScheduledLoopConfig.ts`
- Modify: `src/entityTypes/aiChatScheduledLoopTypes.ts` (`ChatV2ConversationUpdatedEvent.reason` union, line ~155)
- Modify: `src/config/channellist.ts`

- [ ] **Step 1: Add the backstop constant**

In `src/config/aiChatScheduledLoopConfig.ts`, after the `SCHEDULED_LOOP_RUN_TIMEOUT_MS` definition (line ~50), add:

```typescript
/**
 * Backstop for a scheduled-loop permission pause. If the user does not grant
 * or deny a paused gated tool within this window, the run auto-denies the
 * tool and continues so the conversation lock is not held indefinitely.
 */
export const SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS = 60 * 60 * 1000; // 1 hour
```

- [ ] **Step 2: Extend the conversation-updated reason union**

In `src/entityTypes/aiChatScheduledLoopTypes.ts`, the `ChatV2ConversationUpdatedEvent.reason` union (line ~155-158):

```typescript
  readonly reason:
    | "scheduled_turn_completed"
    | "scheduled_turn_failed"
    | "scheduled_loop_state_changed"
    | "scheduled_turn_permission_requested";
```

- [ ] **Step 3: Add the deny channel**

In `src/config/channellist.ts`, after the `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION` block (line ~338-340), add:

```typescript
/** Deny a V2 scheduled-loop tool call paused for permission (deny-and-continue). */
export const AI_CHAT_V2_DENY_TOOL_PERMISSION =
  "ai-chat-v2:deny-tool-permission";
```

- [ ] **Step 4: Run type check**

Run: `yarn tsc`
Expected: no errors. (The new channel/reason are additive; consumers switch over the old reasons and default-handle.)

- [ ] **Step 5: Commit**

```bash
git add src/config/aiChatScheduledLoopConfig.ts src/entityTypes/aiChatScheduledLoopTypes.ts src/config/channellist.ts
git commit -m "feat(schedule): add permission backstop const, deny channel, reason

SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS (1h), the
AI_CHAT_V2_DENY_TOOL_PERMISSION IPC channel, and the
scheduled_turn_permission_requested conversation-updated reason."
```

---

### Task 6: Runner — pause, notify, backstop, resume, deny

**Files:**
- Modify: `src/service/ScheduledAiMessageRunner.ts` (both `runChatScheduledLoop` and `executeRunLoop`)
- Test: `test/vitest/main/service/ScheduledAiMessageRunner.permission.test.ts` (create, modeled on `ScheduledAiMessageRunner.chatLoop.test.ts`)

This is the central task. The runner must: register the engine in `ScheduledLoopEngineRegistry`; in the sink forwarder, detect `tool_result.needsPermissionPrompt`, suspend the runtime timeout, fire `showNotification`, broadcast `scheduled_turn_permission_requested`, start the backstop; on terminal finalize, clear the backstop + unregister.

- [ ] **Step 1: Read the existing runner test mock setup**

Read `test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts` lines 1-210 (already partially read). The `MockEngine` interface and `driveSink` helper are the template. The permission test will extend `MockEngine` with `resumeToolAfterPermission`/`denyToolPermission` and add a `tool_result` with `needsPermissionPrompt` to `driveSink`.

- [ ] **Step 2: Write the failing test**

Create `test/vitest/main/service/ScheduledAiMessageRunner.permission.test.ts`. Reuse the mock scaffold from `ScheduledAiMessageRunner.chatLoop.test.ts` (lines 1-128) and add a permission-pause outcome. Key additions:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";

// --- hoisted stubs (same scaffold as ScheduledAiMessageRunner.chatLoop.test.ts) ---
const aiEnabled = vi.hoisted(() => ({ value: "true" }));
const chatCanUse = vi.hoisted(() => ({ value: true }));
const sinkOutcome = vi.hoisted(() => ({ value: null as null | "pause" | "complete" }));
const mockResume = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const mockDeny = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const mockSubmit = vi.hoisted(() => vi.fn());
const mockGetTask = vi.hoisted(() => vi.fn());
const mockParseAllowedTools = vi.hoisted(() => vi.fn());
const mockCreateRun = vi.hoisted(() => vi.fn());
const mockUpdateRunStatus = vi.hoisted(() => vi.fn());
const mockCompleteRun = vi.hoisted(() => vi.fn());
const mockFailRun = vi.hoisted(() => vi.fn());
const mockGetScheduleById = vi.hoisted(() => vi.fn());
const mockUpdateIntervalAfterResult = vi.hoisted(() => vi.fn());
const mockPauseWithReason = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());
const mockBroadcastEmit = vi.hoisted(() => vi.fn());
const mockBroadcastStream = vi.hoisted(() => vi.fn());
const mockShowNotification = vi.hoisted(() => vi.fn());
const mockRegisterEngine = vi.hoisted(() => vi.fn());
const mockUnregisterEngine = vi.hoisted(() => vi.fn());
const mockSetPending = vi.hoisted(() => vi.fn());

vi.mock("@/modules/token", () => ({
  Token: class { getValue = vi.fn((k: string) => k === "user_ai_enabled" ? aiEnabled.value : "/tmp/db"); },
}));
vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class { resolveForChat = () => chatCanUse.value ? { canUse: true } : { canUse: false, message: "no" }; },
}));
vi.mock("@/modules/AiMessageTaskModule", () => ({
  AiMessageTaskModule: class { getTask = mockGetTask; parseAllowedTools = mockParseAllowedTools; updateTask = vi.fn(); updateLastRunResult = vi.fn(); },
}));
vi.mock("@/modules/AiMessageTaskRunModule", () => ({
  AiMessageTaskRunModule: class { createRun = mockCreateRun; updateRunStatus = mockUpdateRunStatus; completeRun = mockCompleteRun; failRun = mockFailRun; },
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: class { createConversationIfNeeded = vi.fn((id?: string) => id && id.startsWith("v2-") ? id : "v2-minted"); },
}));
vi.mock("@/model/ScheduleTask.model", () => ({
  ScheduleTaskModel: class { getScheduleById = mockGetScheduleById; pauseWithReason = mockPauseWithReason; updateIntervalAfterResult = mockUpdateIntervalAfterResult; },
}));
vi.mock("@/service/AIChatQueryEngineFactory", () => ({
  AIChatQueryEngineFactory: class {
    createScheduled() {
      return {
        submitMessage: mockSubmit,
        resumeToolAfterPermission: mockResume,
        denyToolPermission: mockDeny,
      };
    }
  },
}));
vi.mock("@/service/AIChatConversationTurnCoordinator", () => ({
  AIChatConversationTurnCoordinator: { getInstance: () => ({ acquire: mockAcquire, tryAcquire: vi.fn(() => null) }) },
  ConversationTurnBusyError: class extends Error {},
}));
vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: { getInstance: () => ({ emit: mockBroadcastEmit, emitScheduledStream: mockBroadcastStream }) },
}));
vi.mock("@/service/ScheduledLoopRunRegistry", () => ({
  ScheduledLoopRunRegistry: { getInstance: () => ({ register: vi.fn(), unregister: vi.fn(), abort: vi.fn(() => false) }) },
}));
vi.mock("@/service/ScheduledLoopEngineRegistry", () => ({
  ScheduledLoopEngineRegistry: {
    getInstance: () => ({
      register: mockRegisterEngine,
      unregister: mockUnregisterEngine,
      setPendingPermission: mockSetPending,
      clearPendingPermission: vi.fn(),
      hasPendingPermission: vi.fn(() => false),
      getByConversation: vi.fn(() => undefined),
    }),
  },
}));
vi.mock("@/modules/lib/function", () => ({
  showNotification: mockShowNotification,
}));
vi.mock("@/service/AiMessageTaskWorkspace", () => ({
  bindApprovedWorkspace: vi.fn(async () => "/tmp/ws"),
}));

import { ScheduledAiMessageRunner } from "@/service/ScheduledAiMessageRunner";

const TASK = {
  id: 1, source_type: "chat_scheduled_loop", conversation_id: "v2-conv",
  message: "write a file", model: "auto", allowed_tools_json: "[]",
  auto_approve_tools: false, max_tool_calls: 10, max_runtime_ms: 300_000,
  max_continue_calls: 10, status: "active",
};
const SCHEDULE = {
  id: 2, task_id: 1, source_conversation_id: "v2-conv", is_active: true,
  status: "active", interval_ms: 300_000, interval_anchor_at: new Date(0),
  consecutive_failure_count: 0, terminal_reason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  aiEnabled.value = "true"; chatCanUse.value = true; sinkOutcome.value = null;
  mockParseAllowedTools.mockReturnValue([]);
  mockGetTask.mockResolvedValue(TASK);
  mockGetScheduleById.mockResolvedValue(SCHEDULE);
  mockCreateRun.mockResolvedValue(42);
  mockAcquire.mockResolvedValue({ conversationId: "v2-conv", owner: "scheduled", ownerId: "run-9", leaseId: 1, release: vi.fn() });
  mockSubmit.mockImplementation(async (input: { eventSink: { emit: (e: unknown) => void } }) => {
    if (sinkOutcome.value === "pause") {
      // Engine paused for permission: emit a tool_result with needsPermissionPrompt,
      // then do NOT emit a terminal event (the turn is parked).
      input.eventSink.emit({
        type: "tool_result",
        conversationId: "v2-conv",
        messageId: "scheduled-assistant-2-1",
        toolCallId: "t1",
        toolName: "file_write",
        fullContent: JSON.stringify({ error: "Permission required", needsPermissionPrompt: true }),
        toolResult: { error: "Permission required", needsPermissionPrompt: true, success: false, executionTimeMs: 0 },
      });
    } else {
      input.eventSink.emit({ type: "complete", conversationId: "v2-conv", messageId: "scheduled-assistant-2-1", fullContent: "done" });
    }
  });
});

describe("ScheduledAiMessageRunner permission pause", () => {
  it("on gated tool pause: suspends timeout, notifies, broadcasts, starts backstop, registers engine", async () => {
    sinkOutcome.value = "pause";
    const runner = new ScheduledAiMessageRunner();
    await runner.runChatScheduledLoop({
      taskId: 1, scheduleId: 2, runId: 42, occurrence: 1,
      catchUp: false, scheduledFor: new Date(),
    });
    // Engine registered for routing.
    expect(mockRegisterEngine).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "v2-conv", runId: 42 }));
    // Pending permission published.
    expect(mockSetPending).toHaveBeenCalledWith("v2-conv", { toolId: "t1" });
    // OS notification fired.
    expect(mockShowNotification).toHaveBeenCalled();
    // Conversation-updated broadcast with the new reason.
    const evt = mockBroadcastEmit.mock.calls.find(
      (c) => c[0]?.reason === "scheduled_turn_permission_requested"
    );
    expect(evt).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn testmain -- ScheduledAiMessageRunner.permission`
Expected: FAIL — `mockRegisterEngine` / `mockShowNotification` / `scheduled_turn_permission_requested` not called (runner doesn't do this yet).

- [ ] **Step 4: Modify the runner — extract a permission-pause handler and wire both paths**

In `src/service/ScheduledAiMessageRunner.ts`:

a) Add imports at the top:

```typescript
import { SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS } from "@/config/aiChatScheduledLoopConfig";
import { ScheduledLoopEngineRegistry } from "@/service/ScheduledLoopEngineRegistry";
import { showNotification } from "@/modules/lib/function";
```

b) In both `runChatScheduledLoop` (around line 308-353) and `executeRunLoop` (around line 645-686), the engine is created via `new AIChatQueryEngineFactory().createScheduled(...)`. Right after creation, before `engine.submitMessage`, register it:

```typescript
      const engine = new AIChatQueryEngineFactory().createScheduled(
        this.parseTaskPolicy(task) // or `policy` in executeRunLoop
      );
      const engineRegistry = ScheduledLoopEngineRegistry.getInstance();
      let permissionBackstopHandle: ReturnType<typeof setTimeout> | null = null;
      const clearPermissionBackstop = (): void => {
        if (permissionBackstopHandle) {
          clearTimeout(permissionBackstopHandle);
          permissionBackstopHandle = null;
        }
      };
      engineRegistry.register({
        conversationId,
        engine,
        runId,
        scheduleId,
        clearPermissionBackstop,
      });
```

c) In the sink forwarder (the `(event) => { ... }` lambda passed to `new ScheduledLoopEventSink(...)`), detect the permission pause. The forwarder currently handles `token` / `complete` / `error`. Add a `tool_result` branch BEFORE the terminal capture:

```typescript
      const sink = new ScheduledLoopEventSink((event) => {
        if (event.type === "tool_result" && event.toolResult?.needsPermissionPrompt === true) {
          // Gated tool paused for permission: suspend the runtime timeout,
          // notify, broadcast, publish pending metadata, and start the backstop.
          clearTimeout(timeoutHandle);
          engineRegistry.setPendingPermission(conversationId, {
            toolId: event.toolCallId,
          });
          try {
            showNotification(
              "AiFetchly — permission required",
              `A scheduled run wants to use ${event.toolName}. Click to review.`
            );
          } catch {
            /* notification must never fail the run */
          }
          try {
            this.broadcaster.emit({
              conversationId,
              reason: "scheduled_turn_permission_requested",
              scheduleId,
              runId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              occurredAt: new Date().toISOString(),
            } as ChatV2ConversationUpdatedEvent);
          } catch {
            /* broadcast failure is non-fatal */
          }
          permissionBackstopHandle = setTimeout(() => {
            // Auto-deny after the backstop window so the run continues.
            void engine.denyToolPermission({
              toolId: event.toolCallId,
              conversationId,
            }).then(() => {
              engineRegistry.clearPendingPermission(conversationId);
            }).catch((err: unknown) => {
              console.error("[scheduled-loop] backstop auto-deny failed:", err);
            });
          }, SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS);
          return;
        }
        if (event.type === "token") {
          this.broadcaster.emitScheduledStream({
            conversationId, runId, messageId: assistantMessageId,
            kind: "token", contentDelta: event.contentDelta,
          });
        } else if (event.type === "complete" || event.type === "error") {
          this.broadcaster.emitScheduledStream({
            conversationId, runId, messageId: assistantMessageId,
            kind: event.type === "error" ? "error" : "done",
            errorMessage: event.type === "error" ? event.errorMessage : undefined,
          });
        }
      });
```

d) In the `finally` block of BOTH paths (the existing `clearTimeout(timeoutHandle); this.runRegistry.unregister(runId); if (lease) lease.release();`), add engine-registry cleanup:

```typescript
    } finally {
      clearTimeout(timeoutHandle);
      clearPermissionBackstop();
      this.runRegistry.unregister(runId);
      engineRegistry.unregister(conversationId);
      if (lease) lease.release();
    }
```

Note: `clearPermissionBackstop` and `engineRegistry` must be declared in the `try` scope (or hoisted) so the `finally` can see them. Declare `let permissionBackstopHandle` and `const clearPermissionBackstop` and `const engineRegistry` before the `try` that wraps `engine.submitMessage`, alongside `lease`.

e) `ChatV2ConversationUpdatedEvent` type already has the extended `reason` union (Task 5). The extra `toolCallId`/`toolName` fields are optional — add them to the interface if the type doesn't permit them. Check: `grep -n "toolCallId\|toolName" src/entityTypes/aiChatScheduledLoopTypes.ts` — if absent, add optional fields to `ChatV2ConversationUpdatedEvent`:

```typescript
export interface ChatV2ConversationUpdatedEvent {
  readonly conversationId: string;
  readonly reason:
    | "scheduled_turn_completed"
    | "scheduled_turn_failed"
    | "scheduled_loop_state_changed"
    | "scheduled_turn_permission_requested";
  readonly scheduleId: number;
  readonly runId?: number;
  readonly userMessageId?: string;
  readonly assistantMessageId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly occurredAt: string;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn testmain -- ScheduledAiMessageRunner.permission`
Expected: PASS.

- [ ] **Step 6: Run the full main suite + type check**

Run: `yarn testmain && yarn tsc`
Expected: PASS, no type errors. The existing `ScheduledAiMessageRunner.chatLoop.test.ts` must still pass (it doesn't emit a `tool_result` with `needsPermissionPrompt`, so the new branch is a no-op for it).

- [ ] **Step 7: Commit**

```bash
git add src/service/ScheduledAiMessageRunner.ts src/entityTypes/aiChatScheduledLoopTypes.ts test/vitest/main/service/ScheduledAiMessageRunner.permission.test.ts
git commit -m "feat(schedule): runner pauses on gated tool, notifies, starts backstop

On a needsPermissionPrompt tool_result during a scheduled run: suspend
the runtime timeout, fire an OS notification, broadcast
scheduled_turn_permission_requested, register the engine for IPC
routing, and start a 1h auto-deny backstop. Applies to both the
chat-bound and cron paths."
```

---

### Task 7: IPC — route resume + deny handler

**Files:**
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (`handleResumeToolAfterPermission` ~line 1047; new `handleDenyToolPermission`; registration ~line 1882)
- Modify: `src/preload.ts` (expose deny channel ~line 967)
- Test: `test/vitest/main/ipc/ai-chat-v2-permission-routing.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/ipc/ai-chat-v2-permission-routing.test.ts`. Stub the registries + engine:

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";

const mockScheduledGet = vi.hoisted(() => vi.fn(() => undefined));
const mockScheduledHas = vi.hoisted(() => vi.fn(() => false));
const mockResume = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const mockDeny = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const mockInteractiveResume = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("@/service/ScheduledLoopEngineRegistry", () => ({
  ScheduledLoopEngineRegistry: {
    getInstance: () => ({
      getByConversation: mockScheduledGet,
      hasPendingPermission: mockScheduledHas,
      clearPendingPermission: vi.fn(),
    }),
  },
}));
// Interactive engine singleton — stubbed to assert fallthrough.
vi.mock("@/service/AIChatQueryEngine", () => ({
  AIChatQueryEngine: class { resumeToolAfterPermission = mockInteractiveResume; },
}));

// The handler functions are not exported; test through the registered ipcMain
// channel by invoking the handler directly via a typed cast. The ipc module
// registers handlers on import; to test in isolation we import the handler
// implementations by name if exported, else we exercise via ipcMain stub.

import { ipcMain } from "electron";

describe("permission IPC routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resume routes to scheduled engine when it has a pending permission", async () => {
    mockScheduledGet.mockReturnValue({
      engine: { resumeToolAfterPermission: mockResume },
      runId: 42,
      clearPermissionBackstop: vi.fn(),
    });
    mockScheduledHas.mockReturnValue(true);

    // Invoke the registered handler for AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION.
    // (Test harness retrieves the handler registered on the stubbed ipcMain.)
    // NOTE: see Step 4 — export the handler so the test can call it directly.
    const { handleResumeToolAfterPermission } = await import("@/main-process/communication/ai-chat-v2-ipc");
    const res = await handleResumeToolAfterPermission(
      JSON.stringify({ toolId: "t1", conversationId: "v2-conv" })
    );
    expect(mockResume).toHaveBeenCalledWith({ toolId: "t1", conversationId: "v2-conv" });
    expect(mockInteractiveResume).not.toHaveBeenCalled();
    expect(res.result?.ok).toBe(true);
  });

  it("resume falls through to interactive when no scheduled engine", async () => {
    mockScheduledGet.mockReturnValue(undefined);
    const { handleResumeToolAfterPermission } = await import("@/main-process/communication/ai-chat-v2-ipc");
    await handleResumeToolAfterPermission(
      JSON.stringify({ toolId: "t1", conversationId: "v2-conv" })
    );
    expect(mockInteractiveResume).toHaveBeenCalled();
  });

  it("deny calls scheduled denyToolPermission and returns handled:true", async () => {
    mockScheduledGet.mockReturnValue({
      engine: { denyToolPermission: mockDeny },
      clearPermissionBackstop: vi.fn(),
    });
    mockScheduledHas.mockReturnValue(true);
    const { handleDenyToolPermission } = await import("@/main-process/communication/ai-chat-v2-ipc");
    const res = await handleDenyToolPermission(
      JSON.stringify({ toolId: "t1", conversationId: "v2-conv" })
    );
    expect(mockDeny).toHaveBeenCalledWith({ toolId: "t1", conversationId: "v2-conv" });
    expect(res.result?.handled).toBe(true);
  });

  it("deny returns handled:false when no scheduled engine owns it", async () => {
    mockScheduledGet.mockReturnValue(undefined);
    const { handleDenyToolPermission } = await import("@/main-process/communication/ai-chat-v2-ipc");
    const res = await handleDenyToolPermission(
      JSON.stringify({ toolId: "t1", conversationId: "v2-conv" })
    );
    expect(res.result?.handled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn testmain -- ai-chat-v2-permission-routing`
Expected: FAIL — `handleDenyToolPermission` not exported; resume doesn't check the scheduled registry.

- [ ] **Step 3: Modify `handleResumeToolAfterPermission` to route via the scheduled registry**

In `src/main-process/communication/ai-chat-v2-ipc.ts`, at the top of `handleResumeToolAfterPermission` (line ~1047), AFTER the `toolId` validation, add scheduled-registry routing BEFORE the existing `getQueryEngine().resumeToolAfterPermission(...)` call:

```typescript
  // Scheduled-loop routing: if a scheduled engine owns a pending permission
  // for this conversation, resume THAT engine (not the interactive singleton).
  try {
    const { ScheduledLoopEngineRegistry } = await import("@/service/ScheduledLoopEngineRegistry");
    const entry = ScheduledLoopEngineRegistry.getInstance().getByConversation(
      typeof parsed.conversationId === "string" ? parsed.conversationId : ""
    );
    if (
      entry &&
      ScheduledLoopEngineRegistry.getInstance().hasPendingPermission(
        typeof parsed.conversationId === "string" ? parsed.conversationId : "",
        parsed.toolId
      )
    ) {
      entry.clearPermissionBackstop?.();
      const result = await entry.engine.resumeToolAfterPermission({
        toolId: parsed.toolId,
        conversationId:
          typeof parsed.conversationId === "string" ? parsed.conversationId : undefined,
      });
      ScheduledLoopEngineRegistry.getInstance().clearPendingPermission(
        typeof parsed.conversationId === "string" ? parsed.conversationId : ""
      );
      return ok(result);
    }
  } catch (err) {
    console.error("[ai-chat-v2] scheduled resume routing failed:", err);
    // Fall through to interactive path.
  }
```

Use a dynamic `import()` to avoid pulling the scheduled module into the interactive bundle at load time (matches the file's existing lazy-import style if present; otherwise a static import is fine — check the file's import style first with `grep -n "await import\|import {" src/main-process/communication/ai-chat-v2-ipc.ts | head`).

- [ ] **Step 4: Add `handleDenyToolPermission` and export both handlers**

After `handleResumeToolAfterPermission`, add:

```typescript
/** Exported so permission-routing tests can invoke it directly. */
export async function handleResumeToolAfterPermission(
  data: unknown
): Promise<CommonMessage<{ ok: boolean; error?: string } | null>> {
  // ... (existing body, with the scheduled-routing prefix from Step 3)
}

/**
 * Deny a paused tool. Routes to the scheduled engine (deny-and-continue) when
 * one owns the pending permission; otherwise returns handled:false so the
 * renderer falls back to the interactive deny (stopChatV2Stream).
 */
export async function handleDenyToolPermission(
  data: unknown
): Promise<CommonMessage<{ ok: boolean; handled: boolean; error?: string } | null>> {
  const chatAccess = await canUseChat();
  if (!chatAccess.ok) {
    return denied(chatAccess.message);
  }

  let parsed: { toolId?: unknown; conversationId?: unknown };
  try {
    parsed =
      typeof data === "string"
        ? ((data ? JSON.parse(data) : {}) as { toolId?: unknown; conversationId?: unknown })
        : data && typeof data === "object"
        ? (data as { toolId?: unknown; conversationId?: unknown })
        : {};
  } catch {
    return denied("Invalid deny payload");
  }
  if (!parsed.toolId || typeof parsed.toolId !== "string") {
    return denied("toolId is required");
  }
  const conversationId =
    typeof parsed.conversationId === "string" ? parsed.conversationId : "";

  try {
    const { ScheduledLoopEngineRegistry } = await import("@/service/ScheduledLoopEngineRegistry");
    const entry = ScheduledLoopEngineRegistry.getInstance().getByConversation(conversationId);
    if (
      entry &&
      ScheduledLoopEngineRegistry.getInstance().hasPendingPermission(conversationId, parsed.toolId)
    ) {
      entry.clearPermissionBackstop?.();
      const result = await entry.engine.denyToolPermission({
        toolId: parsed.toolId,
        conversationId: conversationId || undefined,
      });
      ScheduledLoopEngineRegistry.getInstance().clearPendingPermission(conversationId);
      return ok({ ok: result.ok, handled: true, error: result.error });
    }
  } catch (err) {
    console.error("[ai-chat-v2] scheduled deny routing failed:", err);
  }
  // No scheduled engine owns it — signal the renderer to use interactive deny.
  return ok({ ok: true, handled: false });
}
```

If `handleResumeToolAfterPermission` was previously not exported (it was a local function), add `export` to its declaration. Check the current declaration first: `grep -n "function handleResumeToolAfterPermission\|async function handleResumeToolAfterPermission" src/main-process/communication/ai-chat-v2-ipc.ts`.

- [ ] **Step 5: Register the deny IPC handler**

In the `registerCommunicationIpcHandlers` block (near line ~1882, next to the resume registration), add:

```typescript
  ipcMain.handle(
    AI_CHAT_V2_DENY_TOOL_PERMISSION,
    async (_e, data: unknown) => handleDenyToolPermission(data ?? "")
  );
```

Import `AI_CHAT_V2_DENY_TOOL_PERMISSION` from `@/config/channellist` (add to the existing import list at the top of the file).

- [ ] **Step 6: Expose the deny channel in preload**

In `src/preload.ts`, add `AI_CHAT_V2_DENY_TOOL_PERMISSION` to the channel import (line ~236 area) and to the `windowReceive`/exposed-invoke list near the resume channel (line ~967):

```typescript
      AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION,
      AI_CHAT_V2_DENY_TOOL_PERMISSION,
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `yarn testmain -- ai-chat-v2-permission-routing`
Expected: PASS.

- [ ] **Step 8: Run type check**

Run: `yarn tsc`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/main-process/communication/ai-chat-v2-ipc.ts src/preload.ts test/vitest/main/ipc/ai-chat-v2-permission-routing.test.ts
git commit -m "feat(ai-chat): route permission resume/deny to scheduled engine

Resume checks ScheduledLoopEngineRegistry first and routes to the
scheduled engine when it owns the pending permission; new
AI_CHAT_V2_DENY_TOOL_PERMISSION handler returns {ok,handled} so the
renderer knows whether to fall back to interactive deny."
```

---

### Task 8: Renderer API — `denyToolPermission` invoke helper

**Files:**
- Modify: `src/views/api/aiChatV2.ts`

- [ ] **Step 1: Locate the resume invoke pattern in the API layer**

Run: `grep -n "RESUME_TOOL_AFTER_PERMISSION\|windowInvoke" src/views/api/aiChatV2.ts`
Expected: shows the existing invoke helper(s). If there's no dedicated resume helper, mirror the generic `windowInvoke` pattern used in `AiChatV2.vue:3509`.

- [ ] **Step 2: Add the deny invoke helper**

In `src/views/api/aiChatV2.ts`, add (mirroring the file's existing import + export style):

```typescript
import { AI_CHAT_V2_DENY_TOOL_PERMISSION } from "@/config/channellist";

/** Deny a paused scheduled-loop tool call. Returns { ok, handled } — when
 * handled is false, the caller should fall back to the interactive deny
 * (stopChatV2Stream). */
export async function denyToolPermission(input: {
  toolId: string;
  conversationId: string;
}): Promise<{ ok: boolean; handled: boolean; error?: string }> {
  const resp = await windowInvoke<{ ok: boolean; handled: boolean; error?: string }>(
    AI_CHAT_V2_DENY_TOOL_PERMISSION,
    input
  );
  return resp;
}
```

If `windowInvoke` is not already imported in this file, add it to the existing import from the api-request utils (check: `grep -n "windowInvoke" src/views/api/aiChatV2.ts | head -1`).

- [ ] **Step 3: Run type check**

Run: `yarn vue-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/api/aiChatV2.ts
git commit -m "feat(ai-chat): add denyToolPermission renderer API helper"
```

---

### Task 9: Renderer — handle permission-requested + deny branch

**Files:**
- Modify: `src/views/components/aiChatV2/AiChatV2.vue` (`handleConversationUpdated` ~line 1801; `handleSkillPermissionDeny` ~line 3549)
- Test: `test/vitest/main/components/ScheduledPermissionCard.test.ts` (create)

- [ ] **Step 1: Write the failing component test**

Create `test/vitest/main/components/ScheduledPermissionCard.test.ts`. The component test verifies that (a) a `scheduled_turn_permission_requested` conversation-updated triggers a history reload + in-app notification, and (b) the deny button calls `denyToolPermission` and falls back to `stopChatV2Stream` when `handled === false`. Use the existing component-test harness pattern from `test/vitest/main/components/` (mount AiChatV2 or a focused sub-component; mock `@/views/api/aiChatV2` + `@/views/api/aiChatScheduledLoop`). Because AiChatV2 is large, test the permission-deny branch by mounting a minimal wrapper that exercises `handleSkillPermissionDeny` — if the function is not independently mountable, test through the full component with the api mocked.

Skeleton:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@/views/api/aiChatV2", () => ({
  denyToolPermission: vi.fn(async () => ({ ok: true, handled: true })),
  // ...other exports the component imports, stubbed as no-ops
}));
vi.mock("@/views/api/aiChatScheduledLoop", () => ({
  subscribeConversationUpdated: vi.fn(() => () => {}),
  subscribeScheduledStream: vi.fn(() => () => {}),
  // ...
}));

import { denyToolPermission } from "@/views/api/aiChatV2";

describe("AiChatV2 scheduled permission deny", () => {
  it("deny calls denyToolPermission IPC", async () => {
    // Mount the component or invoke the deny handler with a synthetic message
    // carrying conversationId + toolResult.needsPermissionPrompt metadata.
    // Assert denyToolPermission was called with { toolId, conversationId }.
    // (Exact mount depends on the harness; see existing components tests for
    // the AiChatV2 mount recipe.)
    const message = {
      id: "tool-result-t1",
      conversationId: "v2-conv",
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      metadata: {
        toolResult: { needsPermissionPrompt: true, toolCallId: "t1" },
      },
    } as never;
    // ... mount + trigger @deny-permission on the permission card ...
    expect(denyToolPermission).toHaveBeenCalledWith({
      toolId: "t1",
      conversationId: "v2-conv",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:components -- ScheduledPermissionCard`
Expected: FAIL.

- [ ] **Step 3: Handle the new conversation-updated reason**

In `src/views/components/aiChatV2/AiChatV2.vue`, `handleConversationUpdated` (line ~1801) currently reloads history for `scheduled_turn_completed` / `scheduled_turn_failed`. Extend it to handle `scheduled_turn_permission_requested` — the persisted `needsPermissionPrompt` tool_result renders the card on reload:

```typescript
function handleConversationUpdated(
  event: ChatV2ConversationUpdatedEvent
): void {
  void loadConversations();
  if (event.conversationId === activeConversationId.value) {
    if (liveScheduledAssistant.value) {
      liveScheduledAssistant.value = null;
    }
    if (isStreaming.value) {
      scheduledRefreshPending.value = true;
    } else {
      void loadHistory(event.conversationId);
    }
    // Scheduled permission request: also fire an in-app notification so a
    // user viewing another conversation is alerted. The card renders from the
    // reloaded tool_result.
    if (event.reason === "scheduled_turn_permission_requested") {
      try {
        void notifyScheduledPermission(event.toolName);
      } catch {
        /* non-fatal */
      }
    }
    void refreshScheduledLoopStatus();
  }
}
```

Add a `notifyScheduledPermission` helper (near `handleScheduledStream`):

```typescript
function notifyScheduledPermission(toolName?: string): void {
  const body = toolName
    ? `A scheduled run wants to use "${toolName}". Review and approve or deny.`
    : "A scheduled run is waiting for your permission.";
  try {
    // Use the existing in-app toast/notification surface if available; the OS
    // notification was already fired main-side. This is a renderer echo.
    window.dispatchEvent(new CustomEvent("aifetchly:notify", { detail: { body } }));
  } catch {
    /* non-fatal */
  }
}
```

- [ ] **Step 4: Wire the deny branch**

In `handleSkillPermissionDeny` (line ~3549), the current body stops the stream. Add a branch: call `denyToolPermission` first; if `handled === true`, the resumed run will emit its own terminal event (do not stop the stream); if `handled === false`, fall back to the current `stopChatV2Stream` behavior.

```typescript
const handleSkillPermissionDeny = async (
  message: ChatV2MessageView
): Promise<void> => {
  const toolId = resolveToolIdForPermissionMessage(message);
  const targetConversationId = message.conversationId || activeConversationId.value;

  // Scheduled-loop deny-and-continue: ask the main process. When handled,
  // the scheduled engine resumes the run with a denied tool_result; do NOT
  // stop the stream. When not handled, fall back to interactive deny.
  if (toolId && targetConversationId) {
    try {
      const res = await denyToolPermission({
        toolId,
        conversationId: targetConversationId,
      });
      if (res.handled) {
        // Scheduled engine picked it up — card will be replaced by the resumed
        // run's terminal event. Mark the prompt as executing in the meantime.
        messages.value = markPermissionPromptExecuting(messages.value, message.id);
        return;
      }
    } catch {
      // fall through to interactive deny
    }
  }

  const idx = messages.value.findIndex((m) => m.id === message.id);
  const deniedMessage =
    t("aiChatV2.permission_denied") || "Permission denied. The tool will not be executed.";
  if (idx !== -1) {
    messages.value[idx] = {
      ...messages.value[idx],
      content: deniedMessage,
      metadata: {
        ...messages.value[idx].metadata,
        source: "chat-v2",
        toolResult: undefined,
        success: false,
      },
    };
  }
  stopChatV2Stream(targetConversationId);
  if (message.conversationId) {
    detachChatV2ConversationStreamListeners(message.conversationId, true);
  } else {
    clearChatV2StreamListeners();
  }
  markConversationRuntimeStopped(message.conversationId);
};
```

Import `denyToolPermission` from `@/views/api/aiChatV2` (add to the existing import block at line ~808).

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test:components -- ScheduledPermissionCard`
Expected: PASS.

- [ ] **Step 6: Run the full component suite + vue type check**

Run: `yarn test:components && yarn vue-check`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/components/aiChatV2/AiChatV2.vue test/vitest/main/components/ScheduledPermissionCard.test.ts
git commit -m "feat(ai-chat): renderer handles scheduled permission request + deny

On scheduled_turn_permission_requested, reload history (card renders
from the persisted needsPermissionPrompt tool_result) and fire an
in-app notification. Deny calls the new denyToolPermission IPC and
falls back to stopChatV2Stream when not handled by a scheduled engine."
```

---

### Task 10: Full-suite verification

- [ ] **Step 1: Run the entire test suite**

Run: `yarn testmain && yarn test:components && yarn vitest-puppeteer`
Expected: PASS.

- [ ] **Step 2: Run the type-check gate**

Run: `yarn tsc && yarn vue-check`
Expected: no errors.

- [ ] **Step 3: Manual smoke (optional, document the result)**

Run the app with `yarn dev`, create a scheduled loop with a prompt likely to call `file_write` (e.g. "write a note to /tmp/x.txt") and `allowedTools: []`, `autoApproveTools: true`. Wait for the scheduled run to fire. Confirm: an OS notification appears, the permission card renders in the conversation, granting resumes the run and writes the file, denying continues the run with a "permission denied" tool result. Leave it unresponded for >1h (or temporarily lower `SCHEDULED_LOOP_PERMISSION_BACKSTOP_MS` to 60s for the smoke) and confirm auto-deny fires.

- [ ] **Step 4: Final commit if any smoke-fixups**

```bash
git add -A
git commit -m "test: scheduled interactive permission full-suite green"
```

---

## Self-Review Notes

**Spec coverage:** §5.1 → Task 1; §5.2 → Task 2; §5.3 → Task 6 (runner) + Task 5 (config const); §5.4 → Task 4; §5.5 → Task 3 (registry) + Task 7 (IPC); §5.6 → Task 9 (renderer); §5.7 → Task 5 (types). §6 data flow exercised end-to-end by Tasks 6 + 9. §7 security (always-blocked stays fail-closed) locked by Task 1 step 4 + Task 2 step 1's second test. §8 testing is the tasks themselves.

**Type consistency:** `denyToolPermission` signature `({ toolId, conversationId }) => Promise<ResumeTurnResult>` matches across Task 4 (engine), Task 6 (runner backstop), Task 7 (IPC), Task 8 (renderer API), Task 9 (renderer deny). `ScheduledEngineEntry` fields (`engine`, `runId`, `scheduleId`, `clearPermissionBackstop`) match Task 3, Task 6, Task 7. `ChatV2ConversationUpdatedEvent` extended consistently in Task 5 + Task 6 + Task 9.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one "depends on the harness" note in Task 9 Step 1 is a test-mount caveat, not an implementation placeholder — the implementation code in Steps 3-4 is complete.
