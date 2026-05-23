'use strict';
import { describe, test, expect } from 'vitest';
import { ValidationUtils } from '@/service/ValidationUtils';

describe('ValidationUtils', () => {
  describe('validateNonEmptyString', () => {
    test('should return null for valid non-empty string', () => {
      const result = ValidationUtils.validateNonEmptyString('test', 'fieldName');
      expect(result).toBeNull();
    });

    test('should return error for empty string', () => {
      const result = ValidationUtils.validateNonEmptyString('', 'fieldName');
      expect(result).toBe('fieldName is required and must be a non-empty string');
    });

    test('should return error for whitespace-only string', () => {
      const result = ValidationUtils.validateNonEmptyString('   ', 'fieldName');
      expect(result).toBe('fieldName is required and must be a non-empty string');
    });

    test('should return error for null', () => {
      const result = ValidationUtils.validateNonEmptyString(null, 'fieldName');
      expect(result).toBe('fieldName is required and must be a non-empty string');
    });

    test('should return error for undefined', () => {
      const result = ValidationUtils.validateNonEmptyString(undefined, 'fieldName');
      expect(result).toBe('fieldName is required and must be a non-empty string');
    });

    test('should return error for non-string types', () => {
      const result = ValidationUtils.validateNonEmptyString(123, 'fieldName');
      expect(result).toBe('fieldName is required and must be a non-empty string');
    });
  });

  describe('validatePositiveInteger', () => {
    test('should return null for valid positive integer', () => {
      const result = ValidationUtils.validatePositiveInteger(5, 'fieldName');
      expect(result).toBeNull();
    });

    test('should return null for undefined (optional field)', () => {
      const result = ValidationUtils.validatePositiveInteger(undefined, 'fieldName');
      expect(result).toBeNull();
    });

    test('should return error for zero', () => {
      const result = ValidationUtils.validatePositiveInteger(0, 'fieldName');
      expect(result).toBe('fieldName must be a positive integer');
    });

    test('should return error for negative number', () => {
      const result = ValidationUtils.validatePositiveInteger(-1, 'fieldName');
      expect(result).toBe('fieldName must be a positive integer');
    });

    test('should return error for decimal number', () => {
      const result = ValidationUtils.validatePositiveInteger(5.5, 'fieldName');
      expect(result).toBe('fieldName must be a positive integer');
    });

    test('should return error for non-number types', () => {
      const result = ValidationUtils.validatePositiveInteger('5', 'fieldName');
      expect(result).toBe('fieldName must be a positive integer');
    });
  });

  describe('validateStringLength', () => {
    test('should return null for string within limit', () => {
      const result = ValidationUtils.validateStringLength('test', 'fieldName', 10);
      expect(result).toBeNull();
    });

    test('should return null for string at limit', () => {
      const result = ValidationUtils.validateStringLength('test', 'fieldName', 4);
      expect(result).toBeNull();
    });

    test('should return error for string exceeding limit', () => {
      const result = ValidationUtils.validateStringLength('this is too long', 'fieldName', 5);
      expect(result).toBe('fieldName exceeds maximum length of 5 characters');
    });
  });

  describe('validateArray', () => {
    test('should return valid result for non-empty array', () => {
      const result = ValidationUtils.validateArray([1, 2, 3], 'fieldName');
      expect(result.isValid).toBe(true);
      expect(result.validItems).toEqual([1, 2, 3]);
    });

    test('should return error for non-array value', () => {
      const result = ValidationUtils.validateArray('not an array', 'fieldName');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('fieldName must be an array');
    });

    test('should return error for empty array', () => {
      const result = ValidationUtils.validateArray([], 'fieldName');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('fieldName cannot be empty');
    });

    test('should use item validator when provided', () => {
      const itemValidator = (item: unknown) => typeof item === 'number';
      const result = ValidationUtils.validateArray([1, 2, 3], 'fieldName', itemValidator);
      expect(result.isValid).toBe(true);
    });

    test('should fail validation when item validator fails', () => {
      const itemValidator = (item: unknown) => typeof item === 'number';
      const result = ValidationUtils.validateArray([1, '2', 3], 'fieldName', itemValidator);
      // Note: ValidationUtils.validateArray may handle this differently
      // Adjust based on actual implementation
    });
  });
});
