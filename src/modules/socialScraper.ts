import debug from 'debug';
// const resolve = require('path').resolve;
// import * as path from "path";
// import * as fs from "fs";
// import { Scraperdb } from "../model/scraperdb"
// const { spawn } = require('child_process');
import { Subject, Observer } from './subject';
import {SMconfig} from "@/entityTypes/scrapeType"
import { Page } from 'puppeteer';
import { Linkdata } from '@/modules/remotesource';
import {get_http_headers,get_ip_data} from "@/modules/metadata"
// import {TaskResultModel} from "@/model/TaskResult.model"
// import { TaskResultEntity } from "@/entity/TaskResult.entity";
// import appRoot from 'app-root-path';
//import { Token } from "@/modules/token"
// import {USERSDBPATH} from '@/config/usersetting';


// export class ScrapeOptionsPage extends Page{
const logger = debug('socialScraper');
export interface ScrapeVideo{
    scrapeinfo:Linkdata,
    video:VideoInfo,
}    
export interface VideoInfo{
    url:string,
    localpath:string,
    title:string,
    description:string|undefined,
    language:string
}
// }
// export class Elementhands extends puppeteer.ElementHandle{}
export interface ScrapeOptions {
    // config: {
    //     logger: logType,
    //     search_engine?: string, keywords?: Array<string>, proxy?: string, apply_evasion_techniques?: boolean, block_assets?: boolean, test_evasion?: boolean, log_http_headers?: boolean, log_ip_address?: boolean
    // },
    config:SMconfig,
    context?: object,
    pluggable?: object,
    page?: Page,
    taskid?: number,
    taskrunid?:number,
    // platform:string
}

interface runParameter {
    page?: Page,
    data?: object,
    worker?: object
}
interface logType {
    info: (message: string) => void,
    error: (error: Error) => void
}

export interface WosearchObj {
    page?: Page,
    worker?: object
}

export interface Linkurl {
    title: string,
    link: string,
    lang: string,
    taskid?: number
}
export type Searchobject = {
    page?: Page,
    keyword: string | Array<string>
    cookiesPath?: string
}



/**
 * this is parent class for social scrapyer node
 *  */
export class SocialScraper implements Subject {
    // config: {
    //     logger: logType,
    //     search_engine?: string,
    //     keywords?: Array<string>,
    //     proxy?: string,
    //     apply_evasion_techniques?: boolean,
    //     block_assets?: boolean,
    //     test_evasion?: boolean,
    //     log_http_headers?: boolean,
    //     log_ip_address?: boolean
    //     tmppath?: string,
    //     taskid?: number
    //     // obj:puppeteer.Page
    // };
    config:SMconfig;
    page: Page;
    last_response: object | null;
    metadata: { http_headers?: object, ipinfo?: { ip: string }, scraping_detected?: boolean };
    pluggable?: object;
    context?: object;
    logger: logType;
    proxy: string;
    keywords: Array<string>;
    STANDARD_TIMEOUT: number;
    SOLVE_CAPTCHA_TIME: number;
    results: object;
    result_rank: number;
    num_requests: number;
    num_keywords: number;
    taskid?: number;
    taskrunid?:number;
    private observers: Observer[] = [];
    constructor(options: ScrapeOptions) {

        // debug('constructor');
        // debug(options);
        // const {
        //     // config = {},
        //     context = {},
        //     // pluggable = null,
        //     page = null,
        //     // browsers=null
        // } = options;
        // this.browser=browser;
        if(options.page){
        this.page = options.page;
        }
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
        if(options.config.keywords){
        this.keywords = options.config.keywords;
        }
        if (options.taskid) {
            this.taskid = options.taskid;
        }
        if(options.taskrunid){
            this.taskrunid=options.taskrunid;
        }
        this.STANDARD_TIMEOUT = 10000;
        this.SOLVE_CAPTCHA_TIME = 45000;

        this.results = {};
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
    }

    /**
     * The subscription management methods.
     */
    public attach(observer: Observer): void {
        const isExist = this.observers.includes(observer);
        if (isExist) {
            return console.log('Subject: Observer has been attached already.');
        }

        console.log('Subject: Attached an observer.');
        this.observers.push(observer);
    }

    public detach(observer: Observer): void {
        const observerIndex = this.observers.indexOf(observer);
        if (observerIndex === -1) {
            return console.log('Subject: Nonexistent observer.');
        }

        this.observers.splice(observerIndex, 1);
        console.log('Subject: Detached an observer.');
    }

    /**
     * Trigger an update in each subscriber.
     */
    public notify(type:string,data:ScrapeVideo): void {
        console.log('Subject: Notifying observers...');
        for (const observer of this.observers) {
            observer.update(type,data);
        }
    }

    /**
     * login social media platform
     * @param runobj 
     * 
     */
    async runLogin(runobj: runParameter) {

        logger('worker=%o', runobj.worker, this.config.keywords);

        if (runobj.page) {
            this.page = runobj.page;
        }

        await this.page?.setViewport({ width: 1280, height: 800 });


        await this.load_browser_engine();
        await this.makeloginaction()

    }

    /**
     * Action that runs only once in the beginning of the
     * scraping procedure.
     *
     * @returns {Promise<void>} true if everything is correct.
     */
    async load_browser_engine(): Promise<void> {

        if (this.config.apply_evasion_techniques === true) {
            // prevent detection by evading common detection techniques
            await evadeChromeHeadlessDetection(this.page);
        }

        // block some assets to speed up scraping
        if (this.config.block_assets === true) {
            await this.page.setRequestInterception(true);
            this.page.on('request', (req) => {
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
    /**
  *
  * @returns true if startpage was loaded correctly.
  */
    async load_login_page() {
        //load login page
    }
    /**
    *
    * @returns true if startpage was loaded correctly.
    */
    async load_start_page() {
        //Deprecated
    }
    /**
     * make login action
     */
    async makeloginaction(): Promise<any | boolean> {
        //Deprecated
    }
    /**
     * user login by their hand
     */
    async userloginaction() {
        //Deprecated
    }

    async searchdata(seachobj: Searchobject): Promise<any | Array<Linkurl>> {
            //Deprecated
    }

    /**
     * use worker to search data
     * @param object keyword 
     */
    async workersearchdata(workerseach: WosearchObj) {
        if (workerseach.worker) {
            console.log('worker=%o', workerseach.worker, this.config.keywords);
        }
        if (workerseach.page) {
            this.page = workerseach.page;
        }

        await this.page.setViewport({ width: 1280, height: 800 });
        await this.load_browser_engine()
        if(!this.config.keywords){
            console.error("keyword is empty");
            return
        }
        const links = await this.searchdata({ keyword: this.config.keywords })
         //move follow code to main process
        // const tokenService=new Token()
        // const dbpath=await tokenService.getValue(USERSDBPATH)
        // if(!dbpath){
        //     throw new Error("user db path not exist")
        // }
       
        //save link to local db
        // const taskresultModel=new TaskResultdb(dbpath)
        
        // // const remoteSourmodel = new RemoteSource();
        // // debug('links=%o',links)
        // //handle the links
        // links?.map(async linkItem => {
        //     // const linkobj: Linkdata = { title: linkItem.title, url: linkItem.link, lang: linkItem.lang, socialtask_id: linkItem.taskid }
        //     // debug(linkobj)
        //     try {
        //         const taskresultEntity:TaskResultEntity={url:linkItem.link,
        //             title: linkItem.title, 
        //             lang: linkItem.lang,
        //             taskrun_id:this.taskrunid as number,
        //         }
        //         if(linkItem.content){
        //             taskresultEntity.content=linkItem.content  
        //         }
        //         taskresultModel.saveTaskresult(taskresultEntity,null)
        //         // await remoteSourmodel.saveLinkremote(linkobj)
        //     } catch (error) {
        //         console.error(error);
        //     }
        // })

    }
    /**
     * download video
     */
    // async downloadvideo(list: Array<Linkdata>): Promise<void> {

    //     const currentdate = new Date();
    //     const datetime = currentdate.getFullYear() + "-"
    //         + (currentdate.getMonth() + 1) + "-"
    //         + (currentdate.getDate());
    //     const videosavepath: string = path.resolve(appRoot + "/tmp/video/" + datetime + "/");
    //     if (!fs.existsSync(videosavepath)) {
    //         fs.mkdirSync(videosavepath, { recursive: true });
    //     }
    //     // debug('linklist=%o',list)
    //     //debug(list)
    //     //const scraperDb = Scraperdb.getInstance();
    //     list.forEach(async (linkItem, index) => {
    //         // console.log(linkItem)
    //         // console.log(index)
    //         // const lt=linkItem as Linkdata
    //         // console.log(lt.id)
    //         logger(linkItem)
    //         // console.log(Object.getPrototypeOf(linkItem))
    //         const videoArray = await this.downloadSigleVideo(linkItem.url, videosavepath)
    //         if (videoArray) {

    //             for (let i = 0; i < videoArray.length; i++) {
    //                 //    console.log(videoArray[i])
    //                 const videoItem:VideoInfo={url:linkItem.url,localpath:videoArray[i],title:linkItem.title,description:linkItem.content,language:linkItem.lang}
    //                 const scrapeitem:ScrapeVideo={video:videoItem,scrapeinfo:linkItem}
    //                 //scraperDb.saveVideo(linkItem.url, videoArray[i], linkItem.title, linkItem.content, linkItem.lang)
    //                 this.notify("downloadvideoend",scrapeitem);
    //             }
    //         }
    //     })
    // }
    /**
     * download single video
     * @param string link 
     * @param string videopath 
     */
    async downloadSigleVideo(link: string, videopath: string): Promise<Array<string> | void> {
            //dDeprecated
    }


}
// This is where we'll put the code to get around the tests.
async function evadeChromeHeadlessDetection(page) {

    // Pass the Webdriver Test.
    await page.evaluateOnNewDocument(() => {
        // const newProto = navigator.__proto__;
        const newProto = Object.getPrototypeOf(navigator);
        delete newProto.webdriver;
        // navigator.__proto__ = newProto;
        Object.setPrototypeOf(navigator, newProto);
    });

    // Pass the Chrome Test.
    await page.evaluateOnNewDocument(() => {
        // interface mockObjType extends typeof chrome {
        //     chrome: object,
        // }
        // We can mock this in as much depth as we need for the test.
        const mockObj = {
            app: {
                isInstalled: false,
            },
            webstore: {
                onInstallStageChanged: {},
                onDownloadProgress: {},
            },
            runtime: {
                PlatformOs: {
                    MAC: 'mac',
                    WIN: 'win',
                    ANDROID: 'android',
                    CROS: 'cros',
                    LINUX: 'linux',
                    OPENBSD: 'openbsd',
                },
                PlatformArch: {
                    ARM: 'arm',
                    X86_32: 'x86-32',
                    X86_64: 'x86-64',
                },
                PlatformNaclArch: {
                    ARM: 'arm',
                    X86_32: 'x86-32',
                    X86_64: 'x86-64',
                },
                RequestUpdateCheckStatus: {
                    THROTTLED: 'throttled',
                    NO_UPDATE: 'no_update',
                    UPDATE_AVAILABLE: 'update_available',
                },
                OnInstalledReason: {
                    INSTALL: 'install',
                    UPDATE: 'update',
                    CHROME_UPDATE: 'chrome_update',
                    SHARED_MODULE_UPDATE: 'shared_module_update',
                },
                OnRestartRequiredReason: {
                    APP_UPDATE: 'app_update',
                    OS_UPDATE: 'os_update',
                    PERIODIC: 'periodic',
                },
            },
        };
        // if(window.navigator.chrome){
        // window.navigator.chrome = mockObj;
        // }
        // window.chrome = mockObj;
    });

    // //Pass the Permissions Test.
    // await page.evaluateOnNewDocument(() => {
    //     const originalQuery = window.navigator.permissions.query;
    //     // window.navigator.permissions.__proto__.query = parameters =>
    //     Object.getPrototypeOf(window.navigator.permissions).query = parameters =>

    //         parameters.name === 'notifications'
    //             ? Promise.resolve({ state: Notification.permission })
    //             : originalQuery(parameters);

    //     // Inspired by: https://github.com/ikarienator/phantomjs_hide_and_seek/blob/master/5.spoofFunctionBind.js
    //     const oldCall = Function.prototype.call;

    //     function call() {
            
    //         return oldCall.apply(this, arguments);
    //     }

    //     Function.prototype.call = call;

    //     const nativeToStringFunctionString = Error.toString().replace(/Error/g, "toString");
    //     const oldToString = Function.prototype.toString;

    //     function functionToString() {
    //         if (this === window.navigator.permissions.query) {
    //             return "function query() { [native code] }";
    //         }
    //         if (this === functionToString) {
    //             return nativeToStringFunctionString;
    //         }
    //         return oldCall.call(oldToString, this);
    //     }

    //     Function.prototype.toString = functionToString;
    // });

    // Pass the Plugins Length Test.
    await page.evaluateOnNewDocument(() => {
        // Overwrite the `plugins` property to use a custom getter.
        Object.defineProperty(navigator, 'plugins', {
            // This just needs to have `length > 0` for the current test,
            // but we could mock the plugins too if necessary.
            get: () => [1, 2, 3, 4, 5]
        });
    });

    // Pass the Languages Test.
    await page.evaluateOnNewDocument(() => {
        // Overwrite the `plugins` property to use a custom getter.
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
    });

    // Pass the iframe Test
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function () {
                return window;
            }
        });
    });

    // Pass toString test, though it breaks console.debug() from working
    await page.evaluateOnNewDocument(() => {
        window.console.debug = () => {
            return null;
        };
    });
}