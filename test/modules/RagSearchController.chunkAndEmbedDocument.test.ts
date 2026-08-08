import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import { RagSearchController } from "@/controller/RagSearchController";
import { RAGDocumentEntity } from "@/entity/RAGDocument.entity";

interface TestableRagSearchController {
  chunkAndEmbedDocument(documentId: number): Promise<{
    documentId: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    success: boolean;
  }>;
  ragSearchModule: {
    getDocument(id: number): Promise<RAGDocumentEntity | null>;
    resetDocumentIndex(document: RAGDocumentEntity): Promise<void>;
    chunkDocument(
      documentId: number,
      options?: unknown
    ): Promise<{
      documentId: number;
      chunksCreated: number;
      processingTime: number;
      success: boolean;
      message: string;
    }>;
    generateDocumentEmbeddings(
      documentId: number,
      modelName: string,
      dimension: number
    ): Promise<{
      documentId: number;
      chunksProcessed: number;
      processingTime: number;
      success: boolean;
      message: string;
    }>;
    checkAndSetDefaultEmbeddingModel(): Promise<void>;
    getDefaultEmbeddingModel(): Promise<{
      modelName: string;
      dimension: number;
    } | null>;
  };
}

describe("RagSearchController.chunkAndEmbedDocument", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("clears existing chunks and vectors before regenerating document embeddings", async () => {
    const callOrder: string[] = [];
    const document = Object.assign(new RAGDocumentEntity(), {
      id: 42,
      name: "guide.md",
      filePath: "/tmp/guide.md",
      fileType: ".md",
      fileSize: 10,
      modelName: "text-embedding-3-small",
      vectorDimensions: 1536,
    });
    const controller = Object.create(
      RagSearchController.prototype
    ) as TestableRagSearchController;

    Object.assign(controller, {
      ragSearchModule: {
        getDocument: sinon.stub().callsFake(async () => {
          callOrder.push("getDocument");
          return document;
        }),
        resetDocumentIndex: sinon.stub().callsFake(async () => {
          callOrder.push("resetDocumentIndex");
        }),
        chunkDocument: sinon.stub().callsFake(async () => {
          callOrder.push("chunkDocument");
          return {
            documentId: 42,
            chunksCreated: 3,
            processingTime: 5,
            success: true,
            message: "Document chunked successfully into 3 chunks",
          };
        }),
        checkAndSetDefaultEmbeddingModel: sinon.stub().callsFake(async () => {
          callOrder.push("checkAndSetDefaultEmbeddingModel");
        }),
        getDefaultEmbeddingModel: sinon.stub().resolves({
          modelName: "text-embedding-3-small",
          dimension: 1536,
        }),
        generateDocumentEmbeddings: sinon.stub().callsFake(async () => {
          callOrder.push("generateDocumentEmbeddings");
          return {
            documentId: 42,
            chunksProcessed: 3,
            processingTime: 7,
            success: true,
            message: "Generated embeddings for 3 chunks",
          };
        }),
      },
    });

    const result = await controller.chunkAndEmbedDocument(42);

    expect(result.success).to.equal(true);
    expect(result.chunksCreated).to.equal(3);
    expect(result.embeddingsGenerated).to.equal(3);
    expect(callOrder).to.deep.equal([
      "getDocument",
      "resetDocumentIndex",
      "chunkDocument",
      "checkAndSetDefaultEmbeddingModel",
      "generateDocumentEmbeddings",
    ]);
  });
});
