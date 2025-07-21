import { VideoCaptionImpl } from '@/modules/interface/VideoCaptionImpl';
import { Whisper } from '@/modules/videoCaption/Whisper';
import { ExtraModuleController } from '@/controller/extramoduleController'
import { CustomError } from '@/modules/customError'
export class VideoCaptionFactory {
    //private extraModule: ExtraModuleController
    constructor() {
        //this.extraModule = new ExtraModuleController()
    }
    getVideoCaptionTool(toolName?: string): VideoCaptionImpl {
        switch (toolName) {
            case 'whisper':
                return new Whisper();
            // Add more cases for other tools as needed
            default:

                return new Whisper();
        }
    }
    //check if the tool is available
    // public async checkRequirement(toolName = "openai-whisper"): Promise<boolean> {

    //     const dPackage = this.extraModule.getPackageByName(toolName)
    //     if (!dPackage) {
    //         throw new CustomError(toolName+" package not installed", 20250120152922)
    //     }
    //     if (dPackage.requirePy) {
    //         //check python installed or not
    //         const res = this.extraModule.checkPython()
    //         if (!res) {
    //             throw new CustomError("the caption tool must install python first", 20250120152928)
    //         }
    //     }
    //      // const extraModule=new ExtraModuleController()
    //     const res=await this.extraModule.checkModule(dPackage.packagename)
    //     if(!res){
    //         throw new CustomError("generate capation must install "+toolName,2024120511189)
    //     }
    //     return true
    // }
}