import { BaseModule } from "@/modules/baseModule";
import { RAGDocumentModel } from "@/model/RAGDocument.model";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
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
    modelName?: string;
}

export interface DocumentValidationResult {
    isValid: boolean;
    errors: string[];
    fileType?: string;
    fileSize?: number;
}

export class RAGDocumentModule extends BaseModule {
    private ragDocumentModel: RAGDocumentModel;
    private readonly supportedFileTypes = [
        '.txt', '.md', '.pdf', '.doc', '.docx', 
        '.rtf', '.html', '.htm', '.xml', '.json'
    ];
    private readonly maxFileSize = 50 * 1024 * 1024; // 50MB

    constructor() {
        super();
        this.ragDocumentModel = new RAGDocumentModel(this.dbpath);
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
        const documentId = await this.ragDocumentModel.createDocument(document);
        const savedDocument = await this.ragDocumentModel.getDocumentById(documentId);
        
        if (!savedDocument) {
            throw new Error('Failed to retrieve saved document');
        }

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
        const document = await this.ragDocumentModel.getDocumentByPath(filePath);
        return document || null;
    }

    /**
     * Find document by ID
     */
    async findDocumentById(id: number): Promise<RAGDocumentEntity | null> {
        const document = await this.ragDocumentModel.getDocumentById(id);
        return document || null;
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
        return await this.ragDocumentModel.getDocuments(filters);
    }

    /**
     * Update document status
     */
    async updateDocumentStatus(id: number, status: string, processingStatus?: string): Promise<void> {
        const success = await this.ragDocumentModel.updateDocumentStatus(id, status, processingStatus);
        if (!success) {
            throw new Error('Failed to update document status');
        }
    }

    /**
     * Delete document and cleanup
     */
    async deleteDocument(id: number, deleteFile: boolean = false, deleteVectorIndex: boolean = true): Promise<void> {
        const document = await this.ragDocumentModel.getDocumentById(id);

        if (!document) {
            throw new Error('Document not found');
        }

        // Delete vector index if path exists and deletion is requested
        if (deleteVectorIndex && document.vectorIndexPath && fs.existsSync(document.vectorIndexPath)) {
            try {
                fs.unlinkSync(document.vectorIndexPath);
                console.log(`Deleted vector index: ${document.vectorIndexPath}`);
            } catch (error) {
                console.warn(`Failed to delete vector index: ${document.vectorIndexPath}`, error);
            }
        }

        // Delete file if requested
        if (deleteFile && fs.existsSync(document.filePath)) {
            try {
                fs.unlinkSync(document.filePath);
                console.log(`Deleted document file: ${document.filePath}`);
            } catch (error) {
                console.warn(`Failed to delete file: ${document.filePath}`, error);
            }
        }

        // Delete from database (cascade will handle chunks)
        const success = await this.ragDocumentModel.deleteDocument(id);
        if (!success) {
            throw new Error('Failed to delete document from database');
        }
    }

    /**
     * Update document metadata
     */
    async updateDocumentMetadata(id: number, metadata: {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
        vectorIndexPath?: string;
    }): Promise<void> {
        const success = await this.ragDocumentModel.updateDocumentMetadata(id, metadata);
        if (!success) {
            throw new Error('Failed to update document metadata');
        }
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
        return await this.ragDocumentModel.getDocumentStats();
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
