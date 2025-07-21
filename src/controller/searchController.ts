// import { Usersearchdata } from '@/entityTypes/scrapeType';
//import { SMstruct, SearchDataParam,SearchResEntity } from "@/entityTypes/scrapeType"
// import { ScrapeManager } from "@/modules/scrapeManager"
// import {SearhEnginer} from "@/config/searchSetting"
// import { ToArray } from "@/modules/lib/function"
import {Usersearchdata,SearchtaskEntityNum } from "@/entityTypes/searchControlType"
// import {SearchTaskdb} from "@/model/searchTaskdb"
// import {SearchKeyworddb} from "@/model/searchKeyworddb"
// import {SearchResultdb} from "@/model/searchResultdb"
//import { utilityProcess, MessageChannelMain} from "electron";
import * as path from 'path';
import * as fs from 'fs';
import {SearchModule} from "@/modules/searchModule"
import { Token } from "@/modules/token"
// import {USERSDBPATH} from '@/config/usersetting';
import {SearchDataParam,SearchResEntityDisplay,SearchResEntityRecord} from "@/entityTypes/scrapeType"
// import {SEARCHEVENT} from "@/config/channellist"
// import { SearchTaskStatus } from "@/model/SearchTask.model"
// import { SearchKeyworddb } from "@/model/searchKeyworddb";
//import { CustomError } from "@/modules/customError";
import {USERLOGPATH,USEREMAIL} from '@/config/usersetting';
import {getApplogspath,getRandomValues} from "@/modules/lib/function"
import { v4 as uuidv4 } from 'uuid';
import {SortBy} from "@/entityTypes/commonType";
import { SystemSettingGroupModule } from '@/modules/SystemSettingGroupModule';
// import {twocaptchagroup,twocaptchatoken,twocaptcha_enabled,chrome_path,firefox_path,external_system} from '@/config/settinggroupInit'
// import { AccountCookiesModule } from "@/modules/accountCookiesModule"
// import {CookiesType} from "@/entityTypes/cookiesType"
export class SearchController {
    private searchModel:SearchModule;
    // private accountCookiesModule: AccountCookiesModule;
   //private systemSettingGroupModule: SystemSettingGroupModule
    constructor() {
        // this.accountCookiesModule=new AccountCookiesModule()
        this.searchModel=new SearchModule()
        //this.systemSettingGroupModule=new SystemSettingGroupModule()
    }
    
    public async searchData(data: Usersearchdata) {
        //search data

       
        const dp:SearchDataParam={
            engine:data.searchEnginer,
            keywords:data.keywords,
            num_pages:data.num_pages,
            concurrency:data.concurrency,
            notShowBrowser:data.notShowBrowser,
            proxys:data.proxys,
            //useLocalbrowserdata:data.useLocalbrowserdata,
            localBrowser:data.localBrowser,
            accounts:data.accounts
        }
        //console.log("search datat dp")
        //console.log(dp)
        // const taskId=await this.searhModel.saveSearchtask(dp)

        const taskId=await this.createTask(dp)
        await this.searchModel.runSearchTask(taskId)
        // const jsonData=JSON.stringify(data);
        //console.log(jsonData)
    //    const childPath = path.join(__dirname, 'taskCode.js')
    //     if (!fs.existsSync(childPath)) {
    //         throw new Error("child js path not exist for the path " + childPath);
    //     }
    //     const { port1, port2 } = new MessageChannelMain()
    //     const tokenService=new Token()
        
    //     const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["puppeteer-cluster:*"],env:{
    //         ...process.env,
    //         NODE_OPTIONS: ""  
    //     }} )
    //     // console.log(path.join(__dirname, 'utilityCode.js'))
    //     let logpath=tokenService.getValue(USERLOGPATH)
    //     if(!logpath){
    //         const useremail=tokenService.getValue(USEREMAIL)
    //         //create log path
    //         logpath=getApplogspath(useremail)
    //     }
    //     // console.log(logpath)
    //     const uuid=uuidv4({random: getRandomValues(new Uint8Array(16))})
    //     const errorLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.error.log')
    //     const runLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.runtime.log')
    //    // console.log(errorLogfile)
    //     // console.log(data)
    //     // child.postMessage({ message: 'hello' }, [port1])
    //     child.on("spawn", () => {
    //         console.log("child process satart, pid is"+child.pid)
    //         child.postMessage(JSON.stringify({action:"searchscraper",data:data}),[port1])
    //         this.searhModel.updateTaskLog(taskId,runLogfile,errorLogfile)
    //     })
        
    //     child.stdout?.on('data', (data) => {
    //         console.log(`Received data chunk ${data}`)
    //         WriteLog(runLogfile,data)
    //        // child.kill()
    //     })
    //     child.stderr?.on('data', (data) => {
    //         const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect","Most NODE_OPTIONs are not supported in packaged apps"]
    //         if(!ingoreStr.some((value)=>data.includes(value))){
                    
    //         // seModel.saveTaskerrorlog(taskId,data)
    //         console.log(`Received error chunk ${data}`)
    //         WriteLog(errorLogfile,data)
    //         this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Error)
    //         //child.kill()
    //         }
            
    //     })
    //     child.on("exit", (code) => {
    //         if (code !== 0) {
    //             console.error(`Child process exited with code ${code}`);
                
    //         } else {
    //             console.log('Child process exited successfully');
    //         }
    //     })
    //     child.on('message', (message) => {
    //         console.log("get message from child")
    //         console.log('Message from child:', JSON.parse(message));
    //         const childdata=JSON.parse(message)
    //         if(childdata.action=="saveres"){
    //             //save result
    //             this.searhModel.saveSearchResult(childdata.data,taskId)
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Complete)
    //             child.kill()
    //         }
    //     });
    }

    public async createTask(data:SearchDataParam):Promise<number>{
        const taskId=await this.searchModel.saveSearchtask(data)
        const tokenService=new Token()
        let logpath=tokenService.getValue(USERLOGPATH)
        if(!logpath){
            const useremail=tokenService.getValue(USEREMAIL)
            //create log path
            logpath=getApplogspath(useremail)
        }
        const uuid=uuidv4({random: getRandomValues(new Uint8Array(16))})
        const errorLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.error.log')
        const runLogfile=path.join(logpath,'search_'+taskId.toString()+'_'+uuid+'.runtime.log')
        //create log file and runlog file
        fs.writeFileSync(errorLogfile,'')
        fs.writeFileSync(runLogfile,'')
        await this.searchModel.updateTaskLog(taskId,runLogfile,errorLogfile)
        return taskId
    }
    //run search function
    public async runSearchTask(taskId:number):Promise<void>{
        await this.searchModel.runSearchTask(taskId);
    //     //get error log and run log
    //     const taskEntity=await this.searhModel.getTaskEntityById(taskId)
    //     if(!taskEntity){
    //         throw new Error("task not exist")
    //     }
    //     const errorLogfile=taskEntity.error_log
    //     if(!errorLogfile){
    //         throw new Error("error log not exist")
    //     }
    //     const runLogfile=taskEntity.run_log
    //     if(!runLogfile){
    //         throw new Error("run log not exist")
    //     }
    //     // Get parent path of errorLogfile
    //     const errorLogDir = path.dirname(errorLogfile);
        
    //     // Ensure the directory exists
    //     if (!fs.existsSync(errorLogDir)) {
    //         fs.mkdirSync(errorLogDir, { recursive: true });
    //     }
    //     //const cookiesArray:Array<Array<CookiesType>>=[]
    //     // if(taskEntity.accounts){
    //     //     for (const account of taskEntity.accounts) {
    //     //         const cookies = await this.accountCookiesModule.getAccountCookies(account)
    //     //         if(cookies){
    //     //             const cookiesits:Array<CookiesType>=JSON.parse(cookies.cookies)
    //     //             cookiesArray.push(cookiesits)
    //     //             }
    //     //     }
    //     // }  
    // // const cookies = await this.accountCookiesModule.getAccountCookies(taskEntity.accounts)
    // // //    if(!cookies){
    // //     throw new Error("account cookies not found")
    // //    }
       
    //     const data:Usersearchdata={
    //         searchEnginer:taskEntity.engine,
    //         keywords:taskEntity.keywords,
    //         num_pages:taskEntity.num_pages??1,
    //         concurrency:taskEntity.concurrency??1,
    //         notShowBrowser:taskEntity.notShowBrowser??false,
    //         proxys:taskEntity.proxys,
    //         debug_log_path:errorLogDir,
    //         //useLocalbrowserdata:taskEntity.useLocalbrowserdata?true:false,
    //         localBrowser:taskEntity.localBrowser?taskEntity.localBrowser:"",
    //         cookies:taskEntity.cookies
    //     }

    //     const childPath = path.join(__dirname, 'taskCode.js')
    //     if (!fs.existsSync(childPath)) {
    //         throw new Error("child js path not exist for the path " + childPath);
    //     }
    //     const { port1, port2 } = new MessageChannelMain()
    //    // const tokenService=new Token()
    //    let twoCaptchaTokenvalue=""
    //    const twoCaptchaToken=await this.systemSettingGroupModule.getGroupItembyName(twocaptchagroup)
    //    if(twoCaptchaToken){
    //     //find 2captcha enable key
    //     const twocaptchenable=twoCaptchaToken.settings.find((item)=>item.key===twocaptcha_enabled)
    //     if(twocaptchenable){
    //     const token=twoCaptchaToken.settings.find((item)=>item.key===twocaptchatoken)
    //     if(token){
    //         twoCaptchaTokenvalue=token.value
    //     }
    //    }
    // }
    // let localBrowserexcutepath:string=""
    // if(data.localBrowser&&data.localBrowser.length>0){
    //     const external_system_group=await this.systemSettingGroupModule.getGroupItembyName(external_system)
    //     if(external_system_group){
    //         const chromePath=external_system_group.settings.find((item)=>item.key===chrome_path)
    //         if(chromePath){
    //             localBrowserexcutepath=chromePath.value
    //         }
    //         const firefoxPath=external_system_group.settings.find((item)=>item.key===firefox_path)
    //         if(firefoxPath){
    //             localBrowserexcutepath=firefoxPath.value
    //         }
    //     }
    //     if(data.localBrowser=="chrome"&&!localBrowserexcutepath){
            
    //         const localBrowserexcutepathresult=getChromeExcutepath()
    //         if(localBrowserexcutepathresult){
    //             localBrowserexcutepath=localBrowserexcutepathresult
    //         }

    //     }else if(data.localBrowser=="firefox"&&!localBrowserexcutepath){
    //         const localBrowserexcutepathresult=getFirefoxExcutepath()
    //         if(localBrowserexcutepathresult){
    //             localBrowserexcutepath=localBrowserexcutepathresult
    //         }
    //     }
    //     if(!localBrowserexcutepath){
    //         throw new Error("local browser excute path not exist")
    //     }
    // }
    // //let userDataDir=""
    // // if(data.useLocalbrowserdata){
    // //     userDataDir=getChromeUserDataDir()
    // //     if(!userDataDir){
    // //         throw new Error("user data dir not exist")
    // //     }
    // // }
    //    //console.log("two captcha token value is "+twoCaptchaTokenvalue)
    //    //console.log("local browser excute path is "+localBrowserexcutepath)
    //    //console.log("user data dir is "+userDataDir)
    //     const child = utilityProcess.fork(childPath, [],{stdio:"pipe",execArgv:["puppeteer-cluster:*"],env:{
    //         ...process.env,
    //         NODE_OPTIONS: "",
    //         TWOCAPTCHA_TOKEN: twoCaptchaTokenvalue,
    //         LOCAL_BROWSER_EXCUTE_PATH: localBrowserexcutepath,
    //         //USEDATADIR: userDataDir
    //     }} )
    //     child.on("spawn", () => {
    //         console.log("child process satart, pid is"+child.pid)
    //         this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Processing)
    //         child.postMessage(JSON.stringify({action:"searchscraper",data:data}),[port1])
    //        // this.searhModel.updateTaskLog(taskId,runLogfile,errorLogfile)
    //     })
        
    //     child.stdout?.on('data', (data) => {
    //         console.log(`Received data chunk ${data}`)
    //         WriteLog(runLogfile,data)
    //        // child.kill()
    //     })
    //     child.stderr?.on('data', (data) => {
    //         const ingoreStr=["Debugger attached","Waiting for the debugger to disconnect","Most NODE_OPTIONs are not supported in packaged apps"]
    //         if(!ingoreStr.some((value)=>data.includes(value))){
                    
    //         // seModel.saveTaskerrorlog(taskId,data)
    //         console.log(`Received error chunk ${data}`)
    //         WriteLog(errorLogfile,data)
    //         this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Error)
    //         //child.kill()
    //         }
            
    //     })
    //     child.on("exit", (code) => {
    //         if (code !== 0) {
    //             console.error(`Child process exited with code ${code}`);
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Error)
    //         } else {
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Complete)
    //             console.log('Child process exited successfully');
    //         }
    //     })
    //     child.on('message', (message) => {
    //         console.log("get message from child")
    //         console.log('Message from child:', JSON.parse(message));
    //         const childdata=JSON.parse(message)
    //         if(childdata.action=="savesearchresult"){
    //             //save result
    //             this.searhModel.saveSearchResult(childdata.data,taskId)
    //             this.searhModel.updateTaskStatus(taskId,SearchTaskStatus.Complete)
    //             child.kill()
    //         }
    //     });
    }
    //return search result
    public async listSearchresult(page:number,size:number,sortBy?:SortBy):Promise<SearchtaskEntityNum>{
        // const seModel=new searhModel()
        // await seModel.init();
        const res=await this.searchModel.listSearchtask(page,size, sortBy)
        return res;
    }   
    //list task search result
    public async listtaskSearchResult(taskId:number,page:number,size:number):Promise<SearchResEntityRecord>{
        // const seModel=new searhModel()
        const res=await this.searchModel.listSearchResult(taskId,page,size)

        const datas: Array<SearchResEntityDisplay> = []
        //const SearchKeyDb=new SearchKeyworddb(this.dbpath)

        res.forEach(async (item) => {
            //console.log(item)
            //console.log(item.keyword_id)
            const keyEntity = await this.searchModel.getkeywrodsEntitybyId(item.keyword_id)
            //console.log(keyEntity)
            const data: SearchResEntityDisplay = {
                id: item.id,
                keyword_id: item.keyword_id,
                title: item.title,
                link: item.link,
                snippet: item.snippet,
                record_time: item.record_time,
                visible_link: item.visible_link,
                keyword: keyEntity?.keyword??""
            }
            datas.push(data)
        })
        //return datas

        const total=await this.searchModel.countSearchResult(taskId)
        const data:SearchResEntityRecord={
            total:total,
            record:datas
        }
        return data
    }
    public async getTaskErrorlog(taskId:number):Promise<string>{
        // const seModel=new searhModel()
        const log=await this.searchModel.getTaskErrorLog(taskId)
        return log
    }
    //retry task by task id
    public async retryTask(taskId:number):Promise<void>{
        const taskEntity=await this.searchModel.getTaskEntityById(taskId)
        if(!taskEntity){
            throw new Error("task not exist")
        }
        await this.runSearchTask(taskId)
    }


}