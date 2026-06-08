import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";

export interface KeywordSearchHit {
  id: number;
  documentId: number;
  content: string;
  chunkIndex: number;
  score: number;
}

export interface NeighborChunkData {
  chunkId: number;
  chunkIndex: number;
  content: string;
}

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
  async findChunkByHash(
    contentHash: string,
    documentId: number
  ): Promise<RAGChunkEntity | null> {
    return await this.repository.findOne({
      where: { contentHash, documentId },
    });
  }

  /**
   * Get all chunks for a document ordered by chunk index
   */
  async getDocumentChunks(documentId: number): Promise<RAGChunkEntity[]> {
    return await this.repository.find({
      where: { documentId },
      order: { chunkIndex: "ASC" },
    });
  }

  /**
   * Get chunk IDs for a document (synchronous)
   * Uses underlying better-sqlite3 database for synchronous queries
   */
  getDocumentChunkIds(documentId: number): number[] {
    try {
      // Access underlying better-sqlite3 database through TypeORM driver
      const driver = this.sqliteDb.connection.driver as any;
      const database = driver.database;

      if (!database) {
        console.warn(
          "Unable to access underlying database for synchronous query"
        );
        return [];
      }

      // Execute synchronous query to get chunk IDs
      const query = `SELECT id FROM rag_chunks WHERE documentId = ? ORDER BY chunkIndex ASC`;
      const results = database.prepare(query).all(documentId) as Array<{
        id: number;
      }>;

      return results.map((row) => row.id);
    } catch (error) {
      console.error("Failed to get chunk IDs for document:", error);
      return [];
    }
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
    const queryBuilder = this.repository.createQueryBuilder("chunk");

    if (documentId) {
      queryBuilder.where("chunk.documentId = :documentId", { documentId });
    }

    const chunks = await queryBuilder.getMany();

    const totalChunks = chunks.length;
    const totalTokens = chunks.reduce(
      (sum, chunk) => sum + chunk.tokenCount,
      0
    );
    const averageChunkSize = totalChunks > 0 ? totalTokens / totalChunks : 0;

    return {
      totalChunks,
      averageChunkSize,
      totalTokens,
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
  async updateChunkEmbedding(
    chunkId: number,
    embeddingId: string
  ): Promise<boolean> {
    const result = await this.repository.update(
      { id: chunkId },
      { embeddingId }
    );
    return (result.affected || 0) > 0;
  }

  /**
   * Get chunks by embedding ID
   */
  async getChunksByEmbeddingId(embeddingId: string): Promise<RAGChunkEntity[]> {
    return await this.repository.find({
      where: { embeddingId },
    });
  }

  /**
   * Get chunks without embeddings
   */
  async getChunksWithoutEmbeddings(
    documentId?: number
  ): Promise<RAGChunkEntity[]> {
    const queryBuilder = this.repository
      .createQueryBuilder("chunk")
      .where("chunk.embeddingId IS NULL");

    if (documentId) {
      queryBuilder.andWhere("chunk.documentId = :documentId", { documentId });
    }

    return await queryBuilder.getMany();
  }

  /**
   * Get chunks by IDs with their associated documents
   */
  async getChunksByIds(chunkIds: number[]): Promise<RAGChunkEntity[]> {
    return await this.repository
      .createQueryBuilder("chunk")
      .leftJoinAndSelect("chunk.document", "document")
      .where("chunk.id IN (:...chunkIds)", { chunkIds })
      .getMany();
  }

  /**
   * Search chunks by content
   */
  async searchChunksByContent(
    query: string,
    limit = 10
  ): Promise<RAGChunkEntity[]> {
    return await this.repository
      .createQueryBuilder("chunk")
      .select(["chunk.content"])
      .where("chunk.content LIKE :query", { query: `%${query}%` })
      .limit(limit)
      .getMany();
  }

  /**
   * Get total chunk count
   */
  async getTotalChunkCount(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Get average token count
   */
  async getAverageTokenCount(): Promise<number> {
    const result = await this.repository
      .createQueryBuilder("chunk")
      .select("AVG(chunk.tokenCount)", "avgTokens")
      .getRawOne();

    return parseFloat(result?.avgTokens) || 0;
  }

  /**
   * Keyword search over chunk content.
   * Tokenises the query, extracts quoted phrases, and matches with LIKE.
   * Returns hits with a simple score based on phrase/term match count.
   * Optionally restricts to specific document IDs.
   */
  async searchChunksByKeywords(
    query: string,
    options: { limit: number; documentIds?: number[] }
  ): Promise<KeywordSearchHit[]> {
    const { limit, documentIds } = options;

    // Extract quoted phrases and remaining terms
    const phrases: string[] = [];
    const quotedRegex = /"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = quotedRegex.exec(query)) !== null) {
      if (match[1].trim()) {
        phrases.push(match[1].trim());
      }
    }
    const remaining = query.replace(/"[^"]*"/g, "").trim();
    const terms = remaining
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1);

    if (phrases.length === 0 && terms.length === 0) {
      return [];
    }

    // Build WHERE clause for phrases and terms
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    phrases.forEach((phrase, i) => {
      const paramName = `phrase_${i}`;
      conditions.push(`chunk.content LIKE :${paramName}`);
      params[paramName] = `%${phrase}%`;
    });

    terms.forEach((term, i) => {
      const paramName = `term_${i}`;
      conditions.push(`chunk.content LIKE :${paramName}`);
      params[paramName] = `%${term}%`;
    });

    const qb = this.repository
      .createQueryBuilder("chunk")
      .leftJoinAndSelect("chunk.document", "document")
      .where(`(${conditions.join(" OR ")})`, params);

    if (documentIds && documentIds.length > 0) {
      qb.andWhere("chunk.documentId IN (:...keywordDocIds)", {
        keywordDocIds: documentIds,
      });
    }

    // Fetch more than needed so we can score and rank
    qb.limit(limit * 3);

    const chunks = await qb.getMany();

    // Score each chunk by counting how many phrases/terms match
    const scored: KeywordSearchHit[] = chunks.map((chunk) => {
      const lowerContent = chunk.content.toLowerCase();
      let score = 0;

      for (const phrase of phrases) {
        if (lowerContent.includes(phrase.toLowerCase())) {
          score += 3; // Phrase matches weight more
        }
      }
      for (const term of terms) {
        if (lowerContent.includes(term.toLowerCase())) {
          score += 1;
        }
      }

      return {
        id: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        score,
      };
    });

    // Sort by score descending, take top limit
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Get neighbor chunks (previous and next by chunkIndex) for a given chunk.
   * Only returns chunks from the same document.
   */
  async getNeighborChunks(
    chunkId: number,
    windowSize = 1
  ): Promise<{ previous: NeighborChunkData[]; next: NeighborChunkData[] }> {
    const chunk = await this.repository.findOne({ where: { id: chunkId } });
    if (!chunk) {
      return { previous: [], next: [] };
    }

    const previousChunks = await this.repository
      .createQueryBuilder("chunk")
      .where("chunk.documentId = :docId", { docId: chunk.documentId })
      .andWhere("chunk.chunkIndex < :currentIndex", {
        currentIndex: chunk.chunkIndex,
      })
      .orderBy("chunk.chunkIndex", "DESC")
      .limit(windowSize)
      .getMany();

    const nextChunks = await this.repository
      .createQueryBuilder("chunk")
      .where("chunk.documentId = :docId", { docId: chunk.documentId })
      .andWhere("chunk.chunkIndex > :currentIndex", {
        currentIndex: chunk.chunkIndex,
      })
      .orderBy("chunk.chunkIndex", "ASC")
      .limit(windowSize)
      .getMany();

    return {
      previous: previousChunks.map((c) => ({
        chunkId: c.id,
        chunkIndex: c.chunkIndex,
        content: c.content,
      })),
      next: nextChunks.map((c) => ({
        chunkId: c.id,
        chunkIndex: c.chunkIndex,
        content: c.content,
      })),
    };
  }
}
