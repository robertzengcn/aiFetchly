import { EmailTemplateEntity } from "@/entity/EmailTemplate.entity";
import { SortBy } from "@/entityTypes/commonType";

export interface EmailTemplateModuleInterface {
    /**
     * Create a new email template
     * @param template The email template entity
     * @returns The ID of the created template
     */
    create(template: EmailTemplateEntity): Promise<number>;

    /**
     * Get an email template by ID
     * @param id The template ID
     * @returns The email template entity
     */
    read(id: number): Promise<EmailTemplateEntity | undefined>;

    /**
     * Update an email template
     * @param id The template ID
     * @param template The email template entity to update
     */
    update(id: number, template: EmailTemplateEntity): Promise<void>;

    /**
     * Delete an email template
     * @param id The template ID
     */
    delete(id: number): Promise<void>;

    /**
     * Update template status
     * @param id The template ID
     * @param status The new status
     */
    updateTemplateStatus(id: number, status: number): Promise<void>;

    /**
     * List email templates with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param search Search parameter (optional)
     * @param sort Sort parameters (optional)
     * @returns Array of email template entities
     */
    listEmailTemplates(page: number, size: number, search?: string, sort?: SortBy): Promise<EmailTemplateEntity[]>;

    /**
     * Get total number of email templates
     * @returns Total count of templates
     */
    countEmailTemplates(): Promise<number>;

    /**
     * Get template status name
     * @param status The template status value
     * @returns String representation of the status
     */
    getTemplateStatusName(status: number): string;
} 