/**
 * Tests for AIRecoveryBridge
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    requestAIRecovery,
    handleAIRecoveryResponse,
    ParentPort
} from '@/childprocess/utils/AIRecoveryBridge';
import { AIRecoveryResponse } from '@/entityTypes/processMessage-type';

describe('AIRecoveryBridge', () => {
    let mockPostMessage: ReturnType<typeof vi.fn>;
    let mockParentPort: ParentPort;

    beforeEach(() => {
        mockPostMessage = vi.fn();
        mockParentPort = {
            postMessage: mockPostMessage,
            on: vi.fn()
        };
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('requestAIRecovery', () => {
        it('should send recovery request to parent port', async () => {
            const request = {
                requestId: 'test-request-id',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://example.com',
                pageTitle: 'Test Page',
                errorMessage: 'Element not found',
                attemptedSelectors: ['.selector1', '.selector2'],
                htmlSample: '<html>...</html>'
            };

            const promise = requestAIRecovery(mockParentPort, request);

            expect(mockPostMessage).toHaveBeenCalledTimes(1);
            const messageArg = mockPostMessage.mock.calls[0][0];
            const parsedMessage = JSON.parse(messageArg);

            expect(parsedMessage.action).toBe('requestAIRecovery');
            expect(parsedMessage.data.requestId).toBe('test-request-id');

            // Clean up - handle the pending request
            const response: AIRecoveryResponse = {
                requestId: 'test-request-id',
                success: false,
                actions: [],
                confidence: 0,
                reasoning: 'Test cleanup'
            };
            handleAIRecoveryResponse(response);

            await promise.catch(() => {
                // Expected to fail due to cleanup response
            });
        });

        it('should timeout after 30 seconds', async () => {
            vi.useFakeTimers();

            const request = {
                requestId: 'timeout-test',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://example.com',
                pageTitle: 'Test',
                errorMessage: 'Test',
                attemptedSelectors: ['.test'],
                htmlSample: '<html></html>'
            };

            const promise = requestAIRecovery(mockParentPort, request);

            // Fast-forward 30 seconds
            vi.advanceTimersByTime(30000);

            await expect(promise).rejects.toThrow('AI recovery request timed out');

            vi.useRealTimers();
        });
    });

    describe('handleAIRecoveryResponse', () => {
        it('should resolve pending request when response is received', async () => {
            const request = {
                requestId: 'pending-test',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://example.com',
                pageTitle: 'Test',
                errorMessage: 'Test',
                attemptedSelectors: ['.test'],
                htmlSample: '<html></html>'
            };

            const promise = requestAIRecovery(mockParentPort, request);

            const response: AIRecoveryResponse = {
                requestId: 'pending-test',
                success: true,
                actions: [
                    {
                        type: 'click',
                        selector: '.button',
                        reason: 'Click the button'
                    }
                ],
                confidence: 0.9,
                reasoning: 'Found the button'
            };

            handleAIRecoveryResponse(response);

            const result = await promise;
            expect(result.success).toBe(true);
            expect(result.actions).toHaveLength(1);
            expect(result.actions[0].type).toBe('click');
        });

        it('should handle unknown request IDs gracefully', () => {
            const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
                // Intentionally empty - we just want to suppress console output
            });

            const response: AIRecoveryResponse = {
                requestId: 'unknown-id',
                success: true,
                actions: [],
                confidence: 0,
                reasoning: 'Test'
            };

            handleAIRecoveryResponse(response);

            expect(consoleWarnSpy).toHaveBeenCalledWith(
                expect.stringContaining('Received response for unknown request')
            );

            consoleWarnSpy.mockRestore();
        });

        it('should clear timeout when response is received', async () => {
            vi.useFakeTimers();

            const request = {
                requestId: 'clear-timeout-test',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://example.com',
                pageTitle: 'Test',
                errorMessage: 'Test',
                attemptedSelectors: ['.test'],
                htmlSample: '<html></html>'
            };

            const promise = requestAIRecovery(mockParentPort, request);

            const response: AIRecoveryResponse = {
                requestId: 'clear-timeout-test',
                success: true,
                actions: [],
                confidence: 0,
                reasoning: 'Test'
            };

            handleAIRecoveryResponse(response);

            // Fast-forward past the timeout - should not trigger because response was handled
            vi.advanceTimersByTime(30000);

            await expect(promise).resolves.toBeDefined();

            vi.useRealTimers();
        });
    });
});
