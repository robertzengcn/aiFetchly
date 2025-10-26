import { BaseModule } from "@/modules/baseModule";
import { RAGDocumentModel } from "@/model/RAGDocument.model";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { WriteLog, getLogPath } from "@/modules/lib/function";
import { app } from 'electron';

export interface DocumentUploadOptions {
    filePath: string;
    name: string;
    title?: string;
    description?: string;
    tags?: string[];
    author?: string;
    // modelName?: string;
    // vectorDimensions?: number;
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
     * Update document metadata including log path
     */
    async updateDocumentMetadata(id: number, metadata: {
        title?: string;
        description?: string;
        tags?: string[];
        author?: string;
        vectorIndexPath?: string;
        modelName?: string;
        vectorDimensions?: number;
        log?: string;
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

    /**
     * Count total documents
     */
    async countDocuments(): Promise<number> {
        return await this.ragDocumentModel.countDocuments();
    }

    /**
     * Get all documents that have embeddings
     */
    async getDocumentsWithEmbeddings(): Promise<Array<{ id: number; vectorIndexPath: string | null }>> {
        return await this.ragDocumentModel.getDocumentsWithEmbeddings();
    }

    /**
     * Save error log to file and update document with log path
     * @param documentId - Document ID to update with error log path
     * @param error - Error object or error message
     * @param context - Additional context about the error
     * @returns Path to the created error log file
     */
    async saveErrorLog(documentId: number, error: Error | string, context?: string): Promise<string> {
        try {
            // Create error log file path
            const errorLogPath = this.createErrorLogPath(documentId);
            
            // Prepare error log content
            const errorContent = this.formatErrorLog(error, context);
            
            // Write error log to file
            WriteLog(errorLogPath, errorContent);
            
            // Update document with error log path
            await this.ragDocumentModel.updateDocumentLogPath(documentId, errorLogPath);
            
            console.log(`Error log saved for document ${documentId}: ${errorLogPath}`);
            return errorLogPath;
        } catch (logError) {
            console.error(`Failed to save error log for document ${documentId}:`, logError);
            throw new Error(`Failed to save error log: ${logError instanceof Error ? logError.message : 'Unknown error'}`);
        }
    }

    /**
     * Create error log file path for a document
     * @param documentId - Document ID
     * @returns Path to the error log file
     */
    private createErrorLogPath(documentId: number): string {
        // Use app data directory for error logs
        const appDataDir = app.getPath('userData');
        const errorLogsDir = path.join(appDataDir, 'error_logs');
        
        // Ensure error logs directory exists
        if (!fs.existsSync(errorLogsDir)) {
            fs.mkdirSync(errorLogsDir, { recursive: true });
        }
        
        // Create unique filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `document_${documentId}_error_${timestamp}.log`;
        
        return path.join(errorLogsDir, fileName);
    }

    /**
     * Format error log content
     * @param error - Error object or error message
     * @param context - Additional context about the error
     * @returns Formatted error log content
     */
    private formatErrorLog(error: Error | string, context?: string): string {
        const timestamp = new Date().toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        let logContent = `[${timestamp}] ERROR OCCURRED\n`;
        logContent += `Error Message: ${errorMessage}\n`;
        
        if (errorStack) {
            logContent += `Stack Trace:\n${errorStack}\n`;
        }
        
        if (context) {
            logContent += `Context: ${context}\n`;
        }
        
        logContent += `---\n`;
        
        return logContent;
    }

    /**
     * Get document error log content
     * @param documentId - Document ID
     * @returns Error log content or null if no log exists
     */
    async getDocumentErrorLog(documentId: number): Promise<string | null> {
        try {
            const document = await this.ragDocumentModel.getDocumentById(documentId);
            if (!document || !document.log) {
                return null;
            }

            // Check if log file exists
            if (!fs.existsSync(document.log)) {
                console.warn(`Error log file not found: ${document.log}`);
                return null;
            }

            // Read log file content
            const logContent = fs.readFileSync(document.log, 'utf-8');
            return logContent;
        } catch (error) {
            console.error(`Failed to read error log for document ${documentId}:`, error);
            return null;
        }
    }
}
