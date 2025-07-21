"use strict";
export {};
import {TranslateController} from "@/controller/TranslateController"
import {ProcessMessage} from "@/entityTypes/processMessage-type"
import { parentPort, workerData } from "worker_threads";
import {VideoTranslateItem } from "@/entityTypes/videoType";
import {TransItemsParam} from "@/entityTypes/translateType"
import {TranslateProducer} from "@/modules/TranslateProducer"
import {LlmCongfig,TraditionalTranslateCongfig} from '@/entityTypes/commonType'

async function startWorkerProcess() {
    const { action, data } = workerData;
    console.log("output from workerData",workerData)
    switch(action){
        case 'translateVideoInfo':
            // console.log("translating video info")
            await translateVideoinfo(data as TransItemsParam<VideoTranslateItem>);
            break;

    }
}

const translateVideoinfo=async (data:TransItemsParam<VideoTranslateItem>)=>{
    if(!data.translate_tool){
        console.error("translate tool is not provided")
        return
    }

    

    for (const item in data.items){

       //translatePro.translateText(data.translate_tool,data.items[item].source_language,data.target_language,data.items[item].text,llmcon,traditionalTranslateCongfig)
    }
}

startWorkerProcess();