import * as fs from 'fs';
import * as path from 'path';
import { IVectorDatabase } from '@/modules/interface/IVectorDatabase';
// import { FaissVectorDatabase } from '@/modules/adapters/FaissVectorDatabase';
import { SqliteVecDatabase } from '@/modules/adapters/SqliteVecDatabase';
import { VectorDatabaseFactory, VectorDatabaseType } from '@/modules/factories/VectorDatabaseFactory';
import { RAGChunkModule } from '@/modules/RAGChunkModule';
import { RAGChunkEntity } from '@/entity/RAGChunk.entity';
import { VectorDatabaseConfig } from '@/modules/interface/IVectorDatabase';
import { RagConfigApi } from '@/api/ragConfigApi';

/**
 * Migration progress callback type
 */
export type MigrationProgressCallback = (progress: {
    current: number;
    total: number;
    message: string;
    percentage: number;
}) => void;

/**
 * Migration result interface
 */
export interface MigrationResult {
    success: boolean;
    documentsProcessed: number;
    chunksMigrated: number;
    errors: string[];
    warnings: string[];
    backupPath?: string;
    duration: number;
}

/**
 * Vector database migrator for migrating from FAISS to SQLite-vec
 * 
 * Note: FAISS doesn't support extracting stored vectors, so this migration
 * re-generates embeddings from chunk content stored in the database.
 */
export class VectorDatabaseMigrator {
    private ragChunkModule: RAGChunkModule;
    private ragConfigApi: RagConfigApi;
    private baseIndexPath: string;
    private onProgress?: MigrationProgressCallback;

    constructor(baseIndexPath?: string, onProgress?: MigrationProgressCallback) {
        this.ragChunkModule = new RAGChunkModule();
        this.ragConfigApi = new RagConfigApi();
        this.baseIndexPath = baseIndexPath || path.join(process.cwd(), 'data', 'vector_index');
        this.onProgress = onProgress;
    }

    /**
     * Report migration progress
     */
    private reportProgress(current: number, total: number, message: string): void {
        if (this.onProgress) {
            this.onProgress({
                current,
                total,
                message,
                percentage: total > 0 ? Math.round((current / total) * 100) : 0
            });
        }
    }

    /**
     * Detect existing FAISS indices by scanning for .index files
     * Note: This doesn't load FAISS indices, just detects their presence
     */
    async detectFaissIndices(): Promise<Array<{
        indexPath: string;
        documentId?: number;
        modelName?: string;
        dimensions?: number;
    }>> {
        const indices: Array<{
            indexPath: string;
            documentId?: number;
            modelName?: string;
            dimensions?: number;
        }> = [];

        try {
            // Check base index path for FAISS indices
            if (!fs.existsSync(this.baseIndexPath)) {
                return indices;
            }

            // Look for .index files (FAISS index files)
            const findIndexFiles = (dir: string): string[] => {
                const files: string[] = [];
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            files.push(...findIndexFiles(fullPath));
                        } else if (entry.isFile() && entry.name.endsWith('.index')) {
                            files.push(fullPath);
                        }
                    }
                } catch (error) {
                    console.warn(`Error scanning directory ${dir}:`, error);
                }
                return files;
            };

            const indexFiles = findIndexFiles(this.baseIndexPath);

            // Parse index file paths to extract document/model information
            for (const indexPath of indexFiles) {
                // Try to extract document ID and model info from path
                // Example: vector_indices/document_123/model_456/index.index
                const pathParts = indexPath.replace(this.baseIndexPath, '').split(path.sep).filter(p => p);
                
                let documentId: number | undefined;
                let modelName: string | undefined;
                
                for (const part of pathParts) {
                    if (part.startsWith('document_')) {
                        documentId = parseInt(part.replace('document_', ''), 10);
                    } else if (part.startsWith('model_')) {
                        modelName = part.replace('model_', '');
                    }
                }

                // Dimensions will be determined from chunks during migration
                indices.push({
                    indexPath,
                    documentId,
                    modelName,
                    dimensions: undefined
                });
            }
        } catch (error) {
            console.error('Error detecting FAISS indices:', error);
        }

        return indices;
    }

    /**
     * Migrate a single document from FAISS to SQLite-vec
     */
    async migrateDocument(
        documentId: number,
        modelName: string,
        dimensions: number,
        backupPath?: string
    ): Promise<{
        success: boolean;
        chunksMigrated: number;
        errors: string[];
    }> {
        const errors: string[] = [];
        let chunksMigrated = 0;

        try {
            // Get all chunks for the document
            const chunks = await this.ragChunkModule.getDocumentChunks(documentId);
            
            if (chunks.length === 0) {
                return {
                    success: true,
                    chunksMigrated: 0,
                    errors: []
                };
            }

            // Create SQLite-vec database instance
            const sqliteDb = new SqliteVecDatabase(this.baseIndexPath);
            await sqliteDb.initialize();

            // Generate document-specific index path (SqliteVecDatabase will regenerate it, but interface requires indexPath)
            const baseDir = path.dirname(this.baseIndexPath || path.join(process.cwd(), 'data', 'vector_index'));
            const fileName = `index_doc_${documentId}_${modelName}_${dimensions}.db`;
            const generatedIndexPath = path.join(baseDir, 'documents', fileName);

            // Create or load SQLite index
            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: generatedIndexPath, // Required by interface, but SqliteVecDatabase will use documentId to regenerate
                documentId,
                modelName,
                dimensions
            };

            // Check if SQLite index already exists
            if (!sqliteDb.documentIndexExists(documentId)) {
                await sqliteDb.createIndex(vectorDbConfig);
            } else {
                await sqliteDb.loadIndex(vectorDbConfig);
            }

            // Re-generate embeddings for chunks that have content but no embedding in SQLite
            // Since FAISS doesn't allow vector extraction, we need to re-generate from content
            const chunksToMigrate = chunks.filter(chunk => chunk.content && chunk.content.trim().length > 0);

            this.reportProgress(0, chunksToMigrate.length, `Migrating ${chunksToMigrate.length} chunks for document ${documentId}`);

            // Process chunks in batches to avoid overwhelming the API
            const batchSize = 10;
            for (let i = 0; i < chunksToMigrate.length; i += batchSize) {
                const batch = chunksToMigrate.slice(i, i + batchSize);
                
                try {
                    // Generate embeddings for batch
                    const texts = batch.map(chunk => chunk.content);
                    const embeddingResponse = await this.ragConfigApi.generateEmbedding(texts, modelName);

                    if (!embeddingResponse.status || !embeddingResponse.data) {
                        throw new Error(`Failed to generate embeddings: ${embeddingResponse.msg || 'Unknown error'}`);
                    }

                    const embeddings = embeddingResponse.data;

                    // Add vectors to SQLite database
                    const vectors: number[][] = [];
                    const chunkIds: number[] = [];

                    for (let j = 0; j < batch.length; j++) {
                        const chunk = batch[j];
                        const embedding = embeddings[j];

                        if (!embedding || !embedding.embedding) {
                            errors.push(`Failed to get embedding for chunk ${chunk.id}`);
                            continue;
                        }

                        // Validate dimensions
                        if (embedding.dimensions !== dimensions) {
                            errors.push(`Dimension mismatch for chunk ${chunk.id}: expected ${dimensions}, got ${embedding.dimensions}`);
                            continue;
                        }

                        vectors.push(embedding.embedding);
                        chunkIds.push(chunk.id);
                    }

                    // Add vectors to SQLite database
                    if (vectors.length > 0) {
                        // Flatten vectors array for addVectors method
                        const flatVectors: number[] = [];
                        for (const vector of vectors) {
                            flatVectors.push(...vector);
                        }

                        await sqliteDb.addVectors(flatVectors, chunkIds);
                        await sqliteDb.saveIndex();

                        chunksMigrated += vectors.length;

                        // Update chunk embedding IDs (SQLite uses chunk_id directly, so we can set embeddingId to chunk_id)
                        for (const chunkId of chunkIds) {
                            await this.ragChunkModule.updateChunkEmbedding(chunkId, chunkId.toString());
                        }
                    }

                    this.reportProgress(
                        Math.min(i + batchSize, chunksToMigrate.length),
                        chunksToMigrate.length,
                        `Migrated ${chunksMigrated} chunks for document ${documentId}`
                    );

                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push(`Error processing batch ${i}-${i + batchSize}: ${errorMsg}`);
                    console.error(`Error migrating batch for document ${documentId}:`, error);
                }
            }

            // Validate migration
            const stats = sqliteDb.getIndexStats();
            if (stats.totalVectors !== chunksMigrated) {
                errors.push(`Validation failed: expected ${chunksMigrated} vectors, got ${stats.totalVectors}`);
            }

            // Cleanup
            await sqliteDb.cleanup();

            // Create backup of FAISS index if backup path is provided
            if (backupPath) {
                try {
                    const faissIndexPath = path.join(
                        this.baseIndexPath,
                        `document_${documentId}`,
                        `model_${modelName}`,
                        'index.index'
                    );

                    if (fs.existsSync(faissIndexPath)) {
                        const backupDir = path.join(backupPath, `document_${documentId}`);
                        fs.mkdirSync(backupDir, { recursive: true });
                        const backupFilePath = path.join(backupDir, 'index.index');
                        fs.copyFileSync(faissIndexPath, backupFilePath);
                    }
                } catch (error) {
                    errors.push(`Failed to backup FAISS index: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            return {
                success: errors.length === 0,
                chunksMigrated,
                errors
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`Migration failed for document ${documentId}: ${errorMsg}`);
            return {
                success: false,
                chunksMigrated,
                errors
            };
        }
    }

    /**
     * Migrate all FAISS indices to SQLite-vec
     */
    async migrateAll(options: {
        backupPath?: string;
        documentIds?: number[];
        modelName?: string;
    } = {}): Promise<MigrationResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        const warnings: string[] = [];
        let documentsProcessed = 0;
        let totalChunksMigrated = 0;

        try {
            // Detect FAISS indices
            this.reportProgress(0, 100, 'Detecting FAISS indices...');
            const faissIndices = await this.detectFaissIndices();

            if (faissIndices.length === 0) {
                return {
                    success: true,
                    documentsProcessed: 0,
                    chunksMigrated: 0,
                    errors: [],
                    warnings: ['No FAISS indices found to migrate'],
                    duration: Date.now() - startTime
                };
            }

            // Filter indices based on options
            let indicesToMigrate = faissIndices;
            if (options.documentIds && options.documentIds.length > 0) {
                indicesToMigrate = indicesToMigrate.filter(idx => 
                    idx.documentId && options.documentIds!.includes(idx.documentId)
                );
            }
            if (options.modelName) {
                indicesToMigrate = indicesToMigrate.filter(idx => idx.modelName === options.modelName);
            }

            if (indicesToMigrate.length === 0) {
                return {
                    success: true,
                    documentsProcessed: 0,
                    chunksMigrated: 0,
                    errors: [],
                    warnings: ['No matching FAISS indices found to migrate'],
                    duration: Date.now() - startTime
                };
            }

            // Create backup directory if specified
            if (options.backupPath) {
                try {
                    fs.mkdirSync(options.backupPath, { recursive: true });
                } catch (error) {
                    warnings.push(`Failed to create backup directory: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            // Group indices by document
            const indicesByDocument = new Map<number, typeof indicesToMigrate>();
            for (const index of indicesToMigrate) {
                if (index.documentId) {
                    if (!indicesByDocument.has(index.documentId)) {
                        indicesByDocument.set(index.documentId, []);
                    }
                    indicesByDocument.get(index.documentId)!.push(index);
                }
            }

            // Migrate each document
            const documentsToMigrate = Array.from(indicesByDocument.keys());
            this.reportProgress(0, documentsToMigrate.length, `Starting migration of ${documentsToMigrate.length} documents...`);

            for (let i = 0; i < documentsToMigrate.length; i++) {
                const documentId = documentsToMigrate[i];
                const documentIndices = indicesByDocument.get(documentId)!;

                // Get model info from first index (assuming all indices for a document use the same model)
                const firstIndex = documentIndices[0];
                const modelName = firstIndex.modelName || 'unknown';
                
                // Determine dimensions from chunks (since we can't reliably get it from FAISS)
                // We'll use a default or try to get it from the first chunk's embedding
                let dimensions = firstIndex.dimensions || 768; // Default to common dimension
                
                // Try to get dimensions from document metadata or chunks
                try {
                    const chunks = await this.ragChunkModule.getDocumentChunks(documentId);
                    if (chunks.length > 0) {
                        // Try to infer dimensions from model name or use default
                        // In practice, this should come from document metadata
                        warnings.push(`Using default dimensions ${dimensions} for document ${documentId}. Consider specifying dimensions in document metadata.`);
                    }
                } catch (error) {
                    warnings.push(`Could not determine dimensions for document ${documentId}: ${error instanceof Error ? error.message : String(error)}`);
                }

                this.reportProgress(
                    i,
                    documentsToMigrate.length,
                    `Migrating document ${documentId} (${i + 1}/${documentsToMigrate.length})...`
                );

                const result = await this.migrateDocument(
                    documentId,
                    modelName,
                    dimensions,
                    options.backupPath
                );

                if (result.success) {
                    documentsProcessed++;
                    totalChunksMigrated += result.chunksMigrated;
                } else {
                    errors.push(...result.errors.map(e => `Document ${documentId}: ${e}`));
                }
            }

            this.reportProgress(
                documentsToMigrate.length,
                documentsToMigrate.length,
                `Migration completed. Processed ${documentsProcessed} documents, migrated ${totalChunksMigrated} chunks.`
            );

            return {
                success: errors.length === 0,
                documentsProcessed,
                chunksMigrated: totalChunksMigrated,
                errors,
                warnings,
                backupPath: options.backupPath,
                duration: Date.now() - startTime
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`Migration failed: ${errorMsg}`);
            return {
                success: false,
                documentsProcessed,
                chunksMigrated: totalChunksMigrated,
                errors,
                warnings,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Validate migrated data
     */
    async validateMigration(documentId: number, modelName: string, dimensions: number): Promise<{
        valid: boolean;
        errors: string[];
    }> {
        const errors: string[] = [];

        try {
            // Get chunks from database
            const chunks = await this.ragChunkModule.getDocumentChunks(documentId);
            const chunksWithContent = chunks.filter(c => c.content && c.content.trim().length > 0);

            // Load SQLite database
            const sqliteDb = new SqliteVecDatabase(this.baseIndexPath);
            await sqliteDb.initialize();

            // Generate document-specific index path (required by interface)
            const baseDir = path.dirname(this.baseIndexPath || path.join(process.cwd(), 'data', 'vector_index'));
            const fileName = `index_doc_${documentId}_${modelName}_${dimensions}.db`;
            const generatedIndexPath = path.join(baseDir, 'documents', fileName);

            const vectorDbConfig: VectorDatabaseConfig = {
                indexPath: generatedIndexPath, // Required by interface, but SqliteVecDatabase will use documentId to regenerate
                documentId,
                modelName,
                dimensions
            };

            if (!sqliteDb.documentIndexExists(documentId)) {
                errors.push(`SQLite index does not exist for document ${documentId}`);
                return { valid: false, errors };
            }

            await sqliteDb.loadIndex(vectorDbConfig);
            const stats = sqliteDb.getIndexStats();

            // Check vector count matches chunk count
            if (stats.totalVectors !== chunksWithContent.length) {
                errors.push(
                    `Vector count mismatch: expected ${chunksWithContent.length} vectors, got ${stats.totalVectors}`
                );
            }

            // Check dimensions match
            if (stats.dimension !== dimensions) {
                errors.push(
                    `Dimension mismatch: expected ${dimensions}, got ${stats.dimension}`
                );
            }

            // Test search functionality
            try {
                // Generate a test query vector
                const testQuery = 'test query';
                const embeddingResponse = await this.ragConfigApi.generateEmbedding([testQuery], modelName);
                
                if (embeddingResponse.status && embeddingResponse.data && embeddingResponse.data[0]) {
                    const queryVector = embeddingResponse.data[0].embedding;
                    const searchResults = await sqliteDb.search(queryVector, 5);
                    
                    if (searchResults.chunkIds.length === 0 && chunksWithContent.length > 0) {
                        errors.push('Search returned no results but chunks exist');
                    }
                } else {
                    errors.push('Could not validate search functionality: embedding generation failed');
                }
            } catch (error) {
                errors.push(`Search validation failed: ${error instanceof Error ? error.message : String(error)}`);
            }

            await sqliteDb.cleanup();

            return {
                valid: errors.length === 0,
                errors
            };

        } catch (error) {
            errors.push(`Validation failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                valid: false,
                errors
            };
        }
    }
}

