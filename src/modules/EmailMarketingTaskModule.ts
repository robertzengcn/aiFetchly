//import { EmailMarketingTaskEntity } from "@/entity/EmailMarketingTask.entity";
import { EmailMarketingTaskModel } from "@/model/EmailMarketingTask.model";
import { EmailMarketingTaskdbEntity, EmailMarketingTaskStatus } from "@/model/emailMarketingTaskdb";
import { TaskStatus } from "@/entityTypes/commonType";
import { BaseModule } from "@/modules/baseModule";

export class EmailMarketingTaskModule extends BaseModule {
    private emailMarketingTaskModel: EmailMarketingTaskModel;

    constructor() {
        super();
        this.emailMarketingTaskModel = new EmailMarketingTaskModel(this.dbpath);
    }

    /**
     * Create a new email marketing task
     * @param task The email marketing task entity
     * @returns The ID of the created task
     */
    async create(task: EmailMarketingTaskdbEntity): Promise<number> {
        return await this.emailMarketingTaskModel.createTask(task);
    }

    /**
     * Get an email marketing task by ID
     * @param id The task ID
     * @returns The email marketing task entity
     */
    async read(id: number): Promise<EmailMarketingTaskdbEntity | null> {
        return await this.emailMarketingTaskModel.getTaskById(id);
    }

    /**
     * Update an email marketing task
     * @param task The email marketing task entity to update
     */
    async update(task: EmailMarketingTaskdbEntity): Promise<void> {
        return await this.emailMarketingTaskModel.updateTask(task);
    }

    /**
     * Delete an email marketing task
     * @param id The task ID
     */
    async delete(id: number): Promise<void> {
        return await this.emailMarketingTaskModel.deleteTask(id);
    }

    /**
     * Update task status by ID
     * @param id The task ID
     * @param status The new status
     */
    async updateTaskStatusById(id: number, status: TaskStatus): Promise<void> {
        return await this.emailMarketingTaskModel.updateTaskStatusById(id, status);
    }

    /**
     * Update task status
     * @param id The task ID
     * @param status The new status
     */
    async updateTaskStatus(id: number, status: EmailMarketingTaskStatus): Promise<void> {
        return await this.emailMarketingTaskModel.updateTaskStatus(id, status);
    }

    /**
     * Get status name from status enum
     * @param status The task status enum value
     * @returns String representation of the status
     */
    getStatusName(status: EmailMarketingTaskStatus): string {
        return this.emailMarketingTaskModel.getStatusName(status);
    }
} 