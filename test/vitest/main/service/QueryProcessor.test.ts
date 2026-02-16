'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { QueryProcessor } from '@/service/QueryProcessor';
import { RagSearchController } from '@/controller/RagSearchController';
import { SqliteDb } from '@/config/SqliteDb';

describe('QueryProcessor', () => {
  let queryProcessor: QueryProcessor;
  let mockSearchController: RagSearchController;
  let mockDb: SqliteDb;

  beforeEach(() => {
    // Create mock instances
    mockSearchController = {
      search: vi.fn(),
    } as unknown as RagSearchController;

    mockDb = {
      getDataSource: vi.fn(),
      close: vi.fn(),
    } as unknown as SqliteDb;

    queryProcessor = new QueryProcessor(mockSearchController, mockDb);
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(queryProcessor).toBeInstanceOf(QueryProcessor);
    });
  });
});
