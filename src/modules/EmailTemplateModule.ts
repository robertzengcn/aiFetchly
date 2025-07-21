import { BaseModule } from "@/modules/baseModule";
import { EmailTemplateModel } from "@/model/EmailTemplate.model";
import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { SortBy } from "@/entityTypes/commonType";
import { EmailTemplateModuleInterface } from "@/modules/interface/EmailTemplateModuleInterface";

export class EmailTemplateModule extends BaseModule implements EmailTemplateModuleInterface {
    private emailTemplateModel: EmailTemplateModel;

    constructor() {
        super();
        this.emailTemplateModel = new EmailTemplateModel(this.dbpath);
    }

    /**
     * Create a new email template
     * @param template The email template entity
     * @returns The ID of the created template
     */
    async create(template: EmailTemplateEntity): Promise<number> {
        return await this.emailTemplateModel.create(template);
    }

    /**
     * Get an email template by ID
     * @param id The template ID
     * @returns The email template entity
     */
    async read(id: number): Promise<EmailTemplateEntity | undefined> {
        return await this.emailTemplateModel.read(id);
    }

    /**
     * Update an email template
     * @param id The template ID
     * @param template The email template entity to update
     */
    async update(id: number, template: EmailTemplateEntity): Promise<void> {
        return await this.emailTemplateModel.update(id, template);
    }

    /**
     * Delete an email template
     * @param id The template ID
     */
    async delete(id: number): Promise<void> {
        return await this.emailTemplateModel.delete(id);
    }

    /**
     * Update template status
     * @param id The template ID
     * @param status The new status
     */
    async updateTemplateStatus(id: number, status: number): Promise<void> {
        return await this.emailTemplateModel.updateTemplateStatus(id, status);
    }

    /**
     * List email templates with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of email template entities
     */
    async listEmailTemplates(page: number, size: number, search?: string, sort?: SortBy): Promise<EmailTemplateEntity[]> {
        return await this.emailTemplateModel.listEmailTemplates(page, size, search, sort);
    }

    /**
     * Get total number of email templates
     * @returns Total count of templates
     */
    async countEmailTemplates(): Promise<number> {
        return await this.emailTemplateModel.countEmailTemplates();
    }

    /**
     * Get template status name
     * @param status The template status value
     * @returns String representation of the status
     */
    getTemplateStatusName(status: number): string {
        switch (status) {
            case 1:
                return "Active";
            case 0:
                return "Inactive";
            default:
                return "Unknown";
        }
    }
} 