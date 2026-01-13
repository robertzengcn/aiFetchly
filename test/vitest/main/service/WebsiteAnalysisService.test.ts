'use strict';
import { describe, test, expect, vi } from 'vitest';
import { WebsiteAnalysisService } from '@/service/WebsiteAnalysisService';

describe('WebsiteAnalysisService', () => {
  describe('static methods', () => {
    test('should have startBatchAnalysis method', () => {
      expect(WebsiteAnalysisService.startBatchAnalysis).toBeDefined();
      expect(typeof WebsiteAnalysisService.startBatchAnalysis).toBe('function');
    });
  });
});
