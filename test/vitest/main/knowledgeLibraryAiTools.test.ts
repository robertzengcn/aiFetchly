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
import type { WebsiteKnowledgeImportService } from "@/service/WebsiteKnowledgeImportService";
import type { WebsiteImportSource } from "@/service/WebsiteKnowledgeImportService";
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
    findDocumentById: ReturnType<typeof vi.fn>;
    deleteDocument: ReturnType<typeof vi.fn>;
  };
  ragDocumentModule: {
    getDocuments: ReturnType<typeof vi.fn>;
    validateFile: ReturnType<typeof vi.fn>;
    checkDuplicate: ReturnType<typeof vi.fn>;
    findWebsiteDuplicate: ReturnType<typeof vi.fn>;
  };
  ragSearchModule: {
    initializeRagModule: ReturnType<typeof vi.fn>;
    uploadDocument: ReturnType<typeof vi.fn>;
  };
  websiteImportService: {
    prepareImportSources: ReturnType<typeof vi.fn>;
  };
}

function buildTools(opts: { aiEnabled?: boolean } = {}): FakeDeps {
  const documentService = {
    getStagedAttachmentImportSource: vi.fn(),
    findDocumentById: vi.fn(),
    deleteDocument: vi.fn(),
  };
  const ragDocumentModule = {
    getDocuments: vi.fn(),
    validateFile: vi.fn(),
    checkDuplicate: vi.fn(),
    findWebsiteDuplicate: vi.fn().mockResolvedValue(undefined),
  };
  const ragSearchModule = {
    initializeRagModule: vi.fn().mockResolvedValue(undefined),
    uploadDocument: vi.fn(),
  };
  const websiteImportService = {
    prepareImportSources: vi.fn(),
  };
  const deps: KnowledgeLibraryAiToolsDeps = {
    documentService: documentService as unknown as DocumentService,
    ragDocumentModule: ragDocumentModule as unknown as RAGDocumentModule,
    ragSearchModule: ragSearchModule as unknown as RagSearchModule,
    websiteImportService:
      websiteImportService as unknown as WebsiteKnowledgeImportService,
    isAiEnabled: () => opts.aiEnabled ?? true,
  };
  return {
    deps,
    documentService,
    ragDocumentModule,
    ragSearchModule,
    websiteImportService,
  };
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

    expect(ragSearchModule.uploadDocument).toHaveBeenCalledTimes(1);
    const callArg = ragSearchModule.uploadDocument.mock.calls[0][0] as {
      filePath: string;
      name: string;
      tags?: string[];
    };
    // Must import the containment-checked staged source — never an arbitrary
    // or model-supplied path. RAGDocumentModule.uploadDocument copies it into
    // app-owned rag_uploads and persists that durable path.
    expect(callArg.filePath).toBe("/tmp/staged/conv-123/ref-1.pdf");
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
// importWebsite
// ---------------------------------------------------------------------------

function makeSource(
  over: Partial<WebsiteImportSource> = {}
): WebsiteImportSource {
  return {
    sourceUrl: "https://example.com/pricing",
    finalUrl: "https://example.com/pricing/",
    title: "Pricing",
    fileName: "example.com-pricing-a1b2c3d4.md",
    filePath: "/tmp/website-imports/web-run/example.com-pricing-a1b2c3d4.md",
    sizeBytes: 4096,
    contentSha256: "a".repeat(64),
    importGroupId: "web-1234-abcd",
    sourceRootUrl: "https://example.com",
    crawledAt: new Date("2026-07-24T10:00:00.000Z"),
    ...over,
  } as WebsiteImportSource;
}

describe("KnowledgeLibraryAiTools.importWebsite", () => {
  test("rejects a missing url for single_page as INVALID_INPUT", async () => {
    const tools = new KnowledgeLibraryAiTools(buildTools().deps);
    const result = await tools.importWebsite(
      { mode: "single_page" },
      baseContext
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });

  test("rejects missing urls for url_list as INVALID_INPUT", async () => {
    const tools = new KnowledgeLibraryAiTools(buildTools().deps);
    const result = await tools.importWebsite({ mode: "url_list" }, baseContext);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
  });

  test("returns AI_DISABLED before scraping when AI is off", async () => {
    const { deps, websiteImportService } = buildTools({ aiEnabled: false });
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.importWebsite(
      { mode: "single_page", url: "https://example.com" },
      baseContext
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("AI_DISABLED");
    expect(websiteImportService.prepareImportSources).not.toHaveBeenCalled();
  });

  test("rejects duplicatePolicy replace as INVALID_INPUT before scraping", async () => {
    const { deps, websiteImportService } = buildTools();
    const tools = new KnowledgeLibraryAiTools(deps);
    const result = await tools.importWebsite(
      {
        mode: "single_page",
        url: "https://example.com",
        duplicatePolicy: "replace",
      },
      baseContext
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("INVALID_INPUT");
    expect(websiteImportService.prepareImportSources).not.toHaveBeenCalled();
  });

  test("imports the staged markdown via uploadDocument and exposes no local path", async () => {
    const { deps, websiteImportService, ragDocumentModule, ragSearchModule } =
      buildTools();
    const source = makeSource();
    websiteImportService.prepareImportSources.mockResolvedValue({
      mode: "single_page",
      sources: [source],
      skipped: [],
      requestedCount: 1,
    });
    ragDocumentModule.validateFile.mockResolvedValue({
      isValid: true,
      errors: [],
      fileType: ".md",
      fileSize: 4096,
    });
    ragDocumentModule.findWebsiteDuplicate.mockResolvedValue(undefined);
    ragSearchModule.uploadDocument.mockResolvedValue({
      documentId: 42,
      chunksCreated: 9,
      processingTime: 2400,
      document: makeDoc({ id: 42, name: source.fileName, fileType: ".md" }),
    });
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.importWebsite(
      {
        mode: "single_page",
        url: "https://example.com/pricing",
        tags: ["pricing"],
      },
      baseContext
    );

    expect(ragSearchModule.uploadDocument).toHaveBeenCalledTimes(1);
    const callArg = ragSearchModule.uploadDocument.mock.calls[0][0] as {
      filePath: string;
      sourceType?: string;
      sourceUrl?: string;
      contentSha256?: string;
      importGroupId?: string;
    };
    // filePath must be the app-owned staged markdown file, never the URL.
    expect(callArg.filePath).toBe(source.filePath);
    expect(callArg.filePath).not.toMatch(/^https?:\/\//);
    expect(callArg.sourceType).toBe("webpage");
    expect(callArg.sourceUrl).toBe("https://example.com/pricing");
    expect(callArg.contentSha256).toBe(source.contentSha256);
    expect(callArg.importGroupId).toBe(source.importGroupId);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.importedCount).toBe(1);
    expect(result.imported[0].sourceUrl).toBe("https://example.com/pricing");
    expect(result.imported[0].chunksCreated).toBe(9);
    // No raw local paths leak into the model-facing result.
    expect(JSON.stringify(result)).not.toContain(source.filePath);
  });

  test("skips a duplicate page with DUPLICATE_DOCUMENT and does not upload", async () => {
    const { deps, websiteImportService, ragDocumentModule, ragSearchModule } =
      buildTools();
    websiteImportService.prepareImportSources.mockResolvedValue({
      mode: "single_page",
      sources: [makeSource()],
      skipped: [],
      requestedCount: 1,
    });
    ragDocumentModule.validateFile.mockResolvedValue({
      isValid: true,
      errors: [],
      fileType: ".md",
      fileSize: 4096,
    });
    ragDocumentModule.findWebsiteDuplicate.mockResolvedValue(
      makeDoc({ id: 7 })
    );
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.importWebsite(
      { mode: "single_page", url: "https://example.com/pricing" },
      baseContext
    );

    expect(ragSearchModule.uploadDocument).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("DUPLICATE_DOCUMENT");
  });

  test("returns partial success when url_list has a mix of good and bad pages", async () => {
    const { deps, websiteImportService, ragDocumentModule, ragSearchModule } =
      buildTools();
    websiteImportService.prepareImportSources.mockResolvedValue({
      mode: "url_list",
      sources: [
        makeSource({ sourceUrl: "https://example.com/good" }),
        makeSource({ sourceUrl: "https://example.com/bad" }),
      ],
      skipped: [],
      requestedCount: 2,
    });
    ragDocumentModule.validateFile
      .mockResolvedValueOnce({
        isValid: true,
        errors: [],
        fileType: ".md",
        fileSize: 4096,
      })
      .mockResolvedValueOnce({
        isValid: false,
        errors: ["Unsupported file type: .exe"],
      });
    ragDocumentModule.findWebsiteDuplicate.mockResolvedValue(undefined);
    ragSearchModule.uploadDocument.mockResolvedValue({
      documentId: 50,
      chunksCreated: 3,
      processingTime: 900,
      document: makeDoc({ id: 50, fileType: ".md" }),
    });
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.importWebsite(
      {
        mode: "url_list",
        urls: ["https://example.com/good", "https://example.com/bad"],
      },
      baseContext
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0].code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  test("returns an aggregate failure code when no pages import", async () => {
    const { deps, websiteImportService } = buildTools();
    websiteImportService.prepareImportSources.mockResolvedValue({
      mode: "single_page",
      sources: [],
      skipped: [
        {
          url: "http://localhost",
          reason: "blocked by SSRF guard",
          code: "URL_BLOCKED",
        },
      ],
      requestedCount: 1,
    });
    const tools = new KnowledgeLibraryAiTools(deps);

    const result = await tools.importWebsite(
      { mode: "single_page", url: "http://localhost" },
      baseContext
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("URL_BLOCKED");
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
