import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  YellowPagesAiSupportHandler,
  AiSupportErrorCode,
} from "@/modules/YellowPagesAiSupportHandler";
import type { AiSupportRequestMessage } from "@/modules/interface/BackgroundProcessMessages";
import type { UtilityProcess } from "electron";

// Mock Electron's UtilityProcess
vi.mock("electron", () => ({
  utilityProcess: {
    fork: vi.fn(),
  },
}));

// Mock Token service
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) => {
      if (key === "USER_AI_ENABLED") return "true";
      return "";
    }),
  })),
}));

// Mock AiChatApi
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({
    extractContactInfo: vi.fn(),
    scrapeAssist: vi.fn(),
  })),
}));

// Mock WriteLog
vi.mock("@/modules/lib/function", () => ({
  WriteLog: vi.fn(),
}));

describe("YellowPagesAiSupportHandler", () => {
  let handler: YellowPagesAiSupportHandler;
  let mockChildProcess: Partial<UtilityProcess>;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock child process
    mockPostMessage = vi.fn();
    mockChildProcess = {
      postMessage: mockPostMessage,
    };

    // Create handler with default config
    handler = new YellowPagesAiSupportHandler();
  });

  afterEach(() => {
    handler.clearCache();
    handler.resetRateLimit();
  });

  describe("AI Enabled Check", () => {
    it("should return error when AI is not enabled", async () => {
      // Create handler that mocks AI as disabled
      const disabledHandler = new YellowPagesAiSupportHandler();
      vi.spyOn(disabledHandler as any, "isAiEnabled").mockReturnValue(false);

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-001",
        requestType: "contact_extraction",
        pageContent: "Test content",
        pageUrl: "https://example.com",
      };

      await disabledHandler.handleAiSupportRequest(
        request,
        mockChildProcess as any
      );

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(false);
      expect(response.errorMessage).toContain(
        "AI support is not enabled. Please enable AI in settings"
      );
    });
  });

  describe("Request Validation", () => {
    it("should reject request with page content too large", async () => {
      const largeContent = "x".repeat(51 * 1024); // 51KB

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-002",
        requestType: "contact_extraction",
        pageContent: largeContent,
        pageUrl: "https://example.com",
      };

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(false);
      expect(response.errorMessage).toContain("too large");
    });

    it("should reject request with invalid screenshot format", async () => {
      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-003",
        requestType: "contact_extraction",
        pageContent: "Test content",
        pageUrl: "https://example.com",
        screenshot: "invalid-format-not-base64",
      };

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(false);
      expect(response.errorMessage).toContain("Invalid screenshot format");
    });

    it("should accept request with valid screenshot data URI", async () => {
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      vi.mocked(mockApi.extractContactInfo).mockResolvedValue({
        status: true,
        code: 0,
        msg: "",
        data: {
          emails: ["test@example.com"],
          phones: [],
          address: "123 Test St",
        },
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-004",
        requestType: "contact_extraction",
        pageContent: "Test content",
        pageUrl: "https://example.com",
        screenshot:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      };

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(true);
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limit", async () => {
      // Create handler with low rate limit for testing
      const rateLimitedHandler = new YellowPagesAiSupportHandler({
        rateLimitPerMinute: 2,
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-rate-001",
        requestType: "contact_extraction",
        pageContent: "Test content",
        pageUrl: "https://example.com",
      };

      // Mock AI API to fail fast
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      vi.mocked(mockApi.extractContactInfo).mockResolvedValue({
        status: true,
        code: 0,
        msg: "",
        data: { emails: [], phones: [] },
      });

      // First two requests should succeed (or at least not be rate limited)
      await rateLimitedHandler.handleAiSupportRequest(
        { ...request, requestId: "test-001" },
        mockChildProcess as any
      );
      await rateLimitedHandler.handleAiSupportRequest(
        { ...request, requestId: "test-002" },
        mockChildProcess as any
      );

      // Third request should be rate limited
      await rateLimitedHandler.handleAiSupportRequest(
        { ...request, requestId: "test-003" },
        mockChildProcess as any
      );

      // Check that at least one request was rate limited
      const responses = mockPostMessage.mock.calls.map((call) =>
        JSON.parse(call[0])
      );
      const rateLimitedResponses = responses.filter((r) =>
        r.errorMessage?.includes("Too many AI requests")
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  describe("Response Caching", () => {
    it("should cache and reuse responses for identical requests", async () => {
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      let callCount = 0;
      vi.mocked(mockApi.extractContactInfo).mockImplementation(async () => {
        callCount++;
        return {
          status: true,
          code: 0,
          msg: "",
          data: { emails: ["test@example.com"], phones: [] },
        };
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-cache-001",
        requestType: "contact_extraction",
        pageContent: "Test content",
        pageUrl: "https://example.com",
      };

      // First request
      await handler.handleAiSupportRequest(request, mockChildProcess as any);
      expect(callCount).toBe(1);

      // Second identical request - should use cache
      await handler.handleAiSupportRequest(
        { ...request, requestId: "test-cache-002" },
        mockChildProcess as any
      );
      expect(callCount).toBe(1); // API should not be called again

      // Check cache stats
      const stats = handler.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });

    it("should expire cache entries after TTL", async () => {
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      let callCount = 0;
      vi.mocked(mockApi.extractContactInfo).mockImplementation(async () => {
        callCount++;
        return {
          status: true,
          code: 0,
          msg: "",
          data: { emails: [], phones: [] },
        };
      });

      // Create handler with very short TTL
      const shortLivedHandler = new YellowPagesAiSupportHandler({
        cacheTtl: 100, // 100ms
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-ttl-001",
        requestType: "contact_extraction",
        pageContent: "Test content",
        pageUrl: "https://example.com",
      };

      // First request
      await shortLivedHandler.handleAiSupportRequest(
        request,
        mockChildProcess as any
      );
      expect(callCount).toBe(1);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second request - cache should be expired
      await shortLivedHandler.handleAiSupportRequest(
        { ...request, requestId: "test-ttl-002" },
        mockChildProcess as any
      );
      expect(callCount).toBe(2); // API should be called again
    });
  });

  describe("Contact Extraction", () => {
    it("should handle successful contact extraction", async () => {
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      vi.mocked(mockApi.extractContactInfo).mockResolvedValue({
        status: true,
        code: 0,
        msg: "",
        data: {
          emails: ["contact@example.com", "info@example.com"],
          phones: ["+1-555-1234"],
          address: "123 Business St, City, State 12345",
          socialLinks: ["https://facebook.com/example"],
          confidence: 0.95,
        },
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-contact-001",
        requestType: "contact_extraction",
        pageContent: "Contact: contact@example.com, Phone: +1-555-1234",
        pageUrl: "https://example.com/contact",
        businessName: "Example Business",
      };

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        emails: ["contact@example.com", "info@example.com"],
        phones: ["+1-555-1234"],
        address: "123 Business St, City, State 12345",
        socialLinks: ["https://facebook.com/example"],
        confidence: 0.95,
      });
    });

    it("should handle failed contact extraction", async () => {
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      vi.mocked(mockApi.extractContactInfo).mockResolvedValue({
        status: false,
        code: 1,
        msg: "Unable to extract contact information from the provided content",
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-contact-002",
        requestType: "contact_extraction",
        pageContent: "No contact info here",
        pageUrl: "https://example.com",
      };

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(false);
      expect(response.errorMessage).toContain("Unable to extract");
    });
  });

  describe("Step Guidance", () => {
    it("should handle successful step guidance", async () => {
      const { AiChatApi } = await import("@/api/aiChatApi");
      const mockApi = new AiChatApi();
      vi.mocked(mockApi.scrapeAssist).mockResolvedValue({
        status: true,
        code: 0,
        msg: "",
        data: {
          suggestedSelectors: {
            phone: ".contact-phone",
            email: ".contact-email",
          },
          suggestedActions: [
            "Try waiting for element to appear",
            "Check for iframe",
          ],
          shouldSkip: false,
          explanation:
            "The page uses dynamic content loading. Wait for the elements to appear.",
        },
      });

      const request: AiSupportRequestMessage = {
        type: "AI_SUPPORT_REQUEST",
        taskId: 1,
        requestId: "test-guidance-001",
        requestType: "step_guidance",
        pageContent: "<html><body>Loading...</body></html>",
        pageUrl: "https://example.com",
        stepContext: "Extracting phone number",
        errorInfo: "Element not found: .phone",
        platformName: "yellowpages",
        selectorsTried: {
          phone: ".phone",
          contact: ".contact",
        },
      };

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({
        suggestedSelectors: {
          phone: ".contact-phone",
          email: ".contact-email",
        },
        suggestedActions: [
          "Try waiting for element to appear",
          "Check for iframe",
        ],
        shouldSkip: false,
        explanation:
          "The page uses dynamic content loading. Wait for the elements to appear.",
      });
    });
  });

  describe("Cache Management", () => {
    it("should clear cache", () => {
      // Add something to cache by setting it directly
      (handler as any).cache.set("test-key", {
        data: { type: "AI_SUPPORT_RESPONSE" } as any,
        timestamp: Date.now(),
      });

      expect(handler.getCacheStats().size).toBeGreaterThan(0);

      handler.clearCache();

      expect(handler.getCacheStats().size).toBe(0);
    });

    it("should reset rate limit", () => {
      // Add some timestamps
      (handler as any).requestTimestamps = [Date.now(), Date.now() - 1000];

      handler.resetRateLimit();

      expect((handler as any).requestTimestamps).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    it("should handle unknown request type", async () => {
      const request = {
        type: "AI_SUPPORT_REQUEST" as const,
        taskId: 1,
        requestId: "test-unknown-001",
        requestType: "unknown_type",
        pageContent: "Test",
        pageUrl: "https://example.com",
      } as unknown as AiSupportRequestMessage;

      await handler.handleAiSupportRequest(request, mockChildProcess as any);

      const response = JSON.parse(mockPostMessage.mock.calls[0][0]);
      expect(response.success).toBe(false);
      expect(response.errorMessage).toContain(
        "Unknown AI support request type"
      );
    });
  });
});
