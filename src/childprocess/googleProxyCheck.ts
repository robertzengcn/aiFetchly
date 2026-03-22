/**
 * Google Proxy Check Child Process
 * 
 * This child process handles checking if a proxy can pass Google's bot detection
 * using Puppeteer. It communicates results back to the parent process via IPC.
 * 
 * Usage:
 * - Parent process sends proxy details via IPC message
 * - Child process launches Puppeteer with proxy configuration
 * - Navigates to Google and checks for blocking indicators
 * - Returns pass/fail result via IPC message
 */

import puppeteer, { InterceptResolutionAction, TimeoutError } from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import useProxy from '@lem0-packages/puppeteer-page-proxy';
import { ProxyParseItem } from '@/entityTypes/proxyType';
import { proxyEntityToUrl } from '@/modules/lib/function';

// Set up stealth plugin
const puppeteerExtra = addExtra(puppeteer);
puppeteerExtra.use(StealthPlugin());

interface CheckGooglePassMessage {
    type: 'CHECK_GOOGLE_PASS';
    proxy: ProxyParseItem;
    timeout?: number;
    requestId: string;
}

/**
 * Check if proxy can pass Google's bot detection
 */
async function checkGooglePass(proxy: ProxyParseItem, timeout = 15000): Promise<boolean> {
    let browser;
    try {
        // Launch browser with stealth plugin
        browser = await puppeteerExtra.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Configure proxy - use proxyEntityToUrl directly for correct format (http://user:pass@host:port)
        const proxyUrl = proxyEntityToUrl(proxy);
        
        // Set up request interception for proxy
        await page.setRequestInterception(true);
        page.on('request', async (interceptedRequest) => {
            // Check if request is already handled
            if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) {
                return;
            }
            
            try {
                await useProxy(interceptedRequest, proxyUrl);
                // Check again after useProxy - it might have handled the request
                if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) {
                    return;
                }
                interceptedRequest.continue();
            } catch (error) {
                // Only abort if not already handled
                if (interceptedRequest.interceptResolutionState().action !== InterceptResolutionAction.AlreadyHandled) {
                    interceptedRequest.abort();
                }
            }
        });
        
        // Navigate to Google
        try {
            await page.goto('https://www.google.com/ncr', {
                waitUntil: 'networkidle2',
                timeout
            });
        } catch (navigationError) {
            // Handle timeout and network errors gracefully - these indicate proxy failure
            return false;
        }
        
        // Wait a bit for page to fully load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check for blocking indicators
        const content = await page.content();
        const isBlocked = 
            content.includes('unusual traffic') || 
            content.includes('detected unusual traffic') ||
            content.includes('Sorry, we have detected unusual traffic') ||
            content.includes('Our systems have detected unusual traffic');
        
        // Check for reCAPTCHA
        const hasRecaptcha = await page.$('.g-recaptcha, #recaptcha, [class*="recaptcha"]') !== null;
        
        // Check for search input (indicates success)
        const searchInput = await page.$('input[name="q"], #search, textarea[name="q"]');
        const hasSearchInput = searchInput !== null;
        
        // Check page title
        const title = await page.title();
        const hasValidTitle = title.toLowerCase().includes('google') && !title.toLowerCase().includes('error');
        
        // Pass if: no blocking detected, no reCAPTCHA, has search input, and valid title
        return !isBlocked && !hasRecaptcha && hasSearchInput && hasValidTitle;
    } catch (error) {
        // Handle all errors gracefully - return false to mark proxy as failing Google check
        return false;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                console.error('Error closing browser:', error);
            }
        }
    }
}

// Get parentPort from Electron utilityProcess (following codebase pattern)
const parentPort = (process as unknown as {
    parentPort?: {
        on: (event: string, handler: (e: { data: string }) => void) => void;
        postMessage: (message: unknown) => void;
    }
}).parentPort;

// Listen for messages from parent process
if (parentPort) {
    parentPort.on('message', async (e: { data: string }) => {
        let requestId = 'unknown';
        try {
            const message: CheckGooglePassMessage = JSON.parse(e.data);
            requestId = message.requestId || 'unknown';

            if (message.type === 'CHECK_GOOGLE_PASS') {
                console.log(`🔍 Checking Google pass for proxy: ${message.proxy.host}:${message.proxy.port}`);
                const result = await checkGooglePass(message.proxy, message.timeout);

                if (parentPort) {
                    parentPort.postMessage(JSON.stringify({
                        type: 'CHECK_GOOGLE_PASS_RESULT',
                        requestId: requestId,
                        success: true,
                        passed: result
                    }));
                }

                console.log(`✅ Google check completed: ${result ? 'PASS' : 'FAIL'}`);
            }
        } catch (error) {
            console.error('Error in Google proxy check message handler:', error);
            // Always send a response, even on error
            try {
                if (parentPort) {
                    parentPort.postMessage(JSON.stringify({
                        type: 'CHECK_GOOGLE_PASS_RESULT',
                        requestId: requestId,
                        success: false,
                        passed: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    }));
                }
            } catch (postError) {
                console.error('Failed to send error response:', postError);
            }
        }
    });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
    process.exit(1);
});

// Handle process termination
process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, exiting...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, exiting...');
    process.exit(0);
});
