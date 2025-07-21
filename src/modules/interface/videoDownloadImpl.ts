import {CookiesProxy} from "@/entityTypes/videoType"
import {Proxy} from "@/entityTypes/proxyType"
import {VideodoanloadSuccessCall} from "@/entityTypes/videoType"
export interface VideoDownloadImpl{

    downloadVideo(url: string, savePath: string, useBrowserCookies?:string,cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, videoQuality?:number,errorCall?: (link:string,errorMsg: string) => void, stroutCall?:(message: string) => void, successCall?: (param:VideodoanloadSuccessCall) => void)

    downloadPlaylist(url: string, savePath: string, useBrowserCookies?:string,cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, videoQuality?:number,ignoreLink?:Array<string>,errorCall?: (link:string,errorMsg: string) => void, stroutCall?: (message: string) => void, successCall?: (param:VideodoanloadSuccessCall) => void,endCall?:(error:string)=>void)
    //add function download video by keywords
    downloadVideoByKeyword(keyword: Array<string>, savePath: string, maxPagenumber:number,useBrowserCookies?: string, cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, videoQuality?: number,  errorCall?: (link: string, errorMsg: string) => void, stroutCall?: (message: string) => void, successCall?: (param: VideodoanloadSuccessCall) => void)
}