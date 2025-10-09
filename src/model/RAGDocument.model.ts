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

    async getDocumentByPath(filePath: string): Promise<RAGDocumentEntity | undefined> {
        const entity = await this.repository.findOne({ where: { filePath } });
        if (!entity) return undefined;
        return entity;
    }

    async updateDocument(document: RAGDocumentEntity): Promise<boolean> {
        if (!document.id) {
            throw new Error("Document ID is required for update");
        }

        const entity = await this.repository.findOne({ where: { id: document.id } });
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
        entity.uploadedAt = document.uploadedAt;
        entity.processedAt = document.processedAt;
        entity.lastAccessedAt = document.lastAccessedAt;

        const result = await this.repository.save(entity);
        return !!result;
    }

    async updateDocumentStatus(id: number, status: string, processingStatus?: string): Promise<boolean> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return false;

        entity.status = status;
        if (processingStatus) {
            entity.processingStatus = processingStatus;
        }
        if (processingStatus === 'completed') {
            entity.processedAt = new Date();
        }

        const result = await this.repository.save(entity);
        return !!result;
    }

    async updateDocumentMetadata(id: number, metadata: {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
    }): Promise<boolean> {
        const entity = await this.repository.findOne({ where: { id } });
        if (!entity) return false;

        if (metadata.title !== undefined) entity.title = metadata.title;
        if (metadata.description !== undefined) entity.description = metadata.description;
        if (metadata.tags !== undefined) entity.tags = JSON.stringify(metadata.tags);
        if (metadata.author !== undefined) entity.author = metadata.author;

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
        const queryBuilder = this.repository.createQueryBuilder('document');

        if (filters?.status) {
            queryBuilder.andWhere('document.status = :status', { status: filters.status });
        }

        if (filters?.processingStatus) {
            queryBuilder.andWhere('document.processingStatus = :processingStatus', { processingStatus: filters.processingStatus });
        }

        if (filters?.fileType) {
            queryBuilder.andWhere('document.fileType = :fileType', { fileType: filters.fileType });
        }

        if (filters?.name) {
            queryBuilder.andWhere('document.name LIKE :name', { name: `%${filters.name}%` });
        }

        if (filters?.tags && filters.tags.length > 0) {
            queryBuilder.andWhere('document.tags LIKE :tags', { tags: `%${filters.tags.join(',')}%` });
        }

        if (filters?.author) {
            queryBuilder.andWhere('document.author = :author', { author: filters.author });
        }

        if (filters?.limit) {
            queryBuilder.limit(filters.limit);
        }

        if (filters?.offset) {
            queryBuilder.offset(filters.offset);
        }

        queryBuilder.orderBy('document.uploadedAt', 'DESC');

        return await queryBuilder.getMany();
    }

    async getDocumentStats(): Promise<{
        total: number;
        byStatus: Record<string, number>;
        byFileType: Record<string, number>;
        totalSize: number;
    }> {
        const total = await this.repository.count();
        
        const statusStats = await this.repository
            .createQueryBuilder('document')
            .select('document.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('document.status')
            .getRawMany();

        const fileTypeStats = await this.repository
            .createQueryBuilder('document')
            .select('document.fileType', 'fileType')
            .addSelect('COUNT(*)', 'count')
            .groupBy('document.fileType')
            .getRawMany();

        const sizeResult = await this.repository
            .createQueryBuilder('document')
            .select('SUM(document.fileSize)', 'totalSize')
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
            totalSize: parseInt(sizeResult.totalSize) || 0
        };
    }

    async countDocuments(): Promise<number> {
        return this.repository.count();
    }
}
