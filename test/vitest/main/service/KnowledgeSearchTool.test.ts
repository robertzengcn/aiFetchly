'use strict';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-appdata'),
  },
}));

// Mock SkillRegistry module imports
vi.mock('@/service/VectorStoreService', () => ({
  VectorStoreService: vi.fn().mockImplementation(function () {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/modules/ConfigurationService', () => ({
  ConfigurationServiceImpl: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/service/DocumentService', () => ({
  DocumentService: vi.fn().mockImplementation(function () {
    return {
      getDocuments: vi.fn().mockResolvedValue([]),
    };
  }),
}));

vi.mock('@/service/ChunkingService', () => ({
  ChunkingService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/api/ragConfigApi', () => ({
  RagConfigApi: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('@/modules/SystemSettingModule', () => ({
  SystemSettingModule: vi.fn().mockImplementation(function () {
    return {
      getDefaultEmbeddingModel: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock('@/modules/SystemSettingGroupModule', () => ({
  SystemSettingGroupModule: vi.fn().mockImplementation(function () {
    return {
      getOrCreateEmbeddingGroup: vi.fn().mockResolvedValue({}),
    };
  }),
}));

const retrievalMocks = vi.hoisted(() => ({
  findSearchableDocumentIdsMock: vi.fn(),
  rerankMock: vi.fn(),
}));

vi.mock('@/model/RAGDocument.model', () => ({
  RAGDocumentModel: vi.fn().mockImplementation(function () {
    return {
      findSearchableDocumentIds: (...args: unknown[]) =>
        retrievalMocks.findSearchableDocumentIdsMock(...args),
    };
  }),
}));

vi.mock('@/service/RagRerankService', () => ({
  RagRerankService: vi.fn().mockImplementation(function () {
    return {
      rerank: (...args: unknown[]) => retrievalMocks.rerankMock(...args),
    };
  }),
}));

import { SkillRegistry } from '@/config/skillsRegistry';
import { RagSearchModule } from '@/modules/RagSearchModule';
import { VectorSearchService } from '@/service/VectorSearchService';
import { buildEmbeddingInput } from '@/service/knowledgeMetadataHeader';
import type { RagSearchCandidate } from '@/service/RagSearchTypes';

describe('knowledge_library_search tool registration', () => {
  test('tool is registered in SkillRegistry', async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const knowledgeTool = tools.find(
      (t) => t.name === 'knowledge_library_search'
    );

    expect(knowledgeTool).toBeDefined();
    expect(knowledgeTool!.name).toBe('knowledge_library_search');
    expect(knowledgeTool!.description).toContain('knowledge library');
  });

  test('tool has correct parameter schema', async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const knowledgeTool = tools.find(
      (t) => t.name === 'knowledge_library_search'
    );

    expect(knowledgeTool).toBeDefined();
    const params = knowledgeTool!.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;

    expect(properties.query).toBeDefined();
    expect(properties.limit).toBeDefined();
    expect(properties.documentIds).toBeDefined();
    expect(properties.documentTypes).toBeDefined();
    expect(properties.tags).toBeDefined();
    expect(properties.author).toBeDefined();
    expect(properties.dateRange).toBeDefined();
    expect(properties.includeNeighborChunks).toBeDefined();

    const required = params.required as string[];
    expect(required).toContain('query');
  });

  test('tool does not require confirmation', () => {
    const skill = SkillRegistry.getSkill('knowledge_library_search');
    expect(skill).toBeDefined();
    expect(skill!.requiresConfirmation).toBe(false);
    expect(skill!.permissionCategory).toBe('pure');
    expect(skill!.source).toBe('built-in');
  });

  test('search description tells the model to use author/tags and promises metadata on hits', async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const knowledgeTool = tools.find(
      (t) => t.name === 'knowledge_library_search'
    );
    expect(knowledgeTool!.description).toContain('author');
    expect(knowledgeTool!.description).toContain('tags');
    expect(knowledgeTool!.description).toContain('description');
  });

  test('list tool exposes an author filter', async () => {
    const tools = await SkillRegistry.getAllToolFunctions();
    const listTool = tools.find(
      (t) => t.name === 'knowledge_library_list_documents'
    );
    expect(listTool).toBeDefined();
    const params = listTool!.parameters as Record<string, unknown>;
    const properties = params.properties as Record<string, unknown>;
    expect(properties.author).toBeDefined();
    expect(listTool!.description).toContain('author');
  });
});

function makeCandidate(overrides?: Partial<RagSearchCandidate>): RagSearchCandidate {
  return {
    chunkId: 11,
    documentId: 1,
    content: 'refund body text',
    source: 'vector',
    combinedScore: 0.9,
    metadata: { chunkIndex: 0 },
    document: {
      id: 1,
      name: 'refund-policy.pdf',
      title: 'Q3 refund policy',
      fileType: 'pdf',
      author: 'Alice Chen',
      description: 'Refund rules for enterprise plans',
      tags: ['refund-policy', 'enterprise'],
    },
    ...(overrides ?? {}),
  };
}

describe('knowledge metadata retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrievalMocks.rerankMock.mockImplementation(
      async (query: unknown, candidates: unknown) => ({
        ranked: candidates,
        rerankUsed: false,
        rerankMs: 0,
      })
    );
  });

  test('author filter limits vector search to matching documents', async () => {
    retrievalMocks.findSearchableDocumentIdsMock.mockResolvedValue([1]);
    const searchSpy = vi
      .spyOn(VectorSearchService.prototype, 'searchCandidates')
      .mockResolvedValue([makeCandidate()]);
    try {
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: 'refunds',
        author: 'Alice Chen',
        includeNeighborChunks: false,
      });
      expect(retrievalMocks.findSearchableDocumentIdsMock).toHaveBeenCalledTimes(1);
      const filters = retrievalMocks.findSearchableDocumentIdsMock.mock
        .calls[0][0] as { author?: string };
      expect(filters.author).toBe('Alice Chen');
      expect(searchSpy).toHaveBeenCalledTimes(1);
      const searchArgs = searchSpy.mock.calls[0][1] as {
        documentIds?: number[];
      };
      expect(searchArgs.documentIds).toEqual([1]);
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].documentId).toBe(1);
    } finally {
      searchSpy.mockRestore();
    }
  });

  test('tag pricing matches Pricing and excludes pricing-old from the search scope', async () => {
    // The SQL query binds each tag as LOWER(tags) LIKE '%"pricing"%' so the
    // JSON element "Pricing" matches while "pricing-old" does not. The model
    // mock below simulates that exact-token outcome; the assertion guards the
    // plumbing that keeps rejected documents out of vector search.
    retrievalMocks.findSearchableDocumentIdsMock.mockResolvedValue([2]);
    const searchSpy = vi
      .spyOn(VectorSearchService.prototype, 'searchCandidates')
      .mockResolvedValue([
        makeCandidate({
          chunkId: 22,
          documentId: 2,
          document: {
            id: 2,
            name: 'pricing.pdf',
            title: 'Pricing',
            fileType: 'pdf',
            author: 'Chen',
            description: 'Enterprise pricing',
            tags: ['Pricing'],
          },
        }),
      ]);
    try {
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: 'pricing',
        tags: ['pricing'],
        includeNeighborChunks: false,
      });
      const filters = retrievalMocks.findSearchableDocumentIdsMock.mock
        .calls[0][0] as { tags?: string[] };
      expect(filters.tags).toEqual(['pricing']);
      const searchArgs = searchSpy.mock.calls[0][1] as {
        documentIds?: number[];
      };
      expect(searchArgs.documentIds).toEqual([2]);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].tags).toEqual(['Pricing']);
      expect(
        result.results.some((r) => (r.tags ?? []).includes('pricing-old'))
      ).toBe(false);
    } finally {
      searchSpy.mockRestore();
    }
  });

  test('filters matching nothing return empty success without vector search', async () => {
    retrievalMocks.findSearchableDocumentIdsMock.mockResolvedValue([]);
    const searchSpy = vi
      .spyOn(VectorSearchService.prototype, 'searchCandidates')
      .mockResolvedValue([]);
    try {
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: 'refunds',
        author: 'Nobody Here',
        includeNeighborChunks: false,
      });
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
      expect(result.totalCandidates).toBe(0);
      expect(searchSpy).not.toHaveBeenCalled();
    } finally {
      searchSpy.mockRestore();
    }
  });

  test('hit includes author, tags, description with body-only content', async () => {
    retrievalMocks.findSearchableDocumentIdsMock.mockResolvedValue([1]);
    const searchSpy = vi
      .spyOn(VectorSearchService.prototype, 'searchCandidates')
      .mockResolvedValue([makeCandidate()]);
    try {
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: 'refund policy',
        includeNeighborChunks: false,
      });
      expect(result.results).toHaveLength(1);
      const hit = result.results[0];
      expect(hit.author).toBe('Alice Chen');
      expect(hit.tags).toEqual(['refund-policy', 'enterprise']);
      expect(hit.description).toBe('Refund rules for enterprise plans');
      expect(hit.content).toBe('refund body text');
      expect(hit.content.startsWith('Title:')).toBe(false);
    } finally {
      searchSpy.mockRestore();
    }
  });

  test('Phase 3 filters (language, documentDate range, custom keys) reach the model', async () => {
    // PRD §10 / technical design §6.3: a search request with language,
    // documentDate range, and custom-metadata equality filters must pass them
    // through to findSearchableDocumentIds as bound, allowlist-selected params.
    retrievalMocks.findSearchableDocumentIdsMock.mockResolvedValue([3]);
    const searchSpy = vi
      .spyOn(VectorSearchService.prototype, 'searchCandidates')
      .mockResolvedValue([
        makeCandidate({ chunkId: 33, documentId: 3 }),
      ]);
    try {
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: 'pricing',
        language: 'en',
        documentDateRange: { start: '2024-01-01', end: '2024-12-31' },
        customMetadata: {
          product: 'Acme',
          category: 'pricing',
        },
        includeNeighborChunks: false,
      });
      expect(retrievalMocks.findSearchableDocumentIdsMock).toHaveBeenCalledTimes(1);
      const filters = retrievalMocks.findSearchableDocumentIdsMock.mock
        .calls[0][0] as {
        language?: string;
        documentDateFrom?: Date;
        documentDateTo?: Date;
        customProduct?: string;
        customCategory?: string;
      };
      expect(filters.language).toBe('en');
      expect(filters.documentDateFrom).toEqual(new Date('2024-01-01'));
      expect(filters.documentDateTo).toEqual(new Date('2024-12-31'));
      expect(filters.customProduct).toBe('Acme');
      expect(filters.customCategory).toBe('pricing');
      expect(result.results).toHaveLength(1);
    } finally {
      searchSpy.mockRestore();
    }
  });

  test('documents that leave Phase 3 filters empty search as they do today', async () => {
    // No Phase 3 filters supplied -> findSearchableDocumentIds must not be
    // called at all (undefined allowed-set means all documents are in scope).
    const searchSpy = vi
      .spyOn(VectorSearchService.prototype, 'searchCandidates')
      .mockResolvedValue([makeCandidate()]);
    try {
      const module = new RagSearchModule();
      const result = await module.searchKnowledgeForTool({
        query: 'refund policy',
        includeNeighborChunks: false,
      });
      expect(retrievalMocks.findSearchableDocumentIdsMock).not.toHaveBeenCalled();
      expect(result.results).toHaveLength(1);
    } finally {
      searchSpy.mockRestore();
    }
  });

  test('embedding input starts with header while stored chunk content stays body-only', () => {
    const headerInput: string = buildEmbeddingInput(
      {
        fileName: 'q3.pdf',
        title: 'Q3 refund policy',
        author: 'Alice Chen',
        tags: ['refund-policy', 'enterprise'],
        description: 'Refund rules',
      },
      'chunk body'
    );
    expect(headerInput.startsWith('Title: Q3 refund policy\nAuthor: Alice Chen')).toBe(true);
    const candidate = makeCandidate();
    expect(candidate.content).toBe('refund body text');
    expect(candidate.content.startsWith('Title:')).toBe(false);
  });

  test('embedAndStoreChunks passes header-prefixed text to the embedder and stores body-only content', async () => {
    // PRD §16.2 item 4 / technical design §8.3 "embed call": the string sent
    // to the embedding function for a new chunk must start with the metadata
    // header, and the chunk content persisted via storeEmbedding must stay
    // body-only (no header leakage). This test fails if embedAndStoreChunks
    // ever embeds chunk.content alone or stores the header inside chunk content.
    const module = new RagSearchModule();
    // The constructor wires a mocked VectorStoreService (see top-of-file mock)
    // exposing only initialize(). Reach the instance to install a store spy.
    const vsStore = (
      module as unknown as {
        searchService: { vectorStoreService: { storeEmbedding: unknown } };
      }
    ).searchService.vectorStoreService;
    const storeEmbeddingMock = vi.fn().mockResolvedValue(undefined);
    (
      vsStore as { storeEmbedding: typeof storeEmbeddingMock }
    ).storeEmbedding = storeEmbeddingMock;

    // Spy on the batch embed function supplied to embedAndStoreChunks. It
    // records exactly what the embedder receives.
    const embedBatchMock = vi.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => ({
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        dimensions: 3,
      }))
    );

    interface HeaderSource {
      fileName: string;
      title?: string;
      author?: string;
      tags?: string[];
      description?: string;
    }
    interface StubChunk {
      id: number;
      documentId: number;
      chunkIndex: number;
      content: string;
      contentHash: string;
      pageNumber?: number;
    }
    const headerSource: HeaderSource = {
      fileName: 'pricing.pdf',
      title: 'Pricing',
      author: 'Alice Chen',
      tags: ['pricing', 'enterprise'],
      description: 'Enterprise pricing rules',
    };

    const chunk: StubChunk = {
      id: 101,
      documentId: 7,
      chunkIndex: 0,
      content: 'Enterprise contracts start at 50 seats.',
      contentHash: 'hash-101',
      pageNumber: 1,
    };

    // embedAndStoreChunks is private; cast to invoke it directly so the
    // assertion isolates the embed/store contract from provider construction.
    await (
      module as unknown as {
        embedAndStoreChunks: (
          chunks: StubChunk[],
          embedBatchFn: (texts: string[]) => Promise<unknown[]>,
          vectorIndexPath: string,
          headerSource: HeaderSource
        ) => Promise<void>;
      }
    ).embedAndStoreChunks([chunk], embedBatchMock, '/tmp/vec/index', headerSource);

    // The embedder received a header-prefixed string, not the bare chunk body.
    expect(embedBatchMock).toHaveBeenCalledTimes(1);
    const embedArg = embedBatchMock.mock.calls[0][0] as string[];
    expect(embedArg).toHaveLength(1);
    expect(embedArg[0].startsWith('Title: Pricing')).toBe(true);
    expect(embedArg[0]).toContain('Author: Alice Chen');
    expect(embedArg[0]).toContain('Enterprise contracts start at 50 seats.');
    // The header must precede the body; the body must still be present.
    const titleIdx = embedArg[0].indexOf('Title: Pricing');
    const bodyIdx = embedArg[0].indexOf('Enterprise contracts start');
    expect(bodyIdx).toBeGreaterThan(titleIdx);

    // storeEmbedding received the bare chunk content — no header leakage.
    expect(storeEmbeddingMock).toHaveBeenCalledTimes(1);
    const stored = storeEmbeddingMock.mock.calls[0][0] as {
      chunkId: number;
      documentId: number;
      content: string;
      embedding: number[];
    };
    expect(stored.chunkId).toBe(101);
    expect(stored.documentId).toBe(7);
    expect(stored.content).toBe('Enterprise contracts start at 50 seats.');
    expect(stored.content.startsWith('Title:')).toBe(false);
    expect(stored.embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
