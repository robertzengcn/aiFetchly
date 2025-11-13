// import { DataSource, EntityManager } from 'typeorm';
// import { VectorMetadataModel } from '@/model/VectorMetadata.model';
// import { VectorMetadataEntity } from '@/entity/Vector.entity';
// import { BaseModule } from './baseModule';

// /**
//  * Vector metadata module for managing vector metadata operations
//  * Works with a DataSource (for separate vector database files)
//  */
// export class VectorMetadataModule extends BaseModule {
//     private metadataModel: VectorMetadataModel;

//     constructor() { 
//         super();
//         this.metadataModel = new VectorMetadataModel(this.dbpath);
//     }

//     /**
//      * Save metadata entity
//      */
//     async saveMetadata(metadata: VectorMetadataEntity): Promise<VectorMetadataEntity> {
//         return await this.metadataModel.saveMetadata(metadata);
//     }

//     /**
//      * Find metadata by ID
//      */
//     async findById(id: number): Promise<VectorMetadataEntity | null> {
//         return await this.metadataModel.findById(id);
//     }

//     /**
//      * Get or create metadata (typically ID = 1)
//      */
//     async getOrCreateMetadata(id: number, defaultValues: {
//         dimension: number;
//         model_name: string;
//         index_type: string;
//     }): Promise<VectorMetadataEntity> {
//         return await this.metadataModel.getOrCreateMetadata(id, defaultValues);
//     }

//     /**
//      * Update metadata
//      */
//     async updateMetadata(id: number, updates: Partial<VectorMetadataEntity>): Promise<boolean> {
//         return await this.metadataModel.updateMetadata(id, updates);
//     }

//     /**
//      * Increment total vectors count
//      */
//     async incrementTotalVectors(id: number, count: number): Promise<boolean> {
//         return await this.metadataModel.incrementTotalVectors(id, count);
//     }

//     /**
//      * Increment total vectors count within a transaction (uses EntityManager)
//      */
//     async incrementTotalVectorsInTransaction(manager: EntityManager, id: number, count: number): Promise<boolean> {
//         const metadata = await manager.findOne(VectorMetadataEntity, { where: { id } });
//         if (!metadata) {
//             return false;
//         }
//         metadata.total_vectors += count;
//         await manager.save(VectorMetadataEntity, metadata);
//         return true;
//     }

//     /**
//      * Delete metadata by ID
//      */
//     async deleteById(id: number): Promise<boolean> {
//         return await this.metadataModel.deleteById(id);
//     }

//     /**
//      * Get DataSource for raw queries
//      */
//     // getDataSource(): DataSource {
//     //     return this.metadataModel.getDataSource();
//     // }
// }

