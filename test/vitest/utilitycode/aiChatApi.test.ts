import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiChatApi } from "@/api/aiChatApi";

// Import the modules to be mocked
import { HttpClient } from "@/modules/lib/httpclient";
import { Token } from "@/modules/token";

// Mock HttpClient
vi.mock("@/modules/lib/httpclient", () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    postJson: vi.fn(),
  })),
}));

// Mock Token service
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    store: vi.fn(),
    setValue: vi.fn(),
    getValue: vi.fn((key: string) => {
      if (key === "USER_AI_ENABLED") return "true";
      return "";
    }),
    deleteValue: vi.fn(),
    clearStore: vi.fn(),
  })),
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

    // Get mock postJson function from the mocked HttpClient
    const MockedHttpClient = vi.mocked(HttpClient);
    const mockInstance = new MockedHttpClient();
    mockPostJson = mockInstance.postJson as ReturnType<typeof vi.fn>;
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
      await expect(
        api.scrapeAssist({
          pageContent: "Test",
          pageUrl: "https://example.com",
          screenshot: "invalid-screenshot",
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
  });

  describe("ensureAIEnabled", () => {
    it("should throw when AI is not enabled (main process)", async () => {
      // Mock AI as disabled
      const MockedToken = vi.mocked(Token);
      MockedToken.mockImplementation(() => ({
        store: vi.fn(),
        setValue: vi.fn(),
        getValue: vi.fn((key: string) => {
          if (key === "USER_AI_ENABLED") return "false";
          return "";
        }),
        deleteValue: vi.fn(),
        clearStore: vi.fn(),
      }));

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
      }).toThrow(expect.stringContaining("61440"));
      expect(() => {
        (api as any).validatePageSize(content);
      }).toThrow(expect.stringContaining("51200"));
    });
  });
});
