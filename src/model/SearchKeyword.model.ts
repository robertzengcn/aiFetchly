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

    /**
     * B03 (FR-02/03/10/24): list every keyword id + text (bounded) for
     * target attribution outside a task scope. Executions without a task
     * linkage can only attribute rows by matching the criterion target
     * against global keyword text — the only linkage available without a
     * row-level execution column. Bounded (never an unbounded table scan).
     */
    async getAllKeywordTexts(limit = 2000): Promise<Array<{ id: number; keyword: string }>> {
        const rows = await this.repository.find({
            select: ['id', 'keyword'],
            take: limit,
        })
        return rows.map((row) => ({ id: row.id, keyword: row.keyword }))
    }

    /**
     * Delete keyword by keyword string and task id
     */
    async deleteKeyword(keyword: string, taskId: number): Promise<boolean> {
        const result = await this.repository.delete({
            keyword,
            task_id: taskId
        })
        return result.affected ? result.affected > 0 : false
    }

    /**
     * Delete keyword by id
     */
    async deleteKeywordById(keywordId: number): Promise<boolean> {
        const result = await this.repository.delete(keywordId)
        return result.affected ? result.affected > 0 : false
    }
} 