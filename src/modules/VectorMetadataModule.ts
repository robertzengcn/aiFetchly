import { VectorMetadataModel } from '@/model/VectorMetadata.model';
import { VectorMetadataEntity } from '@/entity/Vector.entity';
import { BaseModule } from '@/modules/baseModule';

/**
 * Vector metadata module for managing vector metadata operations
 * Tracks model, dimension, and virtual table name information
 */
export class VectorMetadataModule extends BaseModule {
    private metadataModel: VectorMetadataModel;

    constructor() {
        super();
        this.metadataModel = new VectorMetadataModel(this.dbpath);
    }

    /**
     * Save metadata entity
     */
    async saveMetadata(metadata: VectorMetadataEntity): Promise<VectorMetadataEntity> {
        return await this.metadataModel.saveMetadata(metadata);
    }

    /**
     * Find metadata by ID
     */
    async findById(id: number): Promise<VectorMetadataEntity | null> {
        return await this.metadataModel.findById(id);
    }

    /**
     * Find metadata by model name and dimension
     */
    async findByModelAndDimension(modelName: string, dimension: number): Promise<VectorMetadataEntity | null> {
        return await this.metadataModel.findByModelAndDimension(modelName, dimension);
    }

    /**
     * Find metadata by virtual table name
     */
    async findByVirtualTableName(virtualTableName: string): Promise<VectorMetadataEntity | null> {
        return await this.metadataModel.findByVirtualTableName(virtualTableName);
    }

    /**
     * Get or create metadata for a model and dimension combination
     * Generates a unique virtual table name if not provided
     * 
     * @param modelName - Name of the embedding model
     * @param dimension - Dimension of the embedding vectors
     * @param options - Optional configuration (indexType, virtualTableName)
     * @returns Promise that resolves to the metadata entity
     */
    async getOrCreateMetadata(
        modelName: string,
        dimension: number,
        options: {
            indexType?: string;
            virtualTableName?: string;
        } = {}
    ): Promise<VectorMetadataEntity> {
        return await this.metadataModel.getOrCreateMetadata(modelName, dimension, options);
    }

    /**
     * Update metadata
     * 
     * @param id - Metadata ID
     * @param updates - Partial metadata entity with fields to update
     * @returns Promise that resolves to true if update was successful
     */
    async updateMetadata(id: number, updates: Partial<VectorMetadataEntity>): Promise<boolean> {
        return await this.metadataModel.updateMetadata(id, updates);
    }

    /**
     * Increment total vectors count
     * 
     * @param id - Metadata ID
     * @param count - Number to increment by
     * @returns Promise that resolves to true if increment was successful
     */
    async incrementTotalVectors(id: number, count: number): Promise<boolean> {
        return await this.metadataModel.incrementTotalVectors(id, count);
    }

    /**
     * Delete metadata by ID
     * 
     * @param id - Metadata ID
     * @returns Promise that resolves to true if deletion was successful
     */
    async deleteById(id: number): Promise<boolean> {
        return await this.metadataModel.deleteById(id);
    }

    /**
     * Get all metadata entries
     * 
     * @returns Promise that resolves to an array of all metadata entities
     */
    async getAllMetadata(): Promise<VectorMetadataEntity[]> {
        return await this.metadataModel.getAllMetadata();
    }
}


