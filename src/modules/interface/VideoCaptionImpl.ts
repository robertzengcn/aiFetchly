import { extraFileEntity } from "@/entityTypes/videoType";
//the interface main for extracting caption from video
export interface VideoCaptionImpl{
    //extract caption from video
    extractCaption(param:extraFileEntity)
    // //extract caption from playlist
    // extractPlaylistCaption(url: string, savePath: string, useBrowserCookies?:string,cookiesProxy?: CookiesProxy | null, proxy?: Proxy | null, execPath?: string, ignoreLink?:Array<string>,errorCall?: (link:string,errorMsg: string) => void, stroutCall?: (message: string) => void, successCall?: (param:VideodoanloadSuccessCall) => void,endCall?:(error:string)=>void)

}