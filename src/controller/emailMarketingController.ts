//import {EmailMarketingTemplateApi} from "@/api/emailMarketingTemplateApi";
import { EmailTemplateModule } from "@/modules/EmailTemplateModule"
import { ListData } from "@/entityTypes/commonType"
import { EmailTemplatedata, EmailFilterdata, EmailServiceListdata, EmailServiceEntitydata, EmailSendParam } from "@/entityTypes/emailmarketingType"
//import {EmailMarketingFilterApi} from "@/api/emailMarketingFilterApi";
//import {EmailServiceApi} from "@/api/emailServiceApi";
import { EmailService } from "@/modules/lib/emailService"
import { EmailTemplateModuleInterface } from "@/modules/interface/EmailTemplateModuleInterface"
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity"
import { EmailFilterTaskRelationModule } from "@/modules/EmailFilterTaskRelationModule"
import { EmailFilterTaskRelationModuleInterface } from "@/modules/interface/EmailFilterTaskRelationModuleInterface"
import { EmailFilterModuleInterface } from "@/modules/interface/EmailFilterModuleInterface"
import { EmailFilterModule } from "@/modules/EmailFilterModule"
import { EmailFilterEntity } from "@/entity/EmailFilter.entity"
import { EmailServiceModule } from "@/modules/emailServiceModule"
import { EmailServiceModuleInterface } from "@/modules/interface/EmailServiceModuleInterface"
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity"
import { EmailFilterDetailModuleInterface } from "@/modules/interface/EmailFilterDetailModuleInterface"
import { EmailFilterDetailModule } from "@/modules/EmailFilterDetailModule"
import { EmailServiceEntity } from "@/entity/EmailService.entity"
import { EmailTemplateRespdata } from "@/entityTypes/emailmarketingType"
export class EmailMarketingController {
    emailTemplateModule: EmailTemplateModuleInterface;
    emailFilterTaskRelationModule: EmailFilterTaskRelationModuleInterface;
    emailFilterModule: EmailFilterModuleInterface;
    emailServiceModule: EmailServiceModuleInterface;
    emailFilterDetailModule: EmailFilterDetailModuleInterface;
    // emailMarketingFilterApi:EmailMarketingFilterApi
    // emailServiceApi:EmailServiceApi
    constructor() {
        this.emailTemplateModule = new EmailTemplateModule();
        this.emailFilterTaskRelationModule = new EmailFilterTaskRelationModule();
        this.emailFilterModule = new EmailFilterModule();
        this.emailServiceModule = new EmailServiceModule();
        this.emailFilterDetailModule = new EmailFilterDetailModule();
        //         this.emailMarketingTemplateApi = new EmailMarketingTemplateApi();
        //         this.emailMarketingFilterApi=new EmailMarketingFilterApi();
        // this.emailServiceApi=new EmailServiceApi();
    }
    //list email template
    public async listEmailTemplate(page: number, size: number, search?: string): Promise<ListData<EmailTemplateEntity>> {
        const listdata = await this.emailTemplateModule.listEmailTemplates(page, size, search);
        const count = await this.emailTemplateModule.countEmailTemplates();
        return {
            records: listdata,
            num: count
        }
    }
    //get email template detail
    public async getEmailTemplateDetail(id: number): Promise<EmailTemplateEntity | undefined> {
        return await this.emailTemplateModule.read(id);
    }
    //remove email template
    public async removeEmailTemplate(id: number): Promise<void> {
        return await this.emailTemplateModule.delete(id);
    }
    //update email template
    public async updateEmailtemplate(param: EmailTemplateRespdata): Promise<number> {

        if (param.TplId) {
            const entity = new EmailTemplateEntity();
            entity.content = param.TplContent;
            entity.description = param.TplDescription ?? null;
            entity.title = param.TplTitle;
            //entity.description = param.Description  ;
            await this.emailTemplateModule.update(param.TplId, entity);
            return param.TplId;
        } else {
            const entity = new EmailTemplateEntity();
            entity.content = param.TplContent;
            entity.description = param.TplDescription ?? null;
            entity.title = param.TplTitle;
            //entity.description=param.Description?;
            return await this.emailTemplateModule.create(entity);
        }
    }
    //list email filter
    public async listEmailFilter(page: number, size: number, search?: string): Promise<ListData<EmailFilterEntity>> {
        const listdata = await this.emailFilterModule.listEmailFilters(page, size, search);
        const count = await this.emailFilterModule.countEmailFilters();
        return {
            records: listdata,
            num: count
        }
    }
    // get email filter
    public async getEmailFilterDetail(id: number): Promise<EmailFilterEntity | undefined> {
        return await this.emailFilterModule.read(id);
    }
    //get email filter detail by fileter id
    public async getEmailFilterDetailByFilterId(filterId: number): Promise<EmailFilterDetailEntity[] | undefined> {
        const listdata = await this.emailFilterDetailModule.getEmailFilterDetailsByFilterId(filterId);
        return listdata;
    }
    //update email filter
    public async updateEmailFilter(param: EmailFilterdata): Promise<number> {
        if (param.filter_details) {
            param.filter_details.forEach((item) => {
                if ((!item.id) && (!item.content)) {
                    //remove empty filter
                    const index = param.filter_details.indexOf(item)
                    param.filter_details.splice(index, 1)
                }
            })
        }
        if (param.id) {
            const entity = new EmailFilterEntity();
            entity.name = param.name;
            //entity.content=param.filter_details.map((item)=>item.content).join("\n");
            entity.description = param.description;
            await this.emailFilterModule.update(param.id, entity);
            //update filter detail
            // param.filter_details.forEach((item)=>{
            for (const item of param.filter_details) {
                const detailentity = new EmailFilterDetailEntity();
                detailentity.content = item.content;
                if (item.id) {
                    detailentity.filter_id = param.id;
                    await this.emailFilterDetailModule.update(item.id, detailentity);
                } else {
                    detailentity.filter_id = param.id;
                    await this.emailFilterDetailModule.create(detailentity);
                }
            }
            return param.id;
        }else{
            const entity = new EmailFilterEntity();
            entity.name = param.name;
            //entity.content=param.filter_details.map((item)=>item.content).join("\n");
            entity.description = param.description;
            const id=await this.emailFilterModule.create(entity)
            for (const item of param.filter_details){
                const detailentity = new EmailFilterDetailEntity();
                detailentity.content = item.content;
                detailentity.filter_id = id;
                await this.emailFilterDetailModule.create(detailentity);
            }
            return id;
        }
    }
    //delete email filter
    public async deleteEmailFilter(id: number): Promise < void> {
    return await this.emailFilterModule.delete(id);
}
    //get email service list
    public async getEmailServiceList(page: number, size: number, search?: string): Promise<ListData<EmailServiceListdata>> {
        const listdata = await this.emailServiceModule.listEmailServices(page, size, search);
        const count = await this.emailServiceModule.countEmailServices();
        const listdata2: EmailServiceListdata[] = listdata.records.map((item) => {
            return {
                id: item.id,
                name: item.name,
                from: item.from,
                host: item.host,
                create_time: item.createdAt?.toISOString() || ''    
            }   
        });
        return {
            records: listdata2,
            num: count
        }
    }
    //get email service detail
    public async getEmailServiceDetail(id: number): Promise < EmailServiceEntitydata | undefined > {
    return await this.emailServiceModule.getEmailService(id);   
}
    //create or update email service
    public async createEmailService(param: EmailServiceEntitydata): Promise < number > {
        const entity = new EmailServiceEntity();
        entity.name = param.name;
        entity.host = param.host;
        entity.port = param.port;
        entity.from = param.from;
        entity.password = param.password;
    return await this.emailServiceModule.createEmailService(entity);
}
    //delete email service
    public async deleteEmailService(id: number): Promise < void> {
    return await this.emailServiceModule.deleteEmailService(id);
}

    //send email 
    public async sendEmail(param: EmailSendParam, errorCall ?: (errorMessage: string) => void, successCallback ?: () => void ): Promise < any > {

    const emailService = new EmailService(param.Setting)
        await emailService.sendEmail(param.EmailRequestData, function (errorString) {
        if (errorCall) {
            errorCall(errorString)
        }
    }, function () {
        if (successCallback) {
            successCallback()
        }
    })

}

  
    
}