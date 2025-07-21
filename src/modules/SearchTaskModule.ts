import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchTaskModel, SearchTaskStatus } from "@/model/SearchTask.model";
import { SearchtaskdbEntity } from "@/entityTypes/searchControlType";
import { SortBy } from "@/entityTypes/commonType";
import { BaseModule } from "@/modules/baseModule";

export class SearchTaskModule extends BaseModule {
    private searchTaskModel: SearchTaskModel;

    constructor() {
        super();
        this.searchTaskModel = new SearchTaskModel(this.dbpath);
    }

    /**
     * Create a new search task
     * @param enginerId The search engine ID
     * @param num_pages Number of pages to scrape (optional)
     * @param concurrency Number of concurrent requests (optional)
     * @param notShowBrowser Whether to hide browser (optional)
     * @param localBrowser Local browser path (optional)
     * @param accounts Array of account IDs (optional)
     * @returns The ID of the created task
     */
    async createSearchTask(
        enginerId: number,
        num_pages?: number,
        concurrency?: number,
        notShowBrowser?: boolean,
        localBrowser?: string,
        accounts?: Array<number>
    ): Promise<number> {
        return await this.searchTaskModel.saveSearchTask(
            enginerId,
            num_pages,
            concurrency,
            notShowBrowser,
            localBrowser,
            accounts
        );
    }

    /**
     * Get a search task by ID
     * @param id The task ID
     * @returns The search task entity
     */
    async read(id: number): Promise<SearchTaskEntity | null> {
        return await this.searchTaskModel.getTaskEntity(id);
    }

    /**
     * Update task error log
     * @param taskId The task ID
     * @param log The error log content
     */
    async updateTaskLog(taskId: number, log: string): Promise<void> {
        return await this.searchTaskModel.updateTaskLog(taskId, log);
    }

    /**
     * Update task runtime log
     * @param taskId The task ID
     * @param log The runtime log content
     */
    async updateRuntimeLog(taskId: number, log: string): Promise<void> {
        return await this.searchTaskModel.updateRuntimeLog(taskId, log);
    }

    /**
     * Update task status
     * @param taskId The task ID
     * @param status The new status
     */
    async updateTaskStatus(taskId: number, status: SearchTaskStatus): Promise<void> {
        return await this.searchTaskModel.updateTaskStatus(taskId, status);
    }

    /**
     * List tasks with pagination and sorting
     * @param page Page number (offset)
     * @param size Page size (limit)
     * @param sort Sort parameters (optional)
     * @returns Array of search task entities
     */
    async listTasks(page: number, size: number, sort?: SortBy): Promise<SearchtaskdbEntity[]> {
        return await this.searchTaskModel.listTask(page, size, sort);
    }

    /**
     * Get total number of tasks
     * @returns Total count of tasks
     */
    async getTaskTotal(): Promise<number> {
        return await this.searchTaskModel.getTaskTotal();
    }

    /**
     * Convert task status to string
     * @param status The task status enum value
     * @returns String representation of the status
     */
    taskStatusToString(status: SearchTaskStatus): string {
        return this.searchTaskModel.taskStatusToString(status);
    }

    /**
     * Truncate the database table
     */
    async truncateDatabase(): Promise<void> {
        return await this.searchTaskModel.truncatedb();
    }
} 