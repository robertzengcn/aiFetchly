'use strict';
import { SearchScrape } from "@/childprocess/searchScraper"
import { ScrapeOptions, SearchData, SearchResult } from "@/entityTypes/scrapeType"
import { CustomError } from "@/modules/customError"
import { TimeoutError, InterceptResolutionAction } from 'puppeteer';
//import { delay } from "@/modules/lib/function";
import useProxy from "@lem0-packages/puppeteer-page-proxy"
import { convertProxyServertourl } from "@/modules/lib/function"


// export type googlePlaces = {
//     heading: string;
//     rating: string;
//     contact: string;
//     hours: string;
// }

export class BingScraper extends SearchScrape {
    search_engine_name = "bing"
    constructor(options: ScrapeOptions) {
        super(options);
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

        //     // check if no results

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
        const searchRes = await this.page.$$eval('#b_results .b_algo', elements =>
            elements.map(el => {
                const link = el.querySelector('.b_tpcn a')?.getAttribute('href')

                let title = el.querySelector('h2 a')?.textContent
                if (!title) {
                    title = el.querySelector('.b_topTitle')?.textContent
                }
                let visible_link = el.querySelector('.tptt')?.textContent
                if (!visible_link) {
                    visible_link = el.querySelector('.tptxt cite')?.textContent
                }
                // if(link?.indexOf('www.bing.com')==-1){
                //     // const response = await fetch(link, { method: 'GET' });
                //     // if(response.status==200){
                //     //     link=response.url
                //     // }
                //     const browser = await this.page.browser();
                //     const newPage = await browser.newPage();
                //     const response = await newPage.goto(link, { waitUntil: 'domcontentloaded' });
                //     if (response && response.status() === 200) {
                //         link = response.url();
                //     }
                //     await newPage.close();
                // }

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
        for (const seval of searchRes) {
            if (seval.link?.includes('www.bing.com')) {
                // const response = await fetch(link, { method: 'GET' });
                // if(response.status==200){
                //     link=response.url
                // }

                const browser = await this.page.browser();
                try {
                    const newPage = await browser.newPage();
                    try {

                        if (this.proxyServer) {
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
        return result;
    }

    async load_start_page(): Promise<boolean | void> {
        const startUrl = 'https://www.bing.com';//ncr means no country redirect


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
        // await delay(5000)
        await this.page.waitForSelector('textarea[name="q"]', { timeout: this.STANDARD_TIMEOUT });
        await this.page.waitForFunction(() => {
            return document.readyState === 'complete';
        }, { timeout: this.STANDARD_TIMEOUT });
        const textareaSearch = await this.page.$('textarea[name="q"]');
        if (textareaSearch) {

            const rect = await textareaSearch.boundingBox();
            await textareaSearch.focus();
            if (rect) {
                await this.page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
                await this.page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
                await this.page.keyboard.type(keyword, { delay: Math.random() * 100 + 250 });
                await this.page.keyboard.press('Enter');

                try {
                    await this.page.waitForNavigation({ timeout: 5000 });
                } catch {
                    await this.page.evaluate(() => {
                        const form = document.querySelector('form[action="/search"]') as HTMLFormElement;
                        if (form) {
                            console.log("form found and submit");
                            form.submit();
                        }
                    });
                }
            } else {
                const input = await this.page.$('input[name="q"]');
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
                    throw new CustomError("input keyword button not found", 202408191127280)
                }
            }
        }
    }
    //click next page
    async next_page(): Promise<boolean | void> {
        const next_page_link = await this.page.$('.sb_pagN');
        if (!next_page_link) {
            //return false;
            const targetElement = await this.page.$('[aria-label="Next page"]')
            if (targetElement) {
                await targetElement.scrollIntoView();
                targetElement.click();
                return true
            } else {
                const targetElements = await this.page.$('[title="Next page"]');
                if (targetElements) {
                    await targetElements.scrollIntoView();
                    await targetElements.click();
                    return true;
                }
            }

        } else {
            await next_page_link.click();
            return true;
        }


        return false;
    }

    async wait_for_results() {
        const selectors = [
            '#b_tween',
            '#b_results',
            '.b_results',
            '#main',
            '#b_mcw',
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: this.STANDARD_TIMEOUT });
                return; // Exit if any selector is found
            } catch (error) {
                continue; // Try next selector if current one times out
            }
        }
        //await this.page.waitForSelector('#b_tween', { timeout: this.STANDARD_TIMEOUT });
    }

    async detected() {
        const title = await this.page.title();
        const html = await this.page.content();
        return html.indexOf('detected unusual traffic') !== -1 || title.indexOf('/sorry/') !== -1;
    }

}