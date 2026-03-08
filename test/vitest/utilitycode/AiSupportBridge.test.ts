/**
 * Tests for AiSupportBridge (observe-execute AI_SUPPORT_REQUEST/RESPONSE).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestAiSupport,
  handleAiSupportResponse,
} from "@/childprocess/utils/AiSupportBridge";
import type { ParentPort } from "@/childprocess/worker";
import type {
  AiSupportRequestMessage,
  AiSupportResponseMessage,
} from "@/modules/interface/BackgroundProcessMessages";

describe("AiSupportBridge", () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockParentPort: ParentPort;

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockParentPort = {
      postMessage: mockSendMessage,
      on: vi.fn(),
    };
  });

  describe("requestAiSupport", () => {
    it("should send AI_SUPPORT_REQUEST to parent port", async () => {
      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "req-1",
        requestType: "observe_execute",
        pageUrl: "https://example.com",
        pageContent: "<html></html>",
        goal: "Find search input",
        sessionId: null,
        previousActionResults: [],
        iteration: 0,
        selectorsAvailable: {},
        maxIterations: 3,
        platformName: "google",
      };

      const promise = requestAiSupport(mockParentPort, request);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const messageArg = mockSendMessage.mock.calls[0][0];
      const parsed = JSON.parse(messageArg) as AiSupportRequestMessage;
      expect(parsed.type).toBe("AI_SUPPORT_REQUEST");
      expect(parsed.requestId).toBe("req-1");
      expect(parsed.requestType).toBe("observe_execute");

      handleAiSupportResponse({
        type: "AI_SUPPORT_RESPONSE",
        taskId: 1,
        requestId: "req-1",
        success: true,
        requestType: "observe_execute",
      });
      await promise;
    });
  });

  describe("handleAiSupportResponse", () => {
    it("should resolve pending request when response is received", async () => {
      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "pending-req",
        requestType: "observe_execute",
        pageUrl: "https://example.com",
        pageContent: "",
        goal: "Recover",
        sessionId: null,
        previousActionResults: [],
        iteration: 0,
        selectorsAvailable: {},
        maxIterations: 3,
      };

      const promise = requestAiSupport(mockParentPort, request);

      const response: AiSupportResponseMessage = {
        type: "AI_SUPPORT_RESPONSE",
        taskId: 1,
        requestId: "pending-req",
        success: true,
        requestType: "observe_execute",
      };
      handleAiSupportResponse(response);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.requestType).toBe("observe_execute");
    });

    it("should ignore unknown request IDs", () => {
      const response: AiSupportResponseMessage = {
        type: "AI_SUPPORT_RESPONSE",
        taskId: 1,
        requestId: "unknown-id",
        success: true,
        requestType: "observe_execute",
      };
      expect(() => handleAiSupportResponse(response)).not.toThrow();
    });

    it("should timeout after configured delay", async () => {
      vi.useFakeTimers();
      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "timeout-req",
        requestType: "observe_execute",
        pageUrl: "https://example.com",
        pageContent: "",
        goal: "Test",
        sessionId: null,
        previousActionResults: [],
        iteration: 0,
        selectorsAvailable: {},
        maxIterations: 3,
      };

      const promise = requestAiSupport(mockParentPort, request);
      // Advance time beyond timeout (60s)
      vi.advanceTimersByTimeAsync(61_000);

      await expect(promise).rejects.toThrow("timed out");
      vi.useRealTimers();
    });

    it("should handle concurrent requests", async () => {
      const request1: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "concurrent-1",
        requestType: "observe_execute",
        pageUrl: "https://example.com",
        pageContent: "",
        goal: "Test",
        sessionId: null,
        previousActionResults: [],
        iteration: 0,
        selectorsAvailable: {},
        maxIterations: 3,
      };

      const request2: AiSupportRequestMessage = {
        ...request1,
        requestId: "concurrent-2",
      };

      const promise1 = requestAiSupport(mockParentPort, request1);
      const promise2 = requestAiSupport(mockParentPort, request2);

      // Both requests should be pending
      expect(mockSendMessage).toHaveBeenCalledTimes(2);

      // Resolve both
      handleAiSupportResponse({
        type: "AI_SUPPORT_RESPONSE",
        taskId: 1,
        requestId: "concurrent-1",
        success: true,
        requestType: "observe_execute",
      });

      handleAiSupportResponse({
        type: "AI_SUPPORT_RESPONSE",
        taskId: 1,
        requestId: "concurrent-2",
        success: true,
        requestType: "observe_execute",
      });

      const results = await Promise.all([promise1, promise2]);
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it("should handle malformed response gracefully", () => {
      const malformedResponse = {
        type: "AI_SUPPORT_RESPONSE",
        taskId: 1,
        requestId: "test-id",
        // Missing required fields
        success: true,
      } as unknown as AiSupportResponseMessage;

      expect(() => handleAiSupportResponse(malformedResponse)).not.toThrow();
    });
  });
});
