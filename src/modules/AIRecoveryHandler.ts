import { AiChatApi } from '@/api/aiChatApi';
import { AIRecoveryRequest, AIRecoveryResponse, AIRecoveryAction } from '@/entityTypes/processMessage-type';
import { createLogger } from '@/utils/logger';

const logger = createLogger('AIRecoveryHandler');

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

interface TelemetryData {
    totalAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    rateLimitedRequests: number;
    averageConfidence: number;
    operationBreakdown: Map<string, {
        attempts: number;
        successes: number;
        failures: number;
        avgConfidence: number;
    }>;
}

export class AIRecoveryHandler {
    private aiChatApi: AiChatApi;
    private rateLimitMap: Map<string, RateLimitEntry> = new Map();
    private costTracker: Map<string, number> = new Map(); // Track costs by date
    private telemetry: TelemetryData;

    constructor(
        private config: {
            model?: string;
            rateLimitWindow?: number;
            rateLimitMax?: number;
        } = {}
    ) {
        this.aiChatApi = new AiChatApi();
        // Set defaults
        this.config.model = config.model || 'gpt-4o-mini';
        this.config.rateLimitWindow = config.rateLimitWindow || 60000; // 1 minute
        this.config.rateLimitMax = config.rateLimitMax || 10;

        // Initialize telemetry
        this.telemetry = {
            totalAttempts: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            rateLimitedRequests: 0,
            averageConfidence: 0,
            operationBreakdown: new Map()
        };
    }

    /**
     * Process an AI recovery request by calling the remote AI server
     */
    async handleRecoveryRequest(request: AIRecoveryRequest): Promise<AIRecoveryResponse> {
        const key = `${request.searchEngine}:${request.operation}`;

        // Track total attempts
        this.telemetry.totalAttempts++;
        this.trackOperationAttempt(request.operation);

        // Check rate limits
        if (!this.checkRateLimit(key)) {
            logger.warn(`Rate limit exceeded for ${key}`);
            this.telemetry.rateLimitedRequests++;
            this.trackOperationResult(request.operation, false, 0, 'rate_limited');
            return {
                requestId: request.requestId,
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Rate limit exceeded. Too many recovery attempts. Please try again later.',
                error: 'Rate limit exceeded'
            };
        }

        logger.info(`Processing recovery request ${request.requestId} for operation: ${request.operation} on ${request.searchEngine}`);
        logger.info(`Error: ${this.sanitizeError(request.errorMessage)}`);
        logger.debug(`Attempted selectors: ${request.attemptedSelectors.join(', ')}`);
        if (request.screenshot) {
            logger.debug('Sending screenshot with recovery request for AI reference');
        }

        try {
            // Call the AI server's dedicated Puppeteer recovery API (includes screenshot when provided)
            const response = await this.aiChatApi.sendPuppeteerRecovery(request);

            if (!response.status || !response.data) {
                logger.error(`Recovery API call failed for request ${request.requestId}: ${response.msg || 'Unknown error'}`);
                this.telemetry.failedRecoveries++;
                this.trackOperationResult(request.operation, false, 0, 'api_failure');
                return {
                    requestId: request.requestId,
                    success: false,
                    actions: [],
                    confidence: 0,
                    reasoning: 'Recovery API call failed',
                    error: response.msg || 'Unknown error'
                };
            }

            const apiData = response.data;
            const actions = this.mapApiActionsToRecoveryActions(apiData.actions);

            if (apiData.success) {
                logger.info(`Recovery API returned ${actions.length} actions (confidence: ${apiData.confidence})`);
                this.telemetry.successfulRecoveries++;
                this.updateAverageConfidence(apiData.confidence);
                this.trackOperationResult(request.operation, true, apiData.confidence, 'success');
            } else {
                logger.warn(`Recovery API reported no viable strategy: ${apiData.reasoning}`);
                this.telemetry.failedRecoveries++;
                this.trackOperationResult(request.operation, false, apiData.confidence, 'parse_failure');
            }

            return {
                requestId: apiData.request_id,
                success: apiData.success,
                actions,
                confidence: Math.min(1, Math.max(0, apiData.confidence)),
                reasoning: apiData.reasoning,
                error: apiData.error
            };

        } catch (error) {
            logger.error(`Exception processing request ${request.requestId}:`, error);
            this.telemetry.failedRecoveries++;
            this.trackOperationResult(request.operation, false, 0, 'exception');
            return {
                requestId: request.requestId,
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Exception during AI recovery',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Check if request is within rate limits
     */
    private checkRateLimit(key: string): boolean {
        const now = Date.now();
        const window = this.config.rateLimitWindow || 60000;
        const max = this.config.rateLimitMax || 10;

        let entry = this.rateLimitMap.get(key);

        // Reset if window expired
        if (!entry || (now - entry.windowStart) > window) {
            entry = { count: 1, windowStart: now };
            this.rateLimitMap.set(key, entry);
            return true;
        }

        // Check limit
        if (entry.count >= max) {
            return false;
        }

        entry.count++;
        return true;
    }

    /**
     * Sanitize error messages to prevent information leakage
     */
    private sanitizeError(errorMessage: string): string {
        // Remove file paths, internal function names, and stack traces
        return errorMessage
            .replace(/at .* \(.*:\d+:\d+\)/g, 'at internal function')
            .replace(/\/[^\s]*\/[^\s]*/g, '[path]')
            .replace(/Error: /g, '')
            .substring(0, 200); // Limit length
    }

    /**
     * Map API response actions (snake_case) to AIRecoveryAction (camelCase).
     */
    private mapApiActionsToRecoveryActions(
        actions: Array<{ type: string; selector?: string; selector_type?: string; value?: string; key?: string; timeout?: number; reason: string }>
    ): AIRecoveryAction[] {
        const mapped = actions.map((a) => ({
            type: a.type as AIRecoveryAction['type'],
            selector: a.selector,
            selectorType: (a.selector_type ?? 'css') as 'css' | 'xpath',
            value: a.value,
            key: a.key,
            timeout: a.timeout,
            reason: a.reason || 'No reason provided'
        }));
        return this.validateActions(mapped);
    }

    private validateActions(actions: unknown[]): AIRecoveryAction[] {
        const validTypes = ['click', 'type', 'focus', 'waitForSelector', 'pressKey', 'scroll', 'evaluate'];

        return actions
            .filter((a): a is AIRecoveryAction => {
                if (typeof a !== 'object' || a === null) return false;
                const action = a as Record<string, unknown>;
                return typeof action.type === 'string' && validTypes.includes(action.type);
            })
            .slice(0, 5); // Maximum 5 actions
    }

    /**
     * Track an operation attempt
     */
    private trackOperationAttempt(operation: string): void {
        let opData = this.telemetry.operationBreakdown.get(operation);

        if (!opData) {
            opData = {
                attempts: 0,
                successes: 0,
                failures: 0,
                avgConfidence: 0
            };
            this.telemetry.operationBreakdown.set(operation, opData);
        }

        opData.attempts++;
    }

    /**
     * Track operation result
     */
    private trackOperationResult(
        operation: string,
        success: boolean,
        confidence: number,
        _failureReason: string
    ): void {
        const opData = this.telemetry.operationBreakdown.get(operation);
        if (!opData) return;

        if (success) {
            opData.successes++;
            // Update running average for this operation
            opData.avgConfidence = (opData.avgConfidence * (opData.successes - 1) + confidence) / opData.successes;
        } else {
            opData.failures++;
        }
    }

    /**
     * Update global average confidence
     */
    private updateAverageConfidence(confidence: number): void {
        const totalSuccesses = this.telemetry.successfulRecoveries;
        this.telemetry.averageConfidence =
            (this.telemetry.averageConfidence * (totalSuccesses - 1) + confidence) / totalSuccesses;
    }

    /**
     * Get current telemetry data
     * Returns a snapshot of the AI recovery effectiveness metrics
     */
    public getTelemetry(): {
        totalAttempts: number;
        successfulRecoveries: number;
        failedRecoveries: number;
        rateLimitedRequests: number;
        successRate: number;
        averageConfidence: number;
        operationBreakdown: Record<string, {
            attempts: number;
            successes: number;
            failures: number;
            successRate: number;
            avgConfidence: number;
        }>;
    } {
        const operationBreakdown: Record<string, {
            attempts: number;
            successes: number;
            failures: number;
            successRate: number;
            avgConfidence: number;
        }> = {};

        // Convert Map to plain object and calculate success rates
        for (const [operation, data] of this.telemetry.operationBreakdown.entries()) {
            operationBreakdown[operation] = {
                ...data,
                successRate: data.attempts > 0 ? data.successes / data.attempts : 0
            };
        }

        const totalRecoveries = this.telemetry.successfulRecoveries + this.telemetry.failedRecoveries;

        return {
            totalAttempts: this.telemetry.totalAttempts,
            successfulRecoveries: this.telemetry.successfulRecoveries,
            failedRecoveries: this.telemetry.failedRecoveries,
            rateLimitedRequests: this.telemetry.rateLimitedRequests,
            successRate: totalRecoveries > 0 ? this.telemetry.successfulRecoveries / totalRecoveries : 0,
            averageConfidence: this.telemetry.averageConfidence,
            operationBreakdown
        };
    }

    /**
     * Reset telemetry data
     * Useful for testing or starting fresh measurements
     */
    public resetTelemetry(): void {
        this.telemetry = {
            totalAttempts: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            rateLimitedRequests: 0,
            averageConfidence: 0,
            operationBreakdown: new Map()
        };
        logger.info('Telemetry data has been reset');
    }
}
