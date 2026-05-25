import { SearchModule } from "@/modules/SearchModule";
import { SearchTaskStatus } from "@/model/SearchTask.model";
import { YellowPagesController } from "@/controller/YellowPagesController";
import { TaskStatus as YellowPagesTaskStatus } from "@/modules/interface/ITaskManager";
import { TaskStatus } from "@/entityTypes/commonType";
import { ToolExecutionService } from "@/service/ToolExecutionService";
import { formatYellowPagesResultsForLLM } from "@/main-process/communication/ai-chat-ipc";
import { MCPToolService } from "@/service/MCPToolService";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { EmailExtractionTypes } from "@/config/emailextraction";
import { WebsiteAnalysisService } from "@/service/WebsiteAnalysisService";
import { RateLimiter, RateLimitConfig } from "./RateLimiter";
import { AiChatApi, BatchKeywordGenerationRequestItem } from "@/api/aiChatApi";
import { extractContactFromUrls } from "@/main-process/communication/contactExtraction-ipc";
import { DocumentService } from "@/service/DocumentService";
import { FileToolService } from "@/service/FileToolService";
import { FILE_TOOL_RATE_LIMITS } from "@/config/fileToolConfig";
import {
  GOOGLE_MAPS_DEFAULT_MAX_RESULTS,
  GOOGLE_MAPS_HARD_CAP,
} from "@/entityTypes/googleMapsTypes";
import {
  YANDEX_MAPS_DEFAULT_MAX_RESULTS,
  YANDEX_MAPS_HARD_CAP,
} from "@/entityTypes/yandexMapsTypes";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import { FileOperationTracker } from "@/service/FileOperationTracker";
import type { FileOperationRecord } from "@/entityTypes/fileOperationTypes";

/**
 * Rate limiting configuration for tool execution
 */
const RATE_LIMIT_CONFIG = {
  websiteAnalysis: {
    maxPerMinute: 10,
    maxConcurrent: 3,
    cooldownMs: 1000,
  },
  emailExtraction: {
    maxPerMinute: 20,
    maxConcurrent: 5,
    cooldownMs: 500,
  },
  contactExtraction: {
    maxPerMinute: 10,
    maxConcurrent: 2,
    cooldownMs: 1000,
  },
  yellowPages: {
    maxPerMinute: 15,
    maxConcurrent: 3,
    cooldownMs: 800,
  },
  fileRead: FILE_TOOL_RATE_LIMITS.fileRead,
  fileSearch: FILE_TOOL_RATE_LIMITS.fileSearch,
  fileWrite: FILE_TOOL_RATE_LIMITS.fileWrite,
  yandexMaps: {
    maxPerMinute: 10,
    maxConcurrent: 2,
    cooldownMs: 2000,
  },
  default: {
    maxPerMinute: 30,
    maxConcurrent: 5,
    cooldownMs: 200,
  },
} as const;

/**
 * Rate limiter instances for different tool types
 */
class RateLimiterManager {
  private static limiters = new Map<string, RateLimiter>();

  static getLimiter(toolName: string): RateLimiter {
    if (!this.limiters.has(toolName)) {
      const config = this.getRateLimitConfig(toolName);
      this.limiters.set(toolName, new RateLimiter(config));
    }
    return this.limiters.get(toolName)!;
  }

  private static getRateLimitConfig(toolName: string): RateLimitConfig {
    if (
      toolName.includes("website") ||
      toolName.includes("analyze") ||
      toolName === "read_url_content"
    ) {
      return RATE_LIMIT_CONFIG.websiteAnalysis;
    } else if (toolName === "extract_contact_info") {
      return RATE_LIMIT_CONFIG.contactExtraction;
    } else if (toolName.includes("email") || toolName.includes("extract")) {
      return RATE_LIMIT_CONFIG.emailExtraction;
    } else if (
      toolName.includes("yellow") ||
      toolName.includes("yellowpages")
    ) {
      return RATE_LIMIT_CONFIG.yellowPages;
    } else if (toolName === "file_read") {
      return RATE_LIMIT_CONFIG.fileRead;
    } else if (toolName === "glob_files" || toolName === "grep_files") {
      return RATE_LIMIT_CONFIG.fileSearch;
    } else if (toolName === "file_write" || toolName === "file_edit") {
      return RATE_LIMIT_CONFIG.fileWrite;
    } else if (
      toolName.includes("yandex_maps") ||
      toolName.includes("yandexmaps")
    ) {
      return RATE_LIMIT_CONFIG.yandexMaps;
    } else {
      return RATE_LIMIT_CONFIG.default;
    }
  }

  static getStatus(toolName: string) {
    return this.getLimiter(toolName).getStatus();
  }
}

/**
 * Execute tools called by the AI
 */
export class ToolExecutor {
  /**
   * Execute a tool by name with rate limiting
   */
  static async execute(
    toolName: string,
    toolParams: Record<string, unknown>,
    conversationId: string
  ): Promise<Record<string, unknown>> {
    const rateLimiter = RateLimiterManager.getLimiter(toolName);

    try {
      // Acquire rate limit slot
      await rateLimiter.acquire();

      // Check rate limit status before execution
      const status = rateLimiter.getStatus();
      console.log(`Executing tool '${toolName}' - Rate limit status:`, status);

      return await this.executeInternal(toolName, toolParams, conversationId);
    } finally {
      // Always release the rate limit slot
      rateLimiter.release();
    }
  }

  /**
   * Internal execution method without rate limiting
   */
  private static async executeInternal(
    toolName: string,
    toolParams: Record<string, unknown>,
    conversationId: string
  ): Promise<Record<string, unknown>> {
    // Check if this is an MCP tool (format: mcp_<serverId>_<toolName>)
    if (toolName.startsWith("mcp_")) {
      return await this.executeMCPTool(toolName, toolParams);
    }

    switch (toolName) {
      case "scrape_urls_from_google":
      case "scrape_urls_from_bing":
      case "scrape_urls_from_yandex":
      case "scrape_urls_from_baidu":
      case "scrape_urls_from_search_engine":
        return await this.executeSearchEngineTool(toolName, toolParams);

      case "search_yellow_pages":
        return await this.executeYellowPagesSearch(toolParams);

      case "get_available_yellow_pages_platforms":
        return await this.executeGetYellowPagesPlatforms(toolParams);

      case "extract_emails_from_urls":
        return await this.executeEmailExtraction(toolParams);

      case "analyze_website":
        return await this.executeWebsiteSingleAnalysis(toolParams);

      case "analyze_website_batch":
        return await this.executeWebsiteBatchAnalysis(toolParams);

      case "analyze_websites":
        return await this.executeWebsiteDirectAnalysis(toolParams);

      case "read_url_content":
        return await this.executeReadUrlContent(toolParams);

      case "generate_keywords":
        return await this.executeGenerateKeywords(toolParams);

      case "extract_contact_info":
        return await this.executeContactExtraction(toolParams);

      case "search_google_maps_businesses":
        return await this.executeGoogleMapsSearch(toolParams);

      case "search_yandex_maps_businesses":
        return await this.executeYandexMapsSearch(toolParams);

      case "read_attachment_content":
        return await this.executeReadAttachmentContent(
          toolParams,
          conversationId
        );

      case "file_read":
      case "file_write":
      case "file_edit":
      case "glob_files":
      case "grep_files":
        return await this.executeFileTool(toolName, toolParams, conversationId);

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  }

  /**
   * Execute MCP tool
   * Tool name format: mcp_<serverId>_<toolName>
   */
  private static async executeMCPTool(
    toolName: string,
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    try {
      // Parse tool name: mcp_<serverId>_<toolName>
      const parts = toolName.split("_");
      if (parts.length < 3 || parts[0] !== "mcp") {
        return {
          success: false,
          error: `Invalid MCP tool name format: ${toolName}`,
        };
      }

      const serverId = parseInt(parts[1], 10);
      const actualToolName = parts.slice(2).join("_"); // Handle tool names with underscores

      if (isNaN(serverId)) {
        return {
          success: false,
          error: `Invalid server ID in tool name: ${toolName}`,
        };
      }

      const mcpService = new MCPToolService();
      const result = await mcpService.executeMCPTool(
        serverId,
        actualToolName,
        toolParams
      );

      return {
        success: true,
        result,
      };
    } catch (error) {
      console.error("MCP tool execution error:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error executing MCP tool",
      };
    }
  }

  /**
   * Resolve display engine name for SearchModule (Google, Bing, Yandex, Baidu).
   */
  private static resolveSearchScrapeEngineName(
    toolName: string,
    toolParams: Record<string, unknown>
  ): string {
    const legacyByTool: Record<string, string> = {
      scrape_urls_from_google: "Google",
      scrape_urls_from_bing: "Bing",
      scrape_urls_from_yandex: "Yandex",
      scrape_urls_from_baidu: "Baidu",
    };
    const fromLegacy = legacyByTool[toolName];
    if (fromLegacy !== undefined) {
      return fromLegacy;
    }
    if (toolName === "scrape_urls_from_search_engine") {
      const raw = toolParams.search_engine;
      if (typeof raw !== "string" || !raw.trim()) {
        throw new Error(
          "search_engine is required (google | bing | yandex | baidu)"
        );
      }
      const key = raw.trim().toLowerCase();
      const byParam: Record<string, string> = {
        google: "Google",
        bing: "Bing",
        yandex: "Yandex",
        baidu: "Baidu",
      };
      const resolved = byParam[key];
      if (!resolved) {
        throw new Error(
          `Invalid search_engine "${raw}". Use one of: google, bing, yandex, baidu`
        );
      }
      return resolved;
    }
    throw new Error(`Unexpected search scrape tool: ${toolName}`);
  }

  /**
   * Execute search engine tool (Google, Bing, Yandex, Baidu)
   */
  private static async executeSearchEngineTool(
    toolName: string,
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const searchModule = new SearchModule();
    const query = typeof toolParams.query === "string" ? toolParams.query : "";
    const numResults =
      typeof toolParams.num_results === "number" ? toolParams.num_results : 10;
    const showBrowser =
      typeof toolParams.show_browser === "boolean"
        ? toolParams.show_browser
        : false;

    if (!query) {
      throw new Error("parameter of Query is required");
    }

    const engineName = this.resolveSearchScrapeEngineName(toolName, toolParams);

    // Calculate num_pages based on num_results (assuming ~10 results per page)
    const numPages = Math.ceil(numResults / 10);

    // Execute search (notShowBrowser: true when show_browser is false, i.e. headless by default)
    const taskId = await searchModule.searchByKeywordAndEngine(
      [query],
      engineName,
      {
        num_pages: numPages,
        concurrency: 1,
        notShowBrowser: !showBrowser,
      }
    );

    // Poll task status until complete or error (max 10 minutes)
    let taskStatus: SearchTaskStatus | null = null;
    const maxWaitTime = 600000; // 10 minutes
    const pollInterval = 1000; // 1 second
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      taskStatus = await searchModule.getTaskStatus(taskId);
      if (taskStatus === null) {
        throw new Error(`Task ${taskId} not found`);
      }
      if (
        taskStatus === SearchTaskStatus.Complete ||
        taskStatus === SearchTaskStatus.Error
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Check if task completed successfully
    if (taskStatus !== SearchTaskStatus.Complete) {
      throw new Error(
        `Search task ${taskId} did not complete successfully. Status: ${taskStatus}`
      );
    }

    // Get search results
    const results = await searchModule.listSearchResult(taskId, 1, numResults);

    // Extract clean results using service
    const cleanResults = ToolExecutionService.extractCleanResults(results);

    // Format results for LLM consumption (readable list format)
    const formattedResults =
      ToolExecutionService.formatSearchResultsForLLM(cleanResults);

    // Create comprehensive tool result
    return {
      success: true,
      taskId: taskId,
      query: query,
      engine: engineName,
      totalResults: results.length,
      // Formatted summary for LLM
      summary: formattedResults,
      // Clean structured data (no HTML blobs or messy metadata)
      results: cleanResults,
    };
  }

  /**
   * Execute Yellow Pages search
   */
  private static async executeYellowPagesSearch(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const yellowPagesController = YellowPagesController.getInstance();
    const platform =
      typeof toolParams.platform === "string" ? toolParams.platform : "";
    const searchTerm =
      typeof toolParams.search_term === "string" ? toolParams.search_term : "";
    const location =
      typeof toolParams.location === "string" ? toolParams.location : "";
    const numResults =
      typeof toolParams.num_results === "number" ? toolParams.num_results : 20;

    if (!platform || !searchTerm || !location) {
      throw new Error(
        "Platform, search_term, and location are required parameters"
      );
    }

    // Calculate max_pages based on num_results (assuming ~20 results per page)
    const maxPages = Math.max(1, Math.ceil(numResults / 20));

    // Create task
    const taskId = await yellowPagesController.createTask({
      name: `AI Chat Search: ${searchTerm} in ${location}`,
      platform: platform,
      keywords: [searchTerm],
      location: location,
      max_pages: maxPages,
      concurrency: 1,
      headless: true,
      delay_between_requests: 2000,
    });

    // Start the task
    await yellowPagesController.startTask(taskId);

    // Poll task status until complete or error (max 10 minutes)
    let taskStatus: YellowPagesTaskStatus | null = null;
    const maxWaitTime = 600000; // 10 minutes
    const pollInterval = 2000; // 2 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const taskInfo = await yellowPagesController.getTask(taskId);
      taskStatus = taskInfo.status;

      if (
        taskStatus === YellowPagesTaskStatus.Completed ||
        taskStatus === YellowPagesTaskStatus.Failed
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Check if task completed successfully
    if (taskStatus !== YellowPagesTaskStatus.Completed) {
      const taskInfo = await yellowPagesController.getTask(taskId);
      const errorMsg =
        taskInfo.task.error_log ||
        `Task ${taskId} did not complete successfully. Status: ${taskStatus}`;
      throw new Error(errorMsg);
    }

    // Get search results
    const taskResults = await yellowPagesController.getTaskResults(taskId, {
      page: 0,
      size: numResults,
    });

    // Format results for LLM consumption
    const formattedResults = formatYellowPagesResultsForLLM(taskResults.data);
    const cleanResults = taskResults.data
      .slice(0, numResults)
      .map((result) => ({
        business_name: result.business_name,
        phone: result.phone,
        email: result.email,
        website: result.website,
        address: result.address,
        rating: result.rating,
        review_count: result.review_count,
        categories: result.categories,
        platform: result.platform,
      }));

    // Create comprehensive tool result
    return {
      success: true,
      taskId: taskId,
      platform: platform,
      search_term: searchTerm,
      location: location,
      totalResults: taskResults.data.length,
      resultsReturned: Math.min(numResults, taskResults.data.length),
      // Formatted summary for LLM
      summary: formattedResults,
      // Clean structured data
      results: cleanResults,
    };
  }

  /**
   * Get available Yellow Pages platforms
   */
  private static async executeGetYellowPagesPlatforms(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const yellowPagesController = YellowPagesController.getInstance();
    let platforms = await yellowPagesController.getAvailablePlatforms();

    // Filter by country code if provided
    const countryCode =
      typeof toolParams.country_code === "string"
        ? toolParams.country_code.toUpperCase().trim()
        : undefined;

    if (countryCode) {
      platforms = platforms.filter(
        (platform) => platform.country?.toUpperCase() === countryCode
      );
    }

    // Format platforms for LLM consumption
    const formattedPlatforms = platforms.map((platform) => ({
      name: platform.name,
      display_name: platform.display_name,
      country: platform.country,
      language: platform.language,
      is_active: platform.is_active,
      location_required: platform.locationRequired || false,
      authentication_required:
        platform.authentication?.requiresAuthentication || false,
      requires_cookies: platform.authentication?.requiresCookies || false,
      rate_limit: platform.rate_limit,
    }));

    // Create formatted summary for LLM
    const countryFilterNote = countryCode
      ? ` (filtered by country code: ${countryCode})`
      : "";
    const formattedSummary =
      platforms.length > 0
        ? `Available Yellow Pages Platforms${countryFilterNote} (${
            platforms.length
          }):\n\n${platforms
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.display_name}** (${p.name})\n   Country: ${
                  p.country
                }, Language: ${p.language}\n   ${
                  p.is_active ? "✅ Active" : "❌ Inactive"
                }${
                  p.locationRequired ? " | Location Required" : ""
                }\n   Rate Limit: ${p.rate_limit} requests/hour${
                  p.authentication?.requiresCookies
                    ? " | Requires Cookies/Authentication"
                    : ""
                }`
            )
            .join("\n\n")}`
        : countryCode
        ? `No Yellow Pages platforms found for country code: ${countryCode}`
        : "No Yellow Pages platforms are currently available.";

    return {
      success: true,
      totalPlatforms: platforms.length,
      countryCode: countryCode || null,
      summary: formattedSummary,
      platforms: formattedPlatforms,
    };
  }

  /**
   * Execute email extraction from URLs
   */
  private static async executeEmailExtraction(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const emailSearchTaskModule = new EmailSearchTaskModule();

    // Extract URLs from parameters
    let urls: string[] = [];

    if (toolParams.urls && Array.isArray(toolParams.urls)) {
      urls = toolParams.urls.filter(
        (url): url is string => typeof url === "string" && url.trim().length > 0
      );
    } else if (toolParams.content && typeof toolParams.content === "string") {
      // For content-based extraction, we would need a different approach
      // For now, we'll return an error suggesting to use URLs
      return {
        success: false,
        error:
          "Content-based email extraction is not yet supported. Please provide URLs instead.",
      };
    }

    if (urls.length === 0) {
      throw new Error(
        "URLs parameter is required and must be a non-empty array of strings"
      );
    }

    // Extract optional configuration parameters.
    // No time limit by default for extract_emails_from_urls - extraction can take a long time.
    const concurrency =
      typeof toolParams.concurrency === "number" ? toolParams.concurrency : 1;
    const processTimeout =
      typeof toolParams.process_timeout === "number"
        ? toolParams.process_timeout
        : 120; // 120 minutes default (no effective limit for tool use)
    const maxPageNumber =
      typeof toolParams.max_page_number === "number"
        ? toolParams.max_page_number
        : 10;
    const notShowBrowser =
      typeof toolParams.not_show_browser === "boolean"
        ? toolParams.not_show_browser
        : true;

    // Create and execute the email extraction task
    const taskId = await emailSearchTaskModule.createAndExecuteTask(urls, {
      type: EmailExtractionTypes.ManualInputUrl,
      concurrency: concurrency,
      processTimeout: processTimeout,
      maxPageNumber: maxPageNumber,
      notShowBrowser: notShowBrowser,
    });

    // Poll task status until complete or error. No time limit - extraction can take a long time.
    let taskStatus: TaskStatus | null = null;
    const pollInterval = 2000; // 2 seconds
    let isPolling = true;

    while (isPolling) {
      const taskDetail = await emailSearchTaskModule.getTaskDetail(taskId);
      if (!taskDetail) {
        throw new Error(`Email extraction task ${taskId} not found`);
      }
      taskStatus = taskDetail.status;

      if (
        taskStatus === TaskStatus.Complete ||
        taskStatus === TaskStatus.Error
      ) {
        isPolling = false;
      } else {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    // Check if task completed successfully
    if (taskStatus !== TaskStatus.Complete) {
      const taskDetail = await emailSearchTaskModule.getTaskDetail(taskId);
      const errorMsg =
        taskDetail?.status === TaskStatus.Error
          ? `Email extraction task ${taskId} failed`
          : `Email extraction task ${taskId} did not complete successfully. Status: ${taskStatus}`;
      throw new Error(errorMsg);
    }

    // Get extraction results
    const resultCount = await emailSearchTaskModule.getTaskResultCount(taskId);
    const results = await emailSearchTaskModule.getTaskResult(
      taskId,
      0,
      resultCount
    );

    // Format results for LLM consumption
    const extractedEmails: string[] = [];
    const urlEmailMap: Record<string, string[]> = {};

    for (const result of results) {
      if (result.emails && result.emails.length > 0) {
        extractedEmails.push(...result.emails);
        urlEmailMap[result.url] = result.emails;
      }
    }

    // Remove duplicates
    const uniqueEmails = Array.from(new Set(extractedEmails));

    // Create formatted summary for LLM
    const formattedSummary =
      uniqueEmails.length > 0
        ? `Email Extraction Results:\n\n` +
          `Total unique emails found: ${uniqueEmails.length}\n` +
          `Total URLs processed: ${results.length}\n\n` +
          `Emails by URL:\n${results
            .map(
              (r, idx) =>
                `${idx + 1}. ${r.url}${
                  r.pageTitle ? ` (${r.pageTitle})` : ""
                }\n   Emails: ${
                  r.emails.length > 0 ? r.emails.join(", ") : "None found"
                }`
            )
            .join("\n\n")}\n\n` +
          `All unique emails:\n${uniqueEmails
            .map((email, idx) => `${idx + 1}. ${email}`)
            .join("\n")}`
        : `Email Extraction Results:\n\nNo emails found in ${results.length} processed URL(s).`;

    // Create comprehensive tool result
    return {
      success: true,
      taskId: taskId,
      urlsProcessed: results.length,
      totalUrls: urls.length,
      totalEmailsFound: extractedEmails.length,
      uniqueEmailsFound: uniqueEmails.length,
      // Formatted summary for LLM
      summary: formattedSummary,
      // Clean structured data
      emails: uniqueEmails,
      results: results.map((r) => ({
        url: r.url,
        pageTitle: r.pageTitle,
        emails: r.emails,
        recordTime: r.recordTime,
      })),
      urlEmailMap: urlEmailMap,
    };
  }

  /**
   * Execute single-website analysis for business relevance (no database save).
   */
  private static async executeWebsiteSingleAnalysis(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = typeof toolParams.url === "string" ? toolParams.url.trim() : "";
    const clientBusiness =
      typeof toolParams.client_business === "string"
        ? toolParams.client_business.trim()
        : "";
    const temperature =
      typeof toolParams.temperature === "number"
        ? Math.max(0, Math.min(1, toolParams.temperature))
        : 0.7;

    if (!url) {
      throw new Error(
        "url parameter is required and must be a non-empty string"
      );
    }
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        error: `Invalid URL: ${url}`,
      };
    }
    if (!clientBusiness) {
      throw new Error(
        "client_business parameter is required and must be a non-empty string"
      );
    }

    const results = await WebsiteAnalysisService.analyzeWebsitesDirectly(
      [url],
      clientBusiness,
      temperature
    );
    const r = results[0];
    if (!r) {
      return {
        success: false,
        error: "No analysis result returned",
      };
    }

    const summary = r.success
      ? `Website Analysis (Business Relevance):\n\nURL: ${r.url}\nIndustry: ${
          r.industry ?? "N/A"
        }\nMatch Score: ${r.match_score?.toFixed(2) ?? "N/A"}\nReasoning: ${
          r.reasoning ?? "N/A"
        }`
      : `Website Analysis Failed:\n\nURL: ${r.url}\nError: ${
          r.error ?? "Unknown error"
        }`;

    return {
      success: r.success,
      url: r.url,
      industry: r.industry,
      match_score: r.match_score,
      reasoning: r.reasoning,
      error: r.error,
      summary,
    };
  }

  /**
   * Execute website batch analysis
   */
  private static async executeWebsiteBatchAnalysis(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Extract and validate parameters
    const resultIds = Array.isArray(toolParams.result_ids)
      ? toolParams.result_ids.filter(
          (id): id is number => typeof id === "number" && id > 0
        )
      : [];

    const clientBusiness =
      typeof toolParams.client_business === "string"
        ? toolParams.client_business.trim()
        : "";

    const temperature =
      typeof toolParams.temperature === "number"
        ? Math.max(0, Math.min(1, toolParams.temperature))
        : 0.7;

    if (resultIds.length === 0) {
      throw new Error(
        "result_ids parameter is required and must be a non-empty array of numbers"
      );
    }

    if (!clientBusiness) {
      throw new Error(
        "client_business parameter is required and must be a non-empty string"
      );
    }

    // Start batch analysis
    const batchInfo = await WebsiteAnalysisService.startBatchAnalysis({
      resultIds,
      clientBusiness,
      temperature,
    });

    // Wait for completion (max 10 minutes)
    const results = await WebsiteAnalysisService.waitForBatchCompletion(
      batchInfo.batchId,
      resultIds, // Pass result IDs for status checking
      600000, // 10 minutes
      2000 // 2 seconds polling interval
    );

    // Format results for LLM consumption
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const formattedSummary =
      results.length > 0
        ? `Website Batch Analysis Results:\n\n` +
          `Total analyzed: ${results.length}\n` +
          `Successful: ${successful.length}\n` +
          `Failed: ${failed.length}\n\n` +
          (successful.length > 0
            ? `Successful Analyses:\n${successful
                .map(
                  (r, idx) =>
                    `${idx + 1}. Result ID ${r.resultId}\n   Industry: ${
                      r.industry || "N/A"
                    }\n   Match Score: ${
                      r.match_score?.toFixed(2) || "N/A"
                    }\n   Reasoning: ${r.reasoning || "N/A"}`
                )
                .join("\n\n")}\n\n`
            : "") +
          (failed.length > 0
            ? `Failed Analyses:\n${failed
                .map(
                  (r, idx) =>
                    `${idx + 1}. Result ID ${r.resultId}: ${
                      r.error || "Unknown error"
                    }`
                )
                .join("\n\n")}`
            : "")
        : "No results to analyze.";

    // Create comprehensive tool result
    return {
      success: true,
      batchId: batchInfo.batchId,
      totalAnalyzed: results.length,
      successful: successful.length,
      failed: failed.length,
      // Formatted summary for LLM
      summary: formattedSummary,
      // Clean structured data
      results: results.map((r) => ({
        resultId: r.resultId,
        success: r.success,
        industry: r.industry,
        match_score: r.match_score,
        reasoning: r.reasoning,
        error: r.error,
      })),
    };
  }

  /**
   * Execute website direct analysis (no database save)
   */
  private static async executeWebsiteDirectAnalysis(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Extract and validate parameters
    const urls = Array.isArray(toolParams.urls)
      ? toolParams.urls.filter(
          (url): url is string =>
            typeof url === "string" && url.trim().length > 0
        )
      : [];

    const clientBusiness =
      typeof toolParams.client_business === "string"
        ? toolParams.client_business.trim()
        : "";

    const temperature =
      typeof toolParams.temperature === "number"
        ? Math.max(0, Math.min(1, toolParams.temperature))
        : 0.7;

    if (urls.length === 0) {
      throw new Error(
        "urls parameter is required and must be a non-empty array of strings"
      );
    }

    if (!clientBusiness) {
      throw new Error(
        "client_business parameter is required and must be a non-empty string"
      );
    }

    // Analyze websites directly (no database save)
    const results = await WebsiteAnalysisService.analyzeWebsitesDirectly(
      urls,
      clientBusiness,
      temperature
    );

    // Format results for LLM consumption
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const formattedSummary =
      results.length > 0
        ? `Website Analysis Results (Not Saved to Database):\n\n` +
          `Total analyzed: ${results.length}\n` +
          `Successful: ${successful.length}\n` +
          `Failed: ${failed.length}\n\n` +
          (successful.length > 0
            ? `Successful Analyses:\n${successful
                .map(
                  (r, idx) =>
                    `${idx + 1}. ${r.url}\n   Industry: ${
                      r.industry || "N/A"
                    }\n   Match Score: ${
                      r.match_score?.toFixed(2) || "N/A"
                    }\n   Reasoning: ${r.reasoning || "N/A"}`
                )
                .join("\n\n")}\n\n`
            : "") +
          (failed.length > 0
            ? `Failed Analyses:\n${failed
                .map(
                  (r, idx) =>
                    `${idx + 1}. ${r.url}: ${r.error || "Unknown error"}`
                )
                .join("\n\n")}`
            : "")
        : "No URLs to analyze.";

    // Create comprehensive tool result
    return {
      success: true,
      totalAnalyzed: results.length,
      successful: successful.length,
      failed: failed.length,
      // Formatted summary for LLM
      summary: formattedSummary,
      // Clean structured data
      results: results.map((r) => ({
        url: r.url,
        success: r.success,
        industry: r.industry,
        match_score: r.match_score,
        reasoning: r.reasoning,
        error: r.error,
      })),
    };
  }

  /**
   * Execute read_url_content: fetch page by URL and return markdown.
   */
  private static async executeReadUrlContent(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const url = typeof toolParams.url === "string" ? toolParams.url.trim() : "";
    if (!url) {
      throw new Error(
        "url parameter is required and must be a non-empty string"
      );
    }
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        error: `Invalid URL: ${url}`,
      };
    }

    let maxLength: number | undefined;
    if (typeof toolParams.max_length === "number") {
      const clamped = Math.max(1000, Math.min(200_000, toolParams.max_length));
      maxLength = clamped;
    }

    try {
      const { content, truncated } =
        await WebsiteAnalysisService.getPageContentAsMarkdown(
          url,
          maxLength !== undefined ? { maxLength } : undefined
        );

      return {
        success: true,
        content,
        url,
        ...(truncated && { truncated: true }),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute generate_keywords: generate related keywords from seed keywords via AI API.
   */
  private static async executeGenerateKeywords(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const rawSeeds = toolParams.seed_keywords;
    const seedKeywords: string[] = Array.isArray(rawSeeds)
      ? rawSeeds
          .filter(
            (s): s is string => typeof s === "string" && s.trim().length > 0
          )
          .map((s) => s.trim())
      : [];

    if (seedKeywords.length === 0) {
      return {
        success: false,
        error:
          "seed_keywords is required and must be a non-empty array of strings",
      };
    }

    const numKeywords =
      typeof toolParams.num_keywords === "number"
        ? Math.max(1, Math.min(100, Math.round(toolParams.num_keywords)))
        : 15;
    const keywordType =
      typeof toolParams.keyword_type === "string"
        ? toolParams.keyword_type.trim() || "seo"
        : "seo";

    const batchRequests: BatchKeywordGenerationRequestItem[] = seedKeywords.map(
      (seed) => ({
        seed_keywords: [seed],
        config: {
          num_keywords: numKeywords,
          keyword_type: keywordType,
        },
      })
    );

    try {
      const api = new AiChatApi();
      const apiResponse = await api.batchGenerateKeywords(batchRequests);

      if (!apiResponse.status || !apiResponse.data) {
        return {
          success: false,
          error: apiResponse.msg ?? "Failed to generate keywords",
        };
      }

      const keywordItems = apiResponse.data.keywords ?? [];
      const keywords: string[] = Array.from(
        new Set(keywordItems.map((item) => item.keyword))
      );

      return {
        success: true,
        seed_keywords: seedKeywords,
        keywords,
        total_keywords: keywords.length,
        summary: `Generated ${keywords.length} keywords from ${
          seedKeywords.length
        } seed(s): ${seedKeywords.join(", ")}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute extract_contact_info: extract contact info (emails, phones, address, social links) from URLs.
   */
  private static async executeContactExtraction(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const urls = Array.isArray(toolParams.urls)
      ? toolParams.urls.filter(
          (url): url is string =>
            typeof url === "string" && url.trim().length > 0
        )
      : [];

    if (urls.length === 0) {
      throw new Error(
        "urls parameter is required and must be a non-empty array of strings"
      );
    }

    const results = await extractContactFromUrls(urls);
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    const formattedSummary =
      results.length > 0
        ? `Contact Extraction Results:\n\n` +
          `Total URLs: ${results.length}\n` +
          `Successful: ${successful.length}\n` +
          `Failed: ${failed.length}\n\n` +
          (successful.length > 0
            ? `Extracted:\n${successful
                .map(
                  (r, idx) =>
                    `${idx + 1}. ${r.url}\n` +
                    (r.data?.emails?.length
                      ? `   Emails: ${r.data.emails.join(", ")}\n`
                      : "") +
                    (r.data?.phones?.length
                      ? `   Phones: ${r.data.phones.join(", ")}\n`
                      : "") +
                    (r.data?.address ? `   Address: ${r.data.address}\n` : "") +
                    (r.data?.socialLinks?.length
                      ? `   Social: ${r.data.socialLinks.join(", ")}`
                      : "")
                )
                .join("\n")}\n\n`
            : "") +
          (failed.length > 0
            ? `Failed:\n${failed
                .map(
                  (r, idx) =>
                    `${idx + 1}. ${r.url}: ${r.error || "Unknown error"}`
                )
                .join("\n")}`
            : "")
        : "No URLs to process.";

    return {
      success: true,
      totalUrls: results.length,
      successful: successful.length,
      failed: failed.length,
      summary: formattedSummary,
      results: results.map((r) => ({
        url: r.url,
        success: r.success,
        emails: r.data?.emails,
        phones: r.data?.phones,
        address: r.data?.address,
        socialLinks: r.data?.socialLinks,
        error: r.error,
      })),
    };
  }

  /**
   * Execute Google Maps business search using GoogleMapsModule.
   */
  private static async executeGoogleMapsSearch(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const query = typeof toolParams.query === "string" ? toolParams.query : "";
    const location =
      typeof toolParams.location === "string" ? toolParams.location : "";
    const maxResults =
      typeof toolParams.max_results === "number"
        ? toolParams.max_results
        : GOOGLE_MAPS_DEFAULT_MAX_RESULTS;

    if (!query.trim()) {
      return {
        success: false,
        error: "query is required and must not be blank",
      };
    }

    if (!location.trim()) {
      return {
        success: false,
        error: "location is required and must not be blank",
      };
    }

    const clampedMaxResults = Math.min(
      Math.max(1, maxResults),
      GOOGLE_MAPS_HARD_CAP
    );

    try {
      const module = new GoogleMapsModule();
      const result = await module.executeSearch({
        query: query.trim(),
        location: location.trim(),
        max_results: clampedMaxResults,
        include_website:
          typeof toolParams.include_website === "boolean"
            ? toolParams.include_website
            : true,
        include_reviews:
          typeof toolParams.include_reviews === "boolean"
            ? toolParams.include_reviews
            : false,
        show_browser:
          typeof toolParams.show_browser === "boolean"
            ? toolParams.show_browser
            : false,
      });

      return result as unknown as Record<string, unknown>;
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error executing Google Maps search",
      };
    }
  }

  /**
   * Execute Yandex Maps business search.
   * Phase 9: Input validation and hard cap enforcement only.
   * Phase 10 will wire to YandexMapsModule for actual scraping.
   */
  private static async executeYandexMapsSearch(
    toolParams: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const query = typeof toolParams.query === "string" ? toolParams.query : "";
    const location =
      typeof toolParams.location === "string" ? toolParams.location : "";
    const maxResults =
      typeof toolParams.max_results === "number"
        ? toolParams.max_results
        : YANDEX_MAPS_DEFAULT_MAX_RESULTS;

    if (!query.trim()) {
      return {
        success: false,
        error: "query is required and must not be blank",
      };
    }

    if (!location.trim()) {
      return {
        success: false,
        error: "location is required and must not be blank",
      };
    }

    const clampedMaxResults = Math.min(
      Math.max(1, maxResults),
      YANDEX_MAPS_HARD_CAP
    );

    // Phase 10 will replace this with real YandexMapsModule call
    void clampedMaxResults; // used in Phase 10
    return {
      success: false,
      error: "Yandex Maps scraping not yet implemented (Phase 10)",
    };
  }

  /**
   * Execute read_attachment_content: read staged markdown content by attachment_ref.
   */
  private static async executeReadAttachmentContent(
    toolParams: Record<string, unknown>,
    conversationId: string
  ): Promise<Record<string, unknown>> {
    const attachmentRef =
      typeof toolParams.attachment_ref === "string"
        ? toolParams.attachment_ref.trim()
        : "";

    if (!attachmentRef) {
      return {
        success: false,
        error:
          "attachment_ref parameter is required and must be a non-empty string",
      };
    }

    const maxLength =
      typeof toolParams.max_length === "number"
        ? Math.max(1000, Math.min(300000, Math.round(toolParams.max_length)))
        : 120000;

    try {
      const documentService = new DocumentService();
      const staged = await documentService.readStagedAttachment(
        conversationId,
        attachmentRef
      );
      const isTruncated = staged.markdown.length > maxLength;
      const content = isTruncated
        ? staged.markdown.slice(0, maxLength)
        : staged.markdown;

      return {
        success: true,
        fileName: staged.fileName,
        content,
        truncated: isTruncated,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to read attachment content",
      };
    }
  }

  /**
   * Execute a file tool by delegating to FileToolService.
   * M2 fix — reuse a cached instance instead of creating per call.
   */
  private static fileToolService: FileToolService | null = null;

  private static getFileToolService(): FileToolService {
    if (!ToolExecutor.fileToolService) {
      ToolExecutor.fileToolService = new FileToolService();
    }
    return ToolExecutor.fileToolService;
  }

  private static async executeFileTool(
    toolName: string,
    toolParams: Record<string, unknown>,
    conversationId: string
  ): Promise<Record<string, unknown>> {
    try {
      const result = await ToolExecutor.getFileToolService().execute(
        toolName,
        toolParams
      );

      // EXEC-05: Only emit records for mutation tools
      if (toolName === "file_write" || toolName === "file_edit") {
        const filePath =
          (result.path as string) ?? (toolParams.path as string) ?? "";
        const record: Omit<FileOperationRecord, "id" | "timestamp"> = {
          type:
            toolName === "file_write"
              ? result.mode === "created"
                ? "create"
                : "overwrite"
              : "edit",
          filePath,
          success: true,
          conversationId,
          skillName: toolName,
          ...(toolName === "file_edit" && {
            linesChanged: result.replacements as number,
            diff: (
              result as unknown as import("@/entityTypes/fileToolTypes").FileEditResult
            ).diff,
          }),
          ...(toolName === "file_write" && {
            sizeBytes: result.bytesWritten as number,
          }),
        };
        FileOperationTracker.emit(record);
      }

      return result;
    } catch (error: unknown) {
      // EXEC-04: Emit failure record for mutation tools
      if (toolName === "file_write" || toolName === "file_edit") {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const filePath = (toolParams.path as string) ?? "";
        FileOperationTracker.emit({
          // Note: On failure we can't know if file_write intended "create" vs "overwrite".
          // Defaulting to "overwrite" is reasonable since the file likely exists already.
          type: toolName === "file_write" ? "overwrite" : "edit",
          filePath,
          success: false,
          conversationId,
          skillName: toolName,
          error: errorMessage,
        });
      }
      // EXEC-06: Re-throw -- tracking must not swallow errors
      throw error;
    }
  }
}
