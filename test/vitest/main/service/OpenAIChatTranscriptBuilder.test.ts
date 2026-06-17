import { describe, expect, it } from "vitest";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { buildOpenAITranscript } from "@/service/OpenAIChatTranscriptBuilder";

function makeRow(
  overrides: Partial<AIChatMessageEntity> & { id: number }
): AIChatMessageEntity {
  const row = new AIChatMessageEntity();
  Object.assign(row, {
    messageId: `m-${overrides.id}`,
    conversationId: "v2-conv-1",
    role: "user",
    content: "",
    timestamp: new Date(2020, 0, overrides.id),
    messageType: MessageType.MESSAGE,
    ...overrides,
  });
  return row;
}

describe("OpenAIChatTranscriptBuilder", () => {
  it("builds from empty history plus current user message", () => {
    const result = buildOpenAITranscript({
      history: [],
      currentUserMessage: "hello",
    });
    expect(result.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    expect(result.skippedMessageIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("prepends system prompt when provided", () => {
    const result = buildOpenAITranscript({
      history: [],
      currentUserMessage: "hi",
      systemPrompt: "be brief",
    });
    expect(result.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(result.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("maps user and assistant history in timestamp order", () => {
    const result = buildOpenAITranscript({
      history: [
        makeRow({ id: 2, role: "assistant", content: "hi there" }),
        makeRow({ id: 1, role: "user", content: "hello" }),
      ],
      currentUserMessage: "again",
    });
    expect(result.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(result.messages.map((m) => m.content)).toEqual([
      "hello",
      "hi there",
      "again",
    ]);
  });

  it("appends current user message exactly once", () => {
    const result = buildOpenAITranscript({
      history: [makeRow({ id: 1, role: "user", content: "old" })],
      currentUserMessage: "new",
    });
    const userMessages = result.messages.filter((m) => m.role === "user");
    expect(userMessages.map((m) => m.content)).toEqual(["old", "new"]);
  });

  it("filters out rows whose metadata source is not chat-v2 when filtering enabled", () => {
    const oldRow = makeRow({ id: 1, role: "user", content: "legacy" });
    oldRow.metadata = JSON.stringify({ source: "legacy" });
    const v2Row = makeRow({ id: 2, role: "user", content: "v2-msg" });
    v2Row.metadata = JSON.stringify({ source: "chat-v2" });
    const result = buildOpenAITranscript({
      history: [oldRow, v2Row],
      currentUserMessage: "next",
      filterSource: "chat-v2",
    });
    expect(result.messages.map((m) => m.content)).toEqual(["v2-msg", "next"]);
  });

  it("skips tool_call rows in phase 1 and records warnings", () => {
    const toolRow = makeRow({
      id: 1,
      role: "assistant",
      content: "{}",
      messageType: MessageType.TOOL_CALL,
    });
    toolRow.metadata = JSON.stringify({ source: "chat-v2" });
    const result = buildOpenAITranscript({
      history: [toolRow],
      currentUserMessage: "hi",
    });
    expect(result.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(result.skippedMessageIds).toEqual(["m-1"]);
    expect(result.warnings.length).toBe(1);
  });

  it("does not throw on malformed metadata JSON", () => {
    const row = makeRow({ id: 1, role: "user", content: "hi" });
    row.metadata = "{not json";
    const result = buildOpenAITranscript({
      history: [row],
      currentUserMessage: "again",
    });
    expect(result.messages.length).toBe(2);
    expect(result.warnings).toEqual([]);
  });

  it("limits history to maxMessages when provided (keeping most recent)", () => {
    const history: AIChatMessageEntity[] = [];
    for (let i = 1; i <= 10; i++) {
      history.push(makeRow({ id: i, role: "user", content: `u-${i}` }));
    }
    const result = buildOpenAITranscript({
      history,
      currentUserMessage: "now",
      maxMessages: 3,
    });
    expect(result.messages.length).toBe(4);
    expect(result.messages.map((m) => m.content)).toEqual([
      "u-8",
      "u-9",
      "u-10",
      "now",
    ]);
  });
});
