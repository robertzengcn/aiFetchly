/**
 * AI Email Template IPC Handler
 *
 * Handles IPC communication for AI-powered email template generation.
 * Enforces AI feature access control, integrates RAG for context,
 * and streams real-time generation results.
 *
 * @module main-process/communication/ai-email-template-ipc
 */

import { ipcMain } from "electron";

// IpcMainEvent type is not exported from electron, so we define it locally
type IpcMainEvent = {
  sender: {
    send: (channel: string, ...args: unknown[]) => void;
  };
};

// Extended IpcMain interface for methods not exposed in type definitions
interface IpcMainExtended {
  on: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (
    channel: string,
    listener: (...args: unknown[]) => void
  ) => void;
}

import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { RagSearchModule } from "@/modules/RagSearchModule";
import { AiChatApi } from "@/api/aiChatApi";
import {
  AI_EMAIL_TEMPLATE_GENERATE_STREAM,
  AI_EMAIL_TEMPLATE_GENERATE_CHUNK,
  AI_EMAIL_TEMPLATE_GENERATE_COMPLETE,
  AI_EMAIL_TEMPLATE_ERROR,
  AI_EMAIL_TEMPLATE_STOP,
  AI_EMAIL_TEMPLATE_VALIDATE,
} from "@/config/channellist";
import {
  AIEmailTemplateRequest,
  AIEmailTemplateResponse,
} from "@/entityTypes/emailmarketingType";
import {
  validateAIRequest,
  validateAIOutputVariables,
  parseEmailTemplateFromStream,
  extractVariables,
} from "@/views/utils/variableValidation";

/**
 * System prompt for AI email template generation
 */
const EMAIL_TEMPLATE_SYSTEM_PROMPT = `
You are an expert email marketing copywriter. Generate professional email templates based on user descriptions.

CRITICAL RULES:
1. Use ONLY these template variables (exactly as shown):
   - {$send_time} - Current timestamp
   - {$sender} - Sender email/name
   - {$receiver_email} - Recipient email address
   - {$receiver_name} - Recipient's first name for personalization
   - {$url} - Source URL or landing page
   - {$description} - Contextual description
   - {$company_name} - Recipient's company name
   - {$campaign_name} - Campaign reference name

2. NEVER invent new variable names like {$first_name} or {$date}
3. Output format:
   Subject: [email subject line]

   [email body content]

4. Keep emails concise (150-300 words)
5. Use professional formatting (short paragraphs, clear CTAs)
`;

/**
 * Register AI email template IPC handlers
 */
export function registerAIEmailTemplateHandlers(): void {
  console.log("AI Email Template IPC handlers registered");

  // Streaming generation handler
  ipcMain.on(AI_EMAIL_TEMPLATE_GENERATE_STREAM, async (...args: unknown[]) => {
    const [event, requestData] = args as [IpcMainEvent, AIEmailTemplateRequest];

    try {
      // 1. Check AI enable (MANDATORY - first check)
      const tokenService = new Token();
      const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
      if (!aiEnabled || aiEnabled === "false" || aiEnabled === "0") {
        event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
          type: "error",
          status: false,
          msg: "AI features are not enabled. Please upgrade your plan to access AI features.",
          data: null,
        });
        return;
      }

      // 2. Validate request
      const validation = validateAIRequest(requestData);
      if (!validation.isValid) {
        event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
          type: "error",
          status: false,
          msg: validation.errors?.join(", ") || "Invalid request",
          data: null,
        });
        return;
      }

      // 3. Initialize RAG if enabled
      let enhancedPrompt = requestData.prompt;
      if (requestData.useRAG) {
        const ragModule = new RagSearchModule();
        await ragModule.initialize();

        try {
          const searchResponse = await ragModule.search({
            query: `email template: ${requestData.prompt}`,
            options: { limit: requestData.ragLimit || 5 },
          });

          if (searchResponse.results.length > 0) {
            const ragContext = searchResponse.results
              .map((result, index) => {
                return `[Document ${index + 1}: ${result.document.name}]\n${
                  result.content
                }`;
              })
              .join("\n\n");
            enhancedPrompt = `Based on:\n${ragContext}\n\n---\n\n${requestData.prompt}`;
            console.log(
              `RAG search found ${searchResponse.results.length} relevant documents`
            );
          }
        } catch (ragError) {
          console.error(
            "RAG search failed, proceeding without RAG context:",
            ragError
          );
          // Continue without RAG context
        }
      }

      // Build system prompt with tone and type
      const systemPrompt = `${EMAIL_TEMPLATE_SYSTEM_PROMPT}

Tone: ${requestData.tone}
Email Type: ${requestData.templateType}
`;

      // 4. Stream generation
      const aiChatApi = new AiChatApi();
      let fullContent = "";
      let isStopped = false;

      // Stop handler - using on with a flag for single execution
      const stopHandler = (): void => {
        isStopped = true;
        console.log("AI email template generation stopped by user");
      };

      // Register stop handler for this generation
      (ipcMain as IpcMainExtended).on(AI_EMAIL_TEMPLATE_STOP, stopHandler);

      try {
        await aiChatApi.streamMessage(
          {
            message: enhancedPrompt,
            systemPrompt,
            useRAG: requestData.useRAG || false,
          },
          (streamEvent) => {
            if (isStopped) return;

            // Handle token events (content chunks)
            if (
              streamEvent.event === "token" &&
              typeof streamEvent.data.content === "string"
            ) {
              const chunk = streamEvent.data.content;
              fullContent += chunk;
              event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, {
                type: "chunk",
                content: chunk,
                fullContent: fullContent,
              });
            }
            // Handle done event (completion)
            else if (streamEvent.event === "done") {
              // Parse and validate result
              const { title, content } =
                parseEmailTemplateFromStream(fullContent);
              const validationResult = validateAIOutputVariables(content);
              const variablesUsed = extractVariables(
                validationResult.sanitizedContent || content
              );

              const responseData: AIEmailTemplateResponse = {
                title,
                content: validationResult.sanitizedContent || content,
                variablesUsed,
                hasInvalidVariables: !validationResult.isValid,
                invalidVariables: validationResult.invalidVariables || [],
                status: validationResult.isValid ? "success" : "partial",
              };

              event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_COMPLETE, {
                type: "complete",
                status: true,
                data: responseData,
              });

              // Clean up stop handler
              (ipcMain as IpcMainExtended).removeListener(
                AI_EMAIL_TEMPLATE_STOP,
                stopHandler
              );
            }
            // Handle error events
            else if (streamEvent.event === "error") {
              const errorMsg =
                typeof streamEvent.data.content === "string"
                  ? streamEvent.data.content
                  : "Generation failed";
              event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
                type: "error",
                status: false,
                msg: errorMsg,
                data: null,
              });

              // Clean up stop handler
              (ipcMain as IpcMainExtended).removeListener(
                AI_EMAIL_TEMPLATE_STOP,
                stopHandler
              );
            }
          }
        );
      } catch (streamError) {
        // Clean up stop handler on stream error
        (ipcMain as IpcMainExtended).removeListener(AI_EMAIL_TEMPLATE_STOP, stopHandler);
        throw streamError;
      }
    } catch (error) {
      console.error("AI email template generation error:", error);
      event.sender.send(AI_EMAIL_TEMPLATE_ERROR, {
        type: "error",
        status: false,
        msg: error instanceof Error ? error.message : "Generation failed",
        data: null,
      });
    }
  });

  // Validation handler
  ipcMain.handle(AI_EMAIL_TEMPLATE_VALIDATE, async (...args: unknown[]) => {
    const requestData = args[1] as { title: string; content: string };

    const contentValidation = validateAIOutputVariables(requestData.content);
    const titleValidation = validateAIOutputVariables(requestData.title);

    const hasInvalid = !contentValidation.isValid || !titleValidation.isValid;
    const allInvalidVars = [
      ...(contentValidation.invalidVariables || []),
      ...(titleValidation.invalidVariables || []),
    ];

    return {
      status: !hasInvalid,
      data: {
        isValid: !hasInvalid,
        invalidVariables: allInvalidVars,
        sanitizedContent: contentValidation.sanitizedContent,
        sanitizedTitle: titleValidation.sanitizedContent,
      },
      msg: hasInvalid ? "Invalid variables found" : "Validation passed",
    };
  });
}
