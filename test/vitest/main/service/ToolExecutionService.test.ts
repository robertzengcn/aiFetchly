'use strict';
import { describe, test, expect, vi } from 'vitest';
import { ToolExecutionService } from '@/service/ToolExecutionService';

describe('ToolExecutionService', () => {
  describe('static methods', () => {
    test('should have formatSearchResultsForLLM method', () => {
      expect(ToolExecutionService.formatSearchResultsForLLM).toBeDefined();
      expect(typeof ToolExecutionService.formatSearchResultsForLLM).toBe('function');
    });

    test('should format empty search results', () => {
      const result = ToolExecutionService.formatSearchResultsForLLM([]);
      expect(result).toBe('No search results found.');
    });

    test('should format search results', () => {
      const results = [
        { link: 'https://example.com', title: 'Example', snippet: 'Test snippet' },
      ];
      const result = ToolExecutionService.formatSearchResultsForLLM(results);
      expect(result).toContain('Example');
      expect(result).toContain('https://example.com');
    });
  });
});
