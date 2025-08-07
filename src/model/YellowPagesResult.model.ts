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
   * Save a new yellow pages result
   * @param resultData The result data
   * @returns The ID of the created result
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
  }): Promise<number> {
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
    return savedResult.id;
  }

  /**
   * Save multiple results at once
   * @param resultsData Array of result data
   * @returns Array of created result IDs
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
  }>): Promise<number[]> {
    const resultEntities = resultsData.map(data => {
      const resultEntity = new YellowPagesResultEntity();
      resultEntity.task_id = data.task_id;
      resultEntity.business_name = data.business_name;
      resultEntity.email = data.email;
      resultEntity.phone = data.phone;
      resultEntity.website = data.website;
      resultEntity.address_street = data.address?.street;
      resultEntity.address_city = data.address?.city;
      resultEntity.address_state = data.address?.state;
      resultEntity.address_zip = data.address?.zip;
      resultEntity.address_country = data.address?.country;
      resultEntity.social_media = data.social_media ? JSON.stringify(data.social_media) : undefined;
      resultEntity.categories = data.categories ? JSON.stringify(data.categories) : undefined;
      resultEntity.business_hours = data.business_hours ? JSON.stringify(data.business_hours) : undefined;
      resultEntity.description = data.description;
      resultEntity.rating = data.rating;
      resultEntity.review_count = data.review_count;
      resultEntity.scraped_at = new Date();
      resultEntity.platform = data.platform;
      resultEntity.raw_data = data.raw_data ? JSON.stringify(data.raw_data) : undefined;
      resultEntity.fax_number = data.fax_number;
      resultEntity.contact_person = data.contact_person;
      resultEntity.year_established = data.year_established;
      resultEntity.number_of_employees = data.number_of_employees;
      resultEntity.payment_methods = data.payment_methods ? JSON.stringify(data.payment_methods) : undefined;
      resultEntity.specialties = data.specialties ? JSON.stringify(data.specialties) : undefined;
      return resultEntity;
    });

    const savedResults = await this.repository.save(resultEntities);
    return savedResults.map(result => result.id);
  }

  /**
   * Get results by task ID
   * @param taskId The task ID
   * @param page Page number (1-based)
   * @param size Page size
   * @returns Array of result entities
   */
  async getResultsByTaskId(taskId: number, page: number = 1, size: number = 50): Promise<YellowPagesResultEntity[]> {
    const skip = (page - 1) * size;
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
   * @param page Page number (1-based)
   * @param size Page size
   * @param sort Sort options
   * @returns Array of result entities
   */
  async listResults(page: number = 1, size: number = 50, sort?: SortBy): Promise<YellowPagesResultEntity[]> {
    const skip = (page - 1) * size;
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
  async searchByBusinessName(businessName: string, page: number = 1, size: number = 50): Promise<YellowPagesResultEntity[]> {
    const skip = (page - 1) * size;
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
   * @param page Page number (1-based)
   * @param size Page size
   * @returns Array of result entities
   */
  async getResultsByPlatform(platform: string, page: number = 1, size: number = 50): Promise<YellowPagesResultEntity[]> {
    const skip = (page - 1) * size;
    return await this.repository.find({
      where: { platform },
      skip,
      take: size,
      order: { scraped_at: 'DESC' }
    });
  }
} 