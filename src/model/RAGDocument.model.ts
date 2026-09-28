import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";

export class RAGDocumentModel extends BaseDb {
  private repository: Repository<RAGDocumentEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(RAGDocumentEntity);
  }

  async createDocument(document: RAGDocumentEntity): Promise<number> {
    const savedEntity = await this.repository.save(document);
    return savedEntity.id;
  }

  async getDocumentById(id: number): Promise<RAGDocumentEntity | undefined> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return undefined;
    return entity;
  }

  async getDocumentByPath(
    filePath: string
  ): Promise<RAGDocumentEntity | undefined> {
    const entity = await this.repository.findOne({ where: { filePath } });
    if (!entity) return undefined;
    return entity;
  }

  async findByNameAndSize(
    name: string,
    fileSize: number
  ): Promise<RAGDocumentEntity[]> {
    return await this.repository
      .createQueryBuilder("document")
      .where("document.name = :name", { name })
      .andWhere("document.fileSize = :fileSize", { fileSize })
      .andWhere("document.status != 'deleted'")
      .getMany();
  }

  async updateDocument(document: RAGDocumentEntity): Promise<boolean> {
    if (!document.id) {
      throw new Error("Document ID is required for update");
    }

    const entity = await this.repository.findOne({
      where: { id: document.id },
    });
    if (!entity) return false;

    // Update fields
    entity.name = document.name;
    entity.filePath = document.filePath;
    entity.fileType = document.fileType;
    entity.fileSize = document.fileSize;
    entity.status = document.status;
    entity.processingStatus = document.processingStatus;
    entity.title = document.title;
    entity.description = document.description;
    entity.tags = document.tags;
    entity.author = document.author;
    entity.log = document.log;
    entity.uploadedAt = document.uploadedAt;
    entity.processedAt = document.processedAt;
    entity.lastAccessedAt = document.lastAccessedAt;

    const result = await this.repository.save(entity);
    return !!result;
  }

  async updateDocumentStatus(
    id: number,
    status: string,
    processingStatus?: string
  ): Promise<boolean> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return false;

    entity.status = status;
    if (processingStatus) {
      entity.processingStatus = processingStatus;
    }
    if (processingStatus === "completed") {
      entity.processedAt = new Date();
    }

    const result = await this.repository.save(entity);
    return !!result;
  }

  async updateDocumentMetadata(
    id: number,
    metadata: {
      title?: string;
      description?: string;
      tags?: string[];
      author?: string;
      vectorIndexPath?: string;
      modelName?: string;
      vectorDimensions?: number;
      log?: string;
    }
  ): Promise<boolean> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return false;

    if (metadata.title !== undefined) entity.title = metadata.title;
    if (metadata.description !== undefined)
      entity.description = metadata.description;
    if (metadata.tags !== undefined)
      entity.tags = JSON.stringify(metadata.tags);
    if (metadata.author !== undefined) entity.author = metadata.author;
    if (metadata.vectorIndexPath !== undefined)
      entity.vectorIndexPath = metadata.vectorIndexPath;
    if (metadata.modelName !== undefined) entity.modelName = metadata.modelName;
    if (metadata.vectorDimensions !== undefined)
      entity.vectorDimensions = metadata.vectorDimensions;
    if (metadata.log !== undefined) entity.log = metadata.log;
    const result = await this.repository.save(entity);
    return !!result;
  }

  /**
   * Update document log path
   * @param id - Document ID
   * @param logPath - Path to the error log file
   * @returns Success status
   */
  async updateDocumentLogPath(id: number, logPath: string): Promise<boolean> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return false;

    entity.log = logPath;
    const result = await this.repository.save(entity);
    return !!result;
  }

  async deleteDocument(id: number): Promise<boolean> {
    const result = await this.repository.delete(id);
    return result.affected ? true : false;
  }

  async getDocuments(filters?: {
    status?: string;
    processingStatus?: string;
    fileType?: string;
    name?: string;
    tags?: string[];
    author?: string;
    limit?: number;
    offset?: number;
  }): Promise<RAGDocumentEntity[]> {
    const queryBuilder = this.repository.createQueryBuilder("document");

    if (filters?.status) {
      queryBuilder.andWhere("document.status = :status", {
        status: filters.status,
      });
    }

    if (filters?.processingStatus) {
      queryBuilder.andWhere("document.processingStatus = :processingStatus", {
        processingStatus: filters.processingStatus,
      });
    }

    if (filters?.fileType) {
      queryBuilder.andWhere("document.fileType = :fileType", {
        fileType: filters.fileType,
      });
    }

    if (filters?.name) {
      queryBuilder.andWhere(
        "(document.name LIKE :documentName OR document.title LIKE :documentName)",
        {
          documentName: `%${filters.name}%`,
        }
      );
    }

    if (filters?.tags && filters.tags.length > 0) {
      queryBuilder.andWhere("document.tags LIKE :tags", {
        tags: `%${filters.tags.join(",")}%`,
      });
    }

    if (filters?.author) {
      queryBuilder.andWhere("document.author = :author", {
        author: filters.author,
      });
    }

    if (filters?.limit) {
      queryBuilder.limit(filters.limit);
    }

    if (filters?.offset) {
      queryBuilder.offset(filters.offset);
    }

    queryBuilder.orderBy("document.uploadedAt", "DESC");

    return await queryBuilder.getMany();
  }

  async findSearchableDocumentIds(filters: {
    documentIds?: number[];
    fileTypes?: string[];
    author?: string;
    tags?: string[];
    uploadedFrom?: Date;
    uploadedTo?: Date;
    // Phase 3 filters (optional; omitted when not supplied).
    language?: string;
    documentDateFrom?: Date;
    documentDateTo?: Date;
    // Equality filters for the fixed custom-metadata allowlist. Keys are
    // selected in code (see switch below); values are bound parameters.
    customProduct?: string;
    customCustomer?: string;
    customCampaign?: string;
    customCategory?: string;
  }): Promise<number[]> {
    const queryBuilder = this.repository.createQueryBuilder("document");
    queryBuilder.select("document.id", "id");
    queryBuilder.where("document.status = :status", { status: "active" });
    queryBuilder.andWhere("document.processingStatus = :processingStatus", {
      processingStatus: "completed",
    });
    if (filters.documentIds && filters.documentIds.length > 0) {
      queryBuilder.andWhere("document.id IN (:...filterDocumentIds)", {
        filterDocumentIds: filters.documentIds,
      });
    }
    if (filters.fileTypes && filters.fileTypes.length > 0) {
      queryBuilder.andWhere("document.fileType IN (:...filterFileTypes)", {
        filterFileTypes: filters.fileTypes,
      });
    }
    const authorTrimmed: string = (filters.author ?? "").trim();
    if (authorTrimmed.length > 0) {
      const escaped: string = authorTrimmed.replace(/[\\%_]/g, (m: string) => `\\${m}`);
      queryBuilder.andWhere(
        "LOWER(document.author) LIKE :filterAuthor ESCAPE '\\'",
        { filterAuthor: `%${escaped.toLowerCase()}%` }
      );
    }
    const tags: string[] = (filters.tags ?? [])
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);
    if (tags.length > 0) {
      const tagClauses: string[] = [];
      const params: Record<string, string> = {};
      tags.forEach((tag: string, index: number) => {
        const escaped: string = tag
          .replace(/[\\%_"]/g, (m: string) => `\\${m}`)
          .toLowerCase();
        tagClauses.push(`LOWER(document.tags) LIKE :filterTag${index} ESCAPE '\\'`);
        params[`filterTag${index}`] = `%"${escaped}"%`;
      });
      queryBuilder.andWhere(`(${tagClauses.join(" OR ")})`, params);
    }
    if (filters.uploadedFrom) {
      queryBuilder.andWhere("document.uploadedAt >= :uploadedFrom", {
        uploadedFrom: filters.uploadedFrom,
      });
    }
    if (filters.uploadedTo) {
      queryBuilder.andWhere("document.uploadedAt <= :uploadedTo", {
        uploadedTo: filters.uploadedTo,
      });
    }
    // Phase 3: language exact match (case-insensitive on the stored value).
    const languageTrimmed: string = (filters.language ?? "").trim();
    if (languageTrimmed.length > 0) {
      queryBuilder.andWhere("LOWER(document.language) = :filterLanguage", {
        filterLanguage: languageTrimmed.toLowerCase(),
      });
    }
    // Phase 3: documentDate range. NULL dates are excluded by a range filter.
    if (filters.documentDateFrom) {
      queryBuilder.andWhere("document.documentDate >= :documentDateFrom", {
        documentDateFrom: filters.documentDateFrom,
      });
    }
    if (filters.documentDateTo) {
      queryBuilder.andWhere("document.documentDate <= :documentDateTo", {
        documentDateTo: filters.documentDateTo,
      });
    }
    // Phase 3: custom-metadata equality filters. The allowlist is a fixed set
    // of keys; select each in code with a switch and bind the value as a
    // quoted-token LIKE against the JSON text (technical design §6.3). Do
    // NOT concatenate user keys into SQL identifiers. product = "Acme"
    // matches "product":"Acme" and not a longer value because the closing
    // quote bounds the token.
    type CustomKey = "product" | "customer" | "campaign" | "category";
    const customEntries: Array<{ key: CustomKey; value: string }> = [];
    if (filters.customProduct !== undefined)
      customEntries.push({ key: "product", value: filters.customProduct });
    if (filters.customCustomer !== undefined)
      customEntries.push({ key: "customer", value: filters.customCustomer });
    if (filters.customCampaign !== undefined)
      customEntries.push({ key: "campaign", value: filters.customCampaign });
    if (filters.customCategory !== undefined)
      customEntries.push({ key: "category", value: filters.customCategory });
    for (const { key, value } of customEntries) {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        continue;
      }
      // Escape SQL LIKE wildcards and the bounding double-quote, then build a
      // JSON-token pattern: "key":"value" (whitespace-tolerant around the
      // colon via optional spaces). The bound parameter carries the pattern;
      // the column name is fixed by the switch, never user input.
      const escapedValue = trimmed
        .replace(/[\\%_"]/g, (m: string) => `\\${m}`)
        .toLowerCase();
      let jsonColumn: string;
      let paramBase: string;
      switch (key) {
        case "product":
          jsonColumn = "document.customMetadata";
          paramBase = "filterCustomProduct";
          break;
        case "customer":
          jsonColumn = "document.customMetadata";
          paramBase = "filterCustomCustomer";
          break;
        case "campaign":
          jsonColumn = "document.customMetadata";
          paramBase = "filterCustomCampaign";
          break;
        case "category":
          jsonColumn = "document.customMetadata";
          paramBase = "filterCustomCategory";
          break;
      }
      const pattern = `%"${key}":%"${escapedValue}"%`;
      queryBuilder.andWhere(
        `LOWER(${jsonColumn}) LIKE :${paramBase} ESCAPE '\\'`,
        { [paramBase]: pattern }
      );
    }
    const rows: Array<{ id: number }> = await queryBuilder.getRawMany();
    return rows.map((r: { id: number }) => r.id);
  }

  async getDocumentStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byFileType: Record<string, number>;
    totalSize: number;
  }> {
    const total = await this.repository.count();

    const statusStats = await this.repository
      .createQueryBuilder("document")
      .select("document.status", "status")
      .addSelect("COUNT(*)", "count")
      .groupBy("document.status")
      .getRawMany();

    const fileTypeStats = await this.repository
      .createQueryBuilder("document")
      .select("document.fileType", "fileType")
      .addSelect("COUNT(*)", "count")
      .groupBy("document.fileType")
      .getRawMany();

    const sizeResult = await this.repository
      .createQueryBuilder("document")
      .select("SUM(document.fileSize)", "totalSize")
      .getRawOne();

    return {
      total,
      byStatus: statusStats.reduce((acc, item) => {
        acc[item.status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      byFileType: fileTypeStats.reduce((acc, item) => {
        acc[item.fileType] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>),
      totalSize: parseInt(sizeResult.totalSize) || 0,
    };
  }

  async countDocuments(): Promise<number> {
    return this.repository.count();
  }

  /**
   * Get all documents that have embeddings
   */
  async getDocumentsWithEmbeddings(): Promise<
    Array<{ id: number; vectorIndexPath: string | null }>
  > {
    const documents = await this.repository
      .createQueryBuilder("d")
      .select("DISTINCT d.id, d.vectorIndexPath")
      .innerJoin("d.chunks", "c")
      // .where('c.embeddingId IS NOT NULL')
      // .andWhere("c.embeddingId != ''")
      .andWhere("d.status = :status", { status: "active" })
      .getRawMany();

    interface RawDocumentRow {
      id: number;
      vectorIndexPath: string | null;
    }

    return documents.map((row: RawDocumentRow) => ({
      id: row.id,
      vectorIndexPath: row.vectorIndexPath,
    }));
  }

  // -------------------------------------------------------------------------
  // Website import provenance lookups (URL/hash-based duplicate detection)
  // -------------------------------------------------------------------------

  /**
   * First successfully indexed (completed) non-deleted document whose
   * canonical URL hash matches. Failed/pending prior imports must not block
   * re-import under duplicatePolicy=fail.
   */
  async findActiveByCanonicalUrlSha256(
    canonicalUrlSha256: string
  ): Promise<RAGDocumentEntity | undefined> {
    const doc = await this.repository
      .createQueryBuilder("document")
      .where("document.canonicalUrlSha256 = :canonicalUrlSha256", {
        canonicalUrlSha256,
      })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .andWhere("document.processingStatus = :completed", {
        completed: "completed",
      })
      .getOne();
    return doc ?? undefined;
  }

  /**
   * First successfully indexed (completed) non-deleted document whose source
   * URL hash matches.
   */
  async findActiveBySourceUrlSha256(
    sourceUrlSha256: string
  ): Promise<RAGDocumentEntity | undefined> {
    const doc = await this.repository
      .createQueryBuilder("document")
      .where("document.sourceUrlSha256 = :sourceUrlSha256", {
        sourceUrlSha256,
      })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .andWhere("document.processingStatus = :completed", {
        completed: "completed",
      })
      .getOne();
    return doc ?? undefined;
  }

  /**
   * First non-deleted, non-completed document for a website URL hash.
   * Used to clean up failed/pending stubs before a re-import.
   */
  async findIncompleteByCanonicalUrlSha256(
    canonicalUrlSha256: string
  ): Promise<RAGDocumentEntity | undefined> {
    const doc = await this.repository
      .createQueryBuilder("document")
      .where("document.canonicalUrlSha256 = :canonicalUrlSha256", {
        canonicalUrlSha256,
      })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .andWhere("document.processingStatus != :completed", {
        completed: "completed",
      })
      .getOne();
    return doc ?? undefined;
  }

  /** First non-deleted, non-completed document for a source URL hash. */
  async findIncompleteBySourceUrlSha256(
    sourceUrlSha256: string
  ): Promise<RAGDocumentEntity | undefined> {
    const doc = await this.repository
      .createQueryBuilder("document")
      .where("document.sourceUrlSha256 = :sourceUrlSha256", {
        sourceUrlSha256,
      })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .andWhere("document.processingStatus != :completed", {
        completed: "completed",
      })
      .getOne();
    return doc ?? undefined;
  }

  /** All non-deleted documents sharing a content body hash. */
  async findActiveByContentSha256(
    contentSha256: string
  ): Promise<RAGDocumentEntity[]> {
    return await this.repository
      .createQueryBuilder("document")
      .where("document.contentSha256 = :contentSha256", { contentSha256 })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .getMany();
  }

  /** All non-deleted documents belonging to one website import group. */
  async getDocumentsByImportGroup(
    importGroupId: string
  ): Promise<RAGDocumentEntity[]> {
    return await this.repository
      .createQueryBuilder("document")
      .where("document.importGroupId = :importGroupId", { importGroupId })
      .andWhere("document.status != :deleted", { deleted: "deleted" })
      .orderBy("document.uploadedAt", "ASC")
      .getMany();
  }
}
