'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { RagSearchCandidate } from '@/service/RagSearchTypes';

// Create a shared mock rerank function that tests can control
const mockRerankFn = vi.fn();

// Mock AiChatApi so that every new instance shares the same mock
vi.mock('@/api/aiChatApi', () => {
  return {
    AiChatApi: vi.fn().mockImplementation(function () {
      return {
        rerank: mockRerankFn,
        ensureAIEnabled: vi.fn(),
      };
    }),
  };
});

import { RagRerankService } from '@/service/RagRerankService';

function makeCandidate(overrides: Partial<RagSearchCandidate> = {}): RagSearchCandidate {
  return {
    chunkId: 1,
    documentId: 1,
    content: 'test content',
    source: 'vector',
    combinedScore: 0.8,
    metadata: { chunkIndex: 0 },
    document: { id: 1, name: 'test.pdf', fileType: 'pdf' },
    ...overrides,
  };
}

const mockRerankResponse = {
  id: 'test',
  model: 'rerank-model',
  usage: { prompt_tokens: 10, total_tokens: 10 },
};

describe('RagRerankService', () => {
  let service: RagRerankService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RagRerankService();
  });

  test('returns empty array for empty candidates', async () => {
    const result = await service.rerank('test', [], 5);
    expect(result.ranked).toEqual([]);
    expect(result.rerankUsed).toBe(false);
  });

  test('uses rerank results with correct index mapping', async () => {
    const candidates = [
      makeCandidate({ chunkId: 10, content: 'alpha' }),
      makeCandidate({ chunkId: 20, content: 'beta' }),
      makeCandidate({ chunkId: 30, content: 'gamma' }),
    ];

    mockRerankFn.mockResolvedValue({
      ...mockRerankResponse,
      results: [
        { index: 2, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.8 },
      ],
    });

    const result = await service.rerank('query', candidates, 5);

    expect(result.rerankUsed).toBe(true);
    expect(result.ranked).toHaveLength(2);
    // Index 2 should be first (higher score)
    expect(result.ranked[0].chunkId).toBe(30);
    expect(result.ranked[0].rerankScore).toBe(0.95);
    // Index 0 should be second
    expect(result.ranked[1].chunkId).toBe(10);
    expect(result.ranked[1].rerankScore).toBe(0.8);
  });

  test('falls back to hybrid ranking on rerank error', async () => {
    const candidates = [
      makeCandidate({ chunkId: 1, combinedScore: 0.9 }),
      makeCandidate({ chunkId: 2, combinedScore: 0.5 }),
    ];

    mockRerankFn.mockRejectedValue(new Error('Rerank service unavailable'));

    const result = await service.rerank('query', candidates, 5);

    expect(result.rerankUsed).toBe(false);
    expect(result.warning).toContain('Rerank unavailable');
    expect(result.ranked).toHaveLength(2);
    expect(result.ranked[0].chunkId).toBe(1);
  });

  test('ignores invalid rerank indexes', async () => {
    const candidates = [
      makeCandidate({ chunkId: 1 }),
      makeCandidate({ chunkId: 2 }),
    ];

    mockRerankFn.mockResolvedValue({
      ...mockRerankResponse,
      results: [
        { index: 0, relevance_score: 0.9 },
        { index: 99, relevance_score: 0.5 }, // Invalid index
      ],
    });

    const result = await service.rerank('query', candidates, 5);

    expect(result.rerankUsed).toBe(true);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].chunkId).toBe(1);
  });

  test('respects top_n limit from finalLimit', async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate({ chunkId: i + 1, content: `content ${i}` })
    );

    mockRerankFn.mockResolvedValue({
      ...mockRerankResponse,
      results: [{ index: 0, relevance_score: 0.99 }],
    });

    // finalLimit = 1, so top_n = min(10, 1*2) = 2
    await service.rerank('query', candidates, 1);

    // Verify top_n was passed as min(candidates.length, limit*2)
    expect(mockRerankFn).toHaveBeenCalledWith(
      expect.objectContaining({ top_n: 2 })
    );
  });
});
