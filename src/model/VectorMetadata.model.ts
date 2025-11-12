import { DataSource, Repository } from 'typeorm';
import { VectorMetadataEntity } from '@/entity/Vector.entity';
import { BaseDb } from "@/model/Basedb";
/**
 * Vector metadata model for managing vector metadata entities
 * Works with a DataSource (for separate vector database files)
 */
export class VectorMetadataModel extends BaseDb{
    private repository: Repository<VectorMetadataEntity>;
    // private dataSource: DataSource;

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
     * Get or create metadata (typically ID = 1)
     */
    async getOrCreateMetadata(id: number, defaultValues: {
        dimension: number;
        model_name: string;
        index_type: string;
    }): Promise<VectorMetadataEntity> {
        let metadata = await this.findById(id);
        if (!metadata) {
            metadata = new VectorMetadataEntity();
            metadata.id = id;
            metadata.dimension = defaultValues.dimension;
            metadata.model_name = defaultValues.model_name;
            metadata.index_type = defaultValues.index_type;
            metadata.total_vectors = 0;
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
     * Get DataSource for raw queries
     */
    // getDataSource(): DataSource {
    //     return this.dataSource;
    // }
}

