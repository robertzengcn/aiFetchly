import { Video } from '@/modules/interface/Video';
import {ExtraModuleController} from '@/controller/extramoduleController'
import {CustomError} from '@/modules/customError'
import * as path from 'path';
export class youtubeVideo implements Video {
    private moduleName="youtube-dl"
    private extraModule:ExtraModuleController
    constructor() {
        this.extraModule=new ExtraModuleController()
    }
    /**
     * @throws {CustomError} if chek failed
     * @returns boolean
     */
    public async checkRequirement():Promise<boolean>{

        const dPackage=this.extraModule.getPackageByName(this.moduleName)
        if(!dPackage){
            throw new CustomError("download youtube video package not defined",20241212141914)
        }
        if(dPackage.requirePy){
            //check python installed or not
            const res=this.extraModule.checkPython()
            if(!res){
                throw new CustomError("download youtube video must install python",2024120511189)
            }
        }
        if(dPackage.requireFfmpeg){
            //check ffmpeg installed or not
            const ffmpegRes = this.extraModule.checkFfmpeg();
            if (!ffmpegRes) {
                throw new CustomError("download youtube video must install ffmpeg", 2024121518110);
            }
        }
        // const extraModule=new ExtraModuleController()
        const res=await this.extraModule.checkModule(dPackage.packagename)

        if(!res){
            throw new CustomError("download youtube video must install youtube-dl plugin",2024120511189)
        }
        return true
    }
    public getPackagepath():string{
        const exPackage=this.extraModule.getPackageByName(this.moduleName)
        if(!exPackage){
            throw new CustomError("download youtube video package not defined",20241220152939)
        }
        return path.join(this.extraModule.getModulePath(),exPackage.packagename)
      }
  
}