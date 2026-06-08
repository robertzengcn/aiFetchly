'use strict';
import { describe, test, expect } from 'vitest';
import {
  DEFAULT_RESULT_LIMIT,
  MAX_RESULT_LIMIT,
  VECTOR_CANDIDATE_LIMIT,
  KEYWORD_CANDIDATE_LIMIT,
  MAX_TOOL_CONTENT_CHARS,
  MAX_CHUNK_CONTENT_CHARS,
  RERANK_TIMEOUT_MS,
  DEFAULT_VECTOR_WEIGHT,
  DEFAULT_KEYWORD_WEIGHT,
  IDENTIFIER_VECTOR_WEIGHT,
  IDENTIFIER_KEYWORD_WEIGHT,
} from '@/service/RagSearchTypes';

describe('RagSearchTypes constants', () => {
  test('default limits are sensible', () => {
    expect(DEFAULT_RESULT_LIMIT).toBe(5);
    expect(MAX_RESULT_LIMIT).toBe(10);
    expect(DEFAULT_RESULT_LIMIT).toBeLessThan(MAX_RESULT_LIMIT);
  });

  test('candidate limits allow enough room for reranking', () => {
    expect(VECTOR_CANDIDATE_LIMIT).toBeGreaterThan(MAX_RESULT_LIMIT);
    expect(KEYWORD_CANDIDATE_LIMIT).toBeGreaterThan(MAX_RESULT_LIMIT);
  });

  test('content budgets are positive and bounded', () => {
    expect(MAX_TOOL_CONTENT_CHARS).toBeGreaterThan(0);
    expect(MAX_CHUNK_CONTENT_CHARS).toBeGreaterThan(0);
    expect(MAX_CHUNK_CONTENT_CHARS).toBeLessThan(MAX_TOOL_CONTENT_CHARS);
  });

  test('default weights sum to 1', () => {
    expect(DEFAULT_VECTOR_WEIGHT + DEFAULT_KEYWORD_WEIGHT).toBeCloseTo(1);
    expect(IDENTIFIER_VECTOR_WEIGHT + IDENTIFIER_KEYWORD_WEIGHT).toBeCloseTo(1);
  });

  test('identifier weights shift toward keyword', () => {
    expect(IDENTIFIER_KEYWORD_WEIGHT).toBeGreaterThan(DEFAULT_KEYWORD_WEIGHT);
    expect(IDENTIFIER_VECTOR_WEIGHT).toBeLessThan(DEFAULT_VECTOR_WEIGHT);
  });

  test('rerank timeout is reasonable', () => {
    expect(RERANK_TIMEOUT_MS).toBeGreaterThan(1000);
    expect(RERANK_TIMEOUT_MS).toBeLessThan(15000);
  });
});
