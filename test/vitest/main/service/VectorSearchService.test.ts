'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { VectorSearchService } from '@/service/VectorSearchService';

describe('VectorSearchService', () => {
  let vectorSearchService: VectorSearchService;

  beforeEach(() => {
    vectorSearchService = new VectorSearchService();
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(vectorSearchService).toBeInstanceOf(VectorSearchService);
    });
  });
});
