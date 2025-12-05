/**
 * Website Content Scraper Child Process
 * 
 * This child process handles fetching website content using Puppeteer
 * and converting HTML to markdown format. It communicates results back
 * to the parent process via IPC.
 * 
 * Usage:
 * - Parent process sends URL via IPC message
 * - Child process fetches HTML content using Puppeteer
 * - Converts HTML to markdown using HtmlConversionService
 * - Returns markdown content via IPC message
 */

import { Page, Browser } from 'puppeteer';
import { BrowserManager } from '@/modules/browserManager';
import { HtmlConversionService } from '@/service/HtmlConversionService';

interface ScrapeWebsiteMessage {
    type: 'SCRAPE_WEBSITE';
    url: string;
    requestId: string;
}

interface ScrapeWebsiteResponse {
    type: 'SCRAPE_SUCCESS' | 'SCRAPE_ERROR';
    requestId: string;
    markdown?: string;
    error?: string;
}

let browserManager: BrowserManager | null = null;
let browser: Browser | null = null;
const htmlConversionService = new HtmlConversionService();

/**
 * Initialize browser instance
 */
async function initializeBrowser(): Promise<Browser> {
    if (!browser) {
        browserManager = new BrowserManager();
        browser = await browserManager.launchWithoutStealth({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu'
            ]
        });
    }
    return browser;
}

/**
 * Scrape website content and convert to markdown
 */
async function scrapeWebsite(url: string): Promise<string> {
    try {
        // Initialize browser if needed
        const browserInstance = await initializeBrowser();
        
        // Create new page
        const page = await browserInstance.newPage();
        
        try {
            // Set viewport
            await page.setViewport({ width: 1920, height: 1080 });
            
            // Navigate to URL with timeout
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000 // 30 seconds timeout
            });
            
            // Wait a bit for dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Extract HTML content
            const htmlContent = await page.content();
            
            // Convert HTML to markdown
            const markdown = htmlConversionService.convertHtmlToMarkdown(htmlContent);
            
            return markdown;
        } finally {
            // Always close the page
            await page.close();
        }
    } catch (error) {
        console.error('Error scraping website:', error);
        throw error;
    }
}

/**
 * Cleanup browser instance
 */
async function cleanupBrowser(): Promise<void> {
    if (browser) {
        try {
            await browser.close();
        } catch (error) {
            console.error('Error closing browser:', error);
        }
        browser = null;
    }
    if (browserManager) {
        browserManager = null;
    }
}

// Handle process messages from parent
if (process.parentPort) {
    process.parentPort.on('message', async (e: { data: string }) => {
        try {
            const message: ScrapeWebsiteMessage = JSON.parse(e.data);
            
            if (message.type === 'SCRAPE_WEBSITE' && message.url) {
                console.log(`📄 Scraping website: ${message.url}`);
                
                try {
                    const markdown = await scrapeWebsite(message.url);
                    
                    const response: ScrapeWebsiteResponse = {
                        type: 'SCRAPE_SUCCESS',
                        requestId: message.requestId,
                        markdown
                    };
                    
                    process.parentPort?.postMessage(response);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    console.error('Scraping error:', errorMessage);
                    
                    const response: ScrapeWebsiteResponse = {
                        type: 'SCRAPE_ERROR',
                        requestId: message.requestId,
                        error: errorMessage
                    };
                    
                    process.parentPort?.postMessage(response);
                }
            } else {
                console.warn('⚠️ Unknown message type:', message);
            }
        } catch (error) {
            console.error('Error processing message:', error);
            const errorResponse: ScrapeWebsiteResponse = {
                type: 'SCRAPE_ERROR',
                requestId: 'unknown',
                error: error instanceof Error ? error.message : String(error)
            };
            process.parentPort?.postMessage(errorResponse);
        }
    });
}

// Handle process termination
process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, cleaning up...');
    await cleanupBrowser();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, cleaning up...');
    await cleanupBrowser();
    process.exit(0);
});

// Cleanup on exit
process.on('exit', async () => {
    await cleanupBrowser();
});

