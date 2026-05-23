/**
 * Tests for AIRecoveryExecutor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeRecoveryActions } from '@/childprocess/utils/AIRecoveryExecutor';
import { AIRecoveryAction } from '@/entityTypes/processMessage-type';
import { Page } from 'puppeteer';

// Mock Page - use unknown to avoid complex Puppeteer generic type issues
const createMockPage = () => {
    return {
        $: vi.fn(),
        click: vi.fn(),
        type: vi.fn(),
        focus: vi.fn(),
        waitForSelector: vi.fn(),
        keyboard: {
            type: vi.fn(),
            press: vi.fn(),
            down: vi.fn(),
            up: vi.fn(),
            sendCharacter: vi.fn()
        },
        evaluate: vi.fn(),
        $eval: vi.fn()
    } as unknown as Page;
};

describe('AIRecoveryExecutor', () => {
    let mockPage: Page;

    beforeEach(() => {
        mockPage = createMockPage();
    });

    describe('executeRecoveryActions', () => {
        it('should execute a simple click action', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.click).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    selector: '.button',
                    reason: 'Click the button'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.waitForSelector).toHaveBeenCalledWith('.button', { timeout: 5000 });
            expect(mockPage.click).toHaveBeenCalledWith('.button');
        });

        it('should execute a type action', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.type).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'type',
                    selector: 'input[name="search"]',
                    value: 'test search',
                    reason: 'Type search query'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.waitForSelector).toHaveBeenCalledWith('input[name="search"]', { timeout: 5000 });
            expect(mockPage.type).toHaveBeenCalled();
        });

        it('should execute a pressKey action', async () => {
            vi.mocked(mockPage.keyboard.press).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'pressKey',
                    key: 'Enter',
                    reason: 'Submit form'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
        });

        it('should execute a waitForSelector action', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'waitForSelector',
                    selector: '.loading',
                    timeout: 10000,
                    reason: 'Wait for loading'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.waitForSelector).toHaveBeenCalledWith('.loading', { timeout: 10000 });
        });

        it('should execute multiple actions in sequence', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.focus).mockResolvedValue(undefined);
            vi.mocked(mockPage.type).mockResolvedValue(undefined);
            vi.mocked(mockPage.keyboard.press).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'focus',
                    selector: 'input',
                    reason: 'Focus input'
                },
                {
                    type: 'type',
                    selector: 'input',
                    value: 'test',
                    reason: 'Type text'
                },
                {
                    type: 'pressKey',
                    key: 'Enter',
                    reason: 'Submit'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.focus).toHaveBeenCalledWith('input');
            expect(mockPage.type).toHaveBeenCalled();
            expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
        });

        it('should skip unsafe actions', async () => {
            const actions: AIRecoveryAction[] = [
                {
                    type: 'evaluate', // Unsafe operation
                    selector: 'unsafe',
                    reason: 'Should be skipped'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.waitForSelector).not.toHaveBeenCalled();
        });

        it('should fail when an action throws an error', async () => {
            vi.mocked(mockPage.waitForSelector).mockRejectedValue(
                new Error('Element not found')
            );

            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    selector: '.nonexistent',
                    reason: 'Click nonexistent'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(false);
            expect(result.failedAt).toBe(0);
            expect(result.error).toBe('Element not found');
        });

        it('should fail when required selector is missing', async () => {
            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    reason: 'Click without selector'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(false);
            expect(result.failedAt).toBe(0);
            expect(result.error).toContain('Selector required');
        });

        it('should use custom timeout when provided', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.click).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    selector: '.button',
                    timeout: 10000,
                    reason: 'Click with custom timeout'
                }
            ];

            const result = await executeRecoveryActions(mockPage, actions);

            expect(result.success).toBe(true);
            expect(mockPage.waitForSelector).toHaveBeenCalledWith('.button', { timeout: 10000 });
        });

        it('should use default action delays when no options provided', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.click).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    selector: '.button',
                    reason: 'Click button'
                }
            ];

            const startTime = Date.now();
            await executeRecoveryActions(mockPage, actions);
            const endTime = Date.now();

            // Should have taken at least 200ms (default min delay)
            expect(endTime - startTime).toBeGreaterThanOrEqual(200);
        });

        it('should use custom action delays when provided', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.click).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    selector: '.button',
                    reason: 'Click button'
                }
            ];

            const startTime = Date.now();
            await executeRecoveryActions(mockPage, actions, {
                actionDelayMin: 50,
                actionDelayMax: 100
            });
            const endTime = Date.now();

            // Should have taken at least 50ms (custom min delay)
            expect(endTime - startTime).toBeGreaterThanOrEqual(50);
            // And less than 300ms (allowing some margin)
            expect(endTime - startTime).toBeLessThan(300);
        });

        it('should apply delays between multiple actions', async () => {
            vi.mocked(mockPage.waitForSelector).mockResolvedValue(undefined as never);
            vi.mocked(mockPage.click).mockResolvedValue(undefined);

            const actions: AIRecoveryAction[] = [
                {
                    type: 'click',
                    selector: '.button1',
                    reason: 'Click button 1'
                },
                {
                    type: 'click',
                    selector: '.button2',
                    reason: 'Click button 2'
                }
            ];

            const startTime = Date.now();
            await executeRecoveryActions(mockPage, actions, {
                actionDelayMin: 100,
                actionDelayMax: 150
            });
            const endTime = Date.now();

            // Should have taken at least 200ms (two delays of 100ms each)
            expect(endTime - startTime).toBeGreaterThanOrEqual(200);
        });
    });
});
