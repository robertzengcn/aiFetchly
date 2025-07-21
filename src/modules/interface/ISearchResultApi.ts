import { SearchResEntity } from "@/entityTypes/scrapeType";

export interface ISearchResultApi {
  /**
   * Save a search result
   * @param data - Search result data to save
   * @returns Promise<number> - ID of the saved search result
   */
  saveResult(data: SearchResEntity): Promise<number>;

  /**
   * List search results with pagination for multiple keywords
   * @param keywords - Array of keyword IDs
   * @param page - Page number for pagination
   * @param size - Number of items per page
   * @returns Promise<SearchResEntity[]> - Array of search results
   */
  listSearchResult(keywords: number[], page: number, size: number): Promise<SearchResEntity[]>;

  /**
   * Count search results by keyword IDs
   * @param keywords - Array of keyword IDs
   * @returns Promise<number> - Total count of search results
   */
  countSearchResult(keywords: number[]): Promise<number>;

  /**
   * Get search results by specific task ID with pagination
   * @param taskId - Task ID to search for
   * @param page - Page number for pagination (default: 0)
   * @param size - Number of items per page (default: 10)
   * @returns Promise<{ results: SearchResEntity[], total: number }> - Paginated results with total count
   */
  getSearchResultsByTaskId(taskId: number, page?: number, size?: number): Promise<{ results: SearchResEntity[], total: number }>;

  /**
   * Get all search results by task ID without pagination
   * @param taskId - Task ID to search for
   * @returns Promise<SearchResEntity[]> - All search results for the task
   */
  getAllSearchResultsByTaskId(taskId: number): Promise<SearchResEntity[]>;

  /**
   * Truncate the search results database table
   * @returns Promise<void>
   */
  truncateDatabase(): Promise<void>;
} 