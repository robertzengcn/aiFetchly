'use strict';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ResponseGenerator } from '@/service/ResponseGenerator';

describe('ResponseGenerator', () => {
  let responseGenerator: ResponseGenerator;

  beforeEach(() => {
    responseGenerator = new ResponseGenerator();
  });

  describe('basic functionality', () => {
    test('should be instantiated', () => {
      expect(responseGenerator).toBeInstanceOf(ResponseGenerator);
    });
  });
});
