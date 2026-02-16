/**
 * Tests for AIRecoveryHandler
 */
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { AIRecoveryHandler } from '@/modules/AIRecoveryHandler';
import { AIRecoveryRequest } from '@/entityTypes/processMessage-type';
import { AiChatApi } from '@/api/aiChatApi';
import sinon, { SinonStub } from 'sinon';

describe('AIRecoveryHandler', () => {
    let handler: AIRecoveryHandler;
    let aiChatApiStub: SinonStub;

    beforeEach(() => {
        // Create handler with test config
        handler = new AIRecoveryHandler({
            model: 'gpt-4o-mini',
            rateLimitWindow: 60000,
            rateLimitMax: 10
        });

        // Stub the AiChatApi
        aiChatApiStub = sinon.stub(AiChatApi.prototype, 'sendMessage');
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('handleRecoveryRequest', () => {
        it('should rate limit requests when limit is exceeded', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Element not found',
                attemptedSelectors: ['#search', '.input'],
                htmlSample: '<html>test</html>'
            };

            // Make 10 requests (at the limit)
            for (let i = 0; i < 10; i++) {
                aiChatApiStub.resolves({
                    status: true,
                    data: { message: JSON.stringify({
                        success: true,
                        actions: [],
                        confidence: 0.8,
                        reasoning: 'test'
                    })}
                });
                await handler.handleRecoveryRequest({ ...request, requestId: `test-${i}` });
            }

            // 11th request should be rate limited
            const result = await handler.handleRecoveryRequest({ ...request, requestId: 'test-11' });

            expect(result.success).to.be.false;
            expect(result.reasoning).to.contain('Rate limit exceeded');
        });

        it('should reset rate limit after window expires', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Element not found',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            // Create handler with very short rate limit window
            const shortWindowHandler = new AIRecoveryHandler({
                rateLimitWindow: 100, // 100ms
                rateLimitMax: 2
            });

            aiChatApiStub.resolves({
                status: true,
                data: { message: JSON.stringify({
                    success: true,
                    actions: [],
                    confidence: 0.8,
                    reasoning: 'test'
                })}
            });

            // Make 2 requests (at the limit)
            await shortWindowHandler.handleRecoveryRequest({ ...request, requestId: 'test-1' });
            await shortWindowHandler.handleRecoveryRequest({ ...request, requestId: 'test-2' });

            // 3rd request should be rate limited
            let result = await shortWindowHandler.handleRecoveryRequest({ ...request, requestId: 'test-3' });
            expect(result.success).to.be.false;

            // Wait for window to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            // Should be allowed again
            result = await shortWindowHandler.handleRecoveryRequest({ ...request, requestId: 'test-4' });
            expect(result.success).to.be.true;
        });

        it('should sanitize error messages', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error at /home/user/project/src/test.ts:10:20\nStack trace here',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            aiChatApiStub.resolves({
                status: true,
                data: { message: JSON.stringify({
                    success: true,
                    actions: [{ type: 'click', selector: '.btn', reason: 'test' }],
                    confidence: 0.9,
                    reasoning: 'test'
                })}
            });

            await handler.handleRecoveryRequest(request);

            // Check that the API was called with sanitized error message
            const callArgs = aiChatApiStub.getCall(0).args[0];
            expect(callArgs.message).to.not.contain('/home/user');
            expect(callArgs.message).to.not.contain('test.ts:10');
        });

        it('should handle API failures gracefully', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            aiChatApiStub.resolves({
                status: false,
                msg: 'API Error: Invalid request'
            });

            const result = await handler.handleRecoveryRequest(request);

            expect(result.success).to.be.false;
            expect(result.error).to.equal('API Error: Invalid request');
            expect(result.actions).to.be.empty;
        });

        it('should parse valid AI responses correctly', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            const validResponse = JSON.stringify({
                success: true,
                actions: [
                    { type: 'click', selector: '.button', reason: 'Click search button' },
                    { type: 'type', selector: 'input', value: 'test', reason: 'Type query' }
                ],
                confidence: 0.95,
                reasoning: 'Found the search elements'
            });

            aiChatApiStub.resolves({
                status: true,
                data: { message: validResponse }
            });

            const result = await handler.handleRecoveryRequest(request);

            expect(result.success).to.be.true;
            expect(result.actions).to.have.lengthOf(2);
            expect(result.confidence).to.equal(0.95);
            expect(result.reasoning).to.equal('Found the search elements');
        });

        it('should extract JSON from code blocks', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            const responseWithCodeBlock = `Here's my analysis:

\`\`\`json
{
  "success": true,
  "actions": [{"type": "click", "selector": ".btn", "reason": "test"}],
  "confidence": 0.9,
  "reasoning": "test"
}
\`\`\`

Hope this helps!`;

            aiChatApiStub.resolves({
                status: true,
                data: { message: responseWithCodeBlock }
            });

            const result = await handler.handleRecoveryRequest(request);

            expect(result.success).to.be.true;
            expect(result.actions).to.have.lengthOf(1);
        });

        it('should limit maximum actions to 5', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            const responseWithManyActions = JSON.stringify({
                success: true,
                actions: Array(10).fill(null).map((_, i) => ({
                    type: 'click',
                    selector: `.btn-${i}`,
                    reason: `Click button ${i}`
                })),
                confidence: 0.9,
                reasoning: 'test'
            });

            aiChatApiStub.resolves({
                status: true,
                data: { message: responseWithManyActions }
            });

            const result = await handler.handleRecoveryRequest(request);

            expect(result.success).to.be.true;
            expect(result.actions).to.have.lengthOf(5); // Limited to 5
        });

        it('should filter invalid action types', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            const responseWithInvalidActions = JSON.stringify({
                success: true,
                actions: [
                    { type: 'click', selector: '.btn', reason: 'valid' },
                    { type: 'evaluate', selector: 'invalid', reason: 'invalid action' },
                    { type: 'goto', url: 'http://invalid.com', reason: 'invalid action' }
                ],
                confidence: 0.9,
                reasoning: 'test'
            });

            aiChatApiStub.resolves({
                status: true,
                data: { message: responseWithInvalidActions }
            });

            const result = await handler.handleRecoveryRequest(request);

            expect(result.success).to.be.true;
            expect(result.actions).to.have.lengthOf(1); // Only click is valid
            expect(result.actions[0].type).to.equal('click');
        });

        it('should handle exceptions during processing', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>'
            };

            aiChatApiStub.rejects(new Error('Network error'));

            const result = await handler.handleRecoveryRequest(request);

            expect(result.success).to.be.false;
            expect(result.reasoning).to.equal('Exception during AI recovery');
            expect(result.error).to.equal('Network error');
        });

        it('should include accessibility tree in prompt when available', async () => {
            const request: AIRecoveryRequest = {
                requestId: 'test-1',
                operation: 'search_input',
                searchEngine: 'google',
                currentUrl: 'https://google.com',
                pageTitle: 'Google',
                errorMessage: 'Error',
                attemptedSelectors: ['#search'],
                htmlSample: '<html>test</html>',
                accessibilityTree: '{"role": "WebArea", "children": [{"role": "textbox"}]}'
            };

            aiChatApiStub.resolves({
                status: true,
                data: { message: JSON.stringify({
                    success: true,
                    actions: [],
                    confidence: 0.8,
                    reasoning: 'test'
                })}
            });

            await handler.handleRecoveryRequest(request);

            const callArgs = aiChatApiStub.getCall(0).args[0];
            expect(callArgs.message).to.contain('ACCESSIBILITY TREE');
        });
    });
});
