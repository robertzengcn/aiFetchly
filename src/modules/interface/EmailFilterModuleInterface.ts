//import { EmailFilterEntity } from "@/model/emailFilterTaskdb";

import { SortBy } from "@/entityTypes/commonType";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";

export interface EmailFilterModuleInterface {
    /**
     * Create a new email filter
     * @param filter The email filter entity
     * @returns The ID of the created filter
     */
    create(filter: EmailFilterEntity): Promise<number>;

    /**
     * Get an email filter by ID
     * @param id The filter ID
     * @returns The email filter entity
     */
    read(id: number): Promise<EmailFilterEntity | undefined>;

    /**
     * Update an email filter
     * @param id The filter ID
     * @param filter The email filter entity to update
     */
    update(id: number, filter: EmailFilterEntity): Promise<void>;

    /**
     * Delete an email filter
     * @param id The filter ID
     */
    delete(id: number): Promise<void>;

    /**
     * Update filter status
     * @param id The filter ID
     * @param status The new status
     */
    updateFilterStatus(id: number, status: number): Promise<void>;

    /**
     * List email filters with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of email filter entities
     */
    listEmailFilters(page: number, size: number, search?: string,sort?: SortBy): Promise<EmailFilterEntity[]>;

    /**
     * Get total number of email filters
     * @returns Total count of filters
     */
    countEmailFilters(): Promise<number>;

    /**
     * Get filter status name
     * @param status The filter status value
     * @returns String representation of the status
     */
    getFilterStatusName(status: number): string;
} 