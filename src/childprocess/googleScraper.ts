'use strict';
import { SearchScrape } from "@/childprocess/searchScraper"
import { ScrapeOptions, SearchData, SearchResult } from "@/entityTypes/scrapeType"
import { CustomError } from "@/modules/customError"
import * as fs from "fs";
import * as path from "path";
// import debug from 'debug';
// import { e } from "vitest/dist/reporters-1evA5lom";
//import { R } from "vitest/dist/reporters-1evA5lom";
// import { Page } from 'puppeteer';
// import { promises } from "dns";
// const logger = debug('SearchScrape');

// type googleAdobjLinks = {
//     tracking_link: string;
//     link: string;
//     title: string;
// }
// type googleAdobj = {
//     visible_link?: string;
//     tracking_link?: string;
//     link: string;
//     title: string;
//     snippet: string;
//     links?: Array<googleAdobjLinks>,
// }

export type googlePlaces = {
    heading: string;
    rating: string;
    contact: string;
    hours: string;
}

export type GoogleResultAnchorSnapshot = {
    href: string;
    text: string;
    hasHeading: boolean;
    headingText?: string;
    ariaLabel?: string | null;
};

export type GoogleResultSnapshot = {
    htmlPreview: string;
    anchors: GoogleResultAnchorSnapshot[];
    headings: string[];
    citeTexts: string[];
    snippetTexts: string[];
};

type GoogleSelectorDiagnostic = {
    selector: string;
    elementCount: number;
    parsedCount: number;
    validCount: number;
    samples: Array<{
        title: string;
        link: string;
        snippet: string;
        htmlPreview: string;
    }>;
};

export class GoogleScraper extends SearchScrape {
    search_engine_name = "google"
    private readonly searchSelectors = [
        'textarea[name="q"]',
        'input[name="q"]',
        'input[type="search"]',
        'input.search-input',
        'input.search',
        'input#search',
        'input.searchbox',
        'input.search-field'
    ];

    constructor(options: ScrapeOptions) {
        super(options);
    }

    protected override getSearchSelectorsForAi(): Record<string, string> {
        const r: Record<string, string> = {};
        this.searchSelectors.forEach((sel, i) => {
            r[`search_input_${i}`] = sel;
        });
        return r;
    }
    // async searchData(data: ClusterSearchData): Promise<void> {
    //     // logger("search data in google")
    //     if(data.page){
    //         this.page=data.page
    //     }
    //     await this.load_start_page()
    //     await this.search_keyword(data.keywords)
    // }


    async parse_async(): Promise<SearchData> {

        // const _text = (el, s) => {
        //     const n = el.querySelector(s);

        //     if (n) {
        //         return n.innerText;
        //     } else {
        //         return '';
        //     }
        // };
        // const _attr = (el, s, attr) => {
        //     const n = el.querySelector(s);

        //     if (n) {
        //         return n.getAttribute(attr);
        //     } else {
        //         return null;
        //     }
        // };

        // const results = await this.page.evaluate(() => {





        //     const results: SearchData = {
        //         num_results: '',
        //         no_results: false,
        //         effective_query: '',
        //         right_info: {},
        //         results: [],
        //         top_products: [],
        //         right_products: [],
        //         top_ads: [],
        //         bottom_ads: [],
        //         // places: [],
        //     };

        //     const num_results_el = document.getElementById('resultStats');

        //     if (num_results_el) {
        //         results.num_results = num_results_el.innerText;
        //     }

        //     const organic_results = document.querySelectorAll('#search .MjjYud');

        //     organic_results.forEach((el) => {

        //         const serp_obj = {
        //             link: _attr(el, '.yuRUbf a', 'href'),
        //             title: _text(el, '.yuRUbf a h3'),
        //             snippet: _text(el, '.VwiC3b span'),
        //             visible_link: _text(el, '.yuRUbf cite'),
        //             // date: _text(el, 'span.f'),
        //         };


        //         results.results.push(serp_obj);
        //     });


        //     // check if no results
        //     results.no_results = (results.results.length === 0);

        // const parseAds = (container, selector) => {
        //     document.querySelectorAll(selector).forEach((el) => {
        //         const ad_obj: googleAdobj = {
        //             // visible_link: _text(el, '.ads-visurl cite'),
        //             // tracking_link: _attr(el, 'a:first-child', 'href'),
        //             link: _attr(el, 'a', 'href'),
        //             title: _text(el, 'span:nth-child(2)'),
        //             snippet: _text(el, '.Va3FIb span'),
        //             links: [],
        //         };
        //         // el.querySelectorAll('ul li a').forEach((node) => {
        //         //     ad_obj.links.push({
        //         //         tracking_link: node.getAttribute('data-arwt'),
        //         //         link: node.getAttribute('href'),
        //         //         title: node.innerText,
        //         //     })
        //         // });
        //         container.push(ad_obj);
        //     });
        // };

        //     parseAds(results.top_ads, '#tvcap .uEierd');
        //     parseAds(results.bottom_ads, '#tadsb .uEierd');




        //     return results;
        // });



        // clean some results
        // results.top_products = this.clean_results(results.top_products, ['title', 'link']);
        // results.right_products = this.clean_results(results.right_products, ['title', 'link']);
        // results.results = this.clean_results(results.results, ['title', 'link' , 'snippet']);
        
        
        // Wait for network to be idle
        await this.page.waitForNetworkIdle({ timeout: 30000 }).catch(() => {
            this.logger.warn('Timeout waiting for network idle');
        });
        
        // Additional wait to ensure dynamic content is loaded
        await new Promise(resolve => setTimeout(resolve, 2000));
        // results.time = (new Date()).toUTCString();
        const result: SearchData = {
            num_results: '',
            no_results: false,
            effective_query: '',
            right_info: {},
            results: [],
            top_products: [],
            right_products: [],
            top_ads: [],
            bottom_ads: [],
            // places: [],
        };
        //let searchRes: SearchResult[] = [];
        //  const searchResultsExist = await this.page.$('#search .MjjYud');
        //  if (!searchResultsExist) {
        // Try alternative selectors for search results
        const alternativeSelectors = this.getResultContainerSelectors();
        let findelement=false
        const diagnostics: GoogleSelectorDiagnostic[] = [];
        for (const selector of alternativeSelectors) {
            this.logger.info(`Searching for results with selector: ${selector}`);
            const diagnostic = await this.collectSelectorDiagnostic(selector);
            diagnostics.push(diagnostic);
            this.logger.info(
                `Google selector diagnostic: selector=${selector}, elements=${diagnostic.elementCount}, parsed=${diagnostic.parsedCount}, valid=${diagnostic.validCount}`
            );
            if (diagnostic.samples.length > 0) {
                this.logger.info(`Google selector sample: ${JSON.stringify(diagnostic.samples[0])}`);
            }
            if (diagnostic.validCount > 0) {
                findelement=true
                this.logger.info(`Found results with alternative selector: ${selector}`);
                this.page.on('console', msg => {
                    console.log(`Browser console: ${msg.text()}`);
                });
                // Found results with alternative selector
                const searchRes = await this.parseSearchResults(selector);
                this.page.removeAllListeners('console');
                this.logger.info(`Found ${searchRes.length} results with alternative selector: ${selector}`);
                for (const resValue of searchRes) {
                    console.log(`resValue: ${resValue}`);
                    result.results.push(resValue);
                }
                break; // Exit loop once we find results
            }
        }
        await this.writeParseDiagnostics(diagnostics);
        if(!findelement){
            // Try AI recovery before throwing error
            const recoveryResult = await this.tryAIRecovery(
                'parse_results',
                'No search results found with standard selectors',
                alternativeSelectors
            );

            if (recoveryResult.success) {
                // Retry parsing after recovery actions
                const networkIdleTimeout = this.config.ai_recovery?.networkIdleTimeoutMs || 30000;
                const recoveryDelay = this.config.ai_recovery?.recoveryDelayMs || 2000;

                await this.page.waitForNetworkIdle({ timeout: networkIdleTimeout }).catch(() => {
                    this.logger.warn('Timeout waiting for network idle after recovery');
                });
                await new Promise(resolve => setTimeout(resolve, recoveryDelay));

                // Try parsing again with the first selector
                for (const selector of alternativeSelectors) {
                    const diagnostic = await this.collectSelectorDiagnostic(selector);
                    if (diagnostic.validCount > 0) {
                        const searchRes = await this.parseSearchResults(selector);

                        for (const resValue of searchRes) {
                            result.results.push(resValue);
                        }

                        this.logger.info('AI recovery successful, found results after recovery');
                        return result;
                    }
                }
            }

            throw new CustomError("No search results found,may be element not found in the list page", 202405301120304);
        }
        //  }else{
        //  searchRes= await this.page.$$eval('#search .MjjYud', elements =>
        //     elements.map(el => {
        //         const link=el.querySelector('.yuRUbf a')?.getAttribute('href')

        //         const title=el.querySelector('.yuRUbf a h3')?.textContent


        //                 const serp_obj:SearchResult  = {
        //                     // link: await (window as any)._attr(el, '.yuRUbf a', 'href'),
        //                     //link: el.getAttribute('href'),
        //                     link:link?link:'',
        //                     // title: await (window as any)._text(el, '.yuRUbf a h3'),
        //                     title:title,
        //                     //snippet: await (window as any)._text(el, '.VwiC3b span'),
        //                     snippet: el.querySelector('.VwiC3b span')?.textContent,
        //                     //visible_link: await (window as any)._text(el, '.yuRUbf cite'),
        //                     visible_link: el.querySelector('.yuRUbf cite')?.textContent,
        //                     // date: _text(el, 'span.f'),
        //                 }
        //                 return serp_obj 
        //             }
        // ))
        // }
        // console.log(searchRes)
        // if (!searchRes || searchRes.length === 0) {
        //     throw new CustomError('No search results found,may be element not found', 202405301120304);
        // }
        // for (const resValue of searchRes) {

        //     result.results.push(resValue);
        // }

        // const topad=await this.page.$$eval('#tvcap .uEierd', elements =>elements.map(
        //     el => async () =>{
        //         const ad_obj: SearchResult = {
        //             // visible_link: _text(el, '.ads-visurl cite'),
        //             // tracking_link: _attr(el, 'a:first-child', 'href'),
        //             // link: await (window as any)._attr(el, 'a', 'href'),
        //             link: el.querySelector('a')?.getAttribute('href'),
        //             //title: await (window as any)._text(el, 'span:nth-child(2)'),
        //             title: el.querySelector('span:nth-child(2)')?.textContent,
        //             //snippet: await (window as any)._text(el, '.Va3FIb span'),
        //             snippet: el.querySelector('.Va3FIb span')?.textContent,
        //             // links: [],
        //         };

        //         return ad_obj
        //     }
        // ))
        // for( const tValue of topad){
        //     const atValue = await tValue();
        //     result.results.push(atValue)
        // }
        // const bottomAd=await this.page.$$eval('#tadsb .uEierd', elements =>elements.map(
        //     el => async () =>{
        //         const ad_obj: SearchResult = {
        //             // visible_link: _text(el, '.ads-visurl cite'),
        //             // tracking_link: _attr(el, 'a:first-child', 'href'),
        //             //link: await (window as any)._attr(el, 'a', 'href'),
        //             link: el.querySelector('a')?.getAttribute('href'),
        //             title:el.querySelector('span:nth-child(2)')?.textContent,
        //             //snippet: await (window as any)._text(el, '.Va3FIb span'),
        //             snippet: el.querySelector('.Va3FIb span')?.textContent,
        //             // links: [],
        //         };

        //         return ad_obj
        //     }
        // ))
        // for( const tValue of bottomAd){
        //     const atValue= await tValue();
        //     result.results.push(atValue)
        // }
        // const num=await this.page.$eval('#resultStats', el => el.textContent);
        // if(num){
        //     result.num_results = num;
        // }
        console.log(`result: ${result}`);
        return result;
    }

    async load_start_page(): Promise<boolean | void> {
        const startUrl = 'https://www.google.com/ncr';//ncr means no country redirect

        this.logger.info('Using startUrl: ' + startUrl);

        this.last_response = await this.page.goto(startUrl, {
            waitUntil: "networkidle2",
            timeout: 60000
        });

        // Wait for page to be fully loaded
        await this.page.waitForFunction(() => {
            return document.readyState === 'complete';
        }, { timeout: this.STANDARD_TIMEOUT });

        // Check for and click cookie consent button if present (Bing-style cookie banner)
        try {
            const cookieButton = await this.page.$('#bnp_btn_accept');
            if (cookieButton) {
                this.logger.info('Found cookie consent button, clicking it');
                await cookieButton.click();
                // Wait a bit for the cookie banner to disappear
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            // Cookie button not found or already dismissed - this is fine
            this.logger.debug('Cookie consent button not found or already dismissed');
        }

        // Wait for user to take action
        // this.logger.info('Waiting for user to take action...');

        // // Display a message on the page to inform the user
        // await this.page.evaluate(() => {
        //     const div = document.createElement('div');
        //     div.style.position = 'fixed';
        //     div.style.top = '0';
        //     div.style.left = '0';
        //     div.style.width = '100%';
        //     div.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
        //     div.style.color = 'white';
        //     div.style.padding = '10px';
        //     div.style.zIndex = '9999';
        //     div.style.textAlign = 'center';
        //     div.style.fontSize = '16px';
        //     div.textContent = 'Please take action and press Enter when ready to continue...';
        //     document.body.appendChild(div);
        // });

        // // Wait for user to press Enter
        // await this.page.waitForFunction(() => {
        //     return new Promise(resolve => {
        //         const listener = (e) => {
        //             if (e.key === 'Enter') {
        //                 document.removeEventListener('keydown', listener);
        //                 resolve(true);
        //             }
        //         };
        //         document.addEventListener('keydown', listener);
        //     });
        // }, { timeout: 0 }); // No timeout, wait indefinitely

        // // Remove the message
        // await this.page.evaluate(() => {
        //     const div = document.querySelector('div[style*="position: fixed"]');
        //     if (div) div.remove();
        // });

        // this.logger.info('User action completed, continuing...');

        // Try multiple selectors for the search input
        for (const selector of this.searchSelectors) {
            try {
                const element = await this.page.$(selector);
                if (element) {
                    this.logger.info(`Found search input with selector: ${selector}`);
                    return true;
                }
            } catch (error) {
                continue;
            }
        }

        throw new CustomError("No search input found with any of the common selectors", 202405301120304);
    }

    async search_keyword(keyword: string) {
        for (const selector of this.searchSelectors) {
            try {
                const input = await this.page.$(selector);
                if (input) {
                    // Check if the element is a textarea
                    const tagName = await this.page.evaluate((el) => el.tagName.toLowerCase(), input);
                    
                    if (tagName === 'textarea') {
                        // Handle textarea: focus, type, press Enter, wait for navigation
                        await input.focus();
                        await this.page.keyboard.type(keyword, { delay: Math.random() * 100 + 50 });
                        await this.page.keyboard.press('Enter');
                        
                        // Wait for navigation
                        try {
                            await this.page.waitForNavigation({ timeout: 5000 });
                        } catch {
                            // If navigation doesn't happen, find the form and submit it
                            await input.evaluate((el) => {
                                const form = el.closest('form') as HTMLFormElement;
                                if (form) {
                                    console.log("Form found and submitting");
                                    form.submit();
                                }
                            });
                        }
                        return;
                    } else {
                        // Handle input elements with the original mouse movement approach
                        // Get input element position
                        const inputBox = await input.boundingBox();
                        if (!inputBox) {
                            throw new Error('Could not get input box position');
                        }

                        // Generate random coordinates within the input box
                        const randomX = inputBox.x + Math.random() * inputBox.width;
                        const randomY = inputBox.y + Math.random() * inputBox.height;

                        // Move mouse with random speed
                        const steps = 10 + Math.floor(Math.random() * 20); // Random number of steps
                        const stepDelay = 50 + Math.random() * 100; // Random delay between steps

                        for (let i = 0; i < steps; i++) {
                            const progress = i / steps;
                            const currentX = randomX * progress;
                            const currentY = randomY * progress;

                            await this.page.mouse.move(currentX, currentY);
                            await new Promise(resolve => setTimeout(resolve, stepDelay));
                        }

                        // Final click with random delay
                        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
                        await this.page.mouse.click(randomX, randomY);
                        // Type each character with random delays to simulate human typing
                        for (const char of keyword) {
                            await this.page.keyboard.type(char, {
                                delay: 50 + Math.random() * 150 // Random delay between 50-200ms per character
                            });
                            // Add occasional longer pauses between words
                            if (char === ' ') {
                                await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
                            }
                        }
                        
                        await this.page.evaluate(async () => {
                            await new Promise(function (resolve) {
                                setTimeout(resolve, 1000)
                            });
                        });
                        await input.focus();
                        await this.page.keyboard.press("Enter");
                        return;
                    }
                }else{
                    throw new CustomError("input keyword button not found", 202405301120303)
                }
            } catch (error) {
                continue;
            }
        }

        // All selectors failed - try AI recovery
        const recoveryResult = await this.tryAIRecovery(
            'search_input',
            'No search input found with standard selectors',
            this.searchSelectors,
            { keyword }
        );

        if (recoveryResult.success) {
            // Now type the keyword using the recovered input
            await this.page.keyboard.type(keyword, { delay: 50 + Math.random() * 100 });
            await this.page.keyboard.press('Enter');
            this.logger.info('AI recovery successful!');
            return;
        }

        throw new CustomError("No search input found", 202405301120304);
    }
    //click next page
    async next_page(): Promise<boolean | void> {
        // const next_page_link = await this.page.$('#pnnext');
        // if (!next_page_link) {
        const nextPageSelectors = [
            '.RVQdVd',  // Current selector
            '#pnnext',
              // Standard next page button
            '.nBDE1b',
            'a[aria-label="Next page"]',  // Alternative next page link
            'a[href*="start="]',  // Links containing start parameter
            'a[role="button"][aria-label*="Next"]'  // Next button with role
        ];

        for (const selector of nextPageSelectors) {
            try {
                const targetElement = await this.page.$(selector);
                if (targetElement) {
                    await targetElement.scrollIntoView();
                    await targetElement.click();
                    return true;
                }
            } catch (error) {
                continue;
            }
        }

        // All selectors failed - try AI recovery
        const recoveryResult = await this.tryAIRecovery(
            'next_page',
            'Next page button not found with standard selectors',
            nextPageSelectors
        );

        if (recoveryResult.success) {
            // Wait for navigation after recovery actions
            try {
                await this.page.waitForNavigation({ timeout: 10000 });
                this.logger.info('AI recovery successful, navigated to next page');
                return true;
            } catch (navError) {
                this.logger.warn('Navigation timeout after AI recovery');
                // Still return true as actions were executed
                return true;
            }
        }

        return false;
    }

    /**
     * AI recovery via base observe-execute loop. Used at failure points (load, search, parse).
     */
    private async tryAIRecovery(
        operation: string,
        errorMessage: string,
        attemptedSelectors: string[],
        context?: Record<string, unknown>
    ): Promise<{ success: boolean; error?: string }> {
        this.logger.info(`Attempting AI recovery for operation: ${operation}`);
        return this.attemptAIRecovery(operation, errorMessage, attemptedSelectors, context);
    }

    /**
     * Parse search results from a given selector
     * Extracts link, title, snippet, and visible_link from search result elements
     * @param selector - CSS selector to find search result elements
     * @returns Array of parsed search results
     */
    private async parseSearchResults(selector: string): Promise<SearchResult[]> {
        const snapshots = await this.collectResultSnapshots(selector);
        return GoogleScraper.parseResultSnapshots(snapshots);
    }

    static parseResultSnapshots(snapshots: GoogleResultSnapshot[]): SearchResult[] {
        const results: SearchResult[] = [];
        const seenLinks = new Set<string>();

        for (const snapshot of snapshots) {
            const anchor = snapshot.anchors.find(item => {
                return item.hasHeading && GoogleScraper.isOrganicResultLink(item.href);
            });

            if (!anchor) {
                continue;
            }

            const link = GoogleScraper.normalizeGoogleResultLink(anchor.href);
            if (!link || seenLinks.has(link)) {
                continue;
            }

            const title = GoogleScraper.cleanText(anchor.headingText || anchor.text || anchor.ariaLabel || snapshot.headings[0] || "");
            if (!title) {
                continue;
            }

            seenLinks.add(link);
            results.push({
                link,
                title,
                snippet: GoogleScraper.cleanText(snapshot.snippetTexts[0] || ""),
                visible_link: GoogleScraper.cleanText(snapshot.citeTexts[0] || ""),
            });
        }

        return results;
    }

    private getResultContainerSelectors(): string[] {
        return [
            '#main .Gx5Zad',
            '#main .MjjYud',
            '#search .MjjYud',
            '#search .g',
            '#search .rc',
            '#search .srg .g',
            '#search .srg .rc',
            '#search .srg .g .rc'
        ];
    }

    private async collectSelectorDiagnostic(selector: string): Promise<GoogleSelectorDiagnostic> {
        const snapshots = await this.collectResultSnapshots(selector);
        const parsed = GoogleScraper.parseResultSnapshots(snapshots);
        return {
            selector,
            elementCount: snapshots.length,
            parsedCount: parsed.length,
            validCount: parsed.filter(item => Boolean(item.link && item.title)).length,
            samples: parsed.slice(0, 3).map((item, index) => ({
                title: item.title || "",
                link: item.link || "",
                snippet: item.snippet || "",
                htmlPreview: snapshots[index]?.htmlPreview || "",
            })),
        };
    }

    private async collectResultSnapshots(selector: string): Promise<GoogleResultSnapshot[]> {
        return await this.page.$$eval(selector, elements => {
            const cleanText = (value: string | null | undefined): string => {
                return (value || "").replace(/\s+/g, " ").trim();
            };

            const snippetSelectors = [
                ".VwiC3b",
                ".VwiC3b span",
                "[data-sncf]",
                ".kb0PBd",
                ".kCrYT span",
                ".st",
                ".IsZvec",
                ".lyLwlc",
            ];

            return elements.map(el => {
                const anchors = Array.from(el.querySelectorAll("a")).map(anchor => {
                    const heading = anchor.querySelector("h3");
                    return {
                        href: anchor.getAttribute("href") || "",
                        text: cleanText(anchor.textContent),
                        hasHeading: Boolean(heading),
                        headingText: cleanText(heading?.textContent),
                        ariaLabel: anchor.getAttribute("aria-label"),
                    };
                });

                const headings = Array.from(el.querySelectorAll("h3"))
                    .map(node => cleanText(node.textContent))
                    .filter(text => text.length > 0);

                const citeTexts = Array.from(el.querySelectorAll("cite, .TbwUpd, .tjvcx, .NJjxre"))
                    .map(node => cleanText(node.textContent))
                    .filter(text => text.length > 0);

                const snippetTexts = snippetSelectors
                    .flatMap(snippetSelector => Array.from(el.querySelectorAll(snippetSelector)))
                    .map(node => cleanText(node.textContent))
                    .filter(text => text.length > 0 && !headings.includes(text));

                return {
                    htmlPreview: el.outerHTML.slice(0, 500),
                    anchors,
                    headings,
                    citeTexts,
                    snippetTexts,
                };
            });
        });
    }

    private async writeParseDiagnostics(diagnostics: GoogleSelectorDiagnostic[]): Promise<void> {
        if (!this.config.debug_log_path) {
            return;
        }

        await fs.promises.mkdir(this.config.debug_log_path, { recursive: true });
        const filePath = path.join(
            this.config.debug_log_path,
            `google_parse_diagnostics_${Date.now()}.json`
        );
        await fs.promises.writeFile(filePath, JSON.stringify({
            url: await this.page.url(),
            title: await this.page.title(),
            diagnostics,
        }, null, 2));
        this.logger.info(`Saved Google parse diagnostics to ${filePath}`);
    }

    private static normalizeGoogleResultLink(href: string): string {
        const trimmedHref = href.trim();
        if (!trimmedHref) {
            return "";
        }

        if (trimmedHref.startsWith("/url?") || trimmedHref.startsWith("https://www.google.com/url?")) {
            try {
                const url = new URL(trimmedHref, "https://www.google.com");
                return url.searchParams.get("q") || url.searchParams.get("url") || trimmedHref;
            } catch {
                return trimmedHref;
            }
        }

        return trimmedHref;
    }

    private static isOrganicResultLink(href: string): boolean {
        const normalized = GoogleScraper.normalizeGoogleResultLink(href);
        if (!normalized) {
            return false;
        }

        if (!/^https?:\/\//i.test(normalized)) {
            return false;
        }

        try {
            const parsed = new URL(normalized);
            const hostname = parsed.hostname.toLowerCase();
            return !["google.com", "www.google.com"].includes(hostname);
        } catch {
            return false;
        }
    }

    private static cleanText(value: string): string {
        return value.replace(/\s+/g, " ").trim();
    }

    async wait_for_results() {
        try {
            // Wait for the page to be stable
            // await this.page.waitForFunction(() => {
            //     return document.readyState === 'complete';
            // }, { timeout: this.STANDARD_TIMEOUT });

            // Wait a bit more to ensure any dynamic content is loaded
            await new Promise(resolve => setTimeout(resolve, 1000));

            const html = await this.page.content();
            if (html.includes("Our systems have detected unusual traffic from your computer network")) {
                this.logger.warn("Google detected unusual traffic");
                //throw new CustomError("Google detected unusual traffic", 202405301120304);
                if (process.env.TWOCAPTCHA_TOKEN && process.env.TWOCAPTCHA_TOKEN.trim() !== '') {
                    // The recaptcha plugin should handle this automatically
                    // If manual solving is needed, use type assertion
                    await (this.page as any).solveRecaptchas?.()
                } else {
                    if (this.config.headless === false) {
                        this.logger.info(`Browser is not headless. Waiting for manual captcha solving...`);
                        
                        //await this.sleep(this.SOLVE_CAPTCHA_TIME);
                        this.logger.info(`You have ${this.SOLVE_CAPTCHA_TIME}ms to solve the captcha manually.`);
                    await this.page.waitForNavigation({ 
                        waitUntil: 'networkidle0',
                        timeout: this.SOLVE_CAPTCHA_TIME 
                    }).catch(() => {
                        this.logger.warn('Navigation timeout while waiting for captcha solution');
                    });
                    } else {
                        throw new CustomError("Google detected unusual traffic and browser is in headless mode,but not captach service provided", 202405301120306);
                    }
                }
            }

            const waitSelectors = [
                '#fbar',
                '#search',
                '#res',
                '#main',
                '.g',
                '#rcnt'
            ];

            for (const selector of waitSelectors) {
                try {
                    const element = await this.page.waitForSelector(selector, { timeout: this.STANDARD_TIMEOUT });
                    if (element) {
                        return; // If any selector is found, exit the function
                    }
                } catch (error) {
                    // Continue to the next selector if this one times out
                    continue;
                }
            }

            const recaptchaElement = await this.page.$('#recaptcha');
            if (recaptchaElement) {
                throw new CustomError("Google reCAPTCHA detected", 202405301120305);
            }

            throw new CustomError("No search results found - possible detection or page load failure", 202405301120304);
        } catch (error) {
            if (error instanceof Error && error.message.includes('Execution context was destroyed')) {
                // If the context was destroyed, wait a bit and try again
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.wait_for_results();
            }
            throw error;
        }
    }

    async detected() {
        const title = await this.page.title();
        const html = await this.page.content();
        return html.indexOf('detected unusual traffic') !== -1 || title.indexOf('/sorry/') !== -1;
    }

}
