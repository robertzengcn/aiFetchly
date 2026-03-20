import type { UtilityProcess } from "electron";
import { AiChatApi } from "@/api/aiChatApi";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import type {
  AiExecutableAction,
  AiScrapeGuidanceData,
} from "@/modules/interface/BackgroundProcessMessages";
import {
  AiSupportRequestMessage,
  AiSupportResponseMessage,
  isAiSupportRequestMessage,
} from "@/modules/interface/BackgroundProcessMessages";
import { WriteLog } from "@/modules/lib/function";

function isAiExecutableAction(v: unknown): v is AiExecutableAction {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.action_id === "string" && typeof obj.type === "string";
}

/**
 * Normalize step_guidance response from server (snake_case) to shape expected by child (camelCase).
 * Accepts both formats so it works whether the API returns snake_case or camelCase.
 */
function normalizeStepGuidanceData(
  raw: Record<string, unknown>
): AiScrapeGuidanceData {
  const suggestedSelectors =
    (raw.suggestedSelectors as Record<string, string> | undefined) ??
    (raw["suggested_selectors"] as Record<string, string> | undefined) ??
    {};
  const actions =
    (raw.actions as unknown[] | undefined) ??
    (raw["actions"] as unknown[] | undefined) ??
    [];
  const suggestedActions =
    (raw.suggestedActions as string[] | undefined) ??
    (raw["suggested_actions"] as string[] | undefined) ??
    [];
  const shouldSkip =
    (raw.shouldSkip as boolean | undefined) ??
    (raw["should_skip"] as boolean | undefined) ??
    false;
  const explanation = (raw.explanation as string | undefined) ?? "";
  return {
    suggestedSelectors:
      typeof suggestedSelectors === "object" && suggestedSelectors !== null
        ? suggestedSelectors
        : {},
    actions: Array.isArray(actions) ? actions.filter(isAiExecutableAction) : [],
    suggestedActions: Array.isArray(suggestedActions) ? suggestedActions : [],
    shouldSkip: Boolean(shouldSkip),
    explanation: String(explanation),
  };
}

/**
 * Cached AI response with timestamp
 */
interface CachedResponse {
  data: AiSupportResponseMessage;
  timestamp: number;
}

/**
 * Configuration for AI support handler
 */
interface AiSupportConfig {
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtl: number;
  /** Maximum size of page content in bytes (default: 50KB) */
  maxPageSize: number;
  /** Maximum requests per minute (default: 10) */
  rateLimitPerMinute: number;
  /** Request timeout in milliseconds (default: 30 seconds) */
  requestTimeout: number;
}

/**
 * Default configuration for AI support handler
 */
const DEFAULT_CONFIG: AiSupportConfig = {
  cacheTtl: 5 * 60 * 1000, // 5 minutes
  maxPageSize: 50 * 1024, // 50KB
  rateLimitPerMinute: 10,
  requestTimeout: 30 * 1000, // 30 seconds
};

/**
 * Error codes for AI support operations
 */
export enum AiSupportErrorCode {
  AI_NOT_ENABLED = "AI_NOT_ENABLED",
  REQUEST_TIMEOUT = "REQUEST_TIMEOUT",
  PAGE_TOO_LARGE = "PAGE_TOO_LARGE",
  RATE_LIMITED = "RATE_LIMITED",
  INVALID_REQUEST = "INVALID_REQUEST",
  API_ERROR = "API_ERROR",
}

/**
 * Yellow Pages AI Support Handler
 *
 * Handles AI-powered scraping assistance requests from child processes.
 * Provides caching, rate limiting, and proper error handling for AI operations.
 *
 * Features:
 * - Response caching with TTL to reduce redundant AI calls
 * - Rate limiting to prevent overwhelming the AI server
 * - Request timeout handling
 * - Input validation (page size, screenshot format)
 * - Structured logging
 * - Detailed error messages with user guidance
 *
 * @example
 * ```typescript
 * const handler = new YellowPagesAiSupportHandler();
 * await handler.handleAiSupportRequest(request, childProcess);
 * ```
 */
export class YellowPagesAiSupportHandler {
  private aiApi: AiChatApi;
  private cache: Map<string, CachedResponse>;
  private requestTimestamps: number[] = [];
  private config: AiSupportConfig;
  private logFile?: string;

  constructor(config?: Partial<AiSupportConfig>, logFile?: string) {
    this.aiApi = new AiChatApi();
    this.cache = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logFile = logFile;
  }

  /**
   * Handle AI support requests from the child process.
   * Routes to extractContactInfo or scrapeAssist based on requestType,
   * then sends the response back to the child process.
   *
   * @param request - The AI support request message
   * @param childProcess - The child process to send response to
   */
  async handleAiSupportRequest(
    request: AiSupportRequestMessage,
    childProcess: UtilityProcess
  ): Promise<void> {
    const { requestId, requestType, taskId } = request;

    this.logInfo(
      `AI support request received: type=${requestType}, id=${requestId}`
    );

    // Validate AI enable status first
    const aiEnabled = this.isAiEnabled();
    if (!aiEnabled) {
      this.sendResponse(
        {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage: this.getUserFacingError(
            AiSupportErrorCode.AI_NOT_ENABLED
          ),
        },
        childProcess
      );
      return;
    }

    // Validate request structure
    if (!isAiSupportRequestMessage(request)) {
      this.sendResponse(
        {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage: this.getUserFacingError(
            AiSupportErrorCode.INVALID_REQUEST
          ),
        },
        childProcess
      );
      return;
    }

    // Check rate limit
    if (this.isRateLimited()) {
      this.logWarn(`Rate limit exceeded for AI requests: ${requestId}`);
      this.sendResponse(
        {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage: this.getUserFacingError(
            AiSupportErrorCode.RATE_LIMITED
          ),
        },
        childProcess
      );
      return;
    }

    // Validate page content size
    if (
      request.pageContent &&
      request.pageContent.length > this.config.maxPageSize
    ) {
      this.logWarn(
        `Page content too large: ${request.pageContent.length} bytes (max: ${this.config.maxPageSize})`
      );
      this.sendResponse(
        {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage: this.getUserFacingError(
            AiSupportErrorCode.PAGE_TOO_LARGE
          ),
        },
        childProcess
      );
      return;
    }

    // Validate screenshot format if provided
    if (
      request.screenshot &&
      !this.isValidScreenshotFormat(request.screenshot)
    ) {
      this.logWarn(`Invalid screenshot format for request: ${requestId}`);
      this.sendResponse(
        {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage:
            "Invalid screenshot format. Screenshots must be base64-encoded PNG images.",
        },
        childProcess
      );
      return;
    }

    // Check cache for existing response
    const cacheKey = this.getCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached && !this.isCacheExpired(cached)) {
      this.logInfo(`Cache hit for AI request: ${requestId}`);
      this.sendResponse(cached.data, childProcess);
      return;
    }

    // Process the request
    try {
      const response = await this.executeAiRequest(request);

      // Cache the successful response
      if (response.success) {
        this.cache.set(cacheKey, {
          data: response,
          timestamp: Date.now(),
        });
        // Clean up old cache entries
        this.cleanExpiredCache();
      }

      this.sendResponse(response, childProcess);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logError(`AI support request failed: ${errorMsg}`);

      this.sendResponse(
        {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage: `AI request failed: ${errorMsg}`,
        },
        childProcess
      );
    }
  }

  /**
   * Execute the AI request with timeout
   */
  private async executeAiRequest(
    request: AiSupportRequestMessage
  ): Promise<AiSupportResponseMessage> {
    const { requestId, requestType, taskId } = request;

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`AI request timeout after ${this.config.requestTimeout}ms`)
        );
      }, this.config.requestTimeout);
    });

    // Create request promise
    const requestPromise = this.performAiRequest(request);

    try {
      // Race between request and timeout
      const result = await Promise.race([requestPromise, timeoutPromise]);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        return {
          type: "AI_SUPPORT_RESPONSE",
          taskId,
          requestId,
          success: false,
          requestType,
          errorMessage: this.getUserFacingError(
            AiSupportErrorCode.REQUEST_TIMEOUT
          ),
        };
      }
      throw error;
    }
  }

  /**
   * Perform the actual AI API call based on request type
   */
  private async performAiRequest(
    request: AiSupportRequestMessage
  ): Promise<AiSupportResponseMessage> {
    const { requestId, requestType, taskId } = request;

    if (requestType === "contact_extraction") {
      return this.handleContactExtraction(request);
    } else if (requestType === "step_guidance") {
      return this.handleStepGuidance(request);
    } else if (requestType === "observe_execute") {
      return this.handleObserveExecute(request);
    } else {
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: false,
        requestType,
        errorMessage: `Unknown AI support request type: ${String(requestType)}`,
      };
    }
  }

  /**
   * Handle observe-execute request: call scrapeObserve and return actions or status.
   */
  private async handleObserveExecute(
    request: AiSupportRequestMessage
  ): Promise<AiSupportResponseMessage> {
    const {
      requestId,
      taskId,
      pageContent,
      pageUrl,
      screenshot,
      goal,
      sessionId,
      previousActionResults,
      iteration,
      platformName,
      selectorsAvailable,
      maxIterations,
      goalContext,
      stepContext,
      errorInfo,
    } = request;

    if (!goal || goal.trim() === "") {
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: false,
        requestType: "observe_execute",
        errorMessage: "goal is required for observe_execute",
      };
    }

    this.logInfo(`Processing observe-execute request: ${requestId}`);

    // Upload screenshot if present (with 5-minute TTL for server-side caching)
    const screenshotId = await this.uploadScreenshotIfNeeded(
      screenshot,
      requestId,
      300
    );

    const result = await this.aiApi.scrapeObserve({
      sessionId: sessionId ?? undefined,
      pageContent,
      pageUrl,
      // Always use uploaded screenshot_id; never send inline screenshot with page HTML
      screenshotId,
      goal: goal.trim(),
      platformName: platformName ?? "yellowpages",
      selectorsAvailable: selectorsAvailable ?? {},
      previousActionResults: previousActionResults ?? [],
      iteration: iteration ?? 0,
      maxIterations: maxIterations,
      goalContext: goalContext,
      stepContext: stepContext,
      errorInfo: errorInfo,
    });

    if (result.status && result.data) {
      this.logInfo(
        `Observe-execute successful: ${requestId}, status=${result.data.status}`
      );
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: true,
        requestType: "observe_execute",
        data: {
          session_id: result.data.session_id,
          status: result.data.status,
          actions: result.data.actions,
          explanation: result.data.explanation,
          confidence: result.data.confidence,
          should_retry: result.data.should_retry,
          max_iterations_remaining: result.data.max_iterations_remaining,
          model_used: result.data.model_used,
          processing_time: result.data.processing_time,
        },
      };
    } else {
      this.logWarn(
        `Observe-execute returned no data: ${requestId} - ${result.msg}`
      );
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: false,
        requestType: "observe_execute",
        errorMessage: result.msg ?? "Observe-execute returned no data",
      };
    }
  }

  /**
   * Handle contact extraction request
   */
  private async handleContactExtraction(
    request: AiSupportRequestMessage
  ): Promise<AiSupportResponseMessage> {
    const {
      requestId,
      taskId,
      pageContent,
      pageUrl,
      businessName,
      screenshot,
    } = request;

    this.logInfo(`Processing contact extraction request: ${requestId}`);

    const result = await this.aiApi.extractContactInfo(
      pageContent,
      pageUrl,
      businessName,
      screenshot
    );

    if (result.status && result.data) {
      this.logInfo(`Contact extraction successful: ${requestId}`);
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: true,
        requestType: "contact_extraction",
        data: {
          emails: result.data.emails ?? [],
          phones: result.data.phones ?? [],
          address: result.data.address,
          socialLinks: result.data.socialLinks,
          confidence: result.data.confidence,
        },
      };
    } else {
      this.logWarn(
        `Contact extraction returned no data: ${requestId} - ${result.msg}`
      );
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: false,
        requestType: "contact_extraction",
        errorMessage: result.msg || "Contact extraction returned no data",
      };
    }
  }

  /**
   * Handle step guidance request.
   * When screenshot is present, upload it first and pass screenshot_id to avoid oversized request body.
   */
  private async handleStepGuidance(
    request: AiSupportRequestMessage
  ): Promise<AiSupportResponseMessage> {
    const {
      requestId,
      taskId,
      pageContent,
      pageUrl,
      screenshot,
      stepContext,
      errorInfo,
      platformName,
      selectorsTried,
    } = request;

    this.logInfo(`Processing step guidance request: ${requestId}`);

    // Upload screenshot if present (with 5-minute TTL for server-side caching)
    const screenshotId = await this.uploadScreenshotIfNeeded(
      screenshot,
      requestId,
      300
    );

    const result = await this.aiApi.scrapeAssist({
      pageContent,
      pageUrl,
      // Always use uploaded screenshot_id; never send inline screenshot with page HTML
      screenshotId,
      stepContext: stepContext || "",
      errorInfo: errorInfo || "",
      platformName: platformName || "yellowpages",
      selectorsTried: selectorsTried || {},
    });

    if (result.status && result.data) {
      this.logInfo(`Step guidance successful: ${requestId}`);
      const data = normalizeStepGuidanceData(
        result.data as unknown as Record<string, unknown>
      );
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: true,
        requestType: "step_guidance",
        data,
      };
    } else {
      this.logWarn(
        `Step guidance returned no data: ${requestId} - ${result.msg}`
      );
      return {
        type: "AI_SUPPORT_RESPONSE",
        taskId,
        requestId,
        success: false,
        requestType: "step_guidance",
        errorMessage: result.msg || "Scrape assist returned no data",
      };
    }
  }

  /**
   * Check if AI is enabled for the current user
   */
  private isAiEnabled(): boolean {
    try {
      const tokenService = new Token();
      const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
      return aiEnabled === "true";
    } catch (error) {
      this.logError(`Failed to check AI enabled status: ${error}`);
      return false;
    }
  }

  /**
   * Check if the current request is rate limited
   */
  private isRateLimited(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => ts > oneMinuteAgo
    );

    // Check if limit exceeded
    if (this.requestTimestamps.length >= this.config.rateLimitPerMinute) {
      return true;
    }

    // Add current timestamp
    this.requestTimestamps.push(now);
    return false;
  }

  /**
   * Validate screenshot format
   */
  private isValidScreenshotFormat(screenshot: string): boolean {
    // Check if it's already a data URI
    if (screenshot.startsWith("data:image/")) {
      return /^data:image\/[a-z]+;base64,/.test(screenshot);
    }
    // Raw base64 is also valid
    return true;
  }

  /**
   * Upload screenshot to server and return screenshot_id.
   * Returns undefined if screenshot is empty, upload fails, or on error.
   * Logs appropriate messages for success, failure, and errors.
   *
   * @param screenshot - The screenshot data (base64 or data URI)
   * @param requestId - Request ID for logging
   * @param ttlSeconds - Optional TTL for server-side caching (default: 300 seconds / 5 minutes)
   * @returns screenshot_id string on success, undefined otherwise
   */
  private async uploadScreenshotIfNeeded(
    screenshot: string | undefined,
    requestId: string,
    ttlSeconds = 300
  ): Promise<string | undefined> {
    if (!screenshot || screenshot.trim() === "") {
      return undefined;
    }

    try {
      const uploadResult = await this.aiApi.uploadScrapeScreenshot(
        screenshot,
        ttlSeconds
      );

      if (uploadResult.status && uploadResult.data?.screenshot_id) {
        this.logInfo(
          `Screenshot uploaded successfully for request ${requestId}: ${uploadResult.data.screenshot_id} (TTL: ${ttlSeconds}s)`
        );
        return uploadResult.data.screenshot_id;
      } else {
        this.logWarn(
          `Screenshot upload failed for request ${requestId}: ${
            uploadResult.msg || "Unknown error"
          }, screenshot will be omitted from AI request`
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logError(
        `Screenshot upload error for request ${requestId}: ${errorMsg}, screenshot will be omitted from AI request`
      );
    }

    return undefined;
  }

  /**
   * Generate cache key from request
   */
  private getCacheKey(request: AiSupportRequestMessage): string {
    const {
      requestType,
      pageUrl,
      stepContext,
      errorInfo,
      platformName,
      selectorsTried,
    } = request;

    if (requestType === "contact_extraction") {
      // For contact extraction, cache by URL and page content hash
      return `contact:${pageUrl}:${this.hashString(
        request.pageContent.substring(0, 1000)
      )}`;
    } else {
      // For step guidance, cache by URL, context, error, and selectors
      const selectorsJson = JSON.stringify(selectorsTried || {});
      return `guidance:${pageUrl}:${stepContext}:${errorInfo}:${platformName}:${selectorsJson}`;
    }
  }

  /**
   * Simple string hash for cache keys
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Check if cache entry is expired
   */
  private isCacheExpired(cached: CachedResponse): boolean {
    return Date.now() - cached.timestamp > this.config.cacheTtl;
  }

  /**
   * Clean up expired cache entries
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.config.cacheTtl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Send response message to child process
   */
  private sendResponse(
    response: AiSupportResponseMessage,
    childProcess: UtilityProcess
  ): void {
    try {
      childProcess.postMessage(JSON.stringify(response));
    } catch (error) {
      this.logError(`Failed to send response to child process: ${error}`);
    }
  }

  /**
   * Get user-facing error message with guidance
   */
  private getUserFacingError(errorCode: AiSupportErrorCode): string {
    switch (errorCode) {
      case AiSupportErrorCode.AI_NOT_ENABLED:
        return "AI support is not enabled. Please enable AI in settings or upgrade your plan to access AI features.";
      case AiSupportErrorCode.REQUEST_TIMEOUT:
        return "AI request timed out. The AI server may be busy. Please try again in a moment.";
      case AiSupportErrorCode.PAGE_TOO_LARGE:
        return `The page content is too large to process. Maximum size is ${
          this.config.maxPageSize / 1024
        }KB.`;
      case AiSupportErrorCode.RATE_LIMITED:
        return "Too many AI requests. Please wait a moment before trying again.";
      case AiSupportErrorCode.INVALID_REQUEST:
        return "Invalid AI support request. Please check your request parameters.";
      case AiSupportErrorCode.API_ERROR:
        return "AI service error. Please try again later or contact support if the problem persists.";
      default:
        return "An unknown error occurred. Please try again.";
    }
  }

  /**
   * Log info message
   */
  private logInfo(message: string): void {
    console.log(`[AI Support Handler] ${message}`);
    if (this.logFile) {
      WriteLog(this.logFile, `[INFO] ${message}`);
    }
  }

  /**
   * Log warning message
   */
  private logWarn(message: string): void {
    console.warn(`[AI Support Handler] ${message}`);
    if (this.logFile) {
      WriteLog(this.logFile, `[WARN] ${message}`);
    }
  }

  /**
   * Log error message
   */
  private logError(message: string): void {
    console.error(`[AI Support Handler] ${message}`);
    if (this.logFile) {
      WriteLog(this.logFile, `[ERROR] ${message}`);
    }
  }

  /**
   * Clear all cached responses
   */
  clearCache(): void {
    this.cache.clear();
    this.logInfo("AI response cache cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: number } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()).length,
    };
  }

  /**
   * Reset rate limiting state
   */
  resetRateLimit(): void {
    this.requestTimestamps = [];
    this.logInfo("AI rate limit reset");
  }
}
