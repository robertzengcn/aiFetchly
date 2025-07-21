import { SMconfig, SMstruct, SearchDataParam, ScrapeOptions, ClusterSearchData, MetadataType, ResultParseType, ResultParseItemType } from "@/entityTypes/scrapeType"
import defaults from "lodash/defaults"
import { Page, Browser } from 'puppeteer';
import { createLogger, format, transports } from "winston"
import winston from "winston"
const { combine, timestamp, printf } = format;
import { Cluster } from "puppeteer-cluster"
import fs from "fs";
import { read_keywords_from_file, writeResults } from "@/modules/lib/function"
import debug from 'debug';
import clone from "lodash/clone"
import times from "lodash/times"
import map from "lodash/map";
//import UserAgent from "user-agents";
// import randomUseragent from "random-useragent";
import UserAgent from 'user-agents';
// import { addExtra } from "puppeteer-extra";
// import puppeteer from 'puppeteer-extra';
import { CustomConcurrency } from "@/modules/concurrency-implementation"
import { searchEngineFactory } from "@/modules/searchEngineFactory"
// import { Keyword } from "./keyword";
import { pluggableType } from "@/entityTypes/scrapeType"
import { ProxyServer } from "@/entityTypes/proxyType"
import { CookiesType } from "@/entityTypes/cookiesType";
// import vanillaPuppeteer from 'puppeteer';
// import {addExtra} from 'puppeteer-extra';
// import StealthPlugin from 'puppeteer-extra-plugin-stealth';



// import {ProxyServer} from "@/entityTypes/proxyType"
// import { app } from 'electron'
// import * as path from 'path'
//import BrowserImple from "@/modules/BrowseImple"

// import * as vanillaPuppeteer from "puppeteer";

const logger = debug('ScrapeManager');
const MAX_ALLOWED_BROWSERS = 10;
export class ScrapeManager {
  cluster: Cluster<ClusterSearchData>;
  pluggable: pluggableType;
  // scraper: SocialScraper;
  context: object;
  config: SMconfig;
  logger: winston.Logger;
  // logger: { info: Function };
  browser: Browser;
  page: Page;
  numClusters: number;
  tmppath: string;
  proxiesArr: Array<ProxyServer | null>
  debug_log_path?: string;
  // runLogin: Function;
  // taskid?: number;
  // taskrunId?: number;
  // chrome_flags=[];
  constructor(config: SMstruct, context = {}) {
    // this.cluster = null;
    // this.pluggable = null;
    // this.scraper = null;
    this.context = context;
    this.debug_log_path = config.debug_log_path;

    // await this.getRemoteConfig(campaignId)

    this.config = defaults(config, {
      // remote_add:endcofig.REMOTEADD,
      // remote_username:endcofig.USERNAME,
      // remote_password:endcofig.PASSWORD,
      // the user agent to scrape with - set based on platform
      user_agent: (() => {
        const platform = process.platform;
        switch(platform) {
          case 'darwin':
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
          case 'linux':
            return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
          case 'win32':
          default:
            return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
        }
      })(),
      // if random_user_agent is set to True, a random user agent is chosen
      random_user_agent: false,
      // whether to select manual settings in visible mode
      set_manual_settings: false,
      // log ip address data
      log_ip_address: false,
      // log http headers
      log_http_headers: false,
      // how long to sleep between requests. a random sleep interval within the range [a,b]
      // is drawn before every request. empty string for no sleeping.
      sleep_range: null,

      logger: createLogger({
        level: "info",
        format: combine(
          timestamp(),
          printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level}] ${message}`;
          })
        ),
        transports: [new transports.Console(),
          //       new winston.transports.File({ filename: path.join(app.getPath("logs"),'error.log'), level: 'error' }),
          // new winston.transports.File({ filename: path.join(app.getPath("logs"),'combined.log') }),
          //       new winston.transports.File({ filename: 'error.log', level: 'error' }),
          // new winston.transports.File({ filename: 'combined.log' }),
        ],
      }),
      // platform: "facebook",
      // keywords: ["nodejs rocks"],
      // whether to start the browser in headless mode
      headless: true,
      // specify flags passed to chrome here
      // About our defaults values https://peter.sh/experiments/chromium-command-line-switches/
      chrome_flags: [
        //"--disable-infobars",
        //"--window-position=0,0",
        // "--ignore-certifcate-errors",
        // "--ignore-certifcate-errors-spki-list",
        //"--no-sandbox",
        // "--disable-setuid-sandbox",
        // "--disable-dev-shm-usage",
        // "--disable-accelerated-2d-canvas",
        "--disable-plugins",
        "--disable-extensions",
        // "--window-size=1280,768",
        // "--start-fullscreen",
        // "--hide-scrollbars",
        // "--disable-notifications",
        // '--use-gl=swiftshader',
                // '--disable-blink-features=AutomationControlled',
                // '--disable-features=IsolateOrigins,site-per-process',
                // '--disable-site-isolation-trials',
                // '--disable-web-security',
                // '--disable-features=BlockInsecurePrivateNetworkRequests',
                // '--disable-features=IsolateOrigins',
                // '--disable-site-isolation-trials'
      ],
      //fix google account can not login
      // ignoreDefaultArgs: [
      //   "--enable-automation",
      //   "--disable-extensions",
      //   "--disable-default-apps",
      //   "--disable-component-extensions-with-background-pages",
      // ],
      // the number of pages to scrape for each keyword
      num_pages: 1,
      // path to output file, data will be stored in JSON
      output_file: "",
      // whether to also passthru all the html output of the serp pages
      html_output: false,
      // whether to strip JS and CSS from the html_output
      // has only an effect if `html_output` is true
      clean_html_output: true,
      // remove all data images from the html
      clean_data_images: true,
      // whether to return a screenshot of serp pages as b64 data
      screen_output: false,
      // Scrape url from local file. Mainly used for testing.
      scrape_from_file: "",
      // whether to prevent images, css, fonts and media from being loaded
      // will speed up scraping a great deal
      block_assets: false,
      // path to js module that extends functionality
      // this module should export the functions:
      // get_browser, handle_metadata, close_browser
      //custom_func: resolve('examples/pluggable.js'),
      custom_func: null,
      throw_on_detection: false,
      // List proxy server
      //https://github.com/puppeteer/puppeteer/issues/2234
      proxies: null,
      // a file with one proxy per line. Example:
      // socks5://78.94.172.42:1080
      // http://118.174.233.10:48400
      // proxy_file: "",
      // whether to use proxies only
      // when this is set to true, se-scraper will not use
      // your default IP address
      use_proxies_only: false,
      // check if headless chrome escapes common detection techniques
      // this is a quick test and should be used for debugging
      test_evasion: true,
      apply_evasion_techniques: false,
      // settings for puppeteer-cluster
      puppeteer_cluster_config: {
        timeout: 30 * 60 * 1000, // max timeout set to 30 minutes
        monitor: false,
        // concurrency: Cluster.CONCURRENCY_BROWSER,
        maxConcurrency: 10,
      },
    });
    // if(!this.config.puppeteer_cluster_config.concurrency){
    //   this.config.puppeteer_cluster_config.concurrency = Cluster.CONCURRENCY_BROWSER
    // }

    this.logger = this.config.logger;

    if (config.sleep_range) {
      // parse an array
      // config.sleep_range = eval(config.sleep_range);

      if (
        config.sleep_range.length !== 2
      ) {
        throw "sleep_range is not a valid array of two integers.";
      }
    }

    if (fs.existsSync(this.config.keyword_file)) {
      this.config.keywords = read_keywords_from_file(this.config.keyword_file);
    }

    if (this.config.proxies && this.config.proxy_file) {
      throw new Error(
        "Either use a proxy_file or specify a proxy for all connections. Do not use both options."
      );
    }

    // if (this.config.proxy_file) {
    //   this.config.proxies = read_keywords_from_file(this.config.proxy_file);
    //   this.logger.info(`${this.config.proxies.length} proxies read from file.`);
    // }

    if (!this.config.proxies && this.config.use_proxies_only) {
      throw new Error(
        "Must provide at least one proxy in proxies if you enable use_proxies_only"
      );
    }

    logger("this.config=%O", this.config);
    //defind task id and task run id
    // if (config.taskid) {
    //   this.taskid = config.taskid;
    // }
    // if (config.taskrunId) {
    //   this.taskrunId = config.taskrunId;
    // }
    
  }

  /*
   * Launches the puppeteer cluster or browser.
   *
   * Returns true if the browser was successfully launched. Otherwise will return false.
   */
  async start(param: SearchDataParam) {
    //if (this.config.custom_func) {
    //   import PluggableClass from this.config.custom_func;

    //   this.pluggable = new PluggableClass({
    //     config: this.config,
    //     context: this.context,
    //   });
    // }

    // const chrome_flags = _.clone(this.config.chrome_flags);

    // if (this.pluggable && this.pluggable.start_browser) {
    //   // launch_args.config = this.config;
    //   this.browser = await this.pluggable.start_browser({
    //     config: this.config,
    //   });
    //   // console.log("229")
    //   this.page = await this.browser.newPage();
    // } else {

    // if no custom start_browser functionality was given
    // use puppeteer-cluster for scraping

    //let proxies:Array<ProxyServer>;
    // if we have at least one proxy, always use CONCURRENCY_BROWSER
    // and set maxConcurrency to this.config.proxies.length + 1
    this.config.test_evasion=false;
    // else use whatever this.configuration was passed
    if (this.config.proxies && this.config.proxies.length > 0) {
      // because we use real browsers, we ran out of memory on normal laptops
      // when using more than maybe 5 or 6 browsers.
      // therefore hardcode a limit here
      // TODO not sure this what we want
      this.numClusters = Math.min(
        //this.config.proxies.length + (this.config.use_proxies_only ? 0 : 1),
        this.config.proxies.length,
        MAX_ALLOWED_BROWSERS
      );

      this.proxiesArr = clone(this.config.proxies);

      // Insert a first config without proxy if use_proxy_only is false
      // if (this.config.use_proxies_only === false) {
      //   proxies.unshift(null);
      // }
    } else {
      this.numClusters = this.config.puppeteer_cluster_config.maxConcurrency;
      this.proxiesArr = times(this.numClusters, () => null);
    }

    this.logger.info(`Using ${this.numClusters} clusters.`);

    console.log(this.numClusters)
    //avoid to waste resource
    if (param.keywords.length < this.numClusters) {
      this.numClusters = param.keywords.length;
    }

    //https://github.com/puppeteer/puppeteer/issues/2234
    // Give the per browser options
    let userAgents: string;
    const perBrowserOptions = map(this.proxiesArr.slice(0, this.numClusters), (proxy) => {
      
      if (this.config.random_user_agent) {
        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        console.log("user agent is "+userAgent.toString());
        userAgents = userAgent.toString();
      } 
      else {
        userAgents = this.config.user_agent;
      }
      
      const res={
        headless: this.config.headless,
        ignoreHTTPSErrors: true,
        args: [
          ...this.config.chrome_flags,
           `--user-agent=${userAgents}`
        ],
      };
      // if(userAgents.length>0){
      //   res.args.push(`--user-agent=${userAgents}`)
      // }
      return res;
    });
    //console.log(this.config)
    console.log(perBrowserOptions);

    // puppeteer.use(_StealthPlugin());
    // puppeteer.use(_AdblockerPlugin());
    //currently I not know how to write it in typescript
    // const puppeteer = addExtra(vanillaPuppeteer);

    // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
    //  puppeteer.use(Stealth());

    // Add adblocker plugin to block all ads and trackers (saves bandwidth)
    // puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

    // const puppeteer = addExtra(vanillaPuppeteer);
    // puppeteer.use(StealthPlugin());
    this.cluster = await Cluster.launch({
      monitor: this.config.puppeteer_cluster_config.monitor,
      timeout: this.config.puppeteer_cluster_config.timeout,
      concurrency: CustomConcurrency,
      maxConcurrency: this.numClusters,
      perBrowserOptions: perBrowserOptions,
      retryLimit: 3,
      puppeteerOptions: {
        // Add default cookies that will be set for all browser instances
        defaultViewport: null,
      },
    });
    // console.log(this.cluster)
    //}
    //}
    this.cluster.on('taskerror', (err, data) => {
      console.log(`Error crawling ${data}: ${err.message}`);
    });
    //}
    //}
  }

  /*
   * login the socila media platform
   */
  // async login(scrape_config = {}) {
  //   Object.assign(this.config, scrape_config);

  //   // var results = {};
  //   // var num_requests = 0;
  //   // var metadata = {};
  //   // var startTime = Date.now();

  //   if (this.pluggable && this.pluggable.start_browser) {
  //     // console.log(this.config.platform)
  //     this.scraper = getScraper(this.config.platform, {
  //       config: this.config,
  //       context: this.context,
  //       pluggable: this.pluggable,
  //       page: this.page,
  //       // tmppath: this.tmppath,
  //     });

  //     await this.scraper.runLogin({ page: this.page });
  //   } else {
  //     // Each browser will get N/(K+1) keywords and will issue N/(K+1) * M total requests to the search engine.
  //     // https://github.com/GoogleChrome/puppeteer/issues/678
  //     // The question is: Is it possible to set proxies per Page? Per Browser?
  //     // as far as I can see, puppeteer cluster uses the same puppeteerOptions
  //     // for every browser instance. We will use our custom puppeteer-cluster version.
  //     // https://www.npmjs.com/package/proxy-chain
  //     // this answer looks nice: https://github.com/GoogleChrome/puppeteer/issues/678#issuecomment-389096077
  //     const chunks: [][] = [];
  //     for (let n = 0; n < this.numClusters; n++) {
  //       chunks.push([]);
  //     }
  //     for (let k = 0; k < this.config.keywords.length; k++) {
  //       chunks[k % this.numClusters].push(this.config.keywords[k] as never);
  //     }

  //     debug("chunks=%o", chunks);

  //     const execPromises = [];
  //     for (let c = 0; c < chunks.length; c++) {
  //       const config = _.clone(this.config);
  //       config.keywords = chunks[c];

  //       const obj = getScraper(this.config.platform, {
  //         config: config,
  //         context: {},
  //         pluggable: this.pluggable,
  //       });

  //       const boundMethod = obj.runLogin.bind(obj);
  //       execPromises.push(this.cluster.execute({}, boundMethod) as never);
  //     }

  //     await Promise.all(execPromises);

  //     // Merge results and metadata per keyword
  //     // for (let promiseReturn of promiseReturns) {
  //     //     Object.assign(results, promiseReturn.results);
  //     //     Object.assign(metadata, promiseReturn.metadata);
  //     //     num_requests += promiseReturn.num_requests;
  //     // }
  //   }

  //   // let timeDelta = Date.now() - startTime;
  //   // let ms_per_request = timeDelta/num_requests;

  //   // this.logger.info(`Scraper took ${timeDelta}ms to perform ${num_requests} requests.`);
  //   // this.logger.info(`On average ms/request: ${ms_per_request}ms/request`);

  //   // if (this.pluggable && this.pluggable.handle_results) {
  //   //     await this.pluggable.handle_results(results);
  //   // }

  //   // metadata.elapsed_time = timeDelta.toString();
  //   // metadata.ms_per_keyword = ms_per_request.toString();
  //   // metadata.num_requests = num_requests;

  //   // debug('metadata=%O', metadata);

  //   // if (this.pluggable && this.pluggable.handle_metadata) {
  //   //     await this.pluggable.handle_metadata(metadata);
  //   // }

  //   // if (this.config.output_file) {
  //   //     this.logger.info(`Writing results to ${this.config.output_file}`);
  //   //     write_results(this.config.output_file, JSON.stringify(results, null, 4));
  //   // }

  //   // return {
  //   //     results: results,
  //   //     metadata: metadata || {},
  //   // };
  // }

  /*
   * get data from search engine
   */
  async searchdata(param: SearchDataParam): Promise<Array<ResultParseItemType>> {
    await this.start(param);

    const results: Array<ResultParseItemType> = [];
    let num_requests = 0;
    const metadata: MetadataType = {};
    const startTime = Date.now();

    const chunks: Array<Array<string>> = [];

    for (let n = 0; n < this.numClusters; n++) {
      chunks.push([]);
    }
    for (let k = 0; k < param.keywords.length; k++) {
      chunks[k % this.numClusters].push(param.keywords[k]);
    }

    const engineFactory = new searchEngineFactory()
    const execPromises: Array<Promise<any>> = [];

    for (let c = 0; c < chunks.length; c++) {
      const scop: ScrapeOptions = {
        config: this.config,
        context: this.context,
        page: this.page,
      }
      const obj = engineFactory.getSearchEngine(param.engine.toLowerCase(), scop)
      const boundMethod = obj.run.bind(obj);
      let cookiesArray:Array<CookiesType>=[]
      if (param.cookies && param.cookies.length > 0) {
        const randomIndex = Math.floor(Math.random() * param.cookies.length);
        cookiesArray = param.cookies[randomIndex];
      }
      const cludata: ClusterSearchData = {
        keywords: chunks[c],
        cookies:cookiesArray
      }
      console.log("cludata=%O",cludata)
      if (this.proxiesArr && this.proxiesArr.length > 0) {
        const randomIndex = Math.floor(Math.random() * this.proxiesArr.length);
        cludata.proxyServer = this.proxiesArr[randomIndex];
      }
      // if(param.cookies){
      //   cludata.cookies=param.cookies
      // }

      // Wrap the execute call in a try-catch to handle Puppeteer errors
      const wrappedExecute = async () => {
        try {
          const content = await this.cluster.execute(cludata, boundMethod);
          // await page.evaluateOnNewDocument(() => {
          //   Object.defineProperty(navigator, 'plugins', {
          //     get: () => [1, 2, 3, 4, 5],
          //   });
          //   Object.defineProperty(navigator, 'languages', {
          //     get: () => ['en-US', 'en'],
          //   });
          //   });
          // await page.setExtraHTTPHeaders({
          //   'accept-language': 'en-US,en;q=0.9',
          //   // Add more headers if needed
          // });
          // await page.setViewport({ width: 1920, height: 1080 });
          console.log(`scraper content: ${content}`);
          return {
            results: content,
            metadata: {},
            num_requests: 1,
          };
        } catch (error) {
          if (error instanceof Error) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const debugDir = this.debug_log_path || "./debug";

            // Create debug directory if it doesn't exist
            if (!fs.existsSync(debugDir)) {
              fs.mkdirSync(debugDir);
            }

            // Use the page from ScrapeOptions
            if (scop.page) {
              const page = scop.page;

              // Save HTML
              const html = await page.content();
              const htmlPath = `${debugDir}/error_${timestamp}.html`;
              fs.writeFileSync(htmlPath, html);

              // Save screenshot
              const screenshotPath = `${debugDir}/error_${timestamp}.png`;
              await page.screenshot({
                path: screenshotPath as `${string}.png`,
                fullPage: true
              });

              this.logger.error(`Puppeteer error occurred. Debug files saved to ${debugDir}/error_${timestamp}.*`);
              this.logger.error(`Error details: ${error.message}`);
            }
          }
          throw error; // Re-throw the error after saving debug info
        }
      };

      execPromises.push(wrappedExecute());
    }

    try {
      const promiseReturns = await Promise.all(execPromises);

      // Merge results and metadata per keyword
      for (const promiseReturn of promiseReturns) {
        console.log(`promiseReturn: ${promiseReturn}`);
        console.log(`promiseReturn.results: ${promiseReturn.results}`);
        results.push(promiseReturn.results.results  );
        //Object.assign(results, promiseReturn.results);
        Object.assign(metadata, promiseReturn.metadata);
        num_requests += promiseReturn.num_requests;
      }
    } catch (error) {
      this.logger.error('Error during search execution:', error);
      throw error;
    } finally {
      await this.quit();
    }

    const timeDelta = Date.now() - startTime;
    const ms_per_request = timeDelta / num_requests;
    this.logger.info(`Scraper took ${timeDelta}ms to perform ${num_requests} requests.`);
    this.logger.info(`On average ms/request: ${ms_per_request}ms/request`);

    if (this.pluggable && this.pluggable.handle_results) {
      await this.pluggable.handle_results(results);
    }

    metadata.elapsed_time = timeDelta.toString();
    metadata.ms_per_keyword = ms_per_request.toString();
    metadata.num_requests = num_requests;

    if (this.pluggable && this.pluggable.handle_metadata) {
      await this.pluggable.handle_metadata(metadata);
    }

    if (this.config.output_file) {
      this.logger.info(`Writing results to ${this.config.output_file}`);
      writeResults(this.config.output_file, JSON.stringify(results, null, 4));
    }
    console.log(`results: ${results}`);
    return results;
    // return {
    //   //results: results,
    //   //metadata: metadata || {},
    // };
  }

  //   // let timeDelta = Date.now() - startTime;
  //   // let ms_per_request = timeDelta/num_requests;

  //   // this.logger.info(`Scraper took ${timeDelta}ms to perform ${num_requests} requests.`);
  //   // this.logger.info(`On average ms/request: ${ms_per_request}ms/request`);

  //   // if (this.pluggable && this.pluggable.handle_results) {
  //   //     await this.pluggable.handle_results(results);
  //   // }

  //   // metadata.elapsed_time = timeDelta.toString();
  //   // metadata.ms_per_keyword = ms_per_request.toString();
  //   // metadata.num_requests = num_requests;

  //   // debug('metadata=%O', metadata);

  //   // if (this.pluggable && this.pluggable.handle_metadata) {
  //   //     await this.pluggable.handle_metadata(metadata);
  //   // }

  //   // if (this.config.output_file) {
  //   //     this.logger.info(`Writing results to ${this.config.output_file}`);
  //   //     write_results(this.config.output_file, JSON.stringify(results, null, 4));
  //   // }

  //   // return {
  //   //     results: results,
  //   //     metadata: metadata || {},
  //   // };
  // }

  /*
   * Quit the puppeteer cluster/browser.
   */
  async quit() {
    if (this.pluggable && this.pluggable.close_browser) {
      await this.pluggable.close_browser();
    } else {
      await this.cluster.idle();
      await this.cluster.close();
    }
  }
  // async downloadPlatomvideo(links: Array<Linkdata>) {
  //   //check whether user send correct platform parameter 
  //   const availPlatform = ["bilibili"];
  //   if (!availPlatform.includes(this.config.platform)) {
  //     throw new Error("download video function not work at platform " + this.config.platform)
  //   }
  //   this.scraper = getScraper(this.config.platform, {
  //     config: this.config,
  //     context: this.context,
  //     pluggable: this.pluggable,
  //     page: this.page,
  //     // tmppath: this.tmppath,
  //   });
  //   debug("links=%o", links)
  //   //console.log(this.scraper)

  //   //add observer before download video
  //   const videodownObser = new videodownloadObserver();
  //   this.scraper.attach(videodownObser);
  //   await this.scraper.downloadvideo(links)


  // }
}