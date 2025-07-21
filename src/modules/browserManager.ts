import * as puppeteer from 'puppeteer';
import { detectBrowserPlatform, install, canDownload, Browser as PuppeteerBrowser, getInstalledBrowsers, resolveBuildId } from '@puppeteer/browsers';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Default Chrome build ID
const DEFAULT_CHROME_BUILD_ID = '136.0.7103.94';

export interface BrowserManagerOptions {
    chromeBuildId?: string;
    cacheDir?: string;
    useLocalBrowser?: boolean;
    localBrowserPath?: string;
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
     * Create launch options with browser executable path
     */
    async createLaunchOptions(customOptions?: puppeteer.LaunchOptions): Promise<puppeteer.LaunchOptions> {
        const browserInfo = await this.getBrowserExecutablePath();
        const defaultOptions = this.getDefaultLaunchOptions();
        
        return {
            ...defaultOptions,
            ...customOptions,
            executablePath: browserInfo.executablePath || undefined,
            args: [
                ...defaultOptions.args || [],
                ...(customOptions?.args || [])
            ]
        };
    }

    /**
     * Get browser information
     */
    async getBrowserInfo(): Promise<BrowserInfo> {
        return await this.getBrowserExecutablePath();
    }
}

// Export a default instance for convenience
export const browserManager = new BrowserManager();

// Export utility functions for backward compatibility
export const getCacheDir = () => browserManager.getCacheDir();
export const getLatestChromeVersion = () => browserManager.getLatestChromeVersion(); 