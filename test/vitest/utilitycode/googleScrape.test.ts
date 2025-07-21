'use strict';
import { expect, test } from 'vitest'
import {ScrapeManager} from "@/childprocess/scrapeManager"
import {SMstruct,SearchDataParam} from "@/entityTypes/scrapeType"
test('google-scraper', async function () {
    const smConfig:SMstruct={
        headless:false,
        debug_level:1,
        puppeteer_cluster_config:{
            timeout: 30 * 60 * 1000, // max timeout set to 10 minutes
            monitor: true,
            concurrency: 10, // one scraper per tab
            maxConcurrency: 1, // scrape with 1 tab
        },
        num_pages:3,
    }
    const keywords=['Williams','doctor']
    const scraper=new ScrapeManager(smConfig)
    // await scraper.start()
    const searchDataParam:SearchDataParam={
    keywords:keywords,
    engine:"google",
    //useLocalbrowserdata:false,
    }
    const results=await scraper.searchdata(searchDataParam)
    console.log(results)
},500000)