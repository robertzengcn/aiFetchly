import * as puppeteer from 'puppeteer';
import { addExtra } from 'puppeteer-extra';
import { detectBrowserPlatform, install, canDownload, Browser as PuppeteerBrowser, getInstalledBrowsers, resolveBuildId } from '@puppeteer/browsers';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// Create enhanced puppeteer with stealth plugin
const puppeteerExtra = addExtra(puppeteer as any);
//const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

// Default Chrome build ID
const DEFAULT_CHROME_BUILD_ID = '136.0.7103.94';

export interface BrowserManagerOptions {
    chromeBuildId?: string;
    cacheDir?: string;
    useLocalBrowser?: boolean;
    localBrowserPath?: string;
    enableStealth?: boolean;
}

export interface BrowserInfo {
    executablePath: string;
    buildId: string;
    isSystemBrowser: boolean;
    isCachedBrowser: boolean;
}

export class BrowserManager {
    private options: BrowserManagerOptions;

    constructor(options: BrowserManagerOptions = {}) {
        this.options = {
            chromeBuildId: DEFAULT_CHROME_BUILD_ID,
            cacheDir: this.getCacheDir(),
            useLocalBrowser: false,
            localBrowserPath: process.env.LOCAL_BROWSER_EXCUTE_PATH,
            enableStealth: true, // Enable stealth mode by default
            ...options
        };
    }

    /**
     * Get the cache directory path for Puppeteer
     */
    getCacheDir(): string {
        const homeDir = os.homedir();
        return path.join(homeDir, '.cache', 'puppeteer');
    }

    /**
     * Get the latest Chrome version
     */
    async getLatestChromeVersion(): Promise<string> {
        try {
            const platform = await detectBrowserPlatform();
            if (platform) {
                const browser = 'chrome' as PuppeteerBrowser;
                const latestBuildId = await resolveBuildId(browser, platform, 'latest');
                return latestBuildId;
            }
        } catch (error) {
            console.error('Failed to resolve latest Chrome version:', error);
        }
        return this.options.chromeBuildId || DEFAULT_CHROME_BUILD_ID;
    }

    /**
     * Check if a system Chrome installation exists
     */
    private findSystemChrome(): string | undefined {
        const commonPaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
            '/usr/bin/google-chrome', // Linux
            '/usr/bin/google-chrome-stable', // Linux
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' // Windows 32-bit
        ];

        for (const path of commonPaths) {
            if (fs.existsSync(path)) {
                console.log('Found system Chrome at:', path);
                return path;
            }
        }
        return undefined;
    }

    /**
     * Check for cached Chrome installation
     */
    private async findCachedChrome(): Promise<string | undefined> {
        try {
            const installedBrowsers = await getInstalledBrowsers({ cacheDir: this.options.cacheDir || '' });
            const chromeInstallation = installedBrowsers.find(
                installed => installed.browser === 'chrome'
            );
            
            if (chromeInstallation) {
                console.log('Found cached Chrome installation:', chromeInstallation.executablePath);
                return chromeInstallation.executablePath;
            }
        } catch (error) {
            console.error('Failed to check cached browsers:', error);
        }
        return undefined;
    }

    /**
     * Install Chrome browser
     */
    private async installChrome(): Promise<string | undefined> {
        try {
            const platform = await detectBrowserPlatform();
            if (!platform) {
                throw new Error('Failed to detect browser platform');
            }

            const browser = 'chrome' as PuppeteerBrowser;
            const buildId = this.options.chromeBuildId || DEFAULT_CHROME_BUILD_ID;
            
            console.log('Installing Chrome version:', buildId);
            
            const canDownloadBrowser = await canDownload({
                browser,
                buildId,
                platform,
                cacheDir: this.options.cacheDir || this.getCacheDir()
            });
            
            if (canDownloadBrowser) {
                await install({
                    browser,
                    buildId,
                    platform,
                    cacheDir: this.options.cacheDir || this.getCacheDir()
                });
                
                // Get the installed browser path
                return await this.findCachedChrome();
            } else {
                console.error('Cannot download Chrome browser');
            }
        } catch (error) {
            console.error('Failed to install Chrome:', error);
        }
        return undefined;
    }

    /**
     * Get browser executable path with fallback strategy
     */
    async getBrowserExecutablePath(): Promise<BrowserInfo> {
        let executablePath: string | undefined;
        let isSystemBrowser = false;
        let isCachedBrowser = false;
        let buildId = this.options.chromeBuildId || DEFAULT_CHROME_BUILD_ID;

        // 1. Check for local browser path from environment
        if (this.options.localBrowserPath && fs.existsSync(this.options.localBrowserPath)) {
            executablePath = this.options.localBrowserPath;
            console.log('Using local browser installation:', executablePath);
            return {
                executablePath,
                buildId,
                isSystemBrowser: false,
                isCachedBrowser: false
            };
        }

        // 2. Check for cached Chrome installation
        executablePath = await this.findCachedChrome();
        if (executablePath) {
            isCachedBrowser = true;
            return {
                executablePath,
                buildId,
                isSystemBrowser,
                isCachedBrowser
            };
        }

        // 3. Try to install Chrome
        try {
            executablePath = await this.installChrome();
            if (executablePath) {
                isCachedBrowser = true;
                return {
                    executablePath,
                    buildId,
                    isSystemBrowser,
                    isCachedBrowser
                };
            }
        } catch (error) {
            console.error('Failed to install Chrome:', error);
        }

        // 4. Fallback to system Chrome
        executablePath = this.findSystemChrome();
        if (executablePath) {
            isSystemBrowser = true;
            return {
                executablePath,
                buildId,
                isSystemBrowser,
                isCachedBrowser
            };
        }

        // 5. If all else fails, return undefined (will use Puppeteer's bundled Chrome)
        console.warn('No Chrome installation found, will use Puppeteer bundled Chrome');
        return {
            executablePath: '',
            buildId,
            isSystemBrowser: false,
            isCachedBrowser: false
        };
    }

    /**
     * Get comprehensive anti-detection launch options
     */
    getStealthLaunchOptions(): puppeteer.LaunchOptions {
        return {
            headless: false, // Use non-headless mode for better stealth
            args: [
                // Basic stealth arguments
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                
                // Hide automation indicators
                '--disable-automation',
                '--disable-extensions-except',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                
                // Performance and stability
                '--no-first-run',
                '--no-default-browser-check',
                '--no-pings',
                '--no-zygote',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--mute-audio',
                '--no-first-run',
                '--safebrowsing-disable-auto-update',
                '--ignore-certificate-errors',
                '--ignore-ssl-errors',
                '--ignore-certificate-errors-spki-list',
                
                // Window and display
                '--window-size=1920,1080',
                '--start-maximized',
                '--disable-infobars',
                '--disable-notifications',
                '--disable-popup-blocking',
                
                // User agent and language
                '--lang=en-US,en',
                '--accept-lang=en-US,en',
                
                // Memory and process management
                '--memory-pressure-off',
                '--max_old_space_size=4096',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                
                // Network and security
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--allow-running-insecure-content',
                '--disable-site-isolation-trials',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                
                // Additional stealth measures
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection'
            ],
            ignoreDefaultArgs: [
                '--enable-automation',
                '--enable-blink-features=AutomationControlled'
            ]
        };
    }

    /**
     * Get default launch options for Puppeteer
     */
    getDefaultLaunchOptions(): puppeteer.LaunchOptions {
        return {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--disable-blink-features=AutomationControlled',
            ],
            headless: true,
        };
    }

    /**
     * Create launch options with browser executable path and stealth mode
     */
    async createLaunchOptions(customOptions?: puppeteer.LaunchOptions): Promise<puppeteer.LaunchOptions> {
        const browserInfo = await this.getBrowserExecutablePath();
        const baseOptions = this.options.enableStealth ? 
            this.getStealthLaunchOptions() : 
            this.getDefaultLaunchOptions();
        
        return {
            ...baseOptions,
            ...customOptions,
            executablePath: browserInfo.executablePath || undefined,
            args: [
                ...baseOptions.args || [],
                ...(customOptions?.args || [])
            ]
        };
    }

    /**
     * Launch browser with stealth mode using puppeteer-extra
     */
    async launchWithStealth(options?: puppeteer.LaunchOptions): Promise<puppeteer.Browser> {
        const launchOptions = await this.createLaunchOptions(options);
        return puppeteerExtra.launch(launchOptions);
    }

    /**
     * Launch browser without stealth mode using regular puppeteer
     */
    async launchWithoutStealth(options?: puppeteer.LaunchOptions): Promise<puppeteer.Browser> {
        const launchOptions = await this.createLaunchOptions(options);
        return puppeteer.launch(launchOptions);
    }

    /**
     * Get browser information
     */
    async getBrowserInfo(): Promise<BrowserInfo> {
        return await this.getBrowserExecutablePath();
    }

    /**
     * Get random user agent for better stealth
     */
    getRandomUserAgent(): string {
        const userAgents = [
            // Windows Chrome
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
            
            // macOS Chrome
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            
            // Linux Chrome
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            
            // Windows Edge
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
            
            // macOS Safari
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
        ];
        
        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    /**
     * Get random viewport dimensions for better stealth
     */
    getRandomViewport(): { width: number; height: number } {
        const viewports = [
            { width: 1920, height: 1080 },
            { width: 1366, height: 768 },
            { width: 1536, height: 864 },
            { width: 1440, height: 900 },
            { width: 1280, height: 720 },
            { width: 1600, height: 900 },
            { width: 1024, height: 768 },
            { width: 1680, height: 1050 }
        ];
        
        return viewports[Math.floor(Math.random() * viewports.length)];
    }
}

// Export a default instance for convenience
export const browserManager = new BrowserManager();

// Export utility functions for backward compatibility
export const getCacheDir = () => browserManager.getCacheDir();
export const getLatestChromeVersion = () => browserManager.getLatestChromeVersion(); 