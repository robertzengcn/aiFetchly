"use strict";

const cheerio = require("cheerio");
import { SocialScraper as Scraper, Linkurl, ScrapeOptions, Searchobject } from "./socialScraper";
const fs = require("fs");
import { Downloader } from "@/modules/bilibili/downloader";
const path = require("path");
const sanitize = require("filenamify");
const debug = require("debug")("bilibili-scraper");
import { autoScroll, delay } from "@/modules/lib/function";
import { ElementHandle, Page, } from 'puppeteer';
const debugerror = debug('app:error');

type clickbtnserobj = {
  page: Page,
  keyword: string
}
// import filenamify from 'filenamify';
// const { launch, getStream } = require("puppeteer-stream");
// const PuppeteerVideoRecorder = require('puppeteer-video-recorder');
export class BilibiliScraper extends Scraper {
  startUrl: string;

  constructor(args: ScrapeOptions) {
    super(args);
    this.startUrl = "https://www.bilibili.com";
    this.taskid = args.taskid;
    this.taskrunid = args.taskrunid;
  }
  async load_start_page(): Promise<void> {
    debug("load start page")

  }
  //login into bilibili
  async makeloginaction(): Promise<boolean> {
    // let startUrl = "https://www.bilibili.com";

    this.logger.info("Using loginUrl: " + this.startUrl);
    await this.page.setBypassCSP(true);
    this.last_response = await this.page.goto(this.startUrl);
    //cookies should not save in this way
    // debug(
    //   "login success, cookies has been save at " + this.config.tmppath
    // );
    //click login btn
    await this.page.click(".header-login-entry");
    // await this.page.evaluate(_ => {
    // var icon = document.getElementById("logo");
    // icon.style.display = "none";
    // });
    //wait login box show
    await this.page.waitForSelector(".bili-mini-content-wp", {
      timeout: this.STANDARD_TIMEOUT,
    });

    //click login by sms
    const button = await this.page.$("//div[contains(., ' 短信登录 ')]");
    if (button) {
      await (button as ElementHandle<Element>).click();
    }
    //await for user to take action
    await this.page.waitForSelector(".header-entry-mini", { timeout: 0 });
    //user has success login
    //save cookies
    const cookies = await this.page.cookies();

    await fs.writeFile(
      // this.config.tmppath + "/cookies.json",
      JSON.stringify(cookies, null, 2),
      (err) => {
        if (err) {
          debugerror(err);
        }
      }
    );
    await this.page.close();
    // await this.browsers.close();
    return true;
  }

  /**
   * get video list page
   * @param {object} page
   * @param {string} keyword
   * @returns element
   */
  async clickSearchbtn(searobj: clickbtnserobj): Promise<ElementHandle<Element> | null> {
    if (searobj.page) {
      this.page = searobj.page;
    }

    this.logger.info("Using loginUrl: " + this.startUrl);
    await this.page.setBypassCSP(true);
    this.last_response = await this.page.goto(this.startUrl);
    await this.page.type(".nav-search-input", searobj.keyword);
    // await this.page.$eval(".nav-search-input", function (keyword) {
    //   this.value = keyword;
    // });
    // await page.$eval('.nav-search-input', el => el.value = "");
    const searchbtn = await this.page.$(".nav-search-btn");
    if (searchbtn) {
      await searchbtn.click();
    }
    return searchbtn;
  }
  /**
   *
   * @param {object} page
   * @param {string} keyword
   * @returns array
   */
  async searchdata(searobj: Searchobject): Promise<Array<object>> {
    if (searobj.page) {
      this.page = searobj.page;
    }
    const result: Array<object> = []
    if (Array.isArray(searobj.keyword)) {
      for (const element of searobj.keyword) {
        const subsearobg: Searchobject = { page: this.page, keyword: element }
        const linkres = await this.getVideourls(subsearobg);
        if (linkres) {
          for (const link of linkres) {
            result.push(link)
          }
        }
      }

    } else if (typeof searobj.keyword === 'string') {
      const sersearobg: Searchobject = { page: this.page, keyword: searobj.keyword }
      const linkres = await this.getVideourls(sersearobg);
      if (linkres) {
        for (const link of linkres) {

          result.push(linkres)
        }
      }
    }
    return result
    // return await this.getVideourls({ page: this.page, keyword: keyword });
  }
  //get video url return in array
  /**
   *
   * @param {object,string,string}
   * @returns array
   */
  async getVideourls(serobj: Searchobject): Promise<Array<Linkurl> | null> {
    if (serobj.page) {
      this.page = serobj.page;
    }
    if (serobj.cookiesPath) {
      if (!fs.existsSync(serobj.cookiesPath)) {
        throw new Error(`Cannot find cookies file at ${serobj.cookiesPath}`);
      }

      const cookies = JSON.parse(await fs.promises.readFile(serobj.cookiesPath));
      // console.log(cookies);
      await this.page.setCookie(...cookies);
    }

    if (typeof serobj.keyword === 'string') {
      return await this.handleSearch({ page: this.page, keyword: serobj.keyword })
    } else {
      const linkres: Array<Linkurl> = [];
      for (const keyelement of serobj.keyword) {
        const res = await this.handleSearch({ page: this.page, keyword: keyelement })
        if (res) {
          for (const link of res) {
            linkres.push(link)
          }
        }
      }
      return linkres
    }

  }

  async handleSearch(csobj: clickbtnserobj): Promise<Array<Linkurl> | null> {
    const searchbtn = await this.clickSearchbtn({
      page: this.page,
      keyword: csobj.keyword,
    });

    const browser = this.page.browser();
     await browser.waitForTarget((target) =>
      target.url().includes("search.bilibili.com")
    );
    const pages = await browser.pages();
    let searchPage;
    for (const page of pages) {
      const pageurl = await page.url(); // new page now appear!
      // debug(await page.title())
      if (pageurl.includes("search.bilibili.com")) {
        searchPage = page;
        break;
      }
    }
    if (!searchPage) {
      throw new Error("search page not found");
    }

    await autoScroll(searchPage);

    try {
      await searchPage.waitForSelector(".vui_pagenation", { timeout: 5000 });
    } catch (e) {
      //if (e instanceof Puppeteererror.TimeoutError) {
      // Do something if this is a timeout in find page
      debug("not find .vui_pagenation item, the page may not have result")
      //return empty promise array
      return new Promise((resolve) => { resolve(null); });
      //}
    }
    const linkres: Array<Linkurl> = [];
    // await this.page.$$("button.vui_button", elements=>{
    //   console.log(elements)
    // })
    const linkPage = await searchPage.$$("button.vui_button");
    debug(linkPage);
    for (let i = 0; i < linkPage.length; i++) {

      await searchPage.evaluate((element) => {
        element.click();
      }, linkPage[i]);
      const links = await this.getVideolistlink({ page: searchPage });
      debug(links);
      links.map((link) => {
        linkres.push(link);
      });
    }


    return linkres;
  }
  /**
   *
   * @param {page} page
   * @returns array
   */
  async getVideolistlink({ page }): Promise<Array<Linkurl>> {
    if (page) {
      this.page = page;
    }
    // const elHandleArray = await page.$$(
    //   ".bili-video-card__info--right a:nth-child(1)"
    // );

    let linkmap: Array<Linkurl> = [];
    // const that=this;
    // debug(this.taskid)
    // let taskids = 0;
    // if (this.taskid) {
    //   taskids = this.taskid
    // }
    // linkmap = await this.page.$$eval(
    //   ".bili-video-card__info--right >a:first-child",
    //   (alinks, taskids) => {
    //     return alinks.map((alink) => {
    //       const linkobg: Linkurl = { title: '', link: '', lang: 'zh-cn' };
    //       // if(!that.taskid){
    //       // linkobg.taskid=that.taskid;
    //       // }
    //       if (taskids) {
    //         linkobg.taskid = taskids
    //       }
    //       const herf = alink.getAttribute("href")
    //       if (herf) {
    //         linkobg.link = herf
    //       }
    //       // console.log(alink);
    //       const htitle = alink.querySelector("h3");
    //       if (htitle) {
    //         const htres = htitle.getAttribute("title");
    //         if (htres) {
    //           linkobg.title = htres
    //         }
    //       }
    //       return linkobg;
    //     });
    //   }, taskids
    // );

    linkmap = await this.page.$$eval(
      ".bili-video-card__info--right >a:first-child",
      (alinks) => {
        return alinks.map((alink) => {
          const linkobg: Linkurl = { title: '', link: '', lang: 'zh-cn' };
          // if(!that.taskid){
          // linkobg.taskid=that.taskid;
          // }
          // if (taskids) {
          //   linkobg.taskid = taskids
          // }
          const herf = alink.getAttribute("href")
          if (herf) {
            linkobg.link = herf
            //check if link not start with https
            if (!herf.startsWith("https")) {
              linkobg.link = "https:" + herf
            }
          }
          // console.log(alink);
          const htitle = alink.querySelector("h3");
          if (htitle) {
            const htres = htitle.getAttribute("title");
            if (htres) {
              linkobg.title = htres
            }
          }
          return linkobg;
        });
      }
    );

    // debug("query link finish");
    // debug(linkmap);
    // debug("show link finish");
    // console.log(linkmap)

    await linkmap.forEach((element, index) => {
      if (!element.link.includes("/video/")) {
        // debug("element has video "+element)
        linkmap.splice(index, 1);
      }
    });
    await linkmap.forEach((element, index) => {
      if (element.link.includes("/api/")) {
        debug("element has api " + element);
        linkmap.splice(index, 1);
      }
    });
    //debug("filter link finish");
    debug(linkmap);

    return linkmap;
  }
  /**
   *
   * @param {object} page
   * @param {string} link
   * @param {string} videopath
   */
  async downloadSigleVideo(link: string, videopath: string): Promise<Array<string>> {
   
    if (!link) {
      debug(link)
      throw new Error("link is empty")
    }
    const downloader = new Downloader();
    downloader.getVideoUrl(link);
    if (!downloader.url) {
      throw new Error("video url invalid");
    }
    await downloader.getAid();

    const videores = await downloader.getInfo();
    debug("VIDEO INFO", videores);
    // const downloadPath ='/home/robertzeng/downloadtest';
    const filename = Math.random().toString(20).slice(2);
    const { data, fallback } = await downloader.getData();

    const target = data.durl || data.result.durl;
    const quality = data.quality || data.result.quality,
      qualityArray = {
        112: "1080P+",
        80: "1080P",
        74: "720P60",
        64: "720P",
        48: "720P",
        32: "480P",
        16: "360P",
        15: "360P",
      };
    const videoQuantity = qualityArray[quality] || "unknown";
    debug("videoQuantity is " + videoQuantity);
    if (fallback) {
      throw new Error("error happen when get video data");
    }
    // debug("echo target");
    // debug(target);
    const result: Array<string> = [];
    target.forEach((element, part) => {
      const file = path.join(videopath, `${sanitize(filename)}-${part}.flv`);
      debug("part is %o", part);
      debug("file name %o", file);

      const state = downloader.downloadByIndex(
        part,
        file,
        (progress, index) => {
          const { speed, eta, percentage } = progress; //显示进度条
          // console.log("speed: " + Math.round(speed / 1e3) + "KB/s");
          // console.log(`eta:${eta}s`);
        }
      );
      result.push(file)
    });

    return result;
  }
  /**
   * get video detail
   * @param {object} page
   * @param {string} link
   */
  async getVideodetail(page, link) {
    if (page) {
      this.page = page;
    }
    await this.page.goto(link, {
      waitUntil: "domcontentloaded",
    });

    // await this.page.waitForSe
  }
}

module.exports = {
  BilibiliScraper: BilibiliScraper,
};
