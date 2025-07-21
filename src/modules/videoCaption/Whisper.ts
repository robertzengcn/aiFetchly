import { VideoCaptionImpl } from '@/modules/interface/VideoCaptionImpl';
import { extraFileEntity } from "@/entityTypes/videoType";
import { exec } from 'child_process';
import { promisify } from "util";
import {getFileNameWithoutExtension} from '@/modules/lib/function';
import path from 'path';
const fs = require('fs');
const execAsync = promisify(exec);
export class Whisper implements VideoCaptionImpl{
    //extract caption from video
    async extractCaption(param:extraFileEntity)
    {
        let command = `${param.execPath || 'whisper'} "${param.file}" --output_dir "${param.savePath}" --output_format srt`;
        //console.log(command);
        if(param.model){
            command += ` --model ${param.model}`;
        }
        const srtfile=path.join(param.savePath,getFileNameWithoutExtension(param.file)+'.srt');
        
        // Limit the standard output to the first 10 lines
        // command += ' | head -n 10';
        console.log(command);
        const { stdout, stderr } = await execAsync(command,{ maxBuffer: 1024 * 1024 * 1024 });
        if(stderr){
            //check srt file exist first
            try {
                const stats = fs.statSync(srtfile);
                if (!stats.isFile() || stats.size <= 1) {
                    if (param.errorCall) {
                        param.errorCall(stderr);
                    }
                    return;
                }else{
                    if (param.successCall) {
                        param.successCall(srtfile);
                }
                }
            } catch (err) {
                if (param.errorCall) {
                    param.errorCall(stderr);
                }
                return;
            }
            // if (param.errorCall) {
            //     param.errorCall(`Error: ${stderr}`);
            // }
            return;
        }else{
            console.log("start success call");
            if (param.successCall) {
                param.successCall(srtfile);
        }
    }
        if(param.stroutCall){
            param.stroutCall(stdout);
        }

        // exec(command, (error, stdout, stderr) => {
        //     if (error) {
        //         if (param.errorCall) {
        //             param.errorCall(`Error: ${stderr}`);
        //         }
        //         return;
        //     }

        //     if (param.stroutCall) {
        //         param.stroutCall(stdout);
        //     }

        //     if (param.successCall) {
        //         param.successCall();
        //     }
        // });
    }
    
}