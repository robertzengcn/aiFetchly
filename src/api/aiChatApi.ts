"use strict";
import { HttpClient } from "@/modules/lib/httpclient";
import {
  CommonApiresp,
  ChatApiResponse,
  LLMImageAttachmentPayload,
} from "@/entityTypes/commonType";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import type { AIEmailTemplateRequest } from "@/entityTypes/emailmarketingType";
import type { AIRecoveryRequest } from "@/entityTypes/processMessage-type";

/**
 * Chat request interface
 */
export interface ChatRequest {
  message: string;
  conversationId?: string;
  model?: string;
  systemPrompt?: string;
  useRAG?: boolean;
  ragLimit?: number;
  functions?: ToolFunction[];
  // Image-only multimodal attachments. Document attachments are staged locally
  // and referenced in message text for tool-based retrieval.
  attachments?: LLMImageAttachmentPayload[];
}

/**
 * Internal request data format for API calls.
 * RAG is applied on the client; server receives the (possibly enhanced) message only.
 */
interface ChatApiRequestData {
  message: string;
  conversation_id?: string;
  model?: string;
  system_prompt?: string;
  client_tools?: ToolFunction[];
  // Image-only payload for server multimodal support.
  attachments?: LLMImageAttachmentPayload[];
}

/**
 * Tool/function definition for AI server
 */
export interface ToolFunction {
  type: string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export type SlashCommandName = "/skills";

export interface SlashCommandDefinition {
  name: SlashCommandName;
  description: string;
  usage: string;
  examples: readonly string[];
}

export const AI_CHAT_SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    name: "/skills",
    description: "List currently available AI skills/tools in this system.",
    usage: "/skills",
    examples: ["/skills"],
  },
] as const;

export function formatSkillsAsChatMarkdown(skills: ToolFunction[]): string {
  if (skills.length === 0) {
    return "No skills are currently available.";
  }

  const header = `Available skills (${skills.length}):`;
  const lines = skills.map((skill, index) => {
    const desc = skill.description?.trim()
      ? skill.description.trim()
      : "No description";
    return `${index + 1}. \`${skill.name}\` - ${desc}`;
  });
  return `${header}\n\n${lines.join("\n")}`;
}

/**
 * Tool execution result payload item
 */
export interface ToolExecutionResult {
  tool_call_id: string;
  tool_name: string;
  success: boolean;
  result: Record<string, unknown>;
  execution_time_ms: number;
}

/**
 * Response data from POST /api/ai/puppeteer/recovery (AI recovery API).
 */
export interface PuppeteerRecoveryResponseData {
  request_id: string;
  success: boolean;
  actions: Array<{
    type: string;
    selector?: string;
    selector_type?: string;
    value?: string;
    key?: string;
    timeout?: number;
    reason: string;
  }>;
  confidence: number;
  reasoning: string;
  error?: string;
}

/**
 * Continue request data format for sending tool results
 */
interface ContinueRequestData {
  conversation_id: string;
  tool_results: ToolExecutionResult[];
  client_tools?: ToolFunction[];
  thread_id?: string;
}

/**
 * Chat stream response interface
 */
export interface ChatStreamResponse {
  chunk: string;
  isComplete: boolean;
  messageId?: string;
  conversationId?: string;
}

/**
 * Convert Python-style dict string to valid JSON string
 * Handles: single quotes -> double quotes, None -> null, True -> true, False -> false
 */
function pythonDictToJson(pythonStr: string): string {
  return (
    pythonStr
      // Replace None with null
      .replace(/:\s*None\b/g, ": null")
      .replace(/\bNone\s*,/g, "null,")
      // Replace True with true
      .replace(/:\s*True\b/g, ": true")
      .replace(/\bTrue\s*,/g, "true,")
      // Replace False with false
      .replace(/:\s*False\b/g, ": false")
      .replace(/\bFalse\s*,/g, "false,")
      // Replace single quotes with double quotes (simple approach)
      // This handles the common case but may not work for all edge cases with nested quotes
      .replace(/'/g, '"')
  );
}

/**
 * Stream event types from AI server
 */
export enum StreamEventType {
  TOKEN = "token", // Individual response tokens
  TOOL_CALL = "tool_call", // Tool execution requests
  TOOL_RESULT = "tool_result", // Tool execution results
  ERROR = "error", // Error conditions
  DONE = "done", // Response completion
  /** Alias for stream end when the wire format uses `complete` instead of `done` */
  COMPLETE = "complete",
  CONVERSATION_START = "conversation_start", // Session initialization
  CONVERSATION_END = "conversation_end", // Conversation termination
  PONG = "pong", // Keep alive
  // Plan execute agent events
  PLAN_CREATED = "plan_created", // Plan has been created
  PLAN_STEP_START = "plan_step_start", // A plan step has started
  PLAN_STEP_COMPLETE = "plan_step_complete", // A plan step has completed
  PLAN_EXECUTE_PAUSE = "plan_execute_pause", // Plan execution paused
  PLAN_EXECUTE_RESUME = "plan_execute_resume", // Plan execution resumed
}

/**
 * Tool call data structure (nested within data.data for tool_call events)
 */
export interface ToolCallData {
  name: string;
  id: string;
  arguments: Record<string, unknown>;
}

/**
 * Stream event format from /api/ai/ask/stream
 */
export interface StreamEvent {
  event: StreamEventType | string;
  data: {
    content: Record<string, unknown> | string;
    timestamp: string;
    // Nested data structure for tool_call events
    data?: ToolCallData;
    // Legacy fields for backwards compatibility
    // toolName?: string;
    // toolParams?: Record<string, unknown>;
    // errorMessage?: string;
    // conversationId?: string;
  };
}

/**
 * Available chat models response
 */
export interface AvailableChatModelsResponse {
  models: {
    [key: string]: {
      name: string;
      description: string;
      maxTokens: number;
      supportsStreaming: boolean;
    };
  };
  default_model: string;
  total_models: number;
}

/**
 * Keyword generation configuration
 */
export interface KeywordGenerationConfig {
  num_keywords: number;
  keyword_type: string;
}

/**
 * Single batch keyword generation request item
 */
export interface BatchKeywordGenerationRequestItem {
  seed_keywords: string[];
  config: KeywordGenerationConfig;
}

/**
 * Single keyword item with category
 */
export interface KeywordItem {
  category: string;
  keyword: string;
}

/**
 * Batch keyword generation response
 * Matches the actual server response structure
 */
export interface BatchKeywordGenerationResponse {
  keywords: KeywordItem[];
  seed_keywords: string[];
  total_keywords: number;
}

/**
 * Contact extraction request interface
 */
export interface ContactExtractionRequest {
  page_content: string;
  url: string;
  entity_name?: string;
  screenshot?: string;
}

/**
 * Contact extraction response interface
 */
export interface ContactExtractionResponse {
  emails: string[];
  phones: string[];
  address?: string;
  socialLinks?: string[];
  /** Server may return snake_case depending on proxy/serializer */
  social_links?: string[];
  confidence?: number;
  businessName?: string;
  business_name?: string;
  website?: string;
  description?: string;
}

/** Response from screenshot upload (POST /api/ai/scrape/screenshot/upload) */
export interface ScreenshotUploadResponse {
  screenshot_id: string;
  ttl_seconds: number;
}

/**
 * Scrape assist request - sent to AI server for step guidance
 */
export interface ScrapeAssistRequest {
  page_content: string;
  page_url: string;
  screenshot?: string;
  screenshot_id?: string;
  step_context: string;
  error_info: string;
  platform_name: string;
  selectors_tried: Record<string, string>;
}

/**
 * Scrape assist response - AI guidance for failed scraping steps
 */
export interface ScrapeAssistResponse {
  suggestedSelectors: Record<string, string>;
  suggestedActions: string[];
  shouldSkip: boolean;
  explanation: string;
}

/** Single executable action for observe-execute (snake_case for server) */
export interface ExecutableAction {
  action_id: string;
  type: string;
  selector?: string;
  selector_type?: string;
  value?: string;
  key?: string;
  timeout?: number;
  description?: string;
}

/** Result of executing one action (snake_case for server) */
export interface ActionResult {
  action_id: string;
  success: boolean;
  error?: string;
  element_found?: boolean;
  screenshot_after?: string;
}

/** Observe request body (snake_case for server) */
export interface ObserveRequest {
  session_id?: string | null;
  page_content: string;
  page_url: string;
  screenshot?: string;
  screenshot_id?: string;
  goal: string;
  platform_name?: string;
  selectors_available?: Record<string, string>;
  previous_action_results?: ActionResult[];
  iteration?: number;
  max_iterations?: number;
  goal_context?: string;
  step_context?: string;
  error_info?: string;
}

/** Observe response from server */
export interface ObserveResponse {
  session_id: string;
  status: "actions_needed" | "goal_achieved" | "give_up";
  actions: ExecutableAction[];
  explanation: string;
  confidence: number;
  should_retry: boolean;
  max_iterations_remaining: number;
  model_used?: string;
  processing_time?: number;
}

// ==================== OpenAI-Compatible API Types ====================

/** OpenAI-compatible message role */
export type OpenAIMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "function"
  | "tool";

/** OpenAI-compatible tool function definition */
export interface OpenAIToolFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** OpenAI-compatible tool definition */
export interface OpenAITool {
  type: "function";
  function: OpenAIToolFunction;
}

/** OpenAI-compatible tool call function */
export interface OpenAIToolCallFunction {
  name: string;
  arguments: string;
}

/** OpenAI-compatible tool call in assistant message */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: OpenAIToolCallFunction;
}

/** OpenAI-compatible streaming tool call delta */
export interface OpenAIStreamToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** OpenAI-compatible chat message */
export interface OpenAIChatMessage {
  role: OpenAIMessageRole;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** OpenAI-compatible tool choice */
export type OpenAIToolChoice =
  | "auto"
  | "none"
  | { type: "function"; function: { name: string } };

/** OpenAI-compatible chat completion request */
export interface OpenAIChatCompletionRequest {
  messages: OpenAIChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  stop?: string | string[];
  user?: string;
}

/** OpenAI-compatible model object */
export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/** OpenAI-compatible models list response */
export interface OpenAIModelsResponse {
  object: string;
  data: OpenAIModel[];
}

/** OpenAI-compatible chat completion choice (non-streaming) */
export interface OpenAIChatCompletionChoice {
  index: number;
  message: OpenAIChatMessage;
  finish_reason: string | null;
}

/** OpenAI-compatible usage info */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** OpenAI-compatible chat completion response (non-streaming) */
export interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIChatCompletionChoice[];
  usage: OpenAIUsage;
}

/** OpenAI-compatible streaming chunk delta */
export interface OpenAIStreamDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAIStreamToolCallDelta[];
}

/** OpenAI-compatible streaming chunk choice */
export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIStreamDelta;
  finish_reason: string | null;
}

/** OpenAI-compatible streaming chunk */
export interface OpenAIChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
}

// ==================== Rerank API Types ====================

/** Rerank document - can be a plain string or a JSON object with text field */
export type RerankDocument = string | { text: string; [key: string]: unknown };

/** Rerank request interface matching the /v1/rerank endpoint */
export interface RerankRequest {
  query: string;
  documents: RerankDocument[];
  model?: string;
  top_n?: number;
  return_documents?: boolean;
}

/** Single rerank result item */
export interface RerankResultItem {
  index: number;
  relevance_score: number;
  document?: { text: string };
}

/** Rerank response interface matching the /v1/rerank endpoint */
export interface RerankResponse {
  id: string;
  results: RerankResultItem[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ==================== End Rerank API Types ====================

/**
 * Website analysis request interface
 */
export interface WebsiteAnalysisRequest {
  website_content: string;
  client_business: string;
  temperature?: number;
}

/**
 * Website analysis response interface
 * Matches the actual server response structure
 */
export interface WebsiteAnalysisResponse {
  industry: string;
  match_score: number;
  reasoning: string;
}

/**
 * API client for AI Chat management
 *
 * Handles communication with remote AI chat service to send messages,
 * receive responses, and manage conversations.
 *
 * Follows the same pattern as RagConfigApi for consistency.
 *
 * @example
 * ```typescript
 * const api = new AiChatApi();
 * const response = await api.sendMessage('Hello, how are you?');
 * if (response.status) {
 *   console.log('AI Response:', response.data.message);
 * }
 * ```
 */
/**
 * Maximum total request body size in bytes for scrape/observe endpoints.
 * Kept under typical proxy limits (e.g. nginx client_max_body_size 1m) to avoid 413.
 */
const MAX_SCRAPE_REQUEST_BODY_BYTES = 800 * 1024; // 800KB
/** Extra bytes to reserve for JSON keys and other fields when estimating body size */
const SCRAPE_BODY_OVERHEAD_BYTES = 2048;

/**
 * Validation configuration for AI API requests
 */
interface AiValidationConfig {
  /** Maximum page content size in bytes (default: 50KB) */
  maxPageSize: number;
  /** Maximum error info length in characters (default: 1000) */
  maxErrorLength: number;
}

/**
 * Default validation configuration
 */
const DEFAULT_VALIDATION_CONFIG: AiValidationConfig = {
  maxPageSize: 50 * 1024, // 50KB
  maxErrorLength: 1000,
};

export class AiChatApi {
  private _httpClient: HttpClient;
  private validationConfig: AiValidationConfig;

  /**
   * Creates a new AiChatApi instance
   * Initializes the HTTP client for remote communication
   */
  constructor(validationConfig?: Partial<AiValidationConfig>) {
    this._httpClient = new HttpClient();
    this.validationConfig = {
      ...DEFAULT_VALIDATION_CONFIG,
      ...validationConfig,
    };
  }

  /**
   * Validate page content size
   * @throws {Error} When page content exceeds maximum size
   */
  private validatePageSize(pageContent: string): void {
    if (pageContent.length > this.validationConfig.maxPageSize) {
      throw new Error(
        `Page content too large: ${pageContent.length} bytes ` +
          `(maximum: ${this.validationConfig.maxPageSize} bytes)`
      );
    }
  }

  /**
   * Validate screenshot format
   * @throws {Error} When screenshot format is invalid
   */
  private validateScreenshot(screenshot: string): void {
    if (screenshot.startsWith("data:")) {
      // Must be a valid data URI for an image
      if (!/^data:image\/[a-z]+;base64,/.test(screenshot)) {
        throw new Error(
          "Invalid screenshot format. Must be a base64-encoded image data URI."
        );
      }
    }
    // Raw base64 is accepted (will be wrapped by the caller)
  }

  /**
   * Sanitize error info to remove sensitive information
   * - Removes stack traces
   * - Truncates to max length
   * - Removes file paths
   */
  private sanitizeErrorInfo(errorInfo: string): string {
    // Remove common stack trace patterns
    let sanitized = errorInfo
      .replace(/at\s+.*?\s+\(.*?\)/g, "") // Remove "at function (file:line)"
      .replace(/at\s+.*?:(\d+):(\d+)/g, "") // Remove "at file:line:col"
      .replace(/\/[^\s]+\.js:\d+:\d+/g, "") // Remove file paths
      .replace(/Error:\s*/g, "") // Remove "Error:" prefix
      .trim();

    // Truncate if too long
    if (sanitized.length > this.validationConfig.maxErrorLength) {
      sanitized =
        sanitized.substring(0, this.validationConfig.maxErrorLength) + "...";
    }

    return sanitized;
  }

  /**
   * Check if AI features are enabled for the current user.
   * Throws an error if AI is not enabled, preventing the API call.
   *
   * In worker processes, checks WORKER_AI_ENABLED env var instead of
   * Token/ElectronStoreService (which require Electron APIs unavailable in workers).
   *
   * @throws {Error} When AI features are not enabled for the user
   */
  private ensureAIEnabled(): void {
    // Worker processes cannot access ElectronStoreService/Token,
    // so use env var passed from main process instead.
    if (process.env.WORKER_TYPE) {
      const aiEnabled = process.env.WORKER_AI_ENABLED;
      if (aiEnabled !== "true") {
        throw new Error(
          "AI features are not enabled. Please upgrade your plan to access AI features."
        );
      }
      return;
    }

    const tokenService = new Token();
    const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
    if (aiEnabled !== "true") {
      throw new Error(
        "AI features are not enabled. Please upgrade your plan to access AI features."
      );
    }
  }

  /**
   * Send a chat message to the remote AI service
   *
   * @param request - Chat request containing message and optional parameters
   * @returns Promise resolving to chat response
   * @throws {Error} When network request fails
   *
   * @example
   * ```typescript
   * const response = await api.sendMessage({
   *   message: 'What is TypeScript?',
   *   conversationId: 'conv-123'
   * });
   * ```
   */
  async sendMessage(
    request: ChatRequest
  ): Promise<CommonApiresp<ChatApiResponse>> {
    this.ensureAIEnabled();
    const data: ChatApiRequestData = {
      message: request.message,
      conversation_id: request.conversationId,
      system_prompt: request.systemPrompt,
      attachments: request.attachments,
    };

    // Only include model if specified
    if (request.model) {
      data.model = request.model;
    }

    return this._httpClient.postJson("/api/ai/chat/message", data);
  }

  /**
   * Stream a chat message to the remote AI service
   *
   * This endpoint returns streaming events in the format:
   * { event: string, data: { content: {}, timestamp: string } }
   *
   * @param request - Chat request containing message and optional parameters
   * @param onEvent - Callback function to handle each stream event
   * @param options - Optional abort signal to cancel the stream
   * @returns Promise resolving when stream completes (rejects with AbortError when aborted)
   *
   * @example
   * ```typescript
   * await api.streamMessage(
   *   {
   *     message: 'Explain quantum computing',
   *     conversationId: 'conv-123'
   *   },
   *   (event) => {
   *     console.log('Event:', event.event, 'Data:', event.data);
   *   },
   *   { signal: abortController.signal }
   * );
   * ```
   */
  async streamMessage(
    request: ChatRequest,
    onEvent: (event: StreamEvent) => void,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.ensureAIEnabled();
    const data: ChatApiRequestData = {
      message: request.message,
      conversation_id: request.conversationId,
      system_prompt: request.systemPrompt,
      client_tools: request.functions,
      attachments: request.attachments,
    };

    // Only include model if specified
    if (request.model) {
      data.model = request.model;
    }

    const fetchOptions: RequestInit = {};
    if (options?.signal) {
      fetchOptions.signal = options.signal;
    }

    const response = await this._httpClient.postStream(
      "/api/ai/ask/stream",
      data,
      fetchOptions
    );

    if (!response.ok || response.status !== 200) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    await this._consumeStreamResponse(response, onEvent, options?.signal);
  }

  /**
   * Stream AI-generated email template content (dedicated API for email template, not generic chat).
   * Uses the same backend stream as chat but with email-template-specific system prompt and request shape.
   *
   * @param request - AI email template request (prompt, tone, templateType; RAG is applied on client, pass messageOverride when enhanced)
   * @param onEvent - Callback for each stream event (token, done, error)
   * @param options - Optional messageOverride when caller has already enhanced the prompt (e.g. with RAG context)
   * @returns Promise that resolves when the stream ends
   */
  /**
   * Stream AI-generated email template content from the dedicated email-template API.
   * Calls POST /api/ai/email-template/stream (not the generic ask/stream).
   */
  async streamEmailTemplateGeneration(
    request: AIEmailTemplateRequest,
    onEvent: (event: StreamEvent) => void,
    options?: { messageOverride?: string }
  ): Promise<void> {
    this.ensureAIEnabled();
    const body = {
      prompt: request.prompt,
      tone: request.tone,
      templateType: request.templateType,
      messageOverride: options?.messageOverride ?? undefined,
    };
    const response = await this._httpClient.postStream(
      "/api/ai/email-template/stream",
      body
    );
    if (!response.ok || response.status !== 200) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }
    if (!response.body) {
      throw new Error("Response body is null");
    }
    await this._consumeStreamResponse(response, onEvent);
  }

  /**
   * Consume an SSE stream response and invoke onEvent for each parsed event.
   * Shared by streamMessage and streamEmailTemplateGeneration.
   * When signal is aborted, reader.read() rejects with AbortError; we exit cleanly and rethrow.
   */
  private async _consumeStreamResponse(
    response: Response,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is null");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent: Partial<StreamEvent> = {};

    try {
      let streamActive = true;
      while (streamActive) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (readError: unknown) {
          if (
            readError instanceof Error &&
            (readError.name === "AbortError" ||
              (readError instanceof DOMException &&
                readError.name === "AbortError"))
          ) {
            streamActive = false;
            throw readError;
          }
          throw readError;
        }
        const { done, value } = result;
        if (done) {
          streamActive = false;
          continue;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          // Blank line terminates one SSE message; emit every complete event in
          // this chunk (do not cap at one per read — that dropped tool_call etc.
          // after plan_created when the server flushed multiple events together).
          if (!trimmedLine) {
            if (currentEvent.event && currentEvent.data) {
              onEvent({
                event: currentEvent.event,
                data: currentEvent.data,
              } as StreamEvent);
              currentEvent = {};
            }
            continue;
          }
          if (trimmedLine.startsWith("{")) {
            try {
              const jsonStr = trimmedLine.includes("'")
                ? pythonDictToJson(trimmedLine)
                : trimmedLine;
              const event: StreamEvent = JSON.parse(jsonStr);
              onEvent(event);
              continue;
            } catch {
              // fall through to SSE parsing
            }
          }
          if (trimmedLine.startsWith("event:")) {
            const eventType = trimmedLine.substring(6).trim();
            currentEvent.event = eventType as StreamEventType;
          } else if (trimmedLine.startsWith("data:")) {
            const dataStr = trimmedLine.substring(5).trim();
            if (
              dataStr === "pong" ||
              (!dataStr.startsWith("{") && !dataStr.startsWith("["))
            ) {
              continue;
            }
            try {
              currentEvent.data = JSON.parse(dataStr);
            } catch (error) {
              try {
                const jsonStr =
                  dataStr.startsWith("{") && dataStr.includes("'")
                    ? pythonDictToJson(dataStr)
                    : dataStr;
                currentEvent.data = JSON.parse(jsonStr);
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      }
      if (currentEvent.event && currentEvent.data) {
        onEvent(currentEvent as StreamEvent);
      }
      if (buffer.trim() && buffer.trim().startsWith("{")) {
        try {
          const bufferStr = buffer.trim();
          const jsonStr = bufferStr.includes("'")
            ? pythonDictToJson(bufferStr)
            : bufferStr;
          const event: StreamEvent = JSON.parse(jsonStr);
          onEvent(event);
        } catch {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Get available chat models from remote server
   *
   * @returns Promise resolving to available models response
   * @throws {Error} When network request fails
   *
   * @example
   * ```typescript
   * const models = await api.getAvailableModels();
   * if (models.status) {
   *   console.log('Available models:', models.data.models);
   *   console.log('Default model:', models.data.default_model);
   * }
   * ```
   */
  async getAvailableModels(): Promise<
    CommonApiresp<AvailableChatModelsResponse>
  > {
    this.ensureAIEnabled();
    return this._httpClient.get("/api/ai/chat/models");
  }

  /**
   * Test connection to remote AI chat service
   *
   * @returns Promise resolving to boolean indicating service availability
   * @throws {Error} When network request fails
   *
   * @example
   * ```typescript
   * const isOnline = await api.testConnection();
   * if (isOnline.status) {
   *   console.log('AI chat service is available');
   * }
   * ```
   */
  async testConnection(): Promise<CommonApiresp<boolean>> {
    return this._httpClient.get("/api/ai/chat/healthcheck");
  }

  /**
   * Batch generate keywords from seed keywords
   *
   * Sends multiple keyword generation requests in a single batch to the remote server.
   * Each request item contains seed keywords and configuration for keyword generation.
   *
   * @param requests - Array of keyword generation requests
   * @returns Promise resolving to batch keyword generation response
   * @throws {Error} When network request fails
   *
   * @example
   * ```typescript
   * const response = await api.batchGenerateKeywords([
   *   {
   *     seed_keywords: ["cloud storage"],
   *     config: {
   *       num_keywords: 15,
   *       keyword_type: "seo"
   *     }
   *   },
   *   {
   *     seed_keywords: ["file sharing"],
   *     config: {
   *       num_keywords: 15,
   *       keyword_type: "seo"
   *     }
   *   }
   * ]);
   * if (response.status && response.data) {
   *   console.log('Generated keywords:', response.data.keywords);
   *   console.log('Seed keywords:', response.data.seed_keywords);
   *   console.log('Total keywords:', response.data.total_keywords);
   * }
   * ```
   */
  async batchGenerateKeywords(
    requests: BatchKeywordGenerationRequestItem[]
  ): Promise<CommonApiresp<BatchKeywordGenerationResponse>> {
    this.ensureAIEnabled();
    return this._httpClient.postJson(
      "/api/ai/keywords/generate/batch",
      requests
    );
  }

  /**
   * Analyze whether a website is a target customer
   *
   * Analyzes website content against client business description to determine
   * if the website represents a potential target customer.
   *
   * @param request - Website analysis request containing website content, client business, and optional temperature
   * @returns Promise resolving to website analysis response
   * @throws {Error} When network request fails
   *
   * @example
   * ```typescript
   * const response = await api.analyzeWebsite({
   *   website_content: "# TechInsights - Technology Blog\n\n## Mission\n...",
   *   client_business: "We are a content marketing agency...",
   *   temperature: 0.7
   * });
   * if (response.status && response.data) {
   *   console.log('Industry:', response.data.industry);
   *   console.log('Match score:', response.data.match_score);
   *   console.log('Reasoning:', response.data.reasoning);
   * }
   * ```
   */
  async analyzeWebsite(
    request: WebsiteAnalysisRequest
  ): Promise<CommonApiresp<WebsiteAnalysisResponse>> {
    this.ensureAIEnabled();
    const data: WebsiteAnalysisRequest = {
      website_content: request.website_content,
      client_business: request.client_business,
    };

    // Only include temperature if specified
    if (request.temperature !== undefined) {
      data.temperature = request.temperature;
    }

    return this._httpClient.postJson("/api/ai/website/analyze", data);
  }

  /**
   * Send tool execution results to continue the AI response (SSE)
   *
   * Sends results of previously requested tool calls to the AI server and
   * streams the assistant's continued response as SSE.
   *
   * @param conversationId - Conversation identifier to continue
   * @param toolResults - Array of tool execution results
   * @param onEvent - Callback to receive parsed SSE events
   * @param clientTools - Optional client tool definitions to include
   * @param threadId - Optional thread ID for plan execution
   * @param options - Optional abort signal to cancel the stream
   */
  async streamContinueWithToolResults(
    conversationId: string,
    toolResults: ToolExecutionResult[],
    onEvent: (event: StreamEvent) => void,
    clientTools?: ToolFunction[],
    threadId?: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.ensureAIEnabled();
    const data: ContinueRequestData = {
      conversation_id: conversationId,
      tool_results: toolResults,
    };
    if (clientTools && clientTools.length > 0) {
      data.client_tools = clientTools;
    }
    if (threadId) {
      data.thread_id = threadId;
    }

    const fetchOptions: RequestInit = {};
    if (options?.signal) {
      fetchOptions.signal = options.signal;
    }

    const response = await this._httpClient.postStream(
      "/api/ai/ask/continue",
      data,
      fetchOptions
    );

    if (!response.ok || response.status !== 200) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }
    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent: Partial<StreamEvent> = {};

    try {
      let streamActive = true;
      while (streamActive) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (readError: unknown) {
          if (
            readError instanceof Error &&
            (readError.name === "AbortError" ||
              (readError instanceof DOMException &&
                readError.name === "AbortError"))
          ) {
            throw readError;
          }
          throw readError;
        }
        const { done, value } = result;
        if (done) {
          streamActive = false;
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            if (currentEvent.event && currentEvent.data) {
              onEvent(currentEvent as StreamEvent);
              currentEvent = {};
            }
            continue;
          }

          if (trimmedLine.startsWith("{")) {
            try {
              const jsonStr = trimmedLine.includes("'")
                ? pythonDictToJson(trimmedLine)
                : trimmedLine;
              const event: StreamEvent = JSON.parse(jsonStr);
              onEvent(event);
              continue;
            } catch {
              // fall through to SSE parsing
            }
          }

          if (trimmedLine.startsWith("event:")) {
            const eventType = trimmedLine.substring(6).trim();
            currentEvent.event = eventType as StreamEventType;
          } else if (trimmedLine.startsWith("data:")) {
            const dataStr = trimmedLine.substring(5).trim();
            if (
              dataStr === "pong" ||
              (!dataStr.startsWith("{") && !dataStr.startsWith("["))
            ) {
              continue;
            }
            try {
              currentEvent.data = JSON.parse(dataStr);
            } catch (error) {
              console.error(
                "Error parsing event data:",
                error,
                "Data:",
                dataStr
              );
              try {
                const jsonStr =
                  dataStr.startsWith("{") && dataStr.includes("'")
                    ? pythonDictToJson(dataStr)
                    : dataStr;
                currentEvent.data = JSON.parse(jsonStr);
              } catch (err) {
                console.error(
                  "Error parsing event data:",
                  err,
                  "Data:",
                  dataStr
                );
              }
            }
          }
        }
      }

      if (currentEvent.event && currentEvent.data) {
        onEvent(currentEvent as StreamEvent);
      }

      if (buffer.trim() && buffer.trim().startsWith("{")) {
        try {
          const bufferStr = buffer.trim();
          const jsonStr = bufferStr.includes("'")
            ? pythonDictToJson(bufferStr)
            : bufferStr;
          const event: StreamEvent = JSON.parse(jsonStr);
          onEvent(event);
        } catch (error) {
          console.error("Error parsing final stream event:", error);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Extract contact information from web page content using AI
   *
   * Sends page content, URL, entity name, and screenshot to the remote AI server
   * which handles the prompt and extraction logic server-side.
   *
   * @param pageContent - Text content of the web page
   * @param url - URL of the web page
   * @param entityName - Optional name of the entity/company
   * @param screenshot - Optional base64-encoded screenshot of the page for visual context.
   *   Accepts either a raw base64-encoded string (auto-wrapped as PNG data URI)
   *   or a full data URI (e.g., 'data:image/png;base64,...').
   * @returns Promise resolving to extracted contact information
   * @throws {Error} When network request fails
   *
   * @example
   * ```typescript
   * // With raw base64 string (auto-wrapped as data:image/png;base64,...)
   * const response = await api.extractContactInfo(
   *   'Company Name\nEmail: info@example.com\nPhone: 555-1234',
   *   'https://example.com/contact',
   *   'Example Company',
   *   'iVBORw0KGgo...'
   * );
   *
   * // With full data URI
   * const response2 = await api.extractContactInfo(
   *   'Company Name\nEmail: info@example.com\nPhone: 555-1234',
   *   'https://example.com/contact',
   *   'Example Company',
   *   'data:image/png;base64,iVBORw0KGgo...'
   * );
   * if (response.status && response.data) {
   *   console.log('Emails:', response.data.emails);
   *   console.log('Phones:', response.data.phones);
   *   console.log('Address:', response.data.address);
   * }
   * ```
   */
  async extractContactInfo(
    pageContent: string,
    url: string,
    entityName?: string,
    screenshot?: string
  ): Promise<CommonApiresp<ContactExtractionResponse>> {
    this.ensureAIEnabled();

    // Validate page content size
    this.validatePageSize(pageContent);

    // Validate screenshot format if provided
    if (screenshot) {
      this.validateScreenshot(screenshot);
    }

    let content = pageContent;
    let screen: string | undefined = screenshot;
    let estimated =
      content.length +
      (screen ? screen.length : 0) +
      SCRAPE_BODY_OVERHEAD_BYTES;
    if (estimated > MAX_SCRAPE_REQUEST_BODY_BYTES) {
      screen = undefined;
      estimated = content.length + SCRAPE_BODY_OVERHEAD_BYTES;
    }
    if (estimated > MAX_SCRAPE_REQUEST_BODY_BYTES) {
      const maxPage =
        MAX_SCRAPE_REQUEST_BODY_BYTES - SCRAPE_BODY_OVERHEAD_BYTES;
      if (maxPage > 0 && content.length > maxPage) {
        content = content.substring(0, maxPage - 20) + "\n<!-- truncated -->";
      }
    }

    const data: ContactExtractionRequest = {
      page_content: content,
      url: url,
    };

    if (entityName) {
      data.entity_name = entityName;
    }

    if (screen) {
      // Auto-wrap raw base64-encoded string as PNG data URI
      data.screenshot = screen.startsWith("data:")
        ? screen
        : `data:image/png;base64,${screen}`;
    }

    return this._httpClient.postJson("/api/ai/contact/extract", data);
  }

  /**
   * Upload a screenshot for scrape assist/observe. Returns screenshot_id to pass to scrapeAssist/scrapeObserve.
   * Use this when the screenshot is large to avoid oversized request bodies.
   */
  async uploadScrapeScreenshot(
    screenshot: string,
    ttlSeconds?: number
  ): Promise<CommonApiresp<ScreenshotUploadResponse>> {
    this.ensureAIEnabled();
    if (screenshot) {
      this.validateScreenshot(screenshot);
    }
    const body: { screenshot: string; ttl_seconds?: number } = {
      screenshot: screenshot.startsWith("data:")
        ? screenshot
        : `data:image/png;base64,${screenshot}`,
    };
    if (ttlSeconds != null) {
      body.ttl_seconds = ttlSeconds;
    }
    return this._httpClient.postJson("/api/ai/scrape/screenshot/upload", body);
  }

  /**
   * Request AI-powered scraping guidance when a scraping step fails.
   * The AI server analyzes the page and suggests alternative selectors or actions.
   * Pass screenshotId when screenshot was uploaded via uploadScrapeScreenshot to avoid large body.
   */
  async scrapeAssist(params: {
    pageContent: string;
    pageUrl: string;
    screenshot?: string;
    screenshotId?: string;
    stepContext: string;
    errorInfo: string;
    platformName: string;
    selectorsTried: Record<string, string>;
  }): Promise<CommonApiresp<ScrapeAssistResponse>> {
    this.ensureAIEnabled();

    // Validate page content size
    this.validatePageSize(params.pageContent);

    // Validate screenshot format if provided (and not using screenshotId)
    if (params.screenshot && !params.screenshotId) {
      this.validateScreenshot(params.screenshot);
    }

    // Sanitize error info to remove sensitive information
    const sanitizedErrorInfo = this.sanitizeErrorInfo(params.errorInfo);

    let pageContent = params.pageContent;
    let screenshot: string | undefined = params.screenshotId
      ? undefined
      : params.screenshot;
    let estimated =
      pageContent.length +
      (screenshot ? screenshot.length : 0) +
      SCRAPE_BODY_OVERHEAD_BYTES;
    if (estimated > MAX_SCRAPE_REQUEST_BODY_BYTES) {
      screenshot = undefined;
      estimated = pageContent.length + SCRAPE_BODY_OVERHEAD_BYTES;
    }
    if (estimated > MAX_SCRAPE_REQUEST_BODY_BYTES) {
      const maxPage =
        MAX_SCRAPE_REQUEST_BODY_BYTES - SCRAPE_BODY_OVERHEAD_BYTES;
      if (maxPage > 0 && pageContent.length > maxPage) {
        pageContent =
          pageContent.substring(0, maxPage - 20) + "\n<!-- truncated -->";
      }
    }

    const data: ScrapeAssistRequest = {
      page_content: pageContent,
      page_url: params.pageUrl,
      step_context: params.stepContext,
      error_info: sanitizedErrorInfo,
      platform_name: params.platformName,
      selectors_tried: params.selectorsTried,
    };

    if (params.screenshotId) {
      data.screenshot_id = params.screenshotId;
    } else if (screenshot) {
      data.screenshot = screenshot.startsWith("data:")
        ? screenshot
        : `data:image/png;base64,${screenshot}`;
    }

    return this._httpClient.postJson("/api/ai/scrape/assist", data);
  }

  /**
   * Observe-and-plan: get executable actions or status (goal_achieved / give_up) for the observe-execute loop.
   * Pass screenshotId when screenshot was uploaded via uploadScrapeScreenshot to avoid large body.
   */
  async scrapeObserve(params: {
    sessionId?: string | null;
    pageContent: string;
    pageUrl: string;
    screenshot?: string;
    screenshotId?: string;
    goal: string;
    platformName?: string;
    selectorsAvailable?: Record<string, string>;
    previousActionResults?: ActionResult[];
    iteration?: number;
    maxIterations?: number;
    goalContext?: string;
    stepContext?: string;
    errorInfo?: string;
  }): Promise<CommonApiresp<ObserveResponse>> {
    this.ensureAIEnabled();
    this.validatePageSize(params.pageContent);
    if (params.screenshot && !params.screenshotId) {
      this.validateScreenshot(params.screenshot);
    }

    let pageContent = params.pageContent;
    let screenshot: string | undefined = params.screenshotId
      ? undefined
      : params.screenshot;
    let estimated =
      pageContent.length +
      (screenshot ? screenshot.length : 0) +
      SCRAPE_BODY_OVERHEAD_BYTES;
    if (estimated > MAX_SCRAPE_REQUEST_BODY_BYTES) {
      screenshot = undefined;
      estimated = pageContent.length + SCRAPE_BODY_OVERHEAD_BYTES;
    }
    if (estimated > MAX_SCRAPE_REQUEST_BODY_BYTES) {
      const maxPage =
        MAX_SCRAPE_REQUEST_BODY_BYTES - SCRAPE_BODY_OVERHEAD_BYTES;
      if (maxPage > 0 && pageContent.length > maxPage) {
        pageContent =
          pageContent.substring(0, maxPage - 20) + "\n<!-- truncated -->";
      }
    }

    const data: ObserveRequest = {
      page_content: pageContent,
      page_url: params.pageUrl,
      goal: params.goal,
      platform_name: params.platformName,
      selectors_available: params.selectorsAvailable,
      previous_action_results: params.previousActionResults,
      iteration: params.iteration ?? 0,
    };
    if (params.sessionId != null && params.sessionId !== "") {
      data.session_id = params.sessionId;
    }
    if (params.screenshotId) {
      data.screenshot_id = params.screenshotId;
    } else if (screenshot) {
      data.screenshot = screenshot.startsWith("data:")
        ? screenshot
        : `data:image/png;base64,${screenshot}`;
    }
    if (params.maxIterations != null) {
      data.max_iterations = params.maxIterations;
    }
    if (params.goalContext != null && params.goalContext !== "") {
      data.goal_context = params.goalContext;
    }
    if (params.stepContext != null && params.stepContext !== "") {
      data.step_context = params.stepContext;
    }
    if (params.errorInfo != null && params.errorInfo !== "") {
      data.error_info = params.errorInfo;
    }
    return this._httpClient.postJson("/api/ai/scrape/observe", data);
  }

  /**
   * Mark an observe-execute session complete (clear server-side session).
   */
  async scrapeComplete(
    sessionId: string,
    success = true
  ): Promise<CommonApiresp<unknown>> {
    this.ensureAIEnabled();
    return this._httpClient.postJson("/api/ai/scrape/complete", {
      session_id: sessionId,
      success,
    });
  }

  /**
   * Call the AI server's Puppeteer recovery API (POST /api/ai/puppeteer/recovery) to get suggested recovery actions.
   * Sends page state (HTML, error, optional screenshot, etc.) and returns structured actions.
   */
  async sendPuppeteerRecovery(
    request: AIRecoveryRequest
  ): Promise<CommonApiresp<PuppeteerRecoveryResponseData>> {
    this.ensureAIEnabled();

    const data: Record<string, unknown> = {
      request_id: request.requestId,
      operation: request.operation,
      search_engine: request.searchEngine,
      current_url: request.currentUrl,
      page_title: request.pageTitle ?? "",
      error_message: request.errorMessage,
      attempted_selectors: request.attemptedSelectors ?? [],
      html_sample: request.htmlSample,
    };

    if (request.accessibilityTree) {
      data.accessibility_tree = request.accessibilityTree;
    }
    if (request.keyword) {
      data.keyword = request.keyword;
    }
    if (request.screenshot) {
      data.screenshot = request.screenshot.startsWith("data:")
        ? request.screenshot
        : `data:image/png;base64,${request.screenshot}`;
    }

    return this._httpClient.postJson("/api/ai/puppeteer/recovery", {
      data,
    });
  }

  // ==================== OpenAI-Compatible API Methods ====================

  /**
   * List available models from the OpenAI-compatible API.
   * GET /v1/models
   *
   * @returns Promise resolving to models list in OpenAI format
   */
  async listOpenAIModels(): Promise<OpenAIModelsResponse> {
    this.ensureAIEnabled();
    try {
      return await this._httpClient.get("/v1/models");
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
      const legacyModels = await this._httpClient.get("/api/ai/chat/models");
      return this.normalizeLegacyModelsResponse(legacyModels);
    }
  }

  /**
   * Non-streaming chat completion using the OpenAI-compatible API.
   * POST /v1/chat/completions (stream: false or omitted)
   *
   * @param request - Chat completion request with messages and optional parameters
   * @returns Promise resolving to chat completion response
   */
  async openAIChatCompletion(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    this.ensureAIEnabled();
    const data: OpenAIChatCompletionRequest = {
      messages: request.messages,
      stream: false,
    };
    if (request.model) {
      data.model = request.model;
    }
    if (request.temperature !== undefined) {
      data.temperature = request.temperature;
    }
    if (request.max_tokens !== undefined) {
      data.max_tokens = request.max_tokens;
    }
    if (request.tools && request.tools.length > 0) {
      data.tools = request.tools;
    }
    if (request.tool_choice !== undefined) {
      data.tool_choice = request.tool_choice;
    }
    if (request.stop !== undefined) {
      data.stop = request.stop;
    }
    if (request.user !== undefined) {
      data.user = request.user;
    }
    return this._httpClient.postJson("/v1/chat/completions", data);
  }

  /**
   * Streaming chat completion using the OpenAI-compatible API.
   * POST /v1/chat/completions (stream: true)
   *
   * @param request - Chat completion request with messages and optional parameters
   * @param onChunk - Callback invoked for each parsed streaming chunk
   * @param options - Optional abort signal to cancel the stream
   */
  async openAIChatCompletionStream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.ensureAIEnabled();
    const data: OpenAIChatCompletionRequest = {
      messages: request.messages,
      stream: true,
    };
    if (request.model) {
      data.model = request.model;
    }
    if (request.temperature !== undefined) {
      data.temperature = request.temperature;
    }
    if (request.max_tokens !== undefined) {
      data.max_tokens = request.max_tokens;
    }
    if (request.tools && request.tools.length > 0) {
      data.tools = request.tools;
    }
    if (request.tool_choice !== undefined) {
      data.tool_choice = request.tool_choice;
    }
    if (request.stop !== undefined) {
      data.stop = request.stop;
    }
    if (request.user !== undefined) {
      data.user = request.user;
    }

    const fetchOptions: RequestInit = {};
    if (options?.signal) {
      fetchOptions.signal = options.signal;
    }

    let response: Response;
    try {
      response = await this._httpClient.postStream(
        "/v1/chat/completions",
        data,
        fetchOptions
      );
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
      return this.openAIChatCompletionStreamViaLegacyEndpoint(
        request,
        onChunk,
        fetchOptions
      );
    }

    if (!response.ok || response.status !== 200) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    await this._consumeOpenAIStreamResponse(response, onChunk);
  }

  private async openAIChatCompletionStreamViaLegacyEndpoint(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    fetchOptions: RequestInit
  ): Promise<void> {
    const legacyRequest = this.buildLegacyChatRequestFromOpenAI(request);
    const response = await this._httpClient.postStream(
      "/api/ai/ask/stream",
      legacyRequest,
      fetchOptions
    );

    if (!response.ok || response.status !== 200) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }

    let chunkIndex = 0;
    const signal = fetchOptions.signal ?? undefined;
    await this._consumeStreamResponse(response, (event) => {
      const eventType = String(event.event ?? "");
      const content =
        typeof event.data?.content === "string" ? event.data.content : "";

      if (eventType === StreamEventType.TOKEN && content) {
        onChunk({
          id: `legacy-${Date.now()}-${chunkIndex}`,
          object: "chat.completion.chunk",
          created: Date.now(),
          model: request.model ?? "",
          choices: [
            {
              index: chunkIndex++,
              delta: { content },
              finish_reason: null,
            },
          ],
        });
        return;
      }

      if (
        eventType === StreamEventType.DONE ||
        eventType === StreamEventType.COMPLETE ||
        eventType === StreamEventType.CONVERSATION_END
      ) {
        onChunk({
          id: `legacy-${Date.now()}-${chunkIndex}`,
          object: "chat.completion.chunk",
          created: Date.now(),
          model: request.model ?? "",
          choices: [
            {
              index: chunkIndex++,
              delta: {},
              finish_reason: "stop",
            },
          ],
        });
        return;
      }

      if (eventType === StreamEventType.ERROR) {
        const errorMessage =
          content ||
          (typeof event.data === "object" &&
          event.data &&
          "errorMessage" in event.data &&
          typeof event.data.errorMessage === "string"
            ? event.data.errorMessage
            : "Unknown error");
        throw new Error(errorMessage);
      }
    }, signal);
  }

  private buildLegacyChatRequestFromOpenAI(
    request: OpenAIChatCompletionRequest
  ): ChatApiRequestData {
    const systemPrompt = request.messages.find((m) => m.role === "system")?.content;
    const conversationText = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => `${this.getLegacyRoleLabel(m.role)}: ${m.content ?? ""}`.trim())
      .join("\n\n");

    return {
      message: conversationText || request.messages.at(-1)?.content || "",
      model: request.model,
      system_prompt: typeof systemPrompt === "string" ? systemPrompt : undefined,
    };
  }

  private getLegacyRoleLabel(role: OpenAIMessageRole): string {
    switch (role) {
      case "assistant":
        return "Assistant";
      case "system":
        return "System";
      case "tool":
        return "Tool";
      case "function":
        return "Function";
      case "user":
      default:
        return "User";
    }
  }

  private normalizeLegacyModelsResponse(
    response: unknown
  ): OpenAIModelsResponse {
    const payload = this.unwrapLegacyPayload<AvailableChatModelsResponse>(response);
    const models = Object.entries(payload?.models ?? {}).map(([id, model]) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "legacy-ai-server",
      ...("name" in model && typeof model.name === "string" && model.name
        ? { id: model.name }
        : {}),
    }));
    return {
      object: "list",
      data: models,
    };
  }

  private unwrapLegacyPayload<T>(response: unknown): T {
    if (
      response &&
      typeof response === "object" &&
      "data" in response &&
      (response as { data?: unknown }).data !== undefined
    ) {
      return (response as { data: T }).data;
    }
    return response as T;
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof Error && /(^|[\s:])404\b|not found/i.test(error.message);
  }

  /**
   * Consume an OpenAI-format SSE stream.
   * Parses `data: {json}` lines and emits parsed chunks.
   * Terminates on `data: [DONE]`.
   */
  private async _consumeOpenAIStreamResponse(
    response: Response,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void
  ): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is null");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      let streamActive = true;
      while (streamActive) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (readError: unknown) {
          if (
            readError instanceof Error &&
            (readError.name === "AbortError" ||
              (readError instanceof DOMException &&
                readError.name === "AbortError"))
          ) {
            streamActive = false;
            throw readError;
          }
          throw readError;
        }

        const { done, value } = result;
        if (done) {
          streamActive = false;
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          if (trimmedLine === "data: [DONE]") {
            streamActive = false;
            break;
          }

          if (trimmedLine.startsWith("data: ")) {
            const jsonStr = trimmedLine.substring(6);
            try {
              const chunk: OpenAIChatCompletionChunk = JSON.parse(jsonStr);
              onChunk(chunk);
            } catch {
              // Ignore parse errors for individual chunks
            }
          }
        }
      }

      // Process any remaining data in buffer
      const trimmedBuffer = buffer.trim();
      if (
        trimmedBuffer &&
        trimmedBuffer !== "data: [DONE]" &&
        trimmedBuffer.startsWith("data: ")
      ) {
        const jsonStr = trimmedBuffer.substring(6);
        try {
          const chunk: OpenAIChatCompletionChunk = JSON.parse(jsonStr);
          onChunk(chunk);
        } catch {
          // Ignore parse errors
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ==================== Rerank API ====================

  /**
   * Rerank documents by relevance to a query.
   * POST /v1/rerank
   *
   * @param request - Rerank request with query, documents, and optional parameters
   * @returns Ranked results with relevance scores
   */
  async rerank(request: RerankRequest): Promise<RerankResponse> {
    this.ensureAIEnabled();
    const data: RerankRequest = {
      query: request.query,
      documents: request.documents,
    };
    if (request.model) {
      data.model = request.model;
    }
    if (request.top_n !== undefined) {
      data.top_n = request.top_n;
    }
    if (request.return_documents !== undefined) {
      data.return_documents = request.return_documents;
    }
    return this._httpClient.postJson("/api/ai/v1/rerank", data);
  }
}
