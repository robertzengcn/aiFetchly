import {
  EmailDatascraper,
  EmailResult,
} from "@/entityTypes/emailextraction-type";
import { ProxyParseItem } from "@/entityTypes/proxyType";
import { proxyEntityToUrl } from "@/modules/lib/function";
import { SMstruct } from "@/entityTypes/scrapeType";
import { Cluster } from "puppeteer-cluster";
import { EmailCluster } from "@/childprocess/emailCluster";
import { EmailsControldata } from "@/entityTypes/emailextraction-type";
import { normalizeEmailSearchConcurrency } from "@/modules/emailSearchConcurrency";

export {
  DEFAULT_EMAIL_SEARCH_CONCURRENCY,
  MAX_EMAIL_SEARCH_CONCURRENCY,
  normalizeEmailSearchConcurrency,
} from "@/modules/emailSearchConcurrency";

export class EmailSearch {
  public async searchEmail(
    data: EmailsControldata,
    callback?: (arg: EmailResult) => void
  ) {
    const proxyStrList: Array<string> = [];
    console.log("proxy are following");
    // console.log(data.proxys)
    if (data.proxys) {
      data.proxys.forEach((value) => {
        const proxyitem: ProxyParseItem = {
          host: value.host,
          port: value.port,
          user: value.user,
          pass: value.pass,
          protocol: value.protocol,
        };
        const proxyStr = proxyEntityToUrl(proxyitem);
        proxyStrList.push(proxyStr);
      });
    }
    const smConfig: SMstruct = {
      headless: data.notShowBrowser,
      debug_level: 1,
      puppeteer_cluster_config: {
        timeout: data.processTimeout * 60 * 1000, // max timeout set to 10 minutes
        monitor: true,
        concurrency: Cluster.CONCURRENCY_BROWSER,
        //concurrency:data.concurrency, // one scraper per tab
        maxConcurrency: normalizeEmailSearchConcurrency(data.concurrency),
      },
      page_length: data.pagelength,
      block_assets: true,
      proxies: proxyStrList,
      maxPageNumber: data.maxPageNumber ? data.maxPageNumber : 0,
    };
    const emailCluster = new EmailCluster(smConfig);
    const sedata: EmailDatascraper = {
      urls: data.validUrls,
      aiSupportEnabled: data.aiSupportEnabled || false,
      callback: callback,
    };

    await emailCluster.searchdata(sedata);
  }
}
