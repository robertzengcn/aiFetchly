import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { YellowPagesPlatformEntity } from "@/entity/YellowPagesPlatform.entity";
import { SortBy } from "@/entityTypes/commonType";

export type YellowPagesPlatformUpdateFields = {
  display_name?: string;
  base_url?: string;
  country?: string;
  language?: string;
  is_active?: boolean;
  version?: string;
  rate_limit?: number;
  delay_between_requests?: number;
  max_concurrent_requests?: number;
  selectors?: object;
  custom_extractors?: object;
  type?: string;
  class_name?: string;
  module_path?: string;
  settings?: object;
  metadata?: object;
  description?: string;
  maintainer?: string;
  documentation?: string;
}

export class YellowPagesPlatformModel extends BaseDb {
  private repository: Repository<YellowPagesPlatformEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(YellowPagesPlatformEntity);
  }

  /**
   * Save a new yellow pages platform
   * @param platformData The platform data
   * @returns The ID of the created platform
   */
  async saveYellowPagesPlatform(platformData: {
    name: string;
    display_name: string;
    base_url: string;
    country: string;
    language: string;
    is_active?: boolean;
    version?: string;
    rate_limit?: number;
    delay_between_requests?: number;
    max_concurrent_requests?: number;
    selectors?: object;
    custom_extractors?: object;
    type?: string;
    class_name?: string;
    module_path?: string;
    settings?: object;
    metadata?: object;
    description?: string;
    maintainer?: string;
    documentation?: string;
  }): Promise<number> {
    const platformEntity = new YellowPagesPlatformEntity();
    platformEntity.name = platformData.name;
    platformEntity.display_name = platformData.display_name;
    platformEntity.base_url = platformData.base_url;
    platformEntity.country = platformData.country;
    platformEntity.language = platformData.language;
    platformEntity.is_active = platformData.is_active !== undefined ? platformData.is_active : true;
    platformEntity.version = platformData.version || "1.0.0";
    platformEntity.rate_limit = platformData.rate_limit || 100;
    platformEntity.delay_between_requests = platformData.delay_between_requests || 2000;
    platformEntity.max_concurrent_requests = platformData.max_concurrent_requests || 1;
    platformEntity.selectors = platformData.selectors ? JSON.stringify(platformData.selectors) : undefined;
    platformEntity.custom_extractors = platformData.custom_extractors ? JSON.stringify(platformData.custom_extractors) : undefined;
    platformEntity.type = platformData.type || "configuration";
    platformEntity.class_name = platformData.class_name;
    platformEntity.module_path = platformData.module_path;
    platformEntity.settings = platformData.settings ? JSON.stringify(platformData.settings) : undefined;
    platformEntity.metadata = platformData.metadata ? JSON.stringify(platformData.metadata) : undefined;
    platformEntity.description = platformData.description;
    platformEntity.maintainer = platformData.maintainer;
    platformEntity.documentation = platformData.documentation;
    
    const savedPlatform = await this.repository.save(platformEntity);
    return savedPlatform.id;
  }

  /**
   * Get platform by name
   * @param name The platform name
   * @returns The platform entity or null
   */
  async getPlatformByName(name: string): Promise<YellowPagesPlatformEntity | null> {
    return await this.repository.findOne({ where: { name } });
  }

  /**
   * Get platform by ID
   * @param id The platform ID
   * @returns The platform entity or null
   */
  async getPlatformById(id: number): Promise<YellowPagesPlatformEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * List all platforms
   * @param page Page number (1-based)
   * @param size Page size
   * @param sort Sort options
   * @returns Array of platform entities
   */
  async listPlatforms(page: number = 1, size: number = 50, sort?: SortBy): Promise<YellowPagesPlatformEntity[]> {
    const skip = (page - 1) * size;
    const orderBy: any = {};
    
    if (sort) {
      orderBy[sort.key] = sort.order;
    } else {
      orderBy.createdAt = 'DESC';
    }

    return await this.repository.find({
      skip,
      take: size,
      order: orderBy
    });
  }

  /**
   * Get active platforms only
   * @returns Array of active platform entities
   */
  async getActivePlatforms(): Promise<YellowPagesPlatformEntity[]> {
    return await this.repository.find({
      where: { is_active: true },
      order: { display_name: 'ASC' }
    });
  }

  /**
   * Get platforms by type
   * @param type The platform type
   * @returns Array of platform entities
   */
  async getPlatformsByType(type: string): Promise<YellowPagesPlatformEntity[]> {
    return await this.repository.find({
      where: { type },
      order: { display_name: 'ASC' }
    });
  }

  /**
   * Get platforms by country
   * @param country The country
   * @returns Array of platform entities
   */
  async getPlatformsByCountry(country: string): Promise<YellowPagesPlatformEntity[]> {
    return await this.repository.find({
      where: { country },
      order: { display_name: 'ASC' }
    });
  }

  /**
   * Update platform
   * @param platformId The platform ID
   * @param updates The fields to update
   * @returns Success status
   */
  async updatePlatform(platformId: number, updates: YellowPagesPlatformUpdateFields): Promise<boolean> {
    try {
      const updateData: any = { ...updates };
      
      // Handle JSON fields
      if (updates.selectors) {
        updateData.selectors = JSON.stringify(updates.selectors);
      }
      if (updates.custom_extractors) {
        updateData.custom_extractors = JSON.stringify(updates.custom_extractors);
      }
      if (updates.settings) {
        updateData.settings = JSON.stringify(updates.settings);
      }
      if (updates.metadata) {
        updateData.metadata = JSON.stringify(updates.metadata);
      }

      await this.repository.update(
        { id: platformId },
        updateData
      );
      return true;
    } catch (error) {
      console.error('Error updating platform:', error);
      return false;
    }
  }

  /**
   * Delete platform
   * @param platformId The platform ID
   * @returns Success status
   */
  async deletePlatform(platformId: number): Promise<boolean> {
    try {
      await this.repository.delete({ id: platformId });
      return true;
    } catch (error) {
      console.error('Error deleting platform:', error);
      return false;
    }
  }

  /**
   * Activate platform
   * @param platformId The platform ID
   * @returns Success status
   */
  async activatePlatform(platformId: number): Promise<boolean> {
    try {
      await this.repository.update(
        { id: platformId },
        { is_active: true }
      );
      return true;
    } catch (error) {
      console.error('Error activating platform:', error);
      return false;
    }
  }

  /**
   * Deactivate platform
   * @param platformId The platform ID
   * @returns Success status
   */
  async deactivatePlatform(platformId: number): Promise<boolean> {
    try {
      await this.repository.update(
        { id: platformId },
        { is_active: false }
      );
      return true;
    } catch (error) {
      console.error('Error deactivating platform:', error);
      return false;
    }
  }

  /**
   * Get total count of platforms
   * @returns Total number of platforms
   */
  async getPlatformTotal(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Get count of active platforms
   * @returns Number of active platforms
   */
  async getActivePlatformCount(): Promise<number> {
    return await this.repository.count({
      where: { is_active: true }
    });
  }

  /**
   * Check if platform exists
   * @param name The platform name
   * @returns True if platform exists
   */
  async platformExists(name: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { name }
    });
    return count > 0;
  }
} 