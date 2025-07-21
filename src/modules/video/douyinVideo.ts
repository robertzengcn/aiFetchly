import { Video } from '@/modules/interface/Video';
import { checkPipPackage } from "@/modules/lib/function"
import { exec } from 'child_process';
import { videoScraper, douyinAppYaml } from "@/entityTypes/videoType"
// import { writeYamlFile, randomFileName } from "@/modules/lib/function"
//import {ProxyController} from "@/controller/proxy-controller"
import { app } from 'electron';
import * as path from 'path'
import { ProxyParseItem } from "@/entityTypes/proxyType"
import { proxyEntityToUrl } from "@/modules/lib/function"


export class douyinVideo implements Video {
    private packagename = 'f2'
    private appfile: string
    private proxy: string
    private cookies: string
    constructor() {
        // const filename=randomFileName("douyin","yaml")
        // const yamlFile=path.join(path.dirname(app.getPath('userData')), filename)    
        // console.log(yamlFile)
        // //generate yaml file
        // const yamlobj:douyinAppYaml={
        //     douyin:{
        //         // cookie:videoScraper.cookies,
        //         naming:'{create}_{desc}',
        //         timeout: 10
        //     }         
        // }
        // //write to yaml file
        // writeYamlFile(yamlFile,yamlobj)
        // this.appfile=yamlFile
        // this.cookies=videoScraper.cookies
        // if(videoScraper.proxy&&videoScraper.proxy.host&&videoScraper.proxy.port){
        //    // const proxyCon=new ProxyController()
        //     const proxyitem: ProxyParseItem = {
        //         host: videoScraper.proxy.host,
        //         port: videoScraper.proxy.port,
        //         user: videoScraper.proxy.username,
        //         pass: videoScraper.proxy.password,
        //     }
        //     this.proxy=proxyEntityToUrl(proxyitem)
        //     //this.proxy=videoScraper.proxy.ip+":"+videoScraper.proxy.port
        // }

    }
    public getPackagepath(): string {
        return ""
    }
    public async checkRequirement(): Promise<boolean> {
        if (!this.checkPackageInstall()) {
            throw new Error("package not install")
        }
        return true
    }
    //download video
    public download(link: string, videopath: string, cookies: string, errorcall?: (errorMessage: string) => void, stdoutCall?: (stdout: string) => void, stderrCall?: (stderr: string) => void, finishCall?: () => void) {
        let command = "f2 dy -M one -u " + link + " -p " + videopath + " -c " + this.appfile + " -k" + this.cookies
        if (this.proxy) {
            command += " -P " + this.proxy
        }
        console.log(command)
        exec(command, (error: Error | null, stdout: string, stderr: string) => {
            if (finishCall) {
                finishCall()
            }
            if (error) {

                if (errorcall) {
                    errorcall(error.message);
                }
                return;
            }
            // console.log(`stdout: ${stdout}`);
            if (stdoutCall) {
                stdoutCall(stdout);
            }
            if (stderrCall) {
                stderrCall(stderr);
            }
            // console.error(`stderr: ${stderr}`);

        })
    }

    public checkPackageInstall(): boolean {
        return false
        //     const piplist = checkPipPackage()
        //     const res = piplist.includes(this.packagename)

        //     if (res) {
        //         return true
        //     } else {
        //         return false
        //     }
    }
}