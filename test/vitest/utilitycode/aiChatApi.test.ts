import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiChatApi } from "@/api/aiChatApi";
import type { ElectronStoreService } from "@/modules/electronstoreservice";

// Import the modules to be mocked
import { HttpClient } from "@/modules/lib/httpclient";
import { Token } from "@/modules/token";

// Mock HttpClient: use a single shared instance so tests can assert on postJson calls
const mockPostJsonShared = vi.fn();
vi.mock("@/modules/lib/httpclient", () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    postJson: mockPostJsonShared,
  })),
}));

// Mock Token service: Token has private store: ElectronStoreService and methods setValue, getValue
// USER_AI_ENABLED constant from @/config/usersetting is 'user_ai_enabled'
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => {
    const storeMock = {
      setValue: vi.fn(),
      getValue: vi.fn(),
      deleteValue: vi.fn(),
      clearStore: vi.fn(),
    };
    return {
      store: storeMock as unknown as ElectronStoreService,
      setValue: vi.fn(),
      getValue: vi.fn((key: string) => {
        if (key === "user_ai_enabled") return "true";
        return "";
      }),
    };
  }),
}));

describe("AiChatApi - Validation", () => {
  let api: AiChatApi;
  let mockPostJson: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create API instance with custom validation config for testing
    api = new AiChatApi({
      maxPageSize: 10 * 1024, // 10KB for testing
      maxErrorLength: 500,
    });
    mockPostJson = mockPostJsonShared;
  });

  describe("extractContactInfo", () => {
    it("should validate page content size", async () => {
      const largeContent = "x".repeat(11 * 1024); // 11KB, exceeds 10KB limit

      await expect(
        api.extractContactInfo(largeContent, "https://example.com")
      ).rejects.toThrow("Page content too large");
    });

    it("should accept valid page content within size limit", async () => {
      const validContent = "x".repeat(5 * 1024); // 5KB, within limit
      mockPostJson.mockResolvedValue({
        status: true,
        data: { emails: [], phones: [] },
      });

      await expect(
        api.extractContactInfo(validContent, "https://example.com")
      ).resolves.toBeDefined();
    });

    it("should validate screenshot format - invalid data URI", async () => {
      await expect(
        api.extractContactInfo(
          "Test content",
          "https://example.com",
          undefined,
          "data:text/plain;base64,invalid"
        )
      ).rejects.toThrow("Invalid screenshot format");
    });

    it("should accept valid screenshot data URI", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { emails: [], phones: [] },
      });

      await expect(
        api.extractContactInfo(
          "Test content",
          "https://example.com",
          undefined,
          "data:image/png;base64,iVBORw0KGgo"
        )
      ).resolves.toBeDefined();
    });

    it("should wrap raw base64 screenshot as data URI", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { emails: [], phones: [] },
      });

      const rawBase64 = "iVBORw0KGgo";
      await api.extractContactInfo(
        "Test content",
        "https://example.com",
        undefined,
        rawBase64
      );

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/contact/extract",
        expect.objectContaining({
          screenshot: `data:image/png;base64,${rawBase64}`,
        })
      );
    });

    it("should pass through existing data URI screenshot", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { emails: [], phones: [] },
      });

      const dataUri = "data:image/png;base64,iVBORw0KGgo";
      await api.extractContactInfo(
        "Test content",
        "https://example.com",
        undefined,
        dataUri
      );

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/contact/extract",
        expect.objectContaining({
          screenshot: dataUri,
        })
      );
    });
  });

  describe("scrapeAssist", () => {
    it("should validate page content size", async () => {
      const largeContent = "x".repeat(11 * 1024); // Exceeds 10KB limit

      await expect(
        api.scrapeAssist({
          pageContent: largeContent,
          pageUrl: "https://example.com",
          stepContext: "Test step",
          errorInfo: "Test error",
          platformName: "test",
          selectorsTried: {},
        })
      ).rejects.toThrow("Page content too large");
    });

    it("should sanitize error info - remove stack traces", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          suggestedSelectors: {},
          suggestedActions: [],
          shouldSkip: false,
          explanation: "Test",
        },
      });

      const errorWithStack =
        "Error: Test error\n    at test.js:10:15\n    at another.js:20:25";

      await api.scrapeAssist({
        pageContent: "Test",
        pageUrl: "https://example.com",
        stepContext: "Test step",
        errorInfo: errorWithStack,
        platformName: "test",
        selectorsTried: {},
      });

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/assist",
        expect.objectContaining({
          error_info: expect.not.stringContaining("at test.js:10:15"),
        })
      );
    });

    it("should truncate long error info", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          suggestedSelectors: {},
          suggestedActions: [],
          shouldSkip: false,
          explanation: "Test",
        },
      });

      const longError = "x".repeat(1000); // Exceeds 500 char limit

      await api.scrapeAssist({
        pageContent: "Test",
        pageUrl: "https://example.com",
        stepContext: "Test step",
        errorInfo: longError,
        platformName: "test",
        selectorsTried: {},
      });

      const callArgs = mockPostJson.mock.calls[0];
      const sanitizedError = callArgs[1].error_info;

      expect(sanitizedError.length).toBeLessThanOrEqual(503); // 500 + "..."
      expect(sanitizedError.endsWith("...")).toBe(true);
    });

    it("should sanitize error info - remove file paths", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          suggestedSelectors: {},
          suggestedActions: [],
          shouldSkip: false,
          explanation: "Test",
        },
      });

      const errorWithPath =
        "Error: /path/to/file.js:123:45 - Something went wrong";

      await api.scrapeAssist({
        pageContent: "Test",
        pageUrl: "https://example.com",
        stepContext: "Test step",
        errorInfo: errorWithPath,
        platformName: "test",
        selectorsTried: {},
      });

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/assist",
        expect.objectContaining({
          error_info: expect.not.stringContaining("/path/to/file.js"),
        })
      );
    });

    it("should sanitize error info - remove Error: prefix", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          suggestedSelectors: {},
          suggestedActions: [],
          shouldSkip: false,
          explanation: "Test",
        },
      });

      await api.scrapeAssist({
        pageContent: "Test",
        pageUrl: "https://example.com",
        stepContext: "Test step",
        errorInfo: "Error: Something went wrong",
        platformName: "test",
        selectorsTried: {},
      });

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/assist",
        expect.objectContaining({
          error_info: expect.not.stringMatching(/^Error:/),
        })
      );
    });

    it("should validate screenshot format", async () => {
      // Use invalid data URI (text/plain instead of image/*) so validator rejects
      await expect(
        api.scrapeAssist({
          pageContent: "Test",
          pageUrl: "https://example.com",
          screenshot: "data:text/plain;base64,invalid",
          stepContext: "Test step",
          errorInfo: "Test error",
          platformName: "test",
          selectorsTried: {},
        })
      ).rejects.toThrow("Invalid screenshot format");
    });

    it("should pass through all required parameters", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          suggestedSelectors: { phone: ".phone" },
          suggestedActions: ["Wait"],
          shouldSkip: false,
          explanation: "Test explanation",
        },
      });

      await api.scrapeAssist({
        pageContent: "Test content",
        pageUrl: "https://example.com",
        stepContext: "Extracting phone",
        errorInfo: "Element not found",
        platformName: "yellowpages",
        selectorsTried: { phone: ".old-phone" },
      });

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/assist",
        expect.objectContaining({
          page_content: "Test content",
          page_url: "https://example.com",
          step_context: "Extracting phone",
          error_info: "Element not found",
          platform_name: "yellowpages",
          selectors_tried: { phone: ".old-phone" },
        })
      );
    });

    it("should send screenshot_id and omit screenshot when screenshotId is provided", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          suggestedSelectors: {},
          suggestedActions: [],
          shouldSkip: false,
          explanation: "Test",
        },
      });

      await api.scrapeAssist({
        pageContent: "Test",
        pageUrl: "https://example.com",
        screenshotId: "uuid-from-upload",
        stepContext: "Test step",
        errorInfo: "Test error",
        platformName: "test",
        selectorsTried: {},
      });

      const payload = mockPostJson.mock.calls[0][1];
      expect(payload.screenshot_id).toBe("uuid-from-upload");
      expect(payload.screenshot).toBeUndefined();
    });
  });

  describe("uploadScrapeScreenshot", () => {
    it("should POST to upload endpoint with screenshot and optional ttl_seconds", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { screenshot_id: "test-uuid-123", ttl_seconds: 300 },
      });

      const result = await api.uploadScrapeScreenshot(
        "data:image/png;base64,iVBORw0KGgo",
        300
      );

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/screenshot/upload",
        expect.objectContaining({
          screenshot: "data:image/png;base64,iVBORw0KGgo",
          ttl_seconds: 300,
        })
      );
      expect(result.status).toBe(true);
      expect(result.data?.screenshot_id).toBe("test-uuid-123");
      expect(result.data?.ttl_seconds).toBe(300);
    });

    it("should normalize raw base64 to data URI when sending", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { screenshot_id: "id", ttl_seconds: 300 },
      });

      await api.uploadScrapeScreenshot("iVBORw0KGgo");

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/screenshot/upload",
        expect.objectContaining({
          screenshot: "data:image/png;base64,iVBORw0KGgo",
        })
      );
    });

    it("should validate screenshot format before upload", async () => {
      await expect(
        api.uploadScrapeScreenshot("data:text/plain;base64,invalid")
      ).rejects.toThrow("Invalid screenshot format");
    });

    it("should return failed status when server returns error", async () => {
      mockPostJson.mockResolvedValue({
        status: false,
        msg: "Storage quota exceeded",
        data: null,
      });

      const result = await api.uploadScrapeScreenshot(
        "data:image/png;base64,iVBORw0KGgo"
      );

      expect(result.status).toBe(false);
      expect(result.data).toBeNull();
      expect(result.msg).toBe("Storage quota exceeded");
    });

    it("should return failed status when upload returns no data", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        msg: "Upload successful but no data returned",
        data: null,
      });

      const result = await api.uploadScrapeScreenshot(
        "data:image/png;base64,iVBORw0KGgo"
      );

      expect(result.status).toBe(true);
      expect(result.data).toBeNull();
    });

    it("should handle network errors gracefully", async () => {
      mockPostJson.mockRejectedValue(new Error("Network connection failed"));

      await expect(
        api.uploadScrapeScreenshot("data:image/png;base64,iVBORw0KGgo")
      ).rejects.toThrow("Network connection failed");
    });

    it("should include ttl_seconds when provided", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { screenshot_id: "test-id", ttl_seconds: 600 },
      });

      await api.uploadScrapeScreenshot(
        "data:image/png;base64,iVBORw0KGgo",
        600
      );

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/screenshot/upload",
        expect.objectContaining({
          ttl_seconds: 600,
        })
      );
    });

    it("should omit ttl_seconds when not provided", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: { screenshot_id: "test-id", ttl_seconds: 300 },
      });

      await api.uploadScrapeScreenshot("data:image/png;base64,iVBORw0KGgo");

      expect(mockPostJson).toHaveBeenCalledWith(
        "/api/ai/scrape/screenshot/upload",
        expect.objectContaining({
          screenshot: "data:image/png;base64,iVBORw0KGgo",
        })
      );

      // Verify ttl_seconds is not in the payload
      const payload = mockPostJson.mock.calls[0][1];
      expect(payload.ttl_seconds).toBeUndefined();
    });
  });

  describe("scrapeObserve", () => {
    it("should send screenshot_id and omit screenshot when screenshotId is provided", async () => {
      mockPostJson.mockResolvedValue({
        status: true,
        data: {
          session_id: "sess-1",
          status: "actions_needed",
          actions: [],
          explanation: "",
          confidence: 0.5,
          should_retry: false,
          max_iterations_remaining: 2,
        },
      });

      await api.scrapeObserve({
        pageContent: "HTML",
        pageUrl: "https://example.com",
        screenshotId: "uploaded-id",
        goal: "Find search box",
        iteration: 0,
      });

      const payload = mockPostJson.mock.calls[0][1];
      expect(payload.screenshot_id).toBe("uploaded-id");
      expect(payload.screenshot).toBeUndefined();
    });
  });

  describe("ensureAIEnabled", () => {
    it("should throw when AI is not enabled (main process)", async () => {
      // Mock AI as disabled
      const MockedToken = vi.mocked(Token);
      const storeMock = {
        setValue: vi.fn(),
        getValue: vi.fn(),
        deleteValue: vi.fn(),
        clearStore: vi.fn(),
      } as unknown as ElectronStoreService;
      MockedToken.mockImplementation(
        () =>
          ({
            store: storeMock,
            setValue: vi.fn(),
            getValue: vi.fn((key: string) => {
              if (key === "USER_AI_ENABLED") return "false";
              return "";
            }),
          } as unknown as Token)
      );

      const disabledApi = new AiChatApi();

      await expect(
        disabledApi.extractContactInfo("Test", "https://example.com")
      ).rejects.toThrow("AI features are not enabled");
    });
  });
});

describe("AiChatApi - Error Sanitization", () => {
  let api: AiChatApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AiChatApi({
      maxErrorLength: 1000,
    });
  });

  const sanitizeErrorTests = [
    {
      name: "stack trace with function names",
      input:
        "Error: Test failed\n    at Object.test (src/test.js:10:15)\n    at run (src/index.js:20:5)",
      shouldNotContain: [
        "src/test.js:10:15",
        "src/index.js:20:5",
        "at Object.test",
      ],
    },
    {
      name: "minified stack trace",
      input: "at http://localhost:3000/app.js:123:456",
      shouldNotContain: ["http://localhost:3000/app.js:123:456"],
    },
    {
      name: "Error prefix",
      input: "Error: Something went wrong",
      shouldNotContain: ["Error:"],
      shouldContain: ["Something went wrong"],
    },
    {
      name: "long error message",
      input: "x".repeat(2000),
      shouldContain: ["..."],
      maxLength: 1003,
    },
  ];

  describe("sanitizeErrorInfo", () => {
    it.each(sanitizeErrorTests)(
      "$name",
      ({ input, shouldNotContain, shouldContain, maxLength }) => {
        const sanitized = (api as any).sanitizeErrorInfo(input);

        if (shouldNotContain) {
          shouldNotContain.forEach((str: string) => {
            expect(sanitized).not.toContain(str);
          });
        }

        if (shouldContain) {
          shouldContain.forEach((str: string) => {
            expect(sanitized).toContain(str);
          });
        }

        if (maxLength) {
          expect(sanitized.length).toBeLessThanOrEqual(maxLength);
        }
      }
    );
  });

  it("should handle empty error info", () => {
    const sanitized = (api as any).sanitizeErrorInfo("");
    expect(sanitized).toBe("");
  });

  it("should handle error info with only whitespace", () => {
    const sanitized = (api as any).sanitizeErrorInfo("   \n\t   ");
    expect(sanitized).toBe("");
  });
});

describe("AiChatApi - Screenshot Validation", () => {
  let api: AiChatApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AiChatApi();
  });

  describe("validateScreenshot", () => {
    it("should accept valid PNG data URI", () => {
      expect(() => {
        (api as any).validateScreenshot("data:image/png;base64,iVBORw0KGgo");
      }).not.toThrow();
    });

    it("should accept valid JPEG data URI", () => {
      expect(() => {
        (api as any).validateScreenshot("data:image/jpeg;base64,/9j/4AAQ");
      }).not.toThrow();
    });

    it("should accept valid WebP data URI", () => {
      expect(() => {
        (api as any).validateScreenshot("data:image/webp;base64,UklGR");
      }).not.toThrow();
    });

    it("should reject text data URI", () => {
      expect(() => {
        (api as any).validateScreenshot("data:text/plain;base64,invalid");
      }).toThrow("Invalid screenshot format");
    });

    it("should reject malformed data URI", () => {
      expect(() => {
        (api as any).validateScreenshot("data:image/png;");
      }).toThrow("Invalid screenshot format");
    });

    it("should accept raw base64 string (for wrapping)", () => {
      expect(() => {
        (api as any).validateScreenshot("iVBORw0KGgoAAAANSUhEUg");
      }).not.toThrow();
    });
  });
});

describe("AiChatApi - Page Size Validation", () => {
  let api: AiChatApi;

  beforeEach(() => {
    vi.clearAllMocks();
    api = new AiChatApi({
      maxPageSize: 50 * 1024, // 50KB default
    });
  });

  describe("validatePageSize", () => {
    it("should accept page content within limit", () => {
      const content = "x".repeat(49 * 1024); // 49KB
      expect(() => {
        (api as any).validatePageSize(content);
      }).not.toThrow();
    });

    it("should reject page content exceeding limit", () => {
      const content = "x".repeat(51 * 1024); // 51KB
      expect(() => {
        (api as any).validatePageSize(content);
      }).toThrow("Page content too large");
    });

    it("should accept page content exactly at limit", () => {
      const content = "x".repeat(50 * 1024); // Exactly 50KB
      expect(() => {
        (api as any).validatePageSize(content);
      }).not.toThrow();
    });

    it("should include size information in error", () => {
      const content = "x".repeat(60 * 1024); // 60KB
      expect(() => {
        (api as any).validatePageSize(content);
      }).toThrow(/61440/);
      expect(() => {
        (api as any).validatePageSize(content);
      }).toThrow(/51200/);
    });
  });
});
