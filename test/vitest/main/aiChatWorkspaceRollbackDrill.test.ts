import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-workspace-rollback-drill");

vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }));

/**
 * Flag values are mutable through the drill: the Token mock answers from
 * this map so the test can flip the rollout flags exactly like an operator
 * rolling the workspace shell back to Chat V2.
 */
const tokenValues = new Map<string, string>();
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(key: string): string {
      if (tokenValues.has(key)) return tokenValues.get(key)!;
      if (key.includes("enabled") || key.includes("redesign")) return "";
      return process.env.AIFETCHLY_TEST_DBPATH ?? "";
    }
  },
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn(function AIChatV2ModuleMock() {
    return {
      createConversationIfNeeded: (existing?: string) =>
        existing && existing.startsWith("v2-") ? existing : "v2-drill",
    };
  }),
}));
vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn(function AIChatAttachmentModuleMock() {
    return {
      saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
      deleteByMessageId: vi.fn().mockResolvedValue(1),
      deleteByConversation: vi.fn().mockResolvedValue(0),
      getByMessageId: vi.fn().mockResolvedValue([]),
    };
  }),
}));

import { SqliteDb } from "@/config/SqliteDb";
import {
  isWorkspaceQueueEnabled,
  isWorkspaceSteeringEnabled,
  isWorkspaceRedesignEnabled,
  isChatV2DockVisible,
} from "@/service/AIChatWorkspaceRollout";
import {
  AI_CHAT_MESSAGE_QUEUE_ENABLED,
  AI_CHAT_MESSAGE_STEERING_ENABLED,
  USER_AI_CHAT_WORKSPACE_REDESIGN,
} from "@/config/usersetting";
import { AIChatPendingMessageModule } from "@/modules/AIChatPendingMessageModule";
import {
  AIChatPendingMessagePreparationService,
  type AIChatPendingPreparedContent,
} from "@/service/AIChatPendingMessagePreparationService";
import { AIChatWorkspaceRunDispatchBridge } from "@/service/AIChatWorkspaceRunDispatchBridge";
import { AIChatRunModule } from "@/modules/AIChatRunModule";

function fakePrep(): AIChatPendingMessagePreparationService {
  return {
    prepare: vi.fn(
      async (input: { request: { message: string } }) =>
        ({
          displayContent: input.request.message,
          modelContent: input.request.message,
          attachmentMetadata: undefined,
          messageMetadata: { source: "chat-v2" },
          imageAttachments: [],
          stagedRefs: [],
        }) as AIChatPendingPreparedContent
    ),
  } as unknown as AIChatPendingMessagePreparationService;
}

beforeEach(async () => {
  tokenValues.clear();
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        // ignore
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
  await SqliteDb.ensureInitialized();
});

/**
 * G03 rollback drill (design §23.1/§23.2): flipping the workspace rollout
 * flags to the Chat V2 state must be a PRESENTATION change only — pending
 * rows, run records, source identities, and authorization behavior survive
 * untouched, the queue's list/remove APIs keep working so nothing is
 * orphaned, and re-enabling re-claims idempotently instead of double-
 * dispatching.
 */
describe("workspace rollback drill (G03, §23.2)", () => {
  it("preserves pending rows, run identities, and idempotent re-claim across a full flag rollback", async () => {
    const pending = new AIChatPendingMessageModule(fakePrep());
    const bridge = new AIChatWorkspaceRunDispatchBridge(new AIChatRunModule());

    // --- Seed under the shipped state (queue+steering ON, workspace ON). ---
    expect(isWorkspaceQueueEnabled()).toBe(true);
    expect(isWorkspaceSteeringEnabled()).toBe(true);

    const conversationId = "v2-drill";
    const rowA = await pending.createPendingMessage({
      clientRequestId: "drill-a",
      request: { message: "rollback drill a", conversationId },
    });
    const rowB = await pending.createPendingMessage({
      clientRequestId: "drill-b",
      request: { message: "rollback drill b", conversationId },
    });
    const rowC = await pending.createPendingMessage({
      clientRequestId: "drill-c",
      request: { message: "rollback drill c", conversationId },
    });
    expect([rowA.status, rowB.status, rowC.status]).toEqual([
      "queued",
      "queued",
      "queued",
    ]);

    const scheduled = await bridge.schedule({
      pendingMessageId: rowA.pendingMessageId,
      conversationId,
      resourceClass: "general",
    });
    expect(scheduled?.admitted).toBe(true);
    const runId = scheduled!.runId;
    // The run envelope is identity-linked to its pending row (T1 bridge).
    const seededRun = await new AIChatRunModule().getByRunId(runId);
    expect(seededRun?.sourceId).toBe(rowA.pendingMessageId);
    // A parked turn releases capacity but keeps the SAME run identity (B02).
    await bridge.parkRunWaiting(runId, "awaiting_user");

    const identitiesBefore = {
      runId,
      sourceId: seededRun?.sourceId,
      pendingIds: [rowA.pendingMessageId, rowB.pendingMessageId, rowC.pendingMessageId],
    };

    // --- ROLLBACK: every workspace flag off — the Chat V2 dock state. ---
    tokenValues.set(AI_CHAT_MESSAGE_QUEUE_ENABLED, "false");
    tokenValues.set(AI_CHAT_MESSAGE_STEERING_ENABLED, "false");
    tokenValues.set(USER_AI_CHAT_WORKSPACE_REDESIGN, "false");
    expect(isWorkspaceQueueEnabled()).toBe(false);
    expect(isWorkspaceSteeringEnabled()).toBe(false);
    // V2 visibility is the redesign flag's inverse (§23.1 fifth control):
    // rolling the workspace back re-exposes the Chat V2 dock.
    expect(isWorkspaceRedesignEnabled()).toBe(false);
    expect(isChatV2DockVisible()).toBe(true);

    // Pending rows survive verbatim — the rollback deleted nothing.
    const viewsAfterRollback = await pending.listViews(conversationId, "idle");
    expect(viewsAfterRollback.map((v) => v.pendingMessageId).sort()).toEqual(
      [...identitiesBefore.pendingIds].sort()
    );

    // Run records stay readable with unchanged identity + park state.
    const runAfterRollback = await new AIChatRunModule().getByRunId(runId);
    expect(runAfterRollback?.sourceId).toBe(identitiesBefore.sourceId);
    expect(runAfterRollback?.status).toBe("awaiting_user");

    // Persisted state carries no authorization tokens (§25 invariant 8):
    // the sanitized view is the renderer contract — assert nothing
    // token-shaped leaks into it.
    const viewJson = JSON.stringify(viewsAfterRollback);
    expect(viewJson).not.toMatch(/"?(authorization|approvalToken|apiKey|token)"?\s*:/i);

    // The queue's management APIs keep working in the rollback state —
    // explicit user removal is possible, so rows are never orphaned. The
    // cancelled row stays listed as a receipt (the UI clears receipts
    // separately); the assertion is the status transition, not deletion.
    const removed = await pending.cancelPending({
      pendingMessageId: rowC.pendingMessageId,
      conversationId,
    });
    expect(removed.pendingMessageId).toBe(rowC.pendingMessageId);
    const viewsAfterRemove = await pending.listViews(conversationId, "idle");
    const statusesAfterRemove = new Map(
      viewsAfterRemove.map((v) => [v.pendingMessageId, v.status] as const)
    );
    expect(statusesAfterRemove.get(rowC.pendingMessageId)).toBe("cancelled");
    expect(statusesAfterRemove.get(rowA.pendingMessageId)).toBe("queued");
    expect(statusesAfterRemove.get(rowB.pendingMessageId)).toBe("queued");

    // --- Re-enable: re-claim must reuse the parked envelope, never mint
    //     a second run for the same pending row (idempotency, §25 inv. 2). ---
    tokenValues.delete(AI_CHAT_MESSAGE_QUEUE_ENABLED);
    tokenValues.delete(AI_CHAT_MESSAGE_STEERING_ENABLED);
    expect(isWorkspaceQueueEnabled()).toBe(true);

    const reclaimed = await bridge.schedule({
      pendingMessageId: rowA.pendingMessageId,
      conversationId,
      resourceClass: "general",
    });
    expect(reclaimed?.runId).toBe(identitiesBefore.runId);
    // Exactly one envelope exists for the pending row's source id (T1).
    const runForSource = await new AIChatRunModule().findBySourceId(
      "interactive",
      rowA.pendingMessageId
    );
    expect(runForSource?.runId).toBe(identitiesBefore.runId);
  });
});
