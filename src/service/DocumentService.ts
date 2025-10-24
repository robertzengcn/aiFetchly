import { RAGDocumentEntity } from '@/entity/RAGDocument.entity';
import { RAGDocumentModule, DocumentUploadOptions, DocumentValidationResult } from '@/modules/RAGDocumentModule';

export class DocumentService {
    private ragDocumentModule: RAGDocumentModule;

    constructor() {
        this.ragDocumentModule = new RAGDocumentModule();
    }

    /**
     * Upload and process a document
     */
    async uploadDocument(options: DocumentUploadOptions): Promise<RAGDocumentEntity> {
        return await this.ragDocumentModule.uploadDocument(options);
    }

    /**
     * Validate file before processing
     */
    async validateFile(filePath: string): Promise<DocumentValidationResult> {
        return await this.ragDocumentModule.validateFile(filePath);
    }

    /**
     * Extract metadata from document
     */
    async extractMetadata(filePath: string): Promise<Partial<RAGDocumentEntity>> {
        return await this.ragDocumentModule.extractMetadata(filePath);
    }

    /**
     * Find document by file path
     */
    async findDocumentByPath(filePath: string): Promise<RAGDocumentEntity | null> {
        return await this.ragDocumentModule.findDocumentByPath(filePath);
    }

    /**
     * Find document by ID
     */
    async findDocumentById(id: number): Promise<RAGDocumentEntity | null> {
        return await this.ragDocumentModule.findDocumentById(id);
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
        return await this.ragDocumentModule.getDocuments(filters);
    }

    /**
     * Update document status
     */
    async updateDocumentStatus(id: number, status: string, processingStatus?: string): Promise<void> {
        return await this.ragDocumentModule.updateDocumentStatus(id, status, processingStatus);
    }

    /**
     * Delete document and cleanup
     */
    async deleteDocument(id: number, deleteFile: boolean = false): Promise<void> {
        return await this.ragDocumentModule.deleteDocument(id, deleteFile);
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
        modelName?: string;
    }): Promise<void> {
        return await this.ragDocumentModule.updateDocumentMetadata(id, metadata);
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
        return await this.ragDocumentModule.getDocumentStats();
    }

}
