'use strict';
import { SearchScrape } from "@/childprocess/searchScraper"
import { ScrapeOptions, SearchData, SearchResult } from "@/entityTypes/scrapeType"
import { CustomError } from "@/modules/customError"
import { TimeoutError,InterceptResolutionAction } from 'puppeteer';
import useProxy from "@lem0-packages/puppeteer-page-proxy"
import {convertProxyServertourl} from "@/modules/lib/function"
//import { delay } from "@/modules/lib/function";

// export type googlePlaces = {
//     heading: string;
//     rating: string;
//     contact: string;
//     hours: string;
// }

export class BaiduScraper extends SearchScrape {
    search_engine_name="baidu"
    constructor(options: ScrapeOptions) {
        super(options);
    }


    async parse_async(): Promise<SearchData> {

        // clean some results
        // results.top_products = this.clean_results(results.top_products, ['title', 'link']);
        // results.right_products = this.clean_results(results.right_products, ['title', 'link']);
        // results.results = this.clean_results(results.results, ['title', 'link' , 'snippet']);

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
        const searchRes = await this.page.$$eval('#content_left .c-container', elements =>
            elements.map(el => {
                const link = el.querySelector('.c-title a')?.getAttribute('href')

                let title = el.querySelector('h3 a')?.textContent
                if (!title) {
                    title = el.querySelector('.tts-title')?.textContent
                }
                // let visible_link = el.querySelector('.tptt')?.textContent
                // if (!visible_link) {
                //     visible_link = el.querySelector('.tptxt cite')?.textContent
                // }
                const visible_link = ""


                const serp_obj: SearchResult = {
                    // link: await (window as any)._attr(el, '.yuRUbf a', 'href'),
                    //link: el.getAttribute('href'),
                    link: link ? link : '',
                    // title: await (window as any)._text(el, '.yuRUbf a h3'),
                    title: title,
                    //snippet: await (window as any)._text(el, '.VwiC3b span'),
                    snippet: el.querySelector('.b_caption p')?.textContent,
                    //visible_link: await (window as any)._text(el, '.yuRUbf cite'),
                    visible_link: visible_link,

                    // date: _text(el, 'span.f'),
                }
                return serp_obj
            }
            ))
        //remove duplicate items
        const uniqueArray = Array.from(new Set(searchRes));
//console.log(uniqueArray); // Output: [1, 2, 3, 4, 5]    
        for (const seval of uniqueArray) {
            if (seval.link?.includes('www.baidu.com')) {
                // const response = await fetch(link, { method: 'GET' });
                // if(response.status==200){
                //     link=response.url
                // }

                const browser = await this.page.browser();
                try {
                    const newPage = await browser.newPage();
                    try {
                        if (this.proxyServer ) {
                            await newPage.setRequestInterception(true);
                            newPage.on("request", async (interceptedRequest) => {
                                if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                                // if (interceptedRequest.resourceType() === "image") {
                                //     interceptedRequest.abort();
                                // } else {
                                await useProxy(interceptedRequest, convertProxyServertourl(this.proxyServer!));
                                if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                                interceptedRequest.continue();
                                // }
                            });
                        }

                        const response = await newPage.goto(seval.link, {
                            waitUntil: "networkidle2",
                            timeout: 60000
                        });
                        if (response && response.status() === 200) {
                            seval.link = response.url();
                        }
                        //await newPage.close();
                    } catch (error) {
                        //catch time out error
                        if (error instanceof TimeoutError) {
                            // Do something if this is a timeout.
                            console.log('Navigation timed out:', error);
                        }
                    } finally {
                        if (!newPage.isClosed()) {
                            await newPage.close();
                        }
                    }
                } catch (error) {
                    console.error('Error creating new page:', error);
                }
            }
            result.results.push(seval);
        }

        return result;
    }

    async load_start_page(): Promise<boolean | void> {
        const startUrl = 'https://www.baidu.com';


        this.logger.info('Using startUrl: ' + startUrl);

        this.last_response = await this.page.goto(startUrl, {
            waitUntil: "networkidle2",
            timeout: 60000
        });

        // await this.page.waitForSelector('textarea[name="q"]', { timeout: this.STANDARD_TIMEOUT });

        return true;
    }

    async search_keyword(keyword: string) {
        //wait for full page loading

        const input = await this.page.$('input[name="wd"]');
        if (input) {
            // await this.set_input_value(`input[name="q"]`, keyword);
            await this.page.evaluate((element, value) => {
                element.value = value;
            }, input, keyword);
            // await this.page.waitForTimeout(50);
            await this.page.evaluate(async () => {
                await new Promise(function (resolve) {
                    setTimeout(resolve, 3000)
                });
            });

            await input.focus();
            await this.page.keyboard.press("Enter");
        } else {
            throw new CustomError("input keyword button not found", 202409011049147)
        }
        //}
    }
    //click next page
    async next_page(): Promise<boolean | void> {
        const next_page_link = await this.page.$('#page .n');
        // if (!next_page_link) {
        //     //return false;
        //     const targetElement = await this.page.$('[aria-label="Next page"]')
        //     if (targetElement) {
        //         await targetElement.scrollIntoView();
        //         targetElement.click();
        //         return true
        //     } else {
        //         const targetElements = await this.page.$('[title="Next page"]');
        //         if (targetElements) {
        //             await targetElements.scrollIntoView();
        //             await targetElements.click();
        //             return true;
        //         }
        //     }

        // } else {
        if (next_page_link) {
            await next_page_link.scrollIntoView();
            await next_page_link.click();
            return true
        }else{
            throw new CustomError("next page button not found", 202409011049192)
        }
        //}


        return false;
    }

    async wait_for_results() {
        await this.page.waitForSelector('#content_left', { timeout: this.STANDARD_TIMEOUT });
    }

    async detected() {
        const title = await this.page.title();
        const html = await this.page.content();
        return html.indexOf('detected unusual traffic') !== -1 || title.indexOf('/sorry/') !== -1;
    }

}