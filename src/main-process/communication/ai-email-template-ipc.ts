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
import { registerValidatedHandler } from "@/main-process/communication/_shared/registerValidatedHandler";
import { aiEmailTemplateValidateInputSchema } from "@/schemas/ipc/aiEmailTemplate";

/** Strip trailing OpenAI-style sentinel JSON (e.g. {"choices":[{"delta":{},"finish_reason":"STOP"}]}) from stream content. */
function stripTrailingSentinelJson(content: string): string {
  const trimmed = content.trimEnd();
  const lastBrace = trimmed.lastIndexOf("{");
  if (lastBrace === -1) return content;
  const candidate = trimmed.slice(lastBrace);
  try {
    const parsed = JSON.parse(candidate) as {
      choices?: Array<{ finish_reason?: string }>;
    };
    if (parsed.choices?.[0]?.finish_reason != null) {
      return trimmed.slice(0, lastBrace).trimEnd();
    }
  } catch {
    // not valid JSON or not sentinel
  }
  return content;
}

/**
 * Normalize one streaming token payload into plain text content.
 * Ignores OpenAI-style bookkeeping JSON chunks that contain no text.
 */
export function normalizeEmailTemplateStreamChunk(raw: string): string {
  if (!raw.trim().startsWith("{")) {
    return raw;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> & {
      choices?: Array<{
        delta?: { content?: string; text?: string };
        finish_reason?: string | null;
      }>;
      content?: string;
    };
    const firstChoice = parsed.choices?.[0];
    const deltaContent =
      typeof firstChoice?.delta?.content === "string"
        ? firstChoice.delta.content
        : undefined;
    const deltaText =
      typeof firstChoice?.delta?.text === "string"
        ? firstChoice.delta.text
        : undefined;
    const topLevelContent =
      typeof parsed.content === "string" ? parsed.content : undefined;
    const isFinishSentinel = !!firstChoice?.finish_reason;

    if (deltaContent !== undefined) return deltaContent;
    if (deltaText !== undefined) return deltaText;
    if (topLevelContent !== undefined) return topLevelContent;
    if (isFinishSentinel) return "";

    // JSON chunk with no text payload (role / empty-delta chunk)
    return "";
  } catch {
    // Preserve backwards compatibility for unexpected non-JSON payloads.
    return raw;
  }
}

/**
 * Register AI email template IPC handlers.
 * Uses AiChatApi.streamEmailTemplateGeneration (dedicated email API in aiChatApi.ts), not generic chat.
 */
export function registerAIEmailTemplateHandlers(): void {
  console.log("AI Email Template IPC handlers registered");

  // Streaming generation handler
  ipcMain.on(AI_EMAIL_TEMPLATE_GENERATE_STREAM, async (...args: unknown[]) => {
    const [event, requestData] = args as [IpcMainEvent, AIEmailTemplateRequest];
    //console.log("AI Email Template Request Data:", requestData);
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

      // 4. Stream generation via dedicated email-template API (not generic chat)
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
        await aiChatApi.streamEmailTemplateGeneration(
          requestData,
          (streamEvent) => {
            if (isStopped) return;

            // Handle token events (content chunks)
            if (
              streamEvent.event === "token" &&
              typeof streamEvent.data.content === "string"
            ) {
              const chunk = normalizeEmailTemplateStreamChunk(
                streamEvent.data.content
              );
              fullContent += chunk;
              event.sender.send(AI_EMAIL_TEMPLATE_GENERATE_CHUNK, {
                type: "chunk",
                content: chunk,
                fullContent: fullContent,
              });
            }
            // Handle done event (completion)
            else if (streamEvent.event === "done") {
              // Strip any trailing sentinel JSON then parse
              const contentToParse = stripTrailingSentinelJson(fullContent);
              const { title, content } =
                parseEmailTemplateFromStream(contentToParse);
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
          },
          enhancedPrompt !== requestData.prompt
            ? { messageOverride: enhancedPrompt }
            : undefined
        );
      } catch (streamError) {
        // Clean up stop handler on stream error
        (ipcMain as IpcMainExtended).removeListener(
          AI_EMAIL_TEMPLATE_STOP,
          stopHandler
        );
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

  // Validation handler — local validation, no LLM call. Original code did
  // NOT check USER_AI_ENABLED here, so we use registerValidatedHandler
  // (not the AI variant) to preserve behavior.
  registerValidatedHandler(
    AI_EMAIL_TEMPLATE_VALIDATE,
    aiEmailTemplateValidateInputSchema,
    async (input) => {
      const contentValidation = validateAIOutputVariables(input.content);
      const titleValidation = validateAIOutputVariables(input.title);

      const hasInvalid = !contentValidation.isValid || !titleValidation.isValid;
      const allInvalidVars = [
        ...(contentValidation.invalidVariables || []),
        ...(titleValidation.invalidVariables || []),
      ];

      // Return the data payload; wrapper wraps in {status: true, msg: 'ok', data}.
      // Note: original returned `status: !hasInvalid` at the envelope level.
      // The wrapper always sets status:true on successful handler execution.
      // To preserve the original semantics where callers could distinguish
      // valid vs invalid via envelope.status, we surface that in `data.isValid`
      // (already present) — frontend should rely on data.isValid, not status.
      return {
        isValid: !hasInvalid,
        invalidVariables: allInvalidVars,
        sanitizedContent: contentValidation.sanitizedContent,
        sanitizedTitle: titleValidation.sanitizedContent,
        // Surface the human-readable message at the data level.
        msg: hasInvalid ? "Invalid variables found" : "Validation passed",
      };
    }
  );
}
