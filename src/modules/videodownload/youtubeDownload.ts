import { VideoDownloadImpl } from "@/modules/interface/videoDownloadImpl"
import { CustomError } from "@/modules/customError"
import { exec } from "child_process";
import { promisify } from "util";
import { CookiesProxy,VideodoanloadSuccessCall,YoutubedlStrout } from "@/entityTypes/videoType"
import { Proxy, ProxyParseItem } from "@/entityTypes/proxyType"
import { convertCookiesToNetscapeFile, generateRandomUniqueString, proxyEntityToUrl,removeParamsAfterAmpersand,scrollPageToBottom,closePuppeteer } from "@/modules/lib/function"
import { CookiesType} from "@/entityTypes/cookiesType"
import * as fs from 'fs';
import puppeteer, { ElementHandle } from 'puppeteer';
import { browserManager } from "@/modules/browserManager"
// import { Page, Browser} from 'puppeteer';

// import * as fs from 'fs';
import * as path from 'path';
const execAsync = promisify(exec);
export class YoutubeDownload implements VideoDownloadImpl {
    private playerlisttype="/playlist?"
    // private signalplaytype="/watch?"
    async downloadVideo(url: string, savePath: string, useBrowserCookies?:string,cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, videoQuality?:number,errorCall?: (link:string,errorMsg: string) => void, stroutCall?: (message: string) => void, successCall?: (param:VideodoanloadSuccessCall) => void) {
        if (!execPath) {
            throw new CustomError("youtube video package not found")
        }
        let execcommand = '';
        let command = `"${execPath}" -P "${savePath}"`;
        let cookiesFilePath = '';
        if(useBrowserCookies){
            command+=' --cookies-from-browser '+useBrowserCookies
        }
        if (cookiesProxy) {
            //handle cookies
            if (cookiesProxy.cookies&&(!useBrowserCookies)) {
                const cookiesObj = JSON.parse(cookiesProxy.cookies) as CookiesType[]; 
                console.log(cookiesObj)
                const randomName = generateRandomUniqueString(10)
                cookiesFilePath = path.join(__dirname, 'cookies-' + randomName + '.txt');
                convertCookiesToNetscapeFile(cookiesObj, cookiesFilePath);
                console.log(cookiesFilePath)
                command += ' --cookies' + ' ' + cookiesFilePath+''

            }
            //handle cookies proxy
            if (cookiesProxy.proxy&&(!useBrowserCookies)) {
                // const proxies = JSON.parse(cookiesProxy.proxy) as ProxyParseItem[];
                const randomProxy = cookiesProxy.proxy[Math.floor(Math.random() * cookiesProxy.proxy.length)];
                if (randomProxy.host && randomProxy.port) {
                    const ProxyParse: ProxyParseItem = {
                        host: randomProxy.host,
                        port: randomProxy.port,
                        user: randomProxy.username,
                        pass: randomProxy.password,
                        protocol: randomProxy.protocol
                    }
                    const proxyStr = proxyEntityToUrl(ProxyParse);
                    command += ' --proxy ' + proxyStr;
                }
            }
        }
        if (proxy) {
            if (!command.indexOf("--proxy")) {
                //convert proxy to proxy ProxyParseItem
                if (proxy.host && proxy.port) {
                    const proxyitem: ProxyParseItem = {
                        host: proxy.host,
                        port: proxy.port,
                        user: proxy.username,
                        pass: proxy.password,
                        protocol: proxy.protocol
                    }
                    const proxyStr = proxyEntityToUrl(proxyitem)
                    command += ' --proxy ' + proxyStr
                }
            }
        }
        // if(isSingleVideo){
            command+=' --no-playlist'
        // }
        if(videoQuality){
            command+=' --audio-quality '+Math.round(videoQuality)
        }else{
            command+=' --audio-quality 0'
        }
        command+=' -o "%(title)s-%(id)s.%(ext)s" --restrict-filenames'
        // command+= ' -f "bestvideo+bestaudio/best"'
        execcommand=command+' --no-simulate --print after_move:filepath -f "bestvideo+bestaudio/best"'
        
        // command+=' --print after_move:filepath'
        execcommand=execcommand+' "'+url+'"'
        console.log(execcommand)
        const { stdout, stderr } = await execAsync(execcommand);
        if (stroutCall) {
            console.log("start strout call")
            console.log(stdout)
            stroutCall(stdout)
        }
        if (stderr) {
            console.error("download error "+stderr)
            if (errorCall) {
                errorCall(url,stderr)
            }
        } else {
            if (successCall) {
                console.log("start success call")
                let downloadedFilePath = '';
                if(stdout){
                    //stdout is the file path, check file path is exist
                    downloadedFilePath = stdout.trim() // Remove any quotation marks
                    if (fs.existsSync(downloadedFilePath)) {
                        // const jscommand=command+" "+url
                        //download success, start to get video title and description
                        await this.getVideodesc(command,url).then((data)=>{
                           
                        const sendParam:VideodoanloadSuccessCall={
                            link:url,
                            title:data?.title?data.title:'',
                            description:data?.description?data.description:'',
                            savepath:downloadedFilePath,
                            tags:data?.tags?data.tags:[],
                            categories:data?.categories?data.categories:[],
                        }
                        successCall(sendParam)

                    })
                    }else{
                        console.log("error of file not found in path")
                        if (errorCall) {
                            errorCall(url,"file not found in path")
                        }
                    }
                   
                     
                }
                
            }else{
                console.log("no success call")
            }

        }
        if(cookiesFilePath){
            //check file exist
            if (fs.existsSync(cookiesFilePath)) {
            fs.unlinkSync(cookiesFilePath)
            }
        }

    }
    //download playlist
    async downloadPlaylist(url: string, savePath: string, useBrowserCookies?:string,cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, videoQuality?:number,ignoreLink?:Array<string>,errorCall?: (link:string,errorMsg: string) => void, stroutCall?: (message: string) => void, successCall?: (param:VideodoanloadSuccessCall) => void,endCall?:(error:string)=>void) {
        const urls=await this.getPlaylist(url)
        let error=""
        console.log("ignore urls")
        console.log(ignoreLink)
        if(urls){
            for(const urlitem of urls){
                console.log("current catch url "+removeParamsAfterAmpersand(urlitem))
                if(ignoreLink){
                    if(ignoreLink.includes(removeParamsAfterAmpersand(urlitem))){
                        continue
                    }
                }
                //random stop for some time
                const randomStop=Math.floor(Math.random() * 10000);
                await new Promise(resolve => setTimeout(resolve, randomStop));
                
                await this.downloadVideo(urlitem,savePath,useBrowserCookies,cookiesProxy,proxy,execPath,videoQuality,errorCall,stroutCall,successCall).catch((err)=>{
                    if(err instanceof Error){
                        error=err.message
                        if(errorCall){
                            errorCall(urlitem,error)
                        }

                    }
                })

            }
        }else{
            error="playlist not found"
        }
        if(endCall){
            endCall(error)
        }
    }
    //get video title and description
    async getVideodesc(command:string,url:string):Promise<YoutubedlStrout|undefined>{
        const finalcommand=command+' --dump-single-json "'+url+'"'
        const { stdout, stderr } = await execAsync(finalcommand);
        if (stderr) {
            throw new CustomError(stderr)
        }
        return JSON.parse(stdout) as YoutubedlStrout
    }
    //get playlist video link
    async getPlaylist(url:string):Promise<Array<string>|null>{
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        try{
        // Use browserManager to create launch options
        const launchOptions = await browserManager.createLaunchOptions({
            headless: true,
        });
        const browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.goto(url, { timeout: 90000, waitUntil: 'networkidle2' });
        await page.setViewport({width: 1080, height: 1024});
        const resultUrls:Array<string>=[];
        if(url.includes(this.playerlisttype)){
            const targetElement = await page.$('#continuations')
            if (targetElement) {
                await targetElement.scrollIntoView();  
            }
            const videoUrls = await page.$$eval('a#video-title', elements =>
                elements.map(el => el.href)
            );
            //console.log(videoUrls)
            //resultUrls.push(...videoUrls)
            if(videoUrls){
                for(let videoUrl of videoUrls){
                    if(videoUrl){
                        if(!videoUrl.includes("https://www.youtube.com")){
                            videoUrl='https://www.youtube.com'+videoUrl
                        }
                        resultUrls.push(videoUrl)
                    }
                }
            }
        }else{//get video link in single player
           const texttofind="From the series"
           const elementHandle = await page.evaluateHandle((texttofind) => {
            const elements = Array.from(document.querySelectorAll('*'));
            return elements.find(element => element.textContent?.includes(texttofind));
        }, texttofind);
        if (elementHandle) {
            // console.log('Element found:', await elementHandle.evaluate((node: Element) => node.outerHTML));
            // console.log('Element found:', await elementHandle.evaluate(node => node.outerHTML));
            // Perform any action on the element, e.g., click
            // const element = elementHandle as ElementHandle<Element>;
            // await element.click();
            await (elementHandle.asElement() as ElementHandle<Element>)?.click();
            await delay(5000);
        } else {
            console.log('Element not found');
        }
        console.log("click element end") 
        //const htmlContent = await page.content();
        //fs.writeFileSync('/Users/cengjianze/project/social-marketing/.vite/build/page.html', htmlContent);
            //console.log("signal video")
            let videoUrls = await page.$$eval('#contents ytd-compact-video-renderer', elements => {
                console.log("get element")
                return elements.map(el => {
                    //console.log(el)
                    return el.querySelector('#thumbnail')?.getAttribute('href')
                });
            });
            if(videoUrls.length<1){
                console.log("try another way")
                //try another way
               videoUrls = await page.$$eval('#items ytd-compact-video-renderer', elements => {
                    console.log("get element")
                    return elements.map(el => {
                        //console.log(el)
                        return el.querySelector('#thumbnail')?.getAttribute('href')
                    });
                });
            }
            console.log("get final video urls")
            console.log(videoUrls)
            if(videoUrls){
                for(let videoUrl of videoUrls){
                    if(videoUrl){
                        if(!videoUrl.includes("https://www.youtube.com")){
                            videoUrl='https://www.youtube.com'+videoUrl
                        }
                        resultUrls.push(videoUrl)
                    }
                }
            }
        }
        await closePuppeteer(page, browser);
        return resultUrls
    } catch (error) {
        if(error instanceof Error){
        console.error('An error occurred:', error.message);
        }
        throw error
    }
    }
    //add function download video by keywords
    async downloadVideoByKeyword(keyword: Array<string>, savePath: string,maxPageNumber:number, useBrowserCookies?: string, cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, videoQuality?: number,  errorCall?: (link: string, errorMsg: string) => void, stroutCall?: (message: string) => void, successCall?: (param: VideodoanloadSuccessCall) => void) {
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        //const keywordString = keyword.join(', ');
        try {
          // Use browserManager to create launch options with proxy support
          const customArgs = proxy ? [
            `--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`
          ] : [];
          
          const launchOptions = await browserManager.createLaunchOptions({
            headless: true,
            args: customArgs
          });
          
          const browser = await puppeteer.launch(launchOptions);
          
          // Set up authentication for proxy if needed
          if (proxy && proxy.username && proxy.password) {
            const page = await browser.newPage();
            await page.authenticate({
              username: proxy.username,
              password: proxy.password
            });
          }
          
          const page = await browser.newPage();
          
          // Set a reasonable viewport
          await page.setViewport({ width: 1280, height: 800 });
          
          // Navigate to YouTube
          await page.goto('https://www.youtube.com', { 
            waitUntil: 'networkidle2',
            timeout: 60000
          });
          
          // Log progress if stroutCall is provided
          if (stroutCall) stroutCall(`Searching YouTube for: ${keyword}`);
          let finalVideourls:Array<string>=[]
          // Wait for and click the accept cookies button if it appears
          try {
            try{
            const acceptButton = await page.waitForSelector('button[aria-label="Accept all"]', { timeout: 5000 });
            if (acceptButton) await acceptButton.click();
            await delay(1000);
            }
            catch(e){
                console.log("accept button not found")
            }
          

         
          
          // Find and click the search box
        //   await page.waitForSelector('input#search');
        //   await page.click('input#search');
          
        //   if(stroutCall){
        //     stroutCall("final video urls")
        //   }
          //loop keyword and search
          //for(let i=0;i<keyword.length;i++){
          for (const keyworditem of keyword) {
          //console.log("current keyword "+keyworditem)   
            let pageNumber=0  
          // Type the search keyword
          //await page.keyboard.type(keyword[i]);
          //await page.keyboard.press('Enter');

          const input = await page.$('input[name="search_query"]');
          console.log(input)
          if (input) {
            await page.click('input[name="search_query"]');
              await page.type('input[name="search_query"]', keyworditem);
              // await this.page.waitForTimeout(50);
              await page.evaluate(async () => {
                  await new Promise(function (resolve) {
                      setTimeout(resolve, 1000)
                  });
              });
              await input.focus();
              await page.keyboard.press("Enter");
          } else {
            //close page
            // await page.close();
            // //close browser
            // await browser.close();
              throw new CustomError("input keyword button not found", 202405301120303)
          }
         
          // Wait for search results to load
          await page.waitForSelector('ytd-video-renderer, ytd-grid-video-renderer', { timeout: 10000 });
          
          // Additional wait to ensure all results load
          await delay(2000);
            //load more page
        console.log("load more page")
        await scrollPageToBottom(page, maxPageNumber)
        // while(pageNumber<maxPageNumber){
            console.log("current page number "+pageNumber)
          // Extract video URLs from search results
          const videoUrls = await page.$$eval('a#video-title, a#thumbnail', (elements) => {
            return elements
              .filter(el => el.href && el.href.includes('/watch?v='))
              .map(el => el.href)
              .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates      
          });
          //loop video url push to finalVideourls
            if(videoUrls){
                for (const videoUrl of videoUrls) {
                    if (videoUrl && !finalVideourls.includes(videoUrl)) {
                        finalVideourls.push(videoUrl);
                    }
                }
            }
           
                // Scroll down to load more videos
                //await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            //     const targetElement = await page.$('#spinnerContainer')
            // if (targetElement) {
            //     await targetElement.scrollIntoView();
            //     targetElement.click();
            //     await delay(2000);
            //     //return true
            // }
            console.log("scroll page to bottom")
            // 
                 // Wait for new videos to load
                // pageNumber++
                // Extract video URLs from search results
                // const videoUrls = await page.$$eval('a#video-title, a#thumbnail', (elements) => {
                //     return elements
                //       .filter(el => el.href && el.href.includes('/watch?v='))
                //       .map(el => el.href)
                //       .filter((url, index, self) => self.indexOf(url) === index); // Remove duplicates      
                //   });
                //   //loop video url push to finalVideourls
                //     if(videoUrls){
                //         for (const videoUrl of videoUrls) {
                //             if (videoUrl && !finalVideourls.includes(videoUrl)) {
                //                 finalVideourls.push(videoUrl);
                //             }
                //         }
                //     }
            // }
        } 
    } catch (e) {
        await closePuppeteer(page,browser)
        throw e
        // No cookies dialog or it has a different selector, we can continue
      } 
          // Close the browser
        // Check if page and browser variables are defined before closing them
        try {
            // Check if browser and page are still available
            if (page && !page.isClosed()) {
                await page.close().catch(e => console.error('Error closing page:', e.message));
            }
            
            if (browser && browser.connected) {
                await browser.close().catch(e => console.error('Error closing browser:', e.message));
            }
        } catch (error) {
            console.error('Error during browser cleanup:', error instanceof Error ? error.message : 'Unknown error');
        }
        //   await browser.close();
        // Remove duplicate URLs from finalVideourls
        finalVideourls = Array.from(new Set(finalVideourls));
          if (finalVideourls && finalVideourls.length > 0) {
            if (stroutCall) stroutCall(`Found ${finalVideourls.length} videos for keyword: ${keyword}`);
            
            // Download each video
            for (const url of finalVideourls) {
              if (stroutCall) stroutCall(`Downloading video: ${url}`);
              
              await this.downloadVideo(
                url, 
                savePath,
                useBrowserCookies,
                cookiesProxy,
                proxy,
                execPath,
                videoQuality,
                errorCall,
                stroutCall,
                successCall
              ).catch(error => {
                if (errorCall) errorCall(url, error.message || 'Unknown error');
              });
              
              // Add delay between downloads to avoid rate limiting
              await delay(3000 + Math.floor(Math.random() * 2000));
            }
            
            return finalVideourls;
          } else {
            const errorMessage = `No videos found for keyword: ${keyword}`;
            
            if (errorCall) errorCall("", errorMessage);
            if (errorCall) errorCall("", errorMessage);
            throw new CustomError(errorMessage);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          if (errorCall) errorCall("", errorMessage);
          throw new CustomError(errorMessage);
        }
      }

}