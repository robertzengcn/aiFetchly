import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm"
import { SearchKeywordEntity } from "@/entity/SearchKeyword.entity"

export class SearchKeywordModel extends BaseDb {
    private repository: Repository<SearchKeywordEntity>

    constructor(filepath: string) {
        super(filepath)
        this.repository = this.sqliteDb.connection.getRepository(SearchKeywordEntity)
    }

    /**
     * Save search keyword
     */
    async saveSearchKeyword(keyword: string, taskId: number): Promise<number> {
        const searchKeyword = new SearchKeywordEntity()
        searchKeyword.keyword = keyword
        searchKeyword.task_id = taskId
        const savedKeyword = await this.repository.save(searchKeyword)
        return savedKeyword.id
    }

    /**
     * Get keyword id by keyword string and task id
     */
    async getKeywordId(keyword: string, taskId: number): Promise<number> {
        const result = await this.repository.findOne({
            where: { keyword, task_id: taskId },
            select: ['id']
        })
        return result?.id || 0
    }

    /**
     * Get keywords by task id
     */
    async getKeywordsByTask(taskId: number): Promise<string[]> {
        const results = await this.repository.find({
            where: { task_id: taskId },
            select: ['keyword']
        })
        return results.map(item => item.keyword)
    }

    /**
     * Get keywords entity by task id
     */
    async getKeywordsEntityByTask(taskId: number): Promise<SearchKeywordEntity[]> {
        return this.repository.find({ where: { task_id: taskId } })
    }

    /**
     * Get keywords entity by keyword id
     */
    async getKeywordsEntityById(keywordId: number): Promise<SearchKeywordEntity | null> {
        return this.repository.findOne({ where: { id: keywordId } })
    }
} 