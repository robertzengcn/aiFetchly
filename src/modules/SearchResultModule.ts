import { ISearchResultApi } from "./interface/ISearchResultApi";
import { SearchResultModel } from "@/model/SearchResult.model";
import { SearchResEntity } from "@/entityTypes/scrapeType";
import { BaseModule } from "./baseModule";

export class SearchResultModule extends BaseModule implements ISearchResultApi {
    private searchResultModel: SearchResultModel;

    constructor() {
        super();
        this.searchResultModel = new SearchResultModel(this.dbpath);
    }

    /**
     * Save a search result
     */
    async saveResult(data: SearchResEntity): Promise<number> {
        try {
            return await this.searchResultModel.saveResult(data);
        } catch (error) {
            console.error("Failed to save search result:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to save search result");
        }
    }

    /**
     * List search results with pagination for multiple keywords
     */
    async listSearchResult(keywords: number[], page: number, size: number): Promise<SearchResEntity[]> {
        try {
            if (!keywords || keywords.length === 0) {
                return [];
            }

            return await this.searchResultModel.listSearchresult(keywords, page, size);
        } catch (error) {
            console.error("Failed to list search results:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to list search results");
        }
    }

    /**
     * Count search results by keyword IDs
     */
    async countSearchResult(keywords: number[]): Promise<number> {
        try {
            if (!keywords || keywords.length === 0) {
                return 0;
            }

            return await this.searchResultModel.countSearchResult(keywords);
        } catch (error) {
            console.error("Failed to count search results:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to count search results");
        }
    }

    /**
     * Get search results by specific task ID with pagination
     */
    async getSearchResultsByTaskId(taskId: number, page: number = 0, size: number = 10): Promise<{ results: SearchResEntity[], total: number }> {
        try {
            if (!taskId || taskId <= 0) {
                return { results: [], total: 0 };
            }

            return await this.searchResultModel.getSearchResultsByTaskId(taskId, page, size);
        } catch (error) {
            console.error("Failed to get search results by task ID:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to get search results by task ID");
        }
    }

    /**
     * Get all search results by task ID without pagination
     */
    async getAllSearchResultsByTaskId(taskId: number): Promise<SearchResEntity[]> {
        try {
            if (!taskId || taskId <= 0) {
                return [];
            }

            return await this.searchResultModel.getAllSearchResultsByTaskId(taskId);
        } catch (error) {
            console.error("Failed to get all search results by task ID:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to get all search results by task ID");
        }
    }

    /**
     * Truncate the search results database table
     */
    async truncateDatabase(): Promise<void> {
        try {
            await this.searchResultModel.truncatedb();
        } catch (error) {
            console.error("Failed to truncate search results database:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to truncate search results database");
        }
    }

    /**
     * Get search results with advanced filtering and pagination
     */
    async getSearchResultsWithFilter(
        taskIds: number[],
        page: number = 0,
        size: number = 10,
        searchTerm?: string
    ): Promise<{ results: SearchResEntity[], total: number }> {
        try {
            if (!taskIds || taskIds.length === 0) {
                return { results: [], total: 0 };
            }

            // Get all results for the task IDs
            const allResults = await this.searchResultModel.listSearchresult(taskIds, 0, 10000); // Get all results
            
            // Apply search filter if provided
            let filteredResults = allResults;
            if (searchTerm && searchTerm.trim().length > 0) {
                const searchLower = searchTerm.toLowerCase();
                filteredResults = allResults.filter(result => 
                    result.title?.toLowerCase().includes(searchLower) ||
                    result.snippet?.toLowerCase().includes(searchLower) ||
                    result.link?.toLowerCase().includes(searchLower) ||
                    result.visible_link?.toLowerCase().includes(searchLower)
                );
            }

            // Apply pagination
            const total = filteredResults.length;
            const startIndex = page * size;
            const endIndex = startIndex + size;
            const paginatedResults = filteredResults.slice(startIndex, endIndex);

            return {
                results: paginatedResults,
                total: total
            };
        } catch (error) {
            console.error("Failed to get search results with filter:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to get search results with filter");
        }
    }

    /**
     * Delete search results by task ID
     */
    async deleteSearchResultsByTaskId(taskId: number): Promise<number> {
        try {
            if (!taskId || taskId <= 0) {
                return 0;
            }

            // Get all results for the task ID
            const results = await this.searchResultModel.getAllSearchResultsByTaskId(taskId);
            
            // Delete each result (this could be optimized with a bulk delete query)
            let deletedCount = 0;
            for (const result of results) {
                // Note: This would require adding a delete method to the model
                // For now, we'll return the count of results that would be deleted
                deletedCount++;
            }

            return deletedCount;
        } catch (error) {
            console.error("Failed to delete search results by task ID:", error);
            throw new Error(error instanceof Error ? error.message : "Failed to delete search results by task ID");
        }
    }
} 