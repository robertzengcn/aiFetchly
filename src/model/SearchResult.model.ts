import { BaseDb } from "@/model/Basedb";
import { Repository, In } from "typeorm";
import { SearchResultEntity } from "@/entity/SearchResult.entity";
import { SearchResEntity } from "@/entityTypes/scrapeType";

export class SearchResultModel extends BaseDb {
    private repository: Repository<SearchResultEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(SearchResultEntity);
    }

    /**
     * Save search result
     * @param data Search result entity data
     * @param taskId The task ID this result belongs to
     */
    async saveResult(data: SearchResEntity, taskId: number): Promise<number> {
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
            record_time: result.record_time
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
            record_time: result.record_time
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
            record_time: result.record_time
        }));
    }

    /**
     * Truncate the database table
     */
    async truncatedb(): Promise<void> {
        await this.repository.clear();
    }
} 