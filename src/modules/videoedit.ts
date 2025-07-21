'use strict';
export { };
import * as fs from 'fs';
// import { todo } from 'node:test';
const debug = require('debug')('videoedit');
import { spawn } from 'node:child_process';
import * as path from 'path';

export class Videoedit {
  /**
   * 
   * @param videoPath 
   * @param startTime 
   * @param endTime 
   */
  async removeWatermark(videoPath: string, outputpathfile: string, insertId: number | null, callback: Function | undefined|null) {
    //check video path exist
    if (!fs.existsSync(videoPath)) {
      throw new Error("video path not exist for the path "+videoPath);
    }
    const outputpath = path.dirname(outputpathfile)
    //check output path exist
    if (!fs.existsSync(outputpath)) {
      //create directory
      fs.mkdirSync(outputpath, { recursive: true });
    }
    const pythonProcess = await spawn('Marketingtool', [
      '--action', 'removeWatermark', '-f', videoPath, '-o', outputpathfile
    ]);

    pythonProcess.stdout.on('data', (data) => {
      debug(`stdout: ${data}`);

    });

    pythonProcess.stderr.on('data', (data) => {
      debug(`stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      debug(`watermark remove child process exited with code ${code}`);

      if (callback && (code == 0)) {
        debug("run callback")
        callback(insertId, outputpathfile);
      } else {
        //fileter watermark failuer, try to convert the 
        //const convertPath=path.dirname(videoPath)+path.sep+'convert_'+Math.random().toString(16).slice(2)+".mp4"
        const convername = '_convert'
        if (videoPath.includes(convername)) {
          //the video has been converted, not need to try again
          return;
        } else {
          debug("start convert video")
          const convertPath = path.dirname(videoPath) + path.sep + path.parse(videoPath).name +convername+'.mp4'
          this.convertvideo(videoPath,convertPath,()=>this.removeWatermark(convertPath,outputpathfile,insertId,callback));
          
        }
        // fs.access(convertPath, fs.constants.F_OK, (err) => {
        //   if (err) {
        //     debug("start convert video")
        //     this.convertvideo(videoPath,convertPath);
        //     this.removeWatermark(convertPath,outputpathfile,insertId,callback)
        //     return;
        //   }
        //   debug('File exists not need convert');
        //   console.log("remove watermark failuer")
        // });

      }
    });

    // const result = pythonProcess.stdout;
    // // const error = pythonProcess.stderr?.toString()?.trim();
    // const error = pythonProcess.stderr;
    // console.log(result)
    // debug(result)
    // //check command run success 
    // if(error){
    //   throw new Error(error)
    // }
  }
  /**
   * get video captions
   */
  async getVideocaptions(videoPath: string, outputPath: string, sourcelang: string, targetlang: string) {
    if (!fs.existsSync(videoPath)) {
      throw new Error("video path not exist");
    }
    const pythonProcess = await spawn('Marketingtool', [
      '--action',
      'translate',
      '-f', videoPath,
      '--source-lang', sourcelang,
      '--target-lang', targetlang
    ]);

    // const result = pythonProcess.stdout?.toString()?.trim();
    // const error = pythonProcess.stderr?.toString()?.trim();
    // debug(result)
    // if(error){
    //   throw new Error(error)
    // }
  }

  async convertvideo(videoPath: string, outputpathfile: string,callback:Function|undefined) {
    if (!fs.existsSync(videoPath)) {
      throw new Error("video path not exist");
    }
    //try {
      const pythonProcess = await spawn('Marketingtool', [
        '--action',
        'convertvideo',
        '-f', videoPath,
        '-o', outputpathfile,
      ]);
    // } catch (error) {
    //   debug(error)
    //   throw new Error(error)
    // }
    pythonProcess.on('close', (code) => {
      debug(`convert video child process exited with code ${code}`);
      if(code!=1){
        debug("convert command failure: Marketingtool --action convertvideo -f "+videoPath+" -o "+outputpathfile )
      }
      if(callback&& (code == 0)){
        callback;
      }
    });

  }


}
