'use strict';
import { SearchScrape } from "@/childprocess/searchScraper"
import { ScrapeOptions, SearchData, SearchResult } from "@/entityTypes/scrapeType"
import { CustomError } from "@/modules/customError"
import { TimeoutError, InterceptResolutionAction } from 'puppeteer';
import useProxy from "@lem0-packages/puppeteer-page-proxy"
import { convertProxyServertourl } from "@/modules/lib/function"

export class YandexScraper extends SearchScrape {
    search_engine_name = "yandex"
    private readonly searchSelectors = [
        'input[name="text"]',
        'input[type="search"]',
        'input.search-input',
        'input#text',
        '.input__control',
        'input.input__control'
    ];

    constructor(options: ScrapeOptions) {
        super(options);
    }

    async parse_async(): Promise<SearchData> {
        // Wait for network to be idle
        try {
            await this.page.waitForNetworkIdle({ timeout: 30000 });
            this.logger.debug('Network idle state reached');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Timeout waiting for network idle: ${errorMessage}`);
        }
        
        // Additional wait to ensure dynamic content is loaded
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Log current page state for debugging
        try {
            const currentUrl = this.page.url();
            this.logger.debug(`Parsing results from URL: ${currentUrl}`);
        } catch (urlError) {
            this.logger.debug(`Could not get current URL: ${urlError instanceof Error ? urlError.message : String(urlError)}`);
        }
        
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
        };

        // Try alternative selectors for search results
        const alternativeSelectors = [
            '.serp-list .serp-item',
            '.serp-item',
            '.Organic',
            '.serp-item_organic',
            '.serp-item_type_search',
            '#search-result .serp-item',
            '.main__content .serp-item'
        ];

        let findelement = false;
        for (const selector of alternativeSelectors) {
            this.logger.info(`Searching for results with selector: ${selector}`);
            const results = await this.page.$(selector);
            if (results) {
                findelement = true;
                this.logger.info(`Found results with alternative selector: ${selector}`);
                
                const searchRes = await this.page.$$eval(selector, elements =>
                    elements.map(el => {
                        // Try multiple selector patterns for Yandex
                        const selectors = [
                            { 
                                link: '.serp-item__title-link', 
                                title: '.serp-item__title-link', 
                                snippet: '.serp-item__text', 
                                visible: '.serp-item__url' 
                            },
                            { 
                                link: 'a.OrganicTitle-Link', 
                                title: 'a.OrganicTitle-Link', 
                                snippet: '.OrganicText', 
                                visible: '.Path-Item' 
                            },
                            { 
                                link: 'h2 a', 
                                title: 'h2 a', 
                                snippet: '.serp-item__text', 
                                visible: '.serp-url__item' 
                            },
                            { 
                                link: 'a', 
                                title: 'h2', 
                                snippet: '.serp-item__text, .OrganicText', 
                                visible: '.serp-url__item, .Path-Item' 
                            }
                        ];

                        let link = '', title = '', snippet = '', visible_link = '';

                        for (const sel of selectors) {
                            const linkEl = el.querySelector(sel.link);
                            const titleEl = el.querySelector(sel.title);
                            const snippetEl = el.querySelector(sel.snippet);
                            const visibleEl = el.querySelector(sel.visible);

                            if (linkEl && titleEl) {
                                link = linkEl.getAttribute('href') || '';
                                title = titleEl.textContent || '';
                                snippet = snippetEl?.textContent || '';
                                visible_link = visibleEl?.textContent || '';
                                
                                // If link is relative, make it absolute
                                if (link && link.startsWith('/')) {
                                    link = 'https://yandex.com' + link;
                                }
                                
                                break;
                            }
                        }

                        return {
                            link: link ? link : '',
                            title: title ? title : '',
                            snippet: snippet,
                            visible_link: visible_link
                        };
                    })
                );

                this.logger.info(`Found ${searchRes.length} results with alternative selector: ${selector}`);
                
                // Handle Yandex redirect links similar to Bing
                for (const seval of searchRes) {
                    if (seval.link?.includes('yandex.com') || seval.link?.includes('yandex.ru')) {
                        const browser = await this.page.browser();
                        try {
                            const newPage = await browser.newPage();
                            try {
                                if (this.proxyServer) {
                                    await newPage.setRequestInterception(true);
                                    newPage.on("request", async (interceptedRequest) => {
                                        if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                                        await useProxy(interceptedRequest, convertProxyServertourl(this.proxyServer!));
                                        if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                                        interceptedRequest.continue();
                                    });
                                }

                                const response = await newPage.goto(seval.link, {
                                    waitUntil: "networkidle2",
                                    timeout: 60000
                                });
                                if (response) {
                                    const status = response.status();
                                    if (status === 200) {
                                        seval.link = response.url();
                                        this.logger.debug(`Successfully resolved redirect for: ${seval.link}`);
                                    } else {
                                        this.logger.warn(`Non-200 status (${status}) when resolving redirect for: ${seval.link}`);
                                    }
                                } else {
                                    this.logger.warn(`Null response when resolving redirect for: ${seval.link}`);
                                }
                            } catch (error) {
                                const errorMessage = error instanceof Error ? error.message : String(error);
                                if (error instanceof TimeoutError) {
                                    this.logger.warn(`Navigation timed out for redirect link: ${seval.link}. Error: ${errorMessage}`);
                                } else {
                                    this.logger.warn(`Error navigating to redirect link: ${seval.link}. Error: ${errorMessage}`);
                                }
                            } finally {
                                if (!newPage.isClosed()) {
                                    await newPage.close();
                                }
                            }
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            this.logger.error(`Error creating new page for redirect: ${seval.link}. Error: ${errorMessage}`);
                        }
                    }
                    result.results.push(seval);
                }
                
                break; // Exit loop once we find results
            }
        }

        if (!findelement) {
            throw new CustomError("No search results found, may be element not found in the list page", 202405301120304);
        }

        return result;
    }

    async load_start_page(): Promise<boolean | void> {
        const startUrl = 'https://yandex.com'; // Use English version by default

        this.logger.info('Using startUrl: ' + startUrl);

        try {
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
            } catch (cookieError) {
                // Cookie button not found or already dismissed - this is fine
                this.logger.debug('Cookie consent button not found or already dismissed');
            }

            if (this.last_response) {
                const status = (this.last_response as any).status();
                this.logger.info(`Page loaded with status: ${status}`);
                if (status !== 200) {
                    this.logger.warn(`Unexpected status code: ${status} for URL: ${startUrl}`);
                }
            } else {
                this.logger.warn('Page navigation returned null response');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            
            this.logger.error(`Failed to load start page: ${startUrl}`);
            this.logger.error(`Error message: ${errorMessage}`);
            if (errorStack) {
                this.logger.error(`Error stack: ${errorStack}`);
            }
            
            // Log page state for debugging
            try {
                const currentUrl = this.page.url();
                const pageTitle = await this.page.title();
                this.logger.error(`Current page URL: ${currentUrl}`);
                this.logger.error(`Current page title: ${pageTitle}`);
            } catch (pageError) {
                this.logger.error(`Could not get page state: ${pageError instanceof Error ? pageError.message : String(pageError)}`);
            }

            // Re-throw with more context
            throw new CustomError(
                `Failed to load Yandex start page: ${errorMessage}. URL: ${startUrl}`,
                202405301120307
            );
        }

        // Try multiple selectors for the search input
        for (const selector of this.searchSelectors) {
            try {
                const element = await this.page.$(selector);
                if (element) {
                    this.logger.info(`Found search input with selector: ${selector}`);
                    return true;
                }
            } catch (error) {
                this.logger.debug(`Selector ${selector} not found: ${error instanceof Error ? error.message : String(error)}`);
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
                    await this.page.waitForSelector(selector, { timeout: this.STANDARD_TIMEOUT });
                    await this.page.waitForFunction(() => {
                        return document.readyState === 'complete';
                    }, { timeout: this.STANDARD_TIMEOUT });

                    const inputBox = await input.boundingBox();
                    if (inputBox) {
                        // Move mouse to input and click
                        await this.page.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
                        await this.page.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
                        
                        // Clear any existing text
                        await input.click({ clickCount: 3 });
                        await this.page.keyboard.press('Backspace');
                        
                        // Type keyword with random delays
                        await this.page.keyboard.type(keyword, { delay: Math.random() * 100 + 250 });
                        await this.page.keyboard.press('Enter');

                        try {
                            await this.page.waitForNavigation({ timeout: 5000 });
                            this.logger.info(`Successfully navigated after searching for keyword: ${keyword}`);
                        } catch (navError) {
                            this.logger.warn(`Navigation timeout after search, trying form submit. Error: ${navError instanceof Error ? navError.message : String(navError)}`);
                            // If navigation doesn't happen, try submitting the form
                            await this.page.evaluate(() => {
                                const form = document.querySelector('form') as HTMLFormElement;
                                if (form) {
                                    console.log("form found and submit");
                                    form.submit();
                                }
                            });
                        }
                        return;
                    } else {
                        // Fallback: use focus and type
                        await input.focus();
                        await this.page.evaluate((element, value) => {
                            (element as HTMLInputElement).value = value;
                        }, input, keyword);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        await input.focus();
                        await this.page.keyboard.press("Enter");
                        return;
                    }
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.debug(`Selector ${selector} failed: ${errorMessage}`);
                continue;
            }
        }
        
        // Log current page state before throwing error
        try {
            const currentUrl = this.page.url();
            const pageTitle = await this.page.title();
            this.logger.error(`Failed to find search input. Current URL: ${currentUrl}, Page title: ${pageTitle}`);
        } catch (pageError) {
            this.logger.error(`Could not get page state: ${pageError instanceof Error ? pageError.message : String(pageError)}`);
        }
        
        throw new CustomError(`Input keyword button not found for keyword: ${keyword}`, 202405301120303);
    }

    async next_page(): Promise<boolean | void> {
        const nextPageSelectors = [
            '.pager__item_kind_next',
            'a[aria-label="Next page"]',
            'a[title="Next page"]',
            '.pager__item:last-child a',
            'a.pager__item_kind_next',
            'a[href*="p="]',
            '.pager__item_next'
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

        return false;
    }

    async wait_for_results() {
        const selectors = [
            '.serp-list',
            '.serp-item',
            '.main__content',
            '#search-result',
            '.content__left',
            '.serp-list__items'
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: this.STANDARD_TIMEOUT });
                return; // Exit if any selector is found
            } catch (error) {
                continue; // Try next selector if current one times out
            }
        }
        
        // Additional wait to ensure content is loaded
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    async detected() {
        const title = await this.page.title();
        const html = await this.page.content();
        return html.indexOf('captcha') !== -1 || 
               html.indexOf('robot') !== -1 || 
               title.indexOf('captcha') !== -1 ||
               html.indexOf('unusual traffic') !== -1;
    }
}

