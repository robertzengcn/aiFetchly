import { searchEngineImpl } from "@/modules/interface/searchEngineImpl"
import { Page, Browser, InterceptResolutionAction } from 'puppeteer';
import { SMconfig, ScrapeOptions, clusterData, RunResult, ParseType, SearchData, ClusterSearchData,ResultParseItemType } from "@/entityTypes/scrapeType"
import { evadeChromeHeadlessDetection } from "@/modules/lib/function"
import { get_http_headers, get_ip_data } from "@/modules/metadata"
import debug from 'debug';
import useProxy from "@lem0-packages/puppeteer-page-proxy"
import {ProxyServer} from "@/entityTypes/proxyType"
import {convertProxyServertourl} from '@/modules/lib/function'
import * as path from 'path';
import * as fs from 'fs';

// const logger = debug('SearchScrape');

export class SearchScrape implements searchEngineImpl {
    config: SMconfig;
    page: Page
    browser: Browser
    last_response: object | null;
    metadata: { http_headers?: object, ipinfo?: { ip: string }, scraping_detected?: boolean | void };
    pluggable?: ScrapeOptions["pluggable"];
    context?: object;
    logger: SMconfig["logger"];
    proxy: string;
    keywords: Array<string>;
    STANDARD_TIMEOUT: number;
    SOLVE_CAPTCHA_TIME: number;
    results:Array<ResultParseItemType>=[]; // change it to map:
    // https://stackoverflow.com/questions/40976536/how-to-define-typescript-map-of-key-value-pair-where-key-is-a-number-and-value
    // https://howtodoinjava.com/typescript/maps/ 
    result_rank: number;
    num_requests: number;
    num_keywords: number;
    keyword: string;
    page_num: number;
    proxyServer?:ProxyServer|null
    debug_log_path?:string;
    search_engine_name:string;
    constructor(options: ScrapeOptions) {
        if (options.page) {
            this.page = options.page;
        }
        

        // if(options.browser){
        //     this.browser=options.browser;
        // }
        this.last_response = null; // the last response object
        this.metadata = {
            scraping_detected: false,
        };
        this.pluggable = options.pluggable;
        this.config = options.config;
        this.logger = this.config.logger;
        this.context = options.context;
        // if(options.config.proxy){
        // this.proxy = options.config.proxy;
        // }
        if (options.config.keywords) {
            this.keywords = options.config.keywords;
        }
        // if (options.taskid) {
        //     this.taskid = options.taskid;
        // }
        // if(options.taskrunid){
        //     this.taskrunid=options.taskrunid;
        // }
        this.STANDARD_TIMEOUT = 10000;
        this.SOLVE_CAPTCHA_TIME = 45000;

        // this.results = new Map();
        this.result_rank = 1;
        // keep track of the requests done
        this.num_requests = 0;
        // keep track of the keywords searched
        this.num_keywords = 0;

        let settings = this.config[`${this.config.platform}_settings`];
        if (settings) {
            if (typeof settings === 'string') {
                settings = JSON.parse(settings);
                this.config[`${this.config.platform}_settings`] = settings;
            }
        }
        //this.results = [];
    }

    async run(data: { page: Page, data: ClusterSearchData, worker }): Promise<RunResult> {

        // debug('worker=%o', worker, this.config.keywords);



        if (data.page) {
            this.page = data.page;
        }
        //console.log(data.data)
        // const browsser=this.page.browser()
        // browsser.browserContexts()
        // console.log(data.worker.browserOptions)


        // await this.exposeFunction()

        this.keywords = data.data.keywords
        await this.page.bringToFront();
        await this.page.setViewport({ width: 1920, height: 1040 });
        let do_continue: boolean | void = true;
        //console.log("data.data=%O",data.data)
        //set cookies if data.data.cookies is not empty
        if (data.data.cookies && data.data.cookies.length > 0) {
            //console.log("data.data.cookies=%O",data.data.cookies)
            const browserContext = this.page.browser().defaultBrowserContext();
            const pageContext = this.page;
            
            for (const cookie of data.data.cookies) {
                if(cookie){
                    let url = cookie.domain
                    if (cookie.domain && cookie.domain.charAt(0) === '.') {
                        url = cookie.domain.slice(1);
                    }

                    const mappedCookie = {
                        ...cookie,
                        url: `http${cookie.secure ? 's' : ''}://${url}${cookie.path}`,
                        //url:"https://www.google.com",
                        sameSite: cookie.sameSite === 'None' ? 'None' as const : 
                                cookie.sameSite === 'lax' ? 'Lax' as const :
                                cookie.sameSite === 'strict' ? 'Strict' as const : 'None' as const,
                        // Ensure domain is set correctly
                        domain: cookie.domain || new URL(this.build_start_url()).hostname,
                        // Ensure path is set
                        path: cookie.path || '/',
                        // Ensure secure is set for https
                        secure: cookie.secure ?? true,
                        // Ensure httpOnly is set
                        httpOnly: cookie.httpOnly ?? true,
                        expires: cookie.expirationDate ?? 0
                    };
                    console.log("prepare to set cookies of",mappedCookie)
                    //console.log("Setting cookie in browser context:", mappedCookie);
                    await this.page.setCookie(mappedCookie)
                    // Set cookie in browser context
                    //await browserContext.setCookie(mappedCookie);
                    
                    // Also set cookie in page context
                    console.log("Setting cookie in page context:", mappedCookie);
                    //await pageContext.browser().setCookie(mappedCookie);
                }
            }
            
            // Verify cookies were set in both contexts
            //const browserCookies = await browserContext.cookies();
           // const pageCookies = await pageContext.cookies();
            //console.log("Browser context cookies:", browserCookies);
            //console.log("Page context cookies:", pageCookies);
            
            // Wait a moment to ensure cookies are properly set
            await this.sleep(1000);
        }

        if (data.data.proxyServer) {
            if (data.data.proxyServer != undefined) {
                // await useProxy(this.page, data.data.proxyServer)
                // await this.page.setRequestInterception(true);
                //     this.page.on('request', async request => {
                //         await useProxy(request, data.data.proxyServer!);
                //     });
                // }
                // await this.page.authenticate({
                //   username: data.data.proxyServer.username,
                //   password: data.data.proxyServer.password,
                // });
                this.proxyServer = data.data.proxyServer
                await this.page.setRequestInterception(true);
                this.page.on("request", async (interceptedRequest) => {
                    if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                    // if (interceptedRequest.resourceType() === "image") {
                    //     interceptedRequest.abort();
                    // } else {
                        await useProxy(interceptedRequest, convertProxyServertourl(data.data.proxyServer!));
                        if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                        interceptedRequest.continue();
                   // }
                });
            }
        }

        if (!this.config.scrape_from_file || this.config.scrape_from_file.length <= 0) {
            do_continue = await this.load_search_engine();
        }

        //console.log("browser cookies=%O",await this.page.browser().cookies());
        if (!do_continue) {
            console.error('Failed to load the search engine: load_search_engine()');
        } else {
            await this.scraping_loop();
        }

        return {
            results: this.results,
            metadata: this.metadata,
            num_requests: this.num_requests,
        }
    }

    async exposeFunction() {
        const _text = async (el, s) => {
            const n = await el.$eval(s);

            if (n) {
                return n.innerText;
            } else {
                return '';
            }
        };

        const _attr = async (el, s, attr) => {
            const n = await el.$eval(s);

            if (n) {
                return n.getAttribute(attr);
            } else {
                return null;
            }
        };

        //set common function

        await this.page.exposeFunction("_text", _text);
        await this.page.exposeFunction("_attr", _attr);
    }

    /**
   * Action that runs only once in the beginning of the
   * scraping procedure.
   *
   * @returns {Promise<boolean>} true if everything is correct.
   */
    async load_search_engine(): Promise<boolean | void> {

        if (this.config.apply_evasion_techniques === true) {
            // prevent detection by evading common detection techniques
            await evadeChromeHeadlessDetection(this.page);
        }

        // block some assets to speed up scraping
        if (this.config.block_assets === true) {
            await this.page.setRequestInterception(true);
            this.page.on('request', (req) => {
                if (req.isInterceptResolutionHandled()) return;
                const type = req.resourceType();
                const block = ['stylesheet', 'font', 'image', 'media'];
                if (block.includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        }

        if (this.config.test_evasion === true) {
            // await this.page.evaluate(() => {
            //     console.log('Current User Agent:', navigator.userAgent);
            // });
            //await this.page.getUserAgent(navigator.userAgent);
            //console.log('Current User Agent:', navigator.userAgent);
            // Navigate to the page that will perform the tests.
            const testUrl = 'https://bot.sannysoft.com';
            await this.page.goto(testUrl);
            // Save a screenshot of the results.
            if(this.config.debug_log_path){
                await this.page.evaluate(() => {
                    console.log('Current User Agent:', navigator.userAgent);
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.logger.info("headless-evasion-result path:"+path.join(this.config.debug_log_path, 'headless-evasion-result.png') as `${string}.png`)
                await this.page.screenshot({fullPage: true, path: path.join(this.config.debug_log_path, 'headless-evasion-result.png') as `${string}.png` });
            }else{
                await this.page.screenshot({fullPage: true, path: 'headless-evasion-result.png' });
            }
            const sectesturl="https://arh.antoinevastel.com/bots/"
            await this.page.goto(sectesturl);

           if(this.config.debug_log_path){
               
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.logger.info("antoinevastel-result path:"+path.join(this.config.debug_log_path, 'antoinevastel-result.png') as `${string}.png`)
                await this.page.screenshot({fullPage: true, path: path.join(this.config.debug_log_path, 'antoinevastel-result.png') as `${string}.png` });
            const htmlContent = await this.page.content();
            await fs.promises.writeFile(
                path.join(this.config.debug_log_path, 'antoinevastel-result.html'),
                htmlContent
            );
            this.logger.info("Saved HTML content to: " + path.join(this.config.debug_log_path, 'antoinevastel-result.html'));
            }else{
                await this.page.screenshot({fullPage: true, path: 'antoinevastel-result.png' });
            }
        }

        if (this.config.log_http_headers === true) {
            this.metadata.http_headers = await get_http_headers(this.page);
            //debug('this.metadata.http_headers=%O', this.metadata.http_headers);
        }

        if (this.config.log_ip_address === true) {
            const ipinfo = await get_ip_data(this.page);
            this.metadata.ipinfo = ipinfo;
            //debug('this.metadata.ipinfo', this.metadata.ipinfo);
        }

        // check that our proxy is working by confirming
        // that ipinfo.io sees the proxy IP address
        if (this.proxy && this.config.log_ip_address === true) {
            //debug(`${this.metadata.ipinfo.ip} vs ${this.proxy}`);

            // if the ip returned by ipinfo is not a substring of our proxystring, get the heck outta here
            if (this.metadata.ipinfo && (!this.proxy.includes(this.metadata.ipinfo.ip))) {
                throw new Error(`Proxy output ip ${this.proxy} does not match with provided one`);
            } else {
                this.logger.info(`Using valid Proxy: ${this.proxy}`);
            }

        }

        return await this.load_start_page();
    }
    async searchData(data: clusterData): Promise<void> {
        //achieve it in child
    }


    /**
    * Action that runs only once in the beginning of the
    * scraping procedure.
    *
    * @returns {Promise<boolean>} true if everything is correct.
    */
    async load_browser_engine(): Promise<boolean | void> {

        if (this.config.apply_evasion_techniques === true) {
            // prevent detection by evading common detection techniques
            await evadeChromeHeadlessDetection(this.page);
        }

        // block some assets to speed up scraping
        if (this.config.block_assets === true) {
            await this.page.setRequestInterception(true);
            this.page.on('request', (req) => {
                if (req.isInterceptResolutionHandled()) return;
                const type = req.resourceType();
                const block = ['stylesheet', 'font', 'image', 'media'];
                if (block.includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });
        }

        if (this.config.test_evasion === true) {
            // Navigate to the page that will perform the tests.
            const testUrl = 'https://bot.sannysoft.com';
            await this.page.goto(testUrl);
            // Save a screenshot of the results.
            await this.page.screenshot({ path: 'headless-evasion-result.png' });
        }

        if (this.config.log_http_headers === true) {
            this.metadata.http_headers = await get_http_headers(this.page);
            // debug('this.metadata.http_headers=%O', this.metadata.http_headers);
        }

        if (this.config.log_ip_address === true) {
            const ipinfo = await get_ip_data(this.page);
            this.metadata.ipinfo = ipinfo;
            // debug('this.metadata.ipinfo', this.metadata.ipinfo);
        }

        // check that our proxy is working by confirming
        // that ipinfo.io sees the proxy IP address
        if (this.proxy && this.config.log_ip_address === true) {
            debug(`${this.metadata.ipinfo?.ip} vs ${this.proxy}`);

            // if the ip returned by ipinfo is not a substring of our proxystring, get the heck outta here
            if (this.metadata.ipinfo?.ip && (!this.proxy.includes(this.metadata.ipinfo?.ip))) {
                throw new Error(`Proxy output ip ${this.proxy} does not match with provided one`);
            } else {
                this.logger.info(`Using valid Proxy: ${this.proxy}`);
            }

        }

        return await this.load_start_page();
    }

    //achieve it in subclass
    async load_start_page(): Promise<boolean | void> {
        //achieve it in subclass
        // return true
    }
    /**
     * Each scraper basically iterates over a list of
     * keywords and a list of pages. This is the generic
     * method for that.
     *
     * @returns {Promise<void>}
     */
    async scraping_loop(): Promise<void> {
        // Implement the scraping loop logic here
        for (const keyword of this.keywords) {
            this.num_keywords++;
            this.keyword = keyword;
            //this.results.push();
            // this.results.set(keyword, {});
            this.result_rank = 1;
//console.log("keyword is "+keyword)
            try {

                // if (this.pluggable && this.pluggable.before_keyword_scraped) {
                //     await this.pluggable.before_keyword_scraped({
                //         results: this.results,
                //         num_keywords: this.num_keywords,
                //         num_requests: this.num_requests,
                //         keyword: keyword,
                //     });
                // }

                this.page_num = 1;

                // load scraped page from file if `scrape_from_file` is given
                if (!this.config.scrape_from_file || this.config.scrape_from_file.length <= 0) {
                    await this.search_keyword(keyword);
                } else {
                    this.last_response = await this.page.goto(this.config.scrape_from_file);
                }

                // when searching the keyword fails, num_requests will not
                // be incremented.
                this.num_requests++;

                do {

                    // this.logger.info(`${this.config.search_engine_name} scrapes keyword "${keyword}" on page ${this.page_num}`);

                    await this.wait_for_results();

                    if (this.config.sleep_range) {
                        await this.random_sleep();
                    }
                    //this.results[keyword][this.page_num] = {};
                    const html = await this.page.content();
                    const parsed = this.parse(html);
                    if (parsed) {
                        //this.results[keyword][this.page_num].value = parsed 
                        //const setdata:ParseType=new map();

                        // setdata.value=parsed;
                        //this.results[keyword][this.page_num].value = parsed
                        const resultParseItem:ResultParseItemType={
                            keyword:keyword,
                            page:this.page_num,
                            
                        }
                        if(parsed.results){
                            resultParseItem.results=parsed.results;
                        }
                        this.results.push(resultParseItem);
                    } else {
                        // this.results[keyword][this.page_num] = await this.parse_async(html);
                        const pareseres: SearchData | void = await this.parse_async();
                        if (pareseres) {
                            console.log(`pareseres: ${pareseres}`);
                            console.log(`pareseres.results: ${pareseres.results}`); 
                            //this.results[keyword][this.page_num].value = pareseres.results;
                            //this.results[keyword].set(this.page_num,{value:pareseres.results})
                            const resultParseItem:ResultParseItemType={
                                keyword:keyword,
                                page:this.page_num,
                                results:pareseres.results
                            }
                            this.results.push(resultParseItem);
                        } else {
                            this.logger.warn(`No results found for keyword "${keyword}" on page ${this.page_num}`);
                            // this.results[keyword][this.page_num].value =""
                            const resultParseItem:ResultParseItemType={
                                keyword:keyword,
                                page:this.page_num,
                                results:[]
                            }
                            this.results.push(resultParseItem);
                        }
                    }
                    // this.results[keyword][this.page_num] = parsed ? parsed : await this.parse_async(html);


                    if (this.config.screen_output&&this.config.debug_log_path) {
                        // this.results[keyword][this.page_num].screenshot = await this.page.screenshot({
                        //     encoding: 'base64',
                        //     fullPage: false,
                        // });
                        const html_screenshot_path = path.join(this.config.debug_log_path, `html_debug_se_scraper_${this.search_engine_name}_${keyword}_${Date.now()}.png`)
                        await this.page.screenshot({ path: html_screenshot_path as `${string}.png` });
                    }

                    if (this.config.html_output) {

                        if (this.config.clean_html_output) {
                            await this.page.evaluate(() => {
                                // remove script and style tags
                                Array.prototype.slice.call(document.getElementsByTagName('script')).forEach(
                                    function (item) {
                                        item.remove();
                                    });
                                Array.prototype.slice.call(document.getElementsByTagName('style')).forEach(
                                    function (item) {
                                        item.remove();
                                    });

                                // remove all comment nodes
                                // const nodeIterator = document.createNodeIterator(
                                //     document.body,
                                //     NodeFilter.SHOW_COMMENT,    
                                //     { acceptNode: function(node) { return NodeFilter.FILTER_ACCEPT; } }
                                // );
                                // while(nodeIterator.nextNode()){
                                //     const commentNode = nodeIterator.referenceNode;
                                //     commentNode.removeChild()
                                // }
                            });
                        }

                        if (this.config.clean_data_images) {
                            await this.page.evaluate(() => {
                                Array.prototype.slice.call(document.getElementsByTagName('img')).forEach(
                                    function (item) {
                                        const src = item.getAttribute('src');
                                        if (src && src.startsWith('data:')) {
                                            item.setAttribute('src', '');
                                        }
                                    });
                            });
                        }

                        let html_contents = await this.page.content();
                        // https://stackoverflow.com/questions/27841112/how-to-remove-white-space-between-html-tags-using-javascript
                        // TODO: not sure if this is save!
                        html_contents = html_contents.replace(/>\s+</g, '><');
                        //this.results[keyword][this.page_num].html = html_contents;
                        if(this.config.debug_log_path){
                            const html_path = path.join(this.config.debug_log_path, `html_debug_se_scraper_${this.search_engine_name}_${keyword}_${Date.now()}.html`)
                            await fs.promises.writeFile(html_path, html_contents);
                        }
                    }

                    this.page_num += 1;

                    // only load the next page when we will pass the next iteration
                    // step from the while loop
                    if (this.page_num <= this.config.num_pages) {

                        const next_page_loaded = await this.next_page();

                        if (!next_page_loaded) {
                            break;
                        } else {
                            this.num_requests++;
                        }
                    }

                } while (this.page_num <= this.config.num_pages);

            } catch (e) {

                this.logger.warn(`Problem with scraping ${keyword} in search engine: ${(e as Error).message}`);
                this.logger.warn((e as Error).stack);
                //debug('this.last_response=%O', this.last_response);

                if (this.config.take_screenshot_on_error) {
                    if(this.config.debug_log_path){
                        const screenshot_path = path.join(this.config.debug_log_path, `debug_se_scraper_${this.search_engine_name}_${keyword}_${Date.now()}.png`)
                        this.logger.info(`Saving screenshot to ${screenshot_path}`);
                        await this.page.screenshot({ path: screenshot_path as `${string}.png` });
                        //await fs.promises.writeFile(screenshot_path, screenshot);
                    }else{
                        this.logger.info(`sceen path:`+`debug_se_scraper_${this.search_engine_name}_${keyword}.png`);
                        await this.page.screenshot({ path: `debug_se_scraper_${this.search_engine_name}_${keyword}.png` });
                    }
                }
                if(this.config.save_html){
                    const html = await this.page.content();
                    if(this.config.debug_log_path){
                        this.logger.info(`Saving html to ${path.join(this.config.debug_log_path, `debug_se_scraper_${this.search_engine_name}_${keyword}.html`)}`);
                        await fs.promises.writeFile(path.join(this.config.debug_log_path, `debug_se_scraper_${this.search_engine_name}_${keyword}.html`), html);
                    }else{
                        this.logger.info(`html path:`+`debug_se_scraper_${this.search_engine_name}_${keyword}.html`);
                        await fs.promises.writeFile(`debug_se_scraper_${this.search_engine_name}_${keyword}.html`, html);
                    }
                }

                this.metadata.scraping_detected = await this.detected();

                if (this.metadata.scraping_detected === true) {
                    this.logger.warn(`${this.search_engine_name} detected the scraping!`);

                    if (this.config.is_local === true) {
                        await this.sleep(this.SOLVE_CAPTCHA_TIME);
                        this.logger.info(`You have ${this.SOLVE_CAPTCHA_TIME}ms to enter the captcha.`);
                        // expect that user filled out necessary captcha
                    } else {
                        if (this.config.throw_on_detection === true) {
                            throw (e);
                        } else {
                            continue;
                        }
                    }
                } else {
                    // some other error, quit scraping process if stuff is broken
                    // if (this.config.throw_on_detection === true) {
                    //     throw( e );
                    // } else {
                    //     return;
                    // }
                    //continue to next keyword
                    continue;
                }
            }
        }
    }
    async wait_for_results() {
        //Implement the logic to wait for the results here
    }
    async random_sleep() {
        let max = 0
        let min = 0
        if (this.config.sleep_range) {
            const sleepRange = this.config.sleep_range; // Default sleep range if undefined
            // const [min, max] = sleepRange;
            min = sleepRange.min;
            max = sleepRange.max;
        }
        const rand = Math.floor(Math.random() * (max - min + 1) + min); //Generate Random number
        // this.logger.info(`Sleeping for ${rand}s`);
        await this.sleep(rand * 1000);
    }
    async sleep(ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
    async detected(): Promise<boolean | void> {
        // Implement the logic to detect if the scraping is detected here
    }

    build_start_url(): string {
        // Implement the logic to build the start URL here
        return "https://example.com";
    }

    parse(html: any): SearchData | void {
        // Implement the logic to parse the HTML here
    }

    async parse_async(): Promise<SearchData | void> {

        // Implement the logic to parse the HTML asynchronously here     
    }

    async search_keyword(keywords: string) {
        // Implement the logic to perform a keyword search here
    }

    async set_input_value(selector: string, value: string) {
        await this.page.waitForSelector(selector);
        await this.page.evaluate((value, selector) => {
            const inputElement = document.querySelector(selector) as HTMLInputElement;
            if (inputElement) {
                inputElement.value = value;
            }
        }, value, selector);
    }
    async next_page(): Promise<boolean | void> {
        //implemet in sub class
    }

    // Add the missing properties here
}