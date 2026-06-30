import { BaseModule } from "./baseModule";
import { SearchResultModel } from "@/model/SearchResult.model";
import { contactInfoRepository } from "@/model/ContactInfo.model";
import { ContactInfoEntity } from "@/entity/ContactInfo.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { contactInfoWriteSchema } from "@/schemas/entity/contactInfo";

/**
 * Result data for contact extraction
 */
export interface SearchResultData {
  id: number;
  url: string;
  title: string;
}

/**
 * Contact extraction result
 */
export interface ContactExtractionResult {
  resultId: number;
  email?: string;
  phone?: string;
  address?: string;
  socialLinks?: string[];
  extractionStatus?: string;
  extractionError?: string;
  extractionDate?: string;
}

/**
 * Contact Info Module
 * Handles business logic for contact information extraction and management
 */
export class ContactInfoModule extends BaseModule {
  /**
   * Get search results by IDs
   * @param resultIds Array of search result IDs
   * @returns Array of search result data
   */
  async getSearchResults(resultIds: number[]): Promise<SearchResultData[]> {
    await this.ensureConnection();

    const searchResultModel = new SearchResultModel(this.dbpath);
    const results = await searchResultModel.getSearchResultsByIds(resultIds);

    return results
      .filter((r) => r.id !== undefined && r.link)
      .map((r) => ({
        id: r.id!,
        url: r.link,
        title: r.title || "",
      }));
  }

  /**
   * Get contact info by result IDs
   * @param resultIds Array of result IDs
   * @returns Array of contact extraction results
   */
  async getContactInfoByResultIds(
    resultIds: number[]
  ): Promise<ContactExtractionResult[]> {
    await this.ensureConnection();

    const contactInfoList = await contactInfoRepository.findByResultIds(
      resultIds
    );

    return contactInfoList.map((ci) => ({
      resultId: ci.resultId,
      email: ci.email || undefined,
      phone: ci.phone || undefined,
      address: ci.address || undefined,
      socialLinks: ci.socialLinks || undefined,
      extractionStatus: ci.extractionStatus,
      extractionError: ci.extractionError || undefined,
      extractionDate: ci.extractionDate?.toISOString(),
    }));
  }

  /**
   * Create pending contact info records for results
   * @param resultIds Array of result IDs
   */
  async createPendingContactInfo(resultIds: number[]): Promise<void> {
    await this.ensureConnection();

    for (const resultId of resultIds) {
      const existing = await contactInfoRepository.findByResultId(resultId);
      if (!existing) {
        await contactInfoRepository.saveOrUpdate(resultId, {
          extractionStatus: "pending",
        });
      }
    }
  }

  /**
   * Reset contact info for retry
   * @param resultIds Array of result IDs to reset
   */
  async resetContactInfoForRetry(resultIds: number[]): Promise<void> {
    await this.ensureConnection();

    for (const resultId of resultIds) {
      // Delete existing contact info
      await contactInfoRepository.deleteByResultId(resultId);

      // Create new pending record
      await contactInfoRepository.saveOrUpdate(resultId, {
        extractionStatus: "pending",
      });
    }
  }

  /**
   * Save contact info extraction result.
   *
   * Phase 5: parseAndStrip filters unknown fields before persistence.
   * Worker output shape is fluid (may include temporary metadata fields
   * like 'debugSource', 'htmlSnippet' etc.); without stripping, those
   * would attempt to write into TypeORM columns that don't exist and
   * cause silent query failures or, worse, get accepted if a column
   * with a matching name ever appears.
   */
  async saveContactExtractionResult(
    resultId: number,
    data: Partial<ContactInfoEntity>
  ): Promise<void> {
    await this.ensureConnection();

    const stripped = parseAndStrip(data, contactInfoWriteSchema());
    await contactInfoRepository.saveOrUpdate(resultId, {
      ...stripped,
      extractionDate: new Date(),
    });
  }

  /**
   * Update extraction status
   * @param resultId The result ID
   * @param status The new status
   * @param error Optional error message
   */
  async updateExtractionStatus(
    resultId: number,
    status: "pending" | "analyzing" | "completed" | "failed",
    error?: string
  ): Promise<void> {
    await this.ensureConnection();

    await contactInfoRepository.updateStatus(resultId, status, error);
  }

  /**
   * Batch update extraction status
   * @param resultIds Array of result IDs
   * @param status The new status
   */
  async batchUpdateExtractionStatus(
    resultIds: number[],
    status: string
  ): Promise<void> {
    await this.ensureConnection();

    for (const resultId of resultIds) {
      await contactInfoRepository.updateStatus(resultId, status as any);
    }
  }

  /**
   * Get contact extraction statistics
   * @returns Statistics object with counts by status
   */
  async getStatistics(): Promise<{
    total: number;
    completed: number;
    failed: number;
    pending: number;
    analyzing: number;
  }> {
    await this.ensureConnection();

    return await contactInfoRepository.getStatistics();
  }
}
