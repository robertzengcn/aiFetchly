export {};
import {EmailClusterdata,EmailResult} from '@/entityTypes/emailextraction-type'
import { Page,InterceptResolutionAction} from 'puppeteer';
import useProxy from "@lem0-packages/puppeteer-page-proxy"
import {convertProxyServertourl} from "@/modules/lib/function"

export const extractLink = async (page: Page, val: EmailClusterdata ) => {
    const url = val.url;
    if (!url) return;
    const maxPageNumber = val.maxPageNumber?val.maxPageNumber:0
    
    if(val.proxy){
        if (val.proxy != undefined) {
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
            // this.proxyServer = data.data.proxyServer
            await page.setRequestInterception(true);
            page.on("request", async (interceptedRequest) => {
                if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                // if (interceptedRequest.resourceType() === "image") {
                //     interceptedRequest.abort();
                // } else {
                    await useProxy(interceptedRequest, convertProxyServertourl(val.proxy!));
                    if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                    interceptedRequest.continue();
               // }
            });
        }
    }
    await page.goto(url,{
        waitUntil: "networkidle2",
        timeout: 60000
    });
    const pageTitle = await page.evaluate(() => document.title);

    // Extract all links from the page
    const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a')).map(anchor => anchor.href);
    });

    // Filter links with page level less than 3
    const filteredLinks = links.filter(link => {
        try{
        const furl = new URL(link);
        const pathSegments = furl.pathname.split('/').filter(segment => segment.length > 0);
        return pathSegments.length < val.maxPageLevel&&furl.hostname.endsWith(val.domain);
        }catch(e){
            return false;
        }
    });
    const emails = await page.evaluate(() => {
        const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/g;
        const bodyText = document.body.innerText;
        return bodyText.match(emailRegex) || [];
    });
    if(val.callback){
        if(emails.length>0){
        const er:EmailResult={
            url:url,
            pageTitle:pageTitle,
            filteredLinks:filteredLinks,
            emails:emails
        }
        val.callback(er)
    }
    }

    return {
        pageTitle,
        filteredLinks,
        emails
    };
};
export async function crawlSite ({ page, data }: { page: Page; data: EmailClusterdata })  {
    if(data.url.length==0){
        return;
    }
    if(!data.visited){
        data.visited=new Set() 
    }
    if (data.visited.has(data.url)) return;
    data.visited.add(data.url);

    // Check if we've exceeded maxPageNumber
    const maxPageNumber = data.maxPageNumber ?? 0;
    if (maxPageNumber > 0 && data.visited.size > maxPageNumber) {
        console.log(`Reached maximum page limit of ${maxPageNumber}`);
        return;
    }

    if (data.proxy) {
        if (data.proxy != undefined) {
 
            this.proxyServer = data.proxy
            await this.page.setRequestInterception(true);
            this.page.on("request", async (interceptedRequest) => {
                if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                // if (interceptedRequest.resourceType() === "image") {
                //     interceptedRequest.abort();
                // } else {
                    await useProxy(interceptedRequest, convertProxyServertourl(data.proxy!));
                    if (interceptedRequest.interceptResolutionState().action === InterceptResolutionAction.AlreadyHandled) return;
                    interceptedRequest.continue();
               // }
            });
        }
    }

    const result = await extractLink( page, {url:data.url,domain:data.domain,maxPageLevel:data.maxPageLevel,callback:data.callback} ); 
    console.log("extract link result is following")
    console.log(result)
    if (!result) return;

    console.log(`Page Title: ${result.pageTitle}`);
    console.log(`URL: ${data.url}`);
    console.log(`Filtered Links: ${result.filteredLinks}`);

    for (const link of result.filteredLinks) {
        // const crawdata:EmailClusterdata={
        //     url:link,
        //     domain:data.domain,
        //     maxPageLevel:data.maxPageLevel,
        //     visited:data.visited,
        //     callback:data.callback
        // }
        data.url=link;
        await crawlSite({page:page, data:data});
    }
}

