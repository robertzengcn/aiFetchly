'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { WebsiteAnalysisService } from '@/service/WebsiteAnalysisService';

describe('WebsiteAnalysisService', () => {
  let websiteAnalysisService: WebsiteAnalysisService;

  beforeEach(() => {
    websiteAnalysisService = new WebsiteAnalysisService();
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(websiteAnalysisService).toBeInstanceOf(WebsiteAnalysisService);
    });
  });
});
