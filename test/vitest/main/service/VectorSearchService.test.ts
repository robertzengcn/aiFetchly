'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { VectorSearchService } from '@/service/VectorSearchService';
import { VectorStoreService } from '@/service/VectorStoreService';

// Mock VectorStoreService
vi.mock('@/service/VectorStoreService', () => {
  return {
    VectorStoreService: vi.fn().mockImplementation(function() {
      return {
        initialize: vi.fn().mockResolvedValue(undefined),
        isInitialized: vi.fn().mockReturnValue(true),
      };
    }),
  };
});

describe('VectorSearchService', () => {
  let vectorSearchService: VectorSearchService;
  let mockVectorStore: VectorStoreService;

  beforeEach(() => {
    mockVectorStore = new VectorStoreService();
    vectorSearchService = new VectorSearchService(mockVectorStore);
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(vectorSearchService).toBeInstanceOf(VectorSearchService);
    });
  });
});
