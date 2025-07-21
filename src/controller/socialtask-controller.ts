import {SocialTask} from "@/modules/socialtask";
import {SocialTaskResponse,SocialTaskInfoResponse,SocialTaskTypeResponse,TagResponse,SaveSocialTaskResponse,SocialTaskEntity,SocialTaskRunEntity} from "@/entityTypes/socialtask-type"
export class SocialTaskController {
    public async getSocialTasklist(id: number,page:number,size:number): Promise<SocialTaskResponse> {
       
        const socialTaskModel=new SocialTask();
        const result=await socialTaskModel.getTaskbycampagin(id,page,size).then(function (res) {
            //console.log(res);
            return res;
        })
        // .catch(function (error) {
        //     console.log(error)
        //         //debug(error);
        //         //throw new Error(error.message);
        //     return null
        // });
        return result as SocialTaskResponse;
    }
    //get social task info
    public async getSocialTaskinfo(id: number): Promise<SocialTaskInfoResponse> {
        // const qdata=JSON.parse(data);
        // if(!qdata.hasOwnProperty("id")){
        //     throw new Error("id not found");
        // }
        const socialTaskModel=new SocialTask();
        const result=await socialTaskModel.getTaskbyid(id).then(function (res) {
            //console.log(res);
            return res;
        })
        // .catch(function (error) {
        //     console.log(error)
        //         //debug(error);
        //         //throw new Error(error.message);
        //     return null
        // });
        return result as SocialTaskInfoResponse;
    }
    //get social task type list
    public async getSocialTaskType(): Promise<SocialTaskTypeResponse> {
        // const qdata=JSON.parse(data);
        // if(!qdata.hasOwnProperty("id")){
        //     throw new Error("id not found");
        // }
        const socialTaskModel=new SocialTask();
        const result=await socialTaskModel.getTasktype().then(function (res) {
            //console.log(res);
            return res;
        })
        // .catch(function (error) {
        //     console.log(error)
        //         //debug(error);
        //         //throw new Error(error.message);
        //     return null
        // });
        return result as SocialTaskTypeResponse;
    }
    //get tag list
    public async getTaglist(): Promise<TagResponse> {
        const socialTaskModel=new SocialTask();
        const result=await socialTaskModel.getTaglist().then(function (res) {
            //console.log(res);
            return res;
        })
        return result as TagResponse;
    }

    //save social task
    public async saveSocialTask(data: SocialTaskEntity): Promise<SaveSocialTaskResponse> {
        
        const socialTaskModel=new SocialTask();
        const result=await socialTaskModel.saveSocialTask(data).then(function (res) {
            //console.log(res);
            return res;
        })
        .catch(function (error) {
            console.log(error)
                //debug(error);
                //throw new Error(error.message);
            return {status:false,msg:error.message}
        });
        return result as SaveSocialTaskResponse;
    }
    public async createSocialtask(id:number,runNum:string): Promise<SocialTaskRunEntity|null> {
        
        const socialTaskModel=new SocialTask();
        const result=await socialTaskModel.createsocialtask(id,runNum).then(function (res) {
            //console.log(res);
            return res;
        });
        
        return result as SocialTaskRunEntity;
    }
    public async runSocialtask(entity:SocialTaskRunEntity,callback:Function|undefined|null): Promise<SocialTaskRunEntity|null|void> {
            
            const socialTaskModel=new SocialTask();
            const result=await socialTaskModel.runsocialtask(entity,callback).then(function (res) {
                //console.log(res);
                return res;
            })
            .catch(function (error) {
                console.log(error)
                    //debug(error);
                    //throw new Error(error.message);
                return null
            });
            return result;
    }
   

}