import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { YellowPagesResultEntity } from "@/entity/YellowPagesResult.entity";
import { SortBy } from "@/entityTypes/commonType";

export class YellowPagesResultModel extends BaseDb {
  private repository: Repository<YellowPagesResultEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(YellowPagesResultEntity);
  }

  /**
   * Check if a result already exists to avoid duplicates
   * @param resultData The result data to check
   * @returns The existing result entity if found, null otherwise
   */
  private async checkForDuplicate(resultData: {
    task_id: number;
    business_name: string;
    email?: string;
    phone?: string;
    website?: string;
  }): Promise<YellowPagesResultEntity | null> {
    // Build query conditions for duplicate detection
    const conditions: any[] = [
      { task_id: resultData.task_id, business_name: resultData.business_name }
    ];

    // Add email-based duplicate check if email exists
    if (resultData.email && resultData.email.trim()) {
      conditions.push({ task_id: resultData.task_id, email: resultData.email.trim() });
    }

    // Add phone-based duplicate check if phone exists
    if (resultData.phone && resultData.phone.trim()) {
      conditions.push({ task_id: resultData.task_id, phone: resultData.phone.trim() });
    }

    // Add website-based duplicate check if website exists
    if (resultData.website && resultData.website.trim()) {
      conditions.push({ task_id: resultData.task_id, website: resultData.website.trim() });
    }

    // Check for duplicates using OR conditions
    const existingResult = await this.repository.findOne({
      where: conditions,
      order: { scraped_at: 'DESC' }
    });

    return existingResult;
  }

  /**
   * Save a new yellow pages result with duplicate detection
   * @param resultData The result data
   * @returns The ID of the created result, or existing result ID if duplicate found
   */
  async saveYellowPagesResult(resultData: {
    task_id: number;
    business_name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    social_media?: string[];
    categories?: string[];
    business_hours?: object;
    description?: string;
    rating?: number;
    review_count?: number;
    platform: string;
    raw_data?: object;
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
  }): Promise<{ id: number; isDuplicate: boolean; existingResult?: YellowPagesResultEntity }> {
    // Check for duplicates first
    const duplicate = await this.checkForDuplicate(resultData);
    
    if (duplicate) {
      return {
        id: duplicate.id,
        isDuplicate: true,
        existingResult: duplicate
      };
    }

    // No duplicate found, create new result
    const resultEntity = new YellowPagesResultEntity();
    resultEntity.task_id = resultData.task_id;
    resultEntity.business_name = resultData.business_name;
    resultEntity.email = resultData.email;
    resultEntity.phone = resultData.phone;
    resultEntity.website = resultData.website;
    resultEntity.address_street = resultData.address?.street;
    resultEntity.address_city = resultData.address?.city;
    resultEntity.address_state = resultData.address?.state;
    resultEntity.address_zip = resultData.address?.zip;
    resultEntity.address_country = resultData.address?.country;
    resultEntity.social_media = resultData.social_media ? JSON.stringify(resultData.social_media) : undefined;
    resultEntity.categories = resultData.categories ? JSON.stringify(resultData.categories) : undefined;
    resultEntity.business_hours = resultData.business_hours ? JSON.stringify(resultData.business_hours) : undefined;
    resultEntity.description = resultData.description;
    resultEntity.rating = resultData.rating;
    resultEntity.review_count = resultData.review_count;
    resultEntity.scraped_at = new Date();
    resultEntity.platform = resultData.platform;
    resultEntity.raw_data = resultData.raw_data ? JSON.stringify(resultData.raw_data) : undefined;
    resultEntity.fax_number = resultData.fax_number;
    resultEntity.contact_person = resultData.contact_person;
    resultEntity.year_established = resultData.year_established;
    resultEntity.number_of_employees = resultData.number_of_employees;
    resultEntity.payment_methods = resultData.payment_methods ? JSON.stringify(resultData.payment_methods) : undefined;
    resultEntity.specialties = resultData.specialties ? JSON.stringify(resultData.specialties) : undefined;
    
    const savedResult = await this.repository.save(resultEntity);
    return {
      id: savedResult.id,
      isDuplicate: false
    };
  }

  /**
   * Save multiple results at once with duplicate detection
   * @param resultsData Array of result data
   * @returns Object with created and duplicate counts
   */
  async saveMultipleResults(resultsData: Array<{
    task_id: number;
    business_name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    social_media?: string[];
    categories?: string[];
    business_hours?: object;
    description?: string;
    rating?: number;
    review_count?: number;
    platform: string;
    raw_data?: object;
    fax_number?: string;
    contact_person?: string;
    year_established?: number;
    number_of_employees?: string;
    payment_methods?: string[];
    specialties?: string[];
  }>): Promise<{ createdIds: number[]; duplicateCount: number; totalProcessed: number }> {
    const createdIds: number[] = [];
    let duplicateCount = 0;

    for (const data of resultsData) {
      const result = await this.saveYellowPagesResult(data);
      if (result.isDuplicate) {
        duplicateCount++;
      } else {
        createdIds.push(result.id);
      }
    }

    return {
      createdIds,
      duplicateCount,
      totalProcessed: resultsData.length
    };
  }

  /**
   * Get results by task ID
   * @param taskId The task ID
   * @param page Page number (1-based)
   * @param size Page size
   * @returns Array of result entities
   */
  async getResultsByTaskId(taskId: number, page: number = 0, size: number = 50): Promise<YellowPagesResultEntity[]> {
    if(page>0){
        page = page - 1;
    }
    const skip =page * size;
    return await this.repository.find({
      where: { task_id: taskId },
      skip,
      take: size,
      order: { scraped_at: 'DESC' }
    });
  }

  /**
   * Get total count of results for a task
   * @param taskId The task ID
   * @returns Total number of results
   */
  async getResultCountByTaskId(taskId: number): Promise<number> {
    return await this.repository.count({
      where: { task_id: taskId }
    });
  }

  /**
   * Get result by ID
   * @param resultId The result ID
   * @returns The result entity or null
   */
  async getResultById(resultId: number): Promise<YellowPagesResultEntity | null> {
    return await this.repository.findOne({ where: { id: resultId } });
  }

  /**
   * List all results with pagination
   * @param page Page number (0-based)
   * @param size Page size
   * @param sort Sort options
   * @returns Array of result entities
   */
  async listResults(page: number = 0, size: number = 50, sort?: SortBy): Promise<YellowPagesResultEntity[]> {
    const skip = page * size;
    const orderBy: any = {};
    
    if (sort) {
      orderBy[sort.key] = sort.order;
    } else {
      orderBy.scraped_at = 'DESC';
    }

    return await this.repository.find({
      skip,
      take: size,
      order: orderBy
    });
  }

  /**
   * Get total count of all results
   * @returns Total number of results
   */
  async getResultTotal(): Promise<number> {
    return await this.repository.count();
  }

  async countByDateRange(startDate: Date, endDate: Date): Promise<number> {
    return this.repository.createQueryBuilder('result')
      .where('result.scraped_at >= :startDate', { startDate: startDate.toISOString() })
      .andWhere('result.scraped_at <= :endDate', { endDate: endDate.toISOString() })
      .getCount();
  }

  async aggregateByDateRange(startDate: Date, endDate: Date, granularity: 'day' | 'week' | 'month'): Promise<Array<{ date: string; count: number }>> {
    const dateExpression = this.getDateExpression(granularity, 'result.scraped_at');
    const rows = await this.repository.createQueryBuilder('result')
      .select(dateExpression, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('result.scraped_at >= :startDate', { startDate: startDate.toISOString() })
      .andWhere('result.scraped_at <= :endDate', { endDate: endDate.toISOString() })
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
   * Delete results by task ID
   * @param taskId The task ID
   * @returns Success status
   */
  async deleteResultsByTaskId(taskId: number): Promise<boolean> {
    try {
      await this.repository.delete({ task_id: taskId });
      return true;
    } catch (error) {
      console.error('Error deleting results:', error);
      return false;
    }
  }

  /**
   * Delete result by ID
   * @param resultId The result ID
   * @returns Success status
   */
  async deleteResult(resultId: number): Promise<boolean> {
    try {
      await this.repository.delete({ id: resultId });
      return true;
    } catch (error) {
      console.error('Error deleting result:', error);
      return false;
    }
  }

  /**
   * Search results by business name
   * @param businessName The business name to search for
   * @param page Page number (1-based)
   * @param size Page size
   * @returns Array of result entities
   */
  async searchByBusinessName(businessName: string, page: number = 0, size: number = 50): Promise<YellowPagesResultEntity[]> {
    const skip = page * size;
    return await this.repository.find({
      where: { business_name: businessName },
      skip,
      take: size,
      order: { scraped_at: 'DESC' }
    });
  }

  /**
   * Get results by platform
   * @param platform The platform name
   * @param page Page number (0-based)
   * @param size Page size
   * @returns Array of result entities
   */
  async getResultsByPlatform(platform: string, page: number = 0, size: number = 50): Promise<YellowPagesResultEntity[]> {
    const skip = page * size;
    return await this.repository.find({
      where: { platform },
      skip,
      take: size,
      order: { scraped_at: 'DESC' }
    });
  }

  /**
   * Find potential duplicates within a task
   * @param taskId The task ID
   * @returns Array of duplicate groups
   */
  async findDuplicatesInTask(taskId: number): Promise<Array<{
    businessName: string;
    phone?: string;
    website?: string;
    count: number;
    results: YellowPagesResultEntity[];
  }>> {
    const results = await this.repository.find({
      where: { task_id: taskId },
      order: { business_name: 'ASC', scraped_at: 'DESC' }
    });

    const duplicateGroups = new Map<string, YellowPagesResultEntity[]>();

    results.forEach(result => {
      // Create a key based on business name, email, phone, and website
      const key = `${result.business_name}|${result.email || ''}|${result.phone || ''}|${result.website || ''}`;
      
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key)!.push(result);
    });

    // Filter only groups with more than one result
    return Array.from(duplicateGroups.entries())
      .filter(([_, results]) => results.length > 1)
      .map(([key, results]) => {
        const [businessName, email, phone, website] = key.split('|');
        return {
          businessName,
          email: email || undefined,
          phone: phone || undefined,
          website: website || undefined,
          count: results.length,
          results
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Remove duplicate results, keeping only the most recent one
   * @param taskId The task ID
   * @returns Number of duplicates removed
   */
  async removeDuplicatesInTask(taskId: number): Promise<number> {
    const duplicates = await this.findDuplicatesInTask(taskId);
    let removedCount = 0;

    for (const group of duplicates) {
      // Keep the most recent result (first in the array due to DESC ordering)
      const toRemove = group.results.slice(1);
      
      for (const duplicate of toRemove) {
        await this.repository.remove(duplicate);
        removedCount++;
      }
    }

    return removedCount;
  }

  /**
   * Get duplicate statistics for a task
   * @param taskId The task ID
   * @returns Duplicate statistics
   */
  async getDuplicateStats(taskId: number): Promise<{
    totalResults: number;
    uniqueResults: number;
    duplicateCount: number;
    duplicateGroups: number;
  }> {
    const totalResults = await this.getResultCountByTaskId(taskId);
    const duplicates = await this.findDuplicatesInTask(taskId);
    
    const duplicateCount = duplicates.reduce((sum, group) => sum + (group.count - 1), 0);
    const uniqueResults = totalResults - duplicateCount;

    return {
      totalResults,
      uniqueResults,
      duplicateCount,
      duplicateGroups: duplicates.length
    };
  }
} 