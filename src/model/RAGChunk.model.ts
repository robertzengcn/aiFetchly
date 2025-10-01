import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";

export class RAGChunkModel extends BaseDb {
    private repository: Repository<RAGChunkEntity>;

    constructor(filepath: string) {
        super(filepath);
        this.repository = this.sqliteDb.connection.getRepository(RAGChunkEntity);
    }

    /**
     * Save a single chunk entity
     */
    async saveChunk(chunk: RAGChunkEntity): Promise<RAGChunkEntity> {
        return await this.repository.save(chunk);
    }

    /**
     * Save multiple chunk entities
     */
    async saveChunks(chunks: RAGChunkEntity[]): Promise<RAGChunkEntity[]> {
        return await this.repository.save(chunks);
    }

    /**
     * Find a chunk by content hash and document ID
     */
    async findChunkByHash(contentHash: string, documentId: number): Promise<RAGChunkEntity | null> {
        return await this.repository.findOne({
            where: { contentHash, documentId }
        });
    }

    /**
     * Get all chunks for a document ordered by chunk index
     */
    async getDocumentChunks(documentId: number): Promise<RAGChunkEntity[]> {
        return await this.repository.find({
            where: { documentId },
            order: { chunkIndex: 'ASC' }
        });
    }

    /**
     * Delete all chunks for a document
     */
    async deleteDocumentChunks(documentId: number): Promise<number> {
        const result = await this.repository.delete({ documentId });
        return result.affected || 0;
    }

    /**
     * Delete a specific chunk by ID
     */
    async deleteChunk(chunkId: number): Promise<number> {
        const result = await this.repository.delete({ id: chunkId });
        return result.affected || 0;
    }

    /**
     * Get chunk statistics for a document or all documents
     */
    async getChunkStats(documentId?: number): Promise<{
        totalChunks: number;
        averageChunkSize: number;
        totalTokens: number;
    }> {
        const queryBuilder = this.repository.createQueryBuilder('chunk');

        if (documentId) {
            queryBuilder.where('chunk.documentId = :documentId', { documentId });
        }

        const chunks = await queryBuilder.getMany();
        
        const totalChunks = chunks.length;
        const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
        const averageChunkSize = totalChunks > 0 ? totalTokens / totalChunks : 0;

        return {
            totalChunks,
            averageChunkSize,
            totalTokens
        };
    }

    /**
     * Get chunk by ID
     */
    async getChunkById(chunkId: number): Promise<RAGChunkEntity | null> {
        return await this.repository.findOne({ where: { id: chunkId } });
    }

    /**
     * Update chunk embedding information
     */
    async updateChunkEmbedding(chunkId: number, embeddingId: string, vectorDimensions: number): Promise<boolean> {
        const result = await this.repository.update(
            { id: chunkId },
            { embeddingId, vectorDimensions }
        );
        return (result.affected || 0) > 0;
    }

    /**
     * Get chunks by embedding ID
     */
    async getChunksByEmbeddingId(embeddingId: string): Promise<RAGChunkEntity[]> {
        return await this.repository.find({
            where: { embeddingId }
        });
    }

    /**
     * Get chunks without embeddings
     */
    async getChunksWithoutEmbeddings(documentId?: number): Promise<RAGChunkEntity[]> {
        const queryBuilder = this.repository.createQueryBuilder('chunk')
            .where('chunk.embeddingId IS NULL');

        if (documentId) {
            queryBuilder.andWhere('chunk.documentId = :documentId', { documentId });
        }

        return await queryBuilder.getMany();
    }
}
