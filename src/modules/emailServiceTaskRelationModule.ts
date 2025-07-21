import { BaseModule } from "@/modules/baseModule";
import { EmailServiceTaskRelationModel } from "@/model/EmailServiceTaskRelation.model";
import { EmailServiceTaskRelationEntity } from "@/entity/EmailServiceTaskRelation.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";

export class EmailServiceTaskRelationModule extends BaseModule {
    private emailServiceTaskRelationModel: EmailServiceTaskRelationModel;

    constructor() {
        super();
        this.emailServiceTaskRelationModel = new EmailServiceTaskRelationModel(this.dbpath);
    }

    async createEmailServiceTaskRelation(relation: EmailServiceTaskRelationEntity): Promise<number> {
        try {
            return await this.emailServiceTaskRelationModel.create(relation);
        } catch (error) {
            console.error('Error creating email service task relation:', error);
            throw error;
        }
    }

    async getEmailServiceTaskRelation(id: number): Promise<EmailServiceTaskRelationEntity | undefined> {
        try {
            return await this.emailServiceTaskRelationModel.read(id);
        } catch (error) {
            console.error('Error getting email service task relation:', error);
            throw error;
        }
    }

    async updateEmailServiceTaskRelation(id: number, relation: EmailServiceTaskRelationEntity): Promise<void> {
        try {
            await this.emailServiceTaskRelationModel.update(id, relation);
        } catch (error) {
            console.error('Error updating email service task relation:', error);
            throw error;
        }
    }

    async deleteEmailServiceTaskRelation(id: number): Promise<void> {
        try {
            await this.emailServiceTaskRelationModel.delete(id);
        } catch (error) {
            console.error('Error deleting email service task relation:', error);
            throw error;
        }
    }

    async getEmailServicesByTaskId(buckemailTaskId: number): Promise<EmailServiceEntity[]> {
        try {
            return await this.emailServiceTaskRelationModel.getEmailServicesByTaskId(buckemailTaskId);
        } catch (error) {
            console.error('Error getting email services by task ID:', error);
            throw error;
        }
    }

    async updateEmailServicesByTaskId(buckemailTaskId: number, emailServiceIds: number[]): Promise<void> {
        try {
            await this.emailServiceTaskRelationModel.updateEmailServicesByTaskId(buckemailTaskId, emailServiceIds);
        } catch (error) {
            console.error('Error updating email services by task ID:', error);
            throw error;
        }
    }

    async deleteEmailServicesByTaskId(buckemailTaskId: number): Promise<void> {
        try {
            await this.emailServiceTaskRelationModel.deleteEmailServicesByTaskId(buckemailTaskId);
        } catch (error) {
            console.error('Error deleting email services by task ID:', error);
            throw error;
        }
    }

    async getTaskIdsByEmailServiceId(emailServiceId: number): Promise<number[]> {
        try {
            return await this.emailServiceTaskRelationModel.getTaskIdsByEmailServiceId(emailServiceId);
        } catch (error) {
            console.error('Error getting task IDs by email service ID:', error);
            throw error;
        }
    }

    async checkRelationExists(emailServiceId: number, buckemailTaskId: number): Promise<boolean> {
        try {
            return await this.emailServiceTaskRelationModel.checkRelationExists(emailServiceId, buckemailTaskId);
        } catch (error) {
            console.error('Error checking relation exists:', error);
            throw error;
        }
    }

    async addEmailServiceToTask(emailServiceId: number, buckemailTaskId: number): Promise<number> {
        try {
            const exists = await this.checkRelationExists(emailServiceId, buckemailTaskId);
            if (exists) {
                throw new Error('Email service is already associated with this task');
            }
            return await this.emailServiceTaskRelationModel.addEmailServiceToTask(emailServiceId, buckemailTaskId);
        } catch (error) {
            console.error('Error adding email service to task:', error);
            throw error;
        }
    }

    async removeEmailServiceFromTask(emailServiceId: number, buckemailTaskId: number): Promise<void> {
        try {
            await this.emailServiceTaskRelationModel.removeEmailServiceFromTask(emailServiceId, buckemailTaskId);
        } catch (error) {
            console.error('Error removing email service from task:', error);
            throw error;
        }
    }

    async updateRelationStatus(id: number, status: number): Promise<void> {
        try {
            await this.emailServiceTaskRelationModel.updateRelationStatus(id, status);
        } catch (error) {
            console.error('Error updating relation status:', error);
            throw error;
        }
    }

    async getEmailServiceIdsByTaskId(buckemailTaskId: number): Promise<number[]> {
        try {
            const emailServices = await this.getEmailServicesByTaskId(buckemailTaskId);
            return emailServices.map(service => service.id);
        } catch (error) {
            console.error('Error getting email service IDs by task ID:', error);
            throw error;
        }
    }

    async validateEmailServiceIds(emailServiceIds: number[]): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        if (!Array.isArray(emailServiceIds)) {
            errors.push('Email service IDs must be an array');
            return { valid: false, errors };
        }

        if (emailServiceIds.length === 0) {
            errors.push('At least one email service must be selected');
        }

        const uniqueIds = new Set(emailServiceIds);
        if (uniqueIds.size !== emailServiceIds.length) {
            errors.push('Duplicate email service IDs are not allowed');
        }

        for (const id of emailServiceIds) {
            if (!Number.isInteger(id) || id <= 0) {
                errors.push(`Invalid email service ID: ${id}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    async bulkUpdateEmailServicesForTasks(taskServiceMap: { [taskId: number]: number[] }): Promise<void> {
        try {
            for (const [taskId, emailServiceIds] of Object.entries(taskServiceMap)) {
                const validation = await this.validateEmailServiceIds(emailServiceIds);
                if (!validation.valid) {
                    throw new Error(`Validation failed for task ${taskId}: ${validation.errors.join(', ')}`);
                }

                await this.updateEmailServicesByTaskId(Number(taskId), emailServiceIds);
            }
        } catch (error) {
            console.error('Error bulk updating email services for tasks:', error);
            throw error;
        }
    }
} 