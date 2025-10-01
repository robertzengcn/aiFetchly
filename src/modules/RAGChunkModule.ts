import { RAGChunkModel } from "@/model/RAGChunk.model";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";

export class RAGChunkModule {
    private ragChunkModel: RAGChunkModel;

    constructor(filepath: string) {
        this.ragChunkModel = new RAGChunkModel(filepath);
    }

    /**
     * Save a single chunk entity
     */
    async saveChunk(chunk: RAGChunkEntity): Promise<RAGChunkEntity> {
        return await this.ragChunkModel.saveChunk(chunk);
    }

    /**
     * Save multiple chunk entities
     */
    async saveChunks(chunks: RAGChunkEntity[]): Promise<RAGChunkEntity[]> {
        return await this.ragChunkModel.saveChunks(chunks);
    }

    /**
     * Find a chunk by content hash and document ID
     */
    async findChunkByHash(contentHash: string, documentId: number): Promise<RAGChunkEntity | null> {
        return await this.ragChunkModel.findChunkByHash(contentHash, documentId);
    }

    /**
     * Get all chunks for a document ordered by chunk index
     */
    async getDocumentChunks(documentId: number): Promise<RAGChunkEntity[]> {
        return await this.ragChunkModel.getDocumentChunks(documentId);
    }

    /**
     * Delete all chunks for a document
     */
    async deleteDocumentChunks(documentId: number): Promise<number> {
        return await this.ragChunkModel.deleteDocumentChunks(documentId);
    }

    /**
     * Delete a specific chunk by ID
     */
    async deleteChunk(chunkId: number): Promise<number> {
        return await this.ragChunkModel.deleteChunk(chunkId);
    }

    /**
     * Get chunk statistics for a document or all documents
     */
    async getChunkStats(documentId?: number): Promise<{
        totalChunks: number;
        averageChunkSize: number;
        totalTokens: number;
    }> {
        return await this.ragChunkModel.getChunkStats(documentId);
    }

    /**
     * Get chunk by ID
     */
    async getChunkById(chunkId: number): Promise<RAGChunkEntity | null> {
        return await this.ragChunkModel.getChunkById(chunkId);
    }

    /**
     * Update chunk embedding information
     */
    async updateChunkEmbedding(chunkId: number, embeddingId: string, vectorDimensions: number): Promise<boolean> {
        return await this.ragChunkModel.updateChunkEmbedding(chunkId, embeddingId, vectorDimensions);
    }

    /**
     * Get chunks by embedding ID
     */
    async getChunksByEmbeddingId(embeddingId: string): Promise<RAGChunkEntity[]> {
        return await this.ragChunkModel.getChunksByEmbeddingId(embeddingId);
    }

    /**
     * Get chunks without embeddings
     */
    async getChunksWithoutEmbeddings(documentId?: number): Promise<RAGChunkEntity[]> {
        return await this.ragChunkModel.getChunksWithoutEmbeddings(documentId);
    }
}
