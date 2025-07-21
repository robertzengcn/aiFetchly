import {Campaign} from '@/modules/campaign'
import {campaignEntity} from "@/entityTypes/campaign-type"
import {CommonResponse} from "@/entityTypes/commonType"


export class CampaignController {
    public async getCampaignlist(data: string): Promise<CommonResponse<campaignEntity>> {
        const qdata=JSON.parse(data);
        const campaignModel=new Campaign();
        const result=await campaignModel.getCampaignlist(qdata).then(function (res) {
            //console.log(res);
            if(!res){
                return {
                    status:false,
                    msg:"remote return empty",
                    data:null
                }
            }
            return res;
        })
        
        return result;
    }
}