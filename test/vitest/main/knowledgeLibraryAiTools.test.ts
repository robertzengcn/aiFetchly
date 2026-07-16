"use strict";
import { describe, test, expect, vi } from "vitest";

// Mock Electron app + the transitive deps pulled in by RagSearchModule /
// RAGDocumentModule so importing the service does not touch electron or the DB.
vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/tmp/test-appdata"),
  },
}));

vi.mock("@/service/VectorStoreService", () => ({
  VectorStoreService: vi.fn().mockImplementation(function () {
    return { initialize: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock("@/modules/ConfigurationService", () => ({
  ConfigurationServiceImpl: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@/service/ChunkingService", () => ({
  ChunkingService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@/api/ragConfigApi", () => ({
  RagConfigApi: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(function () {
    return { getDefaultEmbeddingModel: vi.fn().mockResolvedValue(null) };
  }),
}));

vi.mock("@/modules/SystemSettingGroupModule", () => ({
  SystemSettingGroupModule: vi.fn().mockImplementation(function () {
    return { getOrCreateEmbeddingGroup: vi.fn().mockResolvedValue({}) };
  }),
}));

import { KnowledgeLibraryAiTools } from "@/service/KnowledgeLibraryAiTools";
import type { KnowledgeLibraryAiToolsDeps } from "@/service/KnowledgeLibraryAiTools";
import type { DocumentService } from "@/service/DocumentService";
import type { RagSearchModule } from "@/modules/RagSearchModule";
import type { RAGDocumentModule } from "@/modules/RAGDocumentModule";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { RAGDocumentEntity } from "@/entity/RAGDocument.entity";

function makeDoc(over: Partial<RAGDocumentEntity> = {}): RAGDocumentEntity {
  return {
    id: 1,
    name: "pricing-guide.pdf",
    filePath: "/tmp/rag_uploads/pricing-guide.pdf",
    fileType: ".pdf",
    fileSize: 183920,
    status: "active",
    processingStatus: "completed",
    title: "Pricing Guide",
    description: "Uploaded document: pricing-guide.pdf",
    tags: JSON.stringify(["pricing", "sales"]),
    author: "User",
    uploadedAt: new Date("2026-07-15T09:20:00.000Z"),
    ...over,
  } as unknown as RAGDocumentEntity;
}

const baseContext: SkillExecutionContext = {
  conversationId: "conv-123",
  toolCallId: "call-1",
};

interface FakeDeps {
  deps: KnowledgeLibraryAiToolsDeps;
  documentService: {
    getStagedAttachmentImportSource: ReturnType<typeof vi.fn>;
    copyStagedSourceToUploads: ReturnType<typeof vi.fn>;
    findDocumentById: ReturnType<typeof vi.fn>;
    deleteDocument: ReturnType<typeof vi.fn>;
  };
  ragDocumentModule: {
    getDocuments: ReturnType<typeof vi.fn>;
    validateFile: ReturnType<typeof vi.fn>;
    checkDuplicate: ReturnType<typeof vi.fn>;
  };
  ragSearchModule: {
    initializeRagModule: ReturnType<typeof vi.fn>;
    uploadDocument: ReturnType<typeof vi.fn>;
  };
}

function buildTools(opts: { aiEnabled?: boolean } = {}): FakeDeps {
  const documentService = {
    getStagedAttachmentImportSource: vi.fn(),
    copyStagedSourceToUploads: vi.fn(),
    findDocumentById: vi.fn(),
    deleteDocument: vi.fn(),
  };
  const ragDocumentModule = {
    getDocuments: vi.fn(),
    validateFile: vi.fn(),
    checkDuplicate: vi.fn(),
  };
  const ragSearchModule = {
    initializeRagModule: vi.fn().mockResolvedValue(undefined),
    uploadDocument: vi.fn(),
  };
  const deps: KnowledgeLibraryAiToolsDeps = {
    documentService: documentService as unknown as DocumentService,
    ragDocumentModule: ragDocumentModule as unknown as RAGDocumentModule,
    ragSearchModule: ragSearchModule as unknown as RagSearchModule,
    isAiEnabled: () => opts.aiEnabled ?? true,
  };
  return { deps, documentService, ragDocumentModule, ragSearchModule };
}

// ---------------------------------------------------------------------------
// listDocuments
// ---------------------------------------------------------------------------

describe("KnowledgeLibraryAiTools.listDocuments", () => {
  test("returns compact summaries and respects limit clamp", async () => {
    const { deps, ragDocumentModule } = buildTools();
    ragDocumentModule.getDocuments.mockResolvedValue([
      makeDoc({ id: 1 }),
      makeDoc({ id: 2 }),
    ]);
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.listDocuments({ limit: 50, offset: 0 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]).toMatchObject({
      id: 1,
      name: "pricing-guide.pdf",
      fileType: ".pdf",
      tags: ["pricing", "sales"],
    });
    // No raw paths leaked into the summary.
    expect(JSON.stringify(result.documents[0])).not.toContain("filePath");
    expect(result.limit).toBe(50);
    expect(result.returned).toBe(2);
  });

  test("filters by query against name and title", async () => {
    const { deps, ragDocumentModule } = buildTools();
    ragDocumentModule.getDocuments.mockResolvedValue([
      makeDoc({ id: 1, name: "pricing-guide.pdf", title: "Pricing" }),
      makeDoc({ id: 2, name: "sales-report.csv", title: "Sales" }),
    ]);
    const tools = new KnowledgeLibraryAiTools(deps);

    const byTitle = await tools.listDocuments({ query: "pricing" });
    if (!byTitle.success) throw new Error("expected success");
    expect(byTitle.documents.map((d) => d.id)).toEqual([1]);

    const byName = await tools.listDocuments({ query: "sales-report" });
    if (!byName.success) throw new Error("expected success");
    expect(byName.documents.map((d) => d.id)).toEqual([2]);
  });

  test("signals truncated when the scan cap is reached", async () => {
    const { deps, ragDocumentModule } = buildTools();
    const many = Array.from({ length: 200 }, (_, i) => makeDoc({ id: i + 1 }));
    ragDocumentModule.getDocuments.mockResolvedValue(many);
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.listDocuments({ limit: 50 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.truncated).toBe(true);
  });

  test("does not signal truncated below the scan cap", async () => {
    const { deps, ragDocumentModule } = buildTools();
    ragDocumentModule.getDocuments.mockResolvedValue([makeDoc({ id: 1 })]);
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.listDocuments({ limit: 50 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.truncated).toBeFalsy();
  });

  test("maps a backend failure to LIST_FAILED, not INVALID_INPUT", async () => {
    const { deps, ragDocumentModule } = buildTools();
    ragDocumentModule.getDocuments.mockRejectedValue(new Error("db locked"));
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.listDocuments({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("LIST_FAILED");
  });

  test("rejects an out-of-range limit as INVALID_INPUT", async () => {
    const { deps } = buildTools();
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.listDocuments({ limit: 999 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// importAttachment
// ---------------------------------------------------------------------------

describe("KnowledgeLibraryAiTools.importAttachment", () => {
  test("rejects missing attachment_ref as INVALID_INPUT", async () => {
    const tools = new KnowledgeLibraryAiTools(buildTools().deps);
    const result = await tools.importAttachment({}, baseContext);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });

  test("returns AI_DISABLED before resolving files when AI is off", async () => {
    const { deps, documentService } = buildTools({ aiEnabled: false });
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.importAttachment(
      { attachment_ref: "ref-1" },
      baseContext
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("AI_DISABLED");
    expect(
      documentService.getStagedAttachmentImportSource
    ).not.toHaveBeenCalled();
  });

  test("rejects duplicatePolicy replace as INVALID_INPUT", async () => {
    const tools = new KnowledgeLibraryAiTools(buildTools().deps);
    const result = await tools.importAttachment(
      { attachment_ref: "ref-1", duplicatePolicy: "replace" },
      baseContext
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });

  test("maps a missing staged source to ATTACHMENT_NOT_FOUND", async () => {
    const { deps, documentService } = buildTools();
    documentService.getStagedAttachmentImportSource.mockRejectedValue(
      new Error("Attachment original file is no longer available.")
    );
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.importAttachment(
      { attachment_ref: "ref-1" },
      baseContext
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("ATTACHMENT_NOT_FOUND");
  });

  test("imports via RagSearchModule.uploadDocument with the staged source path", async () => {
    const { deps, documentService, ragDocumentModule, ragSearchModule } =
      buildTools();
    documentService.getStagedAttachmentImportSource.mockResolvedValue({
      refId: "ref-1",
      fileName: "pricing-guide.pdf",
      filePath: "/tmp/staged/conv-123/ref-1.pdf",
      sha256: "abc",
      sizeBytes: 183920,
      markdownFallback: false,
    });
    ragDocumentModule.validateFile.mockResolvedValue({
      isValid: true,
      errors: [],
      fileType: ".pdf",
      fileSize: 183920,
    });
    ragDocumentModule.checkDuplicate.mockResolvedValue({
      isDuplicate: false,
      existingDocuments: [],
    });
    // The staged source is copied to a durable app-owned path before upload
    // (the staged file is ephemeral; uploadDocument stores the path verbatim).
    documentService.copyStagedSourceToUploads.mockResolvedValue(
      "/tmp/appdata/uploads/durable-pricing-guide.pdf"
    );
    ragSearchModule.uploadDocument.mockResolvedValue({
      documentId: 42,
      chunksCreated: 37,
      processingTime: 4820,
      document: makeDoc({ id: 42 }),
    });
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.importAttachment(
      {
        attachment_ref: "ref-1",
        tags: ["pricing", "sales"],
        author: "User",
      },
      baseContext
    );

    expect(documentService.copyStagedSourceToUploads).toHaveBeenCalledWith(
      "/tmp/staged/conv-123/ref-1.pdf",
      "pricing-guide.pdf"
    );
    expect(ragSearchModule.uploadDocument).toHaveBeenCalledTimes(1);
    const callArg = ragSearchModule.uploadDocument.mock.calls[0][0] as {
      filePath: string;
      name: string;
      tags?: string[];
    };
    // Must import the durable copy of the staged file — never the ephemeral
    // staged path, and never an arbitrary/model-supplied path.
    expect(callArg.filePath).toBe(
      "/tmp/appdata/uploads/durable-pricing-guide.pdf"
    );
    expect(callArg.name).toBe("pricing-guide.pdf");
    expect(callArg.tags).toEqual(["pricing", "sales"]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.documentId).toBe(42);
    expect(result.chunksCreated).toBe(37);
    expect(result.tags).toEqual(["pricing", "sales"]);
    expect(result.summary).toContain("#42");
  });

  test("returns DUPLICATE_DOCUMENT with existing candidates when policy is fail", async () => {
    const { deps, documentService, ragDocumentModule } = buildTools();
    documentService.getStagedAttachmentImportSource.mockResolvedValue({
      refId: "ref-1",
      fileName: "pricing-guide.pdf",
      filePath: "/tmp/staged/conv-123/ref-1.pdf",
      sizeBytes: 183920,
      markdownFallback: false,
    });
    ragDocumentModule.validateFile.mockResolvedValue({
      isValid: true,
      errors: [],
      fileSize: 183920,
    });
    ragDocumentModule.checkDuplicate.mockResolvedValue({
      isDuplicate: true,
      existingDocuments: [makeDoc({ id: 7 })],
    });
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.importAttachment(
      { attachment_ref: "ref-1", duplicatePolicy: "fail" },
      baseContext
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("DUPLICATE_DOCUMENT");
    expect(result.existingDocuments?.[0].id).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// deleteDocument
// ---------------------------------------------------------------------------

describe("KnowledgeLibraryAiTools.deleteDocument", () => {
  test("rejects missing document as DOCUMENT_NOT_FOUND", async () => {
    const { deps, documentService } = buildTools();
    documentService.findDocumentById.mockResolvedValue(null);
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.deleteDocument({ document_id: 99 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("DOCUMENT_NOT_FOUND");
  });

  test("rejects expected_name mismatch", async () => {
    const { deps, documentService } = buildTools();
    documentService.findDocumentById.mockResolvedValue(
      makeDoc({ id: 5, name: "pricing-guide.pdf", title: "Pricing Guide" })
    );
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.deleteDocument({
      document_id: 5,
      expected_name: "different-name.pdf",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("EXPECTED_NAME_MISMATCH");
  });

  test("deletes via DocumentService.deleteDocument(id, delete_source_file)", async () => {
    const { deps, documentService } = buildTools();
    documentService.findDocumentById.mockResolvedValue(makeDoc({ id: 42 }));
    documentService.deleteDocument.mockResolvedValue(true);
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.deleteDocument({
      document_id: 42,
      delete_source_file: true,
    });

    expect(documentService.deleteDocument).toHaveBeenCalledWith(42, true);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.documentId).toBe(42);
    expect(result.deletedSourceFile).toBe(true);
  });
});
