'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ChunkingService } from '@/service/ChunkingService';

describe('ChunkingService', () => {
  let chunkingService: ChunkingService;

  beforeEach(() => {
    chunkingService = new ChunkingService();
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(chunkingService).toBeInstanceOf(ChunkingService);
    });
  });
});
