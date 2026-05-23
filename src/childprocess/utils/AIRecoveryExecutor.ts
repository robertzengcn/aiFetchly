import { Page } from 'puppeteer';
import { AIRecoveryAction } from '@/entityTypes/processMessage-type';
import { createLogger } from './logger';

const logger = createLogger('AIRecoveryExecutor');
const SAFE_OPERATIONS = ['click', 'type', 'focus', 'waitForSelector', 'pressKey', 'scroll'];
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_ACTION_DELAY_MIN = 200;
const DEFAULT_ACTION_DELAY_MAX = 500;

export interface ExecutionResult {
    success: boolean;
    failedAt?: number;
    error?: string;
}

export interface ExecutionOptions {
    actionDelayMin?: number;
    actionDelayMax?: number;
}

/**
 * Execute AI-suggested recovery actions safely
 * Validates actions and executes them sequentially
 */
export async function executeRecoveryActions(
    page: Page,
    actions: AIRecoveryAction[],
    options: ExecutionOptions = {}
): Promise<ExecutionResult> {
    const {
        actionDelayMin = DEFAULT_ACTION_DELAY_MIN,
        actionDelayMax = DEFAULT_ACTION_DELAY_MAX
    } = options;
    
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        
        // Validate action
        if (!SAFE_OPERATIONS.includes(action.type)) {
            logger.warn(`Skipping unsafe action type: ${action.type}`);
            continue;
        }

        try {
            logger.debug(`Executing action ${i + 1}/${actions.length}: ${action.type}${action.selector ? ` (selector: ${action.selector})` : ''} - ${action.reason}`);
            
            switch (action.type) {
                case 'click':
                    if (!action.selector) throw new Error('Selector required for click');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    await page.click(action.selector);
                    break;

                case 'type':
                    if (!action.selector || !action.value) throw new Error('Selector and value required for type');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    await page.type(action.selector, action.value, { delay: 50 + Math.random() * 100 });
                    break;

                case 'focus':
                    if (!action.selector) throw new Error('Selector required for focus');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    await page.focus(action.selector);
                    break;

                case 'waitForSelector':
                    if (!action.selector) throw new Error('Selector required for waitForSelector');
                    await page.waitForSelector(action.selector, { timeout: action.timeout || DEFAULT_TIMEOUT });
                    break;

                case 'pressKey':
                    if (!action.key) throw new Error('Key required for pressKey');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await page.keyboard.press(action.key as any);
                    break;

                case 'scroll':
                    if (action.selector) {
                        await page.$eval(action.selector, el => el.scrollIntoView({ behavior: 'smooth' }));
                    } else {
                        await page.evaluate(() => window.scrollBy(0, 300));
                    }
                    break;
            }

            // Small delay between actions (configurable)
            const delay = actionDelayMin + Math.random() * (actionDelayMax - actionDelayMin);
            await new Promise(resolve => setTimeout(resolve, delay));

        } catch (error) {
            logger.error(`Action ${i + 1}/${actions.length} (${action.type}) failed:`, error);
            return {
                success: false,
                failedAt: i,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    logger.info(`Successfully executed all ${actions.length} recovery actions`);
    return { success: true };
}
