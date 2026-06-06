/**
 * Bridge for email scraper child process to request AI enrichment.
 * Sends EMAIL_AI_ENRICHMENT_REQUEST and waits for EMAIL_AI_ENRICHMENT_RESPONSE.
 */

import type {
  EmailAiRequest,
  EmailAiResponse,
} from "@/modules/EmailAiEnrichmentHandler";

const REQUEST_TIMEOUT_MS = 60_000;

interface PendingRequest {
  resolve: (response: EmailAiResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class AiSupportBridge {
  private pendingRequests = new Map<string, PendingRequest>();

  /**
   * Handle incoming EMAIL_AI_ENRICHMENT_RESPONSE from main process.
   */
  handleResponse(message: EmailAiResponse): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      console.warn(
        `AiSupportBridge: received response for unknown requestId: ${message.requestId}`
      );
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);
    pending.resolve(message);
  }

  /**
   * Send EMAIL_AI_ENRICHMENT_REQUEST and wait for response.
   */
  requestEnrichment(
    postMessage: (msg: string) => void,
    url: string,
    pageContent: string,
    pageTitle: string
  ): Promise<EmailAiResponse> {
    const requestId = `email-ai-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const request: EmailAiRequest = {
      type: "EMAIL_AI_ENRICHMENT_REQUEST",
      requestId,
      url,
      pageContent,
      pageTitle,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`AI enrichment request timed out: ${requestId}`));
        }
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      postMessage(JSON.stringify(request));
    });
  }

  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  clearPendingRequests(): void {
    this.pendingRequests.forEach((req) => clearTimeout(req.timeout));
    this.pendingRequests.clear();
  }
}
