'use strict';
import { expect, test, describe, beforeEach, vi } from 'vitest';
import { ConfigurationCache } from '../ConfigurationCache';

describe('ConfigurationCache', () => {
    let cache: ConfigurationCache;

    beforeEach(() => {
        cache = new ConfigurationCache(10, 1000); // maxSize: 10, defaultTTL: 1000ms
    });

    describe('constructor', () => {
        test('should initialize with default values', () => {
            const defaultCache = new ConfigurationCache();
            expect(defaultCache.size()).toBe(0);
        });

        test('should initialize with custom values', () => {
            const customCache = new ConfigurationCache(5, 2000);
            expect(customCache.size()).toBe(0);
        });
    });

    describe('set and get', () => {
        test('should store and retrieve data', () => {
            const key = 'test-key';
            const value = { model: 'test-model', dimensions: 512 };

            cache.set(key, value);
            const result = cache.get(key);

            expect(result).toEqual(value);
        });

        test('should return null for non-existent key', () => {
            const result = cache.get('non-existent');
            expect(result).toBeNull();
        });

        test('should overwrite existing key', () => {
            const key = 'test-key';
            const value1 = { model: 'model1' };
            const value2 = { model: 'model2' };

            cache.set(key, value1);
            cache.set(key, value2);

            const result = cache.get(key);
            expect(result).toEqual(value2);
        });
    });

    describe('TTL (Time To Live)', () => {
        test('should return data before TTL expires', () => {
            const key = 'test-key';
            const value = { model: 'test-model' };

            cache.set(key, value, 1000); // 1 second TTL
            const result = cache.get(key);

            expect(result).toEqual(value);
        });

        test('should return null after TTL expires', async () => {
            const key = 'test-key';
            const value = { model: 'test-model' };

            cache.set(key, value, 100); // 100ms TTL

            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            const result = cache.get(key);
            expect(result).toBeNull();
        });

        test('should use default TTL when not specified', () => {
            const key = 'test-key';
            const value = { model: 'test-model' };

            cache.set(key, value); // No TTL specified, should use default
            const result = cache.get(key);

            expect(result).toEqual(value);
        });
    });

    describe('isExpired', () => {
        test('should return true for non-existent key', () => {
            const result = cache.isExpired('non-existent');
            expect(result).toBe(true);
        });

        test('should return false for valid key', () => {
            const key = 'test-key';
            const value = { model: 'test-model' };

            cache.set(key, value, 1000);
            const result = cache.isExpired(key);

            expect(result).toBe(false);
        });

        test('should return true for expired key', async () => {
            const key = 'test-key';
            const value = { model: 'test-model' };

            cache.set(key, value, 100); // 100ms TTL

            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            const result = cache.isExpired(key);
            expect(result).toBe(true);
        });
    });

    describe('clear', () => {
        test('should clear all entries', () => {
            cache.set('key1', { model: 'model1' });
            cache.set('key2', { model: 'model2' });

            expect(cache.size()).toBe(2);

            cache.clear();

            expect(cache.size()).toBe(0);
            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key2')).toBeNull();
        });
    });

    describe('delete', () => {
        test('should delete specific key', () => {
            cache.set('key1', { model: 'model1' });
            cache.set('key2', { model: 'model2' });

            const result = cache.delete('key1');

            expect(result).toBe(true);
            expect(cache.get('key1')).toBeNull();
            expect(cache.get('key2')).toEqual({ model: 'model2' });
        });

        test('should return false for non-existent key', () => {
            const result = cache.delete('non-existent');
            expect(result).toBe(false);
        });
    });

    describe('has', () => {
        test('should return true for existing key', () => {
            cache.set('test-key', { model: 'test-model' });
            const result = cache.has('test-key');
            expect(result).toBe(true);
        });

        test('should return false for non-existent key', () => {
            const result = cache.has('non-existent');
            expect(result).toBe(false);
        });

        test('should return false for expired key', async () => {
            cache.set('test-key', { model: 'test-model' }, 100);

            // Wait for TTL to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            const result = cache.has('test-key');
            expect(result).toBe(false);
        });
    });

    describe('keys', () => {
        test('should return all keys', () => {
            cache.set('key1', { model: 'model1' });
            cache.set('key2', { model: 'model2' });

            const keys = cache.keys();
            expect(keys).toContain('key1');
            expect(keys).toContain('key2');
            expect(keys).toHaveLength(2);
        });

        test('should return empty array for empty cache', () => {
            const keys = cache.keys();
            expect(keys).toEqual([]);
        });
    });

    describe('size limits', () => {
        test('should enforce max size limit', () => {
            // Fill cache to max size
            for (let i = 0; i < 10; i++) {
                cache.set(`key${i}`, { model: `model${i}` });
            }

            expect(cache.size()).toBe(10);

            // Add one more - should trigger cleanup
            cache.set('key11', { model: 'model11' });

            // Should still be at max size
            expect(cache.size()).toBe(10);
        });

        test('should remove oldest entries when size limit exceeded', () => {
            // Fill cache to max size
            for (let i = 0; i < 10; i++) {
                cache.set(`key${i}`, { model: `model${i}` });
            }

            // Add one more
            cache.set('key11', { model: 'model11' });

            // Oldest entry should be removed
            expect(cache.get('key0')).toBeNull();
            expect(cache.get('key11')).toEqual({ model: 'model11' });
        });
    });

    describe('getStats', () => {
        test('should return correct statistics', () => {
            cache.set('key1', { model: 'model1' });
            cache.set('key2', { model: 'model2' });

            const stats = cache.getStats();

            expect(stats.size).toBe(2);
            expect(stats.maxSize).toBe(10);
            expect(stats.defaultTTL).toBe(1000);
            expect(stats.expiredEntries).toBe(0);
        });

        test('should count expired entries', async () => {
            cache.set('key1', { model: 'model1' }, 100);
            cache.set('key2', { model: 'model2' }, 1000);

            // Wait for first key to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            const stats = cache.getStats();

            expect(stats.expiredEntries).toBe(1);
        });
    });

    describe('cleanup behavior', () => {
        test('should automatically clean up expired entries', async () => {
            cache.set('key1', { model: 'model1' }, 100);
            cache.set('key2', { model: 'model2' }, 1000);

            // Wait for first key to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            // Trigger cleanup by adding new entry
            cache.set('key3', { model: 'model3' });

            expect(cache.get('key1')).toBeNull(); // Should be cleaned up
            expect(cache.get('key2')).toEqual({ model: 'model2' }); // Should still exist
            expect(cache.get('key3')).toEqual({ model: 'model3' }); // Should exist
        });
    });
});


