import { BaseModule } from "@/modules/baseModule";
import { RAGDocumentModel } from "@/model/RAGDocument.model";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { WriteLog, getLogPath } from "@/modules/lib/function";
import { app } from "electron";
import { VectorStoreService } from "@/service/VectorStoreService";
import { VectorDatabaseType } from "@/modules/factories/VectorDatabaseFactory";
import { RAGChunkModule } from "@/modules/RAGChunkModule";

/** F2 helper — unique stamp used to build staged-upload filenames. */
function validationStamp(): string {
  return `${Date.now()}-${process.pid}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
}

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
    ".txt",
    ".md",
    ".pdf",
    ".doc",
    ".docx",
    ".rtf",
    ".html",
    ".htm",
    ".xml",
    ".json",
    ".csv",
    ".xlsx",
    ".xls",
  ];
  private readonly maxFileSize = 50 * 1024 * 1024; // 50MB

  constructor() {
    super();
    this.ragDocumentModel = new RAGDocumentModel(this.dbpath);
  }

  /**
   * Upload and process a document
   */
  async uploadDocument(
    options: DocumentUploadOptions
  ): Promise<RAGDocumentEntity> {
    // Validate file
    const validation = await this.validateFile(options.filePath);
    if (!validation.isValid) {
      throw new Error(
        `File validation failed: ${validation.errors.join(", ")}`
      );
    }

    // F2 fix — copy the renderer-supplied source file into an app-owned
    // upload directory before indexing. We persist the *staged* path as
    // document.filePath, never the external path. This (a) prevents the
    // RAG pipeline from being abused to read & embed arbitrary local
    // files via known-path attacks and (b) makes deleteDocument safe:
    // the unlink target is always under our own upload root.
    const stagedPath = await this.stageUploadFile(
      options.filePath,
      validation.fileType!
    );

    // Check if file already exists (use the staged path)
    const existingDoc = await this.findDocumentByPath(stagedPath);
    if (existingDoc) {
      throw new Error("Document with this path already exists");
    }

    // Create document entity
    const document = new RAGDocumentEntity();
    document.name = options.name;
    document.filePath = stagedPath;
    document.fileType = validation.fileType!;
    document.fileSize = validation.fileSize!;
    document.title = options.title;
    document.description = options.description;
    document.tags = options.tags ? JSON.stringify(options.tags) : undefined;
    document.author = options.author;
    document.status = "active";
    document.processingStatus = "pending";
    document.uploadedAt = new Date();

    // Save to database
    const documentId = await this.ragDocumentModel.createDocument(document);
    const savedDocument = await this.ragDocumentModel.getDocumentById(
      documentId
    );

    if (!savedDocument) {
      throw new Error("Failed to retrieve saved document");
    }

    return savedDocument;
  }

  /**
   * F2 fix — copy an external renderer-supplied file into the app-owned
   * RAG upload directory and return the staged path. If the source is
   * already under the staging root (idempotent re-upload), it is returned
   * unchanged. The staging root lives under app userData/rag_uploads.
   */
  private async stageUploadFile(
    sourcePath: string,
    fileExt: string
  ): Promise<string> {
    const stagingRoot = this.getUploadStagingDir();
    if (!fs.existsSync(stagingRoot)) {
      fs.mkdirSync(stagingRoot, { recursive: true });
    }

    // If the source is already contained under staging root, no-op.
    const resolvedSource = fs.realpathSync(sourcePath);
    const rel = path.relative(stagingRoot, resolvedSource);
    const alreadyStaged =
      !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "";
    if (alreadyStaged) {
      return resolvedSource;
    }

    // Build a unique destination under the staging root.
    const hash = crypto
      .createHash("sha256")
      .update(`${resolvedSource}:${validationStamp()}`)
      .digest("hex")
      .slice(0, 16);
    const safeName = `${hash}${fileExt}`;
    const destPath = path.join(stagingRoot, safeName);

    fs.copyFileSync(resolvedSource, destPath);
    return destPath;
  }

  /**
   * F2 fix — app-owned upload directory. All indexed documents live here
   * and nowhere else, so deleteDocument can safely unlink any stored path.
   */
  private getUploadStagingDir(): string {
    const stagingRoot = path.join(app.getPath("userData"), "rag_uploads");
    if (!fs.existsSync(stagingRoot)) {
      fs.mkdirSync(stagingRoot, { recursive: true });
    }
    return stagingRoot;
  }

  /**
   * F2/F10 fix — return true iff `target` resolves strictly under the
   * app-owned upload staging directory.
   */
  private isPathUnderUploadStaging(target: string): boolean {
    try {
      const resolved = fs.realpathSync(target);
      const stagingRoot = this.getUploadStagingDir();
      const rel = path.relative(stagingRoot, resolved);
      return !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "";
    } catch {
      return false;
    }
  }

  /**
   * Validate file before processing
   */
  async validateFile(filePath: string): Promise<DocumentValidationResult> {
    const errors: string[] = [];

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        errors.push("File does not exist");
        return { isValid: false, errors };
      }

      // Get file stats
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      const fileExt = path.extname(filePath).toLowerCase();

      // Check file size
      if (fileSize > this.maxFileSize) {
        errors.push(
          `File size (${this.formatFileSize(
            fileSize
          )}) exceeds maximum allowed size (${this.formatFileSize(
            this.maxFileSize
          )})`
        );
      }

      // Check file type
      if (!this.supportedFileTypes.includes(fileExt)) {
        errors.push(
          `Unsupported file type: ${fileExt}. Supported types: ${this.supportedFileTypes.join(
            ", "
          )}`
        );
      }

      return {
        isValid: errors.length === 0,
        errors,
        fileType: fileExt,
        fileSize,
      };
    } catch (error) {
      errors.push(
        `Error validating file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
      lastAccessedAt: stats.atime,
    };

    // Extract title from filename if not provided
    const fileName = path.basename(filePath, fileExt);
    metadata.title = metadata.title || fileName;

    return metadata;
  }

  /**
   * Check for duplicate document by name and file size
   */
  async checkDuplicate(
    name: string,
    fileSize: number
  ): Promise<{ isDuplicate: boolean; existingDocuments: RAGDocumentEntity[] }> {
    const matches = await this.ragDocumentModel.findByNameAndSize(
      name,
      fileSize
    );
    return {
      isDuplicate: matches.length > 0,
      existingDocuments: matches,
    };
  }

  /**
   * Find document by file path
   */
  async findDocumentByPath(
    filePath: string
  ): Promise<RAGDocumentEntity | null> {
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
  async updateDocumentStatus(
    id: number,
    status: string,
    processingStatus?: string
  ): Promise<void> {
    const success = await this.ragDocumentModel.updateDocumentStatus(
      id,
      status,
      processingStatus
    );
    if (!success) {
      throw new Error("Failed to update document status");
    }
  }

  /**
   * Delete document and cleanup
   * @param id - Document ID to delete
   * @param deleteFile - Whether to delete the physical file
   * @param deleteVectorIndex - Whether to delete the vector index
   * @returns Promise that resolves to true if deletion was successful, false otherwise
   */
  async deleteDocument(
    id: number,
    deleteFile = false,
    deleteVectorIndex = true
  ): Promise<boolean> {
    const document = await this.ragDocumentModel.getDocumentById(id);

    if (!document) {
      console.warn(`Document ${id} not found`);
      return false;
    }

    // Delete vectors from vector database if deletion is requested
    if (deleteVectorIndex) {
      try {
        // Get chunks for the document
        const ragChunkModule = new RAGChunkModule();
        const chunks = await ragChunkModule.getDocumentChunks(id);

        if (
          chunks.length > 0 &&
          document.modelName &&
          document.vectorDimensions
        ) {
          // Extract chunk IDs
          const chunkIds = chunks.map((chunk) => chunk.id);
          console.log(
            `Found ${chunkIds.length} chunks for document ${id}, deleting associated vectors...`
          );

          // Create VectorStoreService instance
          const vectorStoreService = new VectorStoreService(
            document.vectorIndexPath,
            VectorDatabaseType.SQLITE_VEC
          );

          // Initialize and load the index
          await vectorStoreService.initialize();

          // Load index with model configuration
          await vectorStoreService.loadIndex({
            name: document.modelName,
            dimensions: document.vectorDimensions,
            documentIndexPath: document.vectorIndexPath,
          });

          // Delete vectors by chunk IDs using VectorStoreService
          await vectorStoreService.deleteVectorsByChunkIds(chunkIds);
          console.log(
            `Deleted ${chunkIds.length} vectors from vector database for document ${id}`
          );
        } else if (
          chunks.length > 0 &&
          (!document.modelName || !document.vectorDimensions)
        ) {
          console.warn(
            `Document ${id} has chunks but missing model information (modelName: ${document.modelName}, vectorDimensions: ${document.vectorDimensions}), skipping vector deletion`
          );
        } else {
          console.log(`Document ${id} has no chunks, skipping vector deletion`);
        }
      } catch (error) {
        console.error(
          `Failed to delete vectors from vector database for document ${id}:`,
          error
        );
        // Don't return false - continue with file and database deletion even if vector deletion fails
      }

      // Delete vector index file if path exists (legacy cleanup)
      if (document.vectorIndexPath && fs.existsSync(document.vectorIndexPath)) {
        try {
          fs.unlinkSync(document.vectorIndexPath);
          console.log(`Deleted vector index file: ${document.vectorIndexPath}`);
        } catch (error) {
          console.warn(
            `Failed to delete vector index file: ${document.vectorIndexPath}`,
            error
          );
        }
      }
    }

    // Delete file if requested
    // F10 fix — only unlink files that live under the app-owned upload
    // staging directory. Because uploadDocument now stages every external
    // path before persisting, document.filePath should always be contained,
    // but older rows (or a tampered DB) might still hold an external path;
    // refuse to unlink anything outside the staging root.
    if (deleteFile && document.filePath) {
      if (this.isPathUnderUploadStaging(document.filePath)) {
        try {
          fs.unlinkSync(document.filePath);
          console.log(`Deleted document file: ${document.filePath}`);
        } catch (error) {
          console.warn(`Failed to delete file: ${document.filePath}`, error);
        }
      } else {
        console.warn(
          `Refusing to delete file outside upload staging directory: ${document.filePath}`
        );
      }
    }

    // Delete from database (cascade will handle chunks)
    const success = await this.ragDocumentModel.deleteDocument(id);
    if (!success) {
      console.error(`Failed to delete document ${id} from database`);
      return false;
    }

    return true;
  }

  /**
   * Update document metadata including log path
   */
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
  ): Promise<void> {
    const success = await this.ragDocumentModel.updateDocumentMetadata(
      id,
      metadata
    );
    if (!success) {
      throw new Error("Failed to update document metadata");
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
    const sizes = ["Bytes", "KB", "MB", "GB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
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
  async getDocumentsWithEmbeddings(): Promise<
    Array<{ id: number; vectorIndexPath: string | null }>
  > {
    return await this.ragDocumentModel.getDocumentsWithEmbeddings();
  }

  /**
   * Save error log to file and update document with log path
   * @param documentId - Document ID to update with error log path
   * @param error - Error object or error message
   * @param context - Additional context about the error
   * @returns Path to the created error log file
   */
  async saveErrorLog(
    documentId: number,
    error: Error | string,
    context?: string
  ): Promise<string> {
    try {
      // Create error log file path
      const errorLogPath = this.createErrorLogPath(documentId);

      // Prepare error log content
      const errorContent = this.formatErrorLog(error, context);

      // Write error log to file
      WriteLog(errorLogPath, errorContent);

      // Update document with error log path
      await this.ragDocumentModel.updateDocumentLogPath(
        documentId,
        errorLogPath
      );

      console.log(
        `Error log saved for document ${documentId}: ${errorLogPath}`
      );
      return errorLogPath;
    } catch (logError) {
      console.error(
        `Failed to save error log for document ${documentId}:`,
        logError
      );
      throw new Error(
        `Failed to save error log: ${
          logError instanceof Error ? logError.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Create error log file path for a document
   * @param documentId - Document ID
   * @returns Path to the error log file
   */
  private createErrorLogPath(documentId: number): string {
    // Use app data directory for error logs
    const appDataDir = app.getPath("userData");
    const errorLogsDir = path.join(appDataDir, "error_logs");

    // Ensure error logs directory exists
    if (!fs.existsSync(errorLogsDir)) {
      fs.mkdirSync(errorLogsDir, { recursive: true });
    }

    // Create unique filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
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

      // F5 fix — defence in depth: even if a stored `log` value was tampered
      // with (or migrated from an older vulnerable build), refuse to read any
      // path that does not resolve strictly under the app's error_logs dir.
      const errorLogsDir = path.join(app.getPath("userData"), "error_logs");
      let resolvedLog: string;
      try {
        resolvedLog = fs.realpathSync(document.log);
      } catch {
        console.warn(`Error log path cannot be resolved: ${document.log}`);
        return null;
      }
      const resolvedDir = fs.realpathSync(errorLogsDir);
      const rel = path.relative(resolvedDir, resolvedLog);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        console.warn(
          `Error log path outside allowed directory; refusing read: ${document.log}`
        );
        return null;
      }

      // Check if log file exists
      if (!fs.existsSync(resolvedLog)) {
        console.warn(`Error log file not found: ${document.log}`);
        return null;
      }

      // Read log file content
      const logContent = fs.readFileSync(resolvedLog, "utf-8");
      return logContent;
    } catch (error) {
      console.error(
        `Failed to read error log for document ${documentId}:`,
        error
      );
      return null;
    }
  }
}
