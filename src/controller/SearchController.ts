import { SearchModule } from '@/modules/searchModule';
import { SearchDataParam } from '@/entityTypes/scrapeType';
import { Usersearchdata, SearchtaskItem, SearchtaskEntityNum } from '@/entityTypes/searchControlType';
import { SearchResEntity } from '@/entityTypes/scrapeType';
import { SortBy } from '@/entityTypes/commonType';
import { SearchTaskUpdateData, TaskDetailsForEdit } from '@/modules/searchModule';

/**
 * SearchController - Handles search task management and execution
 * This controller provides a higher-level interface to the SearchModule
 */
export class SearchController {
    private searchModule: SearchModule;

    constructor() {
        this.searchModule = new SearchModule();
    }

    /**
     * Execute a search task by creating it and running it immediately
     * @param data - Search data from frontend
     */
    async searchData(data: Usersearchdata): Promise<void> {
        const searchDataParam: SearchDataParam = {
            engine: data.searchEnginer,
            keywords: data.keywords,
            num_pages: data.num_pages,
            concurrency: data.concurrency,
            notShowBrowser: data.notShowBrowser,
            localBrowser: data.localBrowser,
            proxys: data.proxys,
            accounts: data.accounts,
            cookies: data.cookies
        };
        
        const taskId = await this.searchModule.saveSearchtask(searchDataParam);
        await this.searchModule.runSearchTask(taskId);
    }

    /**
     * List search tasks with pagination
     * @param page - Page number
     * @param size - Page size
     * @param sortBy - Sort options
     * @returns Paginated search tasks
     */
    async listSearchresult(page: number, size: number, sortBy?: SortBy): Promise<SearchtaskEntityNum> {
        return await this.searchModule.listSearchtask(page, size, sortBy);
    }

    /**
     * List search results for a specific task
     * @param taskId - Task ID
     * @param page - Page number
     * @param itemsPerPage - Items per page
     * @returns Search results
     */
    async listtaskSearchResult(taskId: number, page: number, itemsPerPage: number): Promise<SearchResEntity[]> {
        return await this.searchModule.listSearchResult(taskId, page, itemsPerPage);
    }

    /**
     * Get task error log
     * @param taskId - Task ID
     * @returns Error log content
     */
    async getTaskErrorlog(taskId: number): Promise<string> {
        return await this.searchModule.getTaskErrorLog(taskId);
    }

    /**
     * Retry a failed task
     * @param taskId - Task ID to retry
     */
    async retryTask(taskId: number): Promise<void> {
        await this.searchModule.runSearchTask(taskId);
    }

    /**
     * Get task details for editing
     * @param taskId - Task ID
     * @returns Task details
     */
    async getTaskDetailsForEdit(taskId: number): Promise<TaskDetailsForEdit> {
        return await this.searchModule.getTaskDetailsForEdit(taskId);
    }

    /**
     * Update search task
     * @param taskId - Task ID
     * @param updates - Update data
     * @returns Success status
     */
    async updateSearchTask(taskId: number, updates: SearchTaskUpdateData): Promise<boolean> {
        return await this.searchModule.updateSearchTask(taskId, updates);
    }

    /**
     * Create a search task without executing it
     * @param data - Search task data
     * @returns Task ID
     */
    async createTaskOnly(data: SearchDataParam): Promise<number> {
        return await this.searchModule.saveSearchtaskOnly(data);
    }
}