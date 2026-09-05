import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { SqliteDb } from "@/config/SqliteDb";
import { createOwnerAdapterSink } from "@/service/AIChatRunOwnerAdapter";
import { AIChatRunModule } from "@/modules/AIChatRunModule";
import { AIChatRunModel } from "@/model/AIChatRun.model";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";
import type { ConversationSummaryEvent } from "@/entityTypes/aiChatWorkspaceTypes";

const tmpDir = path.join(os.tmpdir(), "aifetchly-ws-owner-adapter");

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

beforeEach(() => {
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
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
  SqliteDb.getInstance(tmpDir);
});

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await condition()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function captureSink(): {
  sink: AIChatQueryEventSink;
  events: AIChatQueryEvent[];
} {
  const events: AIChatQueryEvent[] = [];
  return {
    events,
    sink: {
      emit: (event) => {
        events.push(event);
      },
    },
  };
}

describe("AIChatRunOwnerAdapter (design §8.3 owner adapters)", () => {
  it("keeps the envelope durable and forwards every event unchanged", async () => {
    await SqliteDb.ensureInitialized();
    const runModule = new AIChatRunModule();
    const summaries: ConversationSummaryEvent[] = [];
    const inner = captureSink();

    const sink = await createOwnerAdapterSink(inner.sink, {
      conversationId: "v2-owner-1",
      owner: "scheduled",
      sourceId: "17",
      runModule,
      broadcaster: {
        broadcastSummary: (event) => summaries.push(event),
      },
    });

    const runRow = await new AIChatRunModel(tmpDir).listByConversation(
      "v2-owner-1",
      5
    );
    expect(runRow).toHaveLength(1);
    expect(runRow[0].status).toBe("queued");
    expect(runRow[0].owner).toBe("scheduled");
    expect(runRow[0].sourceId).toBe("17");

    sink.emit({
      type: "start",
      conversationId: "v2-owner-1",
      messageId: "a1",
    });
    sink.emit({
      type: "token",
      conversationId: "v2-owner-1",
      messageId: "a1",
      contentDelta: "hi",
      model: "m",
    });
    sink.emit({
      type: "complete",
      conversationId: "v2-owner-1",
      messageId: "a1",
      fullContent: "hi",
      finishReason: "stop",
    });

    // Every engine event reached the owner's own sink unchanged.
    expect(inner.events.map((e) => e.type)).toEqual([
      "start",
      "token",
      "complete",
    ]);

    await waitFor(async () => {
      const row = await new AIChatRunModel(tmpDir).getByRunId(runRow[0].runId);
      return row?.status === "completed";
    });
    const reasons = summaries.map((s) => s.reason);
    expect(reasons).toContain("run_started");
    expect(reasons).toContain("run_completed");
    // Persist-first: the completed summary is the LAST broadcast.
    expect(reasons[reasons.length - 1]).toBe("run_completed");
  });

  it("maps error terminals to a bounded failed envelope", async () => {
    await SqliteDb.ensureInitialized();
    const runModule = new AIChatRunModule();
    const inner = captureSink();
    const sink = await createOwnerAdapterSink(inner.sink, {
      conversationId: "v2-owner-2",
      owner: "goal",
      sourceId: "g-1",
      runModule,
      broadcaster: { broadcastSummary: () => undefined },
    });

    sink.emit({
      type: "start",
      conversationId: "v2-owner-2",
      messageId: "a1",
    });
    sink.emit({
      type: "error",
      conversationId: "v2-owner-2",
      messageId: "a1",
      errorMessage: `boom-${"x".repeat(900)}`,
    });

    await waitFor(async () => {
      const rows = await new AIChatRunModel(tmpDir).listByConversation(
        "v2-owner-2",
        5
      );
      return rows[0]?.status === "failed";
    });
    const rows = await new AIChatRunModel(tmpDir).listByConversation(
      "v2-owner-2",
      5
    );
    expect(rows[0].errorSummary?.length).toBeLessThanOrEqual(500);
    expect(rows[0].errorSummary).toContain("boom-");
  });

  it("observes question pauses as awaiting_user", async () => {
    await SqliteDb.ensureInitialized();
    const runModule = new AIChatRunModule();
    const summaries: ConversationSummaryEvent[] = [];
    const inner = captureSink();
    const sink = await createOwnerAdapterSink(inner.sink, {
      conversationId: "v2-owner-3",
      owner: "agent",
      runModule,
      broadcaster: {
        broadcastSummary: (event) => summaries.push(event),
      },
    });

    sink.emit({
      type: "start",
      conversationId: "v2-owner-3",
      messageId: "a1",
    });
    sink.emit({
      type: "ask_user_question",
      conversationId: "v2-owner-3",
      messageId: "a1",
      toolCallId: "q-1",
      toolName: "ask_user_question",
    } as unknown as AIChatQueryEvent);

    await waitFor(() =>
      summaries.some((s) => s.reason === "user_input_required")
    );
    expect(
      summaries.find((s) => s.reason === "user_input_required")?.attention
    ).toBe("user_input");
  });
});
