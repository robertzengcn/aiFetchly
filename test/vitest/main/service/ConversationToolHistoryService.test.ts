import { describe, expect, it } from "vitest";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import {
  CONVERSATION_TOOL_HISTORY_TOOL_NAME,
  TOOL_HISTORY_REPLAY_PAIR_LIMIT,
} from "@/entityTypes/conversationToolHistoryTypes";
import {
  buildToolHistoryIndexBlock,
  collectConversationToolPairs,
  filterPairsAfterBoundary,
  lookupConversationToolHistory,
  selectReplayPairs,
  interleaveReplayWithText,
  pairToOpenAIMessages,
  ConversationToolHistoryService,
} from "@/service/ConversationToolHistoryService";
import type { ConversationMessageLoader } from "@/service/ConversationToolHistoryService";

function makeRow(
  overrides: Partial<AIChatMessageEntity> & { id: number }
): AIChatMessageEntity {
  const row = new AIChatMessageEntity();
  Object.assign(row, {
    messageId: `m-${overrides.id}`,
    conversationId: "v2-x",
    role: "assistant",
    content: "",
    timestamp: new Date(overrides.id),
    messageType: MessageType.MESSAGE,
    ...overrides,
  });
  return row;
}

function toolCallRow(
  id: number,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): AIChatMessageEntity {
  return makeRow({
    id,
    messageId: `tool-call-${toolCallId}`,
    messageType: MessageType.TOOL_CALL,
    metadata: JSON.stringify({
      source: "chat-v2",
      toolCallId,
      toolName,
      toolArguments: args,
    }),
  });
}

function toolResultRow(
  id: number,
  toolCallId: string,
  toolName: string,
  result: Record<string, unknown>,
  content?: string
): AIChatMessageEntity {
  return makeRow({
    id,
    messageId: `tool-result-${toolCallId}`,
    content: content ?? JSON.stringify(result),
    messageType: MessageType.TOOL_RESULT,
    metadata: JSON.stringify({
      source: "chat-v2",
      toolCallId,
      toolName,
      toolResult: result,
      toolResultStatus: result.success === false ? "error" : "success",
      success: result.success !== false,
    }),
  });
}

describe("ConversationToolHistoryService", () => {
  it("pairs matching tool_call and tool_result rows into receipts", () => {
    const pairs = collectConversationToolPairs([
      makeRow({
        id: 1,
        role: "user",
        content: "send emails",
        messageType: MessageType.MESSAGE,
      }),
      toolCallRow(2, "call-1", "start_email_send_task", {
        emails: ["a@x.com"],
      }),
      toolResultRow(3, "call-1", "start_email_send_task", {
        success: true,
        task_id: 168,
        recipient_count: 1,
      }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].toolName).toBe("start_email_send_task");
    expect(pairs[0].status).toBe("success");
    expect(pairs[0].summary).toContain("task_id=168");
    expect(pairs[0].summary).toContain("a@x.com");
  });

  it("keeps pending calls that have no result yet", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "call-p", "file_read", { path: "a.csv" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].status).toBe("pending");
  });

  it("omits conversation_tool_history rows from the index", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "call-h", CONVERSATION_TOOL_HISTORY_TOOL_NAME, {
        query: "email",
      }),
      toolResultRow(2, "call-h", CONVERSATION_TOOL_HISTORY_TOOL_NAME, {
        success: true,
        total: 0,
      }),
      toolCallRow(3, "call-2", "glob_files", { pattern: "*.csv" }),
      toolResultRow(4, "call-2", "glob_files", {
        success: true,
        total: 2,
      }),
    ]);
    expect(pairs.map((p) => p.toolName)).toEqual(["glob_files"]);
  });

  it("builds an index that names the lookup tool and receipts", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "call-1", "start_email_send_task", {
        emails: ["a@x.com"],
      }),
      toolResultRow(2, "call-1", "start_email_send_task", {
        success: true,
        task_id: 168,
      }),
    ]);
    const block = buildToolHistoryIndexBlock(pairs);
    expect(block).toContain("Prior tool activity");
    expect(block).toContain(CONVERSATION_TOOL_HISTORY_TOOL_NAME);
    expect(block).toContain("call-1");
    expect(block).toContain("task_id=168");
  });

  it("drops pairs at or before a compact boundary", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "old", "glob_files", { pattern: "*" }),
      toolResultRow(2, "old", "glob_files", { success: true, total: 1 }),
      toolCallRow(10, "new", "file_read", { path: "b.csv" }),
      toolResultRow(11, "new", "file_read", { success: true, path: "b.csv" }),
    ]);
    const kept = filterPairsAfterBoundary(pairs, 5);
    expect(kept.map((p) => p.toolCallId)).toEqual(["new"]);
  });

  it("looks up one truncated result by tool_call_id", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "call-1", "file_read", { path: "a.csv" }),
      toolResultRow(
        2,
        "call-1",
        "file_read",
        { success: true, path: "a.csv" },
        "line1\n".repeat(20)
      ),
    ]);
    const result = lookupConversationToolHistory(
      pairs,
      { tool_call_id: "call-1" },
      12
    );
    expect(result.success).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].content).toContain("line1");
    expect(result.records[0].tool_name).toBe("file_read");
  });

  it("filters the receipt list by query", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "c1", "glob_files", { pattern: "*.csv" }),
      toolResultRow(2, "c1", "glob_files", { success: true, total: 2 }),
      toolCallRow(3, "c2", "start_email_send_task", {
        emails: ["a@x.com"],
      }),
      toolResultRow(4, "c2", "start_email_send_task", {
        success: true,
        task_id: 9,
      }),
    ]);
    const result = lookupConversationToolHistory(
      pairs,
      { query: "start_email_send_task" },
      3
    );
    expect(result.records).toHaveLength(1);
    expect(result.records[0].tool_call_id).toBe("c2");
  });

  it("selects the last N pairs for native replay", () => {
    const rows: AIChatMessageEntity[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(
        toolCallRow(i * 2, `c${i}`, "start_email_send_task", {
          emails: [`u${i}@x.com`],
        })
      );
      rows.push(
        toolResultRow(i * 2 + 1, `c${i}`, "start_email_send_task", {
          success: true,
          task_id: 100 + i,
        })
      );
    }
    const replay = selectReplayPairs(collectConversationToolPairs(rows));
    expect(replay).toHaveLength(TOOL_HISTORY_REPLAY_PAIR_LIMIT);
    expect(replay[0].toolCallId).toBe("c2");
    expect(replay[3].toolCallId).toBe("c5");
  });

  it("redacts secret argument keys from lookup records", () => {
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "c1", "file_read", {
        path: "a.csv",
        password: "super-secret",
      }),
      toolResultRow(2, "c1", "file_read", { success: true }),
    ]);
    const result = lookupConversationToolHistory(pairs, { query: "file_read" }, 1);
    expect(result.records[0].arguments).toEqual({ path: "a.csv" });
  });

  it("returns invalid-request when lookup args fail Zod parse", async () => {
    const fake = {
      getConversationMessages: async () => [],
    } as ConversationMessageLoader;
    const svc = new ConversationToolHistoryService(fake);
    const result = await svc.lookup("v2-x", { limit: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid request.");
  });

  it("returns missing-id when conversationId is empty", async () => {
    const fake: ConversationMessageLoader = {
      getConversationMessages: async () => [],
    };
    const svc = new ConversationToolHistoryService(fake);
    const result = await svc.lookup("  ", { query: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Missing conversation id.");
  });

  it("interleaves native tool pairs among later text rows", () => {
    const pair = collectConversationToolPairs([
      toolCallRow(2, "call-1", "file_read", { path: "a.csv" }),
      toolResultRow(3, "call-1", "file_read", {
        success: true,
        path: "a.csv",
      }),
    ])[0];
    if (!pair) {
      throw new Error("expected paired tool history");
    }
    const messages = interleaveReplayWithText({
      textRows: [
        makeRow({
          id: 1,
          role: "user",
          content: "read it",
          messageType: MessageType.MESSAGE,
        }),
        makeRow({
          id: 10,
          role: "user",
          content: "please continue",
          messageType: MessageType.MESSAGE,
        }),
      ],
      replayPairs: [pair],
      roleOf: (role) => (role === "user" ? "user" : "assistant"),
    });
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "user",
    ]);
    expect(messages[2]?.tool_call_id).toBe("call-1");
  });

  it("truncates long replayed tool arguments", () => {
    const html = "x".repeat(400);
    const pairs = collectConversationToolPairs([
      toolCallRow(1, "c1", "start_email_send_task", { email_html: html }),
      toolResultRow(2, "c1", "start_email_send_task", {
        success: true,
        task_id: 1,
      }),
    ]);
    const pair = pairs[0];
    if (!pair) {
      throw new Error("expected paired tool history");
    }
    const msgs = pairToOpenAIMessages(pair);
    const assistant = msgs[0];
    expect(assistant?.tool_calls?.[0]?.function.arguments).toContain(
      "truncated"
    );
    expect(assistant?.tool_calls?.[0]?.function.arguments.length).toBeLessThan(
      html.length
    );
  });
});
