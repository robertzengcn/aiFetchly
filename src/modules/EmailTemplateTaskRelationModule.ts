import { BaseModule } from "@/modules/baseModule";
import { EmailTemplateTaskRelationModel } from "@/model/EmailTemplateTaskRelation.model";
//import { EmailTemplateTaskRelationEntity, EmailTemplateWithRelation } from "@/model/emailTemplateTaskRelationdb";
import { SortBy } from "@/entityTypes/commonType";
import { EmailTemplateTaskRelationEntity } from "@/entity/EmailTemplateTaskRelation.entity";

export class EmailTemplateTaskRelationModule extends BaseModule {
    private emailTemplateTaskRelationModel: EmailTemplateTaskRelationModel;

    constructor() {
        super();
        this.emailTemplateTaskRelationModel = new EmailTemplateTaskRelationModel(this.dbpath);
    }

    /**
     * Create a new email template task relation
     * @param relation The email template task relation entity
     * @returns The ID of the created relation
     */
    async create(relation: EmailTemplateTaskRelationEntity): Promise<number> {
        return await this.emailTemplateTaskRelationModel.create(relation);
    }

    /**
     * Get an email template task relation by ID
     * @param id The relation ID
     * @returns The email template task relation entity
     */
    async read(id: number): Promise<EmailTemplateTaskRelationEntity | undefined> {
        return await this.emailTemplateTaskRelationModel.read(id);
    }

    /**
     * Update an email template task relation
     * @param id The relation ID
     * @param relation The email template task relation entity to update
     */
    async update(id: number, relation: EmailTemplateTaskRelationEntity): Promise<void> {
        return await this.emailTemplateTaskRelationModel.update(id, relation);
    }

    /**
     * Delete an email template task relation
     * @param id The relation ID
     */
    async delete(id: number): Promise<void> {
        return await this.emailTemplateTaskRelationModel.delete(id);
    }

    /**
     * Update relation status
     * @param id The relation ID
     * @param status The new status
     */
    async updateRelationStatus(id: number, status: number): Promise<void> {
        return await this.emailTemplateTaskRelationModel.updateRelationStatus(id, status);
    }

    /**
     * List email template task relations with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of email template task relation entities
     */
    async listRelations(page: number, size: number, sort?: SortBy): Promise<EmailTemplateTaskRelationEntity[]> {
        return await this.emailTemplateTaskRelationModel.listRelations(page, size, sort);
    }

    /**
     * Get total number of email template task relations
     * @returns Total count of relations
     */
    async countRelations(): Promise<number> {
        return await this.emailTemplateTaskRelationModel.countRelations();
    }

    /**
     * Get email templates by buckemail task ID
     * @param buckemailTaskId The buckemail task ID
     * @returns Array of email templates with relation information
     */
    async getEmailTemplatesByBuckemailTaskId(buckemailTaskId: number): Promise<EmailTemplateTaskRelationEntity[]> {
        return await this.emailTemplateTaskRelationModel.getEmailTemplatesByBuckemailTaskId(buckemailTaskId);
    }

    /**
     * Delete all relations by buckemail task ID
     * @param buckemailTaskId The buckemail task ID
     */
    async deleteByBuckemailTaskId(buckemailTaskId: number): Promise<void> {
        return await this.emailTemplateTaskRelationModel.deleteByBuckemailTaskId(buckemailTaskId);
    }

    /**
     * Update relations by buckemail task ID (replace all existing relations)
     * @param buckemailTaskId The buckemail task ID
     * @param relations Array of new relations
     */
    async updateByBuckemailTaskId(buckemailTaskId: number, relations: EmailTemplateTaskRelationEntity[]): Promise<void> {
        return await this.emailTemplateTaskRelationModel.updateByBuckemailTaskId(buckemailTaskId, relations);
    }

    /**
     * Find relation by template and task IDs
     * @param emailTemplateId The email template ID
     * @param buckemailTaskId The buckemail task ID
     * @returns The relation entity if found
     */
    async findByTemplateAndTask(emailTemplateId: number, buckemailTaskId: number): Promise<EmailTemplateTaskRelationEntity | undefined> {
        return await this.emailTemplateTaskRelationModel.findByTemplateAndTask(emailTemplateId, buckemailTaskId);
    }

    /**
     * Get relation status name
     * @param status The relation status value
     * @returns String representation of the status
     */
    getRelationStatusName(status: number): string {
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