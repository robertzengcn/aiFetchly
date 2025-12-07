import { BaseDb } from "@/model/Basedb";
import { Repository, In } from "typeorm";
import { SearchResultEntity } from "@/entity/SearchResult.entity";
import { SearchTaskEntity } from "@/entity/SearchTask.entity";
import { SearchResEntity } from "@/entityTypes/scrapeType";

export class SearchResultModel extends BaseDb {
    private repository: Repository<SearchResultEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SearchResultEntity);
    }

    /**
     * Save search result
     * Checks if link already exists in database - if exists, returns existing item ID
     * If not exists, creates a new record and returns new ID
     * @param data Search result entity data
     * @param taskId The task ID this result belongs to
     * @returns ID of existing or newly created search result
     */
    async saveResult(data: SearchResEntity, taskId: number): Promise<number> {
        // Check if a result with this link already exists
        const existingResult = await this.repository.findOne({
            where: { link: data.link }
        });

        // If link exists, return existing item ID
        if (existingResult) {
            return existingResult.id;
        }

        // If link doesn't exist, create new record
        const resultEntity = new SearchResultEntity();
        resultEntity.task_id = taskId;
        resultEntity.keyword_id = data.keyword_id;
        resultEntity.title = data.title ?? "";
        resultEntity.link = data.link;
        resultEntity.snippet = data.snippet ?? "";
        resultEntity.domain = data.visible_link ?? "";
        resultEntity.record_time = new Date().toISOString();

        const savedResult = await this.repository.save(resultEntity);
        return savedResult.id;
    }

    /**
     * List search results with pagination
     */
    async listSearchresult(keywords: number[], page: number, size: number): Promise<SearchResEntity[]> {
        const results = await this.repository.find({
            where: { keyword_id: In(keywords) },
            skip: page,
            take: size
        });

        return results.map(result => ({
            id: result.id,
            keyword_id: result.keyword_id,
            link: result.link,
            title: result.title,
            snippet: result.snippet,
            visible_link: result.domain,
            record_time: result.record_time,
            ai_industry: result.ai_industry,
            ai_match_score: result.ai_match_score,
            ai_reasoning: result.ai_reasoning,
            ai_client_business: result.ai_client_business,
            ai_analysis_time: result.ai_analysis_time,
            ai_analysis_status: result.ai_analysis_status
        }));
    }

    /**
     * Count search results by keyword ids
     */
    async countSearchResult(keywords: number[]): Promise<number> {
        return await this.repository.count({
            where: { keyword_id: In(keywords) }
        });
    }

    async countAll(): Promise<number> {
        return this.repository.count();
    }

    async countByDateRange(startDate: Date, endDate: Date): Promise<number> {
        return this.repository.createQueryBuilder('result')
            .where('result.record_time >= :startDate', { startDate: startDate.toISOString() })
            .andWhere('result.record_time <= :endDate', { endDate: endDate.toISOString() })
            .getCount();
    }

    async aggregateByDateRange(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<Array<{ date: string; count: number }>> {
        const dateExpression = this.getDateExpression(granularity, 'result.record_time');
        const rows = await this.repository.createQueryBuilder('result')
            .select(dateExpression, 'date')
            .addSelect('COUNT(*)', 'count')
            .where('result.record_time >= :startDate', { startDate: startDate.toISOString() })
            .andWhere('result.record_time <= :endDate', { endDate: endDate.toISOString() })
            .groupBy(dateExpression)
            .orderBy(dateExpression, 'ASC')
            .getRawMany();

        return rows.map((row: { date: string; count: string }) => ({
            date: row.date,
            count: parseInt(row.count, 10)
        }));
    }

    private getDateExpression(granularity: 'day' | 'week' | 'month', column: string): string {
        switch (granularity) {
            case 'week':
                return `STRFTIME('%Y-%W', ${column})`;
            case 'month':
                return `STRFTIME('%Y-%m', ${column})`;
            case 'day':
            default:
                return `DATE(${column})`;
        }
    }

    /**
     * Get search results by specific task ID
     */
    async getSearchResultsByTaskId(taskId: number, page: number = 0, size: number = 10): Promise<{ results: SearchResEntity[], total: number }> {
        // Get total count for pagination
        const total = await this.repository.count({
            where: { task_id: taskId }
        });

        // Get paginated results
        const results = await this.repository.find({
            where: { task_id: taskId },
            skip: page * size,
            take: size,
            order: { record_time: 'DESC' }
        });

        // Convert to SearchResEntity format
        const searchResults: SearchResEntity[] = results.map(result => ({
            id: result.id,
            keyword_id: result.keyword_id,
            link: result.link,
            title: result.title,
            snippet: result.snippet,
            visible_link: result.domain,
            record_time: result.record_time,
            ai_industry: result.ai_industry ?? null,
            ai_match_score: result.ai_match_score ?? null,
            ai_reasoning: result.ai_reasoning ?? null,
            ai_client_business: result.ai_client_business ?? null,
            ai_analysis_time: result.ai_analysis_time ?? null
        }));

        return {
            results: searchResults,
            total: total
        };
    }

    /**
     * Get all search results by task ID without pagination
     */
    async getAllSearchResultsByTaskId(taskId: number): Promise<SearchResEntity[]> {
        const results = await this.repository.find({
            where: { task_id: taskId },
            order: { record_time: 'DESC' }
        });

        return results.map(result => ({
            id: result.id,
            keyword_id: result.keyword_id,
            link: result.link,
            title: result.title,
            snippet: result.snippet,
            visible_link: result.domain,
            record_time: result.record_time,
            ai_industry: result.ai_industry ?? null,
            ai_match_score: result.ai_match_score ?? null,
            ai_reasoning: result.ai_reasoning ?? null,
            ai_client_business: result.ai_client_business ?? null,
            ai_analysis_time: result.ai_analysis_time ?? null
        }));
    }

    /**
     * Get search results breakdown by search engine
     * Joins SearchResult with SearchTask to get engine_id and groups by engine
     * Note: enginer_id is stored as text in SearchTaskEntity, so we parse it after grouping
     * @param startDate Start date for filtering results
     * @param endDate End date for filtering results
     * @returns Array of engine counts with engine_id
     */
    async getBreakdownByEngine(startDate: Date, endDate: Date): Promise<Array<{ engineId: number; count: number }>> {
        // Join SearchResult with SearchTask to get engine information
        // Group by engine_id (stored as text) and count results
        const rows = await this.repository
            .createQueryBuilder('result')
            .innerJoin(SearchTaskEntity, 'task', 'task.id = result.task_id')
            .select('task.enginer_id', 'engineId')
            .addSelect('COUNT(*)', 'count')
            .where('result.record_time >= :startDate', { startDate: startDate.toISOString() })
            .andWhere('result.record_time <= :endDate', { endDate: endDate.toISOString() })
            .andWhere('task.enginer_id IS NOT NULL')
            .andWhere("task.enginer_id != ''")
            .groupBy('task.enginer_id')
            .orderBy('count', 'DESC')
            .getRawMany();

        // Parse engine IDs from text to numbers and filter out invalid values
        return rows.map((row: { engineId: string | number | null; count: string }) => {
            // Parse engine ID - it's stored as text but should be a number
            let engineId: number;
            if (typeof row.engineId === 'string') {
                engineId = parseInt(row.engineId.trim(), 10);
            } else if (typeof row.engineId === 'number') {
                engineId = row.engineId;
            } else {
                return null;
            }

            // Validate engine ID
            if (isNaN(engineId) || engineId <= 0) {
                return null;
            }

            return {
                engineId,
                count: parseInt(row.count, 10)
            };
        }).filter((item): item is { engineId: number; count: number } => item !== null);
    }

    /**
     * Update AI analysis fields for a search result
     * @param resultId The search result ID to update
     * @param analysisData The AI analysis data to save
     * @returns True if update was successful
     */
    async updateAiAnalysis(resultId: number, analysisData: {
        industry: string;
        match_score: number;
        reasoning: string;
        client_business: string;
    }): Promise<boolean> {
        try {
            const result = await this.repository.findOne({
                where: { id: resultId }
            });

            if (!result) {
                throw new Error(`Search result with ID ${resultId} not found`);
            }

            result.ai_industry = analysisData.industry;
            result.ai_match_score = analysisData.match_score;
            result.ai_reasoning = analysisData.reasoning;
            result.ai_client_business = analysisData.client_business;
            result.ai_analysis_time = new Date().toISOString();
            result.ai_analysis_status = 'completed';

            await this.repository.save(result);
            return true;
        } catch (error) {
            console.error('Error updating AI analysis:', error);
            throw error;
        }
    }

    /**
     * Update AI analysis status for a search result
     * @param resultId The search result ID to update
     * @param status The status to set ('pending', 'analyzing', 'completed', 'failed')
     * @returns True if update was successful
     */
    async updateAiAnalysisStatus(resultId: number, status: string): Promise<boolean> {
        try {
            const result = await this.repository.findOne({
                where: { id: resultId }
            });

            if (!result) {
                throw new Error(`Search result with ID ${resultId} not found`);
            }

            result.ai_analysis_status = status;
            await this.repository.save(result);
            return true;
        } catch (error) {
            console.error('Error updating AI analysis status:', error);
            throw error;
        }
    }

    /**
     * Update AI analysis status for multiple search results
     * @param resultIds Array of search result IDs to update
     * @param status The status to set
     * @returns Number of updated records
     */
    async updateAiAnalysisStatusBatch(resultIds: number[], status: string): Promise<number> {
        try {
            if (!resultIds || resultIds.length === 0) {
                return 0;
            }

            const updateResult = await this.repository
                .createQueryBuilder()
                .update(SearchResultEntity)
                .set({ ai_analysis_status: status })
                .where('id IN (:...ids)', { ids: resultIds })
                .execute();

            return updateResult.affected || 0;
        } catch (error) {
            console.error('Error updating AI analysis status batch:', error);
            throw error;
        }
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 