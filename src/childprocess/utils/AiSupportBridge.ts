/**
 * Bridge for search child processes to send AI_SUPPORT_REQUEST and receive AI_SUPPORT_RESPONSE.
 * Same message contract as YellowPages (type-based); used by search scrapers for observe-execute.
 *
 * Converted to class-based implementation for better testability and state management.
 */

import type {
  AiSupportRequestMessage,
  AiSupportResponseMessage,
} from "@/modules/interface/BackgroundProcessMessages";
import type { ParentPort } from "@/childprocess/worker";
import { createLogger } from "./logger";
import { AI_RECOVERY_CONFIG } from "@/config/aiRecoveryConfig";

const logger = createLogger("AiSupportBridge");

interface PendingRequest {
  resolve: (response: AiSupportResponseMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Bridge for AI support requests between worker and main process.
 * Manages pending requests with proper timeout handling and state reset capability.
 */
export class AiSupportBridge {
  private pendingRequests = new Map<string, PendingRequest>();

  /**
   * Handle incoming AI_SUPPORT_RESPONSE from main process.
   * Call from the child's message handler when message.type === 'AI_SUPPORT_RESPONSE'.
   */
  handleAiSupportResponse(message: AiSupportResponseMessage): void {
    const requestId = message.requestId;
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      logger.warn(
        "Received AI_SUPPORT_RESPONSE for unknown requestId: %s",
        requestId
      );
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(requestId);
    pending.resolve(message);
  }

  /**
   * Send AI_SUPPORT_REQUEST to main process and wait for AI_SUPPORT_RESPONSE.
   * Used by search scrapers for observe-execute; message must include type "AI_SUPPORT_REQUEST" and all required fields.
   */
  requestAiSupport(
    parentPort: ParentPort,
    message: AiSupportRequestMessage
  ): Promise<AiSupportResponseMessage> {
    const requestId = message.requestId;
    logger.info(
      "Sending AI_SUPPORT_REQUEST id=%s requestType=%s",
      requestId,
      message.requestType
    );

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          logger.error(
            "AI support request %s timed out after %d ms",
            requestId,
            AI_RECOVERY_CONFIG.SUPPORT_REQUEST_TIMEOUT_MS
          );
          this.pendingRequests.delete(requestId);
          reject(new Error("AI support request timed out"));
        }
      }, AI_RECOVERY_CONFIG.SUPPORT_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      parentPort.postMessage(JSON.stringify(message));
    });
  }

  /**
   * Get the count of pending requests
   * Useful for debugging and monitoring
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Clear all pending requests
   * Useful for testing or cleanup
   */
  clearPendingRequests(): void {
    this.pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
    });
    this.pendingRequests.clear();
    logger.info("All pending AI support requests have been cleared");
  }

  /**
   * Check if a specific request ID is pending
   * Useful for debugging duplicate requests
   */
  hasPendingRequest(requestId: string): boolean {
    return this.pendingRequests.has(requestId);
  }
}

// Export singleton instance for backward compatibility
// Applications can create new instances for testing if needed
let _singletonInstance: AiSupportBridge | null = null;

/**
 * Get or create the singleton AiSupportBridge instance
 * Maintains backward compatibility with the previous module-level function approach.
 */
export function getAiSupportBridge(): AiSupportBridge {
  if (!_singletonInstance) {
    _singletonInstance = new AiSupportBridge();
  }
  return _singletonInstance;
}

/**
 * Reset the singleton instance
 * Useful for testing to ensure clean state
 */
export function resetAiSupportBridge(): void {
  if (_singletonInstance) {
    _singletonInstance.clearPendingRequests();
  }
  _singletonInstance = null;
}

// Convenience functions using singleton for backward compatibility
/**
 * Legacy wrapper for handleAiSupportResponse
 * @deprecated Use getAiSupportBridge().handleAiSupportResponse() instead
 */
export function handleAiSupportResponse(
  message: AiSupportResponseMessage
): void {
  getAiSupportBridge().handleAiSupportResponse(message);
}

/**
 * Legacy wrapper for requestAiSupport
 * @deprecated Use getAiSupportBridge().requestAiSupport() instead
 */
export function requestAiSupport(
  parentPort: ParentPort,
  message: AiSupportRequestMessage
): Promise<AiSupportResponseMessage> {
  return getAiSupportBridge().requestAiSupport(parentPort, message);
}
