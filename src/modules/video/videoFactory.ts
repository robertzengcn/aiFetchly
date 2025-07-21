// import {videoScraper} from "@/entityTypes/videoType"
import {douyinVideo} from "@/modules/video/douyinVideo"
// import {AccountCookiesdb} from "@/model/account_cookiesdb"
// import {CookiesType} from "@/entityTypes/cookiesType"
import {bilibiliVideo} from "@/modules/video/bilibiliVideo"
import {youtubeVideo} from "@/modules/video/youtubeVideo"
import { Video } from '@/modules/interface/Video';
// import { SocialAccount } from "@/modules/socialaccount"
// import { Token } from "@/modules/token"
// import {USERSDBPATH} from '@/config/usersetting';


export class videoFactory {
    // private dbpath:string
    // private accountCookiesModel:AccountCookiesdb
    constructor() {
        // const tokenService=new Token()
        // const dbpath=tokenService.getValue(USERSDBPATH)
        // if(!dbpath){
        //     throw new Error("user path not exist")
        // }
        // this.dbpath=dbpath;
        // this.accountCookiesModel=new AccountCookiesdb(this.dbpath)
    }
    public async getVideotool(sitename: string):Promise<Video|null> {
        //get account detail
        // const socialAccount=new SocialAccount();
        // const accountdetail=await socialAccount.getAccountdetail(accountId)
        // if(!accountdetail){
        //     throw new Error("account not found")
        // }
       
        //get account cookies
        // const cookiesEntity=this.accountCookiesModel.getAccountCookies(accountId)
        // if(!cookiesEntity.cookies){
        //     throw new Error("cookies not found for the account, you need login first")
        // }
        // //convert cookies string to cookies array[object]
        // const cookiesList=JSON.parse(cookiesEntity.cookies)
        // const cookies=cookiesList.map((item:CookiesType)=>{
        //     return item.name+"="+item.value
        // }).join(";")
        // const videoScraper:videoScraper={
        //     cookies:cookies
        // }
        // if(accountdetail.data.proxy&&(accountdetail.data.proxy.length>0)){
        //     //get random proxy from array
        //     const randomIndex=Math.floor(Math.random() * accountdetail.data.proxy.length)
        //     //if((accountdetail.data.proxy[randomIndex]!=undefined)&&accountdetail.data.proxy[randomIndex].id&&(accountdetail.data.proxy[randomIndex].id>0)){
        //     videoScraper.proxy=accountdetail.data.proxy[randomIndex]
        //     //}
        // }
        switch(sitename){
           
            case 'douyin':
                return new douyinVideo();
            case 'bilibili':
                return new bilibiliVideo();
            case 'youtube':
                return new youtubeVideo();
                              
        }
       return null;
        
    }

   
}