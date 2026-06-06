/**
 * Email AI Enrichment Handler
 *
 * Handles AI contact extraction requests from the email scraper child process.
 * Validates AI entitlement, calls the remote API, and sends results back.
 */

import { AiChatApi, ContactExtractionResponse } from "@/api/aiChatApi";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { WriteLog } from "@/modules/lib/function";

export interface EmailAiRequest {
  type: "EMAIL_AI_ENRICHMENT_REQUEST";
  requestId: string;
  url: string;
  pageContent: string;
  pageTitle: string;
}

export interface EmailAiResponse {
  type: "EMAIL_AI_ENRICHMENT_RESPONSE";
  requestId: string;
  success: boolean;
  phone?: string;
  address?: string;
  socialLinks?: string[];
  confidence?: number;
  errorMessage?: string;
}

export class EmailAiEnrichmentHandler {
  private aiApi: AiChatApi;
  private logFile?: string;

  constructor(logFile?: string) {
    this.aiApi = new AiChatApi();
    this.logFile = logFile;
  }

  async handleRequest(
    request: EmailAiRequest,
    sendResponse: (response: EmailAiResponse) => void
  ): Promise<void> {
    const { requestId, url, pageContent, pageTitle } = request;

    this.logInfo(`Processing email AI enrichment request: ${requestId}`);

    // Validate AI entitlement
    if (!this.isAiEnabled()) {
      this.logWarn(`AI not enabled for request: ${requestId}`);
      sendResponse({
        type: "EMAIL_AI_ENRICHMENT_RESPONSE",
        requestId,
        success: false,
        errorMessage: "AI support is not enabled for this user",
      });
      return;
    }

    try {
      const result = await this.aiApi.extractContactInfo(
        pageContent,
        url,
        pageTitle
      );

      if (result.status && result.data) {
        this.logInfo(`Contact extraction successful: ${requestId}`);
        const d = result.data;
        const socialLinks =
          d.socialLinks ??
          (Array.isArray(d.social_links) ? d.social_links : undefined);

        sendResponse({
          type: "EMAIL_AI_ENRICHMENT_RESPONSE",
          requestId,
          success: true,
          phone: d.phones && d.phones.length > 0 ? d.phones[0] : undefined,
          address: d.address,
          socialLinks,
          confidence: d.confidence,
        });
      } else {
        this.logWarn(
          `Contact extraction returned no data: ${requestId} - ${result.msg}`
        );
        sendResponse({
          type: "EMAIL_AI_ENRICHMENT_RESPONSE",
          requestId,
          success: false,
          errorMessage: result.msg || "Contact extraction returned no data",
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logError(`Contact extraction failed: ${requestId} - ${errorMsg}`);
      sendResponse({
        type: "EMAIL_AI_ENRICHMENT_RESPONSE",
        requestId,
        success: false,
        errorMessage: `AI request failed: ${errorMsg}`,
      });
    }
  }

  private isAiEnabled(): boolean {
    try {
      const tokenService = new Token();
      const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
      return aiEnabled === "true";
    } catch (error) {
      this.logError(`Failed to check AI status: ${error}`);
      return false;
    }
  }

  private logInfo(message: string): void {
    console.log(`[Email AI Handler] ${message}`);
    if (this.logFile) {
      WriteLog(this.logFile, `[INFO] ${message}`);
    }
  }

  private logWarn(message: string): void {
    console.warn(`[Email AI Handler] ${message}`);
    if (this.logFile) {
      WriteLog(this.logFile, `[WARN] ${message}`);
    }
  }

  private logError(message: string): void {
    console.error(`[Email AI Handler] ${message}`);
    if (this.logFile) {
      WriteLog(this.logFile, `[ERROR] ${message}`);
    }
  }
}
