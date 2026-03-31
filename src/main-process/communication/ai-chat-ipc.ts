import { ipcMain } from "electron";
import {
  AiChatApi,
  ChatRequest,
  StreamEvent,
  StreamEventType,
  BatchKeywordGenerationRequestItem,
} from "@/api/aiChatApi";
import { getAvailableToolFunctions } from "@/config/aiTools.config";
import {
  CommonMessage,
  ChatMessage,
  ChatHistoryResponse,
  ChatStreamChunk,
  MessageType,
  LLMImageAttachmentPayload,
  UploadedFilePayload,
} from "@/entityTypes/commonType";
import { AIChatModule } from "@/modules/AIChatModule";
import { AIChatAttachmentModule } from "@/modules/AIChatAttachmentModule";
import {
  RagSearchModule,
  SearchRequest,
  SearchResponse,
} from "@/modules/RagSearchModule";
// import { SearchModule } from '@/modules/SearchModule';
// import { SearchTaskStatus } from '@/model/SearchTask.model';
// import { ToolExecutor } from '@/service/ToolExecutor';
// import { YellowPagesController } from '@/controller/YellowPagesController';
// import { TaskStatus } from '@/modules/interface/ITaskManager';
import { YellowPagesResult } from "@/modules/interface/ITaskManager";
import {
  StreamEventProcessor,
  StreamState,
} from "@/service/StreamEventProcessor";
// import { SearchResult } from '@/service/VectorSearchService';
import {
  AI_CHAT_MESSAGE,
  AI_CHAT_STREAM,
  AI_CHAT_STREAM_STOP,
  AI_CHAT_STREAM_COMPLETE,
  AI_CHAT_HISTORY,
  AI_CHAT_CLEAR,
  AI_CHAT_CONVERSATIONS,
  AI_KEYWORDS_GENERATE,
} from "@/config/channellist";
// import { Token } from '@/modules/token';
// import { USERID } from '@/config/usersetting';
import { v4 as uuidv4 } from "uuid";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";

/**
 * Generate a unique conversation ID in format: user_id:uuid
 */
function generateConversationId(): string {
  // const tokenService = new Token();
  // const userId = tokenService.getValue(USERID) || 'anonymous';
  return uuidv4();
}

const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024; // must match frontend v1 limits
const MAX_REMOTE_MESSAGE_CHARS = 95000; // must stay below backend AskStreamData.message max_length (100000)
const MAX_BASE64_LENGTH = Math.ceil((MAX_UPLOAD_FILE_BYTES * 4) / 3) + 16;

function normalizeUploadedFiles(input: unknown): UploadedFilePayload[] {
  if (!Array.isArray(input)) return [];

  const result: UploadedFilePayload[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    const fileName = rec.fileName;
    const mimeType = rec.mimeType;
    const sizeBytes = rec.sizeBytes;
    const contentBase64 = rec.contentBase64;

    if (typeof fileName !== "string") continue;
    if (typeof mimeType !== "string") continue;
    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) continue;
    if (typeof contentBase64 !== "string") continue;

    if (sizeBytes > MAX_UPLOAD_FILE_BYTES) {
      console.warn(
        `normalizeUploadedFiles: skipping file "${fileName}" — size ${sizeBytes} exceeds limit ${MAX_UPLOAD_FILE_BYTES}`
      );
      continue;
    }

    result.push({
      fileName,
      mimeType,
      sizeBytes,
      contentBase64,
    });
  }

  return result;
}

function truncateForRemote(message: string): string {
  if (message.length <= MAX_REMOTE_MESSAGE_CHARS) return message;
  return message.slice(0, MAX_REMOTE_MESSAGE_CHARS);
}

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MAX_TOTAL_ATTACHMENTS_BASE64_LENGTH = 10 * 1024 * 1024; // ~13.3MB base64 cap across all attachments

function normalizeLLMAttachments(input: unknown): LLMImageAttachmentPayload[] {
  if (!Array.isArray(input)) return [];

  const result: LLMImageAttachmentPayload[] = [];
  let runningLength = 0;

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const type = rec.type;
    const mediaType = rec.mediaType;
    const dataBase64 = rec.dataBase64;
    const detail = rec.detail;

    if (type !== "image") continue;
    if (typeof mediaType !== "string" || !ALLOWED_IMAGE_MIME_TYPES.has(mediaType)) continue;
    if (typeof dataBase64 !== "string" || dataBase64.length === 0) continue;
    if (dataBase64.length > MAX_BASE64_LENGTH) {
      console.warn(
        `normalizeLLMAttachments: skipping attachment with mediaType "${mediaType}" — base64 length ${dataBase64.length} exceeds per-file limit ${MAX_BASE64_LENGTH}`
      );
      continue;
    }
    if (runningLength + dataBase64.length > MAX_TOTAL_ATTACHMENTS_BASE64_LENGTH) {
      console.warn(
        `normalizeLLMAttachments: skipping attachment with mediaType "${mediaType}" — total payload would exceed ${MAX_TOTAL_ATTACHMENTS_BASE64_LENGTH}`
      );
      continue;
    }

    runningLength += dataBase64.length;

    result.push({
      type: "image",
      mediaType,
      dataBase64,
      detail: detail === "low" || detail === "high" ? detail : "auto",
    });
  }

  return result;
}

type AttachmentSaveResult = {
  metadata: Array<{ fileName: string; mimeType: string; sizeBytes: number }>;
};

async function persistAttachmentsAndSaveMessage(
  chatModule: AIChatModule,
  conversationId: string,
  userMessageId: string,
  message: string,
  rawUploadedFiles: unknown
): Promise<AttachmentSaveResult> {
  const attachmentModule = new AIChatAttachmentModule();
  const uploadedFiles = normalizeUploadedFiles(rawUploadedFiles);
  const attachmentMetadata = uploadedFiles.map((f) => ({
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
  }));

  if (uploadedFiles.length > 0) {
    await attachmentModule.saveUploadedFiles(
      conversationId,
      userMessageId,
      uploadedFiles
    );
  }

  await chatModule.saveMessage({
    messageId: userMessageId,
    conversationId,
    role: "user",
    content: message,
    timestamp: new Date(),
    messageType: MessageType.MESSAGE,
    metadata:
      attachmentMetadata.length > 0
        ? { attachments: attachmentMetadata }
        : undefined,
  });

  return { metadata: attachmentMetadata };
}

/**
 * Enhance message with RAG context if enabled
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function enhanceMessageWithRAG(
  message: string,
  useRAG: boolean,
  ragLimit: number | undefined,
  ragSearchModule: RagSearchModule
): Promise<string> {
  if (!useRAG) {
    return message;
  }

  try {
    const searchRequest: SearchRequest = {
      query: message,
      options: {
        limit: ragLimit || 5,
      },
    };

    const searchResponse: SearchResponse = await ragSearchModule.search(
      searchRequest
    );

    if (searchResponse.results.length > 0) {
      // Format RAG results as context
      const ragContext = searchResponse.results
        .map((result, index) => {
          return `[Document ${index + 1}: ${result.document.name}]\n${
            result.content
          }`;
        })
        .join("\n\n");

      // Prepend RAG context to the message
      const enhancedMessage = `Based on the following context from knowledge base:\n\n${ragContext}\n\n---\n\nUser question: ${message}`;

      console.log(
        `RAG search found ${searchResponse.results.length} relevant documents`
      );
      return enhancedMessage;
    } else {
      console.log(
        "RAG search returned no results, proceeding with original message"
      );
      return message;
    }
  } catch (ragError) {
    console.error(
      "RAG search failed, proceeding without RAG context:",
      ragError
    );
    // Continue with original message if RAG fails
    return message;
  }
}

/**
 * Format Yellow Pages results for LLM consumption
 * Creates a readable list format with key business information
 */
export function formatYellowPagesResultsForLLM(
  results: YellowPagesResult[]
): string {
  if (results.length === 0) {
    return "No business results found.";
  }

  const formattedResults = results
    .map((result, index) => {
      const businessName = result.business_name || "Unknown Business";
      const phone = result.phone ? `Phone: ${result.phone}` : "";
      const email = result.email ? `Email: ${result.email}` : "";
      const website = result.website ? `Website: ${result.website}` : "";

      // Format address
      const addressParts: string[] = [];
      if (result.address?.street) addressParts.push(result.address.street);
      if (result.address?.city) addressParts.push(result.address.city);
      if (result.address?.state) addressParts.push(result.address.state);
      if (result.address?.zip) addressParts.push(result.address.zip);
      const address =
        addressParts.length > 0 ? `Address: ${addressParts.join(", ")}` : "";

      // Format categories
      const categories =
        result.categories &&
        Array.isArray(result.categories) &&
        result.categories.length > 0
          ? `Categories: ${result.categories.join(", ")}`
          : "";

      // Format rating
      const rating = result.rating ? `Rating: ${result.rating}/5` : "";
      const reviewCount = result.review_count
        ? `(${result.review_count} reviews)`
        : "";
      const ratingInfo = rating ? `${rating} ${reviewCount}`.trim() : "";

      // Build contact info
      const contactInfo = [phone, email, website].filter(Boolean).join(" | ");

      // Build result string
      const parts = [
        `${index + 1}. **${businessName}**`,
        contactInfo && `   ${contactInfo}`,
        address && `   ${address}`,
        categories && `   ${categories}`,
        ratingInfo && `   ${ratingInfo}`,
      ].filter(Boolean);

      return parts.join("\n");
    })
    .join("\n\n");

  return `Found ${results.length} business result${
    results.length === 1 ? "" : "s"
  }:\n\n${formattedResults}`;
}

/** AbortController for the currently active AI chat stream; cleared when stream ends or is stopped. */
let currentStreamAbortController: AbortController | null = null;

/**
 * Register AI Chat IPC handlers
 */
export function registerAiChatIpcHandlers(): void {
  console.log("AI Chat IPC handlers registered");

  // Stop active AI chat stream (renderer sends when user clicks stop)
  ipcMain.on(AI_CHAT_STREAM_STOP, () => {
    if (currentStreamAbortController) {
      currentStreamAbortController.abort();
    }
  });

  // Send chat message (non-streaming)
  ipcMain.handle(
    AI_CHAT_MESSAGE,
    async (
      event,
      data: unknown
    ): Promise<CommonMessage<ChatMessage | null>> => {
      try {
        const requestData = JSON.parse(data as string) as {
          message: string;
          conversationId?: string;
          model?: string;
          useRAG?: boolean;
          ragLimit?: number;
          uploadedFiles?: unknown;
          attachments?: unknown;
        };

        const aiChatApi = new AiChatApi();
        const chatModule = new AIChatModule();
        const ragSearchModule = new RagSearchModule();
        await ragSearchModule.initialize();

        // Generate new conversationId if not provided or if it's 'pending' (which causes errors)
        // 'pending' is used as a placeholder in the frontend but should not be sent to backend
        const conversationId =
          requestData.conversationId && requestData.conversationId !== "pending"
            ? requestData.conversationId
            : generateConversationId();

        // Save user message to database
        const userMessageId = `user-${Date.now()}`;

        await persistAttachmentsAndSaveMessage(
          chatModule,
          conversationId,
          userMessageId,
          requestData.message,
          requestData.uploadedFiles
        );
        const normalizedAttachments = normalizeLLMAttachments(
          requestData.attachments
        );

        // If useRAG is true, perform local RAG search and append results to the message
        let enhancedMessage = requestData.message;
        if (requestData.useRAG) {
          try {
            const searchRequest: SearchRequest = {
              query: requestData.message,
              options: {
                limit: requestData.ragLimit || 5,
              },
            };

            const searchResponse: SearchResponse = await ragSearchModule.search(
              searchRequest
            );

            if (searchResponse.results.length > 0) {
              // Format RAG results as context
              const ragContext = searchResponse.results
                .map((result, index) => {
                  return `[Document ${index + 1}: ${result.document.name}]\n${
                    result.content
                  }`;
                })
                .join("\n\n");

              // Prepend RAG context to the message
              enhancedMessage = `Based on the following context from knowledge base:\n\n${ragContext}\n\n---\n\nUser question: ${requestData.message}`;

              console.log(
                `RAG search found ${searchResponse.results.length} relevant documents`
              );
            } else {
              console.log(
                "RAG search returned no results, proceeding with original message"
              );
            }
          } catch (ragError) {
            console.error(
              "RAG search failed, proceeding without RAG context:",
              ragError
            );
            // Continue with original message if RAG fails
          }
        }

        enhancedMessage = truncateForRemote(enhancedMessage);

        // Get available tools (static + MCP)
        const availableTools = await getAvailableToolFunctions();

        // Send to remote API
        const chatRequest: ChatRequest = {
          message: enhancedMessage,
          conversationId,
          model: requestData.model,
          useRAG: requestData.useRAG,
          ragLimit: requestData.ragLimit,
          functions: availableTools,
          attachments: normalizedAttachments,
        };

        const apiResponse = await aiChatApi.sendMessage(chatRequest);

        if (apiResponse.status && apiResponse.data) {
          // Save assistant message to database
          await chatModule.saveMessage({
            messageId: apiResponse.data.messageId,
            conversationId,
            role: "assistant",
            content: apiResponse.data.message,
            timestamp: new Date(),
            model: apiResponse.data.model,
            tokensUsed: apiResponse.data.tokensUsed,
            messageType: MessageType.MESSAGE,
          });

          const assistantMessage: ChatMessage = {
            id: apiResponse.data.messageId,
            role: "assistant",
            content: apiResponse.data.message,
            timestamp: new Date(),
            conversationId,
          };

          const response: CommonMessage<ChatMessage> = {
            status: true,
            msg: "Message sent successfully",
            data: assistantMessage,
          };
          return response;
        } else {
          const errorResponse: CommonMessage<null> = {
            status: false,
            msg: apiResponse.msg || "Failed to send message",
            data: null,
          };
          return errorResponse;
        }
      } catch (error) {
        console.error("AI Chat message error:", error);
        const errorResponse: CommonMessage<null> = {
          status: false,
          msg:
            error instanceof Error ? error.message : "Unknown error occurred",
          data: null,
        };
        return errorResponse;
      }
    }
  );

  // Stream chat message
  ipcMain.on(AI_CHAT_STREAM, async (event, data): Promise<void> => {
    try {
      // Check AI enable first
      const tokenService = new Token();
      const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
      if (!aiEnabled || aiEnabled === "false" || aiEnabled === "0") {
        const errorChunk: ChatStreamChunk = {
          content: "",
          isComplete: true,
          eventType: StreamEventType.ERROR,
          errorMessage: "AI is not enabled",
        };
        (
          event as {
            sender: { send: (channel: string, message: string) => void };
          }
        ).sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
        return;
      }

      const requestData = JSON.parse(data as string) as {
        message: string;
        conversationId?: string;
        model?: string;
        useRAG?: boolean;
        ragLimit?: number;
        uploadedFiles?: unknown;
        attachments?: unknown;
      };

      const aiChatApi = new AiChatApi();
      const chatModule = new AIChatModule();
      const ragSearchModule = new RagSearchModule();
      await ragSearchModule.initialize();

      // Generate new conversationId if not provided or if it's 'pending' (which causes errors)
      // 'pending' is used as a placeholder in the frontend but should not be sent to backend
      const conversationId =
        requestData.conversationId && requestData.conversationId !== "pending"
          ? requestData.conversationId
          : generateConversationId();

      // Save user message to database
      const userMessageId = `user-${Date.now()}`;

      await persistAttachmentsAndSaveMessage(
        chatModule,
        conversationId,
        userMessageId,
        requestData.message,
        requestData.uploadedFiles
      );
      const normalizedAttachments = normalizeLLMAttachments(
        requestData.attachments
      );

      // If useRAG is true, perform local RAG search and append results to the message
      let enhancedMessage = requestData.message;
      if (requestData.useRAG) {
        try {
          const searchRequest: SearchRequest = {
            query: requestData.message,
            options: {
              limit: requestData.ragLimit || 5,
            },
          };

          const searchResponse: SearchResponse = await ragSearchModule.search(
            searchRequest
          );

          if (searchResponse.results.length > 0) {
            // Format RAG results as context
            const ragContext = searchResponse.results
              .map((result, index) => {
                return `[Document ${index + 1}: ${result.document.name}]\n${
                  result.content
                }`;
              })
              .join("\n\n");

            // Prepend RAG context to the message
            enhancedMessage = `Based on the following context from knowledge base:\n\n${ragContext}\n\n---\n\nUser question: ${requestData.message}`;

            console.log(
              `RAG search found ${searchResponse.results.length} relevant documents`
            );
          } else {
            console.log(
              "RAG search returned no results, proceeding with original message"
            );
          }
        } catch (ragError) {
          console.error(
            "RAG search failed, proceeding without RAG context:",
            ragError
          );
          // Continue with original message if RAG fails
        }
      }

      enhancedMessage = truncateForRemote(enhancedMessage);

      // Get available tools (static + MCP)
      const availableTools = await getAvailableToolFunctions();

      // Send to remote API for streaming
      const chatRequest: ChatRequest = {
        message: enhancedMessage,
        conversationId: conversationId,
        model: requestData.model,
        useRAG: requestData.useRAG,
        ragLimit: requestData.ragLimit,
        functions: availableTools,
        attachments: normalizedAttachments,
      };

      const assistantMessageId = `assistant-${Date.now()}`;

      currentStreamAbortController = new AbortController();
      const signal = currentStreamAbortController.signal;

      // Create stream state
      const streamState: StreamState = {
        assistantMessageId,
        fullContent: "",
        streamConversationId: conversationId,
        hasStartedConversation: false,
        pendingToolCalls: new Set<string>(),
        deferredCompletionChunk: null,
        messageSaved: false,
        chatModule,
        aiChatApi,
        abortSignal: signal,
        currentPlan: null,
        planThreadId: undefined,
      };

      // Create stream event processor
      const processor = new StreamEventProcessor(
        event as {
          sender: { send: (channel: string, ...args: unknown[]) => void };
        },
        streamState
      );

      // Common handler for processing a single stream event and forwarding to UI
      const processStreamEvent = (streamEvent: StreamEvent): void => {
        try {
          processor.processEvent(streamEvent);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("tool name is required")
          ) {
            return;
          }
          console.error("Error processing stream event:", error);
        }
      };

      const sender = (
        event as {
          sender: { send: (channel: string, message: string) => void };
        }
      ).sender;

      try {
        // Stream message with event handler
        await aiChatApi.streamMessage(
          chatRequest,
          (streamEvent: StreamEvent) => {
            processStreamEvent(streamEvent);
          },
          { signal }
        );
        // Note: Message saving is now handled in StreamEventProcessor completion event handlers (DONE, CONVERSATION_END)
        // or in sendDeferredCompletionIfReady to ensure all content from streamContinueWithToolResults
        // is included before saving
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("tool name is required")
        ) {
          return;
        }
        const isAbort = error instanceof Error && error.name === "AbortError";
        const isDomAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (isAbort || isDomAbort) {
          const cancelledChunk: ChatStreamChunk = {
            content: "",
            isComplete: true,
            eventType: "cancelled",
            conversationId,
          };
          sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(cancelledChunk));
        } else {
          console.error("AI Chat stream error:", error);
          const errorChunk: ChatStreamChunk = {
            content: "",
            isComplete: true,
            eventType: StreamEventType.ERROR,
            errorMessage:
              error instanceof Error ? error.message : "Unknown error occurred",
          };
          sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
        }
      } finally {
        currentStreamAbortController = null;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("tool name is required")
      ) {
        return;
      }
      console.error("AI Chat stream error:", error);
      const errorChunk: ChatStreamChunk = {
        content: "",
        isComplete: true,
        eventType: StreamEventType.ERROR,
        errorMessage:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
      (
        event as {
          sender: { send: (channel: string, message: string) => void };
        }
      ).sender.send(AI_CHAT_STREAM_COMPLETE, JSON.stringify(errorChunk));
    } finally {
      currentStreamAbortController = null;
    }
  });

  // Get chat history
  ipcMain.handle(
    AI_CHAT_HISTORY,
    async (
      event,
      data: unknown
    ): Promise<CommonMessage<ChatHistoryResponse | null>> => {
      try {
        const requestData = data ? JSON.parse(data as string) : {};
        const requestConversationId = requestData.conversationId;

        if (!requestConversationId) {
          return {
            status: false,
            msg: "Conversation ID is required",
            data: null,
          };
        }

        const chatModule = new AIChatModule();
        const messageEntities = await chatModule.getConversationMessages(
          requestConversationId
        );

        // Convert entities to ChatMessage format
        const messages: ChatMessage[] = messageEntities.map((entity) => {
          const message: ChatMessage = {
            id: entity.messageId,
            role: entity.role as "user" | "assistant" | "system",
            content: entity.content,
            timestamp: entity.timestamp,
            conversationId: entity.conversationId,
            messageType: entity.messageType,
          };

          // Parse metadata if available
          if (entity.metadata) {
            try {
              message.metadata = JSON.parse(entity.metadata);
            } catch (parseError) {
              console.warn("Failed to parse message metadata:", parseError);
            }
          }

          return message;
        });

        return {
          status: true,
          msg: "Chat history retrieved successfully",
          data: {
            conversationId: requestConversationId,
            messages: messages,
            totalMessages: messages.length,
          },
        };
      } catch (error) {
        console.error("Error getting chat history:", error);
        return {
          status: false,
          msg:
            error instanceof Error ? error.message : "Unknown error occurred",
          data: null,
        };
      }
    }
  );

  // Clear chat history
  ipcMain.handle(
    AI_CHAT_CLEAR,
    async (event, data: unknown): Promise<CommonMessage<void>> => {
      try {
        const requestData = data ? JSON.parse(data as string) : {};
        const conversationId = requestData.conversationId;

        const chatModule = new AIChatModule();
        console.log("conversationId", conversationId);
        if (conversationId === "all") {
          // Clear all conversations from database
          await chatModule.clearAllHistory();
        } else {
          // Clear specific conversation from database
          await chatModule.clearConversation(conversationId);
        }

        const response: CommonMessage<void> = {
          status: true,
          msg: "Chat history cleared successfully",
        };
        return response;
      } catch (error) {
        console.error("AI Chat clear error:", error);
        const errorResponse: CommonMessage<void> = {
          status: false,
          msg:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
        return errorResponse;
      }
    }
  );

  // Get all conversations with metadata
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ipcMain.handle(
    AI_CHAT_CONVERSATIONS,
    async (
      event,
      data: unknown
    ): Promise<
      CommonMessage<Array<{
        conversationId: string;
        lastMessage: string;
        lastMessageTimestamp: Date;
        messageCount: number;
        createdAt: Date;
      }> | null>
    > => {
      try {
        const chatModule = new AIChatModule();
        const conversations = await chatModule.getConversationsWithMetadata();

        const response: CommonMessage<
          Array<{
            conversationId: string;
            lastMessage: string;
            lastMessageTimestamp: Date;
            messageCount: number;
            createdAt: Date;
          }>
        > = {
          status: true,
          msg: "Conversations retrieved successfully",
          data: conversations,
        };
        return response;
      } catch (error) {
        console.error("AI Chat conversations error:", error);
        const errorResponse: CommonMessage<null> = {
          status: false,
          msg:
            error instanceof Error ? error.message : "Unknown error occurred",
          data: null,
        };
        return errorResponse;
      }
    }
  );

  // Generate keywords using AI
  ipcMain.handle(
    AI_KEYWORDS_GENERATE,
    async (event, data: unknown): Promise<CommonMessage<string[] | null>> => {
      try {
        // Check AI enable first
        const tokenService = new Token();
        const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
        if (aiEnabled !== "true") {
          return {
            status: false,
            msg: "AI features are not enabled. Please upgrade your plan to access AI features.",
            data: null,
          };
        }

        const requestData = data ? JSON.parse(data as string) : {};
        const seedKeywords: string[] = requestData.keywords || [];
        const numKeywords: number = requestData.num_keywords || 15;
        const keywordType: string = requestData.keyword_type || "seo";

        if (!seedKeywords || seedKeywords.length === 0) {
          return {
            status: false,
            msg: "Seed keywords are required",
            data: null,
          };
        }

        const aiChatApi = new AiChatApi();

        // Prepare batch request - one request per seed keyword
        const batchRequests: BatchKeywordGenerationRequestItem[] =
          seedKeywords.map((seedKeyword) => ({
            seed_keywords: [seedKeyword],
            config: {
              num_keywords: numKeywords,
              keyword_type: keywordType,
            },
          }));

        // Call the batch generate API
        const apiResponse = await aiChatApi.batchGenerateKeywords(
          batchRequests
        );

        if (apiResponse.status && apiResponse.data) {
          // Extract keywords from the response structure
          // apiResponse.data.keywords is an array of KeywordItem objects with category and keyword
          // Each KeywordItem has: { category: string, keyword: string }
          const keywordItems = apiResponse.data.keywords || [];
          const allKeywords: string[] = keywordItems.map(
            (item) => item.keyword
          );

          // Remove duplicates and return
          const uniqueKeywords = Array.from(new Set(allKeywords));

          return {
            status: true,
            msg: apiResponse.msg || "Keywords generated successfully",
            data: uniqueKeywords,
          };
        } else {
          return {
            status: false,
            msg: apiResponse.msg || "Failed to generate keywords",
            data: null,
          };
        }
      } catch (error) {
        console.error("AI Keywords generation error:", error);
        const errorResponse: CommonMessage<null> = {
          status: false,
          msg:
            error instanceof Error ? error.message : "Unknown error occurred",
          data: null,
        };
        return errorResponse;
      }
    }
  );
}
