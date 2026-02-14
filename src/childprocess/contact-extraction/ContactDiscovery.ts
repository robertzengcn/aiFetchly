import { Page } from 'puppeteer';
import { AiChatApi } from '@/api/aiChatApi';
import { ContactInfo, ExtractionResult } from '@/entityTypes/contactExtractionTypes';
import { browserManager } from '@/modules/browserManager';

/**
 * Contact Discovery - 4-Stage Pipeline
 * Extracts contact information from websites using progressively complex methods
 *
 * When running in a worker process, AI availability is determined by the
 * WORKER_AI_ENABLED env var passed from the main process. If AI is not
 * enabled, Stages 1-3 (AI-based) are skipped and only Stage 4 (regex
 * fallback) is used.
 */

/**
 * Check if AI features are available in the current process context.
 * In worker processes, this checks the WORKER_AI_ENABLED env var.
 */
function isAIAvailable(): boolean {
    if (process.env.WORKER_TYPE) {
        return process.env.WORKER_AI_ENABLED === 'true';
    }
    return true; // In main process, assume available (AiChatApi will check)
}

// Regex patterns for Stage 1 (direct scan)
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\(\d{3}\)\s*\d{3}[-.\s]?\d{4}\b/g;

// Keywords for Stage 2 (heuristic link scoring)
const CONTACT_KEYWORDS = [
    { word: 'contact', score: 10 },
    { word: 'get in touch', score: 8 },
    { word: 'support', score: 6 },
    { word: 'about', score: 4 },
    { word: 'help', score: 2 }
];

/**
 * Stage 1: Homepage Direct Scan
 * Fastest - uses regex to find contact info directly on the page
 */
async function scanHomepageForContactInfo(page: Page): Promise<ContactInfo | null> {
    try {
        const content = await page.content();

        const emails = content.match(EMAIL_PATTERN) || [];
        const phones = content.match(PHONE_PATTERN) || [];

        if (emails.length > 0 || phones.length > 0) {
            return {
                emails: [...new Set(emails)], // Deduplicate
                phones: [...new Set(phones)], // Deduplicate
                address: null,
                socialLinks: null,
                source: 'homepage',
                confidence: 0.7
            };
        }

        return null;
    } catch (error) {
        console.error('Stage 1 error:', error);
        return null;
    }
}

/**
 * Stage 2: Heuristic Link Scoring
 * Finds the most likely contact page link
 */
async function findContactPageHeuristic(page: Page): Promise<string | null> {
    try {
        const links = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a'));
            return anchors.map(a => ({
                href: (a as HTMLAnchorElement).href,
                text: a.innerText.toLowerCase().trim(),
                aria: a.getAttribute('aria-label') || '',
                visible: a.offsetWidth > 0 && a.offsetHeight > 0
            })).filter((link: any) => link.href && !link.href.startsWith('javascript'));
        });

        let bestLink: string | null = null;
        let highestScore = 0;

        for (const link of links) {
            let score = 0;

            // Score visible text (higher weight)
            for (const keyword of CONTACT_KEYWORDS) {
                if (link.text.includes(keyword.word)) {
                    score += keyword.score;
                }
            }

            // Score aria-label
            for (const keyword of CONTACT_KEYWORDS) {
                if (link.aria.toLowerCase().includes(keyword.word)) {
                    score += keyword.score / 2;
                }
            }

            // Score URL (lower weight)
            for (const keyword of CONTACT_KEYWORDS) {
                if (link.href.includes(keyword.word)) {
                    score += keyword.score / 2;
                }
            }

            // Check for mailto links (direct email)
            if (link.href.startsWith('mailto:')) {
                return link.href; // Return mailto directly
            }

            if (score > highestScore && link.visible) {
                highestScore = score;
                bestLink = link.href;
            }
        }

        return bestLink;
    } catch (error) {
        console.error('Stage 2 error:', error);
        return null;
    }
}

/**
 * Stage 3: Fallback Standard Routes
 * Checks common contact page URLs
 */
async function checkStandardRoutes(_baseUrl: string): Promise<string | null> {
    const commonPaths = [
        '/contact',
        '/contact-us',
        '/contactus',
        '/about',
        '/about-us',
        '/support',
        '/help',
        '/get-in-touch'
    ];

    // Note: We can't actually fetch these URLs from here
    // Instead, we return the first candidate URL for the caller to try
    // The actual navigation will happen in the calling context

    return commonPaths[0]; // Return first candidate
}

/**
 * Capture screenshot as base64 for AI visual context
 */
async function captureScreenshot(page: Page): Promise<string | undefined> {
    try {
        const screenshot = await page.screenshot({
            encoding: 'base64',
            type: 'png',
            fullPage: false // Only capture viewport for performance
        });
        return `data:image/png;base64,${screenshot}`;
    } catch (error) {
        console.error('Screenshot capture failed:', error);
        return undefined;
    }
}

/**
 * AI-Assisted Extraction (Primary Method)
 * Uses AI server to extract comprehensive contact info from page content
 */
async function extractWithAI(
    page: Page,
    url: string,
    pageTitle: string,
    captureScreenshot = true
): Promise<ExtractionResult> {
    try {
        // Clean page content (remove scripts, styles, images)
        const cleanedContent = await page.evaluate(() => {
            document.querySelectorAll('script, style, img, svg, nav, footer').forEach(e => e.remove());
            return document.body.innerText.substring(0, 15000); // Limit to 15k chars
        });

        // Derive entity name from page title or URL
        const hostname = new URL(url).hostname.replace('www.', '').split('.')[0];
        const entityName = pageTitle || hostname;

        // Capture screenshot for visual context (optional)
        const screenshot = captureScreenshot ? await captureScreenshotForAI(page) : undefined;

        // Call AI service with screenshot
        const aiChatApi = new AiChatApi();
        const response = await aiChatApi.extractContactInfo(
            cleanedContent,
            url,
            entityName,
            screenshot
        );

        if (response.status && response.data) {
            const aiData = response.data;

            // Check if we found any useful data
            if (aiData.emails.length > 0 || aiData.phones.length > 0 || aiData.address) {
                return {
                    success: true,
                    data: {
                        emails: aiData.emails,
                        phones: aiData.phones,
                        address: aiData.address || null,
                        socialLinks: aiData.socialLinks || null,
                        source: 'ai_extraction',
                        confidence: aiData.confidence || 0.8
                    },
                    method: 'ai_extraction'
                };
            }
        }

        return { success: false, error: 'AI extraction found no contact info', method: 'failed' };
    } catch (error) {
        console.error('AI extraction error:', error);
        return { success: false, error: `AI extraction failed: ${error}`, method: 'failed' };
    }
}

/**
 * Helper function to capture screenshot for AI
 */
async function captureScreenshotForAI(page: Page): Promise<string | undefined> {
    try {
        const screenshot = await page.screenshot({
            encoding: 'base64',
            type: 'png',
            fullPage: false
        });
        return `data:image/png;base64,${screenshot}`;
    } catch (error) {
        console.error('Screenshot capture failed:', error);
        return undefined;
    }
}

/**
 * Complete AI-First Discovery Pipeline
 * Prioritizes AI extraction for comprehensive data, falls back to regex for basic data
 */
export async function discoverAndExtractContactInfo(url: string): Promise<ExtractionResult> {
    // Validate URL before proceeding
    if (!validateUrl(url)) {
        return {
            success: false,
            error: `Invalid URL format: ${url}`,
            method: 'failed'
        };
    }

    // Use browserManager to launch browser with stealth mode
    const browser = await browserManager.launchWithStealth({
        headless: true
    });
    const page = await browser.newPage();

    // Set user agent and viewport for stealth
    await page.setUserAgent(browserManager.getRandomUserAgent());
    const viewport = browserManager.getRandomViewport();
    await page.setViewport(viewport);

    // Block unnecessary resources to speed up loading (but allow images for screenshots)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['stylesheet', 'font', 'media'].includes(resourceType)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    try {
        const aiAvailable = isAIAvailable();
        console.log(`ContactDiscovery: Starting extraction for ${url} (AI ${aiAvailable ? 'enabled' : 'not enabled - using regex only'})`);

        // Navigate to URL with bot detection handling
        try {
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        } catch (navError) {
            // Check if it's a bot detection page
            const pageContent = await page.content();
            if (pageContent.includes('Access Denied') ||
                pageContent.includes('bot detection') ||
                pageContent.includes('captcha') ||
                pageContent.includes('human verification')) {
                console.log('ContactDiscovery: Bot detection detected, trying with stealth');

                // Retry with stealth (already enabled via puppeteer-extra-plugin-stealth)
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } else {
                throw navError;
            }
        }

        const pageTitle = await page.title();

        // Stages 1-3 require AI. Skip them if AI is not available.
        if (aiAvailable) {
            // Stage 1: AI Extraction on Homepage (Primary - Most Comprehensive)
            console.log('ContactDiscovery: Stage 1 - AI-assisted extraction on homepage');
            const stage1Result = await extractWithAI(page, url, pageTitle, true);

            if (stage1Result.success && stage1Result.data) {
                const emails = stage1Result.data.emails ?? [];
                const phones = stage1Result.data.phones ?? [];
                const hasAddress = !!stage1Result.data.address;
                const hasSocialLinks = !!stage1Result.data.socialLinks && stage1Result.data.socialLinks.length > 0;

                // Only proceed to next stage if AI found NOTHING
                if (emails.length > 0 || phones.length > 0 || hasAddress || hasSocialLinks) {
                    console.log('ContactDiscovery: Stage 1 SUCCESS - AI found comprehensive data');
                    return stage1Result;
                }
            }

            // Stage 2: Heuristic Discovery + AI Extraction
            console.log('ContactDiscovery: Stage 2 - Heuristic link scoring + AI extraction');
            const contactPageUrl = await findContactPageHeuristic(page);

            if (contactPageUrl && !contactPageUrl.startsWith('mailto:')) {
                console.log(`ContactDiscovery: Stage 2 found contact page: ${contactPageUrl}`);
                await page.goto(contactPageUrl, { waitUntil: 'networkidle0', timeout: 30000 });

                // Use AI on the contact page (not just regex)
                const stage2Result = await extractWithAI(page, url, pageTitle, true);
                if (stage2Result.success && stage2Result.data) {
                    const emails = stage2Result.data.emails ?? [];
                    const phones = stage2Result.data.phones ?? [];
                    const hasAddress = !!stage2Result.data.address;
                    const hasSocialLinks = !!stage2Result.data.socialLinks && stage2Result.data.socialLinks.length > 0;

                    if (emails.length > 0 || phones.length > 0 || hasAddress || hasSocialLinks) {
                        console.log('ContactDiscovery: Stage 2 SUCCESS');
                        return stage2Result;
                    }
                }
            }

            // Stage 3: Fallback Routes + AI Extraction
            console.log('ContactDiscovery: Stage 3 - Fallback standard routes + AI extraction');
            const fallbackPath = await checkStandardRoutes(url);

            if (fallbackPath) {
                const fallbackUrl = new URL(fallbackPath, url).toString();
                console.log(`ContactDiscovery: Stage 3 trying ${fallbackUrl}`);

                try {
                    await page.goto(fallbackUrl, { waitUntil: 'networkidle0', timeout: 30000 });

                    // Use AI on fallback page
                    const stage3Result = await extractWithAI(page, url, pageTitle, true);
                    if (stage3Result.success && stage3Result.data) {
                        const emails = stage3Result.data.emails ?? [];
                        const phones = stage3Result.data.phones ?? [];
                        const hasAddress = !!stage3Result.data.address;
                        const hasSocialLinks = !!stage3Result.data.socialLinks && stage3Result.data.socialLinks.length > 0;

                        if (emails.length > 0 || phones.length > 0 || hasAddress || hasSocialLinks) {
                            console.log('ContactDiscovery: Stage 3 SUCCESS');
                            return stage3Result;
                        }
                    }
                } catch (e) {
                    console.log('ContactDiscovery: Stage 3 route not found');
                }
            }
        } else {
            console.log('ContactDiscovery: AI not enabled - skipping Stages 1-3, using regex fallback only');
        }

        // Stage 4: Regex Fallback (Last Resort - Basic Data Only, or only method if AI unavailable)
        console.log('ContactDiscovery: Stage 4 - Regex fallback (basic data only)');
        // Navigate back to homepage if we navigated away during earlier stages, or if AI was skipped
        const currentUrl = page.url();
        if (currentUrl !== url) {
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        }
        const stage4Result = await scanHomepageForContactInfo(page);

        if (stage4Result) {
            console.log('ContactDiscovery: Stage 4 SUCCESS - Basic regex extraction');
            return {
                success: true,
                data: {
                    ...stage4Result,
                    confidence: 0.5 // Lower confidence for regex-only
                },
                method: 'stage4_regex_fallback'
            };
        }

        console.log('ContactDiscovery: All stages failed');
        return { success: false, error: 'No contact information found', method: 'failed' };

    } catch (error) {
        console.error('ContactDiscovery error:', error);
        return { success: false, error: `Discovery failed: ${error}`, method: 'failed' };
    } finally {
        await page.close();
        await browser.close();
    }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
    const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/;
    return emailPattern.test(email);
}

/**
 * Validate phone format
 */
export function validatePhone(phone: string): boolean {
    // Accept various formats: +1-555-1234, (555) 123-4567, 555.123.4567
    const phonePattern = /^\+?[\d\s\-().]{10,}$/;
    return phonePattern.test(phone);
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}
