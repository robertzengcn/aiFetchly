import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

// Add stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

/**
 * Browser pool options
 */
export interface BrowserPoolOptions {
    maxInstances: number;
    headless: boolean;
}

/**
 * Manages a pool of Puppeteer browser instances
 * Reuses browsers to avoid cold start overhead
 */
export class BrowserPool {
    private browsers: Browser[] = [];
    private available: Browser[] = [];
    private options: BrowserPoolOptions;

    constructor(options: BrowserPoolOptions = { maxInstances: 3, headless: true }) {
        this.options = options;
    }

    /**
     * Acquire a browser from the pool
     * Returns an available browser or creates a new one if under limit
     */
    async acquire(): Promise<Browser> {
        // Return available browser if exists
        if (this.available.length > 0) {
            return this.available.pop()!;
        }

        // Create new browser if under limit
        if (this.browsers.length < this.options.maxInstances) {
            const browser = await this.createBrowser();
            this.browsers.push(browser);
            return browser;
        }

        // Wait for available browser (with timeout)
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Browser acquisition timeout')), 30000);
            const checkInterval = setInterval(() => {
                if (this.available.length > 0) {
                    clearTimeout(timeout);
                    clearInterval(checkInterval);
                    resolve(this.available.pop()!);
                }
            }, 100);
        });
    }

    /**
     * Create a new browser instance with stealth configuration
     */
    private async createBrowser(): Promise<Browser> {
        const browser = await puppeteer.launch({
            headless: this.options.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        console.log(`BrowserPool: Created new browser (total: ${this.browsers.length + 1})`);
        return browser;
    }

    /**
     * Release a browser back to the pool
     */
    release(browser: Browser): void {
        this.available.push(browser);
    }

    /**
     * Close all browser instances
     */
    async closeAll(): Promise<void> {
        await Promise.all(this.browsers.map(b => b.close().catch(err => {
            console.error('Error closing browser:', err);
        })));
        this.browsers = [];
        this.available = [];
        console.log('BrowserPool: All browsers closed');
    }

    /**
     * Get pool statistics
     */
    getStats(): { total: number; available: number; inUse: number } {
        return {
            total: this.browsers.length,
            available: this.available.length,
            inUse: this.browsers.length - this.available.length
        };
    }

    /**
     * Create a new page in a browser
     */
    async createPage(browser: Browser): Promise<Page> {
        const page = await browser.newPage();

        // Set user agent to avoid detection
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Block unnecessary resources to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        return page;
    }
}

// Export singleton instance
export const browserPool = new BrowserPool({ maxInstances: 3, headless: true });
