import { BaseModule } from "@/modules/baseModule";
import { EmailFilterDetailModel } from "@/model/EmailFilterDetail.model";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";
import { EmailFilterDetailModuleInterface } from "@/modules/interface/EmailFilterDetailModuleInterface";

export class EmailFilterDetailModule extends BaseModule implements EmailFilterDetailModuleInterface {
    private emailFilterDetailModel: EmailFilterDetailModel;

    constructor() {
        super();
        this.emailFilterDetailModel = new EmailFilterDetailModel(this.dbpath);
    }

    /**
     * Create a new email filter detail
     * @param detail The email filter detail entity
     * @returns The ID of the created detail
     */
    async create(detail: EmailFilterDetailEntity): Promise<number> {
        try {
            return await this.emailFilterDetailModel.create(detail);
        } catch (error) {
            console.error('Error creating email filter detail:', error);
            throw error;
        }
    }

    /**
     * Get an email filter detail by ID
     * @param id The detail ID
     * @returns The email filter detail entity
     */
    async read(id: number): Promise<EmailFilterDetailEntity | undefined> {
        try {
            return await this.emailFilterDetailModel.read(id);
        } catch (error) {
            console.error('Error getting email filter detail:', error);
            throw error;
        }
    }

    /**
     * Update an email filter detail
     * @param id The detail ID
     * @param detail The email filter detail entity to update
     */
    async update(id: number, detail: EmailFilterDetailEntity): Promise<void> {
        try {
            await this.emailFilterDetailModel.update(id, detail);
        } catch (error) {
            console.error('Error updating email filter detail:', error);
            throw error;
        }
    }

    /**
     * Delete an email filter detail
     * @param id The detail ID
     */
    async delete(id: number): Promise<void> {
        try {
            await this.emailFilterDetailModel.delete(id);
        } catch (error) {
            console.error('Error deleting email filter detail:', error);
            throw error;
        }
    }

    /**
     * Get email filter detail list by filter ID
     * @param filterId The filter ID
     * @returns Array of email filter detail entities
     */
    async getEmailFilterDetailsByFilterId(filterId: number): Promise<EmailFilterDetailEntity[]> {
        try {
            return await this.emailFilterDetailModel.getEmailFilterDetailsByFilterId(filterId);
        } catch (error) {
            console.error('Error getting email filter details by filter ID:', error);
            throw error;
        }
    }

    /**
     * Update email filter detail by filter ID
     * @param filterId The filter ID
     * @param details Array of email filter detail entities to update
     */
    async updateEmailFilterDetailsByFilterId(filterId: number, details: EmailFilterDetailEntity[]): Promise<void> {
        try {
            await this.emailFilterDetailModel.updateEmailFilterDetailsByFilterId(filterId, details);
        } catch (error) {
            console.error('Error updating email filter details by filter ID:', error);
            throw error;
        }
    }

    /**
     * Delete email filter detail by filter ID
     * @param filterId The filter ID
     */
    async deleteEmailFilterDetailsByFilterId(filterId: number): Promise<void> {
        try {
            await this.emailFilterDetailModel.deleteEmailFilterDetailsByFilterId(filterId);
        } catch (error) {
            console.error('Error deleting email filter details by filter ID:', error);
            throw error;
        }
    }
} 