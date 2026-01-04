import { Repository } from 'typeorm';
import { VectorMetadataEntity } from '@/entity/Vector.entity';
import { BaseDb } from "@/model/Basedb";

/**
 * Vector metadata model for managing vector metadata entities
 * Tracks model, dimension, and virtual table name information
 */
export class VectorMetadataModel extends BaseDb {
    private repository: Repository<VectorMetadataEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(VectorMetadataEntity);
    }

    /**
     * Save metadata entity
     */
    async saveMetadata(metadata: VectorMetadataEntity): Promise<VectorMetadataEntity> {
        return await this.repository.save(metadata);
    }

    /**
     * Find metadata by ID
     */
    async findById(id: number): Promise<VectorMetadataEntity | null> {
        return await this.repository.findOne({
            where: { id }
        });
    }

    /**
     * Find metadata by model name and dimension
     */
    async findByModelAndDimension(modelName: string, dimension: number): Promise<VectorMetadataEntity | null> {
        return await this.repository.findOne({
            where: { 
                model_name: modelName,
                dimension: dimension
            }
        });
    }

    /**
     * Find metadata by virtual table name
     */
    async findByVirtualTableName(virtualTableName: string): Promise<VectorMetadataEntity | null> {
        return await this.repository.findOne({
            where: { virtual_table_name: virtualTableName }
        });
    }

    /**
     * Get or create metadata for a model and dimension combination
     * Generates a unique virtual table name if not provided
     */
    async getOrCreateMetadata(
        modelName: string,
        dimension: number,
        options: {
            indexType?: string;
            virtualTableName?: string;
        } = {}
    ): Promise<VectorMetadataEntity> {
        // Try to find existing metadata
        let metadata = await this.findByModelAndDimension(modelName, dimension);
        
        if (!metadata) {
            // Generate virtual table name if not provided
            const virtualTableName = options.virtualTableName || 
                `vec_index_${modelName.replace(/[^a-zA-Z0-9]/g, '_')}_${dimension}`;
            
            // Check if virtual table name already exists
            const existingByTableName = await this.findByVirtualTableName(virtualTableName);
            if (existingByTableName) {
                throw new Error(`Virtual table name '${virtualTableName}' already exists for a different model/dimension combination`);
            }

            metadata = new VectorMetadataEntity();
            metadata.dimension = dimension;
            metadata.model_name = modelName;
            metadata.index_type = options.indexType || 'flat';
            metadata.total_vectors = 0;
            metadata.virtual_table_name = virtualTableName;
            metadata = await this.repository.save(metadata);
        }
        
        return metadata;
    }

    /**
     * Update metadata
     */
    async updateMetadata(id: number, updates: Partial<VectorMetadataEntity>): Promise<boolean> {
        const result = await this.repository.update({ id }, updates);
        return (result.affected || 0) > 0;
    }

    /**
     * Increment total vectors count
     */
    async incrementTotalVectors(id: number, count: number): Promise<boolean> {
        const metadata = await this.findById(id);
        if (!metadata) {
            return false;
        }
        metadata.total_vectors += count;
        await this.repository.save(metadata);
        return true;
    }

    /**
     * Delete metadata by ID
     */
    async deleteById(id: number): Promise<boolean> {
        const result = await this.repository.delete({ id });
        return (result.affected || 0) > 0;
    }

    /**
     * Get all metadata entries
     */
    async getAllMetadata(): Promise<VectorMetadataEntity[]> {
        return await this.repository.find();
    }
}

