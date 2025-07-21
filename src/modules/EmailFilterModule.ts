import { BaseModule } from "@/modules/baseModule";
import { EmailFilterModel } from "@/model/EmailFilter.model";
//import { EmailFilterEntity } from "@/model/emailFilterTaskdb";
import { SortBy } from "@/entityTypes/commonType";
import { EmailFilterModuleInterface } from "@/modules/interface/EmailFilterModuleInterface";
import { EmailFilterEntity } from "@/entity/EmailFilter.entity";
export class EmailFilterModule extends BaseModule implements EmailFilterModuleInterface {
    private emailFilterModel: EmailFilterModel;

    constructor() {
        super();
        this.emailFilterModel = new EmailFilterModel(this.dbpath);
    }

    /**
     * Create a new email filter
     * @param filter The email filter entity
     * @returns The ID of the created filter
     */
    async create(filter: EmailFilterEntity): Promise<number> {
        return await this.emailFilterModel.create(filter);
    }

    /**
     * Get an email filter by ID
     * @param id The filter ID
     * @returns The email filter entity
     */
    async read(id: number): Promise<EmailFilterEntity | undefined> {
        return await this.emailFilterModel.read(id);
    }

    /**
     * Update an email filter
     * @param id The filter ID
     * @param filter The email filter entity to update
     */
    async update(id: number, filter: EmailFilterEntity): Promise<void> {
        return await this.emailFilterModel.update(id, filter);
    }

    /**
     * Delete an email filter
     * @param id The filter ID
     */
    async delete(id: number): Promise<void> {
        return await this.emailFilterModel.delete(id);
    }

    /**
     * Update filter status
     * @param id The filter ID
     * @param status The new status
     */
    async updateFilterStatus(id: number, status: number): Promise<void> {
        return await this.emailFilterModel.updateFilterStatus(id, status);
    }

    /**
     * List email filters with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of email filter entities
     */
    async listEmailFilters(page: number, size: number, search?: string,sort?: SortBy): Promise<EmailFilterEntity[]> {
        return await this.emailFilterModel.listEmailFilters(page, size, search,sort);
    }

    /**
     * Get total number of email filters
     * @returns Total count of filters
     */
    async countEmailFilters(): Promise<number> {
        return await this.emailFilterModel.countEmailFilters();
    }

    /**
     * Get filter status name
     * @param status The filter status value
     * @returns String representation of the status
     */
    getFilterStatusName(status: number): string {
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