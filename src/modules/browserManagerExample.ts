import * as puppeteer from 'puppeteer';
import { browserManager, BrowserManager } from './browserManager';

/**
 * Example 1: Using the default browser manager instance
 */
export async function exampleWithDefaultManager() {
    console.log('=== Example 1: Using Default Browser Manager ===');
    
    // Get browser information
    const browserInfo = await browserManager.getBrowserInfo();
    console.log('Browser Info:', browserInfo);
    
    // Create launch options
    const launchOptions = await browserManager.createLaunchOptions({
        headless: false, // Override default headless setting
        args: ['--window-size=1920,1080'] // Add custom arguments
    });
    
    // Launch browser
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    console.log('Browser launched successfully');
    
    // Do something with the page
    await page.goto('https://example.com');
    console.log('Page title:', await page.title());
    
    await browser.close();
}

/**
 * Example 2: Creating a custom browser manager instance
 */
export async function exampleWithCustomManager() {
    console.log('=== Example 2: Using Custom Browser Manager ===');
    
    // Create a custom browser manager with specific options
    const customManager = new BrowserManager({
        chromeBuildId: '120.0.6099.109', // Use a specific Chrome version
        localBrowserPath: process.env.CUSTOM_CHROME_PATH, // Use custom Chrome path
        cacheDir: '/custom/cache/path' // Use custom cache directory
    });
    
    // Get browser executable path
    const browserInfo = await customManager.getBrowserExecutablePath();
    console.log('Custom Browser Info:', browserInfo);
    
    // Create launch options with custom settings
    const launchOptions = await customManager.createLaunchOptions({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    });
    
    // Launch browser
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    
    console.log('Custom browser launched successfully');
    
    await page.goto('https://httpbin.org/user-agent');
    const userAgent = await page.$eval('pre', el => el.textContent);
    console.log('User Agent:', userAgent);
    
    await browser.close();
}

/**
 * Example 3: Using browser manager with puppeteer-extra
 */
export async function exampleWithPuppeteerExtra() {
    console.log('=== Example 3: Using Browser Manager with Puppeteer-Extra ===');
    
    const vanillaPuppeteer = require('puppeteer');
    const { addExtra } = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    
    // Create enhanced puppeteer instance
    const puppeteers = addExtra(vanillaPuppeteer);
    puppeteers.use(StealthPlugin());
    
    // Get launch options from browser manager
    const launchOptions = await browserManager.createLaunchOptions({
        headless: false,
        args: ['--window-size=1366,768']
    });
    
    // Launch browser with puppeteer-extra
    const browser = await puppeteers.launch(launchOptions);
    const page = await browser.newPage();
    
    console.log('Puppeteer-extra browser launched successfully');
    
    // Test stealth capabilities
    await page.goto('https://bot.sannysoft.com/');
    console.log('Stealth test completed');
    
    await browser.close();
}

/**
 * Example 4: Error handling and fallback strategies
 */
export async function exampleWithErrorHandling() {
    console.log('=== Example 4: Error Handling and Fallbacks ===');
    
    try {
        // Try to get browser info
        const browserInfo = await browserManager.getBrowserInfo();
        console.log('Browser found:', browserInfo);
        
        // Create launch options
        const launchOptions = await browserManager.createLaunchOptions();
        
        // Launch browser
        const browser = await puppeteer.launch(launchOptions);
        console.log('Browser launched successfully');
        
        await browser.close();
        
    } catch (error) {
        console.error('Failed to launch browser:', error);
        
        // Fallback: Try with system Chrome
        console.log('Attempting fallback with system Chrome...');
        try {
            const fallbackOptions = await browserManager.createLaunchOptions({
                executablePath: '/usr/bin/google-chrome' // Force system Chrome
            });
            
            const browser = await puppeteer.launch(fallbackOptions);
            console.log('Fallback browser launched successfully');
            
            await browser.close();
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
    }
}

/**
 * Example 5: Batch browser operations
 */
export async function exampleBatchOperations() {
    console.log('=== Example 5: Batch Browser Operations ===');
    
    const browsers: puppeteer.Browser[] = [];
    const pages: puppeteer.Page[] = [];
    
    try {
        // Launch multiple browsers
        for (let i = 0; i < 3; i++) {
            const launchOptions = await browserManager.createLaunchOptions({
                headless: true,
                args: [`--user-data-dir=/tmp/chrome-${i}`]
            });
            
            const browser = await puppeteer.launch(launchOptions);
            const page = await browser.newPage();
            
            browsers.push(browser);
            pages.push(page);
            
            console.log(`Browser ${i + 1} launched`);
        }
        
        // Perform operations on all pages
        const promises = pages.map(async (page, index) => {
            await page.goto(`https://httpbin.org/delay/${index + 1}`);
            const title = await page.title();
            console.log(`Page ${index + 1} title:`, title);
        });
        
        await Promise.all(promises);
        
    } finally {
        // Clean up all browsers
        for (const browser of browsers) {
            try {
                await browser.close();
            } catch (error) {
                console.error('Failed to close browser:', error);
            }
        }
        console.log('All browsers closed');
    }
}

// Export all examples for easy testing
export const examples = {
    defaultManager: exampleWithDefaultManager,
    customManager: exampleWithCustomManager,
    puppeteerExtra: exampleWithPuppeteerExtra,
    errorHandling: exampleWithErrorHandling,
    batchOperations: exampleBatchOperations
}; 