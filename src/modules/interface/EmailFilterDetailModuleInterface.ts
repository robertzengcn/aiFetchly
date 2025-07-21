import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";

export interface EmailFilterDetailModuleInterface {
    /**
     * Create a new email filter detail
     * @param detail The email filter detail entity
     * @returns The ID of the created detail
     */
    create(detail: EmailFilterDetailEntity): Promise<number>;

    /**
     * Get an email filter detail by ID
     * @param id The detail ID
     * @returns The email filter detail entity
     */
    read(id: number): Promise<EmailFilterDetailEntity | undefined>;

    /**
     * Update an email filter detail
     * @param id The detail ID
     * @param detail The email filter detail entity to update
     */
    update(id: number, detail: EmailFilterDetailEntity): Promise<void>;

    /**
     * Delete an email filter detail
     * @param id The detail ID
     */
    delete(id: number): Promise<void>;

    /**
     * Get email filter detail list by filter ID
     * @param filterId The filter ID
     * @returns Array of email filter detail entities
     */
    getEmailFilterDetailsByFilterId(filterId: number): Promise<EmailFilterDetailEntity[]>;

    /**
     * Update email filter detail by filter ID
     * @param filterId The filter ID
     * @param details Array of email filter detail entities to update
     */
    updateEmailFilterDetailsByFilterId(filterId: number, details: EmailFilterDetailEntity[]): Promise<void>;

    /**
     * Delete email filter detail by filter ID
     * @param filterId The filter ID
     */
    deleteEmailFilterDetailsByFilterId(filterId: number): Promise<void>;
} 