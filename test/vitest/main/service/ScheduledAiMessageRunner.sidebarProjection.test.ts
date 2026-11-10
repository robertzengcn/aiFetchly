import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

/**
 * BUGFIX 2026-11-02 — "create a schedule with a new workspace path, click
 * Run Now — the new workspace still not show under the left project menu".
 *
 * Integration reproduction of the full main-side chain with a REAL SQLite DB:
 *
 *   createTask (binds the workspace, resolved key) → ScheduledAiMessageRunner.run
 *   → binding + summary broadcasts + (fix under test) sidebar projection row
 *   → AIChatConversationModule.getWorkspaceSidebar must return the workspace
 *     folder containing the schedule's conversation.
 *
 * Root cause at this layer: NOTHING on the standalone schedule path created
 * the ai_chat_conversations projection row for the brand-new conversation.
 *getWorkspaceSidebar only renders projected conversations, so even a manual
 * sidebar refresh had nothing to show until an app restart (the
 * once-per-process backfill runs at the first bootstrap only). The
 * owner-adapter broadcasts arrived, but the authoritative projection the
 * renderer refetches had no row — the debounced regroup dropped the
 * locally-seen summary row.
 */

const engineOutcome = vi.hoisted(() => ({
  value: null as { type: "complete"; content?: string } | null,
}));
const mockRunTurn = vi.hoisted(() => vi.fn());
const mockAcquire = vi.hoisted(() => vi.fn());

function createMockClass<T extends object>(
  factory: () => T
): { new (...args: never[]): T } {
  const cls = function (this: T) {
    Object.assign(this, factory());
  } as unknown as { new (...args: never[]): T };
  return cls;
}

const testDbDir = vi.hoisted(() => () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os2 = require("os") as typeof import("os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path2 = require("path") as typeof import("path");
  const poolId = process.env.VITEST_POOL_ID ?? "0";
  return path2.join(os2.tmpdir(), "aifetchly-test", poolId, "scraper.db");
});

vi.mock("@/modules/token", () => ({
  Token: createMockClass(() => ({
    getValue: vi.fn((key: string) =>
      key === "user_ai_enabled" ? "true" : testDbDir()
    ),
  })),
}));

vi.mock("@/service/aiProvider/AIProviderResolver", () => ({
  AIProviderResolver: class {
    resolveForChat(): { kind: "hosted"; canUse: true } {
      return { kind: "hosted" as const, canUse: true as const };
    }
  },
}));

vi.mock("@/service/AIChatQueryEngineFactory", () => ({
  AIChatQueryEngineFactory: class {
    createScheduled() {
      return {
        runTurn: mockRunTurn,
        getConversationRuntimeStatus: vi.fn(() => "idle"),
      };
    }
  },
}));

vi.mock("@/service/AIChatConversationTurnCoordinator", () => ({
  AIChatConversationTurnCoordinator: {
    getInstance: () => ({
      acquire: mockAcquire,
      tryAcquire: vi.fn(() => null),
    }),
  },
  ConversationTurnBusyError: class extends Error {},
}));

vi.mock("@/service/AIChatConversationUpdateBroadcaster", () => ({
  AIChatConversationUpdateBroadcaster: {
    getInstance: () => ({
      emit: vi.fn(),
      emitScheduledStream: vi.fn(),
    }),
  },
}));

vi.mock("@/service/ScheduledLoopRunRegistry", () => ({
  ScheduledLoopRunRegistry: {
    getInstance: () => ({
      register: vi.fn(),
      unregister: vi.fn(),
      abort: vi.fn(() => false),
    }),
  },
}));

import { SqliteDb } from "@/config/SqliteDb";
import { AIChatConversationModule } from "@/modules/AIChatConversationModule";
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { ScheduledAiMessageRunner } from "@/service/ScheduledAiMessageRunner";
import type { WorkspaceSidebarResponse } from "@/entityTypes/aiChatWorkspaceTypes";

function resetSqliteSingleton(): void {
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  engineOutcome.value = null;
  resetSqliteSingleton();
  fs.mkdirSync(path.dirname(testDbDir()), { recursive: true });
  SqliteDb.getInstance(testDbDir());
  mockAcquire.mockResolvedValue({
    conversationId: "v2-any",
    owner: "scheduled",
    ownerId: "run-1",
    leaseId: 1,
    release: vi.fn(),
  });
  mockRunTurn.mockImplementation(
    async (input: {
      eventSink: { emit: (e: unknown) => void };
      request: { conversationId: string };
    }) => {
      const conversationId = input.request.conversationId;
      // Mirror the engine: user turn persisted then streamed, and the
      // eventSink (owner adapter) sees the lifecycle.
      input.eventSink.emit({
        type: "start",
        conversationId,
        messageId: "aid-int-1",
      });
      input.eventSink.emit({
        type: "complete",
        conversationId,
        messageId: "aid-int-1",
        fullContent: engineOutcome.value?.content ?? "done",
        finishReason: "stop",
      });
      return {
        type: "completed",
        conversationId,
        assistantMessageId: "aid-int-1",
      };
    }
  );
  engineOutcome.value = { type: "complete", content: "integration ok" };
});

describe("schedule run now → workspace folder appears in getWorkspaceSidebar", () => {
  it("creates the project folder for the schedule conversation", async () => {
    await SqliteDb.ensureInitialized();
    const workDir = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        `aifetchly-sched-ws-${crypto.randomUUID().slice(0, 8)}-`
      )
    );

    // 1. The user creates the schedule's AI message task with a workspace.
    const taskModule = new AiMessageTaskModule();
    const taskId = await taskModule.createTask({
      name: "Integration schedule",
      message: "Say something to the workspace",
      workspacePath: workDir,
    } as Parameters<AiMessageTaskModule["createTask"]>[0]);

    // 2. Pre-fix state: the binding exists, but NO sidebar projection row.
    const task = await taskModule.getTask(taskId);
    expect(task?.conversation_id).toMatch(/^v2-/);
    expect(task?.workspace_path).toBeTruthy();

    const conversationModule = new AIChatConversationModule();
    const expectedKey = await conversationModule.getWorkspaceKeyForConversation(
      task?.conversation_id as string
    );
    expect(expectedKey).toBeTruthy();
    // The workspace bind itself ensures the projection row (fix layer 1):
    // task-save alone must surface the folder on the next sidebar refresh.
    const bound = await conversationModule.getConversationProjection(
      task?.conversation_id as string
    );
    expect(bound?.workspaceKey).toBe(expectedKey);

    // 3. The user clicks Run Now (detached) → the run executes in background.
    const runner = new ScheduledAiMessageRunner();
    const result = await runner.run(taskId as number);
    expect(result.status).toBe("completed");

    // 4. After the run the projection still carries the key (fix layer 2:
    //     run-time bump idempotent, never clears the key) and the
    //    authoritative sidebar projection renders the folder.
    const projection = await conversationModule.getConversationProjection(
      task?.conversation_id as string
    );
    expect(projection?.workspaceKey).toBe(expectedKey);
    expect((projection?.messageCount ?? 0) >= 1).toBe(true);

    const sidebar: WorkspaceSidebarResponse =
      await conversationModule.getWorkspaceSidebar(() => null, null);
    const folder = sidebar.workspaces.find(
      (g) => g.workspaceKey === expectedKey
    );
    expect(folder).toBeDefined();
    expect(
      folder?.conversations.some(
        (c) => c.conversationId === task?.conversation_id
      )
    ).toBe(true);
    expect(
      sidebar.unassigned.some((c) => c.conversationId === task?.conversation_id)
    ).toBe(false);
  });
});
