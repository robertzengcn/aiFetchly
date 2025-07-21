import { WorkerInstance } from 'puppeteer-cluster/dist/concurrency/ConcurrencyImplementation';
import * as puppeteer from 'puppeteer';
import { timeoutExecute } from 'puppeteer-cluster/dist/util';
import {Browser} from 'puppeteer-cluster/dist/concurrency/builtInConcurrency';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import vanillaPuppeteer from 'puppeteer';
import {addExtra} from 'puppeteer-extra';
import { browserManager } from './browserManager';

const BROWSER_TIMEOUT = 5000;

// Browser management is now handled by browserManager

export class CustomConcurrency extends Browser {

    async init() {
        //init
    }
    async close() {
        //close
    }

    async workerInstance(perBrowserOptions: puppeteer.LaunchOptions | undefined):Promise<WorkerInstance> {
        const options = perBrowserOptions || this.options;
        
        // Use browser manager to get executable path and create launch options
        const launchOptions = await browserManager.createLaunchOptions(options);
        console.log('launchOptions', launchOptions);
        const puppeteers = addExtra(vanillaPuppeteer);
        puppeteers.use(StealthPlugin());
        // puppeteers.use(AdblockerPlugin({
        //     // Block trackers
        //     blockTrackers: true
        // }));
        // Only add reCAPTCHA plugin if token exists and is not empty
        if (process.env.TWOCAPTCHA_TOKEN && process.env.TWOCAPTCHA_TOKEN.trim() !== '') {
            puppeteers.use(
                RecaptchaPlugin({
                    provider: {
                        id: '2captcha',
                        token: process.env.TWOCAPTCHA_TOKEN,
                    },
                    visualFeedback: true,
                    solveInViewportOnly: true,
                    solveScoreBased: true,
                    solveInactiveChallenges: true,
                })
            );
        }
        // Add reCAPTCHA solver
        // puppeteers.use(
        //     RecaptchaPlugin({
        //         provider: {
        //             id: '2captcha',
        //             token: process.env.TWOCAPTCHA_TOKEN || '', // Your 2captcha API token
        //         },
        //         visualFeedback: true, // Show a visual feedback when solving a CAPTCHA
        //         solveInViewportOnly: true, // Only solve CAPTCHAs that are in the viewport
        //         solveScoreBased: true, // Solve score-based CAPTCHAs
        //         solveInactiveChallenges: true, // Solve inactive challenges
        //     })
        // );
        
        let chrome = await puppeteers.launch(launchOptions) as puppeteer.Browser;
        let page: puppeteer.Page;
        let context;

        return {
            jobInstance: async () => {
                await timeoutExecute(BROWSER_TIMEOUT, (async () => {
                    try {
                        context = await chrome.createBrowserContext();
                        page = await context.newPage();
                    } catch (error) {
                        console.error('Failed to create browser context or page:', error);
                        throw error; // Re-throw to let the timeout handler deal with it
                    }
                    
                    // Additional anti-detection measures
                    await page.evaluateOnNewDocument(() => {
                        // Overwrite the 'navigator.webdriver' property
                        // Object.defineProperty(navigator, 'webdriver', {
                        //     get: () => undefined
                        // });
                        
                        // Overwrite the 'plugins' property
                        // Object.defineProperty(navigator, 'plugins', {
                        //     get: () => {
                        //         const plugins = [
                        //             {
                        //                 name: 'Chrome PDF Plugin',
                        //                 filename: 'internal-pdf-viewer',
                        //                 description: 'Portable Document Format',
                        //                 version: '1.0.0'
                        //             },
                        //             {
                        //                 name: 'Chrome PDF Viewer',
                        //                 filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                        //                 description: 'Portable Document Format',
                        //                 version: '1.0.0'
                        //             },
                        //             {
                        //                 name: 'Native Client',
                        //                 filename: 'internal-nacl-plugin',
                        //                 description: 'Native Client Executable',
                        //                 version: '1.0.0'
                        //             }
                        //         ];

                        //         const pluginArray = {
                        //             length: plugins.length,
                        //             refresh: () => {},
                        //             item: (index: number) => plugins[index],
                        //             namedItem: (name: string) => plugins.find(p => p.name === name),
                        //             [Symbol.iterator]: function* () {
                        //                 for (let i = 0; i < plugins.length; i++) {
                        //                     yield plugins[i];
                        //                 }
                        //             }
                        //         };

                        //         // Add numeric properties
                        //         plugins.forEach((plugin, index) => {
                        //             Object.defineProperty(pluginArray, index, {
                        //                 value: plugin,
                        //                 enumerable: true
                        //             });
                        //         });

                        //         return pluginArray;
                        //     }
                        // });
                        
                        // Overwrite the 'languages' property
                        Object.defineProperty(navigator, 'languages', {
                            get: () => ['en-US', 'en']
                        });

                        // Add permissions API
                        // Object.defineProperty(navigator, 'permissions', {
                        //     get: () => ({
                        //         query: async (permissionDesc: { name: string }) => {
                        //             const permissionStates = {
                        //                 'geolocation': 'prompt',
                        //                 'notifications': 'prompt',
                        //                 'push': 'prompt',
                        //                 'midi': 'prompt',
                        //                 'camera': 'prompt',
                        //                 'microphone': 'prompt',
                        //                 'speaker': 'prompt',
                        //                 'device-info': 'prompt',
                        //                 'background-fetch': 'prompt',
                        //                 'background-sync': 'prompt',
                        //                 'bluetooth': 'prompt',
                        //                 'persistent-storage': 'prompt',
                        //                 'ambient-light-sensor': 'prompt',
                        //                 'accelerometer': 'prompt',
                        //                 'gyroscope': 'prompt',
                        //                 'magnetometer': 'prompt',
                        //                 'clipboard-read': 'prompt',
                        //                 'clipboard-write': 'prompt',
                        //                 'payment-handler': 'prompt'
                        //             };
                                    
                        //             return {
                        //                 state: permissionStates[permissionDesc.name] || 'prompt',
                        //                 onchange: null
                        //             };
                        //         }
                        //     })
                        // });

                        // Set WebGL vendor and renderer
                        // const getParameter = WebGLRenderingContext.prototype.getParameter;
                        // WebGLRenderingContext.prototype.getParameter = function(parameter) {
                        //     // UNMASKED_VENDOR_WEBGL
                        //     if (parameter === 37445) {
                        //         return 'Intel Inc.';
                        //     }
                        //     // UNMASKED_RENDERER_WEBGL
                        //     if (parameter === 37446) {
                        //         return 'Intel Iris OpenGL Engine';
                        //     }
                        //     return getParameter.apply(this, [parameter]);
                        // };
                        
                        // Add Chrome-specific properties
                        (window as any).chrome = {
                            runtime: {},
                            loadTimes: function() {},
                            csi: function() {},
                            app: {}
                        };
                    });
                    
                    // Set a realistic user agent
                    //await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
                    
                    // Enable JavaScript
                    await page.setJavaScriptEnabled(true);
                    
                    // Set extra HTTP headers
                    // await page.setExtraHTTPHeaders({
                    //     'Accept-Language': 'en-US,en;q=0.9',
                    //     'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    //     'Accept-Encoding': 'gzip, deflate, br',
                    //     'Connection': 'keep-alive',
                    //     'Upgrade-Insecure-Requests': '1'
                    // });
                })());

                return {
                    resources: {
                        page,
                    },

                    close: async () => {
                        try {
                            await timeoutExecute(BROWSER_TIMEOUT, context.close());
                        } catch (error) {
                            console.error('Failed to close browser context:', error);
                            // Force close if timeout occurs
                            try {
                                await context.close();
                            } catch (forceCloseError) {
                                console.error('Failed to force close browser context:', forceCloseError);
                            }
                        }
                    },
                };
            },

            close: async () => {
                try {
                    await timeoutExecute(BROWSER_TIMEOUT, chrome.close());
                } catch (error) {
                    console.error('Failed to close browser:', error);
                    // Force close if timeout occurs
                    try {
                        await chrome.close();
                    } catch (forceCloseError) {
                        console.error('Failed to force close browser:', forceCloseError);
                    }
                }
            },

            repair: async () => {
                // debug('Starting repair');
                try {
                    // will probably fail, but just in case the repair was not necessary
                    await timeoutExecute(BROWSER_TIMEOUT, chrome.close());
                } catch (e) {
                    // debug('Failed to close chrome: %o', e);
                    // Browser already closed or failed to close, continue with relaunch
                }

                // Relaunch with the same enhanced puppeteer instance
                const puppeteers = addExtra(vanillaPuppeteer);
                puppeteers.use(StealthPlugin());
                
                // Only add reCAPTCHA plugin if token exists and is not empty
                if (process.env.TWOCAPTCHA_TOKEN && process.env.TWOCAPTCHA_TOKEN.trim() !== '') {
                    puppeteers.use(
                        RecaptchaPlugin({
                            provider: {
                                id: '2captcha',
                                token: process.env.TWOCAPTCHA_TOKEN,
                            },
                            visualFeedback: true,
                            solveInViewportOnly: true,
                            solveScoreBased: true,
                            solveInactiveChallenges: true,
                        })
                    );
                }
                
                // Use browser manager to get updated launch options
                const repairLaunchOptions = await browserManager.createLaunchOptions(options);
                chrome = await puppeteers.launch(repairLaunchOptions) as puppeteer.Browser;
            },
        };
    }
}
export default CustomConcurrency;

