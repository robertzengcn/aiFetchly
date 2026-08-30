import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock windowInvoke so we can assert the channel + payload without IPC.
vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke: vi.fn(),
}));

import { windowInvoke } from "@/views/utils/apirequest";
import {
  createAIContentReport,
  getAIContentReportCapabilities,
} from "@/views/api/aiContentReport";
import type { CreateAnyAIContentReportRequest } from "@/entityTypes/aiContentReportTypes";

describe("getAIContentReportCapabilities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invokes the capabilities channel with schemaVersion 1", async () => {
    vi.mocked(windowInvoke).mockResolvedValueOnce({
      acceptedSchemaVersions: [1, 2],
      conversationReporting: {
        enabled: true,
        maxAIItems: 10,
        maxUserItems: 10,
        maxTotalItems: 20,
        maxItemTextChars: 8000,
        maxAggregateTextChars: 32000,
        maxImages: 3,
      },
    });
    await getAIContentReportCapabilities();
    expect(windowInvoke).toHaveBeenCalledWith(
      "ai:content:report:capabilities",
      { schemaVersion: 1 }
    );
  });
});

describe("createAIContentReport (union)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards a v2 request to the create channel", async () => {
    vi.mocked(windowInvoke).mockResolvedValueOnce({
      reportId: "r1",
      status: "submitted",
      receivedAt: "t",
      duplicate: false,
    });
    const v2Request: CreateAnyAIContentReportRequest = {
      schemaVersion: 2,
      clientReportId: "c1",
      surface: "chat_v2",
      reportScope: "selected_ai_outputs",
      category: "other",
      items: [
        {
          itemId: "i1",
          messageId: "m1",
          sequence: 0,
          role: "assistant",
          contentType: "text",
          text: "x",
        },
      ],
      context: {
        conversationId: "c",
        selectedAIItemCount: 1,
        includedUserItemCount: 0,
        appVersion: "1",
        platform: "win32",
        locale: "en",
      },
    };
    await createAIContentReport(v2Request);
    expect(windowInvoke).toHaveBeenCalledWith(
      "ai:content:report:create",
      expect.any(Object)
    );
  });
});
