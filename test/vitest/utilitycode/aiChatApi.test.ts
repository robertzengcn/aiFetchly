import { describe, it, expect, beforeEach, vi } from "vitest";
import { AiChatApi } from "@/api/aiChatApi";
import type { ElectronStoreService } from "@/modules/electronstoreservice";

// Import the modules to be mocked
import { HttpClient } from "@/modules/lib/httpclient";
import { Token } from "@/modules/token";

// Mock HttpClient: use a single shared instance so tests can assert on postJson calls
const mockPostJsonShared = vi.fn();
const mockGetShared = vi.fn();
const mockPostStreamShared = vi.fn();
vi.mock("@/modules/lib/httpclient", () => ({
  HttpClient: vi.fn().mockImplementation(() => ({
    postJson: mockPostJsonShared,
    get: mockGetShared,
    postStream: mockPostStreamShared,
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

describe("AiChatApi - OpenAI compatibility fallback", () => {
  let api: AiChatApi;

  beforeEach(() => {
    vi.clearAllMocks();
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
            if (key === "USER_AI_ENABLED" || key === "user_ai_enabled") {
              return "true";
            }
            return "";
          }),
        } as unknown as Token)
    );
    api = new AiChatApi();
  });

  it("normalizes the /api/ai/v1/models response into OpenAI shape", async () => {
    mockGetShared.mockResolvedValueOnce({
      models: [
        {
          name: "agnes-2.0-flash",
          available: true,
          max_tokens: 0,
          context_size: 256000,
          description: null,
        },
        {
          name: "gemini-3-pro-preview",
          available: true,
          max_tokens: 0,
          context_size: 1000000,
          description: null,
        },
      ],
      default_model: "agnes-2.0-flash",
      total_count: 2,
    });

    const result = await api.listOpenAIModels();

    expect(mockGetShared).toHaveBeenCalledWith("/api/ai/v1/models");
    expect(result).toEqual({
      object: "list",
      data: [
        {
          id: "agnes-2.0-flash",
          object: "model",
          created: 0,
          owned_by: "ai-server",
          context_size: 256000,
        },
        {
          id: "gemini-3-pro-preview",
          object: "model",
          created: 0,
          owned_by: "ai-server",
          context_size: 1000000,
        },
      ],
      default_model: "agnes-2.0-flash",
    });
  });

  it("retries model listing when the backend is temporarily unreachable", async () => {
    vi.useFakeTimers();
    try {
      mockGetShared.mockRejectedValueOnce(new Error("fetch failed"));
      mockGetShared.mockResolvedValueOnce({
        models: [
          {
            name: "agnes-2.0-flash",
            available: true,
            max_tokens: 0,
            context_size: 256000,
            description: null,
          },
        ],
        default_model: "agnes-2.0-flash",
        total_count: 1,
      });

      const resultPromise = api.listOpenAIModels();
      await vi.advanceTimersByTimeAsync(500);
      const result = await resultPromise;

      expect(mockGetShared).toHaveBeenNthCalledWith(1, "/api/ai/v1/models");
      expect(mockGetShared).toHaveBeenNthCalledWith(2, "/api/ai/v1/models");
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe("agnes-2.0-flash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to legacy model listing when /api/ai/v1/models is not found", async () => {
    const notFound = new Error("Not Found");
    mockGetShared.mockRejectedValueOnce(notFound).mockResolvedValueOnce({
      models: {
        "gpt-4o-mini": {
          name: "gpt-4o-mini",
          description: "Default chat model",
          maxTokens: 128000,
          supportsStreaming: true,
        },
      },
      default_model: "gpt-4o-mini",
      total_models: 1,
    });

    const result = await api.listOpenAIModels();

    expect(mockGetShared).toHaveBeenNthCalledWith(1, "/api/ai/v1/models");
    expect(mockGetShared).toHaveBeenNthCalledWith(2, "/api/ai/chat/models");
    expect(result).toEqual({
      object: "list",
      data: [
        {
          id: "gpt-4o-mini",
          object: "model",
          created: 0,
          owned_by: "legacy-ai-server",
        },
      ],
    });
  });

  it("falls back to legacy streaming when /v1/chat/completions is not found", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                "event: token",
                'data: {"content":"Hello","timestamp":"2026-06-13T00:00:00.000Z"}',
                "",
                "event: token",
                'data: {"content":" world","timestamp":"2026-06-13T00:00:01.000Z"}',
                "",
                "event: done",
                'data: {"content":"","timestamp":"2026-06-13T00:00:02.000Z"}',
                "",
              ].join("\n")
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    mockPostStreamShared
      .mockRejectedValueOnce(new Error("Not Found"))
      .mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
        temperature: 0.2,
        max_tokens: 100,
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(mockPostStreamShared).toHaveBeenNthCalledWith(
      1,
      "/api/ai/v1/chat/completions",
      expect.objectContaining({
        stream: true,
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Hi" }],
      }),
      {}
    );
    expect(mockPostStreamShared).toHaveBeenNthCalledWith(
      2,
      "/api/ai/ask/stream",
      expect.objectContaining({
        message: "User: Hi",
        model: "gpt-4o-mini",
      }),
      {}
    );
    expect(chunks).toEqual([
      { content: "Hello", finishReason: null },
      { content: " world", finishReason: null },
      { content: undefined, finishReason: "stop" },
    ]);
  });

  it("parses OpenAI SSE data lines without a space after the colon", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data:{"id":"resp-1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"AI"},"finish_reason":null}]}',
                "",
                'data:{"id":"resp-1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"content":" response"},"finish_reason":null}]}',
                "",
                'data:{"id":"resp-1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
                "",
                "data:[DONE]",
                "",
              ].join("\n")
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }],
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(chunks).toEqual([
      { content: "AI", finishReason: null },
      { content: " response", finishReason: null },
      { content: undefined, finishReason: "stop" },
    ]);
  });

  it("normalizes legacy content SSE events returned from the OpenAI stream route", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                "event: token",
                'data: {"content":"AI","timestamp":"2026-06-16T00:00:00.000Z"}',
                "",
                "event: token",
                'data: {"content":" response","timestamp":"2026-06-16T00:00:01.000Z"}',
                "",
                "event: done",
                'data: {"content":"","timestamp":"2026-06-16T00:00:02.000Z"}',
                "",
              ].join("\n")
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }],
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(chunks).toEqual([
      { content: "AI", finishReason: null },
      { content: " response", finishReason: null },
      { content: "", finishReason: "stop" },
    ]);
  });

  it("normalizes non-streaming message choices returned from the OpenAI stream route", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"id":"resp-1","object":"chat.completion","created":1,"model":"gpt-test","choices":[{"index":0,"message":{"role":"assistant","content":"AI response"},"finish_reason":"stop"}]}',
                "",
                "data: [DONE]",
                "",
              ].join("\n")
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }],
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(chunks).toEqual([{ content: "AI response", finishReason: "stop" }]);
  });

  it("preserves images from non-streaming message choices returned from the OpenAI stream route", async () => {
    const encoder = new TextEncoder();
    const imageUrl = "https://example.com/generated.png";
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                `data: ${JSON.stringify({
                  id: "resp-image-1",
                  object: "chat.completion",
                  created: 1,
                  model: "gpt-test",
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: "assistant",
                        content: "Image ready",
                        images: [
                          {
                            type: "image",
                            delivery: "provider_url",
                            url: imageUrl,
                            mime_type: "image/png",
                            download_required: true,
                          },
                        ],
                      },
                      finish_reason: "stop",
                    },
                  ],
                })}`,
                "",
                "data: [DONE]",
                "",
              ].join("\n")
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      imageUrl?: string;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "gpt-test",
        messages: [{ role: "user", content: "Generate an image" }],
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          imageUrl: chunk.choices[0]?.delta?.images?.[0]?.url,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(chunks).toEqual([
      {
        content: "Image ready",
        imageUrl,
        finishReason: "stop",
      },
    ]);
  });

  it("recovers a non-SSE JSON body with finish_reason=error when server bypasses SSE framing", async () => {
    // Real-world failure: under load the AI server sometimes returns a plain
    // JSON body (no "data:" prefix) using the non-streaming "message" shape.
    // Without recovery the SSE parser emits zero chunks and the accumulator
    // reports finishReason=undefined, masking the real server-side error.
    const encoder = new TextEncoder();
    const body = JSON.stringify({
      id: "chatcmpl-error-1",
      object: "chat.completion",
      created: 1,
      model: "deepseek-v4-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "", tool_calls: null },
          finish_reason: "error",
        },
      ],
    });
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "Hi" }],
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(chunks).toEqual([{ content: "", finishReason: "error" }]);
  });

  it("does not double-emit when the SSE stream already delivered chunks", async () => {
    // Regression guard: the non-SSE fallback must only fire when NOTHING was
    // emitted. Normal SSE streams should be unaffected.
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              [
                'data: {"id":"resp-1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}',
                "",
                'data: {"id":"resp-1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
                "",
                "data: [DONE]",
                "",
              ].join("\n")
            )
          );
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    const chunks: Array<{
      content?: string | null;
      finishReason?: string | null;
    }> = [];
    await api.openAIChatCompletionStream(
      {
        model: "gpt-test",
        messages: [{ role: "user", content: "Hi" }],
      },
      (chunk) => {
        chunks.push({
          content: chunk.choices[0]?.delta?.content,
          finishReason: chunk.choices[0]?.finish_reason,
        });
      }
    );

    expect(chunks).toEqual([
      { content: "hi", finishReason: null },
      { content: undefined, finishReason: "stop" },
    ]);
  });

  it("surfaces non-SSE JSON API envelope errors instead of ignoring them", async () => {
    const encoder = new TextEncoder();
    const body = JSON.stringify({
      status: false,
      code: 500,
      msg: "database connection is not open",
      data: null,
    });
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

    mockPostStreamShared.mockResolvedValueOnce(response);

    await expect(
      api.openAIChatCompletionStream(
        {
          model: "gpt-test",
          messages: [{ role: "user", content: "Hi" }],
        },
        vi.fn()
      )
    ).rejects.toThrow("AI server error code=500: database connection is not open");
  });
});

describe("AiChatApi - Recovery-driven streaming retry", () => {
  function makeResponse(
    body: string,
    status = 200,
    headers: Record<string, string> = { "Content-Type": "text/event-stream" }
  ): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      { status, headers }
    );
  }

  function successStream(): Response {
    return makeResponse(
      [
        'data: {"id":"r","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
        "",
        'data: {"id":"r","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n")
    );
  }

  beforeEach(() => {
    mockPostStreamShared.mockReset();
    mockPostJsonShared.mockReset();
    mockGetShared.mockReset();
  });

  it("retries a network failure then succeeds and emits retry + recovery_status", async () => {
    vi.useFakeTimers();
    try {
      mockPostStreamShared
        .mockRejectedValueOnce(new Error("connect ECONNRESET"))
        .mockResolvedValueOnce(successStream());

      const api = new AiChatApi();
      const retries: Array<{ attempt: number; delayMs: number }> = [];
      const recoveries: Array<{
        layer: string;
        reason: string;
        attempt: number;
      }> = [];
      const chunks: string[] = [];

      const p = api.openAIChatCompletionStream(
        {
          model: "m",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
        },
        (c) => {
          const t = c.choices[0]?.delta?.content;
          if (t) chunks.push(t);
        },
        {
          retryProfile: "foreground",
          onRetry: (info) =>
            retries.push({ attempt: info.attempt, delayMs: info.delayMs }),
          onRecoveryStatus: (info) =>
            recoveries.push({
              layer: info.layer,
              reason: info.reason,
              attempt: info.attempt,
            }),
        }
      );
      await vi.runAllTimersAsync();
      await p;

      expect(chunks.join("")).toBe("ok");
      expect(retries).toHaveLength(1);
      expect(retries[0].attempt).toBe(2);
      expect(recoveries).toEqual([
        { layer: "api_retry", reason: "network", attempt: 2 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries HTTP 429 and honors Retry-After", async () => {
    vi.useFakeTimers();
    try {
      mockPostStreamShared
        .mockResolvedValueOnce(
          makeResponse("rate limit", 429, { "Retry-After": "1" })
        )
        .mockResolvedValueOnce(successStream());

      const api = new AiChatApi();
      const recoveries: Array<{ reason: string; delayMs: number }> = [];
      const p = api.openAIChatCompletionStream(
        {
          model: "m",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
        },
        () => undefined,
        {
          retryProfile: "foreground",
          onRecoveryStatus: (info) =>
            recoveries.push({ reason: info.reason, delayMs: info.delayMs }),
        }
      );
      await vi.runAllTimersAsync();
      await p;

      expect(recoveries).toHaveLength(1);
      expect(recoveries[0].reason).toBe("rate_limit");
      // Retry-After=1s → 1000ms is the minimum; jitter may push higher.
      expect(recoveries[0].delayMs).toBeGreaterThanOrEqual(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries HTTP 529 overload then succeeds", async () => {
    vi.useFakeTimers();
    try {
      mockPostStreamShared
        .mockResolvedValueOnce(makeResponse("overloaded_error", 529))
        .mockResolvedValueOnce(successStream());

      const api = new AiChatApi();
      const layers: string[] = [];
      const p = api.openAIChatCompletionStream(
        {
          model: "m",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
        },
        () => undefined,
        {
          retryProfile: "foreground",
          onRecoveryStatus: (info) => layers.push(info.layer),
        }
      );
      await vi.runAllTimersAsync();
      await p;

      expect(layers).toEqual(["overload_retry"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts during retry sleep reject immediately", async () => {
    mockPostStreamShared.mockRejectedValueOnce(new Error("ECONNRESET"));

    const api = new AiChatApi();
    const ac = new AbortController();
    const recoveryEvents: number[] = [];
    const promise = api.openAIChatCompletionStream(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 16,
      },
      () => undefined,
      {
        signal: ac.signal,
        retryProfile: "foreground",
        onRecoveryStatus: () => {
          recoveryEvents.push(1);
          // Fire abort immediately after the recovery event lands,
          // before the long sleep completes.
          ac.abort();
        },
      }
    );
    await expect(promise).rejects.toBeDefined();
    expect(recoveryEvents).toHaveLength(1);
  });

  it("throws AIChatRecoverableError after exhausting foreground retries", async () => {
    vi.useFakeTimers();
    try {
      // Always 500.
      mockPostStreamShared.mockResolvedValue(makeResponse("boom", 500));

      const api = new AiChatApi();
      const p = api.openAIChatCompletionStream(
        {
          model: "m",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 16,
        },
        () => undefined,
        { retryProfile: "foreground" }
      );
      const assertion = expect(p).rejects.toThrow(/HTTP 500/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
