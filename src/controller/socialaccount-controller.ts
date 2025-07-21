import { SocialAccount } from "@/modules/socialaccount";
import { BrowserWindow, session } from 'electron'
import { AccountCookiesEntity } from "@/entity/AccountCookies.entity";
import { AccountCookiesModule } from "@/modules/accountCookiesModule"
//import { ProxyController } from "./proxy-controller";
import { ProxyParseItem } from "@/entityTypes/proxyType";
// import {showNotification} from "@/modules/lib/function"
//import { Token } from "@/modules/token"
//import {USERSDBPATH} from '@/config/usersetting';
//import {CustomError} from '@/modules/customError'
import { proxyEntityToUrl } from "@/modules/lib/function"
//import { is } from "cheerio/lib/api/traversing";
import { convertNetscapeCookiesToJson } from "@/modules/lib/function"
import { CookiesType, CookiesParse } from "@/entityTypes/cookiesType"
//import { SocialAccountDetailData } from "@/entityTypes/socialaccount-type"

export class SocialAccountController {
    private accountCookiesModule: AccountCookiesModule
    private socialaccountModel: SocialAccount
    constructor() {
        this.accountCookiesModule = new AccountCookiesModule()
        this.socialaccountModel = new SocialAccount()
    }
    //open open and login social account
    public async showSocialaccountMsg(id: number, platform: string, gmsgCallback?: () => void, omsgCallback?: () => void,closeFun?:()=>void): Promise<void> {
        //get account cookies
        // const accoutndb = new AccountCookiesdb(dbpath)
        const cookies = await this.accountCookiesModule.getAccountCookies(id)
        //let partition_path = "persist:path/" + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
        // let partition_path =this.accountCookiesModule.genPartitionPath()

        // if (cookies) {
        //     if (cookies.partition_path) {
        //         partition_path = cookies.partition_path
        //     }
        // }
        // const ses = session.fromPartition(partition_path)
        // console.log(accinfo.data.social_type)
        //console.log(accinfo.data.social_type)
        if (!cookies || !cookies.cookies) {
            if ((platform == "google.com" || platform == "youtube")) {
                // console.log(accinfo.data)
                // console.log(cookies)
                // if(!cookies||!cookies.cookies){//open a new window to ask user choose file
                // const options:MessageBoxOptions = {
                //     type: 'info',
                //     buttons: ['OK'],
                //     defaultId: 0,
                //     title: 'Information',
                //     message: 'Please choose cookies file',
                //     detail: 'Please choose cookies file',
                //   };
                // //   try {
                //   await dialog.showMessageBox(options) 
                if (gmsgCallback) {
                    gmsgCallback()
                }
                // } catch (error) {
                //     if(error instanceof Error){
                //     console.error(`Failed to show message box: ${error.message}`);
                //     }
                //   }
                return
                // }
            } else {//other platform, but no cookies exists
                if (omsgCallback) {
                    omsgCallback()
                }
            }
        } else {
            await this.showSocialmediaWin(id,cookies,closeFun)
        }

    }
    //open a pop window to show social media, allow user to login
    public async showSocialmediaWin(id: number,cookies?:AccountCookiesEntity,closeFun?:()=>void) {
        //get account information
        const accinfo = await this.socialaccountModel.getAccountdetail(id)
        if (!accinfo || !accinfo.data.id) {
            throw new Error("get account info failed")
        }
        if (!accinfo.status) {
            throw new Error(accinfo.msg)
        }
        // const cookies = this.accountCookiesModule.getAccountCookies(accinfo.data.id)
        //let partition_path = "persist:path/" + Date.now() + '-' + Math.random().toString(36).slice(2, 9)
        let partition_path = this.accountCookiesModule.genPartitionPath()

        if (!cookies) {
        //     if (cookies.partition_path) {
        //         partition_path = cookies.partition_path
        //     }
        // }else{
            const cookiesres = await this.accountCookiesModule.getAccountCookies(id)
            if(cookiesres){
                cookies = cookiesres
            }
        }
        const ses = session.fromPartition(partition_path)
        //set title for window
        let winTitle = ""
        if (accinfo.data.social_type) {
            winTitle = accinfo.data.social_type
        }
        if (accinfo.data.proxy) {
            const randomProxy = accinfo.data.proxy[Math.floor(Math.random() * accinfo.data.proxy.length)];

            if (randomProxy.host && randomProxy.port) {
                winTitle += " Use proxy host:" + randomProxy.host + " port:" + randomProxy.port
                // const proxyCon = new ProxyController()
                const proxyitem: ProxyParseItem = {
                    host: randomProxy.host,
                    port: randomProxy.port,
                    user: randomProxy.username,
                    pass: randomProxy.password,
                    protocol: randomProxy.protocol
                }
                const proxyUrl = proxyEntityToUrl(proxyitem)
                // console.log(randomProxy.url)
                //convert proxy to string
                ses.setProxy({ proxyRules: proxyUrl }).then(() => {
                    console.log('set proxy success, use proxy host:' + randomProxy.host + " port:" + randomProxy.port)
                }).catch((error) => {
                    console.log('set proxy failed, error:' + error)
                })
            }
        }
        //handle cookies
        if (cookies && cookies.cookies) {
            // console.log("handle cookies file")
            // console.log(cookies)
            const cookiesArr: CookiesType[] = JSON.parse(cookies.cookies)
            if (cookiesArr.length > 0) {
                for (const cookie of cookiesArr) {
                    // console.log(cookie)
                    //remove first dot in domain
                    let url = cookie.domain
                    if (cookie.domain && cookie.domain.charAt(0) === '.') {
                        url = cookie.domain.slice(1);
                    }
                    let cookieDetails: CookiesParse = {
                        url: `http${cookie.secure ? 's' : ''}://${url}${cookie.path}`,
                        name: cookie.name,
                        value: cookie.value,
                        domain: cookie.domain,
                        path: cookie.path,
                        secure: cookie.secure,
                        httpOnly: cookie.httpOnly || false,
                        expirationDate: cookie.expirationDate,
                        sameSite: cookie.sameSite === 'None' ? 'no_restriction' : cookie.sameSite,
                        hostOnly: cookie.hostOnly
                    };
                    //check whether cookies value start with __Host-
                    if (cookie.name.startsWith("__Host-")) {
                        //remove cookie detail domain
                        if (cookieDetails.domain) {
                            delete cookieDetails.domain;
                        }
                    }
                    if(cookie.name.startsWith("__Secure-")){
                        cookieDetails.httpOnly=true
                        // delete cookieDetails.domain;
         
                    }
                    try {
                        console.log(cookieDetails)
                        await ses.cookies.set(cookieDetails)
                    } catch (error) {
                        console.error(`Failed to set cookie: ${cookie.name}`, error);
                        console.log(cookieDetails)
                        throw error
                    }
                }
            }
        }
        const win = new BrowserWindow({
            autoHideMenuBar: true, webPreferences: {
                session: ses
            }
        })
        win.setTitle(winTitle)
        win.setMenu(null)
        // showNotification("test title","test message")
        console.log(accinfo.data.social_type_url)
        if (accinfo.data.social_type_url) {
            await win.loadURL(accinfo.data.social_type_url).catch((error) => {
                const ignoreMsg=["Message 0 rejected by interface blink.mojom.WidgetHost","ERR_FAILED (-2)"]
                
                if (!ignoreMsg.some(msg => error.message.includes(msg))) {
                console.log('load url failed, error:' + error.message)
                console.error(error)
                // showNotification("error","load url failed, error:" + error.message)
                win.close()
                throw new Error('load url failed, error:' + error.message)
                }else{
                    console.log('Ignored error:', error.message)
                }
            })
            // win.loadURL('https://ident.me/ip')
        }else{
            throw new Error("social type url not exist")
        }
        win.once('ready-to-show', async () => {
            win.show()
            // const options:MessageBoxOptions = {
            //     type: 'info',
            //     buttons: ['OK'],
            //     defaultId: 0,
            //     title: 'Information',
            //     message: 'This is an information message box',
            //     detail: 'Additional details can be shown here.',
            //   };
            //   await dialog.showMessageBox(win,options) 
            // win.webContents.executeJavaScript('alert("Hello, world!")');
        })
        
        // winsession.cookies.remove()
        win.on('close', async () => { //   <---- Catch close event
            if(win&&win.webContents&&win.webContents.session){
            const winsession = win.webContents.session
            const cookiescontent = await winsession.cookies.get({url: accinfo.data.social_type_url})
            console.log("get cookies:")
            console.log(cookiescontent)
            const cookiesstr = JSON.stringify(cookiescontent)
            if (accinfo.data.id) {
                // const ace: AccountCookiesEntity = {
                //     account_id: accinfo.data.id,
                //     cookies: cookiesstr,
                //     partition_path: partition_path
                // }
                const ace = new AccountCookiesEntity()
                ace.account_id = accinfo.data.id
                ace.cookies = cookiesstr
                ace.partition_path = partition_path
                // const tokenService=new Token()
                // const dbpath=await tokenService.getValue(USERSDBPATH)
                // if(!dbpath){
                //     throw new CustomError("user path not exist",202407171402105)
                // }
                // const acdb = new AccountCookiesdb(dbpath)
                this.accountCookiesModule.saveAccountCookies(ace)
                if(closeFun){
                closeFun()
                }
            }
        }
        });

     
    }
    public async handleCookiesfile(filePath: string, accountId: number): Promise<number> {
        const cookiesArr = convertNetscapeCookiesToJson(filePath)
        const partition_path = this.accountCookiesModule.genPartitionPath()
        const cookiesstr = JSON.stringify(cookiesArr)
        // const accountCookiesEntity: AccountCookiesEntity = {
        //     account_id: accountId,
        //     cookies: cookiesstr,
        //     partition_path: partition_path,
        // }
        const accountCookiesEntity = new AccountCookiesEntity()
        accountCookiesEntity.account_id = accountId
        accountCookiesEntity.cookies = cookiesstr
        accountCookiesEntity.partition_path = partition_path
        return await this.accountCookiesModule.saveAccountCookies(accountCookiesEntity)
    }

    public cleanCookies(accountId: number): void {

        this.accountCookiesModule.deleteCookies(accountId)
    }

}