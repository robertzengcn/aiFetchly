import { Page } from 'puppeteer';
import { AIRecoveryRequest } from '@/entityTypes/processMessage-type';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger';

const logger = createLogger('PageStateCapture');

export interface CaptureOptions {
    includeScreenshot?: boolean;
    maxHtmlLength?: number;
    includeAccessibilityTree?: boolean;
}

/**
 * Capture page state for AI recovery analysis
 * Extracts HTML, accessibility tree, and optionally screenshot
 */
export async function capturePageState(
    page: Page,
    operation: string,
    searchEngine: string,
    errorMessage: string,
    attemptedSelectors: string[],
    options: CaptureOptions = {}
): Promise<AIRecoveryRequest> {
    const {
        includeScreenshot = false,
        maxHtmlLength = 10000,
        includeAccessibilityTree = true
    } = options;

    // Get basic page info
    const [currentUrl, pageTitle, html] = await Promise.all([
        page.url(),
        page.title(),
        page.content()
    ]);

    // Clean and truncate HTML
    const cleanedHtml = cleanHtml(html, maxHtmlLength);

    // Optionally capture screenshot
    let screenshot: string | undefined;
    if (includeScreenshot) {
        try {
            const buffer = await page.screenshot({
                type: 'png',
                encoding: 'base64',
                fullPage: false
            });
            screenshot = buffer as string;
        } catch (e) {
            logger.warn('Failed to capture screenshot:', e);
        }
    }

    // Optionally get accessibility tree
    let accessibilityTree: string | undefined;
    if (includeAccessibilityTree) {
        try {
            const snapshot = await page.accessibility.snapshot();
            if (snapshot) {
                const jsonString = JSON.stringify(snapshot, null, 2);
                // Smart truncate to avoid breaking JSON structure
                accessibilityTree = truncateJson(jsonString, 5000);
            }
        } catch (e) {
            logger.warn('Failed to get accessibility tree:', e);
        }
    }

    return {
        requestId: uuidv4(),
        operation,
        searchEngine,
        currentUrl,
        pageTitle,
        errorMessage,
        attemptedSelectors,
        screenshot,
        htmlSample: cleanedHtml,
        accessibilityTree
    };
}

/**
 * Clean HTML by removing scripts, styles, and comments
 * Focus on main content area if possible
 */
function cleanHtml(html: string, maxLength: number): string {
    // Remove script and style content
    let cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Focus on main content area if possible
    const mainMatch = cleaned.match(/<main[^>]*>[\s\S]*?<\/main>/i) ||
                      cleaned.match(/<div[^>]*id=["']?(?:main|content|search)[^>]*>[\s\S]*?<\/div>/i);
    
    if (mainMatch && mainMatch[0].length < maxLength) {
        cleaned = mainMatch[0];
    }

    return cleaned.substring(0, maxLength);
}

/**
 * Smart JSON truncation that maintains valid JSON structure
 * Truncates arrays and nested objects intelligently
 */
function truncateJson(jsonString: string, maxLength: number): string {
    if (jsonString.length <= maxLength) {
        return jsonString;
    }

    try {
        const parsed = JSON.parse(jsonString);
        const truncated = truncateObject(parsed, maxLength);
        return JSON.stringify(truncated, null, 2);
    } catch (e) {
        // If parsing fails, fall back to simple substring
        // but try to at least close open brackets
        let result = jsonString.substring(0, maxLength);

        // Count opening vs closing brackets to fix structure
        const openBraces = (result.match(/\{/g) || []).length;
        const closeBraces = (result.match(/\}/g) || []).length;
        const openBrackets = (result.match(/\[/g) || []).length;
        const closeBrackets = (result.match(/\]/g) || []).length;

        // Add missing closing brackets
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
            result += ']';
        }
        for (let i = 0; i < openBraces - closeBraces; i++) {
            result += '}';
        }

        // Add truncation indicator
        result += '\n// ... (truncated)';
        return result;
    }
}

/**
 * Recursively truncate object to fit within maxLength
 * Prioritizes keeping structure over content
 */
function truncateObject(obj: unknown, maxLength: number): unknown {
    const jsonString = JSON.stringify(obj);

    if (jsonString.length <= maxLength) {
        return obj;
    }

    if (Array.isArray(obj)) {
        // Keep first half of array, add truncation indicator
        const halfLength = Math.floor(obj.length / 2);
        const truncatedArray = obj.slice(0, halfLength);
        const truncatedString = JSON.stringify(truncatedArray);

        if (truncatedString.length > maxLength) {
            // If still too long, recurse on individual elements
            const newArray = obj.map((item, idx) => {
                if (idx < halfLength / 2) {
                    return truncateObject(item, maxLength / halfLength);
                }
                return undefined;
            }).filter(item => item !== undefined);

            // Truncate further if needed
            let result = newArray;
            while (JSON.stringify(result).length > maxLength && result.length > 1) {
                result = result.slice(0, Math.floor(result.length / 2));
            }
            return result;
        }

        return truncatedArray;
    } else if (typeof obj === 'object' && obj !== null) {
        // For objects, keep fewer properties
        const entries = Object.entries(obj);
        const halfLength = Math.floor(entries.length / 2);
        const truncatedObj = Object.fromEntries(entries.slice(0, halfLength));
        const truncatedString = JSON.stringify(truncatedObj);

        if (truncatedString.length > maxLength) {
            // Recurse on values
            const newObj: Record<string, unknown> = {};
            let currentLength = 2; // '{}'

            for (const [key, value] of entries) {
                const truncatedValue = truncateObject(value, maxLength / entries.length);
                const entryString = JSON.stringify({ [key]: truncatedValue });

                if (currentLength + entryString.length <= maxLength - 10) {
                    newObj[key] = truncatedValue;
                    currentLength += entryString.length;
                } else {
                    break;
                }
            }
            return newObj;
        }

        return truncatedObj;
    }

    // For primitives, return as-is
    return obj;
}
