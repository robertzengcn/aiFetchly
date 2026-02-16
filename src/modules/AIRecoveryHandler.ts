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

        try {
            // Build the prompt for the AI
            const prompt = this.buildRecoveryPrompt(request);
            logger.debug(`Built prompt (${prompt.length} chars), calling AI API with model: ${this.config.model}...`);

            // Call AI chat API with structured prompt
            const response = await this.aiChatApi.sendMessage({
                message: prompt,
                systemPrompt: this.getSystemPrompt(request.operation),
                model: this.config.model || 'gpt-4o-mini'
            });

            if (!response.status || !response.data) {
                logger.error(`API call failed for request ${request.requestId}: ${response.msg || 'Unknown error'}`);
                this.telemetry.failedRecoveries++;
                this.trackOperationResult(request.operation, false, 0, 'api_failure');
                return {
                    requestId: request.requestId,
                    success: false,
                    actions: [],
                    confidence: 0,
                    reasoning: 'AI API call failed',
                    error: response.msg || 'Unknown error'
                };
            }

            logger.debug(`Received AI response for request ${request.requestId}, parsing...`);

            // Parse the AI response into recovery actions
            const parsedResponse = this.parseAIResponse(request.requestId, response.data.message);

            if (parsedResponse.success) {
                logger.info(`Successfully parsed ${parsedResponse.actions.length} recovery actions (confidence: ${parsedResponse.confidence})`);
                this.telemetry.successfulRecoveries++;
                this.updateAverageConfidence(parsedResponse.confidence);
                this.trackOperationResult(request.operation, true, parsedResponse.confidence, 'success');
            } else {
                logger.warn(`Failed to parse AI response: ${parsedResponse.reasoning}`);
                this.telemetry.failedRecoveries++;
                this.trackOperationResult(request.operation, false, parsedResponse.confidence, 'parse_failure');
            }

            return parsedResponse;

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

    private getSystemPrompt(operation: string): string {
        return `You are a Puppeteer automation expert helping recover from web scraping failures.

TASK: Analyze the page state and suggest Puppeteer actions to complete the "${operation}" operation.

RESPONSE FORMAT: Return ONLY valid JSON in this exact format:
{
  "success": true,
  "actions": [
    {
      "type": "waitForSelector|click|type|focus|pressKey|scroll",
      "selector": "CSS selector",
      "selectorType": "css",
      "value": "text to type (for type action)",
      "key": "Enter (for pressKey action)",
      "timeout": 5000,
      "reason": "Brief explanation"
    }
  ],
  "confidence": 0.85,
  "reasoning": "Overall explanation of the recovery strategy"
}

RULES:
1. Only use safe operations: click, type, focus, waitForSelector, pressKey, scroll
2. Prefer CSS selectors over XPath
3. Consider aria-label, role, and data-* attributes
4. Maximum 5 actions per recovery attempt
5. Include waits before interactions
6. If no reliable solution, set success: false`;
    }

    private buildRecoveryPrompt(request: AIRecoveryRequest): string {
        let prompt = `FAILED OPERATION: ${request.operation}
SEARCH ENGINE: ${request.searchEngine}
CURRENT URL: ${request.currentUrl}
PAGE TITLE: ${request.pageTitle}
ERROR: ${this.sanitizeError(request.errorMessage)}
ATTEMPTED SELECTORS: ${request.attemptedSelectors.join(', ')}

HTML SAMPLE:
\`\`\`html
${request.htmlSample}
\`\`\`
`;

        if (request.accessibilityTree) {
            prompt += `\nACCESSIBILITY TREE (truncated):
\`\`\`json
${request.accessibilityTree}
\`\`\`
`;
        }

        if (request.keyword) {
            prompt += `\nCURRENT KEYWORD: ${request.keyword}\n`;
        }

        prompt += `\nPlease analyze and provide recovery actions.`;

        return prompt;
    }

    private parseAIResponse(requestId: string, aiMessage: string): AIRecoveryResponse {
        try {
            // Try multiple strategies to extract valid JSON
            let jsonStr: string | null = null;

            // Strategy 1: Try to find JSON code blocks
            const codeBlockMatch = aiMessage.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch && codeBlockMatch[1]) {
                jsonStr = codeBlockMatch[1];
            }

            // Strategy 2: Try to find first valid JSON object
            if (!jsonStr) {
                // Find the first { and matching }
                const startIdx = aiMessage.indexOf('{');
                if (startIdx !== -1) {
                    let braceCount = 0;
                    let endIdx = startIdx;
                    for (let i = startIdx; i < aiMessage.length; i++) {
                        if (aiMessage[i] === '{') braceCount++;
                        if (aiMessage[i] === '}') braceCount--;
                        if (braceCount === 0) {
                            endIdx = i + 1;
                            break;
                        }
                    }
                    const candidate = aiMessage.substring(startIdx, endIdx);
                    // Validate it's parseable
                    try {
                        JSON.parse(candidate);
                        jsonStr = candidate;
                    } catch {
                        // Continue to next strategy
                    }
                }
            }

            // Strategy 3: Use regex as fallback (least reliable)
            if (!jsonStr) {
                const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                }
            }

            if (!jsonStr) {
                throw new Error('No valid JSON found in AI response');
            }

            const parsed = JSON.parse(jsonStr);

            // Validate response structure
            if (typeof parsed !== 'object' || parsed === null) {
                throw new Error('Parsed response is not an object');
            }

            return {
                requestId,
                success: parsed.success ?? false,
                actions: this.validateActions(parsed.actions || []),
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0)),
                reasoning: parsed.reasoning || 'No reasoning provided'
            };

        } catch (error) {
            console.error('Failed to parse AI response:', error);
            return {
                requestId,
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Failed to parse AI response',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private validateActions(actions: unknown[]): AIRecoveryAction[] {
        const validTypes = ['click', 'type', 'focus', 'waitForSelector', 'pressKey', 'scroll'];

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
