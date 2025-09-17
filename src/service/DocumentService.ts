import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { SqliteDb } from '@/config/SqliteDb';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface DocumentUploadOptions {
    filePath: string;
    name: string;
    title?: string;
    description?: string;
    tags?: string[];
    author?: string;
}

export interface DocumentValidationResult {
    isValid: boolean;
    errors: string[];
    fileType?: string;
    fileSize?: number;
}

export class DocumentService {
    private db: SqliteDb;
    private readonly supportedFileTypes = [
        '.txt', '.md', '.pdf', '.doc', '.docx', 
        '.rtf', '.html', '.htm', '.xml', '.json'
    ];
    private readonly maxFileSize = 50 * 1024 * 1024; // 50MB

    constructor(db: SqliteDb) {
        this.db = db;
    }

    /**
     * Upload and process a document
     */
    async uploadDocument(options: DocumentUploadOptions): Promise<RAGDocumentEntity> {
        // Validate file
        const validation = await this.validateFile(options.filePath);
        if (!validation.isValid) {
            throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
        }

        // Check if file already exists
        const existingDoc = await this.findDocumentByPath(options.filePath);
        if (existingDoc) {
            throw new Error('Document with this path already exists');
        }

        // Create document entity
        const document = new RAGDocumentEntity();
        document.name = options.name;
        document.filePath = options.filePath;
        document.fileType = validation.fileType!;
        document.fileSize = validation.fileSize!;
        document.title = options.title;
        document.description = options.description;
        document.tags = options.tags ? JSON.stringify(options.tags) : undefined;
        document.author = options.author;
        document.status = 'active';
        document.processingStatus = 'pending';
        document.uploadedAt = new Date();

        // Save to database
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        const savedDocument = await repository.save(document);

        return savedDocument;
    }

    /**
     * Validate file before processing
     */
    async validateFile(filePath: string): Promise<DocumentValidationResult> {
        const errors: string[] = [];

        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                errors.push('File does not exist');
                return { isValid: false, errors };
            }

            // Get file stats
            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            const fileExt = path.extname(filePath).toLowerCase();

            // Check file size
            if (fileSize > this.maxFileSize) {
                errors.push(`File size (${this.formatFileSize(fileSize)}) exceeds maximum allowed size (${this.formatFileSize(this.maxFileSize)})`);
            }

            // Check file type
            if (!this.supportedFileTypes.includes(fileExt)) {
                errors.push(`Unsupported file type: ${fileExt}. Supported types: ${this.supportedFileTypes.join(', ')}`);
            }

            return {
                isValid: errors.length === 0,
                errors,
                fileType: fileExt,
                fileSize
            };
        } catch (error) {
            errors.push(`Error validating file: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { isValid: false, errors };
        }
    }

    /**
     * Extract metadata from document
     */
    async extractMetadata(filePath: string): Promise<Partial<RAGDocumentEntity>> {
        const stats = fs.statSync(filePath);
        const fileExt = path.extname(filePath).toLowerCase();
        
        const metadata: Partial<RAGDocumentEntity> = {
            fileType: fileExt,
            fileSize: stats.size,
            uploadedAt: stats.birthtime,
            lastAccessedAt: stats.atime
        };

        // Extract title from filename if not provided
        const fileName = path.basename(filePath, fileExt);
        metadata.title = metadata.title || fileName;

        return metadata;
    }

    /**
     * Find document by file path
     */
    async findDocumentByPath(filePath: string): Promise<RAGDocumentEntity | null> {
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        return await repository.findOne({ where: { filePath } });
    }

    /**
     * Find document by ID
     */
    async findDocumentById(id: number): Promise<RAGDocumentEntity | null> {
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        return await repository.findOne({ where: { id: id } });
    }

    /**
     * Get all documents with optional filtering
     */
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
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        const queryBuilder = repository.createQueryBuilder('document');

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

    /**
     * Update document status
     */
    async updateDocumentStatus(id: number, status: string, processingStatus?: string): Promise<void> {
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        const updateData: Partial<RAGDocumentEntity> = { status };

        if (processingStatus) {
            updateData.processingStatus = processingStatus;
        }

        if (processingStatus === 'completed') {
            updateData.processedAt = new Date();
        }

        await repository.update({ id: id }, updateData);
    }

    /**
     * Delete document and cleanup
     */
    async deleteDocument(id: number, deleteFile: boolean = false): Promise<void> {
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        const document = await repository.findOne({ where: { id: id } });

        if (!document) {
            throw new Error('Document not found');
        }

        // Delete file if requested
        if (deleteFile && fs.existsSync(document.filePath)) {
            try {
                fs.unlinkSync(document.filePath);
            } catch (error) {
                console.warn(`Failed to delete file: ${document.filePath}`, error);
            }
        }

        // Delete from database (cascade will handle chunks)
        await repository.delete({ id: id });
    }

    /**
     * Update document metadata
     */
    async updateDocumentMetadata(id: number, metadata: {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
    }): Promise<void> {
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        const updateData: Partial<RAGDocumentEntity> = {};

        if (metadata.title !== undefined) updateData.title = metadata.title;
        if (metadata.description !== undefined) updateData.description = metadata.description;
        if (metadata.tags !== undefined) updateData.tags = JSON.stringify(metadata.tags);
        if (metadata.author !== undefined) updateData.author = metadata.author;

        await repository.update({ id: id }, updateData);
    }

    /**
     * Get document statistics
     */
    async getDocumentStats(): Promise<{
        total: number;
        byStatus: Record<string, number>;
        byFileType: Record<string, number>;
        totalSize: number;
    }> {
        const repository = this.db.connection.getRepository(RAGDocumentEntity);
        
        const total = await repository.count();
        
        const statusStats = await repository
            .createQueryBuilder('document')
            .select('document.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('document.status')
            .getRawMany();

        const fileTypeStats = await repository
            .createQueryBuilder('document')
            .select('document.fileType', 'fileType')
            .addSelect('COUNT(*)', 'count')
            .groupBy('document.fileType')
            .getRawMany();

        const sizeResult = await repository
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

    /**
     * Format file size for display
     */
    private formatFileSize(bytes: number): string {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Generate content hash for deduplication
     */
    private generateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
}
