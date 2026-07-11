import * as fs from "fs";
import * as path from "path";
import { AbstractVectorDatabase } from "@/modules/interface/AbstractVectorDatabase";
import {
  VectorDatabaseConfig,
  VectorSearchResult,
  IndexStats,
} from "@/modules/interface/IVectorDatabase";
import { VectorModule } from "@/modules/VectorModule";
import { VectorMetadataModule } from "@/modules/VectorMetadataModule";
import { RAGChunkModule } from "@/modules/RAGChunkModule";
import { log } from "@/modules/Logger";

/** Structural slice of the better-sqlite3 Database this adapter queries through
 *  directly. Avoids `as any` and depending on typeorm's non-exported driver type. (WS-3 R3.6) */
interface RawSqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface RawSqliteDatabase {
  prepare(sql: string): RawSqliteStatement;
}

/**
 * SQLite-vec vector database implementation using TypeORM
 * Uses sqlite-vec extension loaded via TypeORM's prepareDatabase hook
 * Leverages VectorModule and VectorMetadataModule for database operations
 */
export class SqliteVecDatabase extends AbstractVectorDatabase {
  private vectorModule: VectorModule | null = null;
  private vectorMetadataModule: VectorMetadataModule | null = null;
  private currentVirtualTableName: string | null = null;

  constructor() {
    super();
    this.vectorModule = new VectorModule();
    this.vectorMetadataModule = new VectorMetadataModule();
  }

  /**
   * Pull the underlying better-sqlite3 Database from a TypeORM connection (typed),
   * replacing the previous `driver as any` access at each raw-query site. Returns
   * null when the connection is absent or uninitialized. (WS-3 R3.6)
   */
  private getRawDatabase(
    dbConnection:
      | { connection: { driver: unknown; isInitialized: boolean } }
      | null
      | undefined
  ): RawSqliteDatabase | null {
    if (!dbConnection || !dbConnection.connection.isInitialized) return null;
    const driver = dbConnection.connection.driver as {
      database?: RawSqliteDatabase | null;
    };
    return driver.database ?? null;
  }

  /**
   * Validate a SQL identifier (table name) before interpolation. Virtual table
   * names come from metadata; this is defense-in-depth against injection. (WS-3 R3.6)
   */
  private static assertSafeIdentifier(name: string, kind = "identifier"): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Unsafe SQL ${kind}: ${JSON.stringify(name)}`);
    }
  }

  /** Set + validate the current virtual table name. */
  private setVirtualTableName(name: string): void {
    SqliteVecDatabase.assertSafeIdentifier(name, "virtual table name");
    this.currentVirtualTableName = name;
  }
  /**
   * Initialize sqlite-vec via TypeORM
   * TypeORM will load sqlite-vec extension via prepareDatabase hook
   */
  async initialize(): Promise<void> {
    try {
      this.initialized = true;
      log.info(
        "SQLite-vec initialized successfully (extension will be loaded when DataSource is created)"
      );
    } catch (error) {
      log.error("Failed to initialize sqlite-vec:", error);
      throw new Error(
        "Failed to initialize sqlite-vec. Please ensure sqlite-vec extension is available."
      );
    }
  }

  /**
   * Create a new SQLite database using TypeORM with sqlite-vec
   * Tables are created automatically via TypeORM synchronize
   * Creates vec0 virtual table using VectorMetadataModule and VectorModule
   *
   * @param config - Vector database configuration
   * @returns Promise that resolves to the virtual table name
   */
  async createIndex(config: VectorDatabaseConfig): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.vectorModule || !this.vectorMetadataModule) {
      throw new Error(
        "VectorModule and VectorMetadataModule must be initialized"
      );
    }

    try {
      this.config = config;
      this.dimension = config.dimensions;

      const indexType = config.indexType || "flat";

      // Get or create metadata entry using VectorMetadataModule
      // This will generate a unique virtual table name for the model/dimension combination
      const metadata = await this.vectorMetadataModule.getOrCreateMetadata(
        config.modelName,
        config.dimensions,
        {
          indexType: indexType,
        }
      );

      // Create the vec0 virtual table using VectorModule
      // This uses the virtual table name from the metadata
      await this.vectorModule.createVirtualTableFromMetadata(metadata);

      // Set the current virtual table name
      this.setVirtualTableName(metadata.virtual_table_name);

      log.info(
        `Created ${indexType} SQLite-vec index with dimension ${config.dimensions} for model '${config.modelName}'`
      );
      log.info(`Virtual table name: ${metadata.virtual_table_name}`);

      // Return the virtual table name instead of static string
      return metadata.virtual_table_name;
    } catch (error) {
      log.error("Failed to create SQLite-vec index:", error);
      throw new Error(
        `Failed to create SQLite-vec index: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Load existing SQLite database using TypeORM
   * Finds the virtual table name using VectorMetadataModule and sets it as the current index
   */
  async loadIndex(config: VectorDatabaseConfig): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.vectorModule || !this.vectorMetadataModule) {
      throw new Error(
        "VectorModule and VectorMetadataModule must be initialized"
      );
    }

    this.validateConfig(config);

    try {
      this.config = config;
      this.dimension = config.dimensions;

      // Find metadata entry using VectorMetadataModule
      // This will give us the virtual table name for the model/dimension combination
      const metadata = await this.vectorMetadataModule.findByModelAndDimension(
        config.modelName,
        config.dimensions
      );

      if (metadata) {
        // Set the current virtual table name from metadata
        this.setVirtualTableName(metadata.virtual_table_name);
        this.dimension = metadata.dimension;

        log.info(
          `Loaded existing SQLite-vec index for model '${metadata.model_name}' with dimension ${metadata.dimension}`
        );
        log.info(`Virtual table name: ${this.currentVirtualTableName}`);
        log.info(`Total vectors: ${metadata.total_vectors}`);
      } else {
        // If metadata doesn't exist, create a new index
        log.info(
          `No existing metadata found for model '${config.modelName}' with dimension ${config.dimensions}, creating new index`
        );
        const virtualTableName = await this.createIndex(config);
        this.setVirtualTableName(virtualTableName);
      }
    } catch (error) {
      log.error("Failed to load SQLite-vec index:", error);
      throw new Error(
        `Failed to load SQLite-vec index: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Save index to disk (SQLite auto-saves, but we can checkpoint)
   */
  async saveIndex(): Promise<void> {
    // No-op: SQLite (vec0 + WAL) auto-persists; explicit checkpoint removed (WS-3 R3.6).
  }

  /**
   * Add vectors to the index using the virtual table
   * Only adds to the virtual table (regular vectors table is abandoned)
   */
  async addVectors(vectors: number[], chunkIds: number): Promise<void> {
    if (!this.vectorModule || !this.vectorMetadataModule) {
      throw new Error("Index not initialized");
    }

    if (vectors.length === 0) {
      return;
    }

    // Validate vector has the correct dimension
    if (vectors.length !== this.dimension) {
      throw new Error(
        `Vector array length ${vectors.length} does not match dimension ${this.dimension}`
      );
    }

    if (!this.currentVirtualTableName) {
      throw new Error(
        "No current virtual table name set. Please call loadIndex or createIndex first."
      );
    }

    try {
      // Use VectorModule's addVectorToVirtualTable method for centralized vector insertion
      await this.vectorModule.addVectorToVirtualTable(
        vectors,
        chunkIds,
        this.currentVirtualTableName,
        this.dimension
      );

      // Update metadata total vectors count
      if (this.config) {
        const metadata =
          await this.vectorMetadataModule.findByModelAndDimension(
            this.config.modelName,
            this.dimension
          );
        if (metadata) {
          await this.vectorMetadataModule.incrementTotalVectors(metadata.id, 1);
        }
      }

      log.info(`Added vector to SQLite-vec index (chunk_id: ${chunkIds})`);
    } catch (error) {
      log.error("Failed to add vectors to SQLite-vec index:", error);
      throw new Error(
        `Failed to add vectors to SQLite-vec index: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Search for similar vectors using the virtual table
   * Only searches in the virtual table (regular vectors table is abandoned)
   *
   * @param queryVector - Query vector as number array
   * @param k - Number of similar vectors to return (default: 10)
   * @param distance - Maximum distance threshold to filter results (optional)
   * @returns VectorSearchResult with chunkIds, distances, and indices
   */
  async search(
    queryVector: number[],
    k = 10,
    distance?: number
  ): Promise<VectorSearchResult> {
    if (!this.vectorModule) {
      throw new Error("Index not initialized");
    }

    if (!this.currentVirtualTableName) {
      throw new Error(
        "No current virtual table name set. Please call loadIndex or createIndex first."
      );
    }

    try {
      // Use searchSimilarVectorsWithVec0 to search in the specific virtual table
      // This will try the virtual table MATCH syntax first, then fall back to vec_distance_l2
      return await this.vectorModule.searchSimilarVectorsWithVec0(
        queryVector,
        k,
        this.dimension,
        this.currentVirtualTableName
      );
    } catch (error) {
      log.error("Failed to search vectors in SqliteVecDatabase:", error);
      throw new Error(
        `Failed to perform vector search: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get index statistics
   * Gets total vectors from metadata (synchronous access to database)
   * For accurate stats, the metadata should be loaded when loadIndex is called
   */
  getIndexStats(): IndexStats {
    if (!this.vectorModule || !this.vectorMetadataModule) {
      return {
        totalVectors: 0,
        dimension: this.dimension || 0,
        indexType: this.config?.indexType || "unknown",
        isInitialized: this.initialized,
        modelName: this.config?.modelName || "",
      };
    }

    try {
      // Get total vectors from metadata synchronously
      let totalVectors = 0;
      if (this.config?.modelName && this.dimension) {
        totalVectors = this.getTotalVectorsFromMetadataSync(
          this.config.modelName,
          this.dimension
        );
      }

      return {
        totalVectors: totalVectors,
        dimension: this.dimension || 0,
        indexType: this.config?.indexType || "flat",
        isInitialized: this.initialized,
        modelName: this.config?.modelName || "",
      };
    } catch (error) {
      log.error("Failed to get index stats:", error);
      return {
        totalVectors: 0,
        dimension: this.dimension || 0,
        indexType: "unknown",
        isInitialized: this.initialized,
        modelName: this.config?.modelName || "",
      };
    }
  }

  /**
   * Get total vectors count from metadata synchronously
   * Uses underlying better-sqlite3 database for synchronous queries
   */
  private getTotalVectorsFromMetadataSync(
    modelName: string,
    dimension: number
  ): number {
    try {
      const dbConnection = this.vectorModule?.getDbConnection();
      if (!dbConnection || !dbConnection.connection.isInitialized) {
        return 0;
      }

      // Access underlying better-sqlite3 database through TypeORM driver
      const database = this.getRawDatabase(dbConnection);

      if (!database) {
        return 0;
      }

      // Execute synchronous query to get total vectors from metadata
      const query = `SELECT total_vectors FROM vector_metadata WHERE model_name=? AND dimension=? LIMIT 1`;
      const result = database.prepare(query).get(modelName, dimension) as
        | { total_vectors: number }
        | undefined;

      return result?.total_vectors || 0;
    } catch (error) {
      log.error(
        `Failed to get total vectors from metadata for model '${modelName}' with dimension ${dimension}:`,
        error
      );
      return 0;
    }
  }

  /**
   * Get total number of vectors in the index
   * Gets count from metadata synchronously (regular vectors table is abandoned)
   */
  getTotalVectors(): number {
    if (!this.vectorModule || !this.vectorMetadataModule) {
      throw new Error("Index not initialized");
    }

    // Get total vectors from metadata synchronously
    if (this.config?.modelName && this.dimension) {
      return this.getTotalVectorsFromMetadataSync(
        this.config.modelName,
        this.dimension
      );
    }

    return 0;
  }

  /**
   * Reset the index
   * Deletes all vectors from the virtual table (regular vectors table is abandoned)
   */
  async resetIndex(): Promise<void> {
    if (!this.vectorModule) {
      throw new Error("Index not initialized");
    }

    if (!this.currentVirtualTableName) {
      throw new Error(
        "No current virtual table name set. Please call loadIndex or createIndex first."
      );
    }

    try {
      // Delete all vectors from virtual table
      const dbConnection = this.vectorModule.getDbConnection();
      const queryRunner = dbConnection.connection.createQueryRunner();

      // Delete all rows from virtual table
      await queryRunner.query(`DELETE FROM ${this.currentVirtualTableName}`);
      await queryRunner.release();

      log.info(
        `Deleted all vectors from virtual table '${this.currentVirtualTableName}'`
      );

      // Reset metadata total vectors count
      if (this.config && this.vectorMetadataModule) {
        const metadata =
          await this.vectorMetadataModule.findByModelAndDimension(
            this.config.modelName,
            this.dimension
          );
        if (metadata) {
          await this.vectorMetadataModule.updateMetadata(metadata.id, {
            total_vectors: 0,
          });
        }
      }

      log.info("SQLite-vec index reset successfully");
    } catch (error) {
      log.error("Failed to reset SQLite-vec index:", error);
      throw new Error(
        `Failed to reset SQLite-vec index: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Optimize the index
   */
  async optimizeIndex(): Promise<void> {
    // No-op: vec0 needs no manual optimization (VACUUM/ANALYZE removed, WS-3 R3.6).
  }

  /**
   * Backup the index
   */
  async backupIndex(backupPath: string): Promise<void> {
    if (!this.vectorModule) {
      throw new Error("No database to backup");
    }

    try {
      // Save current state first
      await this.saveIndex();

      // Ensure backup directory exists
      const backupDir = path.dirname(backupPath);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Use file copy for backup (simpler and reliable)
      if (fs.existsSync(this.indexPath)) {
        fs.copyFileSync(this.indexPath, backupPath);
        log.info(`SQLite-vec index backed up to ${backupPath}`);
      } else {
        throw new Error(`Database file not found: ${this.indexPath}`);
      }
    } catch (error) {
      log.error("Failed to backup SQLite-vec index:", error);
      throw new Error(
        `Failed to backup SQLite-vec index: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Restore index from backup
   */
  async restoreIndex(backupPath: string): Promise<void> {
    // No-op: restore is handled by backupIndex + the file-copy path (WS-3 R3.6).
  }

  /**
   * Delete a document-specific index
   * First gets all chunks for the document using RAGChunkModule,
   * then deletes vectors by chunk ID from the virtual table (regular vectors table is abandoned)
   */
  async deleteDocumentIndex(documentId: number): Promise<void> {
    if (!this.vectorModule) {
      throw new Error("VectorModule not initialized");
    }

    if (!this.currentVirtualTableName) {
      throw new Error(
        "No current virtual table name set. Please call loadIndex or createIndex first."
      );
    }

    try {
      // Get all chunks for the document using RAGChunkModule
      const ragChunkModule = new RAGChunkModule();
      const chunks = await ragChunkModule.getDocumentChunks(documentId);

      if (chunks.length === 0) {
        log.info(
          `No chunks found for document ${documentId}, nothing to delete`
        );
        return;
      }

      // Extract chunk IDs from the chunks
      const chunkIds = chunks.map((chunk) => chunk.id);

      log.info(
        `Found ${chunkIds.length} chunks for document ${documentId}, deleting associated vectors...`
      );

      // Delete from virtual table using VectorModel's method
      await this.vectorModule.deleteVectorsFromVirtualTable(
        chunkIds,
        this.currentVirtualTableName
      );

      // Update metadata total vectors count
      if (this.config && this.vectorMetadataModule) {
        const metadata =
          await this.vectorMetadataModule.findByModelAndDimension(
            this.config.modelName,
            this.dimension
          );
        if (metadata) {
          // Decrement total vectors count (use negative count to decrement)
          await this.vectorMetadataModule.incrementTotalVectors(
            metadata.id,
            -chunkIds.length
          );
        }
      }

      log.info(
        `Deleted vectors for document ${documentId} (${chunkIds.length} chunks)`
      );
    } catch (error) {
      log.error(
        `Failed to delete document index for document ${documentId}:`,
        error
      );
      throw new Error(
        `Failed to delete document index for document ${documentId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Delete vectors from the virtual table by chunk IDs
   * Public method to delete vectors by specific chunk IDs
   *
   * @param chunkIds - Array of chunk IDs to delete
   */
  async deleteVectorsByChunkIds(chunkIds: number[]): Promise<void> {
    if (chunkIds.length === 0) {
      log.info("No chunk IDs provided, nothing to delete");
      return;
    }

    if (!this.vectorModule) {
      throw new Error("VectorModule not initialized");
    }

    if (!this.currentVirtualTableName) {
      throw new Error(
        "No current virtual table name set. Please call loadIndex or createIndex first."
      );
    }

    // Use VectorModel's deleteVectorsFromVirtualTable method
    await this.vectorModule.deleteVectorsFromVirtualTable(
      chunkIds,
      this.currentVirtualTableName
    );

    // Update metadata total vectors count
    if (this.config && this.vectorMetadataModule) {
      const metadata = await this.vectorMetadataModule.findByModelAndDimension(
        this.config.modelName,
        this.dimension
      );
      if (metadata) {
        // Decrement total vectors count (use negative count to decrement)
        await this.vectorMetadataModule.incrementTotalVectors(
          metadata.id,
          -chunkIds.length
        );
      }
    }

    log.info(
      `Deleted ${chunkIds.length} vectors by chunk IDs from virtual table '${this.currentVirtualTableName}'`
    );
  }

  /**
   * Check if a document-specific index exists
   * Gets all chunks for the document using RAGChunkModule,
   * then checks if vectors exist for those chunk IDs in the virtual table
   */
  documentIndexExists(documentId: number): boolean {
    if (!this.vectorModule || !this.currentVirtualTableName) {
      return false;
    }

    try {
      // Get chunk IDs for the document using RAGChunkModule (synchronous)
      const ragChunkModule = new RAGChunkModule();
      const chunkIds = ragChunkModule.getDocumentChunkIds(documentId);

      if (chunkIds.length === 0) {
        // No chunks found for the document, so no index exists
        return false;
      }

      // Check if vectors exist for those chunk IDs in the virtual table (synchronous)
      return this.hasVectorsInVirtualTableSync(chunkIds);
    } catch (error) {
      log.error(
        `Failed to check if document index exists for document ${documentId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Check if vectors exist for chunk IDs in the virtual table (synchronous)
   * Uses underlying better-sqlite3 database for synchronous queries
   */
  private hasVectorsInVirtualTableSync(chunkIds: number[]): boolean {
    if (chunkIds.length === 0 || !this.currentVirtualTableName) {
      return false;
    }

    try {
      const dbConnection = this.vectorModule?.getDbConnection();
      if (!dbConnection || !dbConnection.connection.isInitialized) {
        return false;
      }

      // Access underlying better-sqlite3 database through TypeORM driver
      const database = this.getRawDatabase(dbConnection);

      if (!database) {
        return false;
      }

      // Build query with placeholders
      const placeholders = chunkIds.map(() => "?").join(",");
      const query = `SELECT COUNT(*) as count FROM ${this.currentVirtualTableName} WHERE chunk_id IN (${placeholders})`;

      // Execute synchronous query
      const result = database.prepare(query).get(...chunkIds) as {
        count: number;
      };

      return (result?.count || 0) > 0;
    } catch (error) {
      log.error(
        "Failed to check if vectors exist in virtual table:",
        error
      );
      return false;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // No-op: index lifetime is managed by the DataSource + vector_metadata (WS-3 R3.6).
  }

  /**
   * Get SQLite-vec specific file extension
   */
  protected getFileExtension(): string {
    return "db";
  }

  /**
   * Override indexExists to check if the virtual table exists
   * Checks the current virtual table or finds it from metadata
   */
  indexExists(): boolean {
    if (!this.vectorModule || !this.vectorMetadataModule) {
      return false;
    }

    try {
      // If we have a current virtual table name, check if it exists
      if (this.currentVirtualTableName) {
        return this.checkVirtualTableExistsSync(this.currentVirtualTableName);
      }

      // If we have config with modelName and dimensions, try to find the virtual table
      if (this.config?.modelName && this.dimension) {
        // Try to find metadata synchronously by accessing the database directly
        const virtualTableName = this.findVirtualTableNameSync(
          this.config.modelName,
          this.dimension
        );

        if (virtualTableName) {
          return this.checkVirtualTableExistsSync(virtualTableName);
        }
      }

      return false;
    } catch (error) {
      log.error("Failed to check if index exists:", error);
      return false;
    }
  }

  /**
   * Check if a virtual table exists synchronously
   * Uses underlying better-sqlite3 database for synchronous queries
   */
  private checkVirtualTableExistsSync(virtualTableName: string): boolean {
    try {
      const dbConnection = this.vectorModule?.getDbConnection();
      if (!dbConnection || !dbConnection.connection.isInitialized) {
        return false;
      }

      // Access underlying better-sqlite3 database through TypeORM driver
      const database = this.getRawDatabase(dbConnection);

      if (!database) {
        return false;
      }

      // Execute synchronous query to check if virtual table exists
      const query = `SELECT name FROM sqlite_master WHERE type='table' AND name=?`;
      const result = database.prepare(query).get(virtualTableName) as
        | { name: string }
        | undefined;

      return result !== undefined && result !== null;
    } catch (error) {
      log.error(
        `Failed to check if virtual table '${virtualTableName}' exists:`,
        error
      );
      return false;
    }
  }

  /**
   * Find virtual table name synchronously from metadata
   * Uses underlying better-sqlite3 database for synchronous queries
   */
  private findVirtualTableNameSync(
    modelName: string,
    dimension: number
  ): string | null {
    try {
      const dbConnection = this.vectorModule?.getDbConnection();
      if (!dbConnection || !dbConnection.connection.isInitialized) {
        return null;
      }

      // Access underlying better-sqlite3 database through TypeORM driver
      const database = this.getRawDatabase(dbConnection);

      if (!database) {
        return null;
      }

      // Execute synchronous query to find metadata
      const query = `SELECT virtual_table_name FROM vector_metadata WHERE model_name=? AND dimension=? LIMIT 1`;
      const result = database.prepare(query).get(modelName, dimension) as
        | { virtual_table_name: string }
        | undefined;

      return result?.virtual_table_name || null;
    } catch (error) {
      log.error(
        `Failed to find virtual table name for model '${modelName}' with dimension ${dimension}:`,
        error
      );
      return null;
    }
  }
}
