'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { VectorStoreService } from '@/service/VectorStoreService';

describe('VectorStoreService', () => {
  let vectorStoreService: VectorStoreService;

  beforeEach(() => {
    vectorStoreService = new VectorStoreService();
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(vectorStoreService).toBeInstanceOf(VectorStoreService);
    });
  });
});
