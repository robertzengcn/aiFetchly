'use strict';
import { describe, test, expect } from 'vitest';
import {
  ErrorClassifier,
  ErrorCategory,
  ErrorSeverity,
  RecoveryStrategy,
  ClassifiedError,
} from '@/service/ErrorClassification';

describe('ErrorClassifier', () => {
  describe('classify', () => {
    test('should classify network errors', () => {
      const error = new Error('Network request failed');
      const classified = ErrorClassifier.classify(error, 'test context');
      
      expect(classified.category).toBe(ErrorCategory.NETWORK);
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM);
      expect(classified.recoveryStrategy).toBe(RecoveryStrategy.RETRY);
      expect(classified.isRecoverable).toBe(true);
      expect(classified.context).toBe('test context');
      expect(classified.originalError).toBe(error);
    });

    test('should classify timeout errors', () => {
      const error = new Error('Request timeout');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.category).toBe(ErrorCategory.TIMEOUT);
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM);
      expect(classified.recoveryStrategy).toBe(RecoveryStrategy.RETRY);
      expect(classified.isRecoverable).toBe(true);
    });

    test('should classify validation errors', () => {
      const error = new Error('Invalid input');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.category).toBe(ErrorCategory.VALIDATION);
      expect(classified.severity).toBe(ErrorSeverity.LOW);
      expect(classified.recoveryStrategy).toBe(RecoveryStrategy.ABORT);
      expect(classified.isRecoverable).toBe(false);
    });

    test('should classify permission errors', () => {
      const error = new Error('Permission denied');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.category).toBe(ErrorCategory.PERMISSION);
      expect(classified.severity).toBe(ErrorSeverity.HIGH);
      expect(classified.recoveryStrategy).toBe(RecoveryStrategy.ABORT);
      expect(classified.isRecoverable).toBe(false);
    });

    test('should classify resource errors', () => {
      const error = new Error('Out of memory');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.category).toBe(ErrorCategory.RESOURCE);
      expect(classified.severity).toBe(ErrorSeverity.HIGH);
      expect(classified.recoveryStrategy).toBe(RecoveryStrategy.ABORT);
      expect(classified.isRecoverable).toBe(false);
    });

    test('should classify unknown errors', () => {
      const error = new Error('Unexpected error');
      const classified = ErrorClassifier.classify(error);
      
      expect(classified.category).toBe(ErrorCategory.UNKNOWN);
      expect(classified.severity).toBe(ErrorSeverity.MEDIUM);
      expect(classified.isRecoverable).toBe(false);
    });

    test('should preserve original error', () => {
      const originalError = new Error('Test error');
      const classified = ErrorClassifier.classify(originalError);
      
      expect(classified.originalError).toBe(originalError);
    });
  });
});
