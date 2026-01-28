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

console.error('[GOOGLE_PROXY_CHECK] Child process starting, PID:', process.pid);

import puppeteer from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import useProxy from '@lem0-packages/puppeteer-page-proxy';
import { ProxyParseItem } from '@/entityTypes/proxyType';
import { proxyEntityToServer, convertProxyServertourl } from '@/modules/lib/function';

console.error('[GOOGLE_PROXY_CHECK] All imports completed successfully');

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
        
        // Configure proxy
        const proxyServer = proxyEntityToServer(proxy);
        const proxyUrl = convertProxyServertourl(proxyServer);
        
        // Set up request interception for proxy
        await page.setRequestInterception(true);
        page.on('request', async (interceptedRequest) => {
            try {
                await useProxy(interceptedRequest, proxyUrl);
                interceptedRequest.continue();
            } catch (error) {
                interceptedRequest.abort();
            }
        });
        
        // Navigate to Google
        await page.goto('https://www.google.com/ncr', {
            waitUntil: 'networkidle2',
            timeout
        });
        
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
        console.error('Google check error:', error);
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
console.error('[GOOGLE_PROXY_CHECK] Checking parentPort availability');
const parentPort = (process as unknown as {
    parentPort?: {
        on: (event: string, handler: (e: { data: string }) => void) => void;
        postMessage: (message: unknown) => void;
    }
}).parentPort;
console.error('[GOOGLE_PROXY_CHECK] parentPort available:', !!parentPort);

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
            console.error('Error in Google proxy check:', error);
            if (parentPort) {
                parentPort.postMessage(JSON.stringify({
                    type: 'CHECK_GOOGLE_PASS_RESULT',
                    requestId: requestId,
                    success: false,
                    passed: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }));
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
