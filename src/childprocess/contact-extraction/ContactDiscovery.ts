import { Page } from 'puppeteer';
import { AiChatApi } from '@/api/aiChatApi';
import { ContactInfo, ExtractionResult } from '@/entityTypes/contactExtractionTypes';
import { browserPool } from './BrowserPool';

/**
 * Contact Discovery - 4-Stage Pipeline
 * Extracts contact information from websites using progressively complex methods
 */

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
 * Stage 4: AI-Assisted Extraction
 * Uses AI server to extract contact info from page content
 */
async function extractWithAI(
    page: Page,
    url: string,
    pageTitle: string
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

        // Call AI service
        const aiChatApi = new AiChatApi();
        const response = await aiChatApi.extractContactInfo(cleanedContent, url, entityName);

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
                    method: 'stage4_ai'
                };
            }
        }

        return { success: false, error: 'AI extraction found no contact info', method: 'failed' };
    } catch (error) {
        console.error('Stage 4 error:', error);
        return { success: false, error: `AI extraction failed: ${error}`, method: 'failed' };
    }
}

/**
 * Complete 4-Stage Discovery Pipeline
 * Runs through all stages until contact info is found or all stages exhausted
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

    const browser = await browserPool.acquire();
    const page = await browserPool.createPage(browser);

    try {
        console.log(`ContactDiscovery: Starting extraction for ${url}`);

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

        // Stage 1: Direct scan
        console.log('ContactDiscovery: Stage 1 - Homepage direct scan');
        const stage1Result = await scanHomepageForContactInfo(page);
        if (stage1Result) {
            console.log('ContactDiscovery: Stage 1 SUCCESS');
            return { success: true, data: stage1Result, method: 'stage1_homepage' };
        }

        // Stage 2: Heuristic discovery
        console.log('ContactDiscovery: Stage 2 - Heuristic link scoring');
        const contactPageUrl = await findContactPageHeuristic(page);
        if (contactPageUrl && !contactPageUrl.startsWith('mailto:')) {
            console.log(`ContactDiscovery: Stage 2 found contact page: ${contactPageUrl}`);
            await page.goto(contactPageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            const stage2Result = await scanHomepageForContactInfo(page);
            if (stage2Result) {
                console.log('ContactDiscovery: Stage 2 SUCCESS');
                return { success: true, data: stage2Result, method: 'stage2_heuristic' };
            }
        }

        // Stage 3: Fallback routes
        console.log('ContactDiscovery: Stage 3 - Fallback standard routes');
        const fallbackPath = await checkStandardRoutes(url);
        if (fallbackPath) {
            const fallbackUrl = new URL(fallbackPath, url).toString();
            console.log(`ContactDiscovery: Stage 3 trying ${fallbackUrl}`);
            try {
                await page.goto(fallbackUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                const stage3Result = await scanHomepageForContactInfo(page);
                if (stage3Result) {
                    console.log('ContactDiscovery: Stage 3 SUCCESS');
                    return { success: true, data: stage3Result, method: 'stage3_fallback' };
                }
            } catch (e) {
                console.log('ContactDiscovery: Stage 3 route not found');
            }
        }

        // Stage 4: AI extraction
        console.log('ContactDiscovery: Stage 4 - AI-assisted extraction');
        // Go back to original page for AI extraction
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        const stage4Result = await extractWithAI(page, url, pageTitle);
        if (stage4Result.success && stage4Result.data) {
            const emails = stage4Result.data.emails ?? [];
            const phones = stage4Result.data.phones ?? [];
            if (emails.length > 0 || phones.length > 0) {
                console.log('ContactDiscovery: Stage 4 SUCCESS');
                return stage4Result;
            }
        }

        console.log('ContactDiscovery: All stages failed');
        return { success: false, error: 'No contact information found', method: 'failed' };

    } catch (error) {
        console.error('ContactDiscovery error:', error);
        return { success: false, error: `Discovery failed: ${error}`, method: 'failed' };
    } finally {
        await page.close();
        browserPool.release(browser);
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
