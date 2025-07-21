import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy, ListData } from "@/entityTypes/commonType";

export interface EmailServiceModuleInterface {
    /**
     * Create a new email service
     * @param service The email service entity
     * @returns The ID of the created service
     */
    createEmailService(service: EmailServiceEntity): Promise<number>;

    /**
     * Get an email service by ID
     * @param id The service ID
     * @returns The email service entity
     */
    getEmailService(id: number): Promise<EmailServiceEntity | undefined>;

    /**
     * Update an email service
     * @param id The service ID
     * @param service The email service entity to update
     */
    updateEmailService(id: number, service: EmailServiceEntity): Promise<void>;

    /**
     * Delete an email service
     * @param id The service ID
     */
    deleteEmailService(id: number): Promise<void>;

    /**
     * Update service status
     * @param id The service ID
     * @param status The new status
     */
    updateEmailServiceStatus(id: number, status: number): Promise<void>;

    /**
     * List email services with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns List data containing records and total count
     */
    listEmailServices(page: number, size: number, search?: string,sort?: SortBy): Promise<ListData<EmailServiceEntity>>;

    /**
     * Get total number of email services
     * @returns Total count of services
     */
    countEmailServices(): Promise<number>;

    /**
     * Find email service by name
     * @param name The service name
     * @returns The email service entity
     */
    findEmailServiceByName(name: string): Promise<EmailServiceEntity | undefined>;

    /**
     * Find email services by host
     * @param host The host name
     * @returns Array of email service entities
     */
    findEmailServicesByHost(host: string): Promise<EmailServiceEntity[]>;

    /**
     * Get active email services
     * @returns Array of active email service entities
     */
    getActiveEmailServices(): Promise<EmailServiceEntity[]>;

    /**
     * Validate email service configuration
     * @param service The email service entity to validate
     * @returns Validation result with validity status and error messages
     */
    validateEmailService(service: EmailServiceEntity): Promise<{ valid: boolean; errors: string[] }>;
} 