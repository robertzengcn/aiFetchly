import { ipcMain } from 'electron';
import { EmailTemplateModule } from "@/modules/EmailTemplateModule";
//import { EmailTemplateEntity } from "@/model/emailTemplateTaskdb";
import { CommonResponse } from "@/entityTypes/commonType";
import { ItemSearchparam } from "@/entityTypes/commonType";
import {EmailTemplateTaskRelationModule} from "@/modules/EmailTemplateTaskRelationModule"
import {EmailTemplateEntity} from "@/entity/EmailTemplate.entity"
import { 
    EMAILTEMPLATE_LIST, 
    EMAILTEMPLATE_DETAIL, 
    EMAILTEMPLATE_CREATE, 
    EMAILTEMPLATE_UPDATE, 
    EMAILTEMPLATE_DELETE, 
    EMAILTEMPLATE_BY_TASK 
} from "@/config/channellist";

/**
 * Email Template IPC handlers
 */
export function registerEmailTemplateIpcHandlers() {
    
    // List email templates with pagination and sorting
    ipcMain.handle(EMAILTEMPLATE_LIST, async (event, data) => {
        try {
            const qdata = JSON.parse(data) as ItemSearchparam;
            if (!Object.prototype.hasOwnProperty.call(qdata, "page")) {
                qdata.page = 0;
            }
            if (!Object.prototype.hasOwnProperty.call(qdata, "size")) {
                qdata.size = 100;
            }

            const emailTemplateModule = new EmailTemplateModule();
            const templates = await emailTemplateModule.listEmailTemplates(qdata.page, qdata.size, qdata.search,qdata.sortby);
            const total = await emailTemplateModule.countEmailTemplates();

            const resp: CommonResponse<EmailTemplateEntity> = {
                status: true,
                msg: "",
                data: {
                    records: templates,
                    num: total
                }
            };
            return resp;
        } catch (error) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return resp;
        }
    });

    // Get email template by ID
    ipcMain.handle(EMAILTEMPLATE_DETAIL, async (event, data) => {
        try {
            const { id } = JSON.parse(data);
            if (!id) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Template ID is required"
                };
                return resp;
            }

            const emailTemplateModule = new EmailTemplateModule();
            const template = await emailTemplateModule.read(id);

            if (!template) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Template not found"
                };
                return resp;
            }

            const resp: CommonResponse<EmailTemplateEntity> = {
                status: true,
                msg: "",
                data: {
                    records: [template],
                    num: 1
                }
            };
            return resp;
        } catch (error) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return resp;
        }
    });

    // Create new email template
    ipcMain.handle(EMAILTEMPLATE_CREATE, async (event, data) => {
        try {
            const templateData = JSON.parse(data) as EmailTemplateEntity;
            
            if (!templateData.title || !templateData.content ) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Title, content, and buckemail task ID are required"
                };
                return resp;
            }

            const emailTemplateModule = new EmailTemplateModule();
            const id = await emailTemplateModule.create(templateData);

            const resp: CommonResponse<{ id: number }> = {
                status: true,
                msg: "Template created successfully",
                data: {
                    records: [{ id }],
                    num: 1
                }
            };
            return resp;
        } catch (error) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return resp;
        }
    });

    // Update email template
    ipcMain.handle(EMAILTEMPLATE_UPDATE, async (event, data) => {
        try {
            const { id, ...templateData } = JSON.parse(data) as EmailTemplateEntity & { id: number };
            
            if (!id) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Template ID is required"
                };
                return resp;
            }

            if (!templateData.title || !templateData.content) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Title, content, and buckemail task ID are required"
                };
                return resp;
            }

            const emailTemplateModule = new EmailTemplateModule();
            await emailTemplateModule.update(id, templateData as EmailTemplateEntity);

            const resp: CommonResponse<null> = {
                status: true,
                msg: "Template updated successfully"
            };
            return resp;
        } catch (error) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return resp;
        }
    });

    // Delete email template
    ipcMain.handle(EMAILTEMPLATE_DELETE, async (event, data) => {
        try {
            const { id } = JSON.parse(data);
            if (!id) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Template ID is required"
                };
                return resp;
            }

            const emailTemplateModule = new EmailTemplateModule();
            await emailTemplateModule.delete(id);

            const resp: CommonResponse<null> = {
                status: true,
                msg: "Template deleted successfully"
            };
            return resp;
        } catch (error) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return resp;
        }
    });

    // Get email templates by buckemail task ID
    ipcMain.handle(EMAILTEMPLATE_BY_TASK, async (event, data) => {
        try {
            const { buckemailTaskId } = JSON.parse(data);
            if (!buckemailTaskId) {
                const resp: CommonResponse<null> = {
                    status: false,
                    msg: "Buckemail task ID is required"
                };
                return resp;
            }

            const emailTemplateTaskRelationModule = new EmailTemplateTaskRelationModule();
            const templates = await emailTemplateTaskRelationModule.getEmailTemplatesByBuckemailTaskId(buckemailTaskId);
            //loop templates and get email template entity
            const emailTemplateModule = new EmailTemplateModule();
            const emailTemplateList: EmailTemplateEntity[] = [];
            for (let i = 0; i < templates.length; i++) {
                const template = await emailTemplateModule.read(templates[i].emailTemplateId);
                if(template){
                    emailTemplateList.push(template);
                }
            }
            const resp: CommonResponse<EmailTemplateEntity> = {
                status: true,
                msg: "",
                data: {
                    records: emailTemplateList,
                    num: emailTemplateList.length
                }
            };
            return resp;
        } catch (error) {
            const resp: CommonResponse<null> = {
                status: false,
                msg: error instanceof Error ? error.message : "Unknown error occurred"
            };
            return resp;
        }
    });
} 