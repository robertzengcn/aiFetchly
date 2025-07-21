import { EmailClusterdata, EmailDatascraper } from '@/entityTypes/emailextraction-type'
import { SMconfig, SMstruct } from "@/entityTypes/scrapeType"
import { Cluster } from "puppeteer-cluster"
//import { pluggableType } from "@/entityTypes/scrapeType"
import { Page, Browser } from 'puppeteer';
import defaults from "lodash/defaults"
import winston from "winston"
import { createLogger, format, transports } from "winston"
import debug from 'debug';
const logger = debug('ScrapeManager');
const { combine, timestamp, printf } = format;
const MAX_ALLOWED_BROWSERS = 10;
const MAX_CRAWL_PAGE_LENGTH = 10;
import map from "lodash/map";
//import randomUseragent from "random-useragent";
import UserAgent from 'user-agents';
import clone from "lodash/clone"
import times from "lodash/times"
import { crawlSite } from '@/childprocess/emailScraper'
import { getDomain } from "@/modules/lib/function"
import {CustomConcurrency} from "@/modules/concurrency-implementation"
import {ProxyServer} from "@/entityTypes/proxyType"

export class EmailCluster {
  cluster: Cluster<EmailClusterdata>;
  context: object;
  config: SMconfig;
  logger: winston.Logger;
  // logger: { info: Function };
  browser: Browser;
  page: Page;
  numClusters: number;
  tmppath: string;
  proxiesArr: Array<ProxyServer|null>
  maxPageNumber:number
  // runLogin: Function;
  // taskid?: number;
  // taskrunId?: number;
  // chrome_flags=[];
  constructor(config: SMstruct, context = {}) {
    // this.cluster = null;
    // this.pluggable = null;
    // this.scraper = null;
    this.context = context;

    // await this.getRemoteConfig(campaignId)

    this.config = defaults(config, {
      // remote_add:endcofig.REMOTEADD,
      // remote_username:endcofig.USERNAME,
      // remote_password:endcofig.PASSWORD,
      // the user agent to scrape with
      user_agent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      // if random_user_agent is set to True, a random user agent is chosen
      random_user_agent: true,
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
        // "--disable-infobars",
        // "--window-position=0,0",
        // "--ignore-certifcate-errors",
        // "--ignore-certifcate-errors-spki-list",
        // "--no-sandbox",
        // "--disable-setuid-sandbox",
        // "--disable-dev-shm-usage",
        // "--disable-accelerated-2d-canvas",
        // "--disable-gpu",
        // "--window-size=1280,768",
        // "--start-fullscreen",
        // "--hide-scrollbars",
        // "--disable-notifications",
      ],
      //fix google account can not login
      ignoreDefaultArgs: [
        "--enable-automation",
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-component-extensions-with-background-pages",
      ],
      // the number of pages to scrape for each keyword
      page_length: 1,
      // path to output file, data will be stored in JSON
      // output_file: "",
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
      test_evasion: false,
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
    if(config.maxPageNumber&&config.maxPageNumber>0){
      this.maxPageNumber = config.maxPageNumber
    }

    if (config.sleep_range) {
      // parse an array
      // config.sleep_range = eval(config.sleep_range);

      if (
        config.sleep_range.length !== 2
      ) {
        throw "sleep_range is not a valid array of two integers.";
      }
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
  //init cluster
  async start(scraperData: EmailDatascraper) {
    this.numClusters = Math.min(
      //this.config.proxies.length + (this.config.use_proxies_only ? 0 : 1),
      scraperData.urls.length,
      MAX_ALLOWED_BROWSERS
    );

    if (this.config.proxies && this.config.proxies.length > 0) {
      this.proxiesArr = clone(this.config.proxies);
    } else {
      this.numClusters = this.config.puppeteer_cluster_config.maxConcurrency;
      this.proxiesArr = times(this.numClusters, () => null);
    }

    const perBrowserOptions = map(this.proxiesArr.slice(0, this.numClusters), (proxy) => {
      //let userAgent: string;
      let userAgents: string;
      if (this.config.random_user_agent) {
        // Randomly choose between Chrome and Firefox user agents
        // const isChrome = Math.random() > 0.5;
        // if (isChrome) {
        //   // Modern Chrome user agent
        //   userAgent = new UserAgent({
        //     deviceCategory: "desktop",
        //     browser: "chrome",
        //     platform: "win32"
        //   }).toString();
        // } else {
        //   // Modern Firefox user agent
        //   userAgent = new UserAgent({
        //     deviceCategory: "desktop",
        //     browser: "firefox",
        //     platform: "win32"
        //   }).toString();
        // }
        // const Agent = new UserAgent({
        //   deviceCategory: "desktop",
        //   //browser: "chrome",
        //   platform: "win32"
        // });
        //userAgent = randomUseragent.getRandom();
        const userAgent = new UserAgent({ deviceCategory: 'desktop' });
        console.log("user agent is "+userAgent.toString());
        userAgents = userAgent.toString();
      } else {
        userAgents = this.config.user_agent;
      }
      const args = this.config.chrome_flags.concat([`--user-agent=${userAgents}`]);
      return {
        headless: this.config.headless,
        ignoreHTTPSErrors: true,
        args,
      };
    });
    this.logger.info(perBrowserOptions);
    console.log("cluster number is "+this.numClusters)
    this.cluster = await Cluster.launch({
      // puppeteer,
      monitor: this.config.puppeteer_cluster_config.monitor,
      timeout: this.config.puppeteer_cluster_config.timeout, // max timeout set to 30 minutes
      // concurrency: Cluster.CONCURRENCY_CONTEXT,
      concurrency: CustomConcurrency,
      maxConcurrency: Number(this.numClusters),
      perBrowserOptions: perBrowserOptions,
      retryLimit: 3,
      // puppeteerOptions:perBrowserOptions,
    });


  }

  async searchdata(param: EmailDatascraper) {
    await this.start(param);
    const pageLength = Math.min(this.config.page_length, MAX_CRAWL_PAGE_LENGTH)
    await this.cluster.task(crawlSite)
    param.urls.forEach((value) => {
      const domain = getDomain(value)
      if (!domain) {
        return
      }
      //get random proxy 
      const randomIndex = Math.floor(Math.random() * this.proxiesArr.length);
      const proxyServer = this.proxiesArr[randomIndex];
      const crawlData: EmailClusterdata = {
        url: value,
        proxy: proxyServer,
        domain: domain,
        maxPageLevel: pageLength,
        maxPageNumber:this.maxPageNumber,
        callback: param.callback
      }
      this.cluster.queue(crawlData);
    })
    await this.quit();
  }

  async quit() {
  
      await this.cluster.idle();
      await this.cluster.close();
    
  }
}