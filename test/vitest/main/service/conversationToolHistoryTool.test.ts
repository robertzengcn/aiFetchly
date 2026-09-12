"use strict";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();

vi.mock("@/service/ConversationToolHistoryService", () => ({
  ConversationToolHistoryService: vi.fn().mockImplementation(() => ({
    lookup: lookupMock,
  })),
}));

import { handleConversationToolHistory } from "@/service/agentTools/conversationToolHistoryTool";

describe("handleConversationToolHistory", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("returns lookup records from ConversationToolHistoryService", async () => {
    lookupMock.mockResolvedValueOnce({
      success: true,
      executionTimeMs: 4,
      total: 1,
      truncated: false,
      records: [
        {
          tool_call_id: "call-1",
          tool_name: "file_read",
          status: "success",
          summary: "path=a.csv",
        },
      ],
    });
    const result = await handleConversationToolHistory(
      { query: "file_read" },
      "v2-x"
    );
    expect(lookupMock).toHaveBeenCalledWith("v2-x", { query: "file_read" });
    expect(result.success).toBe(true);
    expect(result.result.total).toBe(1);
    expect(result.result.records).toEqual([
      {
        tool_call_id: "call-1",
        tool_name: "file_read",
        status: "success",
        summary: "path=a.csv",
      },
    ]);
  });

  it("forwards lookup errors in the result payload", async () => {
    lookupMock.mockResolvedValueOnce({
      success: false,
      executionTimeMs: 1,
      total: 0,
      truncated: false,
      records: [],
      error: "Missing conversation id.",
    });
    const result = await handleConversationToolHistory({}, "");
    expect(result.success).toBe(false);
    expect(result.result.error).toBe("Missing conversation id.");
  });
});
