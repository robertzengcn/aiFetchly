import { AIRecoveryRequest, AIRecoveryResponse } from '@/entityTypes/processMessage-type';
import { ProcessMessage } from '@/entityTypes/processMessage-type';
import { ParentPort } from '@/childprocess/worker';
import { createLogger } from './logger';

// Re-export ParentPort type for tests and other modules
export type { ParentPort };

const logger = createLogger('AIRecoveryBridge');

// Store pending recovery requests
const pendingRequests = new Map<string, {
    resolve: (response: AIRecoveryResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}>();

const AI_RECOVERY_TIMEOUT = 30000; // 30 seconds

/**
 * Handle incoming AI recovery response
 * Call this from the main message handler when action === 'aiRecoveryResponse'
 */
export function handleAIRecoveryResponse(response: AIRecoveryResponse): void {
    const pending = pendingRequests.get(response.requestId);
    if (pending) {
        logger.info(`Received response for request ${response.requestId}, success: ${response.success}`);
        clearTimeout(pending.timeout);
        pendingRequests.delete(response.requestId);
        pending.resolve(response);
    } else {
        logger.warn(`Received response for unknown request ${response.requestId}`);
    }
}

/**
 * Request AI recovery from the main process
 * Returns a Promise that resolves when the main process responds
 */
export function requestAIRecovery(
    parentPort: ParentPort,
    request: AIRecoveryRequest
): Promise<AIRecoveryResponse> {
    logger.info(`Sending recovery request ${request.requestId} to main process`);
    return new Promise((resolve, reject) => {
        // Set timeout
        const timeout = setTimeout(() => {
            logger.error(`Request ${request.requestId} timed out after ${AI_RECOVERY_TIMEOUT}ms`);
            pendingRequests.delete(request.requestId);
            reject(new Error('AI recovery request timed out'));
        }, AI_RECOVERY_TIMEOUT);

        // Store pending request
        pendingRequests.set(request.requestId, { resolve, reject, timeout });

        // Send request to main process
        const message: ProcessMessage<AIRecoveryRequest> = {
            action: 'requestAIRecovery',
            data: request
        };
        parentPort.postMessage(JSON.stringify(message));
    });
}
