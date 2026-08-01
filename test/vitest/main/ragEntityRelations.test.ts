import { describe, expect, it } from "vitest";
import { getMetadataArgsStorage } from "typeorm";
import "@/config/SqliteDb";
import { RAGChunkEntity } from "@/entity/RAGChunk.entity";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";

describe("RAG entity relations", () => {
  it("does not use minification-fragile string targets in any registered entity relation", () => {
    const stringTargetRelations = getMetadataArgsStorage()
      .relations.filter((relation) => typeof relation.type === "string")
      .map((relation) => `${String(relation.target)}#${relation.propertyName}`);

    expect(stringTargetRelations).toEqual([]);
  });

  it("uses constructor callbacks instead of class-name strings", () => {
    const relations = getMetadataArgsStorage().relations;
    const documentChunksRelation = relations.find(
      (relation) =>
        relation.target === RAGDocumentEntity &&
        relation.propertyName === "chunks"
    );
    const chunkDocumentRelation = relations.find(
      (relation) =>
        relation.target === RAGChunkEntity &&
        relation.propertyName === "document"
    );

    expect(documentChunksRelation).toBeDefined();
    expect(chunkDocumentRelation).toBeDefined();

    expect(typeof documentChunksRelation?.type).toBe("function");
    expect(typeof chunkDocumentRelation?.type).toBe("function");
    expect((documentChunksRelation?.type as () => unknown)()).toBe(
      RAGChunkEntity
    );
    expect((chunkDocumentRelation?.type as () => unknown)()).toBe(
      RAGDocumentEntity
    );
  });
});
